-- শিক্ষক হাজিরা: নিজামের প্রতিটি দরসে শিক্ষকের শুরু-শেষ (বর্ষ দায়িত্বশীলের লগইনের কিয়স্ক থেকে)।
-- সময় সবসময় সার্ভারের now(), হিসাব Asia/Dhaka অনুযায়ী।
-- নিয়ম: নিজামের ১৫ মিনিট আগে থেকে শুরু, ৫ মিনিট ছাড়, শেষ না চাপলে নিজাম-শেষের ৬০ মিনিট পর অটো-বন্ধ।

-- ── টেবিল ─────────────────────────────────────────────────────────────

create table if not exists public.mdr_dars_teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  is_active boolean not null default true,
  created_by uuid references public.mdr_shared_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mdr_dars_teachers_name_chk check (char_length(btrim(name)) between 1 and 120)
);

create table if not exists public.mdr_dars_teacher_classes (
  teacher_id uuid not null references public.mdr_dars_teachers(id) on delete cascade,
  class_id uuid not null references public.mdr_classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, class_id)
);

create index if not exists mdr_dars_teacher_classes_class_idx
  on public.mdr_dars_teacher_classes (class_id);

alter table public.mdr_class_routine_slots
  add column if not exists dars_teacher_id uuid references public.mdr_dars_teachers(id) on delete set null;

create table if not exists public.mdr_dars_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.mdr_classes(id) on delete cascade,
  session_date date not null,
  sched_start_min integer not null,
  sched_end_min integer not null,
  slot_label text not null default '',
  teacher_kind text not null,
  teacher_user_id uuid references public.mdr_shared_users(id) on delete set null,
  dars_teacher_id uuid references public.mdr_dars_teachers(id) on delete set null,
  teacher_name text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  end_kind text,
  late_min integer not null default 0,
  auto_closed boolean not null default false,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mdr_dars_sessions_slot_uniq unique (class_id, session_date, sched_start_min),
  constraint mdr_dars_sessions_start_chk check (sched_start_min between 0 and 1439),
  constraint mdr_dars_sessions_sched_chk check (sched_end_min > sched_start_min),
  constraint mdr_dars_sessions_kind_chk check (teacher_kind in ('lead', 'dars')),
  constraint mdr_dars_sessions_end_kind_chk check (end_kind is null or end_kind in ('manual', 'next', 'auto', 'admin')),
  constraint mdr_dars_sessions_end_chk check (ended_at is null or ended_at >= started_at)
);

create index if not exists mdr_dars_sessions_date_class_idx
  on public.mdr_dars_sessions (session_date, class_id);

create index if not exists mdr_dars_sessions_open_idx
  on public.mdr_dars_sessions (session_date)
  where ended_at is null and auto_closed = false;

create table if not exists public.mdr_dars_session_fixes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mdr_dars_sessions(id) on delete cascade,
  old_started_at timestamptz,
  old_ended_at timestamptz,
  new_started_at timestamptz not null,
  new_ended_at timestamptz not null,
  reason text not null,
  fixed_by uuid references public.mdr_shared_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mdr_dars_session_fixes_reason_chk check (char_length(btrim(reason)) > 0)
);

create index if not exists mdr_dars_session_fixes_session_idx
  on public.mdr_dars_session_fixes (session_id, created_at desc);

