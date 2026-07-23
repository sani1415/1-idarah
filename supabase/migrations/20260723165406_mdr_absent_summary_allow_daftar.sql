-- অনুপস্থিত session-summary: দফতর (daftar) রোলও ব্যবহার করতে পারবে।
-- আগে শুধু admin/restricted_admin — দফতর পেজে লোকাল ~৩০ দিনের হিসাব দেখাত।

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
  /* admin dashboard অথবা দফতর */
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
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', x.student_id,
        'dept', x.dept,
        'absent_days', x.absent_days
      ) order by x.absent_days desc, x.student_id), '[]'::jsonb)
      from (
        select
          s.id as student_id,
          d.code as dept,
          count(*)::integer as absent_days
        from public.mdr_students s
        join public.mdr_classes c on c.id = s.current_class_id
        join public.mdr_divisions d on d.id = c.division_id
        join public.mdr_attendance_details ad on ad.student_id = s.id
        join public.mdr_attendance a on a.id = ad.attendance_id
        where s.status = 'active'
          and c.is_active = true
          and c.code <> 'kitab_hifz'
          and d.code = any(v_depts)
          and a.date >= v_session_start
          and a.date <= current_date
          and ad.status = 'absent'
        group by s.id, d.code
      ) x
    )
  );
end;
$$;

revoke execute on function public.mdr_rel_admin_absent_summary(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_admin_absent_summary(uuid, text) to anon;
