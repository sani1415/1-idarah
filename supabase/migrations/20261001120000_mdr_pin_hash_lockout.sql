-- পিন নিরাপত্তা: bcrypt hash + ভুল পিনে লক (১৫ মিনিটে ৫টি আলাদা ভুল পিন → ১৫ মিনিট লক)
--
-- কী বদলাল:
--   1) public.mdr_shared_users.pin এখন bcrypt hash (extensions.crypt, bf cost 6 — দরস শিক্ষকের
--      pin_hash-এর মতোই)। সব বিদ্যমান পিন এই migration-এ hash হয়।
--   2) সব পিন-যাচাই এখন private.mdr_pin_ok() দিয়ে — hash মেলায় ও ভুল চেষ্টা গোনে।
--      লক থাকলে 'pin_locked' exception তোলে; frontend rpc() wrapper এটাকে
--      {ok:false, error:'pin_locked'} বানায়।
--   3) একই ভুল পিন বারবার এলে একবারই গোনা হয় — পুরনো পিন নিয়ে লগইন থাকা ফোনের background
--      call মালিককে লক করে না; brute-force-এ প্রতিবার আলাদা পিন লাগে, তাই ৫ বারেই আটকে যায়।
--      অ্যাডমিন লগইন শুধু পিনে হয়, তাই ৫টি আলাদা ভুল পিনে সব অ্যাডমিন একসাথে লক হন।
--   4) অ্যাডমিন/ইউজার তালিকা আর পিন ফেরত দেয় না ('has_pin' দেয়)। ইউজার এডিটে পিন খালি রাখলে
--      আগের পিন থাকে। বিভাগ তালিকা থেকে 'head_pin' সরানো হয়েছে।
--   5) দরস কিয়স্কের পিনেও (দায়িত্বশীল ও দরস শিক্ষক) একই লক প্রযোজ্য।
--   6) private.mdr_dars_teacher_actor: STABLE → VOLATILE (ভুল-চেষ্টা লেখার জন্য)।
--   7) private.verify_teacher_pin (Waqf app) স্পর্শ করা হয়নি।
--
-- কীভাবে প্রয়োগ হয়:
--   * পুরো migration একটাই DO block — মাঝপথে কিছু ব্যর্থ হলে কিছুই প্রযোজ্য হয় না (পিন hash হলো
--     কিন্তু function বদলাল না — এমন অবস্থা হতে পারে না)।
--   * ৭৬টি function-এর live definition থেকে শুধু পিন-অংশ ([পুরনো, নতুন] জোড়া) প্রতিস্থাপন হয়;
--     প্রতিটার ফলাফলের md5 রিভিউ-করা সংস্করণের সাথে মিলতে হবে।
--   * শেষে স্ব-পরীক্ষা (savepoint-এ; পরীক্ষার সব পরিবর্তন বাতিল হয়) — লগইন, লক, ইউজার এডিট,
--     পিন বদল, তালিকায় পিন না থাকা, এবং প্রতিটি পরিবর্তিত function একবার চালানো। কোনো পরীক্ষা
--     ব্যর্থ হলে পুরো migration বাতিল।
--
-- Rollback: plaintext পিন ফেরত আনা সম্ভব নয় (এটাই উদ্দেশ্য)। কেউ লগইন করতে না পারলে:
--   update public.mdr_shared_users set pin = private.mdr_pin_hash('নতুন৪অঙ্ক') where id = '<user id>';
-- লক ছাড়াতে:
--   delete from private.mdr_pin_failures where target = '<user id>';

do $migration$
begin

-- ── plaintext snapshot — শুধু এই session-এর temp table-এ, শেষে drop (স্ব-পরীক্ষা T1-এর জন্য)
execute 'create temp table _mdr_pins_before as select id, pin from public.mdr_shared_users';

-- ── ভুল-চেষ্টার হিসাব
create table if not exists private.mdr_pin_failures (
  target text not null,          -- user id, বা 'dars:<dars_teacher_id>'
  fp text not null,              -- sha256(target:ভুল পিন) — একই ভুল পিন একবারই গোনা হয়
  txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (target, fp)
);
create index if not exists mdr_pin_failures_target_time_idx on private.mdr_pin_failures (target, created_at);
alter table private.mdr_pin_failures enable row level security;
revoke all on table private.mdr_pin_failures from public, anon, authenticated;

-- ── hash helper
execute $h$
create or replace function private.mdr_pin_hash(p_pin text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 6));
$$
$h$;

