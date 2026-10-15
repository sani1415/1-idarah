-- ওজিফা রিপোর্ট: কে সময়মতো দিচ্ছে, কে দেরিতে, কে বাকি — সব সক্রিয় ছাত্রের
--
-- ফি-সফটওয়্যারের API একবারে এক ছাত্র দেয় (~১ সেকেন্ড), তাই রিপোর্ট সরাসরি API থেকে নয়:
--   * mdr_wazifa_snapshot — প্রতি ছাত্রের সর্বশেষ আনা ওজিফা (ছোট আকারে)। RLS চালু, কোনো policy নেই
--     (anon/authenticated সরাসরি পড়তে পারে না; শুধু নিচের RPC দিয়ে)।
--   * Edge Function mdr-wazifa-sync পেছনে সবাইকে এনে snapshot ভরে; প্রোফাইলের «ওজিফা» ট্যাব খুললে
--     (mdr-student-fee) সেই ছাত্রেরটাও হালনাগাদ হয়।
--   * সিঙ্ক চালু হয়: রাতে pg_cron (বাংলাদেশ সময় রাত ২:৩০), আর রিপোর্টের «হালনাগাদ করুন» বোতাম
--     (mdr_rel_wazifa_refresh — ১০ মিনিটে একবারের বেশি নয়)। Function-কে ডাকে private.mdr_wazifa_sync_kick()
--     pg_net দিয়ে, vault-এর mdr_notify_webhook_secret header-এ (send-admin-push-এর একই secret)।
--   * mdr_rel_wazifa_report — জিম্মাদার/দফতর; সীমিত এডমিন শুধু নিজের বিভাগের ছাত্র।
--   * queue/save RPC শুধু service_role (Edge Function)।
--
-- Rollback:
--   select cron.unschedule('mdr-wazifa-nightly');
--   drop function public.mdr_rel_wazifa_report(uuid, text); drop function public.mdr_rel_wazifa_refresh(uuid, text);
--   drop function public.mdr_rel_wazifa_sync_queue(text, int); drop function public.mdr_rel_wazifa_snapshot_save(jsonb, boolean, int);
--   drop function private.mdr_wazifa_sync_kick(); drop function private.mdr_wazifa_actor(uuid, text);
--   drop table private.mdr_wazifa_sync_state; drop table public.mdr_wazifa_snapshot;

create table if not exists public.mdr_wazifa_snapshot (
  student_id uuid primary key references public.mdr_students(id) on delete cascade,
  reg_id text not null,
  status text not null default 'ok' check (status in ('ok', 'not_found')),
  months jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table public.mdr_wazifa_snapshot enable row level security;
revoke all on table public.mdr_wazifa_snapshot from anon, authenticated;

create table if not exists private.mdr_wazifa_sync_state (
  id boolean primary key default true check (id),
  run_id text,
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_failed int
);
insert into private.mdr_wazifa_sync_state (id) values (true) on conflict (id) do nothing;

-- ── যাচাই: জিম্মাদার / সীমিত এডমিন / দফতর
create or replace function private.mdr_wazifa_actor(p_actor_id uuid, p_pin text)
returns public.mdr_shared_users
language plpgsql security definer set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  select * into v_actor from public.mdr_shared_users
  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)
    and role in ('admin', 'restricted_admin', 'daftar');
  return v_actor;
end;
$$;
revoke all on function private.mdr_wazifa_actor(uuid, text) from public, anon, authenticated;

-- ── Edge Function-কে ডাকা (pg_net, async)
create or replace function private.mdr_wazifa_sync_kick()
returns void
language plpgsql security definer set search_path = public, private, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mdr_notify_webhook_secret';
  update private.mdr_wazifa_sync_state set requested_at = now() where id = true;
  perform net.http_post(
    url := 'https://bbdtoucanihtrymzpynq.supabase.co/functions/v1/mdr-wazifa-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', coalesce(v_secret, ''))
  );
end;
$$;
revoke all on function private.mdr_wazifa_sync_kick() from public, anon, authenticated;

