# Code map — কোথায় কী আছে

কোন কাজের কোড কোথায় আছে, তা এক নজরে। নিয়ম: [`CLAUDE.md`](../../CLAUDE.md) • গঠন ও DB: [architecture.md](architecture.md) • user-facing behavior: [user manual](../user-manual/README.md)

> **সব deployable frontend source আছে `app/`-এর নিচে।** `build.js` এগুলো `public/`-এ কপি করে, তাই `app/admin/madrasa.html` serve হয় `/admin/madrasa.html` URL-এ। নিচের path গুলো source path।

## কাজ → ফাইল

| কাজ | HTML | JS / অন্যান্য |
|-----|------|----|
| Login hub / role বাছাই | `app/index.html` | `app/js/core/mm-session.js` |
| বার্তা (staff ↔ জিম্মাদার) | `app/chat.html` | `app/js/shared/chat-api.js`, `chat-staff-nav.js` |
| Admin hub (subdomain `admin.idarah786.com`) | `app/admin/` (`index`, `madrasa`, `dept`, `khedmat`, `recent`) | `app/js/shared/admin-nav.js`, `admin-recent-feed.js` |
| AI সহকারী | `app/admin/assistant.html` | `app/js/shared/admin-assistant.js` → `api/admin-assistant.js` (Vercel function) → RPC `mdr_admin_ai_*` |
| মাদরাসা — staff UI | `app/madrasa/madrasa-*.html` | `app/js/madrasa/madrasa-*.js`, `mdr-*.js` |
| মাদরাসা — জিম্মাদার UI | `app/madrasa/admin/*.html` | `app/js/madrasa/mdr-*.js` |
| দফতর হাজিরা + বাকি-হাজিরা lock | `madrasa-daftar.html` | `app/js/pages/madrasa-daftar.js` + `mdr-daftar-attendance-gate.js` |
| দফতর হিসাব / Excel import | `madrasa-daftar.html`, `madrasa/admin/accounts.html` | `madrasa-daftar-accounts.js`, `madrasa-accounts-api.js`, `madrasa-accounts-reports.js` |
| কর্মসূচি | `madrasa-kormosuchi.html`, `madrasa/admin/kormosuchi.html` | `madrasa-kormosuchi.js` |
| খাদিমিন, দফতর হোম প্যানেল | `madrasa-home.html` | `mdr-home-panels.js`, `mdr-khadimin-supabase.js`, `mdr-daftar-notes.js` |
| দস্তরখান | `madrasa-home.html` | `mdr-dastarkhan.js` |
| বর্ষ ড্যাশবোর্ড + বাকি-দায়িত্ব lock | `madrasa-class.html` | `app/js/pages/madrasa-class.js`, `mdr-class-duty-gate.js`, `mdr-class-duty-alerts.js` |
| নিজাম (রুটিন) | `madrasa-class.html`, `madrasa/admin/schedule.html` | `mdr-class-routine.js` |
| শিক্ষক হাজিরা (দরস কিয়স্ক) | `madrasa-teacher-hazira.html` (কিয়স্ক), `madrasa/admin/teacher-hazira.html`; হোম কার্ড `#hz-home-card` আছে `madrasa-class.html`-এ; CSS `app/css/teacher-hazira.css` | `mdr-teacher-hazira-{core,kiosk,card,admin}.js`; RPC `mdr_rel_dars_*` → `20260930120000_mdr_teacher_hazira.sql` |
| পরীক্ষা | `madrasa-class-exams.html`, `madrasa-exams.html`, `madrasa/admin/exams.html` | `mdr-exams-supabase.js`, `madrasa-exams-analytics.js` |
| ছাত্রের বিবরণ modal, ছবি, ডকুমেন্ট | (সব পেজে shared) | `app/js/shared/mm-student-modal.js`, `mm-student-documents.js` |
| শিক্ষকের বিবরণ modal | (shared) | `app/js/shared/mm-teacher-modal.js` |
| পুরনো ছাত্র | `madrasa-alumni.html`, `madrasa/admin/alumni.html` | `app/js/shared/alumni-integration.js` |
| বর্ষ উন্নীতকরণ | `madrasa-yearend.html` | (page inline) + `mdr-daftar-supabase.js` |
| সেটিংস, সহকারী জিম্মাদার permission, ইউজার ও পিন | `madrasa-settings.html` | `app/js/pages/madrasa-settings.js` + `mdr-supabase-sync.js`; enforce হয় `mm-session.js` + RPC-তে |
| পুরনো ছাত্র import যাচাই | `mdr-import-review.html` | RPC (`mdr_student_import_candidates`) |
| বিভাগ (Department) | `app/dept/dept-index.html` (লগইন), `dept-staff.html` (পোর্টাল), `app/admin/dept.html` | `app/js/dept/`, `app/js/pages/dept-staff.js` |
| খেদমত (Khedmat) | `app/khedmat/khedmat-staff.html`, `khedmat-admin.html`, `app/admin/khedmat.html` | `app/js/khedmat/khedmat-api.js`, `app/js/pages/khedmat-staff.js` |
| জিম্মাদার হোম (মাদ্রাসা) | `app/admin/madrasa.html` | `app/js/pages/admin-madrasa.js`, `mdr-home-panels.js` |
| পিন যাচাই ও লক | — | DB: `private.mdr_pin_ok` / `mdr_pin_hash` (`20261001120000_mdr_pin_hash_lockout.sql`); frontend: `api-shared.js` `rpc()` → `{ok:false, error:'pin_locked'}` |
| Push notification | — | `app/js/core/mm-push.js` → `supabase/functions/send-admin-push/` |

