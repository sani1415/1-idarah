-- বর্ষ দায়িত্বের লক — মেয়াদি বিরতি (জিম্মাদার)
--
-- বর্ষ দায়িত্বশীল শিক্ষকের কিতাব/খুলুক/লগ সময়মতো না হলে তাঁর বর্ষের পেজে বাকি মেনু বন্ধ হয়
-- (frontend: js/madrasa/mdr-class-duty-gate.js)। জিম্মাদার এখন সবার জন্য বা নির্দিষ্ট বর্ষের জন্য
-- কিছু দিনের জন্য এই লক বন্ধ রাখতে পারেন; মেয়াদ বাধ্যতামূলক, শেষ হলে নিজে থেকেই আবার চালু।
-- বিরতিতে শুধু তালা ওঠে — «দায়িত্ব বাকি» সতর্কতা দেখানো চলতে থাকে।
--
-- table: public.mdr_duty_lock_pauses  (class_id null = সব বর্ষ; প্রতি scope-এ একটাই row)
-- RPC:   mdr_rel_admin_duty_pause_list / _set / _clear  (শুধু মূল জিম্মাদার)
--        mdr_rel_teacher_duty_pause_status               (শিক্ষক — নিজের বর্ষ)
-- তারিখ: বাংলাদেশ সময় (Asia/Dhaka); paused_until দিনটিসহ বিরতি চলে।
--
-- Rollback:
--   drop function public.mdr_rel_teacher_duty_pause_status(uuid, text);
--   drop function public.mdr_rel_admin_duty_pause_clear(uuid, text, uuid);
--   drop function public.mdr_rel_admin_duty_pause_set(uuid, text, uuid, integer);
--   drop function public.mdr_rel_admin_duty_pause_list(uuid, text);
--   drop function private.mdr_duty_pause_main_admin(uuid, text);
--   drop table public.mdr_duty_lock_pauses;
-- (frontend বিরতি না পেলে আগের মতো লক চালু রাখে, তাই শুধু DB rollback-এও অ্যাপ ভাঙে না)
--
-- নোট: কোনো function-এ DELETE নেই — বিরতি শেষ = মেয়াদ গতকাল; মেয়াদোত্তীর্ণ row তালিকায় বাদ পড়ে।
-- live DB-তে এটি কয়েক ভাগে apply হয়েছে (mdr_duty_lock_pauses_table, mdr_duty_pause_fn_*), ফলাফল এই ফাইলের সমান।

create table if not exists public.mdr_duty_lock_pauses (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.mdr_classes(id) on delete cascade,
  paused_until date not null,
  created_by uuid references public.mdr_shared_users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- একই scope-এ (একটি বর্ষ বা "সব") একটাই বিরতি
create unique index if not exists mdr_duty_lock_pauses_scope_uidx
  on public.mdr_duty_lock_pauses ((coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)));

alter table public.mdr_duty_lock_pauses enable row level security;
revoke all on table public.mdr_duty_lock_pauses from public, anon, authenticated;

-- ── শুধু মূল জিম্মাদার (role = 'admin')
create or replace function private.mdr_duty_pause_main_admin(p_actor_id uuid, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  if p_pin is null or p_pin = '' then
    return null;
  end if;
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  if v_actor.id is null or v_actor.role <> 'admin' then
    return null;
  end if;
  return v_actor.id;
end;
$$;
revoke all on function private.mdr_duty_pause_main_admin(uuid, text) from public, anon, authenticated;

-- ── তালিকা: চলমান বিরতি + বর্ষের তালিকা (সেটিং পেজের জন্য)
create or replace function public.mdr_rel_admin_duty_pause_list(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if private.mdr_duty_pause_main_admin(p_actor_id, p_pin) is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'today', v_today,
    'pauses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'class_id', p.class_id,
        'class_name', c.name,
        'paused_until', p.paused_until
      ) order by (p.class_id is not null), c.sort_order nulls last, c.name)
      from public.mdr_duty_lock_pauses p
      left join public.mdr_classes c on c.id = p.class_id
      where p.paused_until >= v_today
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order nulls last, c.name)
      from public.mdr_classes c
      where c.is_active is distinct from false
    ), '[]'::jsonb)
  );
end;
$$;

-- ── বিরতি দেওয়া/বদলানো: p_class_id null = সব বর্ষ; p_days = আজসহ কত দিন (১–৯০)
create or replace function public.mdr_rel_admin_duty_pause_set(
  p_actor_id uuid,
  p_pin text,
  p_class_id uuid,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_until date;
begin
  v_admin := private.mdr_duty_pause_main_admin(p_actor_id, p_pin);
  if v_admin is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    return jsonb_build_object('ok', false, 'error', 'invalid_days');
  end if;
  if p_class_id is not null and not exists (select 1 from public.mdr_classes c where c.id = p_class_id) then
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  v_until := v_today + (p_days - 1);

  insert into public.mdr_duty_lock_pauses (class_id, paused_until, created_by)
  values (p_class_id, v_until, v_admin)
  on conflict ((coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  do update set paused_until = excluded.paused_until,
                created_by = excluded.created_by,
                created_at = now();

  return jsonb_build_object('ok', true, 'paused_until', v_until);
end;
$$;

-- ── বিরতি শেষ করা (লক আবার চালু)
create or replace function public.mdr_rel_admin_duty_pause_clear(p_actor_id uuid, p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.mdr_duty_pause_main_admin(p_actor_id, p_pin) is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  -- মেয়াদ গতকালে নামিয়ে দিলেই বিরতি শেষ (row রেখে দেওয়া হয়, পরের set একই row হালনাগাদ করে)
  update public.mdr_duty_lock_pauses
  set paused_until = (now() at time zone 'Asia/Dhaka')::date - 1
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── শিক্ষক: নিজের বর্ষে (বা সবার জন্য) বিরতি চলছে কিনা
create or replace function public.mdr_rel_teacher_duty_pause_status(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_until date;
begin
  select u.class_id into v_class
  from public.mdr_shared_users u
  where u.id = p_actor_id
    and u.is_active = true
    and u.role = 'madrasa_teacher'
    and u.class_id is not null
    and private.mdr_pin_ok(u.pin, p_pin, p_actor_id::text);

  if v_class is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_teacher');
  end if;

  select max(p.paused_until) into v_until
  from public.mdr_duty_lock_pauses p
  where (p.class_id is null or p.class_id = v_class)
    and p.paused_until >= v_today;

  return jsonb_build_object(
    'ok', true,
    'today', v_today,
    'paused', v_until is not null,
    'paused_until', v_until
  );
end;
$$;

revoke all on function public.mdr_rel_admin_duty_pause_list(uuid, text) from public;
revoke all on function public.mdr_rel_admin_duty_pause_set(uuid, text, uuid, integer) from public;
revoke all on function public.mdr_rel_admin_duty_pause_clear(uuid, text, uuid) from public;
revoke all on function public.mdr_rel_teacher_duty_pause_status(uuid, text) from public;
grant execute on function public.mdr_rel_admin_duty_pause_list(uuid, text) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_admin_duty_pause_set(uuid, text, uuid, integer) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_admin_duty_pause_clear(uuid, text, uuid) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_teacher_duty_pause_status(uuid, text) to anon, authenticated, service_role;
