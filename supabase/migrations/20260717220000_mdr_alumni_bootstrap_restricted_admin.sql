-- Allow restricted_admin (dashboard) to bootstrap alumni/withdrawals for counts.
create or replace function public.mdr_rel_alumni_bootstrap(
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
begin
  select *
    into v_actor
  from public.mdr_shared_users
  where id = p_actor_id
    and is_active = true
    and pin = p_pin
    and role in ('admin', 'alumni_tracker', 'restricted_admin');

  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  return jsonb_build_object(
    'ok', true,
    'alumni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'student_id', s.id,
        'permanent_id', s.student_id,
        'name', s.name,
        'phone', s.guardian_phone,
        'left_date', a.left_date,
        'left_type', a.left_type,
        'left_reason', a.left_reason,
        'class_code', c.code,
        'class_name', c.name,
        'division_code', d.code,
        'status', case when a.left_type = 'completed' then 'সম্পন্ন' else 'মাঝপথে' end
      ) order by a.left_date desc, s.name), '[]'::jsonb)
      from public.mdr_alumni a
      join public.mdr_students s on s.id = a.student_id
      left join public.mdr_classes c on c.id = a.last_class_id
      left join public.mdr_divisions d on d.id = c.division_id
    )
  );
end;
$$;

revoke execute on function public.mdr_rel_alumni_bootstrap(uuid, text) from public, authenticated;
grant execute on function public.mdr_rel_alumni_bootstrap(uuid, text) to anon;
