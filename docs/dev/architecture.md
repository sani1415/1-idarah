# Architecture

মাদরাসা, বিভাগ ও খেদমতে খালক পরিচালনার জন্য vanilla HTML/CSS/JS PWA, backend হলো Supabase PostgreSQL RPC।

কোন কাজের কোড কোথায়: [code-map.md](code-map.md) • চালানো/বিল্ড: [local-setup.md](local-setup.md)

## Stack

| স্তর | কী |
| --- | --- |
| Frontend | plain HTML, CSS, vanilla JS, কোনো framework বা bundler নেই। source আছে `app/`-এ |
| Styling | shared `app/css/style.css` + page-specific CSS |
| Data | Supabase PostgreSQL, শুধু RPC function দিয়ে access |
| Auth | app-level লগইন আইডি + ৪ অঙ্কের PIN, যা RPC যাচাই করে। session রাখে `app/js/core/mm-session.js` |
| Hosting | Vercel static (`public/`) + একটি serverless function (`api/admin-assistant.js`) |
| Push | Web Push (VAPID), Supabase Edge Function `supabase/functions/send-admin-push/` |
| বাইরের API | ছাত্রের মাসিক ফি: Edge Function `supabase/functions/mdr-student-fee/` — চাবি শুধু secret `WAZIFA_API_KEY`-এ; অনুমতি `mdr_rel_student_fee_access` (service_role-only) দিয়ে, ব্রাউজারে চাবি যায় না |
| PWA | service worker + install prompt (`mm-install.js`), auto update check (`app-update.js`)। Capacitor/Android সরানো হয়েছে |

React/Vue/Next বা bundler যোগ করা হবে না, যদি না স্পষ্টভাবে সিদ্ধান্ত হয়।

## Data layer

```
HTML page
  → module API (app/js/api/api.js, dept/dept-api.js, khedmat/khedmat-api.js)
    → *-supabase-sync.js (mdr-supabase-sync, dept-supabase-sync)
      → app/js/api/api-shared.js / api-mdr.js  (RPC wrapper)
        → Supabase RPC (SECURITY DEFINER)  → mdr_* tables
```

- **Source of truth হলো Supabase।** অ্যাপ শুরুতে local prototype ছিল, তাই কিছু module-এ এখনো `localStorage` cache বা fallback কোড আছে (যেমন `dept-api.js`, `mdr-dastarkhan.js`)। এগুলো legacy; নতুন write-side fallback যোগ হবে না।
- Behavior বদলানোর আগে সেই module-এর বর্তমান implementation দেখে নিতে হবে। module গুলো ধাপে ধাপে migrate হয়েছে, তাই সব জায়গায় একই pattern নেই।

## Database

একই Supabase project-এ কয়েকটা অ্যাপের table আছে। **এই অ্যাপের table সবগুলো `mdr_` দিয়ে শুরু:**

| Prefix | Module | উদাহরণ |
| --- | --- | --- |
| `mdr_*` | মাদরাসা | `mdr_students`, `mdr_attendance`, `mdr_account_*`, `mdr_exams`, `mdr_hifz_*`, `mdr_dars_*`, `mdr_programs`, `mdr_khadimin` |
| `mdr_dept_*` | বিভাগ | `mdr_dept_departments`, `mdr_dept_transactions`, `mdr_dept_inventory`, `mdr_dept_edit_requests` |
| `mdr_khedmat_*` | খেদমত | `mdr_khedmat_beneficiaries`, `mdr_khedmat_daily_logs`, `mdr_khedmat_finance` |
| `mdr_shared_*` | shared | `mdr_shared_users`, `mdr_shared_messages`, `mdr_shared_notifications`, `mdr_shared_push_subscriptions` |
| `mdr_ai_*` | AI সহকারীর read-only view | `mdr_ai_attendance_daily`, `mdr_ai_student_status_summary` |

**অন্য অ্যাপের table, এগুলো কখনো ছোঁয়া যাবে না:** `waqf_*` (পুরনো Waqf app), `nt_*` (notes app)।

> কিছু পুরনো migration ফাইলে unprefixed নাম (`dept_settings`, `khedmat_*`) দেখা যায়। সেগুলো `20260614130000_mdr_idarah_table_prefix_rename.sql`-এ rename হয়েছে; live DB-তে এখন শুধু উপরের prefix গুলো আছে।

### Security pattern

- প্রতিটি table-এ RLS চালু এবং deny-all। frontend সরাসরি table পড়তে বা লিখতে পারে না।
- সব কাজ হয় `SECURITY DEFINER` RPC দিয়ে (নাম সাধারণত `mdr_rel_*`)। RPC নিজেই actor id + PIN যাচাই করে এবং role/scope enforce করে।
- সহকারী জিম্মাদারের scope (কিতাব/মক্তব বিভাগ + মডিউল permission) **backend RPC-তে** enforce হয়। UI-তে মেনু লুকানো শুধু সুবিধার জন্য, security-র জন্য নয়।
- `private.*` schema-র helper গুলো frontend থেকে call করা যায় না (public execute grant নেই)।

### PIN

