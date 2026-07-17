-- Idarah: daftar-managed student profile photos (public bucket student-photos).
-- Object naming convention (unchanged): {mdr_students.student_id}.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-photos',
  'student-photos',
  true,
  512000,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "allow_public_read_student_photos" on storage.objects;
drop policy if exists "anon_select_student_photos" on storage.objects;
create policy "anon_select_student_photos"
  on storage.objects for select to anon
  using (bucket_id = 'student-photos');

drop policy if exists "anon_insert_student_photos" on storage.objects;
create policy "anon_insert_student_photos"
  on storage.objects for insert to anon
  with check (bucket_id = 'student-photos');

drop policy if exists "anon_update_student_photos" on storage.objects;
create policy "anon_update_student_photos"
  on storage.objects for update to anon
  using (bucket_id = 'student-photos')
  with check (bucket_id = 'student-photos');

drop policy if exists "anon_delete_student_photos" on storage.objects;
create policy "anon_delete_student_photos"
  on storage.objects for delete to anon
  using (bucket_id = 'student-photos');

-- Daftar (PIN) may upload/replace/delete; returns object path for Storage client.
create or replace function public.mdr_rel_student_photo_authorize(
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
  v_pid text;
  v_path text;
begin
  v_actor := private.mdr_student_doc_daftar_actor(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_student_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_student');
  end if;

  select *
    into v_student
  from public.mdr_students
  where id = p_student_id;

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Frontend "permanent_id" == public.mdr_students.student_id
  v_pid := nullif(btrim(coalesce(v_student.student_id, '')), '');
  if v_pid is null then
    return jsonb_build_object('ok', false, 'error', 'no_permanent_id');
  end if;

  -- Path must stay a simple object name (no folders).
  if v_pid !~ '^[0-9A-Za-z_-]{1,32}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_permanent_id');
  end if;

  v_path := v_pid || '.jpg';

  return jsonb_build_object(
    'ok', true,
    'can_manage', true,
    'bucketId', 'student-photos',
    'objectPath', v_path,
    'permanentId', v_pid,
    'studentId', v_student.id,
    'studentName', coalesce(v_student.name, '')
  );
end;
$$;

revoke execute on function public.mdr_rel_student_photo_authorize(uuid, text, uuid) from public, authenticated;
grant execute on function public.mdr_rel_student_photo_authorize(uuid, text, uuid) to anon;