create table if not exists public.mdr_dars_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  class_id uuid references public.mdr_classes(id) on delete cascade,
  note text not null default '',
  created_by uuid references public.mdr_shared_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists mdr_dars_holidays_uniq
  on public.mdr_dars_holidays (holiday_date, coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.mdr_dars_settings (
  id smallint primary key default 1,
  friday_off boolean not null default true,
  updated_by uuid references public.mdr_shared_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mdr_dars_settings_single_chk check (id = 1)
);

insert into public.mdr_dars_settings (id) values (1) on conflict (id) do nothing;

alter table public.mdr_dars_teachers enable row level security;
alter table public.mdr_dars_teacher_classes enable row level security;
alter table public.mdr_dars_sessions enable row level security;
alter table public.mdr_dars_session_fixes enable row level security;
alter table public.mdr_dars_holidays enable row level security;
alter table public.mdr_dars_settings enable row level security;

drop policy if exists "deny_all_mdr_dars_teachers" on public.mdr_dars_teachers;
create policy "deny_all_mdr_dars_teachers"
  on public.mdr_dars_teachers for all using (false) with check (false);

drop policy if exists "deny_all_mdr_dars_teacher_classes" on public.mdr_dars_teacher_classes;
create policy "deny_all_mdr_dars_teacher_classes"
  on public.mdr_dars_teacher_classes for all using (false) with check (false);

drop policy if exists "deny_all_mdr_dars_sessions" on public.mdr_dars_sessions;
create policy "deny_all_mdr_dars_sessions"
  on public.mdr_dars_sessions for all using (false) with check (false);

drop policy if exists "deny_all_mdr_dars_session_fixes" on public.mdr_dars_session_fixes;
create policy "deny_all_mdr_dars_session_fixes"
  on public.mdr_dars_session_fixes for all using (false) with check (false);

drop policy if exists "deny_all_mdr_dars_holidays" on public.mdr_dars_holidays;
create policy "deny_all_mdr_dars_holidays"
  on public.mdr_dars_holidays for all using (false) with check (false);

drop policy if exists "deny_all_mdr_dars_settings" on public.mdr_dars_settings;
create policy "deny_all_mdr_dars_settings"
  on public.mdr_dars_settings for all using (false) with check (false);

-- ── সময় helper ─────────────────────────────────────────────────────────

create or replace function private.mdr_dars_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Dhaka')::date;
$$;

create or replace function private.mdr_dars_now_min()
returns integer
language sql
stable
as $$
  select (extract(hour from (now() at time zone 'Asia/Dhaka')) * 60
    + extract(minute from (now() at time zone 'Asia/Dhaka')))::integer;
$$;

create or replace function private.mdr_dars_min_ts(p_date date, p_min integer)
returns timestamptz
language sql
stable
as $$
  select ((p_date::timestamp + make_interval(mins => p_min)) at time zone 'Asia/Dhaka');
$$;

create or replace function private.mdr_dars_ts_min(p_date date, p_ts timestamptz)
returns integer
language sql
stable
as $$
  select case when p_ts is null then null
    else floor(extract(epoch from ((p_ts at time zone 'Asia/Dhaka') - p_date::timestamp)) / 60)::integer
  end;
$$;

create or replace function private.mdr_dars_end_min(
  p_start_min integer,
  p_end_hour smallint,
  p_end_minute smallint,
  p_end_ampm text
)
returns integer
language sql
immutable
as $$
  select case
    when p_end_hour is null or p_end_ampm is null then p_start_min + 60
    when private.mdr_routine_time_sort_key(p_end_hour, coalesce(p_end_minute, 0::smallint), p_end_ampm) > p_start_min
      then private.mdr_routine_time_sort_key(p_end_hour, coalesce(p_end_minute, 0::smallint), p_end_ampm)
    else p_start_min + 60
  end;
$$;

-- ── ডোমেইন helper ──────────────────────────────────────────────────────

create or replace function private.mdr_dars_teacher_actor(p_actor_id uuid, p_pin text)
returns public.mdr_shared_users
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  select * into v_actor
  from public.mdr_shared_users u
  where u.id = p_actor_id
    and u.is_active = true
    and u.pin = p_pin
    and u.role = 'madrasa_teacher'
    and u.class_id is not null
  limit 1;
  return v_actor;
end;
$$;

create or replace function private.mdr_dars_admin_depts(p_admin public.mdr_shared_users)
returns text[]
language plpgsql
stable
as $$
begin
  if p_admin.id is null then
    return null;
  end if;
  if p_admin.role = 'admin' or coalesce(p_admin.admin_perms->>'super_admin', 'false') = 'true' then
    return array['kitab', 'maktab']::text[];
  end if;
  if coalesce(p_admin.admin_perms->'permissions'->>'teacher_hazira', 'false') <> 'true' then
    return null;
  end if;
  return array(
    select value
    from jsonb_array_elements_text(coalesce(p_admin.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) as t(value)
    where value in ('kitab', 'maktab')
  );
end;
$$;

create or replace function private.mdr_dars_class_in_depts(p_class_id uuid, p_depts text[])
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.mdr_classes c
    join public.mdr_divisions d on d.id = c.division_id
    where c.id = p_class_id
      and c.is_active = true
      and d.code = any(coalesce(p_depts, array[]::text[]))
  );
$$;

create or replace function private.mdr_dars_holiday_note(p_class_id uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select coalesce(nullif(btrim(h.note), ''), 'বর্ষের ছুটি')
       from public.mdr_dars_holidays h
      where h.holiday_date = p_date and h.class_id = p_class_id
      limit 1),
    (select coalesce(nullif(btrim(h.note), ''), 'ছুটি')
       from public.mdr_dars_holidays h
      where h.holiday_date = p_date and h.class_id is null
      limit 1),
    (select 'শুক্রবার'
       from public.mdr_dars_settings s
      where s.id = 1 and s.friday_off = true and extract(isodow from p_date) = 5)
  );
$$;

create or replace function private.mdr_dars_routine_for(p_class_id uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select r.id from public.mdr_class_routines r
      where r.class_id = p_class_id and r.is_current = true
        and p_date >= private.mdr_dars_today()
      limit 1),
    (select r.id from public.mdr_class_routines r
      where r.class_id = p_class_id
        and (r.created_at at time zone 'Asia/Dhaka')::date <= p_date
      order by r.created_at desc
      limit 1),
    (select r.id from public.mdr_class_routines r
      where r.class_id = p_class_id and r.is_current = true
      limit 1)
  );
$$;

create or replace function private.mdr_dars_autoclose()
returns void
language sql
security definer
set search_path = public, private
as $$
  update public.mdr_dars_sessions x
     set auto_closed = true,
         end_kind = 'auto',
         updated_at = now()
   where x.ended_at is null
     and x.auto_closed = false
     and now() >= private.mdr_dars_min_ts(x.session_date, x.sched_end_min + 60);
$$;

