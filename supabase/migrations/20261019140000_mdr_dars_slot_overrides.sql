-- শিক্ষক হাজিরা: নির্দিষ্ট দিনে একটি দরসের পরিবর্তন
--   off    — ওই দিনের শুধু এই দরস মওকুফ (রিপোর্টে অনুপস্থিত ধরা হয় না)
--   moved  — ওই দিনে দরস অন্য সময়ে (কিয়স্কে নতুন সময়ে শুরু করা যায়)
--   reason — দরস হয়নি; শিক্ষকের অনুপস্থিতির কারণ (অবস্থা «অনুপস্থিত»-ই থাকে, কারণ দেখায়)
-- প্রতি দিনে প্রতি দরসে (নিজামের আসল শুরু-সময় দিয়ে চেনা) একটিই রেকর্ড।
-- জিম্মাদার/সহকারী (নিজের বিভাগ) — ছুটি দেওয়ার মতো একই অনুমতি।
--
-- Rollback:
--   drop function public.mdr_rel_dars_admin_slot_set(uuid, text, uuid, date, integer, text, integer, integer, text);
--   mdr_dars_day_slots ও mdr_rel_dars_start আগের সংজ্ঞায় ফেরান (20260930120000 + পরের patch);
--   drop table public.mdr_dars_slot_overrides;

create table if not exists public.mdr_dars_slot_overrides (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.mdr_classes(id) on delete cascade,
  session_date date not null,
  slot_start_min integer not null,
  kind text not null,
  new_start_min integer,
  new_end_min integer,
  note text not null default '',
  created_by uuid references public.mdr_shared_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mdr_dars_slot_overrides_uniq unique (class_id, session_date, slot_start_min),
  constraint mdr_dars_slot_overrides_kind_chk check (kind in ('off', 'moved', 'reason')),
  constraint mdr_dars_slot_overrides_moved_chk check (
    kind <> 'moved' or (new_start_min between 0 and 1439 and new_end_min > new_start_min and new_end_min <= 1439)
  )
);

alter table public.mdr_dars_slot_overrides enable row level security;
drop policy if exists mdr_dars_slot_overrides_deny on public.mdr_dars_slot_overrides;
create policy mdr_dars_slot_overrides_deny
  on public.mdr_dars_slot_overrides for all using (false) with check (false);
revoke all on public.mdr_dars_slot_overrides from anon, authenticated;

