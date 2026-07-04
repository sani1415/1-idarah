-- Ensure teacher book progress save RPC exists (used by madrasa-class.html).

create or replace function public.mdr_rel_save_book_progress(
  p_actor_id uuid,
  p_pin text,
  p_book_id uuid,
  p_pages_done integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.shared_users%rowtype;
  v_book public.mdr_books%rowtype;
  v_event_id uuid;
begin
  select * into v_actor from public.shared_users
  where id = p_actor_id and is_active = true and pin = p_pin and role = 'madrasa_teacher' and class_id is not null;
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_teacher'); end if;
  if p_pages_done is null or p_pages_done < 0 then return jsonb_build_object('ok', false, 'error', 'invalid_pages'); end if;

  select * into v_book from public.mdr_books where id = p_book_id;
  if v_book.id is null then return jsonb_build_object('ok', false, 'error', 'book_not_found'); end if;
  if v_book.class_id <> v_actor.class_id then return jsonb_build_object('ok', false, 'error', 'not_teacher_class'); end if;

  insert into public.mdr_book_progress_events (book_id, class_id, pages_done, notes, updated_by)
  values (p_book_id, v_book.class_id, p_pages_done, nullif(btrim(coalesce(p_note, '')), ''), v_actor.id)
  returning id into v_event_id;

  insert into public.mdr_book_progress (book_id, pages_done, notes, updated_by, updated_at)
  values (p_book_id, p_pages_done, nullif(btrim(coalesce(p_note, '')), ''), v_actor.id, now())
  on conflict (book_id) do update
  set pages_done = excluded.pages_done,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.shared_notifications (target, title, body, source_type, source_id)
  values ('admin', 'কিতাব অগ্রগতি আপডেট', v_book.name || ' — ' || p_pages_done::text || ' পৃষ্ঠা', 'book_progress', v_event_id);

  return jsonb_build_object('ok', true, 'id', v_event_id);
end;
$$;

revoke execute on function public.mdr_rel_save_book_progress(uuid, text, uuid, integer, text) from public, authenticated;
grant execute on function public.mdr_rel_save_book_progress(uuid, text, uuid, integer, text) to anon;