- `mdr_shared_users.pin` আর `mdr_dars_teachers.pin_hash` দুটোই bcrypt hash (`extensions.crypt`, bf cost 6)। নতুন পিন লিখতে `private.mdr_pin_hash(pin)`।
- **পিন যাচাই সবসময় `private.mdr_pin_ok(stored, input, target)` দিয়ে**, কখনো `pin = p_pin` নয়। `target` হলো user id (সাধারণত `p_actor_id::text`), আর দরস শিক্ষকের ক্ষেত্রে `'dars:' || id`।
- লক: ১৫ মিনিটে একই target-এ ৫টা **আলাদা** ভুল পিন এলে ১৫ মিনিট লক (`private.mdr_pin_failures`)। একই ভুল পিন বারবার এলে একবারই গোনা হয়, যাতে পুরনো পিন নিয়ে পড়ে থাকা ফোন মালিককে লক না করে। লক থাকলে `pin_locked` exception ওঠে, আর `api-shared.js`-এর `rpc()` সেটাকে `{ok:false, error:'pin_locked'}` বানায়।
- পিন কোনো RPC ফেরত দেয় না (`has_pin` দেয়)। ইউজার এডিটে পিন খালি পাঠালে আগের পিন থাকে।
- লক ছাড়াতে বা পিন রিসেট করতে: `20261001120000_mdr_pin_hash_lockout.sql`-এর header দেখুন।
- **সেশন টোকেন** (`20261010120000_mdr_session_tokens.sql`): লগইনের পর `mm-session.js` `mdr_rel_session_issue` দিয়ে টোকেন (`mdrs1.…`) নেয় আর আসল পিনের জায়গায় সেটা রাখে। RPC-র `p_pin`-এ টোকেনই যায়; `private.mdr_pin_ok` টোকেন চেনে, তাই RPC signature বদলায়নি। আসল পিনও এখনো চলে (পুরনো ডিভাইস পরের লোডে নিজে টোকেনে বদলায়)।
  - টোকেনের শুধু sha256 থাকে `private.mdr_sessions`-এ। পিন বদলালে (hash fingerprint মেলে না), logout-এ (`mdr_rel_session_end`), জিম্মাদারের «সব ডিভাইস থেকে লগআউট»-এ (`mdr_rel_admin_revoke_user_sessions`) বা ১৮০ দিন অব্যবহারে টোকেন বাতিল।
  - টোকেনে ভুল-পিন লক গোনা হয় না। দরস কিয়স্কের (`dars:` target) টোকেন নেই।
  - টোকেন দিয়ে করা RPC `ok:false` দিলে `api-shared.js` → `MMSession.checkSessionToken()` `mdr_rel_session_status` দেখে; বাতিল হলে লগইন পেজে পাঠায়।
  - নতুন কোডে পিন localStorage-এ লিখবেন না; সবসময় `MMSession.getPin()` / `getAdminPin()` থেকে যা আছে সেটাই RPC-তে পাঠান।
- Frontend-এ শুধু publishable/anon key থাকে। service-role key থাকে শুধু Edge Function/Vercel env-এ।

### Migrations

- `supabase/migrations/` হলো **একমাত্র** migration source (timestamped নাম)।
- `_archive/legacy-migrations/`-এ আছে পুরনো numbered migration, শুধু reference-এর জন্য।
- RPC-র নাম বা parameter বদলালে একই সাথে frontend wrapper (`api-shared.js` / `api-mdr.js` / sync file) আপডেট করতে হবে।

## Roles

| Role | লগইন | মূল পেজ |
| --- | --- | --- |
| জিম্মাদার (admin) | অ্যাডমিন PIN | `/admin/madrasa.html` (subdomain `admin.idarah786.com` → `/admin/`) |
| সহকারী জিম্মাদার (restricted admin) | লগইন আইডি + PIN | একই admin পেজ, permission অনুযায়ী সীমিত |
| দফতর | আইডি + PIN | `/madrasa/madrasa-home.html`, `madrasa-daftar.html` |
| বর্ষ দায়িত্বশীল (teacher) | আইডি + PIN | `/madrasa/madrasa-class.html` |
| হিফজ / মাকতাবা / পুরনো ছাত্র | আইডি + PIN | `madrasa-hifz.html` / `madrasa-library.html` / `madrasa-alumni.html` |
| খেদমত | আইডি + PIN | `/khedmat/khedmat-staff.html` |
| বিভাগ | বিভাগ + PIN | `/dept/dept-staff.html` |

কিছু business rule কোডে enforce হয়, এগুলো user manual-এও লেখা আছে:
- দফতরের হাজিরা বাকি থাকলে অন্য মেনু বন্ধ থাকে (`mdr-daftar-attendance-gate.js`)।
- বর্ষ দায়িত্বশীলের কাজ বাকি থাকলে (কিতাব ৭ দিন, খুলুক ৩০ দিন, লগ ১৫ দিন) অন্য মেনু বন্ধ থাকে (`mdr-class-duty-gate.js`, `mdr-class-duty-alerts.js`)।
- বিভাগ লেনদেন ২৪ ঘণ্টা পর্যন্ত সরাসরি এডিট করা যায়, তারপর edit request লাগে (`dept-staff.html` → `canDirectModify`)।

