-- Lightweight authenticated unread count for dashboard navigation badges.
create or replace function public.mdr_rel_chat_unread_count(
  p_actor_id uuid,
  p_pin text,
  p_is_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_thread text;
  v_count bigint := 0;
begin
  if coalesce(p_is_admin, false) then
    v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
    select count(*) into v_count
    from public.mdr_shared_messages
    where from_role <> 'admin' and read_admin = false;
  else
    select * into v_actor
    from public.mdr_shared_users
    where id = p_actor_id and is_active = true and pin = p_pin;
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_actor');
    end if;
    v_thread := private.mdr_actor_thread(v_actor);
    select count(*) into v_count
    from public.mdr_shared_messages
    where thread_id = v_thread and from_role = 'admin' and read_staff = false;
  end if;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke all on function public.mdr_rel_chat_unread_count(uuid, text, boolean) from public;
grant execute on function public.mdr_rel_chat_unread_count(uuid, text, boolean)
  to anon, authenticated, service_role;
