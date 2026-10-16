-- দফতরের হাজিরা পাতার «বিদায়ী ছাত্র» ঘর — বিদায়ী ছাত্রদের তালিকা (শুধু পড়া)
--
-- দফতরের bootstrap শুধু সক্রিয় ছাত্র দেয়; বিদায়ী (mdr_alumni, left_type <> 'completed') এখানে আসে।
--   * actor সক্রিয় ও PIN/সেশন-টোকেন ঠিক (private.mdr_pin_ok), role = admin / restricted_admin / daftar।
--   * restricted_admin (super_admin নয়) হলে শুধু তাঁর scope-এর বিভাগ (kitab/maktab)।
--   * কোনো লেখা/মুছা নেই।
--
-- Rollback: drop function public.mdr_rel_daftar_withdrawn(uuid, text);

create or replace function public.mdr_rel_daftar_withdrawn(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_scope text[];
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)
    and role in ('admin', 'restricted_admin', 'daftar');
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if v_actor.role = 'restricted_admin' and coalesce(v_actor.admin_perms->>'super_admin', 'false') <> 'true' then
    select coalesce(array_agg(value), '{}') into v_scope
    from jsonb_array_elements_text(coalesce(v_actor.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) t(value);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'permanent_id', s.student_id,
        'name', s.name,
        'class_name', c.name,
        'division_code', d.code,
        'left_date', a.left_date,
        'left_reason', a.left_reason
      ) order by a.left_date desc, s.name), '[]'::jsonb)
      from public.mdr_alumni a
      join public.mdr_students s on s.id = a.student_id
      left join public.mdr_classes c on c.id = a.last_class_id
      left join public.mdr_divisions d on d.id = c.division_id
      where coalesce(a.left_type, '') <> 'completed'
        and (v_scope is null or d.code = any(v_scope))
    )
  );
end;
$$;

revoke all on function public.mdr_rel_daftar_withdrawn(uuid, text) from public, anon, authenticated;
grant execute on function public.mdr_rel_daftar_withdrawn(uuid, text) to anon;

notify pgrst, 'reload schema';
