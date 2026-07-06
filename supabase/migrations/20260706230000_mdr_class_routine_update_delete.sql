-- নিজাম: চলমান ভার্সন ইন-প্লেস আপডেট + ভার্সন ডিলিট।

alter table public.mdr_class_routines
  add column if not exists updated_at timestamptz not null default now();

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
begin
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
    end if;

    v_activity := coalesce(nullif(btrim(v_slot->>'activity_type'), ''), 'other');
    if v_activity not in ('dars', 'revision', 'kitab', 'meal', 'rest', 'sports', 'admin', 'other') then
      return jsonb_build_object('ok', false, 'error', 'invalid_activity_type', 'index', v_idx);
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.mdr_class_routine_insert_slots(
  p_routine_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
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
begin
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
      p_routine_id,
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
end;
$$;

create or replace function public.mdr_rel_class_routine_update(
  p_actor_id uuid,
  p_pin text,
  p_slots jsonb,
  p_change_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_routine public.mdr_class_routines%rowtype;
  v_check jsonb;
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

  select * into v_routine
  from public.mdr_class_routines
  where class_id = v_actor.class_id and is_current = true
  limit 1;

  if v_routine.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_current_routine');
  end if;

  v_check := private.mdr_class_routine_validate_slots(p_slots);
  if coalesce((v_check->>'ok')::boolean, false) = false then
    return v_check;
  end if;

  delete from public.mdr_class_routine_slots where routine_id = v_routine.id;
  perform private.mdr_class_routine_insert_slots(v_routine.id, p_slots);

  update public.mdr_class_routines
  set updated_at = now(),
      change_note = case
        when nullif(btrim(coalesce(p_change_note, '')), '') is not null
          then btrim(p_change_note)
        else change_note
      end
  where id = v_routine.id;

  return jsonb_build_object(
    'ok', true,
    'routine_id', v_routine.id,
    'version_no', v_routine.version_no
  );
end;
$$;

create or replace function public.mdr_rel_class_routine_delete(
  p_actor_id uuid,
  p_pin text,
  p_routine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_routine public.mdr_class_routines%rowtype;
  v_count integer;
  v_next public.mdr_class_routines%rowtype;
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

  select * into v_routine
  from public.mdr_class_routines
  where id = p_routine_id and class_id = v_actor.class_id;

  if v_routine.id is null then
    return jsonb_build_object('ok', false, 'error', 'routine_not_found');
  end if;

  select count(*)::integer into v_count
  from public.mdr_class_routines
  where class_id = v_actor.class_id;

  if v_count <= 1 then
    delete from public.mdr_class_routines where id = v_routine.id;
    return jsonb_build_object('ok', true, 'deleted_all', true);
  end if;

  if v_routine.is_current then
    select * into v_next
    from public.mdr_class_routines
    where class_id = v_actor.class_id and id <> v_routine.id
    order by version_no desc
    limit 1;

    update public.mdr_class_routines
    set is_current = false
    where class_id = v_actor.class_id and is_current = true;

    update public.mdr_class_routines
    set is_current = true, updated_at = now()
    where id = v_next.id;
  end if;

  delete from public.mdr_class_routines where id = v_routine.id;

  return jsonb_build_object(
    'ok', true,
    'deleted_all', false,
    'new_current_id', case when v_routine.is_current then v_next.id else null end
  );
end;
$$;

-- save RPC: শুধু নতুন ভার্সন তৈরি
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
  v_check jsonb;
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

  v_check := private.mdr_class_routine_validate_slots(p_slots);
  if coalesce((v_check->>'ok')::boolean, false) = false then
    return v_check;
  end if;

  select coalesce(max(version_no), 0) + 1
  into v_next_version
  from public.mdr_class_routines
  where class_id = v_class.id;

  update public.mdr_class_routines
  set is_current = false
  where class_id = v_class.id and is_current = true;

  insert into public.mdr_class_routines (class_id, version_no, is_current, change_note, created_by, updated_at)
  values (
    v_class.id,
    v_next_version,
    true,
    coalesce(nullif(btrim(coalesce(p_change_note, '')), ''), ''),
    v_actor.id,
    now()
  )
  returning id into v_routine_id;

  perform private.mdr_class_routine_insert_slots(v_routine_id, p_slots);

  return jsonb_build_object(
    'ok', true,
    'routine_id', v_routine_id,
    'version_no', v_next_version
  );
end;
$$;

-- get RPC: updated_at যোগ
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
        'updated_at', v_current.updated_at,
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
        'updated_at', v_target_routine.updated_at,
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
        'updated_at', r.updated_at,
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

revoke execute on function private.mdr_class_routine_validate_slots(jsonb) from public, anon, authenticated;
revoke execute on function private.mdr_class_routine_insert_slots(uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.mdr_rel_class_routine_update(uuid, text, jsonb, text) from public, authenticated;
grant execute on function public.mdr_rel_class_routine_update(uuid, text, jsonb, text) to anon;

revoke execute on function public.mdr_rel_class_routine_delete(uuid, text, uuid) from public, authenticated;
grant execute on function public.mdr_rel_class_routine_delete(uuid, text, uuid) to anon;
