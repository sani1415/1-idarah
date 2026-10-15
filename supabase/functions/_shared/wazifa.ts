// ওজিফা (মাসিক ফি) — বাইরের ফি-সফটওয়্যারের API ডাকা ও উত্তর এক ধাঁচে আনা।
// mdr-student-fee (প্রোফাইলের ট্যাব) আর mdr-wazifa-sync (সবার রিপোর্ট) দুটোই এটা ব্যবহার করে।
export const API_BASE = "https://backend.mimalmadinah.com/api/stpayment-history/";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const enDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

export function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// API-র মাসের নাম → হিজরী মাস নম্বর (বানানের ছোট পার্থক্য সহ্য করে; নুকতা বাদ দিয়ে মেলানো)
const MONTHS: Array<[RegExp, number]> = [
  [/^মুহা?র(্)?রম/, 1], [/^সফর/, 2], [/^রবিউল\s*আ/, 3], [/^রবিউস\s*সা/, 4],
  [/^জুমাদাস\s*সা|^জুমাদাল\s*উখ/, 6], [/^জুমাদাল\s*(আ|উ)/, 5], [/^রজব/, 7], [/^শা[বই]া?ন/, 8],
  [/^রমজান|^রমযান/, 9], [/^শাওযাল|^শাওাল/, 10], [/^জিল\s*কদ|^যিলক/, 11], [/^জিল\s*হজ|^যিলহ/, 12],
];
export function monthNo(name: string): number | null {
  const n = name.normalize("NFD").replace(/়/g, "").trim();
  for (const [re, no] of MONTHS) if (re.test(n)) return no;
  return null;
}

export type FeeMonth = {
  month: string; month_no: number | null; year: number | null;
  reason: string; fee_type: string; amount: number; paid: boolean; paid_date: string;
  paid_day: number | null; paid_month_no: number | null; paid_year: number | null;
};

// «১২ শাওয়াল, ১৪৪৭» → দিন/মাস/বছর
function parsePaidDate(s: string) {
  const m = enDigits(s).match(/^(\d{1,2})\s+(.+?),?\s*(\d{4})\s*$/);
  if (!m) return { day: null, month: null, year: null };
  return { day: Number(m[1]), month: monthNo(m[2]), year: Number(m[3]) };
}

export function normalizeMonths(rows: Array<Record<string, unknown>>): FeeMonth[] {
  return rows.map((r) => {
    const m = enDigits(str(r.month));
    const name = m.replace(/[-–\s]*\d{3,4}\s*$/, "").trim();
    const year = (m.match(/(\d{4})\s*$/) || [])[1] || "";
    const paidDate = str(r.paid_date);
    const paid = str(r.status).toLowerCase() === "paid";
    const pd = paid && paidDate && paidDate !== "-" ? parsePaidDate(paidDate) : { day: null, month: null, year: null };
    return {
      month: name,
      month_no: monthNo(name),
      year: year ? Number(year) : null,
      reason: str(r.reason),
      fee_type: str(r.fee_type),
      amount: Number(enDigits(str(r.amount)).replace(/,/g, "")) || 0,
      paid,
      paid_date: paidDate && paidDate !== "-" ? paidDate : "",
      paid_day: pd.day, paid_month_no: pd.month, paid_year: pd.year,
    };
  });
}

// রিপোর্টের জন্য ছোট আকার (৫০০+ ছাত্রের তথ্য একসাথে যায়): k = m মাসিক / a ভর্তি / o অন্য
export function compactMonths(months: FeeMonth[]) {
  return months.map((x) => {
    const k = /মাসিক/.test(x.reason) ? "m" : (/ভর্তি/.test(x.reason) ? "a" : "o");
    const o: Record<string, unknown> = { mn: x.month_no, y: x.year, k, a: x.amount, p: x.paid ? 1 : 0 };
    if (k === "o") o.r = x.reason;
    if (x.paid) { o.pd = x.paid_day; o.pm = x.paid_month_no; o.py = x.paid_year; }
    return o;
  });
}

// ফি-সফটওয়্যার ভবিষ্যতে ছাত্রের নাম/পিতার নাম/জামাত পাঠালে মিলিয়ে দেখার জন্য
export function vendorStudent(d: Record<string, unknown>): Record<string, string> | null {
  const src = (d.student && typeof d.student === "object" ? d.student : d) as Record<string, unknown>;
  const pick = (keys: string[]) => {
    for (const k of keys) if (str(src[k])) return str(src[k]);
    return "";
  };
  const out: Record<string, string> = {
    name: pick(["student_name", "name", "name_bn", "full_name"]),
    father_name: pick(["father_name", "fathers_name", "guardian_name"]),
    class_name: pick(["class_name", "class", "jamat", "class_title"]),
    reg_id: pick(["reg_id", "student_id", "registration_no", "roll"]),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

export type FetchResult =
  | { status: "ok"; months: FeeMonth[]; totals: Record<string, number>; vendor_student: Record<string, string> | null }
  | { status: "not_found" }
  | { status: "error"; error: string; http?: number };

export async function fetchWazifa(apiKey: string, regId: string, timeoutMs = 20000): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_BASE + encodeURIComponent(apiKey) + "/" + encodeURIComponent(regId), {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (_e) {
    return { status: "error", error: "fee_api_unreachable" };
  } finally {
    clearTimeout(timer);
  }
  let payload: Record<string, unknown> | null = null;
  try { payload = await res.json(); } catch (_e) { payload = null; }
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok || !payload || payload.success !== true) return { status: "error", error: "fee_api_error", http: res.status };
  const data = (payload.data || {}) as Record<string, unknown>;
  const rows = Array.isArray(data.data) ? data.data as Array<Record<string, unknown>> : [];
  const t = (data.totals || {}) as Record<string, unknown>;
  return {
    status: "ok",
    months: normalizeMonths(rows),
    totals: {
      total_amount: Number(t.total_amount) || 0,
      total_paid: Number(t.total_paid) || 0,
      total_due: Number(t.total_due) || 0,
    },
    vendor_student: vendorStudent(data),
  };
}
