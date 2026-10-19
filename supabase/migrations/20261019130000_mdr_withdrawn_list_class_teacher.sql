-- বিদায়ী ছাত্রের তালিকা — বর্ষ দায়িত্বশীলও (শুধু নিজের বর্ষের)
--
-- বর্ষ-পাতার «বিদায়ী» ঘর আগে সবসময় শূন্য দেখাত, কারণ বর্ষ দায়িত্বশীলের কাছে বিদায়ী ছাত্রের তথ্য আসত না।
-- mdr_rel_daftar_withdrawn এখন:
--   * admin / restricted_admin (scope) / daftar — আগের মতো সব (scope অনুযায়ী)।
--   * madrasa_teacher — শুধু যাদের শেষ বর্ষ (last_class_id) তাঁর নিজের বর্ষ।
--   * প্রতি সারিতে class_code যোগ (পাতায় বর্ষ অনুযায়ী ছাঁকতে)।
-- শুধু পড়া; কোনো লেখা/মুছা নেই।
--
-- Rollback: 20261016120000_mdr_daftar_withdrawn_list.sql আবার চালান।

create or replace function public.mdr_rel_daftar_withdrawn(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_scope text[];
  v_only_class uuid;
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)
    and (role in ('admin', 'restricted_admin', 'daftar') or (role = 'madrasa_teacher' and class_id is not null));
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if v_actor.role = 'madrasa_teacher' then
    v_only_class := v_actor.class_id;
  elsif v_actor.role = 'restricted_admin' and coalesce(v_actor.admin_perms->>'super_admin', 'false') <> 'true' then
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
        'class_code', c.code,
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
        and (v_only_class is null or a.last_class_id = v_only_class)
    )
  );
end;
$$;

revoke all on function public.mdr_rel_daftar_withdrawn(uuid, text) from public, anon, authenticated;
grant execute on function public.mdr_rel_daftar_withdrawn(uuid, text) to anon;

notify pgrst, 'reload schema';