-- এক বর্ষের এক দিনের দরস-তালিকা + অবস্থা (নিজাম + রেকর্ড মিলিয়ে)।
create or replace function private.mdr_dars_day_slots(p_class_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_today date := private.mdr_dars_today();
  v_now_min integer;
  v_routine uuid;
  v_holiday text;
  v_lead_id uuid;
  v_lead_name text;
  v_first date;
  v_tracked boolean;
  v_out jsonb;
begin
  if p_date < v_today then
    v_now_min := 100000;
  elsif p_date > v_today then
    v_now_min := -100000;
  else
    v_now_min := private.mdr_dars_now_min();
  end if;

  v_routine := private.mdr_dars_routine_for(p_class_id, p_date);
  v_holiday := private.mdr_dars_holiday_note(p_class_id, p_date);

  select u.id, u.name into v_lead_id, v_lead_name
  from public.mdr_shared_users u
  where u.class_id = p_class_id and u.role = 'madrasa_teacher' and u.is_active = true
  order by u.created_at
  limit 1;

  select min(x.session_date) into v_first
  from public.mdr_dars_sessions x
  where x.class_id = p_class_id;

  v_tracked := p_date >= v_today or (v_first is not null and p_date >= v_first);

  with planned as (
    select
      s.id as slot_id,
      private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm) as st,
      private.mdr_dars_end_min(
        private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
        s.end_hour, s.end_minute, s.end_ampm
      ) as en,
      s.label,
      t.id as dt_id,
      t.name as dt_name
    from public.mdr_class_routine_slots s
    left join public.mdr_dars_teachers t
      on t.id = s.dars_teacher_id
     and t.is_active = true
     and exists (
       select 1 from public.mdr_dars_teacher_classes tc
        where tc.teacher_id = t.id and tc.class_id = p_class_id
     )
    where v_routine is not null
      and s.routine_id = v_routine
      and s.activity_type in ('dars', 'revision', 'kitab')
  ),
  ses as (
    select x.*
    from public.mdr_dars_sessions x
    where x.class_id = p_class_id and x.session_date = p_date
  ),
  merged as (
    select
      coalesce(p.st, x.sched_start_min) as st,
      coalesce(p.en, x.sched_end_min) as en,
      coalesce(p.label, x.slot_label) as label,
      p.slot_id,
      p.dt_id,
      p.dt_name,
      x.id as sid,
      x.teacher_kind,
      x.teacher_user_id,
      x.dars_teacher_id as x_dt_id,
      x.teacher_name as x_name,
      x.started_at,
      x.ended_at,
      x.end_kind,
      x.late_min,
      x.auto_closed,
      x.corrected
    from planned p
    full join ses x on x.sched_start_min = p.st
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'start_min', m.st,
    'end_min', m.en,
    'label', m.label,
    'slot_id', m.slot_id,
    'in_routine', m.slot_id is not null,
    'status', case
      when m.sid is not null then
        case
          when m.ended_at is not null then 'done'
          when m.auto_closed or v_now_min >= m.en + 60 then 'auto'
          else 'live'
        end
      when v_holiday is not null then 'holiday'
      when not v_tracked then 'untracked'
      when v_now_min < m.st - 15 then 'upcoming'
      when v_now_min >= m.en + 60 then 'missed'
      when v_now_min <= m.st + 5 then 'ready'
      else 'late'
    end,
    'teacher_kind', case
      when m.sid is not null then m.teacher_kind
      when m.dt_id is not null then 'dars'
      else 'lead'
    end,
    'teacher_id', case
      when m.sid is not null then coalesce(m.x_dt_id, m.teacher_user_id)
      when m.dt_id is not null then m.dt_id
      else v_lead_id
    end,
    'teacher_name', case
      when m.sid is not null then m.x_name
      when m.dt_id is not null then m.dt_name
      else coalesce(v_lead_name, '')
    end,
    'session', case when m.sid is null then null else jsonb_build_object(
      'id', m.sid,
      'started_at', m.started_at,
      'ended_at', m.ended_at,
      'started_min', private.mdr_dars_ts_min(p_date, m.started_at),
      'ended_min', private.mdr_dars_ts_min(p_date, m.ended_at),
      'end_kind', m.end_kind,
      'late_min', m.late_min,
      'corrected', m.corrected,
      'fix_reason', (
        select f.reason from public.mdr_dars_session_fixes f
         where f.session_id = m.sid
         order by f.created_at desc
         limit 1
      )
    ) end
  ) order by m.st), '[]'::jsonb)
  into v_out
  from merged m;

  return v_out;
end;
$$;

-- ── নিজাম: দরসের শিক্ষক (dars_teacher_id) সেভ ─────────────────────────

