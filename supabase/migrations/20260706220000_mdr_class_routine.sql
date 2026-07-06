-- Idarah: per-class daily routine (নিজামুল আওকাত) with version history.

create table if not exists public.mdr_class_routines (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.mdr_classes(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  is_current boolean not null default false,
  change_note text not null default '',
  created_by uuid references public.mdr_shared_users(id),
  created_at timestamptz not null default now(),
  constraint mdr_class_routines_class_version_uniq unique (class_id, version_no)
);

create unique index if not exists mdr_class_routines_current_uniq
  on public.mdr_class_routines (class_id)
  where is_current = true;

create index if not exists mdr_class_routines_class_created_idx
  on public.mdr_class_routines (class_id, created_at desc);

create table if not exists public.mdr_class_routine_slots (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.mdr_class_routines(id) on delete cascade,
  sort_order integer not null default 0,
  start_hour smallint not null check (start_hour between 1 and 12),
  start_minute smallint not null default 0 check (start_minute between 0 and 59),
  start_ampm text not null check (start_ampm in ('AM', 'PM')),
  end_hour smallint check (end_hour is null or end_hour between 1 and 12),
  end_minute smallint check (end_minute is null or end_minute between 0 and 59),
  end_ampm text check (end_ampm is null or end_ampm in ('AM', 'PM')),
  label text not null,
  activity_type text not null default 'other',
  constraint mdr_class_routine_slots_label_chk check (char_length(btrim(label)) > 0),
  constraint mdr_class_routine_slots_activity_chk check (
    activity_type in ('dars', 'revision', 'kitab', 'meal', 'rest', 'sports', 'admin', 'other')
  )
);

create index if not exists mdr_class_routine_slots_routine_idx
  on public.mdr_class_routine_slots (routine_id, sort_order, start_hour, start_minute);

alter table public.mdr_class_routines enable row level security;
alter table public.mdr_class_routine_slots enable row level security;

drop policy if exists "deny_all_mdr_class_routines" on public.mdr_class_routines;
create policy "deny_all_mdr_class_routines"
  on public.mdr_class_routines for all using (false) with check (false);

drop policy if exists "deny_all_mdr_class_routine_slots" on public.mdr_class_routine_slots;
create policy "deny_all_mdr_class_routine_slots"
  on public.mdr_class_routine_slots for all using (false) with check (false);

create or replace function private.mdr_routine_time_sort_key(
  p_hour smallint,
  p_minute smallint,
  p_ampm text
)
returns integer
language sql
immutable
as $$
  select
    case
      when p_ampm = 'AM' and p_hour = 12 then p_minute
      when p_ampm = 'AM' then (p_hour * 60 + p_minute)
      when p_hour = 12 then (12 * 60 + p_minute)
      else ((p_hour + 12) * 60 + p_minute)
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
    'activity_type', s.activity_type
  ) order by
    s.sort_order,
    private.mdr_routine_time_sort_key(s.start_hour, s.start_minute, s.start_ampm),
    s.label), '[]'::jsonb)
  from public.mdr_class_routine_slots s
  where s.routine_id = p_routine_id;
$$;

