-- আলহামদুলিল্লাহ চিহ্নিতকরণে কারণ/বিবরণ (নতুন যোগে বাধ্যতামূলক)।
-- পুরনো চিহ্নিত ছাত্রদের reason null থাকবে — তালিকায় থাকবে।

alter table public.mdr_students
  add column if not exists alhamdulillah_reason text;

drop function if exists public.mdr_rel_set_alhamdulillah(uuid, text, uuid, boolean);

create or replace function public.mdr_rel_set_alhamdulillah(
  p_actor_id uuid,
  p_pin text,
  p_student_id uuid,
  p_alhamdulillah boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_student public.mdr_students%rowtype;
  v_on boolean := coalesce(p_alhamdulillah, false);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select *
  into v_actor
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role = 'madrasa_teacher'
    and class_id is not null;

  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_teacher');
  end if;

  select *
  into v_student
  from public.mdr_students
  where id = p_student_id
    and status = 'active';

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'error', 'student_not_found');
  end if;

  if v_student.current_class_id <> v_actor.class_id then
    return jsonb_build_object('ok', false, 'error', 'not_teacher_class');
  end if;

  if v_on and v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  update public.mdr_students
  set alhamdulillah = v_on,
      alhamdulillah_by = case when v_on then v_actor.id else null end,
      alhamdulillah_at = case when v_on then now() else null end,
      alhamdulillah_reason = case when v_on then v_reason else null end,
      updated_at = now()
  where id = p_student_id;

  return jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'alhamdulillah', v_on,
    'alhamdulillah_reason', case when v_on then v_reason else null end
  );
end;
$$;

grant execute on function public.mdr_rel_set_alhamdulillah(uuid, text, uuid, boolean, text) to anon;

-- Bootstrap payloads-এ reason যোগ (বর্তমান ফাংশন বডি থেকে patch)
do $$
declare
  names text[] := array[
    'mdr_rel_teacher_class_bootstrap',
    'mdr_rel_admin_madrasa_bootstrap',
    'mdr_rel_admin_students',
    'mdr_rel_daftar_bootstrap'
  ];
  fname text;
  def text;
  newdef text;
  needle text := '''alhamdulillah_at'', s.alhamdulillah_at';
  patch text := '''alhamdulillah_at'', s.alhamdulillah_at,
        ''alhamdulillah_reason'', nullif(btrim(coalesce(s.alhamdulillah_reason, '''')), '''')';
begin
  foreach fname in array names loop
    select pg_get_functiondef(p.oid)
    into def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = fname
    limit 1;

    if def is null then
      raise exception 'function % not found', fname;
    end if;

    if position('alhamdulillah_reason' in def) > 0 then
      continue;
    end if;

    if position(needle in def) = 0 then
      raise exception 'alhamdulillah_at needle not found in %', fname;
    end if;

    newdef := replace(def, needle, patch);
    execute newdef;
  end loop;
end;
$$;
