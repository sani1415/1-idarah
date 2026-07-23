-- Bind each browser push subscription to the actor's canonical personal-chat thread.
alter table public.mdr_shared_push_subscriptions
  add column if not exists actor_thread text;

update public.mdr_shared_push_subscriptions s
set actor_thread = private.mdr_actor_thread(u)
from public.mdr_shared_users u
where s.actor_id = u.id
  and s.actor_role <> 'admin'
  and s.actor_thread is null;

create index if not exists mdr_shared_push_subscriptions_actor_thread_idx
  on public.mdr_shared_push_subscriptions (actor_thread)
  where actor_thread is not null;

create or replace function public.mdr_rel_push_subscribe(
  p_actor_id uuid,
  p_pin text,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_is_admin boolean default false,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_role text;
  v_actor_id uuid;
  v_thread text;
begin
  if btrim(coalesce(p_endpoint, '')) = ''
     or btrim(coalesce(p_p256dh, '')) = ''
     or btrim(coalesce(p_auth, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_subscription');
  end if;

  if coalesce(p_is_admin, false) then
    v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
    v_role := 'admin';
    v_actor_id := v_actor.id;
    v_thread := null;
  else
    select * into v_actor
    from public.mdr_shared_users
    where id = p_actor_id and is_active = true and pin = p_pin;
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_actor');
    end if;
    v_role := v_actor.role;
    v_actor_id := v_actor.id;
    v_thread := private.mdr_actor_thread(v_actor);
  end if;

  insert into public.mdr_shared_push_subscriptions
    (actor_role, actor_id, actor_thread, endpoint, p256dh, auth, user_agent, updated_at)
  values
    (v_role, v_actor_id, v_thread, p_endpoint, p_p256dh, p_auth, p_user_agent, now())
  on conflict (endpoint) do update
    set actor_role  = excluded.actor_role,
        actor_id    = excluded.actor_id,
        actor_thread = excluded.actor_thread,
        p256dh      = excluded.p256dh,
        auth        = excluded.auth,
        user_agent  = excluded.user_agent,
        updated_at  = now();

  return jsonb_build_object('ok', true, 'thread_id', v_thread);
end;
$$;

-- Replace the old endpoint-only public delete with an actor-authenticated logout RPC.
drop function if exists public.mdr_rel_push_unsubscribe(text);

create or replace function public.mdr_rel_push_unsubscribe(
  p_actor_id uuid,
  p_pin text,
  p_endpoint text,
  p_is_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  if btrim(coalesce(p_endpoint, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_subscription');
  end if;

  if coalesce(p_is_admin, false) then
    v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
    delete from public.mdr_shared_push_subscriptions
    where endpoint = p_endpoint and actor_role = 'admin' and actor_id = v_actor.id;
  else
    select * into v_actor
    from public.mdr_shared_users
    where id = p_actor_id and is_active = true and pin = p_pin;
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_actor');
    end if;
    delete from public.mdr_shared_push_subscriptions
    where endpoint = p_endpoint and actor_id = v_actor.id and actor_role <> 'admin';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mdr_rel_push_subscribe(uuid, text, text, text, text, boolean, text) from public;
grant execute on function public.mdr_rel_push_subscribe(uuid, text, text, text, text, boolean, text)
  to anon, authenticated, service_role;
revoke all on function public.mdr_rel_push_unsubscribe(uuid, text, text, boolean) from public;
grant execute on function public.mdr_rel_push_unsubscribe(uuid, text, text, boolean)
  to anon, authenticated, service_role;

-- Notify the delivery function for both directions of the existing personal chat.
create or replace function private.mdr_notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'mdr_notify_webhook_secret'
  limit 1;

  perform net.http_post(
    url := 'https://bbdtoucanihtrymzpynq.supabase.co/functions/v1/send-admin-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', coalesce(v_secret, '')
    ),
    body := jsonb_build_object(
      'kind', 'chat_message',
      'from_role', new.from_role,
      'from_name', new.from_name,
      'body', new.body,
      'thread_id', new.thread_id,
      'message_id', new.id,
      'request', new.request
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function private.mdr_notify_chat_message() from public, anon, authenticated;

drop trigger if exists mdr_shared_messages_notify_admin on public.mdr_shared_messages;
drop trigger if exists mdr_shared_messages_notify_chat on public.mdr_shared_messages;
create trigger mdr_shared_messages_notify_chat
  after insert on public.mdr_shared_messages
  for each row
  execute function private.mdr_notify_chat_message();
