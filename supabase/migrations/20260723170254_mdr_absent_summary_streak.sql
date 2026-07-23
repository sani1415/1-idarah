-- টানা অনুপস্থিত (streak): শিক্ষাবর্ষ শুরু থেকে, পূর্ণ হাজিরা payload ছাড়া।
-- নিয়ম (ফ্রন্টএন্ডের সাথে মিল): তারিখ DESC-এ absent গোনা; holiday বাদ; present এ থামে।

create or replace function public.mdr_rel_admin_absent_summary(
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
  v_session_start date;
begin
  v_actor := private.mdr_admin_dashboard_actor(p_actor_id, p_pin);
  if v_actor.id is null and p_actor_id is not null then
    select *
    into v_actor
    from public.mdr_shared_users u
    where u.id = p_actor_id
      and u.is_active = true
      and u.pin = p_pin
      and u.role = 'daftar';
  end if;

  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  if v_actor.role = 'admin'
     or v_actor.role = 'daftar'
     or coalesce(v_actor.admin_perms->>'super_admin', 'false') = 'true' then
    v_depts := array['kitab', 'maktab']::text[];
  else
    select array(
      select value
      from jsonb_array_elements_text(coalesce(v_actor.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) as t(value)
      where value in ('kitab', 'maktab')
    ) into v_depts;
  end if;

  if coalesce(array_length(v_depts, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'session_start_date', null, 'rows', '[]'::jsonb);
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
    'rows', (
      with scoped_students as (
        select s.id as student_id, d.code as dept
        from public.mdr_students s
        join public.mdr_classes c on c.id = s.current_class_id
        join public.mdr_divisions d on d.id = c.division_id
        where s.status = 'active'
          and c.is_active = true
          and c.code <> 'kitab_hifz'
          and d.code = any(v_depts)
      ),
      totals as (
        select
          ss.student_id,
          ss.dept,
          count(*)::integer as absent_days
        from scoped_students ss
        join public.mdr_attendance_details ad on ad.student_id = ss.student_id
        join public.mdr_attendance a on a.id = ad.attendance_id
        where a.date >= v_session_start
          and a.date <= current_date
          and ad.status = 'absent'
        group by ss.student_id, ss.dept
      ),
      non_holiday as (
        select ad.student_id, a.date, ad.status
        from totals t
        join public.mdr_attendance_details ad on ad.student_id = t.student_id
        join public.mdr_attendance a on a.id = ad.attendance_id
        where a.date >= v_session_start
          and a.date <= current_date
          and ad.status in ('absent', 'present')
      ),
      ordered as (
        select
          student_id,
          status,
          row_number() over (partition by student_id order by date desc) as rn
        from non_holiday
      ),
      first_present as (
        select student_id, min(rn) as break_rn
        from ordered
        where status = 'present'
        group by student_id
      ),
      streaks as (
        select o.student_id, count(*)::integer as absent_streak
        from ordered o
        left join first_present fp on fp.student_id = o.student_id
        where o.status = 'absent'
          and (fp.break_rn is null or o.rn < fp.break_rn)
        group by o.student_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', t.student_id,
        'dept', t.dept,
        'absent_days', t.absent_days,
        'absent_streak', coalesce(st.absent_streak, 0)
      ) order by t.absent_days desc, t.student_id), '[]'::jsonb)
      from totals t
      left join streaks st on st.student_id = t.student_id
    )
  );
end;
$$;

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
      with totals as (
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
      ),
      non_holiday as (
        select ad.student_id, a.date, ad.status
        from totals t
        join public.mdr_attendance_details ad on ad.student_id = t.student_id
        join public.mdr_attendance a on a.id = ad.attendance_id
        where a.date >= v_session_start
          and a.date <= current_date
          and ad.status in ('absent', 'present')
      ),
      ordered as (
        select
          student_id,
          status,
          row_number() over (partition by student_id order by date desc) as rn
        from non_holiday
      ),
      first_present as (
        select student_id, min(rn) as break_rn
        from ordered
        where status = 'present'
        group by student_id
      ),
      streaks as (
        select o.student_id, count(*)::integer as absent_streak
        from ordered o
        left join first_present fp on fp.student_id = o.student_id
        where o.status = 'absent'
          and (fp.break_rn is null or o.rn < fp.break_rn)
        group by o.student_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', t.student_id,
        'absent_days', t.absent_days,
        'absent_streak', coalesce(st.absent_streak, 0)
      ) order by t.absent_days desc, t.student_id), '[]'::jsonb)
      from totals t
      left join streaks st on st.student_id = t.student_id
    )
  );
end;
$$;

revoke execute on function public.mdr_rel_admin_absent_summary(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_admin_absent_summary(uuid, text) to anon;
revoke execute on function public.mdr_rel_teacher_class_absent_summary(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_teacher_class_absent_summary(uuid, text) to anon;
