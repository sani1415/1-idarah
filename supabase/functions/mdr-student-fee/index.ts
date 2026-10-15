import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ছাত্রের মাসিক ফি — বাইরের ফি-সফটওয়্যারের API থেকে (চাবি শুধু এখানে, secret হিসেবে)।
// ব্রাউজার পাঠায় { actor_id, pin, student_id (uuid) }; আগে mdr_rel_student_fee_access দিয়ে
// অনুমতি (জিম্মাদার/দফতর) যাচাই ও রেজি. আইডি ডাটাবেজ থেকে নেওয়া, তারপর API ডাকা।
//
// deploy: verify_jwt = false (actor + PIN দিয়ে নিজস্ব যাচাই, অন্য mdr_rel_* RPC-র মতো)।
// প্রয়োজনীয় env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAZIFA_API_KEY।
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = (Deno.env.get("WAZIFA_API_KEY") ?? "").trim();
const API_BASE = "https://backend.mimalmadinah.com/api/stpayment-history/";

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
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const enDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

// API-র মাসের নাম → হিজরী মাস নম্বর (বানানের ছোট পার্থক্য সহ্য করে)
const MONTHS: Array<[RegExp, number]> = [
  [/^মুহা?র(্)?রম/, 1], [/^সফর/, 2], [/^রবিউল\s*আ/, 3], [/^রবিউস\s*সা/, 4],
  [/^জুমাদাস\s*সা|^জুমাদাল\s*উখ/, 6], [/^জুমাদাল\s*(আ|উ)/, 5], [/^রজব/, 7], [/^শা[বই]া?ন/, 8],
  [/^রমজান|^রমযান/, 9], [/^শাওযাল|^শাওাল/, 10], [/^জিল\s*কদ|^যিলক/, 11], [/^জিল\s*হজ|^যিলহ/, 12],
];
function monthNo(name: string): number | null {
  // য়/ড় দুই ধাঁচে লেখা হয় (একক অক্ষর বা অক্ষর + নুকতা) — নুকতা বাদ দিয়ে মেলানো
  const n = name.normalize("NFD").replace(/\u09BC/g, "").trim();
  for (const [re, no] of MONTHS) if (re.test(n)) return no;
  return null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// ফি-সফটওয়্যার ভবিষ্যতে ছাত্রের নাম/পিতার নাম/জামাত পাঠালে মিলিয়ে দেখার জন্য সামনে দিয়ে দেওয়া
function vendorStudent(d: Record<string, unknown>): Record<string, string> | null {
  const src = (d.student && typeof d.student === "object" ? d.student : d) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const pick = (keys: string[]) => {
    for (const k of keys) if (str(src[k])) return str(src[k]);
    return "";
  };
  out.name = pick(["student_name", "name", "name_bn", "full_name"]);
  out.father_name = pick(["father_name", "fathers_name", "guardian_name"]);
  out.class_name = pick(["class_name", "class", "jamat", "class_title"]);
  out.reg_id = pick(["reg_id", "student_id", "registration_no", "roll"]);
  return Object.values(out).some(Boolean) ? out : null;
}

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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(API_BASE + encodeURIComponent(API_KEY) + "/" + encodeURIComponent(regId), {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (_e) {
    return json({ ok: false, error: "fee_api_unreachable" }, 502);
  } finally {
    clearTimeout(timer);
  }

  let payload: Record<string, unknown> | null = null;
  try { payload = await res.json(); } catch (_e) { payload = null; }
  if (res.status === 404) return json({ ok: false, error: "not_found_in_fee_software", reg_id: regId });
  if (!res.ok || !payload || payload.success !== true) return json({ ok: false, error: "fee_api_error", status: res.status }, 502);

  const data = (payload.data || {}) as Record<string, unknown>;
  const rows = Array.isArray(data.data) ? data.data as Array<Record<string, unknown>> : [];
  const months = rows.map((r) => {
    const m = enDigits(str(r.month));
    const name = m.replace(/[-–\s]*\d{3,4}\s*$/, "").trim();
    const year = (m.match(/(\d{4})\s*$/) || [])[1] || "";
    const amount = Number(enDigits(str(r.amount)).replace(/,/g, "")) || 0;
    const paidDate = str(r.paid_date);
    return {
      month: name,
      month_no: monthNo(name),
      year: year ? Number(year) : null,
      reason: str(r.reason),
      fee_type: str(r.fee_type),
      amount,
      paid: str(r.status).toLowerCase() === "paid",
      paid_date: paidDate && paidDate !== "-" ? paidDate : "",
    };
  });
  const totals = (data.totals || {}) as Record<string, unknown>;
  return json({
    ok: true,
    reg_id: regId,
    months,
    totals: {
      total_amount: Number(totals.total_amount) || 0,
      total_paid: Number(totals.total_paid) || 0,
      total_due: Number(totals.total_due) || 0,
    },
    vendor_student: vendorStudent(data),
  });
});
