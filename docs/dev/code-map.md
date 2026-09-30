# AGENTS_MAP — কোথায় কী আছে

> এই repo-তে কাজ শুরুর আগে এক নজরে দেখে নাও কোন কাজের কোড কোথায়।
> বিস্তারিত নিয়ম: `CLAUDE.md` • behavior: `USER_MANUAL.md` • reorg ইতিহাস: `REORG_PLAN.md`

> **সব deployable frontend source `app/` এর নিচে।** `build.js` `app/`-এর ভেতরটা `public/`-এ কপি
> করে, তাই `app/admin/madrasa.html` সার্ভ হয় `/admin/madrasa.html` URL-এ (নিচের path গুলো source path)।
> Backend/config/native/docs `app/`-এর বাইরে root-এ আলাদা।

## এক নজরে — কাজ → ফাইল (source path)

| কাজ | HTML | JS |
|-----|------|----|
| Login hub / entry | `app/index.html`, `app/chat.html` | `app/js/core/` |
| Admin hub (subdomain `admin.idarah786.com`) | `app/admin/` (`index.html`, `madrasa.html`, `dept.html`, `khedmat.html`, `recent.html`) | `app/js/shared/admin-nav.js`, `app/js/shared/admin-recent-feed.js` |
| মাদরাসা — staff UI | `app/madrasa/madrasa-*.html` | `app/js/madrasa/madrasa-*.js`, `mdr-*.js` |
| মাদরাসা — admin UI | `app/madrasa/admin/*.html` (জিম্মাদার view) | `app/js/madrasa/mdr-*.js` |
| শিক্ষক হাজিরা (দরস কিয়স্ক) | `app/madrasa/madrasa-teacher-hazira.html` (কিয়স্ক), `app/madrasa/admin/teacher-hazira.html` (জিম্মাদার); হোম কার্ড `#hz-home-card` → `madrasa-class.html`; CSS `app/css/teacher-hazira.css` | `app/js/madrasa/mdr-teacher-hazira-{core,kiosk,card,admin}.js`; দরস-শিক্ষক বাছাই `mdr-class-routine.js`; RPC `mdr_rel_dars_*` → `supabase/migrations/20260930120000_mdr_teacher_hazira.sql` |
| বিভাগ (Department) | `app/dept/*.html` | `app/js/dept/` |
| খেদমত (Khedmat) | `app/khedmat/*.html` | `app/js/khedmat/` |

## `app/js/` ফোল্ডার মানচিত্র

- **`app/js/core/`** — app-wide foundation: `mm-session` (auth/session), `mm-boot`,
  `mm-permissions`, `mm-push`, `mm-install`, `app-update`,
  `mm-hijri` / `hijri-utils` (তারিখ), `monitor-mode`, `mm-sample-data`।
- **`app/js/api/`** — Supabase data layer (RPC wrapper): `api-shared.js`, `api-mdr.js`, `api.js`।
  > RPC নাম পাল্টালে এখানকার wrapper **আর** `supabase/migrations/` একসাথে আপডেট করতে হবে।
- **`app/js/shared/`** — cross-module UI/helper: `admin-nav`, `admin-recent-feed`,
  `chat-api`, `chat-staff-nav`, `daftar-bottom-nav`, `alumni-integration`,
  `mm-student-modal`, `mm-teacher-modal`, `mam-overlay`।
- **`app/js/madrasa/`** — মাদরাসার সব feature: `madrasa-*` (accounts, attendance, exams,
  kormosuchi, print, daftar) + `mdr-*` (supabase sync, daftar, exams, khadimin,
  dastarkhan, home-panels) + `mm-old-madrasa-import-data`।
- **`app/js/dept/`** — `dept-api`, `dept-supabase-sync`, `dept-units`।
- **`app/js/khedmat/`** — `khedmat-api`।

## Backend / build

- **DB পরিবর্তন** → `supabase/migrations/` (timestamped, **একমাত্র** migration source)।
  পুরনো numbered migrations শুধু reference হিসেবে `_archive/legacy-migrations/`-এ।
- **Edge function** → `supabase/functions/send-admin-push/`।
- **Build/deploy** → `build.js` (static copy + `?v=` cache-bust + script inject),
  `vercel.json`। Output → `public/` (gitignored)। App **PWA-only** (Capacitor/Android সরানো হয়েছে)।
- **Dev/data scripts** → `scripts/`।

## জরুরি নিয়ম (CLAUDE.md থেকে সংক্ষেপে)

- পুরনো Waqf tables (`waqf_*`) ছোঁয়া যাবে না; এই app-এর tables `mdr_*`/`mdr_dept_*`/`mdr_khedmat_*`/`mdr_shared_*`।
- Frontend-এ service-role key/secret রাখা যাবে না; RLS deny-all + RPC pattern বজায়।
- User-facing text বাংলায়; user data render-এ safe escaping।
- নতুন write-side `localStorage` fallback যোগ করা যাবে না।

## Build constraint (path move করার আগে পড়ো)

`build.js` `app/` এর ভেতর থেকে `['css','js','madrasa','dept','khedmat','admin','icons']` folder +
`app/*.html` recursive copy করে `public/`-এ, এবং প্রতিটা HTML-এ depth অনুযায়ী `../` সহ boot script
inject করে (nested subfolder যেমন `app/madrasa/admin/` সাপোর্টেড)। `app/js/`-এর **ভেতরে** subfolder
নিরাপদ, কিন্তু কোনো top-level folder rename/HTML নাম পরিবর্তন করলে `build.js` (`SRC`/`dirs`) + প্রতিটা
HTML reference + `vercel.json` redirect একসাথে আপডেট করতে হবে।

**Nav convention:** `admin/*.html` (hub) আর `madrasa/admin/*.html` পেজে **navigation link
absolute path** দিয়ে হয় (`/admin/madrasa.html`, `/madrasa/admin/students.html`) — এতে depth আর
`mm-session.js`-এর `a[href*="..."]` restricted-admin selector দুটোই page-location নির্বিশেষে কাজ করে।
পুরনো `main-admin-*.html` / `mdr-admin-*.html` URL-গুলো `vercel.json`-এ redirect করা আছে।