create or replace function private.mdr_class_routine_validate_slots(p_slots jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_slot jsonb;
  v_idx integer := 0;
  v_label text;
  v_start_hour integer;
  v_start_minute integer;
  v_start_ampm text;
  v_end_hour integer;
  v_end_minute integer;
  v_end_ampm text;
  v_activity text;
  v_teacher text;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    return jsonb_build_object('ok', false, 'error', 'slots_required');
  end if;
  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    v_idx := v_idx + 1;
    v_label := nullif(btrim(coalesce(v_slot->>'label', '')), '');
    if v_label is null then return jsonb_build_object('ok', false, 'error', 'invalid_slot_label', 'index', v_idx); end if;
    v_start_hour := (v_slot->>'start_hour')::integer;
    v_start_minute := coalesce((v_slot->>'start_minute')::integer, 0);
    v_start_ampm := upper(coalesce(v_slot->>'start_ampm', ''));
    if v_start_hour is null or v_start_hour < 1 or v_start_hour > 12 or v_start_minute < 0 or v_start_minute > 59 or v_start_ampm not in ('AM', 'PM') then
      return jsonb_build_object('ok', false, 'error', 'invalid_start_time', 'index', v_idx);
    end if;
    if v_slot ? 'end_hour' and nullif(v_slot->>'end_hour', '') is not null then
      v_end_hour := (v_slot->>'end_hour')::integer;
      v_end_minute := coalesce((v_slot->>'end_minute')::integer, 0);
      v_end_ampm := upper(coalesce(v_slot->>'end_ampm', ''));
      if v_end_hour < 1 or v_end_hour > 12 or v_end_minute < 0 or v_end_minute > 59 or v_end_ampm not in ('AM', 'PM') then
        return jsonb_build_object('ok', false, 'error', 'invalid_end_time', 'index', v_idx);
      end if;
    end if;
    v_activity := coalesce(nullif(btrim(v_slot->>'activity_type'), ''), 'other');
    if v_activity not in ('dars', 'revision', 'kitab', 'meal', 'rest', 'sports', 'admin', 'other') then
      return jsonb_build_object('ok', false, 'error', 'invalid_activity_type', 'index', v_idx);
    end if;
    v_teacher := nullif(btrim(coalesce(v_slot->>'dars_teacher_id', '')), '');
    if v_teacher is not null
       and v_teacher !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_dars_teacher', 'index', v_idx);
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.mdr_class_routine_insert_slots(p_routine_id uuid, p_slots jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_slot jsonb;
  v_idx integer := 0;
  v_class_id uuid;
  v_teacher uuid;
  v_has_end boolean;
begin
  select r.class_id into v_class_id from public.mdr_class_routines r where r.id = p_routine_id;

  for v_slot in select value from jsonb_array_elements(p_slots) loop
    v_idx := v_idx + 1;
    v_teacher := nullif(btrim(coalesce(v_slot->>'dars_teacher_id', '')), '')::uuid;
    if v_teacher is not null and not exists (
      select 1
      from public.mdr_dars_teacher_classes tc
      join public.mdr_dars_teachers t on t.id = tc.teacher_id
      where tc.teacher_id = v_teacher and tc.class_id = v_class_id and t.is_active = true
    ) then
      v_teacher := null;
    end if;
    v_has_end := v_slot ? 'end_hour' and nullif(v_slot->>'end_hour', '') is not null;

    insert into public.mdr_class_routine_slots (
      routine_id, sort_order, start_hour, start_minute, start_ampm,
      end_hour, end_minute, end_ampm, label, activity_type, dars_teacher_id
    )
    values (
      p_routine_id,
      coalesce((v_slot->>'sort_order')::integer, v_idx),
      (v_slot->>'start_hour')::integer,
      coalesce((v_slot->>'start_minute')::integer, 0),
      upper(v_slot->>'start_ampm'),
      case when v_has_end then (v_slot->>'end_hour')::integer else null end,
      case when v_has_end then coalesce((v_slot->>'end_minute')::integer, 0) else null end,
      case when v_has_end then upper(v_slot->>'end_ampm') else null end,
      btrim(v_slot->>'label'),
      coalesce(nullif(btrim(v_slot->>'activity_type'), ''), 'other'),
      v_teacher
    );
  end loop;
end;
$$;

create or replace function private.mdr_class_routine_slots_json(p_routine_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'sort_order', s.sort_order,
    'start_hour', s.start_hour,
    'start_minute', s.start_minute,
    'start_ampm', s.start_ampm,
    'end_hour', s.end_hour,
    'end_minute', s.end_minute,
    'end_ampm', s.end_ampm,
    'label', s.label,
    'activity_type', s.activity_type,
    'dars_teacher_id', s.dars_teacher_id,
    'dars_teacher_name', t.name
  ) order by
    s.sort_order,
    private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
    s.label), '[]'::jsonb)
  from public.mdr_class_routine_slots s
  left join public.mdr_dars_teachers t on t.id = s.dars_teacher_id
  where s.routine_id = p_routine_id;
$$;

-- ── বর্ষ দায়িত্বশীল / কিয়স্ক RPC ──────────────────────────────────────

create or replace function public.mdr_rel_dars_class_teachers(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  v_actor := private.mdr_dars_teacher_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead', jsonb_build_object('id', v_actor.id, 'name', v_actor.name),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from public.mdr_dars_teachers t
      join public.mdr_dars_teacher_classes tc on tc.teacher_id = t.id
      where tc.class_id = v_actor.class_id and t.is_active = true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mdr_rel_dars_kiosk_get(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_today date := private.mdr_dars_today();
  v_class public.mdr_classes%rowtype;
begin
  v_actor := private.mdr_dars_teacher_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  perform private.mdr_dars_autoclose();

  select * into v_class from public.mdr_classes c where c.id = v_actor.class_id;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'today', v_today,
    'now_min', private.mdr_dars_now_min(),
    'rules', jsonb_build_object('early', 15, 'grace', 5, 'auto_after', 60),
    'class', jsonb_build_object('id', v_class.id, 'code', v_class.code, 'name', v_class.name),
    'lead', jsonb_build_object('id', v_actor.id, 'name', v_actor.name),
    'has_routine', exists (
      select 1 from public.mdr_class_routines r
       where r.class_id = v_actor.class_id and r.is_current = true
    ),
    'holiday', private.mdr_dars_holiday_note(v_actor.class_id, v_today),
    'class_holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'note', h.note) order by h.holiday_date)
      from public.mdr_dars_holidays h
      where h.class_id = v_actor.class_id
        and h.holiday_date between v_today and v_today + 60
    ), '[]'::jsonb),
    'global_holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'note', h.note) order by h.holiday_date)
      from public.mdr_dars_holidays h
      where h.class_id is null
        and h.holiday_date between v_today and v_today + 60
    ), '[]'::jsonb),
    'friday_off', coalesce((select s.friday_off from public.mdr_dars_settings s where s.id = 1), true),
    'slots', private.mdr_dars_day_slots(v_actor.class_id, v_today)
  );
end;
$$;

