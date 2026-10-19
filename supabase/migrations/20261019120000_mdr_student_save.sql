-- ছাত্র ভর্তি ও তথ্য সম্পাদনা (দফতর / জিম্মাদার)
--
-- আগে দফতরের «ছাত্র ভর্তি করুন» শুধু ফোনের ভেতরে (লোকাল) রাখত — সার্ভারে যেত না।
-- এখন এই RPC দিয়ে mdr_students-এ যোগ / হালনাগাদ হয়।
--   * actor সক্রিয় ও PIN/সেশন-টোকেন ঠিক (private.mdr_pin_ok), role = admin / daftar
--     (mdr_rel_set_student_status-এর মতো একই অনুমতি)।
--   * p_student_uuid null → নতুন ছাত্র; না হলে সেই ছাত্রের তথ্য বদল (স্ট্যাটাস এখানে বদলায় না)।
--   * বর্ষ ক্লাস-কোড দিয়ে (যেমন kitab_y2); বিভাগ ক্লাস থেকেই নেওয়া হয়।
--   * স্থায়ী দাখেলা একক (অন্য কারো থাকলে permanent_id_taken)।
--   * একই বর্ষে সক্রিয় অন্য ছাত্রের একই রোল থাকলে roll_taken (কার কাছে আছে তার নামসহ)।
--   * বাংলা অঙ্ক ইংরেজি অঙ্কে রূপান্তর করে রাখা হয় (বিদ্যমান ডেটার মতো)।
--
-- Rollback: drop function public.mdr_rel_student_save(uuid, text, uuid, jsonb);

create or replace function public.mdr_rel_student_save(
  p_actor_id uuid,
  p_pin text,
  p_student_uuid uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_class public.mdr_classes%rowtype;
  v_existing public.mdr_students%rowtype;
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_pid text := nullif(translate(btrim(coalesce(p_payload->>'student_id', '')), '০১২৩৪৫৬৭৮৯', '0123456789'), '');
  v_roll text := nullif(translate(btrim(coalesce(p_payload->>'roll', '')), '০১২৩৪৫৬৭৮৯', '0123456789'), '');
  v_class_code text := nullif(btrim(coalesce(p_payload->>'class_code', '')), '');
  v_other_name text;
begin
  select * into v_actor
  from public.mdr_shared_users
  where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text)
    and role in ('admin', 'daftar');
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  if v_name is null then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  if v_pid is null then return jsonb_build_object('ok', false, 'error', 'permanent_id_required'); end if;
  if v_roll is null then return jsonb_build_object('ok', false, 'error', 'roll_required'); end if;
  if v_class_code is null then return jsonb_build_object('ok', false, 'error', 'class_required'); end if;

  select * into v_class from public.mdr_classes where code = v_class_code and is_active = true;
  if v_class.id is null then
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  if p_student_uuid is not null then
    select * into v_existing from public.mdr_students where id = p_student_uuid;
    if v_existing.id is null then
      return jsonb_build_object('ok', false, 'error', 'student_not_found');
    end if;
  end if;

  if exists (select 1 from public.mdr_students where student_id = v_pid and id is distinct from p_student_uuid) then
    return jsonb_build_object('ok', false, 'error', 'permanent_id_taken');
  end if;

  select name into v_other_name
  from public.mdr_students
  where current_class_id = v_class.id and status = 'active'
    and translate(btrim(current_roll), '০১২৩৪৫৬৭৮৯', '0123456789') = v_roll
    and id is distinct from p_student_uuid
  limit 1;
  if v_other_name is not null then
    return jsonb_build_object('ok', false, 'error', 'roll_taken', 'other_name', v_other_name);
  end if;

  if p_student_uuid is null then
    insert into public.mdr_students (
      student_id, name, guardian_name, guardian_phone, guardian_occupation, district, upazila,
      division_id, current_class_id, current_roll, admission_date, status, is_hifz, import_source
    ) values (
      v_pid, v_name,
      nullif(btrim(coalesce(p_payload->>'guardian_name', '')), ''),
      nullif(btrim(coalesce(p_payload->>'guardian_phone', '')), ''),
      nullif(btrim(coalesce(p_payload->>'guardian_occupation', '')), ''),
      nullif(btrim(coalesce(p_payload->>'district', '')), ''),
      nullif(btrim(coalesce(p_payload->>'upazila', '')), ''),
      v_class.division_id, v_class.id, v_roll, current_date, 'active',
      coalesce((p_payload->>'is_hifz')::boolean, false), 'app'
    )
    returning id into v_id;
  else
    update public.mdr_students set
      student_id = v_pid,
      name = v_name,
      guardian_name = nullif(btrim(coalesce(p_payload->>'guardian_name', '')), ''),
      guardian_phone = nullif(btrim(coalesce(p_payload->>'guardian_phone', '')), ''),
      guardian_occupation = nullif(btrim(coalesce(p_payload->>'guardian_occupation', '')), ''),
      district = nullif(btrim(coalesce(p_payload->>'district', '')), ''),
      upazila = nullif(btrim(coalesce(p_payload->>'upazila', '')), ''),
      division_id = v_class.division_id,
      current_class_id = v_class.id,
      current_roll = v_roll,
      is_hifz = coalesce((p_payload->>'is_hifz')::boolean, is_hifz),
      updated_at = now()
    where id = p_student_uuid
    returning id into v_id;
  end if;

  return (
    select jsonb_build_object('ok', true, 'student', jsonb_build_object(
      'id', s.id,
      'student_id', s.student_id,
      'name', s.name,
      'class_code', c.code,
      'division_code', d.code,
      'current_roll', s.current_roll,
      'guardian_name', s.guardian_name,
      'guardian_phone', s.guardian_phone,
      'guardian_occupation', s.guardian_occupation,
      'district', s.district,
      'upazila', s.upazila,
      'status', s.status,
      'is_hifz', s.is_hifz,
      'special_watch', s.special_watch,
      'alhamdulillah', s.alhamdulillah,
      'alhamdulillah_reason', s.alhamdulillah_reason
    ))
    from public.mdr_students s
    join public.mdr_classes c on c.id = s.current_class_id
    join public.mdr_divisions d on d.id = s.division_id
    where s.id = v_id
  );
end;
$$;

revoke all on function public.mdr_rel_student_save(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mdr_rel_student_save(uuid, text, uuid, jsonb) to anon;

notify pgrst, 'reload schema';
