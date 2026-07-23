import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Existing one-to-one chat-এর বিপরীত পক্ষের active PWA subscription-এ push পাঠায়।
// mdr_shared_messages-এর AFTER INSERT trigger (private.mdr_notify_chat_message)
// pg_net দিয়ে এটিকে x-notify-secret header সহ কল করে।
//
// deploy: verify_jwt = false (নিজস্ব secret auth)।
// প্রয়োজনীয় env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, NOTIFY_WEBHOOK_SECRET।
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:abunooroin@gmail.com";
const NOTIFY_SECRET = (Deno.env.get("NOTIFY_WEBHOOK_SECRET") ?? "").trim();

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  // DB trigger পাঠানো x-notify-secret যাচাই (verify_jwt:false, তাই নিজস্ব auth)।
  const hdr = (req.headers.get("x-notify-secret") || "").trim();
  if (!NOTIFY_SECRET || hdr !== NOTIFY_SECRET) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return jsonResponse({ ok: false, error: "vapid_not_configured" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  let payloadIn: {
    kind?: string;
    from_role?: string;
    from_name?: string;
    body?: string;
    thread_id?: string;
    message_id?: string;
    request?: { kind?: string; studentName?: string } | null;
    log_type?: string;
    log_id?: string;
  } = {};
  try { payloadIn = await req.json(); } catch (_e) { payloadIn = {}; }

  const isLogReview = payloadIn.kind === "log_review";

  const fromAdmin = String(payloadIn.from_role || "") === "admin";
  const threadId = String(payloadIn.thread_id || "").trim();
  let subscriptionsQuery = admin
    .from("mdr_shared_push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (isLogReview || !fromAdmin) subscriptionsQuery = subscriptionsQuery.eq("actor_role", "admin");
  else subscriptionsQuery = subscriptionsQuery.eq("actor_thread", threadId);
  const { data: subs, error: subErr } = await subscriptionsQuery;
  if (subErr) return jsonResponse({ ok: false, error: subErr.message }, 500);

  // অপঠিত admin বার্তার সংখ্যা → app-icon badge।
  let count = 0;
  let unreadQuery = admin.from("mdr_shared_messages").select("id", { count: "exact", head: true });
  if (fromAdmin && !isLogReview) {
    unreadQuery = unreadQuery.eq("thread_id", threadId).eq("from_role", "admin").eq("read_staff", false);
  } else {
    unreadQuery = unreadQuery.neq("from_role", "admin").eq("read_admin", false);
  }
  const { count: unread } = await unreadQuery;
  if (typeof unread === "number") count = unread;

  let title: string;
  let body: string;
  let url: string;
  let tag: string;

  if (isLogReview) {
    const logType = String(payloadIn.log_type || "");
    title = "🔔 রিভিউ প্রয়োজন";
    body = (logType === "class" ? "নতুন শ্রেণি লগ" : "নতুন ছাত্র লগ") + " রিভিউর অপেক্ষায়।";
    url = "/admin/recent.html?filter=review";
    tag = "admin-review";
  } else {
    const fromName = String(payloadIn.from_name || "").trim();
    const preview = String(payloadIn.body || "").trim();
    const taggedStudent = payloadIn.request && payloadIn.request.kind === "student_tag"
      ? String(payloadIn.request.studentName || "").trim()
      : "";
    title = taggedStudent
      ? `${fromName || "শিক্ষক"} — ছাত্র ট্যাগ: ${taggedStudent}`
      : (fromName ? `${fromName} — নতুন বার্তা` : "নতুন বার্তা");
    body = preview
      ? (preview.length > 80 ? preview.slice(0, 80) + "…" : preview)
      : "আপনাকে একটি নতুন বার্তা পাঠানো হয়েছে।";
    // নোটিফিকেশনে ক্লিক করলে সরাসরি সংশ্লিষ্ট thread-এ নিয়ে যায়।
    url = fromAdmin ? "/chat.html" : (threadId ? `/chat.html?thread=${encodeURIComponent(threadId)}` : "/chat.html");
    tag = threadId ? `personal-chat-${threadId}` : "personal-chat";
  }

  const payload = JSON.stringify({ title, body, url, tag, count });

  let sent = 0, removed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await admin.from("mdr_shared_push_subscriptions").delete().eq("id", s.id);
        removed++;
      }
    }
  }));

  return jsonResponse({ ok: true, sent, removed, count });
});