create or replace function public.mdr_rel_dars_start(
  p_actor_id uuid,
  p_pin text,
  p_start_min integer,
  p_teacher_pin text,
  p_close_prev boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_today date := private.mdr_dars_today();
  v_now timestamptz := now();
  v_now_min integer := private.mdr_dars_now_min();
  v_routine uuid;
  v_st integer;
  v_en integer;
  v_label text;
  v_dt_id uuid;
  v_dt_name text;
  v_dt_hash text;
  v_kind text;
  v_pin_ok boolean;
  v_live public.mdr_dars_sessions%rowtype;
  v_late integer;
  v_id uuid;
begin
  v_actor := private.mdr_dars_teacher_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  if private.mdr_dars_holiday_note(v_actor.class_id, v_today) is not null then
    return jsonb_build_object('ok', false, 'error', 'holiday');
  end if;

  select r.id into v_routine
  from public.mdr_class_routines r
  where r.class_id = v_actor.class_id and r.is_current = true
  limit 1;

  select
    private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
    private.mdr_dars_end_min(
      private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
      s.end_hour, s.end_minute, s.end_ampm
    ),
    s.label,
    t.id,
    t.name,
    t.pin_hash
  into v_st, v_en, v_label, v_dt_id, v_dt_name, v_dt_hash
  from public.mdr_class_routine_slots s
  left join public.mdr_dars_teachers t
    on t.id = s.dars_teacher_id
   and t.is_active = true
   and exists (
     select 1 from public.mdr_dars_teacher_classes tc
      where tc.teacher_id = t.id and tc.class_id = v_actor.class_id
   )
  where v_routine is not null
    and s.routine_id = v_routine
    and s.activity_type in ('dars', 'revision', 'kitab')
    and private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm) = p_start_min
  order by s.sort_order
  limit 1;

  if v_st is null then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found');
  end if;

  if v_now_min < v_st - 15 then
    return jsonb_build_object('ok', false, 'error', 'too_early', 'opens_min', v_st - 15);
  end if;
  if v_now_min >= v_en + 60 then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;

  if exists (
    select 1 from public.mdr_dars_sessions x
     where x.class_id = v_actor.class_id and x.session_date = v_today and x.sched_start_min = v_st
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_started');
  end if;

  if v_dt_id is not null then
    v_kind := 'dars';
    v_pin_ok := coalesce(p_teacher_pin, '') <> ''
      and v_dt_hash = extensions.crypt(p_teacher_pin, v_dt_hash);
  else
    v_kind := 'lead';
    v_pin_ok := coalesce(p_teacher_pin, '') <> '' and p_teacher_pin = v_actor.pin;
  end if;

  if not v_pin_ok then
    return jsonb_build_object(
      'ok', false,
      'error', 'wrong_pin',
      'teacher_name', case when v_kind = 'dars' then v_dt_name else v_actor.name end
    );
  end if;

  select * into v_live
  from public.mdr_dars_sessions x
  where x.class_id = v_actor.class_id
    and x.session_date = v_today
    and x.ended_at is null
    and x.auto_closed = false
    and v_now_min < x.sched_end_min + 60
  order by x.sched_start_min
  limit 1
  for update;

  if v_live.id is not null then
    if not coalesce(p_close_prev, false) then
      return jsonb_build_object(
        'ok', false,
        'error', 'other_live',
        'live_label', v_live.slot_label,
        'live_teacher', v_live.teacher_name
      );
    end if;
    update public.mdr_dars_sessions
       set ended_at = greatest(v_now, started_at),
           end_kind = 'next',
           updated_at = now()
     where id = v_live.id;
  end if;

  v_late := v_now_min - v_st;
  if v_late <= 5 then
    v_late := 0;
  end if;

  insert into public.mdr_dars_sessions (
    class_id, session_date, sched_start_min, sched_end_min, slot_label,
    teacher_kind, teacher_user_id, dars_teacher_id, teacher_name,
    started_at, late_min
  )
  values (
    v_actor.class_id, v_today, v_st, v_en, v_label,
    v_kind,
    case when v_kind = 'lead' then v_actor.id else null end,
    case when v_kind = 'dars' then v_dt_id else null end,
    case when v_kind = 'dars' then v_dt_name else v_actor.name end,
    v_now, v_late
  )
  on conflict (class_id, session_date, sched_start_min) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_started');
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_id,
    'late_min', v_late,
    'closed_prev', v_live.id is not null
  );
end;
$$;

create or replace function public.mdr_rel_dars_end(
  p_actor_id uuid,
  p_pin text,
  p_start_min integer,
  p_teacher_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_today date := private.mdr_dars_today();
  v_now_min integer := private.mdr_dars_now_min();
  v_ses public.mdr_dars_sessions%rowtype;
  v_hash text;
  v_lead_pin text;
  v_pin_ok boolean;
begin
  v_actor := private.mdr_dars_teacher_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  select * into v_ses
  from public.mdr_dars_sessions x
  where x.class_id = v_actor.class_id
    and x.session_date = v_today
    and x.sched_start_min = p_start_min
  for update;

  if v_ses.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_started');
  end if;
  if v_ses.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_ended');
  end if;
  if v_ses.auto_closed or v_now_min >= v_ses.sched_end_min + 60 then
    return jsonb_build_object('ok', false, 'error', 'auto_closed');
  end if;

  if v_ses.teacher_kind = 'dars' then
    select t.pin_hash into v_hash from public.mdr_dars_teachers t where t.id = v_ses.dars_teacher_id;
    v_pin_ok := v_hash is not null and coalesce(p_teacher_pin, '') <> ''
      and v_hash = extensions.crypt(p_teacher_pin, v_hash);
  else
    select u.pin into v_lead_pin from public.mdr_shared_users u where u.id = v_ses.teacher_user_id;
    v_pin_ok := v_lead_pin is not null and coalesce(p_teacher_pin, '') <> '' and p_teacher_pin = v_lead_pin;
  end if;

  if not v_pin_ok then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'teacher_name', v_ses.teacher_name);
  end if;

  update public.mdr_dars_sessions
     set ended_at = greatest(now(), started_at),
         end_kind = 'manual',
         updated_at = now()
   where id = v_ses.id;

  return jsonb_build_object('ok', true, 'session_id', v_ses.id);
end;
$$;