-- ── যাচাই + লক helper
execute $h$
create or replace function private.mdr_pin_ok(p_stored text, p_input text, p_target text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
cost 10000
as $$
declare
  v_fp text;
begin
  if p_stored is null or p_input is null or p_input = '' then
    return false;
  end if;
  if p_stored !~ '^\$2[abxy]?\$' then
    return false;
  end if;

  if p_target is not null and (
    select count(*) from private.mdr_pin_failures f
    where f.target = p_target and f.created_at > now() - interval '15 minutes'
  ) >= 5 then
    raise exception 'pin_locked' using errcode = 'P0001', hint = 'অনেকবার ভুল পিন — ১৫ মিনিট পরে চেষ্টা করুন';
  end if;

  if p_stored = extensions.crypt(p_input, p_stored) then
    -- সফল: এই target-এর ভুল-গণনা মুছে দাও, আর এই request-এ অন্য row-এর (যেমন একাধিক অ্যাডমিন
    -- স্ক্যান) অমিলকে ভুল হিসেবে গোনা বাতিল করো; সাথে ১ দিনের পুরনো রেকর্ড পরিষ্কার।
    delete from private.mdr_pin_failures f
    where f.target = p_target
       or f.txid = txid_current()
       or f.created_at < now() - interval '1 day';
    perform set_config('mdr.pin_matched', '1', true);
    return true;
  end if;

  if p_target is not null and coalesce(current_setting('mdr.pin_matched', true), '') <> '1' then
    v_fp := encode(extensions.digest(p_target || ':' || p_input, 'sha256'), 'hex');
    insert into private.mdr_pin_failures (target, fp, txid, created_at)
    values (p_target, v_fp, txid_current(), now())
    on conflict (target, fp) do update
      set created_at = excluded.created_at, txid = excluded.txid;
  end if;
  return false;
end;
$$
$h$;
revoke all on function private.mdr_pin_hash(text) from public, anon, authenticated;
revoke all on function private.mdr_pin_ok(text, text, text) from public, anon, authenticated;

-- ── বিদ্যমান plaintext পিন → bcrypt (idempotent)
update public.mdr_shared_users
set pin = private.mdr_pin_hash(pin)
where pin is not null and pin !~ '^\$2[abxy]?\$';

-- ── function patcher: live definition নিয়ে নির্দিষ্ট অংশ প্রতিস্থাপন করে; ফলাফলের md5
--    রিভিউ-করা সংস্করণের সাথে না মিললে (মাঝে কেউ function বদলালে) পুরো migration বাতিল।
execute $h$
create function pg_temp.mdr_patch_fn(p_schema text, p_name text, p_args text, p_ops jsonb, p_md5 text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_def text;
  v_op jsonb;
  v_pos int;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = p_schema and p.proname = p_name
    and pg_get_function_identity_arguments(p.oid) = p_args;
  if v_oid is null then
    raise exception 'mdr_patch_fn: %.%(%) পাওয়া যায়নি', p_schema, p_name, p_args;
  end if;
  v_def := pg_get_functiondef(v_oid);
  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_pos := strpos(v_def, v_op ->> 0);
    if v_pos = 0 then
      raise exception 'mdr_patch_fn: %.% — অংশ পাওয়া যায়নি: %', p_schema, p_name, v_op ->> 0;
    end if;
    v_def := substr(v_def, 1, v_pos - 1) || (v_op ->> 1) || substr(v_def, v_pos + length(v_op ->> 0));
  end loop;
  if md5(v_def) <> p_md5 then
    raise exception 'mdr_patch_fn: %.% — ফলাফল রিভিউ-করা সংস্করণের সাথে মেলেনি', p_schema, p_name;
  end if;
  execute v_def;
end;
$$
$h$;

-- ── পিন-যাচাইকারী function গুলোতে পরিবর্তন ([পুরনো, নতুন] জোড়া, ক্রমানুসারে)
perform pg_temp.mdr_patch_fn('private', 'dept_authorized_actor', $a$p_actor_id uuid, p_pin text, p_dept_code text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '8addc12de5ff77436c86cfa004e77fe8');
perform pg_temp.mdr_patch_fn('private', 'mdr_account_actor', $a$p_actor_id uuid, p_pin text, p_allow_admin boolean$a$,
  $o$[["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'cd2c3775d95eb7cd293b81dbb706c68f');
perform pg_temp.mdr_patch_fn('private', 'mdr_admin_dashboard_actor', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and u.pin = p_pin\r\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  '94d5b5c9e4d5c599987ca6153afefd43');
perform pg_temp.mdr_patch_fn('private', 'mdr_class_routine_can_read', $a$p_actor_id uuid, p_pin text, p_class_id uuid$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '7c756ab209e7447aa5b9935011bf5b3d');
perform pg_temp.mdr_patch_fn('private', 'mdr_dars_teacher_actor', $a$p_actor_id uuid, p_pin text$a$,
  $o$[[" STABLE SECURITY DEFINER\n", " VOLATILE SECURITY DEFINER\n"], ["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'df7e107cc55ed75e465b3db4ce66ec0e');
perform pg_temp.mdr_patch_fn('private', 'mdr_program_actor', $a$p_actor_id uuid, p_pin text, p_allow_admin boolean$a$,
  $o$[["    and u.pin = p_pin\r\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  '281ff77d7f104ca2d805803589b063cd');
perform pg_temp.mdr_patch_fn('private', 'mdr_resolve_chat_admin', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '004152d5cad13491c81e8713e826dd5e');
perform pg_temp.mdr_patch_fn('private', 'mdr_settings_actor', $a$p_actor_id uuid, p_pin text, p_permission text$a$,
  $o$[["    and u.pin = p_pin\r\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  '16a129d4aa004e00646e0e22a61cfff9');
perform pg_temp.mdr_patch_fn('private', 'mdr_student_doc_daftar_actor', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '688a1939a5892ac39433bd9b7a3d2684');
perform pg_temp.mdr_patch_fn('private', 'mdr_student_doc_view_actor', $a$p_actor_id uuid, p_pin text, p_student_id uuid$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'ca22c603246a2a2d89f201cffc810853');
perform pg_temp.mdr_patch_fn('private', 'verify_admin_pin', $a$p_pin text$a$,
  $o$[["      and u.pin = p_pin\n", "      and private.mdr_pin_ok(u.pin, p_pin, u.id::text)\n"]]$o$::jsonb,
  '1bc46a22170c51e081df670bf99a0576');
perform pg_temp.mdr_patch_fn('private', 'verify_hifz_actor', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    AND u.pin = p_pin\r\n", "    AND private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  'c2d55b323d6bad5aa58c4c63587579e7');
perform pg_temp.mdr_patch_fn('private', 'verify_khedmat_actor', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and u.pin = p_pin\r\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  '56e1badcd23a57635483a0f8ceb042db');
perform pg_temp.mdr_patch_fn('private', 'verify_user_pin', $a$p_user_id uuid, p_pin text$a$,
  $o$[["      and u.pin = p_pin\n", "      and private.mdr_pin_ok(u.pin, p_pin, p_user_id::text)\n"]]$o$::jsonb,
  '1b1d13d6835345fb7bd43eaa39464df6');
perform pg_temp.mdr_patch_fn('public', 'mdr_dept_rel_admin_departments', $a$p_pin text$a$,
  $o$[["          'head_pin', h.pin,\r\n", ""], ["          select u.id, u.name, u.pin, u.login_id\r\n", "          select u.id, u.name, u.login_id\r\n"]]$o$::jsonb,
  'c3a9338698b14bc1081351ae43f3b00e');
perform pg_temp.mdr_patch_fn('public', 'mdr_dept_rel_resolve_edit_request', $a$p_pin text, p_request_id uuid, p_status text$a$,
  $o$[["  where u.is_active = true and u.role = 'admin' and u.pin = p_pin\r\n", "  where u.is_active = true and u.role = 'admin' and private.mdr_pin_ok(u.pin, p_pin, u.id::text)\r\n"]]$o$::jsonb,
  '0454ca2e4fb38567f7f23eb9c1abcd3b');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_absent_summary', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["      and u.pin = p_pin\n", "      and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '9d9da2cc31c37870b5f44d3c5fd953d8');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_ai_query', $a$p_actor_id uuid, p_pin text, p_request jsonb$a$,
  $o$[["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'cfd4c387fbd8a5b91c8f30ae39db460f');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_ai_relational_query', $a$p_actor_id uuid, p_pin text, p_query jsonb$a$,
  $o$[["  where u.id=p_actor_id and u.pin=p_pin and u.is_active=true\n", "  where u.id=p_actor_id and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text) and u.is_active=true\n"]]$o$::jsonb,
  '032a72309df0c9bae5a8471da69d3b1b');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_ai_schema', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["  where u.id=p_actor_id and u.pin=p_pin and u.is_active=true\n", "  where u.id=p_actor_id and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text) and u.is_active=true\n"]]$o$::jsonb,
  '577c433dc19ccd6d65bbf3929842e3a1');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_change_pin', $a$p_current_pin text, p_new_pin text$a$,
  $o$[["  set pin = v_new,\r\n", "  set pin = private.mdr_pin_hash(v_new),\r\n"]]$o$::jsonb,
  'c45abb40f426ef06ea94883c9683c405');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_dars_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and u.pin = p_pin\r\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  'fa526b49a3c60140e0c4027b8e3665ff');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_login', $a$p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, id::text)\n"]]$o$::jsonb,
  'd2e683a2605cc616ab7e9de624abc36f');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_admin_users', $a$p_pin text$a$,
  $o$[["        'pin', u.pin,\n", "        'has_pin', u.pin is not null,\n"]]$o$::jsonb,
  '9cbdd20e05d89417c55bc37ef72b050f');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_alumni_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'cfb79249d57d6a550aecb31c64b0c05b');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_chat_bootstrap', $a$p_actor_id uuid, p_pin text, p_is_admin boolean$a$,
  $o$[["    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and pin = p_pin;\n", "    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  'f497abd4e41c02ddcdf26780715b9c1c');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_chat_mark_read', $a$p_actor_id uuid, p_pin text, p_thread_id text, p_is_admin boolean$a$,
  $o$[["    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and pin = p_pin;\n", "    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  'd598983f836f2bb0079f491e989c7a4a');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_chat_send', $a$p_actor_id uuid, p_pin text, p_thread_id text, p_text text, p_is_admin boolean$a$,
  $o$[["    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and pin = p_pin;\n", "    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  '03eb702e7384424cdec643ce6276aad6');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_chat_send', $a$p_actor_id uuid, p_pin text, p_thread_id text, p_text text, p_is_admin boolean, p_request jsonb$a$,
  $o$[["    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and pin = p_pin;\n", "    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  'b292b79cfa0a11a7518595c29629b4ac');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_chat_unread_count', $a$p_actor_id uuid, p_pin text, p_is_admin boolean$a$,
  $o$[["    where id = p_actor_id and is_active = true and pin = p_pin;\n", "    where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  '4c548f51a4fcae9dad0785cf12aad3c5');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_class_routine_delete', $a$p_actor_id uuid, p_pin text, p_routine_id uuid$a$,
  $o$[["  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and pin=p_pin and role='madrasa_teacher' and class_id is not null;\n", "  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role='madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  '8b5c7b2e8b4057261d4ee3802d01bb29');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_class_routine_get', $a$p_actor_id uuid, p_pin text, p_class_code text, p_routine_id uuid$a$,
  $o$[["  select * into v_teacher from public.mdr_shared_users where id=p_actor_id and is_active=true and pin=p_pin and role='madrasa_teacher' and class_id is not null;\n", "  select * into v_teacher from public.mdr_shared_users where id=p_actor_id and is_active=true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role='madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  'b793b148cadc575b752d076923991ba7');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_class_routine_save', $a$p_actor_id uuid, p_pin text, p_slots jsonb, p_change_note text$a$,
  $o$[["  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and pin=p_pin and role='madrasa_teacher' and class_id is not null;\n", "  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role='madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  'e24d1f0d8752326ee90a630335db6a04');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_class_routine_update', $a$p_actor_id uuid, p_pin text, p_slots jsonb, p_change_note text$a$,
  $o$[["  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and pin=p_pin and role='madrasa_teacher' and class_id is not null;\n", "  select * into v_actor from public.mdr_shared_users where id=p_actor_id and is_active=true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role='madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  '10df5210c4e05f119d723b0f70a3c950');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_daftar_attendance_for_date', $a$p_actor_id uuid, p_pin text, p_date date$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'cd080a59b9928b914f86a49dbd6f5130');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_daftar_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'da3bcfeac7e7c292387ca1df783684e1');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_daftar_notes_delete', $a$p_actor_id uuid, p_pin text, p_id uuid$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '4e28a0bc4bcda56b63093211509d0117');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_daftar_notes_list', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  'dd91ba7c15a67bbeca211e1ec69a8db8');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_daftar_notes_upsert', $a$p_actor_id uuid, p_pin text, p_id uuid, p_text text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  'dcdf098f32690b83505df0df9d2b6a59');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_dars_end', $a$p_actor_id uuid, p_pin text, p_start_min integer, p_teacher_pin text$a$,
  $o$[["      and v_hash = extensions.crypt(p_teacher_pin, v_hash);\n", "      and private.mdr_pin_ok(v_hash, p_teacher_pin, 'dars:' || v_ses.dars_teacher_id::text);\n"], ["    v_pin_ok := v_lead_pin is not null and coalesce(p_teacher_pin, '') <> '' and p_teacher_pin = v_lead_pin;\n", "    v_pin_ok := v_lead_pin is not null and coalesce(p_teacher_pin, '') <> '' and private.mdr_pin_ok(v_lead_pin, p_teacher_pin, v_ses.teacher_user_id::text);\n"]]$o$::jsonb,
  'f0e453def6fb56ed32c25411b87a3e1f');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_dars_start', $a$p_actor_id uuid, p_pin text, p_start_min integer, p_teacher_pin text, p_close_prev boolean$a$,
  $o$[["      and v_dt_hash = extensions.crypt(p_teacher_pin, v_dt_hash);\n", "      and private.mdr_pin_ok(v_dt_hash, p_teacher_pin, 'dars:' || v_dt_id::text);\n"], ["    v_pin_ok := coalesce(p_teacher_pin, '') <> '' and p_teacher_pin = v_actor.pin;\n", "    v_pin_ok := coalesce(p_teacher_pin, '') <> '' and private.mdr_pin_ok(v_actor.pin, p_teacher_pin, v_actor.id::text);\n"]]$o$::jsonb,
  'c3e99cbf07c57fc47b31c0b4459aa8b9');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_dastarkhan_get', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '6f2af596d00f08182a186fd49e238b37');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_dastarkhan_save', $a$p_actor_id uuid, p_pin text, p_payload jsonb$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '3d23cb325bbecfc0de5fdd7563603b66');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_delete_exam', $a$p_actor_id uuid, p_pin text, p_exam_id uuid$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'da53bfc3ac4ea52be234e0348f66cbec');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_exam_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'cd303c6eaa578ba28e002d4a0be663d5');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_full_database_backup', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'db805f399d024ad0ebcc500550b0b739');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_get_student_akhlaq', $a$p_actor_id uuid, p_pin text, p_student_id uuid$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'c08b1359c055e4517b74fddbec5e8884');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_khadimin_add_leave', $a$p_actor_id uuid, p_pin text, p_khadim_id uuid, p_date_from date, p_date_to date, p_reason text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '5eaea4380b673105fa78c59dc9ffcf4b');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_khadimin_add_note', $a$p_actor_id uuid, p_pin text, p_khadim_id uuid, p_text text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '1b63c60be6011d28c6db8c7c323295f3');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_khadimin_list', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\r\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\r\n"]]$o$::jsonb,
  '558d215910dd2648cd166e71506cbc32');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_khadimin_upsert', $a$p_actor_id uuid, p_pin text, p_id uuid, p_name text, p_phone text, p_duty text, p_join_date date, p_status text, p_address text, p_details text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role in ('admin', 'daftar');\r\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role in ('admin', 'daftar');\r\n"]]$o$::jsonb,
  '05bb5d8180c4bf937123ccd94e053139');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_push_subscribe', $a$p_actor_id uuid, p_pin text, p_endpoint text, p_p256dh text, p_auth text, p_is_admin boolean, p_user_agent text$a$,
  $o$[["    where id = p_actor_id and is_active = true and pin = p_pin;\n", "    where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  'e921b0b62fcae4a0d718644b888f9b6f');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_push_unsubscribe', $a$p_actor_id uuid, p_pin text, p_endpoint text, p_is_admin boolean$a$,
  $o$[["    where id = p_actor_id and is_active = true and pin = p_pin;\n", "    where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);\n"]]$o$::jsonb,
  '2a3f03ed7efecb74be0c1db450186895');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_akhlaq', $a$p_actor_id uuid, p_pin text, p_student_id uuid, p_score integer, p_reason text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role = 'madrasa_teacher' and class_id is not null;\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role = 'madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  '8f6db53d4feda815ec5ca88d27ad8176');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_attendance_day', $a$p_actor_id uuid, p_pin text, p_date date, p_records jsonb, p_hijri_year text$a$,
  $o$[["    AND pin = p_pin\n", "    AND private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'a4b2f2d77bc008c379cf9755c701d67e');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_book_progress', $a$p_actor_id uuid, p_pin text, p_book_id uuid, p_pages_done integer, p_note text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role = 'madrasa_teacher' and class_id is not null;\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role = 'madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  'ff7598addec97e94554534b045debc77');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_exam', $a$p_actor_id uuid, p_pin text, p_name text, p_type text, p_subjects jsonb, p_paper_name text, p_paper_data text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'a0011b4a802f9d301b346a911336ce30');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_exam_results', $a$p_actor_id uuid, p_pin text, p_exam_id uuid, p_results jsonb$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'e8383be2a9886ee03679caf76babc52d');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_scoped_user', $a$p_actor_id uuid, p_pin text, p_user_id uuid, p_name text, p_role text, p_login_id text, p_user_pin text, p_class_code text, p_is_active boolean$a$,
  $o$[["  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_user_pin, '')) = '' then\r\n", "  if btrim(coalesce(p_name, '')) = '' or (p_user_id is null and btrim(coalesce(p_user_pin, '')) = '') then\r\n"], ["    values (btrim(p_name), btrim(p_user_pin), 'madrasa_teacher', v_login_id, array['madrasa'], '{}'::jsonb, v_class.id, p_is_active)\r\n", "    values (btrim(p_name), private.mdr_pin_hash(btrim(p_user_pin)), 'madrasa_teacher', v_login_id, array['madrasa'], '{}'::jsonb, v_class.id, p_is_active)\r\n"], ["        pin = btrim(p_user_pin),\r\n", "        pin = case when btrim(coalesce(p_user_pin, '')) = '' then pin else private.mdr_pin_hash(btrim(p_user_pin)) end,\r\n"]]$o$::jsonb,
  '30022f58dc46009a0d744df6681c1428');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_settings', $a$p_pin text, p_institution text, p_hijri_year text, p_session_start_date date, p_hijri_offset_days integer$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, id::text)\n"]]$o$::jsonb,
  '7e808683b638d9a8cc0f0dc28e05dae2');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_teacher_log', $a$p_actor_id uuid, p_pin text, p_type text, p_student_id uuid, p_content text, p_review_requested boolean$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role = 'madrasa_teacher' and class_id is not null;\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role = 'madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  'b5eeee2eb3b5e43f7bdd0df19a027344');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_save_user', $a$p_pin text, p_user_id uuid, p_name text, p_role text, p_login_id text, p_user_pin text, p_class_code text, p_admin_perms jsonb, p_is_active boolean$a$,
  $o$[["  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_user_pin, '')) = '' then\r\n", "  if btrim(coalesce(p_name, '')) = '' or (p_user_id is null and btrim(coalesce(p_user_pin, '')) = '') then\r\n"], ["      btrim(p_user_pin),\r\n", "      private.mdr_pin_hash(btrim(p_user_pin)),\r\n"], ["        pin = btrim(p_user_pin),\r\n", "        pin = case when btrim(coalesce(p_user_pin, '')) = '' then pin else private.mdr_pin_hash(btrim(p_user_pin)) end,\r\n"]]$o$::jsonb,
  '5f073b1a8e12206d292470b3c56d8d28');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_set_alhamdulillah', $a$p_actor_id uuid, p_pin text, p_student_id uuid, p_alhamdulillah boolean, p_reason text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '3169e72821304feabb16ca06bd48a539');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_set_book_active', $a$p_actor_id uuid, p_pin text, p_book_id uuid, p_is_active boolean$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin and role = 'madrasa_teacher' and class_id is not null;\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text) and role = 'madrasa_teacher' and class_id is not null;\n"]]$o$::jsonb,
  '6e5458fceb57e102c073422abfadefd7');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_set_special_watch', $a$p_actor_id uuid, p_pin text, p_student_id uuid, p_special_watch boolean$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'f23fc6be625c3448b6c6229df365d956');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_set_student_status', $a$p_actor_id uuid, p_pin text, p_student_id uuid, p_status text, p_reason text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'b27a564f5dd2fa8bcf0d4d2e9b0b1998');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_settings_users_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["        'pin', u.pin,\r\n", "        'has_pin', u.pin is not null,\r\n"]]$o$::jsonb,
  'f0495a503cdfd9381099a362fcf3d009');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_staff_change_own_pin', $a$p_user_id uuid, p_current_pin text, p_new_pin text$a$,
  $o$[["  set pin = v_new,\r\n", "  set pin = private.mdr_pin_hash(v_new),\r\n"]]$o$::jsonb,
  'f9a2b5d76ecf07aae42df8438a9e131c');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_staff_login', $a$p_role text, p_login_id text, p_pin text$a$,
  $o$[["    and u.pin = p_pin\n", "    and private.mdr_pin_ok(u.pin, p_pin, u.id::text)\n"]]$o$::jsonb,
  '3889f96e469f8d3268a1898460463ad3');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_student_attendance_history', $a$p_actor_id uuid, p_pin text, p_student_id uuid$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '52b5859a0b6954666f2f6a58076ac508');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_teacher_class_absent_summary', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'fe1f9f421bd4066362ed0f0facbf5ef5');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_teacher_class_bootstrap', $a$p_actor_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '4b1c747b7ec1a78823ad4bbf2444ab0e');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_update_akhlaq', $a$p_actor_id uuid, p_pin text, p_akhlaq_id uuid, p_score integer, p_reason text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'b21ec268c7981f790fd3b0e5a3ed4df8');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_update_exam', $a$p_actor_id uuid, p_pin text, p_exam_id uuid, p_name text, p_type text, p_subjects jsonb, p_paper_name text, p_paper_data text$a$,
  $o$[["  where id = p_actor_id and is_active = true and pin = p_pin\n", "  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  '655e8684c88b5d2a6dae6341bfb81cb4');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_update_teacher_log', $a$p_actor_id uuid, p_pin text, p_log_id uuid, p_content text$a$,
  $o$[["    and pin = p_pin\n", "    and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)\n"]]$o$::jsonb,
  'e149e39656a9f8ec5ca94d7f3665c5e9');
perform pg_temp.mdr_patch_fn('public', 'mdr_rel_user_login', $a$p_user_id uuid, p_pin text$a$,
  $o$[["    and pin = p_pin;\n", "    and private.mdr_pin_ok(pin, p_pin, p_user_id::text);\n"]]$o$::jsonb,
  '48a1830f8faf10f0d35da31ebe05b555');

-- ── স্ব-পরীক্ষা (savepoint-এ চলে; ব্যর্থ হলে পুরো migration বাতিল)
execute $t$do $selftest$
declare
  r jsonb := '{}'::jsonb; res jsonb; v_admin uuid; v_t record; i int; f record; call text;
  errs jsonb := '[]'::jsonb; n_calls int := 0; v_hash_before text; v_detail text; v_fail text[] := '{}';
begin
  if not exists (select 1 from public.mdr_shared_users where role = 'admin' and is_active)
     or not exists (select 1 from public.mdr_shared_users where role = 'madrasa_teacher' and is_active and login_id is not null and class_id is not null) then
    raise notice 'pin selftest skipped: no admin/teacher rows';
    return;
  end if;

  begin
    -- T1: বিদ্যমান প্রতিটা পিন hash-এর পরে মেলে কিনা (plaintext কোথাও বের হয় না)
    select count(*) filter (where not private.mdr_pin_ok(u.pin, p.pin, null)) into i
      from public.mdr_shared_users u join pg_temp._mdr_pins_before p on p.id = u.id where p.pin is not null;
    r := r || jsonb_build_object('T1_roundtrip_failures', i,
      'T1_unhashed_left', (select count(*) from public.mdr_shared_users where pin !~ '^\$2'));

    update public.mdr_shared_users set pin = private.mdr_pin_hash('9911') where role = 'admin';
    select id into v_admin from public.mdr_shared_users where role = 'admin' and is_active order by created_at limit 1;
    select u.id, u.login_id, u.name, c.code as class_code into v_t
      from public.mdr_shared_users u join public.mdr_classes c on c.id = u.class_id
      where u.role = 'madrasa_teacher' and u.is_active and u.login_id is not null and c.is_active limit 1;
    update public.mdr_shared_users set pin = private.mdr_pin_hash('4321') where id = v_t.id;
    delete from private.mdr_pin_failures; perform set_config('mdr.pin_matched', '', true);

    -- T2: ৫টা আলাদা ভুল পিন → লক (সঠিক পিনও আটকায়)
    for i in 1..5 loop res := public.mdr_rel_admin_login(lpad(i::text, 4, '0')); end loop;
    begin
      res := public.mdr_rel_admin_login('9911');
      r := r || jsonb_build_object('T2_lock', 'NOT LOCKED');
    exception when others then
      r := r || jsonb_build_object('T2_lock', sqlerrm);
    end;
    delete from private.mdr_pin_failures; perform set_config('mdr.pin_matched', '', true);
    r := r || jsonb_build_object('T2_admin_login_ok', public.mdr_rel_admin_login('9911') -> 'ok');
    perform set_config('mdr.pin_matched', '', true);

    -- T3: একই ভুল পিন ১০ বার → একবারই গোনা; সঠিক পিনে গণনা মুছে যায়
    for i in 1..10 loop res := public.mdr_rel_user_login(v_t.id, '1111'); end loop;
    r := r || jsonb_build_object('T3_same_wrong_count', (select count(*) from private.mdr_pin_failures where target = v_t.id::text));
    r := r || jsonb_build_object('T3_user_login_after', public.mdr_rel_user_login(v_t.id, '4321') -> 'ok');
    r := r || jsonb_build_object('T3_failures_cleared', (select count(*) from private.mdr_pin_failures where target = v_t.id::text));
    perform set_config('mdr.pin_matched', '', true);

    -- T4: staff login (login_id + pin)
    r := r || jsonb_build_object('T4_staff_login', public.mdr_rel_staff_login('madrasa_teacher', v_t.login_id, '4321') -> 'ok');
    perform set_config('mdr.pin_matched', '', true);
    r := r || jsonb_build_object('T4_staff_wrong', public.mdr_rel_staff_login('madrasa_teacher', v_t.login_id, '0000') -> 'ok');
    delete from private.mdr_pin_failures; perform set_config('mdr.pin_matched', '', true);

    -- T5: ইউজার এডিট — পিন খালি → আগের পিন; নতুন পিন → hash; নতুন ইউজারে পিন বাধ্যতামূলক
    select pin into v_hash_before from public.mdr_shared_users where id = v_t.id;
    res := public.mdr_rel_save_user('9911', v_t.id, v_t.name, 'madrasa_teacher', v_t.login_id, '', v_t.class_code, '{}'::jsonb, true);
    r := r || jsonb_build_object('T5_save_empty_pin', res -> 'ok',
      'T5_pin_unchanged', (select pin = v_hash_before from public.mdr_shared_users where id = v_t.id));
    res := public.mdr_rel_save_user('9911', v_t.id, v_t.name, 'madrasa_teacher', v_t.login_id, '5555', v_t.class_code, '{}'::jsonb, true);
    r := r || jsonb_build_object('T5_save_new_pin', res -> 'ok', 'T5_login_new', public.mdr_rel_user_login(v_t.id, '5555') -> 'ok');
    res := public.mdr_rel_save_user('9911', null, 'টেস্ট', 'daftar', null, '', null, '{}'::jsonb, true);
    r := r || jsonb_build_object('T5_new_user_without_pin', res ->> 'error');
    res := public.mdr_rel_save_user('9911', null, 'টেস্ট', 'daftar', null, '7777', null, '{}'::jsonb, true);
    r := r || jsonb_build_object('T5_new_user_login', public.mdr_rel_user_login((res ->> 'id')::uuid, '7777') -> 'ok');

    -- T6: নিজের পিন ও অ্যাডমিন পিন বদল
    r := r || jsonb_build_object(
      'T6_change_own', public.mdr_rel_staff_change_own_pin(v_t.id, '5555', '6666') -> 'ok',
      'T6_login_6666', public.mdr_rel_user_login(v_t.id, '6666') -> 'ok',
      'T6_admin_change', public.mdr_rel_admin_change_pin('9911', '9922') -> 'ok',
      'T6_admin_login_new', public.mdr_rel_admin_login('9922') -> 'ok');

    -- T7: তালিকায় পিন আর নেই
    res := public.mdr_rel_admin_users('9922');
    r := r || jsonb_build_object('T7_users_ok', res -> 'ok',
      'T7_users_pin_key', coalesce((res -> 'users' -> 0) ? 'pin', false), 'T7_has_pin', res -> 'users' -> 0 -> 'has_pin');
    res := public.mdr_dept_rel_admin_departments('9922');
    r := r || jsonb_build_object('T7_dept_ok', res -> 'ok',
      'T7_dept_head_pin_key', coalesce((res -> 'departments' -> 0) ? 'head_pin', false));

    -- T8: প্রতিটা পিন-যাচাইকারী public function — অ্যাডমিন id + ভুল পিন দিয়ে একবার (runtime error ধরতে)
    for f in
      select p.proname, p.proargtypes::regtype[] as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'mdr%' and p.prosrc like '%mdr_pin_ok%'
    loop
      call := 'select public.' || quote_ident(f.proname) || '(' || coalesce((
        select string_agg(case
          when t = 'uuid'::regtype and k = 1 then quote_literal(v_admin) || '::uuid'
          when t = 'uuid'::regtype then 'gen_random_uuid()'
          when t = 'text'::regtype and k <= 2 then '''0000'''
          when t = 'text'::regtype then '''x'''
          when t in ('integer'::regtype, 'numeric'::regtype, 'smallint'::regtype, 'bigint'::regtype) then '0'
          when t = 'boolean'::regtype then 'false'
          when t = 'date'::regtype then 'current_date'
          when t = 'jsonb'::regtype then '''{}''::jsonb'
          when t = 'uuid[]'::regtype then 'array[]::uuid[]'
          when t = 'text[]'::regtype then 'array[]::text[]'
          else 'null::' || t::text end, ', ' order by k)
        from unnest(f.types) with ordinality as a(t, k)), '') || ')';
      n_calls := n_calls + 1;
      delete from private.mdr_pin_failures; perform set_config('mdr.pin_matched', '', true);
      begin
        execute call;
      exception when others then
        -- overload-এর কারণে ডামি call অস্পষ্ট হলে (যেমন chat_send) তা পরীক্ষার সীমাবদ্ধতা, bug নয়
        if sqlerrm not like '%is not unique%' then
          errs := errs || jsonb_build_object('fn', f.proname, 'err', sqlerrm);
        end if;
      end;
    end loop;
    r := r || jsonb_build_object('T8_calls', n_calls, 'T8_errors', errs);

    raise exception 'MDR_PIN_SELFTEST_DONE' using detail = r::text;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm <> 'MDR_PIN_SELFTEST_DONE' then
      raise exception 'pin selftest crashed: % | partial: %', sqlerrm, r;
    end if;
    r := v_detail::jsonb;
  end;

  if (r ->> 'T1_roundtrip_failures')::int <> 0 then v_fail := array_append(v_fail, 'T1_roundtrip'); end if;
  if (r ->> 'T1_unhashed_left')::int <> 0 then v_fail := array_append(v_fail, 'T1_unhashed'); end if;
  if r ->> 'T2_lock' <> 'pin_locked' then v_fail := array_append(v_fail, 'T2_lock'); end if;
  if not (r -> 'T2_admin_login_ok')::boolean then v_fail := array_append(v_fail, 'T2_login'); end if;
  if (r ->> 'T3_same_wrong_count')::int <> 1 then v_fail := array_append(v_fail, 'T3_count'); end if;
  if not (r -> 'T3_user_login_after')::boolean then v_fail := array_append(v_fail, 'T3_login'); end if;
  if (r ->> 'T3_failures_cleared')::int <> 0 then v_fail := array_append(v_fail, 'T3_cleared'); end if;
  if not (r -> 'T4_staff_login')::boolean or (r -> 'T4_staff_wrong')::boolean then v_fail := array_append(v_fail, 'T4'); end if;
  if not (r -> 'T5_save_empty_pin')::boolean or not (r -> 'T5_pin_unchanged')::boolean
     or not (r -> 'T5_save_new_pin')::boolean or not (r -> 'T5_login_new')::boolean
     or r ->> 'T5_new_user_without_pin' <> 'missing_required' or not (r -> 'T5_new_user_login')::boolean then
    v_fail := array_append(v_fail, 'T5');
  end if;
  if not (r -> 'T6_change_own')::boolean or not (r -> 'T6_login_6666')::boolean
     or not (r -> 'T6_admin_change')::boolean or not (r -> 'T6_admin_login_new')::boolean then
    v_fail := array_append(v_fail, 'T6');
  end if;
  if not (r -> 'T7_users_ok')::boolean or (r -> 'T7_users_pin_key')::boolean or not (r -> 'T7_has_pin')::boolean
     or not (r -> 'T7_dept_ok')::boolean or (r -> 'T7_dept_head_pin_key')::boolean then
    v_fail := array_append(v_fail, 'T7');
  end if;
  if jsonb_array_length(r -> 'T8_errors') > 0 then v_fail := array_append(v_fail, 'T8'); end if;

  if array_length(v_fail, 1) > 0 then
    raise exception 'pin selftest FAILED % | %', v_fail, r;
  end if;
  delete from private.mdr_pin_failures;
end
$selftest$$t$;

execute 'drop table if exists pg_temp._mdr_pins_before';
execute 'drop function pg_temp.mdr_patch_fn(text, text, text, jsonb, text)';
end
$migration$;