## Build ও deploy

- `build.js`: `app/` থেকে `['css','js','madrasa','dept','khedmat','admin','icons']` আর root HTML কপি করে `public/`-এ রাখে, `?v=` cache-bust যোগ করে, আর প্রতিটা HTML-এ depth অনুযায়ী boot script inject করে (`mm-boot`, `mm-push`, `app-update`, `mm-install`, `mm-back`)। `supabase-config.js` তৈরি হয় env থেকে।
- `vercel.json`: output `public/`, admin subdomain redirect, পুরনো `main-admin-*` / `mdr-admin-*` URL-এর redirect, আর HTML-এ no-cache header।
- `api/admin-assistant.js`: Vercel serverless function (AI সহকারী)। Gemini API ব্যবহার করে এবং শুধু read-only RPC (`mdr_admin_ai_*`) দিয়ে DB পড়ে।
- `app/prototype/` gitignored, deploy হয় না।

## Frontend conventions

- User-facing text বাংলায়। তারিখ DB-তে ISO (খ্রিস্টাব্দ), UI-তে হিজরী আগে দেখায় (`mm-hijri.js`, `hijri-utils.js`)।
- User data render করার সময় escape করতে হবে (`API.esc` / page-এর `esc` helper)।
- Mobile-first layout: বেশিরভাগ দায়িত্বশীল ফোন থেকে ব্যবহার করেন।
- Desktop (≥1024px): নেভ থাকা পেজে `js/core/mm-shell.js` `html.mm-desk-shell` দেয়; তখন নিচের নেভ বাঁ পাশের sidebar হয় আর কনটেন্ট `--desk-max` পর্যন্ত চওড়া হয়। পেজভেদে ডেস্কটপ layout সেই পেজের CSS-এ `@media (min-width: 1024px)`-এ লিখুন। কনটেন্টের প্রস্থ inline style-এ না দিয়ে `.content-520/640/760` class ব্যবহার করুন, আর ছোট dialog-এ `.modal-md/sm/xs`।
- রং ও motion: `style.css`-এর `:root` token ব্যবহার করুন, নতুন hex ছড়াবেন না। নির্বাচিত ট্যাব/চিপ/অ্যাভাটার = `--sel-bg` / `--sel-fg` / `--sel-line` (হালকা মধুরঙা tint — আগের মতো গাঢ় কালি + সোনালি লেখা নয়), টেবিল হেডার = `--thead-bg` / `--thead-fg`, hairline = `--line`, ছায়া = `--shadow` / `--shadow-md`, motion = `--ease-out` / `--dur`। হলুদ-সোনালি লেখা দরকার হলে `--gold-deep` (পড়ার মতো contrast)। `prefers-reduced-motion`-এ সব animation বন্ধ হয়।
- উপরের বার: বাঁ কোণে শিক্ষাবর্ষ (ছোট), মাঝে `.topbar-role`-এর লেখা (বড়) — `js/core/mm-boot.js`-এর `mmTopbarYearCss()` প্রথম paint-এর আগেই CSS বসায় (`localStorage.mm_settings.hijri_year` থেকে); `mm-session.js`-এ একই function বছর বদলালে style হালনাগাদ করে (দুই জায়গার কপি মিল রাখুন)। JS দিয়ে লেখা সরানো হয় না, তাই পেজ পরে `.topbar-role`-এ নাম লিখলেও মাঝে দেখায়।
- মেনু বদলের গতি: `js/core/mm-shell.js` লিংকে hover/touch হলেই পরের পেজের HTML আগেভাগে আনে (Speculation Rules **prefetch** — prerender নয়, তাই পরের পেজের JS/RPC আগে চলে না)। `<a href="*.html">` আর `onclick="location.href='…html'"` দুটোই কাজ করে; কোনো লিংকে না চাইলে `data-no-prefetch` দিন। মেনুতে ক্লিকে বর্তমান কনটেন্ট (নেভ বাদে) ১৮০ms-এ মিলিয়ে যায় (`html.mm-leaving`), তারপর পরের পেজ ২৮০ms-এ ফুটে ওঠে — নতুন নেভ/মেনু কোডে `location.href` না লিখে `MMNav.go(href)` (admin নেভে `{ replace: true }`) ব্যবহার করুন; নেভের ভেতরের `<a href>` স্বয়ংক্রিয়ভাবে এটা পায়, না চাইলে `data-no-fade`। পেজে entry animation শুধু body-র সরাসরি child-এ, `:where()` দিয়ে, যাতে কোনো component-এর নিজের animation/transition ঢাকা না পড়ে; loading cover সরলে `html.mm-app-reveal` fade, আর loading spinner ৩৫০ms-এর আগে দেখা যায় না। Cross-document View Transition ইচ্ছা করে বন্ধ (কারণ `main-admin-nav.css`-এ লেখা)।
- Admin পেজে navigation link absolute path হবে। কারণ ও path বদলানোর নিয়ম: [code-map.md](code-map.md#path-বা-নাম-বদলানোর-আগে)।
