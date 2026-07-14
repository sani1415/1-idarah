-- ছাত্র-বিস্তারিত মডালের হাজিরা ট্যাব: দপ্তর bootstrap শুধু শেষ ৩০ দিনের হাজিরা
-- ক্যাশ করে (পুরো বর্ষ ~৬৮ হাজার সারি — টাইমআউট হয়)। তাই মডাল খুললে এই RPC দিয়ে
-- শুধু সেই এক ছাত্রের পূর্ণ ইতিহাস (বর্ষের শুরু থেকে) আনা হয় — ছোট payload, দ্রুত।
-- class_dates: ছাত্রের বর্তমান ক্লাসে যেসব দিনে হাজিরা নেওয়া হয়েছে — "চিহ্নিত নয়"
-- দিন শনাক্ত করতে ফ্রন্টএন্ডের টাইমলাইনে লাগে।

create or replace function public.mdr_rel_student_attendance_history(
  p_actor_id uuid,
  p_pin text,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_student public.mdr_students%rowtype;
  v_session_start date;
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role in ('admin', 'restricted_admin', 'daftar', 'madrasa_teacher');

  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  select * into v_student
  from public.mdr_students
  where id = p_student_id;

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'error', 'student_not_found');
  end if;

  -- Teacher: only own class
  if v_actor.role = 'madrasa_teacher' and v_student.current_class_id <> v_actor.class_id then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select s.session_start_date
  into v_session_start
  from public.mdr_settings s
  where s.id = true;

  if v_session_start is null then
    v_session_start := (current_date - interval '400 days')::date;
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_start_date', v_session_start,
    'attendance', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ad.id,
        'student_id', ad.student_id,
        'date', a.date,
        'status', ad.status,
        'absent_reason', ad.absent_reason,
        'hijri_year', ad.hijri_year
      ) order by a.date desc), '[]'::jsonb)
      from public.mdr_attendance_details ad
      join public.mdr_attendance a on a.id = ad.attendance_id
      where ad.student_id = p_student_id
        and a.date >= v_session_start
        and a.date <= current_date
    ),
    'class_dates', (
      select coalesce(jsonb_agg(d.date order by d.date desc), '[]'::jsonb)
      from (
        select distinct a.date
        from public.mdr_attendance a
        where a.class_id = v_student.current_class_id
          and a.date >= v_session_start
          and a.date <= current_date
      ) d
    )
  );
end;
$$;

revoke execute on function public.mdr_rel_student_attendance_history(uuid, text, uuid) from public, authenticated;
grant  execute on function public.mdr_rel_student_attendance_history(uuid, text, uuid) to anon;