create or replace function private.mdr_class_routine_can_read(
  p_actor_id uuid,
  p_pin text,
  p_class_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_teacher public.mdr_shared_users%rowtype;
  v_admin public.mdr_shared_users%rowtype;
  v_division_code text;
  v_depts text[];
  v_is_super boolean;
begin
  if p_class_id is null then
    return false;
  end if;

  select * into v_teacher
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role = 'madrasa_teacher'
    and class_id = p_class_id;

  if v_teacher.id is not null then
    return true;
  end if;

  v_admin := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  if v_admin.id is null then
    return false;
  end if;

  v_is_super := v_admin.role = 'admin'
    or coalesce(v_admin.admin_perms->>'super_admin', 'false') = 'true';

  if not v_is_super
     and coalesce(v_admin.admin_perms->'permissions'->>'dars', 'false') <> 'true' then
    return false;
  end if;

  if v_is_super then
    v_depts := array['kitab', 'maktab']::text[];
  else
    select array(
      select value
      from jsonb_array_elements_text(coalesce(v_admin.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) as t(value)
      where value in ('kitab', 'maktab')
    ) into v_depts;
  end if;

  if coalesce(array_length(v_depts, 1), 0) = 0 then
    return false;
  end if;

  select d.code
  into v_division_code
  from public.mdr_classes c
  join public.mdr_divisions d on d.id = c.division_id
  where c.id = p_class_id
    and c.is_active = true
    and c.code <> 'kitab_hifz';

  return v_division_code = any(v_depts);
end;
$$;

create or replace function public.mdr_rel_class_routine_get(
  p_actor_id uuid,
  p_pin text,
  p_class_code text default null,
  p_routine_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_teacher public.mdr_shared_users%rowtype;
  v_class public.mdr_classes%rowtype;
  v_target_routine public.mdr_class_routines%rowtype;
  v_current public.mdr_class_routines%rowtype;
begin
  select * into v_teacher
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role = 'madrasa_teacher'
    and class_id is not null;

  if v_teacher.id is not null then
    select * into v_class from public.mdr_classes where id = v_teacher.class_id and is_active = true;
  elsif nullif(btrim(coalesce(p_class_code, '')), '') is not null then
    select * into v_class from public.mdr_classes where code = btrim(p_class_code) and is_active = true;
  else
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  if v_class.id is null then
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  if not private.mdr_class_routine_can_read(p_actor_id, p_pin, v_class.id) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select * into v_current
  from public.mdr_class_routines
  where class_id = v_class.id and is_current = true
  limit 1;

  if p_routine_id is not null then
    select * into v_target_routine
    from public.mdr_class_routines
    where id = p_routine_id and class_id = v_class.id;
    if v_target_routine.id is null then
      return jsonb_build_object('ok', false, 'error', 'routine_not_found');
    end if;
  else
    v_target_routine := v_current;
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_id', v_class.id,
    'class_code', v_class.code,
    'class_name', v_class.name,
    'current', case
      when v_current.id is null then null
      else jsonb_build_object(
        'id', v_current.id,
        'version_no', v_current.version_no,
        'is_current', true,
        'change_note', v_current.change_note,
        'created_at', v_current.created_at,
        'slots', private.mdr_class_routine_slots_json(v_current.id)
      )
    end,
    'viewing', case
      when v_target_routine.id is null then null
      else jsonb_build_object(
        'id', v_target_routine.id,
        'version_no', v_target_routine.version_no,
        'is_current', v_target_routine.is_current,
        'change_note', v_target_routine.change_note,
        'created_at', v_target_routine.created_at,
        'slots', private.mdr_class_routine_slots_json(v_target_routine.id)
      )
    end,
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'version_no', r.version_no,
        'is_current', r.is_current,
        'change_note', r.change_note,
        'created_at', r.created_at,
        'slot_count', (
          select count(*)::integer
          from public.mdr_class_routine_slots s
          where s.routine_id = r.id
        )
      ) order by r.version_no desc), '[]'::jsonb)
      from public.mdr_class_routines r
      where r.class_id = v_class.id
    )
  );
end;
$$;