-- ── সিঙ্কের তালিকা (service_role): এই দফার শুরুর পর যাদের আনা হয়নি
create or replace function public.mdr_rel_wazifa_sync_queue(p_run_id text, p_limit int)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_state private.mdr_wazifa_sync_state%rowtype;
begin
  select * into v_state from private.mdr_wazifa_sync_state where id = true for update;
  if v_state.run_id is distinct from p_run_id then
    update private.mdr_wazifa_sync_state
       set run_id = p_run_id, started_at = now(), finished_at = null, last_failed = null
     where id = true
    returning * into v_state;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'reg_id', q.reg_id))
    from (
      select s.id, btrim(s.student_id) as reg_id
      from public.mdr_students s
      left join public.mdr_wazifa_snapshot w on w.student_id = s.id
      where s.status = 'active' and nullif(btrim(coalesce(s.student_id, '')), '') is not null
        and (w.fetched_at is null or w.fetched_at < v_state.started_at)
      order by w.fetched_at nulls first
      limit greatest(1, least(coalesce(p_limit, 1000), 2000))
    ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.mdr_rel_wazifa_sync_queue(text, int) from public, anon, authenticated;
grant execute on function public.mdr_rel_wazifa_sync_queue(text, int) to service_role;

-- ── snapshot রাখা (service_role)
create or replace function public.mdr_rel_wazifa_snapshot_save(p_rows jsonb, p_finished boolean default false, p_failed int default null)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_n int;
begin
  insert into public.mdr_wazifa_snapshot (student_id, reg_id, status, months, totals, fetched_at)
  select (r->>'student_id')::uuid, r->>'reg_id',
         case when r->>'status' = 'not_found' then 'not_found' else 'ok' end,
         coalesce(r->'months', '[]'::jsonb), coalesce(r->'totals', '{}'::jsonb), now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where exists (select 1 from public.mdr_students s where s.id = (r->>'student_id')::uuid)
  on conflict (student_id) do update
    set reg_id = excluded.reg_id, status = excluded.status, months = excluded.months,
        totals = excluded.totals, fetched_at = excluded.fetched_at;
  get diagnostics v_n = row_count;
  if p_finished then
    update private.mdr_wazifa_sync_state set finished_at = now(), last_failed = p_failed where id = true;
  end if;
  return jsonb_build_object('ok', true, 'saved', v_n);
end;
$$;
revoke all on function public.mdr_rel_wazifa_snapshot_save(jsonb, boolean, int) from public, anon, authenticated;
grant execute on function public.mdr_rel_wazifa_snapshot_save(jsonb, boolean, int) to service_role;

-- ── রিপোর্ট (জিম্মাদার/দফতর)
create or replace function public.mdr_rel_wazifa_report(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_scope text[];
  v_state private.mdr_wazifa_sync_state%rowtype;
begin
  v_actor := private.mdr_wazifa_actor(p_actor_id, p_pin);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if v_actor.role = 'restricted_admin' and coalesce(v_actor.admin_perms->>'super_admin', 'false') <> 'true' then
    select coalesce(array_agg(value), array[]::text[]) into v_scope
    from jsonb_array_elements_text(coalesce(v_actor.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) t(value);
  end if;
  select * into v_state from private.mdr_wazifa_sync_state where id = true;

  return jsonb_build_object(
    'ok', true,
    'sync', jsonb_build_object(
      'requested_at', v_state.requested_at, 'started_at', v_state.started_at,
      'finished_at', v_state.finished_at, 'failed', v_state.last_failed,
      'done_this_run', (select count(*) from public.mdr_wazifa_snapshot w where v_state.started_at is not null and w.fetched_at >= v_state.started_at)
    ),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'reg_id', s.student_id,
        'class_id', c.id, 'class_name', c.name, 'class_sort', c.sort_order, 'dept', d.code,
        'status', w.status, 'months', w.months, 'fetched_at', w.fetched_at
      ) order by c.sort_order nulls last, c.name, s.current_roll, s.name)
      from public.mdr_students s
      left join public.mdr_classes c on c.id = s.current_class_id
      left join public.mdr_divisions d on d.id = c.division_id
      left join public.mdr_wazifa_snapshot w on w.student_id = s.id
      where s.status = 'active'
        and (v_scope is null or d.code = any(v_scope))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.mdr_rel_wazifa_report(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_wazifa_report(uuid, text) to anon;

-- ── «হালনাগাদ করুন» (জিম্মাদার/দফতর; ১০ মিনিটে একবার)
create or replace function public.mdr_rel_wazifa_refresh(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_state private.mdr_wazifa_sync_state%rowtype;
begin
  v_actor := private.mdr_wazifa_actor(p_actor_id, p_pin);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  select * into v_state from private.mdr_wazifa_sync_state where id = true for update;
  if v_state.requested_at is not null and v_state.requested_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'recent', 'requested_at', v_state.requested_at);
  end if;
  perform private.mdr_wazifa_sync_kick();
  return jsonb_build_object('ok', true, 'started', true);
end;
$$;
revoke all on function public.mdr_rel_wazifa_refresh(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_wazifa_refresh(uuid, text) to anon;

-- ── রাতের সিঙ্ক (UTC 20:30 = বাংলাদেশ রাত ২:৩০)
create extension if not exists pg_cron;
select cron.unschedule('mdr-wazifa-nightly') where exists (select 1 from cron.job where jobname = 'mdr-wazifa-nightly');
select cron.schedule('mdr-wazifa-nightly', '30 20 * * *', 'select private.mdr_wazifa_sync_kick()');

notify pgrst, 'reload schema';