create or replace function public.mdr_rel_dars_class_off_set(
  p_actor_id uuid,
  p_pin text,
  p_date date,
  p_off boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_today date := private.mdr_dars_today();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_actor := private.mdr_dars_teacher_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 60 then
    return jsonb_build_object('ok', false, 'error', 'invalid_date');
  end if;

  if coalesce(p_off, false) then
    if v_note is null then
      return jsonb_build_object('ok', false, 'error', 'note_required');
    end if;
    if exists (
      select 1 from public.mdr_dars_sessions x
       where x.class_id = v_actor.class_id and x.session_date = p_date
    ) then
      return jsonb_build_object('ok', false, 'error', 'has_sessions');
    end if;
    update public.mdr_dars_holidays
       set note = left(v_note, 200)
     where holiday_date = p_date and class_id = v_actor.class_id;
    if not found then
      insert into public.mdr_dars_holidays (holiday_date, class_id, note, created_by)
      values (p_date, v_actor.class_id, left(v_note, 200), v_actor.id);
    end if;
  else
    delete from public.mdr_dars_holidays
     where holiday_date = p_date and class_id = v_actor.class_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── অ্যাডমিন RPC ───────────────────────────────────────────────────────

create or replace function public.mdr_rel_dars_admin_bootstrap(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_today date := private.mdr_dars_today();
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'today', v_today,
    'now_min', private.mdr_dars_now_min(),
    'depts', to_jsonb(v_depts),
    'can_global', v_depts @> array['kitab', 'maktab']::text[],
    'friday_off', coalesce((select s.friday_off from public.mdr_dars_settings s where s.id = 1), true),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'code', c.code,
        'name', c.name,
        'sort_order', c.sort_order,
        'division_code', d.code,
        'lead_name', (
          select u.name from public.mdr_shared_users u
           where u.class_id = c.id and u.role = 'madrasa_teacher' and u.is_active = true
           order by u.created_at limit 1
        )
      ) order by d.code, c.sort_order, c.name)
      from public.mdr_classes c
      join public.mdr_divisions d on d.id = c.division_id
      where c.is_active = true and d.code = any(v_depts)
    ), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'date', h.holiday_date, 'class_id', h.class_id, 'note', h.note
      ) order by h.holiday_date, h.class_id nulls first)
      from public.mdr_dars_holidays h
      where h.holiday_date >= v_today - 7
        and (h.class_id is null or private.mdr_dars_class_in_depts(h.class_id, v_depts))
    ), '[]'::jsonb),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'is_active', t.is_active,
        'class_ids', coalesce((
          select jsonb_agg(tc.class_id)
          from public.mdr_dars_teacher_classes tc
          where tc.teacher_id = t.id and private.mdr_dars_class_in_depts(tc.class_id, v_depts)
        ), '[]'::jsonb)
      ) order by t.is_active desc, t.name)
      from public.mdr_dars_teachers t
      where not exists (select 1 from public.mdr_dars_teacher_classes tc where tc.teacher_id = t.id)
         or exists (
           select 1 from public.mdr_dars_teacher_classes tc
            where tc.teacher_id = t.id and private.mdr_dars_class_in_depts(tc.class_id, v_depts)
         )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mdr_rel_dars_admin_board(p_actor_id uuid, p_pin text, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_date date := coalesce(p_date, private.mdr_dars_today());
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if v_date > private.mdr_dars_today() then
    return jsonb_build_object('ok', false, 'error', 'future_date');
  end if;

  perform private.mdr_dars_autoclose();

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'date', v_date,
    'today', private.mdr_dars_today(),
    'now_min', private.mdr_dars_now_min(),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'code', c.code,
        'name', c.name,
        'division_code', d.code,
        'lead_name', (
          select u.name from public.mdr_shared_users u
           where u.class_id = c.id and u.role = 'madrasa_teacher' and u.is_active = true
           order by u.created_at limit 1
        ),
        'holiday', private.mdr_dars_holiday_note(c.id, v_date),
        'slots', private.mdr_dars_day_slots(c.id, v_date)
      ) order by d.code, c.sort_order, c.name)
      from public.mdr_classes c
      join public.mdr_divisions d on d.id = c.division_id
      where c.is_active = true and d.code = any(v_depts)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mdr_rel_dars_admin_report(
  p_actor_id uuid,
  p_pin text,
  p_class_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_today date := private.mdr_dars_today();
  v_to date;
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    return jsonb_build_object('ok', false, 'error', 'invalid_range');
  end if;
  if p_class_id is not null and not private.mdr_dars_class_in_depts(p_class_id, v_depts) then
    return jsonb_build_object('ok', false, 'error', 'class_not_allowed');
  end if;

  perform private.mdr_dars_autoclose();
  v_to := least(p_to, v_today);

  return jsonb_build_object(
    'ok', true,
    'from', p_from,
    'to', v_to,
    'today', v_today,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', g.d::date,
        'classes', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'division_code', dv.code,
            'holiday', private.mdr_dars_holiday_note(c.id, g.d::date),
            'slots', private.mdr_dars_day_slots(c.id, g.d::date)
          ) order by dv.code, c.sort_order, c.name), '[]'::jsonb)
          from public.mdr_classes c
          join public.mdr_divisions dv on dv.id = c.division_id
          where c.is_active = true
            and dv.code = any(v_depts)
            and (p_class_id is null or c.id = p_class_id)
        )
      ) order by g.d)
      from generate_series(p_from::timestamp, v_to::timestamp, interval '1 day') as g(d)
      where p_from <= v_to
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mdr_rel_dars_admin_fix(
  p_actor_id uuid,
  p_pin text,
  p_class_id uuid,
  p_date date,
  p_start_min integer,
  p_started_min integer,
  p_ended_min integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ses public.mdr_dars_sessions%rowtype;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_late integer;
  v_routine uuid;
  v_st integer;
  v_en integer;
  v_label text;
  v_dt_id uuid;
  v_dt_name text;
  v_lead_id uuid;
  v_lead_name text;
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if p_class_id is null or not private.mdr_dars_class_in_depts(p_class_id, v_depts) then
    return jsonb_build_object('ok', false, 'error', 'class_not_allowed');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  if p_date is null or p_date > private.mdr_dars_today() then
    return jsonb_build_object('ok', false, 'error', 'invalid_date');
  end if;
  if p_started_min is null or p_ended_min is null
     or p_started_min < 0 or p_ended_min > 1439 or p_ended_min <= p_started_min then
    return jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  v_new_start := private.mdr_dars_min_ts(p_date, p_started_min);
  v_new_end := private.mdr_dars_min_ts(p_date, p_ended_min);
  if v_new_end > now() then
    return jsonb_build_object('ok', false, 'error', 'end_in_future');
  end if;

  select * into v_ses
  from public.mdr_dars_sessions x
  where x.class_id = p_class_id and x.session_date = p_date and x.sched_start_min = p_start_min
  for update;

  if v_ses.id is null then
    v_routine := private.mdr_dars_routine_for(p_class_id, p_date);
    select
      private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
      private.mdr_dars_end_min(
        private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
        s.end_hour, s.end_minute, s.end_ampm
      ),
      s.label, t.id, t.name
    into v_st, v_en, v_label, v_dt_id, v_dt_name
    from public.mdr_class_routine_slots s
    left join public.mdr_dars_teachers t
      on t.id = s.dars_teacher_id
     and t.is_active = true
     and exists (
       select 1 from public.mdr_dars_teacher_classes tc
        where tc.teacher_id = t.id and tc.class_id = p_class_id
     )
    where v_routine is not null
      and s.routine_id = v_routine
      and s.activity_type in ('dars', 'revision', 'kitab')
      and private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm) = p_start_min
    order by s.sort_order
    limit 1;

    if v_st is null then
      return jsonb_build_object('ok', false, 'error', 'slot_not_found');
    end if;

    select u.id, u.name into v_lead_id, v_lead_name
    from public.mdr_shared_users u
    where u.class_id = p_class_id and u.role = 'madrasa_teacher' and u.is_active = true
    order by u.created_at
    limit 1;

    v_late := p_started_min - v_st;
    if v_late <= 5 then v_late := 0; end if;

    insert into public.mdr_dars_sessions (
      class_id, session_date, sched_start_min, sched_end_min, slot_label,
      teacher_kind, teacher_user_id, dars_teacher_id, teacher_name,
      started_at, ended_at, end_kind, late_min, corrected
    )
    values (
      p_class_id, p_date, v_st, v_en, v_label,
      case when v_dt_id is not null then 'dars' else 'lead' end,
      case when v_dt_id is null then v_lead_id else null end,
      v_dt_id,
      coalesce(v_dt_name, v_lead_name, ''),
      v_new_start, v_new_end, 'admin', v_late, true
    )
    returning * into v_ses;

    insert into public.mdr_dars_session_fixes (
      session_id, old_started_at, old_ended_at, new_started_at, new_ended_at, reason, fixed_by
    )
    values (v_ses.id, null, null, v_new_start, v_new_end, left(v_reason, 300), v_actor.id);
  else
    v_late := p_started_min - v_ses.sched_start_min;
    if v_late <= 5 then v_late := 0; end if;

    insert into public.mdr_dars_session_fixes (
      session_id, old_started_at, old_ended_at, new_started_at, new_ended_at, reason, fixed_by
    )
    values (v_ses.id, v_ses.started_at, v_ses.ended_at, v_new_start, v_new_end, left(v_reason, 300), v_actor.id);

    update public.mdr_dars_sessions
       set started_at = v_new_start,
           ended_at = v_new_end,
           end_kind = 'admin',
           auto_closed = false,
           corrected = true,
           late_min = v_late,
           updated_at = now()
     where id = v_ses.id;
  end if;

  return jsonb_build_object('ok', true, 'session_id', v_ses.id);