## `app/js/` ফোল্ডার

- **`core/`**: app-wide foundation। এতে আছে `mm-session` (auth/session, restricted-admin nav hide), `mm-boot`, `mm-permissions`, `mm-push`, `mm-install`, `app-update`, `mm-hijri` / `hijri-utils` (তারিখ), `monitor-mode` (stub)।
- **`api/`**: Supabase RPC wrapper, অর্থাৎ `api-shared.js`, `api-mdr.js`, `api.js`। RPC নাম বদলালে এখানকার wrapper আর `supabase/migrations/` একসাথে আপডেট করতে হবে।
- **`shared/`**: একাধিক module-এ ব্যবহৃত UI/helper।
- **`madrasa/`**: মাদরাসার সব feature। `madrasa-*` গুলো পুরনো feature file, `mdr-*` গুলো Supabase-যুগের file।
- **`dept/`**: `dept-api`, `dept-supabase-sync`, `dept-units`।
- **`khedmat/`**: `khedmat-api`।
- **`pages/`**: একটি নির্দিষ্ট পেজের নিজস্ব script (আগে HTML-এর ভেতরে inline ছিল)। পেজের CSS আছে `app/css/pages/`-এ। নতুন বড় পেজ-কোড HTML-এ inline না লিখে এখানে রাখুন: HTML no-cache, কিন্তু `js/`/`css/` ফাইল ১ বছর cache হয়।

## Repo root

| পথ | কী |
| --- | --- |
| `supabase/migrations/` | DB migration, **একমাত্র** source |
| `supabase/functions/send-admin-push/` | Web Push Edge Function |
| `api/` | Vercel serverless function (AI সহকারী) |
| `build.js`, `vercel.json` | build ও deploy |
| `scripts/` | এককালীন data/debug script |
| `_archive/` | legacy migration আর পুরনো কোড, শুধু reference-এর জন্য |
| `app/prototype/` | UI prototype (gitignored, deploy হয় না) |
| `docs/` | এই documentation |

## Path বা নাম বদলানোর আগে

`build.js` `app/`-এর ভেতর থেকে `['css','js','madrasa','dept','khedmat','admin','icons']` folder আর `app/*.html` কপি করে `public/`-এ, এবং প্রতিটা HTML-এ depth অনুযায়ী `../` সহ boot script inject করে (nested folder যেমন `app/madrasa/admin/` সাপোর্টেড)।

- `app/js/`-এর **ভেতরে** নতুন subfolder বানানো নিরাপদ।
- কোনো top-level folder rename বা HTML-এর নাম বদলালে একসাথে আপডেট করতে হবে: `build.js` (`SRC`/`dirs`), প্রতিটা HTML reference, আর `vercel.json` redirect।

**Nav convention:** `admin/*.html` আর `madrasa/admin/*.html` পেজে navigation link হবে **absolute path** (`/admin/madrasa.html`, `/madrasa/admin/students.html`)। এতে depth-এর ঝামেলা থাকে না, আর `mm-session.js`-এর `a[href*="..."]` restricted-admin selector সব জায়গায় কাজ করে। পুরনো `main-admin-*.html` / `mdr-admin-*.html` URL গুলো `vercel.json`-এ redirect করা আছে।