-- ── দিনের দরস-তালিকা: পরিবর্তন প্রয়োগ ──
create or replace function private.mdr_dars_day_slots(p_class_id uuid, p_date date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'private'
as $function$
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

  with planned0 as (
    select
      s.id as slot_id,
      private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm) as orig_st,
      private.mdr_dars_end_min(
        private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
        s.end_hour, s.end_minute, s.end_ampm
      ) as orig_en,
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
  planned as (
    select
      p.*,
      case when o.kind = 'moved' then o.new_start_min else p.orig_st end as st,
      case when o.kind = 'moved' then o.new_end_min else p.orig_en end as en,
      o.kind as ov_kind,
      o.note as ov_note
    from planned0 p
    left join public.mdr_dars_slot_overrides o
      on o.class_id = p_class_id and o.session_date = p_date and o.slot_start_min = p.orig_st
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
      coalesce(p.orig_st, x.sched_start_min) as orig_st,
      coalesce(p.orig_en, x.sched_end_min) as orig_en,
      coalesce(p.label, x.slot_label) as label,
      p.slot_id,
      p.dt_id,
      p.dt_name,
      p.ov_kind,
      p.ov_note,
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
    'orig_start_min', m.orig_st,
    'orig_end_min', m.orig_en,
    'label', m.label,
    'slot_id', m.slot_id,
    'in_routine', m.slot_id is not null,
    'override', case when m.ov_kind is null then null
      else jsonb_build_object('kind', m.ov_kind, 'note', m.ov_note) end,
    'absent_reason', case when m.ov_kind = 'reason' and m.sid is null then m.ov_note else null end,
    'status', case
      when m.sid is not null then
        case
          when m.ended_at is not null then 'done'
          when m.auto_closed or v_now_min >= m.en + 60 then 'auto'
          else 'live'
        end
      when v_holiday is not null then 'holiday'
      when m.ov_kind = 'off' then 'off'
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
$function$;

-- ── কিয়স্কে দরস শুরু: সময় বদল মানে, মওকুফ হলে শুরু নয় ──
create or replace function public.mdr_rel_dars_start(p_actor_id uuid, p_pin text, p_start_min integer, p_teacher_pin text, p_close_prev boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
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
  v_ov_kind text;
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

  select st, en, label, dt_id, dt_name, dt_hash, ov_kind
  into v_st, v_en, v_label, v_dt_id, v_dt_name, v_dt_hash, v_ov_kind
  from (
    select
      case when o.kind = 'moved' then o.new_start_min else q.orig_st end as st,
      case when o.kind = 'moved' then o.new_end_min else q.orig_en end as en,
      q.label, q.dt_id, q.dt_name, q.dt_hash, q.sort_order,
      o.kind as ov_kind
    from (
      select
        private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm) as orig_st,
        private.mdr_dars_end_min(
          private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
          s.end_hour, s.end_minute, s.end_ampm
        ) as orig_en,
        s.label,
        s.sort_order,
        t.id as dt_id,
        t.name as dt_name,
        t.pin_hash as dt_hash
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
    ) q
    left join public.mdr_dars_slot_overrides o
      on o.class_id = v_actor.class_id and o.session_date = v_today and o.slot_start_min = q.orig_st
  ) z
  where z.st = p_start_min
  order by z.sort_order
  limit 1;

  if v_st is null then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found');
  end if;
  if v_ov_kind = 'off' then
    return jsonb_build_object('ok', false, 'error', 'dars_off');
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
      and private.mdr_pin_ok(v_dt_hash, p_teacher_pin, 'dars:' || v_dt_id::text);
  else
    v_kind := 'lead';
    v_pin_ok := coalesce(p_teacher_pin, '') <> '' and private.mdr_pin_ok(v_actor.pin, p_teacher_pin, v_actor.id::text);
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
$function$;

-- ── জিম্মাদার: একটি দরসের পরিবর্তন রাখা / সরানো ──
-- p_kind: 'off' | 'moved' | 'reason' | null (= পরিবর্তন সরাও)
create or replace function public.mdr_rel_dars_admin_slot_set(
  p_actor_id uuid,
  p_pin text,
  p_class_id uuid,
  p_date date,
  p_slot_start_min integer,
  p_kind text,
  p_new_start_min integer default null,
  p_new_end_min integer default null,
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
  v_note text := left(coalesce(btrim(coalesce(p_note, '')), ''), 300);
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_slots jsonb;
  v_slot jsonb;
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  v_depts := private.mdr_dars_admin_depts(v_actor);
  if v_depts is null then
    return jsonb_build_object('ok', false, 'error', case when v_actor.id is null then 'invalid_actor' else 'permission_denied' end);
  end if;
  if p_class_id is null or not private.mdr_dars_class_in_depts(p_class_id, v_depts) then
    return jsonb_build_object('ok', false, 'error', 'class_not_allowed');
  end if;
  if p_date is null or p_slot_start_min is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if v_kind is not null and v_kind not in ('off', 'moved', 'reason') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;

  -- দরসটি ওই দিনের নিজামে আছে কি না (আসল শুরু-সময় দিয়ে)
  v_slots := private.mdr_dars_day_slots(p_class_id, p_date);
  select x into v_slot
  from jsonb_array_elements(v_slots) x
  where (x->>'orig_start_min')::int = p_slot_start_min and coalesce((x->>'in_routine')::boolean, false)
  limit 1;
  if v_slot is null then
    return jsonb_build_object('ok', false, 'error', 'slot_not_found');
  end if;

  if v_kind is null then
    delete from public.mdr_dars_slot_overrides
     where class_id = p_class_id and session_date = p_date and slot_start_min = p_slot_start_min;
    return jsonb_build_object('ok', true);
  end if;

  if v_kind in ('off', 'moved') and v_slot->'session' is not null and jsonb_typeof(v_slot->'session') = 'object' then
    return jsonb_build_object('ok', false, 'error', 'already_started');
  end if;
  if v_kind = 'reason' and jsonb_typeof(v_slot->'session') = 'object' then
    return jsonb_build_object('ok', false, 'error', 'already_started');
  end if;
  if v_kind = 'reason' and v_note = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  if v_kind = 'moved' then
    if p_new_start_min is null or p_new_end_min is null or p_new_end_min <= p_new_start_min
       or p_new_start_min < 0 or p_new_end_min > 1439 then
      return jsonb_build_object('ok', false, 'error', 'invalid_time');
    end if;
    -- অন্য দরসের শুরু-সময়ের সাথে মিলে গেলে চলবে না
    if exists (
      select 1 from jsonb_array_elements(v_slots) x
       where (x->>'orig_start_min')::int <> p_slot_start_min
         and (x->>'start_min')::int = p_new_start_min
    ) then
      return jsonb_build_object('ok', false, 'error', 'time_taken');
    end if;
  end if;

  insert into public.mdr_dars_slot_overrides (
    class_id, session_date, slot_start_min, kind, new_start_min, new_end_min, note, created_by
  ) values (
    p_class_id, p_date, p_slot_start_min, v_kind,
    case when v_kind = 'moved' then p_new_start_min end,
    case when v_kind = 'moved' then p_new_end_min end,
    v_note, v_actor.id
  )
  on conflict (class_id, session_date, slot_start_min) do update
    set kind = excluded.kind,
        new_start_min = excluded.new_start_min,
        new_end_min = excluded.new_end_min,
        note = excluded.note,
        created_by = excluded.created_by,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mdr_rel_dars_admin_slot_set(uuid, text, uuid, date, integer, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.mdr_rel_dars_admin_slot_set(uuid, text, uuid, date, integer, text, integer, integer, text) to anon;

notify pgrst, 'reload schema';