end;
$$;

create or replace function public.mdr_rel_dars_admin_teacher_save(
  p_actor_id uuid,
  p_pin text,
  p_teacher_id uuid,
  p_name text,
  p_teacher_pin text,
  p_class_ids uuid[],
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_new_pin text := nullif(btrim(coalesce(p_teacher_pin, '')), '');
  v_id uuid := p_teacher_id;
  v_scope uuid[];
  v_want uuid[];
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if v_name is null or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if v_new_pin is not null and v_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select array(
    select c.id
    from public.mdr_classes c
    join public.mdr_divisions d on d.id = c.division_id
    where c.is_active = true and d.code = any(v_depts)
  ) into v_scope;

  select array(
    select distinct x from unnest(coalesce(p_class_ids, array[]::uuid[])) as x
    where x = any(v_scope)
  ) into v_want;

  if v_id is null then
    if v_new_pin is null then
      return jsonb_build_object('ok', false, 'error', 'pin_required');
    end if;
    if coalesce(array_length(v_want, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'class_required');
    end if;
    insert into public.mdr_dars_teachers (name, pin_hash, is_active, created_by)
    values (v_name, extensions.crypt(v_new_pin, extensions.gen_salt('bf')), coalesce(p_is_active, true), v_actor.id)
    returning id into v_id;
  else
    if not exists (select 1 from public.mdr_dars_teachers t where t.id = v_id) then
      return jsonb_build_object('ok', false, 'error', 'teacher_not_found');
    end if;
    if exists (select 1 from public.mdr_dars_teacher_classes tc where tc.teacher_id = v_id)
       and not exists (
         select 1 from public.mdr_dars_teacher_classes tc
          where tc.teacher_id = v_id and tc.class_id = any(v_scope)
       ) then
      return jsonb_build_object('ok', false, 'error', 'teacher_not_allowed');
    end if;
    update public.mdr_dars_teachers
       set name = v_name,
           is_active = coalesce(p_is_active, is_active),
           pin_hash = case when v_new_pin is null then pin_hash
                           else extensions.crypt(v_new_pin, extensions.gen_salt('bf')) end,
           updated_at = now()
     where id = v_id;
  end if;

  delete from public.mdr_dars_teacher_classes
   where teacher_id = v_id
     and class_id = any(v_scope)
     and not (class_id = any(v_want));

  insert into public.mdr_dars_teacher_classes (teacher_id, class_id)
  select v_id, x from unnest(v_want) as x
  on conflict (teacher_id, class_id) do nothing;

  return jsonb_build_object('ok', true, 'teacher_id', v_id);
end;
$$;

create or replace function public.mdr_rel_dars_admin_holiday_set(
  p_actor_id uuid,
  p_pin text,
  p_date date,
  p_class_id uuid,
  p_on boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_note text := left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), ''), 200);
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if p_date is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_date');
  end if;
  if p_class_id is null then
    if not (v_depts @> array['kitab', 'maktab']::text[]) then
      return jsonb_build_object('ok', false, 'error', 'global_not_allowed');
    end if;
  elsif not private.mdr_dars_class_in_depts(p_class_id, v_depts) then
    return jsonb_build_object('ok', false, 'error', 'class_not_allowed');
  end if;

  if coalesce(p_on, false) then
    update public.mdr_dars_holidays
       set note = v_note
     where holiday_date = p_date
       and class_id is not distinct from p_class_id;
    if not found then
      insert into public.mdr_dars_holidays (holiday_date, class_id, note, created_by)
      values (p_date, p_class_id, v_note, v_actor.id);
    end if;
  else
    delete from public.mdr_dars_holidays
     where holiday_date = p_date
       and class_id is not distinct from p_class_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mdr_rel_dars_admin_settings_save(
  p_actor_id uuid,
  p_pin text,
  p_friday_off boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if not (v_depts @> array['kitab', 'maktab']::text[]) then
    return jsonb_build_object('ok', false, 'error', 'global_not_allowed');
  end if;

  insert into public.mdr_dars_settings (id, friday_off, updated_by, updated_at)
  values (1, coalesce(p_friday_off, true), v_actor.id, now())
  on conflict (id) do update
    set friday_off = excluded.friday_off,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'friday_off', coalesce(p_friday_off, true));
