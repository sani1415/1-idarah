-- সেশন টোকেন: লগইনের পর ব্রাউজারে আসল পিনের বদলে একটা random টোকেন থাকে
--
-- কী বদলাল:
--   1) private.mdr_sessions — প্রতিটি লগইন করা ডিভাইসের জন্য একটি row। টোকেনের শুধু sha256
--      hash রাখা হয়, আসল টোকেন কোথাও জমা থাকে না।
--   2) private.mdr_pin_ok() এখন 'mdrs1.' দিয়ে শুরু হওয়া input-কে টোকেন হিসেবে যাচাই করে।
--      তাই সব বিদ্যমান RPC (যেগুলো p_pin নেয়) কোনো signature বদল ছাড়াই টোকেন গ্রহণ করে।
--      আসল পিনও আগের মতো চলে, যাতে পুরনো ফোন/ক্যাশ হঠাৎ লগআউট না হয়।
--   3) টোকেন বাতিল হয় যখন:
--        * ইউজারের পিন বদলায় (session-এ পিন-hash-এর fingerprint থাকে; hash বদলালে মেলে না)
--        * ইউজার logout করে (mdr_rel_session_end)
--        * জিম্মাদার "সব ডিভাইস থেকে লগআউট" চাপেন (mdr_rel_admin_revoke_user_sessions)
--        * ১৮০ দিন ব্যবহার না হলে (ব্যবহার হলে মেয়াদ নিজে থেকে বাড়ে)
--      ইউজার নিষ্ক্রিয় হলে প্রতিটি RPC-র নিজস্ব is_active শর্তেই আটকায়।
--   4) ভুল/মেয়াদোত্তীর্ণ টোকেন পিন-লকের ভুল-গণনায় যোগ হয় না (মালিক লক হবেন না),
--      আর বৈধ টোকেন পিন-লক থাকলেও কাজ করে (লক শুধু পিন অনুমান ঠেকাতে)।
--   5) দরস শিক্ষকের ('dars:' target) জন্য টোকেন দেওয়া হয় না; কিয়স্কে পিনই চলে।
--
-- নতুন RPC: mdr_rel_session_issue, mdr_rel_session_status, mdr_rel_session_end,
--           mdr_rel_admin_revoke_user_sessions
--
-- Rollback: নিচের "ROLLBACK" অংশ চালালে আগের mdr_pin_ok ফিরে আসে; টোকেন তখন আর কাজ করবে না,
-- তাই frontend-ও আগের সংস্করণে ফেরাতে হবে (নইলে টোকেন থাকা ডিভাইস আবার লগইন চাইবে)।
--   create or replace function private.mdr_pin_ok(...)  -- 20261001120000_mdr_pin_hash_lockout.sql থেকে
--   drop function public.mdr_rel_session_issue(uuid, text, text);
--   drop function public.mdr_rel_session_status(text);
--   drop function public.mdr_rel_session_end(text);
--   drop function public.mdr_rel_admin_revoke_user_sessions(text, uuid);
--   drop function private.mdr_session_ok(text, text, text);
--   drop table private.mdr_sessions;

-- ── সেশন table
create table if not exists private.mdr_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,      -- sha256(টোকেন), hex
  user_id uuid not null references public.mdr_shared_users(id) on delete cascade,
  target text not null,                 -- mdr_pin_ok-এর target (user id text)
  pin_fp text not null,                 -- sha256(পিন-hash) — পিন বদলালে টোকেন বাতিল
  device text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days',
  revoked_at timestamptz
);
create index if not exists mdr_sessions_user_idx on private.mdr_sessions (user_id);
alter table private.mdr_sessions enable row level security;
revoke all on table private.mdr_sessions from public, anon, authenticated;

