# Agent Instructions

এই repo-তে কাজ করা AI agent-এর জন্য নিয়ম। কাজ শুরুর আগে দরকার অনুযায়ী পড়বে:

- কোন কাজের কোড কোথায়: `docs/dev/code-map.md`
- গঠন, DB prefix, security pattern, build: `docs/dev/architecture.md`
- চালানো ও check: `docs/dev/local-setup.md`
- User-facing behavior: `docs/user-manual/`

## Critical Boundaries

- Existing Waqf app/repo/data স্পর্শ করা যাবে না।
- একই Supabase project-এ অন্য অ্যাপের tables আছে। এগুলো কখনো স্পর্শ করবে না:
  - `waqf_*`: `waqf_students`, `waqf_messages`, `waqf_tasks`, `waqf_task_assignments`, `waqf_goals`, `waqf_quizzes`, `waqf_quiz_questions`, `waqf_quiz_assignees`, `waqf_quiz_submissions`, `waqf_documents`, `waqf_academic_history`, `waqf_teacher_notes`, `waqf_pwa_subscriptions`, `waqf_madrasa_config`, `waqf_app_kv`, `waqf_diary`, `waqf_student_groups`, `waqf_daily_schedule_rows`, `waqf_daily_schedule_proposals`, `waqf_task_completions`, `waqf_device_push_tokens`
  - `nt_*` (notes app)
- এই app-এর tables সব `mdr_*` দিয়ে শুরু হবে: `mdr_*` (মাদরাসা), `mdr_dept_*`, `mdr_khedmat_*`, `mdr_shared_*`।
- Frontend-এ service-role key, secret, private token বা admin credential রাখা যাবে না।

## Source Of Truth

- Current app behavior Supabase/RPC-backed ধরে কাজ করবে।
- পুরনো local prototype code থাকতে পারে, কিন্তু নতুন write-side `localStorage` fallback যোগ করবে না, যদি user explicitly temporary prototype না চান।
- Database change লাগলে `supabase/migrations/`-এ migration লিখবে এবং frontend wrapper/RPC call একসাথে মিলিয়ে দেবে।
- Tables সরাসরি open access করবে না; RLS deny-all + controlled RPC pattern বজায় রাখবে।

## Frontend Rules

- Vanilla HTML/CSS/JS বজায় রাখবে। Framework/bundler যোগ করবে না।
- Existing UI pattern, Bangla wording, modal/navigation style অনুসরণ করবে।
- User-facing text বাংলায় রাখবে।
- Repeated shared behavior হলে existing helper আগে খুঁজবে: `app/js/core/mm-session.js`, `app/js/api/api-shared.js`, `app/js/api/api-mdr.js`, `app/js/<module>/*-supabase-sync.js`.
- User data render করলে escaping/safe rendering ব্যবহার করবে; raw HTML injection এড়াবে।
- Mobile layout ভাঙে কিনা খেয়াল করবে, কারণ app-এর অনেক কাজ mobile-first.
- Folder/HTML rename করার আগে `docs/dev/code-map.md` → "Path বা নাম বদলানোর আগে" পড়বে।

## Supabase Rules

- RPC নাম, parameter এবং frontend wrapper একই সাথে update করবে।
- `private.*` helper public execute grant পাবে না।
- Destructive SQL (`DELETE`, `DROP`, `TRUNCATE`, broad `UPDATE`) user approval ছাড়া চালাবে না।
- Existing data migration করলে rollback/verification ভাববে এবং summary-তে risk বলবে।
- Admin/restricted-admin permission scope backend RPC-তে enforce করবে, শুধু UI hide করে security ধরে নেবে না।

## Documentation Rules

- User-visible feature বা behavior বদলালে একই কাজে সংশ্লিষ্ট `docs/user-manual/*.md` আপডেট করবে (বাংলায়, non-technical ভাষায়, UI-র আসল লেবেল ব্যবহার করে)।
- নতুন file/module যোগ বা সরালে `docs/dev/code-map.md` আপডেট করবে।
- DB prefix, security pattern, build বা deploy বদলালে `docs/dev/architecture.md` আপডেট করবে।
- একই তথ্য দুই জায়গায় লিখবে না; অন্য doc থেকে লিংক দেবে।

## Git And Workspace Rules

- User না বললে `git commit`, `git push`, `git reset --hard`, `git checkout --` চালাবে না।
- Dirty worktree স্বাভাবিক ধরে কাজ করবে; নিজের নয় এমন change revert করবে না।
- Unrelated file touch করবে না।
- Manual edits `apply_patch` দিয়ে করবে।
- Search/read করতে `rg` এবং parallel reads ব্যবহার করবে।

## Verification

কাজের ধরন অনুযায়ী অন্তত একটি relevant check চালাবে:

- JS edit: `node --check path/to/file.js`.
- Repo-level sanity: `npm run build`.
- Supabase/RPC edit: migration/RPC signature review, এবং সম্ভব হলে live RPC smoke test.
- UI edit: browser/rendered behavior check করা ভালো, বিশেষ করে modal, navigation, mobile layout, student/account/department flows.

Final response-এ সংক্ষেপে বলবে:

- কী পরিবর্তন হয়েছে।
- কোন file touch হয়েছে।
- কী verify করা হয়েছে বা করা যায়নি।
