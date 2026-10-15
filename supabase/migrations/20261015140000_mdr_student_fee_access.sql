-- ছাত্রের মাসিক ফি (বাইরের ফি-সফটওয়্যার থেকে) — কে দেখতে পারবে তার যাচাই
--
-- ফি-র তথ্য আসে অন্য প্রতিষ্ঠানের API থেকে (চাবি শুধু Edge Function-এর secret WAZIFA_API_KEY-তে)।
-- Edge Function `mdr-student-fee` service-role দিয়ে এই RPC ডেকে আগে নিশ্চিত হয়:
--   * actor সক্রিয় ও PIN/সেশন-টোকেন ঠিক (private.mdr_pin_ok), আর role = admin / restricted_admin / daftar (জিম্মাদার ও দফতর)।
--     অন্য কেউ (উস্তাদ, হিফজ, লাইব্রেরি…) ছাত্রের প্রোফাইল দেখলেও ফি দেখে না।
--   * restricted_admin (super_admin নয়) হলে ছাত্রের বিভাগ (kitab/maktab) তাঁর scope-এ থাকতে হবে।
--   * ছাত্রের রেজি. আইডি (student_id) ডাটাবেজ থেকেই নেওয়া হয় — ব্রাউজারের পাঠানো আইডিতে ভরসা নয়।
-- anon/authenticated এটা চালাতে পারে না; শুধু service_role (Edge Function)।
--
-- Rollback: drop function public.mdr_rel_student_fee_access(uuid, text, uuid);

create or replace function public.mdr_rel_student_fee_access(p_actor_id uuid, p_pin text, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_student public.mdr_students%rowtype;
  v_division_code text;
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)
    and role in ('admin', 'restricted_admin', 'daftar');
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into v_student from public.mdr_students where id = p_student_id;
  if v_student.id is null then
    return jsonb_build_object('ok', false, 'error', 'student_not_found');
  end if;

  if v_actor.role = 'restricted_admin' and coalesce(v_actor.admin_perms->>'super_admin', 'false') <> 'true' then
    select d.code into v_division_code
    from public.mdr_classes c
    join public.mdr_divisions d on d.id = c.division_id
    where c.id = v_student.current_class_id;
    if v_division_code is null or not (v_division_code = any(
      select value from jsonb_array_elements_text(coalesce(v_actor.admin_perms->'scope'->'madrasa_depts', '[]'::jsonb)) t(value)
    )) then
      return jsonb_build_object('ok', false, 'error', 'not_allowed');
    end if;
  end if;

  if nullif(btrim(coalesce(v_student.student_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'no_reg_id');
  end if;

  return jsonb_build_object('ok', true, 'reg_id', btrim(v_student.student_id));
end;
$$;

revoke all on function public.mdr_rel_student_fee_access(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mdr_rel_student_fee_access(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