create or replace function public.mdr_rel_class_routine_save(
  p_actor_id uuid,
  p_pin text,
  p_slots jsonb,
  p_change_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_class public.mdr_classes%rowtype;
  v_next_version integer;
  v_routine_id uuid;
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
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role = 'madrasa_teacher'
    and class_id is not null;

  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_teacher');
  end if;

  select * into v_class from public.mdr_classes where id = v_actor.class_id and is_active = true;
  if v_class.id is null then
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    return jsonb_build_object('ok', false, 'error', 'slots_required');
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    v_idx := v_idx + 1;
    v_label := nullif(btrim(coalesce(v_slot->>'label', '')), '');
    if v_label is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_slot_label', 'index', v_idx);
    end if;

    v_start_hour := (v_slot->>'start_hour')::integer;
    v_start_minute := coalesce((v_slot->>'start_minute')::integer, 0);
    v_start_ampm := upper(coalesce(v_slot->>'start_ampm', ''));
    if v_start_hour is null or v_start_hour < 1 or v_start_hour > 12
       or v_start_minute < 0 or v_start_minute > 59
       or v_start_ampm not in ('AM', 'PM') then
      return jsonb_build_object('ok', false, 'error', 'invalid_start_time', 'index', v_idx);
    end if;

    if v_slot ? 'end_hour' and nullif(v_slot->>'end_hour', '') is not null then
      v_end_hour := (v_slot->>'end_hour')::integer;
      v_end_minute := coalesce((v_slot->>'end_minute')::integer, 0);
      v_end_ampm := upper(coalesce(v_slot->>'end_ampm', ''));
      if v_end_hour < 1 or v_end_hour > 12
         or v_end_minute < 0 or v_end_minute > 59
         or v_end_ampm not in ('AM', 'PM') then
        return jsonb_build_object('ok', false, 'error', 'invalid_end_time', 'index', v_idx);
      end if;
    else
      v_end_hour := null;
      v_end_minute := null;
      v_end_ampm := null;
    end if;

    v_activity := coalesce(nullif(btrim(v_slot->>'activity_type'), ''), 'other');
    if v_activity not in ('dars', 'revision', 'kitab', 'meal', 'rest', 'sports', 'admin', 'other') then
      return jsonb_build_object('ok', false, 'error', 'invalid_activity_type', 'index', v_idx);
    end if;
  end loop;

  select coalesce(max(version_no), 0) + 1
  into v_next_version
  from public.mdr_class_routines
  where class_id = v_class.id;

  update public.mdr_class_routines
  set is_current = false
  where class_id = v_class.id and is_current = true;

  insert into public.mdr_class_routines (class_id, version_no, is_current, change_note, created_by)
  values (
    v_class.id,
    v_next_version,
    true,
    coalesce(nullif(btrim(coalesce(p_change_note, '')), ''), ''),
    v_actor.id
  )
  returning id into v_routine_id;

  v_idx := 0;
  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    v_idx := v_idx + 1;
    v_label := btrim(v_slot->>'label');
    v_start_hour := (v_slot->>'start_hour')::integer;
    v_start_minute := coalesce((v_slot->>'start_minute')::integer, 0);
    v_start_ampm := upper(v_slot->>'start_ampm');
    if v_slot ? 'end_hour' and nullif(v_slot->>'end_hour', '') is not null then
      v_end_hour := (v_slot->>'end_hour')::integer;
      v_end_minute := coalesce((v_slot->>'end_minute')::integer, 0);
      v_end_ampm := upper(v_slot->>'end_ampm');
    else
      v_end_hour := null;
      v_end_minute := null;
      v_end_ampm := null;
    end if;
    v_activity := coalesce(nullif(btrim(v_slot->>'activity_type'), ''), 'other');

    insert into public.mdr_class_routine_slots (
      routine_id, sort_order, start_hour, start_minute, start_ampm,
      end_hour, end_minute, end_ampm, label, activity_type
    )
    values (
      v_routine_id,
      coalesce((v_slot->>'sort_order')::integer, v_idx),
      v_start_hour,
      v_start_minute,
      v_start_ampm,
      v_end_hour,
      v_end_minute,
      v_end_ampm,
      v_label,
      v_activity
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'routine_id', v_routine_id,
    'version_no', v_next_version
  );
end;
$$;

create or replace function public.mdr_rel_admin_routine_bootstrap(
  p_actor_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_depts text[];
  v_is_super boolean;
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  v_is_super := v_actor.role = 'admin'
    or coalesce(v_actor.admin_perms->>'super_admin', 'false') = 'true';

  if not v_is_super
     and coalesce(v_actor.admin_perms->'permissions'->>'dars', 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  if v_is_super then
    v_depts := array['kitab', 'maktab']::text[];
  else
    select array(
      select value
      from jsonb_array_elements_text(coalesce(v_actor.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) as t(value)
      where value in ('kitab', 'maktab')
    ) into v_depts;
  end if;

  if coalesce(array_length(v_depts, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'classes', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'classes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'code', c.code,
        'name', c.name,
        'sort_order', c.sort_order,
        'division_code', d.code,
        'current_version_no', r.version_no,
        'current_updated_at', r.created_at,
        'has_routine', r.id is not null
      ) order by d.code, c.sort_order, c.name), '[]'::jsonb)
      from public.mdr_classes c
      join public.mdr_divisions d on d.id = c.division_id
      left join public.mdr_class_routines r
        on r.class_id = c.id and r.is_current = true
      where c.is_active = true
        and c.code <> 'kitab_hifz'
        and d.code = any(v_depts)
    )
  );
end;
$$;

revoke execute on function private.mdr_routine_time_sort_key(smallint, smallint, text) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_slots_json(uuid) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_can_read(uuid, text, uuid) from public, anon, authenticated;

revoke execute on function public.mdr_rel_class_routine_get(uuid, text, text, uuid) from public, authenticated;
grant execute on function public.mdr_rel_class_routine_get(uuid, text, text, uuid) to anon;

revoke execute on function public.mdr_rel_class_routine_save(uuid, text, jsonb, text) from public, authenticated;
grant execute on function public.mdr_rel_class_routine_save(uuid, text, jsonb, text) to anon;

revoke execute on function public.mdr_rel_admin_routine_bootstrap(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_admin_routine_bootstrap(uuid, text) to anon;