-- ── টোকেন যাচাই helper
create or replace function private.mdr_session_ok(p_stored text, p_token text, p_target text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_last timestamptz;
begin
  if p_stored is null or p_token is null or p_target is null then
    return false;
  end if;

  select s.id, s.last_used_at into v_id, v_last
  from private.mdr_sessions s
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.target = p_target
    and s.revoked_at is null
    and s.expires_at > now()
    and s.pin_fp = encode(extensions.digest(p_stored, 'sha256'), 'hex');

  if v_id is null then
    return false;
  end if;

  -- প্রতি call-এ লেখা এড়াতে ঘণ্টায় একবার last_used / মেয়াদ বাড়ানো
  if v_last < now() - interval '1 hour' then
    update private.mdr_sessions
    set last_used_at = now(),
        expires_at = greatest(expires_at, now() + interval '180 days')
    where id = v_id;
  end if;

  -- একাধিক অ্যাডমিন row স্ক্যানে অন্য row-এর অমিল যেন ভুল-পিন হিসেবে না গোনা হয়
  perform set_config('mdr.pin_matched', '1', true);
  return true;
end;
$$;
revoke all on function private.mdr_session_ok(text, text, text) from public, anon, authenticated;

-- ── পিন যাচাই: টোকেন শাখা যোগ (বাকিটা 20261001120000-এর মতোই)
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

  -- সেশন টোকেন: লক/ভুল-গণনার বাইরে
  if left(p_input, 6) = 'mdrs1.' then
    return private.mdr_session_ok(p_stored, p_input, p_target);
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
$$;
revoke all on function private.mdr_pin_ok(text, text, text) from public, anon, authenticated;

-- ── লগইনের পর টোকেন নেওয়া (আসল পিন লাগে; টোকেন দিয়ে নতুন টোকেন হয় না)
create or replace function public.mdr_rel_session_issue(p_user_id uuid, p_pin text, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored text;
  v_token text;
begin
  if p_user_id is null or p_pin is null or p_pin = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_required');
  end if;
  if left(p_pin, 6) = 'mdrs1.' then
    return jsonb_build_object('ok', false, 'error', 'pin_required');
  end if;

  select u.pin into v_stored
  from public.mdr_shared_users u
  where u.id = p_user_id and u.is_active = true;

  if v_stored is null or not private.mdr_pin_ok(v_stored, p_pin, p_user_id::text) then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  v_token := 'mdrs1.' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into private.mdr_sessions (token_hash, user_id, target, pin_fp, device)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_user_id,
    p_user_id::text,
    encode(extensions.digest(v_stored, 'sha256'), 'hex'),
    left(nullif(btrim(coalesce(p_device, '')), ''), 120)
  );

  -- পরিষ্কার: মেয়াদোত্তীর্ণ/বাতিল পুরনো row, আর একজনের ৩০টির বেশি সক্রিয় ডিভাইস হলে পুরনোগুলো বাতিল
  delete from private.mdr_sessions s
  where s.user_id = p_user_id
    and (s.expires_at < now() - interval '30 days' or s.revoked_at < now() - interval '30 days');
  update private.mdr_sessions s
  set revoked_at = now()
  where s.id in (
    select x.id from private.mdr_sessions x
    where x.user_id = p_user_id and x.revoked_at is null
    order by x.last_used_at desc
    offset 30
  );

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

-- ── টোকেন এখনো বৈধ কিনা (frontend: ভুল-উত্তর এলে লগআউট দরকার কিনা বুঝতে)
create or replace function public.mdr_rel_session_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  if p_token is null or left(p_token, 6) <> 'mdrs1.' then
    return jsonb_build_object('ok', true, 'valid', false);
  end if;
  select exists (
    select 1
    from private.mdr_sessions s
    join public.mdr_shared_users u on u.id = s.user_id
    where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and s.revoked_at is null
      and s.expires_at > now()
      and u.is_active = true
      and s.pin_fp = encode(extensions.digest(u.pin, 'sha256'), 'hex')
  ) into v_valid;
  return jsonb_build_object('ok', true, 'valid', v_valid);
end;
$$;

-- ── logout: এই ডিভাইসের টোকেন বাতিল
create or replace function public.mdr_rel_session_end(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or left(p_token, 6) <> 'mdrs1.' then
    return jsonb_build_object('ok', true);
  end if;
  update private.mdr_sessions
  set revoked_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── জিম্মাদার: কোনো ইউজারের সব ডিভাইস থেকে লগআউট (ইউজার ম্যানেজমেন্টের মতোই শুধু মূল অ্যাডমিন)
create or replace function public.mdr_rel_admin_revoke_user_sessions(p_pin text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not private.verify_admin_pin(p_pin) then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;
  update private.mdr_sessions
  set revoked_at = now()
  where user_id = p_user_id and revoked_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$$;

revoke all on function public.mdr_rel_session_issue(uuid, text, text) from public;
revoke all on function public.mdr_rel_session_status(text) from public;
revoke all on function public.mdr_rel_session_end(text) from public;
revoke all on function public.mdr_rel_admin_revoke_user_sessions(text, uuid) from public;
grant execute on function public.mdr_rel_session_issue(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_session_status(text) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_session_end(text) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_admin_revoke_user_sessions(text, uuid) to anon, authenticated, service_role;