end;
$$;

alter function private.mdr_dars_today() set search_path = '';
alter function private.mdr_dars_now_min() set search_path = '';
alter function private.mdr_dars_min_ts(date, integer) set search_path = '';
alter function private.mdr_dars_ts_min(date, timestamptz) set search_path = '';
alter function private.mdr_dars_end_min(integer, smallint, smallint, text) set search_path = '';
alter function private.mdr_dars_admin_depts(public.mdr_shared_users) set search_path = '';

-- ── grants ─────────────────────────────────────────────────────────────

revoke execute on function private.mdr_dars_today() from public, anon, authenticated;
revoke execute on function private.mdr_dars_now_min() from public, anon, authenticated;
revoke execute on function private.mdr_dars_min_ts(date, integer) from public, anon, authenticated;
revoke execute on function private.mdr_dars_ts_min(date, timestamptz) from public, anon, authenticated;
revoke execute on function private.mdr_dars_end_min(integer, smallint, smallint, text) from public, anon, authenticated;
revoke execute on function private.mdr_dars_teacher_actor(uuid, text) from public, anon, authenticated;
revoke execute on function private.mdr_dars_admin_depts(public.mdr_shared_users) from public, anon, authenticated;
revoke execute on function private.mdr_dars_class_in_depts(uuid, text[]) from public, anon, authenticated;
revoke execute on function private.mdr_dars_holiday_note(uuid, date) from public, anon, authenticated;
revoke execute on function private.mdr_dars_routine_for(uuid, date) from public, anon, authenticated;
revoke execute on function private.mdr_dars_autoclose() from public, anon, authenticated;
revoke execute on function private.mdr_dars_day_slots(uuid, date) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_validate_slots(jsonb) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_insert_slots(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_slots_json(uuid) from public, anon, authenticated;

revoke execute on function public.mdr_rel_dars_class_teachers(uuid, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_kiosk_get(uuid, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_start(uuid, text, integer, text, boolean) from public, authenticated;
revoke execute on function public.mdr_rel_dars_end(uuid, text, integer, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_class_off_set(uuid, text, date, boolean, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_bootstrap(uuid, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_board(uuid, text, date) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_report(uuid, text, uuid, date, date) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_fix(uuid, text, uuid, date, integer, integer, integer, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_teacher_save(uuid, text, uuid, text, text, uuid[], boolean) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_holiday_set(uuid, text, date, uuid, boolean, text) from public, authenticated;
revoke execute on function public.mdr_rel_dars_admin_settings_save(uuid, text, boolean) from public, authenticated;

grant execute on function public.mdr_rel_dars_class_teachers(uuid, text) to anon;
grant execute on function public.mdr_rel_dars_kiosk_get(uuid, text) to anon;
grant execute on function public.mdr_rel_dars_start(uuid, text, integer, text, boolean) to anon;
grant execute on function public.mdr_rel_dars_end(uuid, text, integer, text) to anon;
grant execute on function public.mdr_rel_dars_class_off_set(uuid, text, date, boolean, text) to anon;
grant execute on function public.mdr_rel_dars_admin_bootstrap(uuid, text) to anon;
grant execute on function public.mdr_rel_dars_admin_board(uuid, text, date) to anon;
grant execute on function public.mdr_rel_dars_admin_report(uuid, text, uuid, date, date) to anon;
grant execute on function public.mdr_rel_dars_admin_fix(uuid, text, uuid, date, integer, integer, integer, text) to anon;
grant execute on function public.mdr_rel_dars_admin_teacher_save(uuid, text, uuid, text, text, uuid[], boolean) to anon;
grant execute on function public.mdr_rel_dars_admin_holiday_set(uuid, text, date, uuid, boolean, text) to anon;
grant execute on function public.mdr_rel_dars_admin_settings_save(uuid, text, boolean) to anon;
