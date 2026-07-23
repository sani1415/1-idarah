-- শিক্ষকের নিজ বর্ষের ছাত্রদের — শিক্ষাবর্ষ শুরু থেকে মোট অনুপস্থিত দিন (পূর্ণ হাজিরা payload ছাড়া)।

create or replace function public.mdr_rel_teacher_class_absent_summary(
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
  v_session_start date;
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

  select s.session_start_date into v_session_start
  from public.mdr_settings s
  where s.id = true;

  if v_session_start is null then
    v_session_start := (current_date - interval '120 days')::date;
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_start_date', v_session_start,
    'class_id', v_actor.class_id,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', x.student_id,
        'absent_days', x.absent_days
      ) order by x.absent_days desc, x.student_id), '[]'::jsonb)
      from (
        select
          s.id as student_id,
          count(*)::integer as absent_days
        from public.mdr_students s
        join public.mdr_attendance_details ad on ad.student_id = s.id
        join public.mdr_attendance a on a.id = ad.attendance_id
        where s.status = 'active'
          and s.current_class_id = v_actor.class_id
          and a.date >= v_session_start
          and a.date <= current_date
          and ad.status = 'absent'
        group by s.id
      ) x
    )
  );
end;
$$;

revoke execute on function public.mdr_rel_teacher_class_absent_summary(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_teacher_class_absent_summary(uuid, text) to anon;
