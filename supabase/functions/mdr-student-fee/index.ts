import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { compactMonths, fetchWazifa, str } from "../_shared/wazifa.ts";

// ছাত্রের ওজিফা (মাসিক ফি) — বাইরের ফি-সফটওয়্যারের API থেকে (চাবি শুধু এখানে, secret হিসেবে)।
// ব্রাউজার পাঠায় { actor_id, pin, student_id (uuid) }; আগে mdr_rel_student_fee_access দিয়ে
// অনুমতি (জিম্মাদার/দফতর) যাচাই ও রেজি. আইডি ডাটাবেজ থেকে নেওয়া, তারপর API ডাকা।
// পাওয়া তথ্য রিপোর্টের snapshot-এও রাখা হয় (mdr_wazifa_snapshot), যাতে রিপোর্ট হালনাগাদ থাকে।
//
// deploy: verify_jwt = false (actor + PIN দিয়ে নিজস্ব যাচাই, অন্য mdr_rel_* RPC-র মতো)।
// প্রয়োজনীয় env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAZIFA_API_KEY।
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = (Deno.env.get("WAZIFA_API_KEY") ?? "").trim();

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!API_KEY) return json({ ok: false, error: "fee_api_not_configured" }, 500);

  let body: { actor_id?: string; pin?: string; student_id?: string } = {};
  try { body = await req.json(); } catch (_e) { body = {}; }
  const actorId = str(body.actor_id), pin = str(body.pin), studentId = str(body.student_id);
  if (!UUID_RE.test(actorId) || !pin || !UUID_RE.test(studentId)) return json({ ok: false, error: "invalid_request" }, 400);

  const { data: access, error: accErr } = await admin.rpc("mdr_rel_student_fee_access", {
    p_actor_id: actorId, p_pin: pin, p_student_id: studentId,
  });
  if (accErr) {
    const locked = String(accErr.message || "").includes("pin_locked");
    return json({ ok: false, error: locked ? "pin_locked" : "access_check_failed" }, locked ? 403 : 500);
  }
  if (!access || !access.ok) return json({ ok: false, error: (access && access.error) || "not_allowed" }, 403);
  const regId = str(access.reg_id);

  const r = await fetchWazifa(API_KEY, regId);
  if (r.status !== "error") {
    // রিপোর্টের snapshot — ব্যর্থ হলেও ট্যাব দেখানো আটকাবে না
    try {
      await admin.rpc("mdr_rel_wazifa_snapshot_save", {
        p_rows: [{
          student_id: studentId, reg_id: regId, status: r.status,
          months: r.status === "ok" ? compactMonths(r.months) : [],
          totals: r.status === "ok" ? r.totals : {},
        }],
        p_finished: false,
      });
    } catch (_e) { /* ignore */ }
  }
  if (r.status === "not_found") return json({ ok: false, error: "not_found_in_fee_software", reg_id: regId });
  if (r.status === "error") return json({ ok: false, error: r.error, status: r.http }, 502);
  return json({ ok: true, reg_id: regId, months: r.months, totals: r.totals, vendor_student: r.vendor_student });
});
