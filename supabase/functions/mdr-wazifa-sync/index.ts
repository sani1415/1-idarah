import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { compactMonths, fetchWazifa } from "../_shared/wazifa.ts";

// সব সক্রিয় ছাত্রের ওজিফা ফি-সফটওয়্যার থেকে এনে mdr_wazifa_snapshot-এ রাখা (ওজিফা রিপোর্টের জন্য)।
// ফি-সফটওয়্যার এক ছাত্রে ~১ সেকেন্ড নেয়, তাই এটা পেছনে চলে (EdgeRuntime.waitUntil) আর
// সাথে সাথে 202 ফেরত দেয়। সময়ের সীমা পেরোলে বাকিদের জন্য নিজেকে আবার ডাকে (সর্বোচ্চ কয়েকবার)।
// ডাকে শুধু ডাটাবেজ: private.mdr_wazifa_sync_kick() (রাতের pg_cron বা «হালনাগাদ» বোতাম),
// header x-notify-secret দিয়ে (send-admin-push-এর একই secret)।
//
// deploy: verify_jwt = false। env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAZIFA_API_KEY, NOTIFY_WEBHOOK_SECRET।
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = (Deno.env.get("WAZIFA_API_KEY") ?? "").trim();
const SECRET = (Deno.env.get("NOTIFY_WEBHOOK_SECRET") ?? "").trim();

const CONCURRENCY = 1;        // ফি-সফটওয়্যার মিনিটে ~৫০টির বেশি অনুরোধে 429 দেয়, তাই একটা একটা করে
const PAUSE_MS = 300;          // প্রতি অনুরোধের পর বিরতি
const TIME_BUDGET_MS = 110000; // এক দফার সময়সীমা; বাকিরা পরের দফায়
const MAX_CHAIN = 9;           // এক হালনাগাদে সর্বোচ্চ দফা (~১১০ সেকেন্ড করে)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

type QueueItem = { id: string; reg_id: string };

async function run(chain: number, runId: string) {
  const t0 = Date.now();
  const { data: queue, error } = await admin.rpc("mdr_rel_wazifa_sync_queue", { p_run_id: runId, p_limit: 1000 });
  if (error || !Array.isArray(queue)) return;
  const items = queue as QueueItem[];
  let next = 0, done = 0, failed = 0;
  const errCodes: Record<string, number> = {};
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let buffer: Record<string, unknown>[] = [];

  const flush = async () => {
    if (!buffer.length) return;
    const rows = buffer;
    buffer = [];
    await admin.rpc("mdr_rel_wazifa_snapshot_save", { p_rows: rows, p_finished: false });
  };

  const worker = async () => {
    while (next < items.length && Date.now() - t0 < TIME_BUDGET_MS) {
      const it = items[next++];
      let r = await fetchWazifa(API_KEY, it.reg_id, 15000);
      if (r.status === "error") { // 429 হলে একটু বেশি থেমে আরেকবার
        await sleep(r.http === 429 ? 8000 : 1500);
        r = await fetchWazifa(API_KEY, it.reg_id, 15000);
      }
      await sleep(PAUSE_MS);
      if (r.status === "error") { // পুরনো তথ্য থাকুক, পরের দফায় আবার চেষ্টা
        failed++;
        const code = r.error + ":" + (r.http ?? "");
        errCodes[code] = (errCodes[code] || 0) + 1;
        continue;
      }
      buffer.push({
        student_id: it.id, reg_id: it.reg_id, status: r.status,
        months: r.status === "ok" ? compactMonths(r.months) : [],
        totals: r.status === "ok" ? r.totals : {},
      });
      done++;
      if (buffer.length >= 25) await flush();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();

  const remaining = items.length - next;
  console.log(JSON.stringify({ wazifa_sync: { chain, queued: items.length, done, failed, remaining, errCodes, ms: Date.now() - t0 } }));
  if (remaining > 0 && chain < MAX_CHAIN) {
    // বাকিদের জন্য পরের দফা (একই run_id — অগ্রগতি একসাথে গোনা হয়)
    try {
      await fetch(SUPABASE_URL + "/functions/v1/mdr-wazifa-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-notify-secret": SECRET },
        body: JSON.stringify({ chain: chain + 1, run_id: runId }),
      });
    } catch (_e) { /* পরের রাতে বাকিরা আসবে */ }
    return;
  }
  await admin.rpc("mdr_rel_wazifa_snapshot_save", { p_rows: [], p_finished: true, p_failed: failed + remaining });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const hdr = (req.headers.get("x-notify-secret") || "").trim();
  if (!SECRET || hdr !== SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  if (!API_KEY) return json({ ok: false, error: "fee_api_not_configured" }, 500);

  let body: { chain?: number; run_id?: string } = {};
  try { body = await req.json(); } catch (_e) { body = {}; }
  const chain = Math.max(0, Math.min(MAX_CHAIN, Number(body.chain) || 0));
  const runId = String(body.run_id || crypto.randomUUID());

  // @ts-ignore EdgeRuntime Supabase-এর runtime-এ আছে
  EdgeRuntime.waitUntil(run(chain, runId));
  return json({ ok: true, started: true, chain, run_id: runId }, 202);
});
