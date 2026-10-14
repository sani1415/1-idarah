-- বার্তা: নির্দিষ্ট বার্তার রিপ্লাই, আর ১৫ মিনিটের মধ্যে নিজের বার্তা সম্পাদনা/মোছা।
--
-- * reply_to: যে বার্তার উত্তর, তার ছোট snapshot ({id, text, from_role, from_name})।
--   snapshot সার্ভারেই বানানো হয় (একই থ্রেডের বার্তা হতে হবে), client-এর পাঠানো লেখা নয়।
-- * edited_at: সম্পাদনার সময়; UI-তে «সম্পাদিত» দেখায়।
-- * mdr_rel_chat_post: mdr_rel_chat_send-এর মতোই, সাথে p_reply_to_id। আলাদা নাম রাখা হয়েছে যাতে
--   PostgREST overload অস্পষ্টতা না হয় আর পুরনো খোলা ট্যাব mdr_rel_chat_send দিয়ে চলতে থাকে।
-- * mdr_rel_chat_edit_own / mdr_rel_chat_delete_own: শুধু নিজের সাধারণ বার্তা (request নেই),
--   পাঠানোর ১৫ মিনিটের মধ্যে — সময়সীমা সার্ভারে যাচাই হয়।
-- * মোছা = স্থায়ীভাবে মুছে ফেলা (বার্তা ও তার notification)। deleted_at column-টা পুরনো soft-delete
--   সংস্করণ থেকে থেকে গেছে; bootstrap এখনো deleted_at থাকা সারি বাদ দেয়।

alter table public.mdr_shared_messages add column if not exists reply_to jsonb;
alter table public.mdr_shared_messages add column if not exists edited_at timestamptz;
alter table public.mdr_shared_messages add column if not exists deleted_at timestamptz;

-- জিম্মাদার/সহকারী জিম্মাদার বা স্টাফ — পিন যাচাই করে actor ফেরত দেয়।
create or replace function private.mdr_chat_actor(p_actor_id uuid, p_pin text, p_is_admin boolean)
returns public.mdr_shared_users
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  if coalesce(p_is_admin, false) then
    v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
  else
    select * into v_actor
    from public.mdr_shared_users
    where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);
  end if;
  return v_actor;
end;
$$;

revoke all on function private.mdr_chat_actor(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.mdr_rel_chat_post(
  p_actor_id uuid,
  p_pin text,
  p_thread_id text,
  p_text text,
  p_is_admin boolean default false,
  p_request jsonb default null,
  p_reply_to_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_thread text;
  v_admin boolean := coalesce(p_is_admin, false);
  v_id uuid;
  v_body text := btrim(coalesce(p_text, ''));
  v_from_name text := 'জিম্মাদার';
  v_reply jsonb;
begin
  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'empty_message'); end if;

  v_actor := private.mdr_chat_actor(p_actor_id, p_pin, v_admin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', case when v_admin then 'invalid_pin' else 'invalid_actor' end);
  end if;

  if v_admin then
    v_thread := btrim(coalesce(p_thread_id, ''));
    if v_thread = '' then return jsonb_build_object('ok', false, 'error', 'thread_required'); end if;
    v_from_name := coalesce(nullif(btrim(v_actor.name), ''), v_from_name);
  else
    v_thread := private.mdr_actor_thread(v_actor);
    if coalesce(p_thread_id, v_thread) <> v_thread then return jsonb_build_object('ok', false, 'error', 'thread_not_allowed'); end if;
    v_from_name := v_actor.name;
  end if;

  if p_reply_to_id is not null then
    select jsonb_build_object(
             'id', m.id,
             'text', left(m.body, 160),
             'from_role', m.from_role,
             'from_name', m.from_name
           )
    into v_reply
    from public.mdr_shared_messages m
    where m.id = p_reply_to_id and m.thread_id = v_thread and m.deleted_at is null;
    if v_reply is null then return jsonb_build_object('ok', false, 'error', 'reply_not_found'); end if;
  end if;

  if v_admin then
    insert into public.mdr_shared_messages (thread_id, from_user_id, from_role, from_name, body, read_admin, read_staff, request, reply_to)
    values (v_thread, v_actor.id, 'admin', v_from_name, v_body, true, false, p_request, v_reply)
    returning id into v_id;
    insert into public.mdr_shared_notifications (target, title, body, source_type, source_id)
    values (v_thread, 'জিম্মাদারের নতুন বার্তা', v_body, 'message', v_id);
  else
    insert into public.mdr_shared_messages (thread_id, from_user_id, from_role, from_name, body, read_admin, read_staff, request, reply_to)
    values (v_thread, v_actor.id, v_actor.role, v_from_name, v_body, false, true, p_request, v_reply)
    returning id into v_id;
    insert into public.mdr_shared_notifications (target, title, body, source_type, source_id)
    values ('admin', 'নতুন বার্তা', v_actor.name || ': ' || v_body, 'message', v_id);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'reply_to', v_reply);
end;
$$;

-- নিজের বার্তা কি এখনো বদলানো যায়? (নিজের, সাধারণ বার্তা, ১৫ মিনিটের মধ্যে)
create or replace function private.mdr_chat_own_editable(v_msg public.mdr_shared_messages, v_actor public.mdr_shared_users, p_is_admin boolean)
returns text
language plpgsql
stable
as $$
begin
  if v_msg.id is null or v_msg.deleted_at is not null then return 'message_not_found'; end if;
  if v_msg.from_user_id is distinct from v_actor.id then return 'not_own_message'; end if;
  if coalesce(p_is_admin, false) <> (v_msg.from_role = 'admin') then return 'not_own_message'; end if;
  if v_msg.request is not null then return 'request_message'; end if;
  if v_msg.created_at < now() - interval '15 minutes' then return 'edit_window_over'; end if;
  return null;
end;
$$;

revoke all on function private.mdr_chat_own_editable(public.mdr_shared_messages, public.mdr_shared_users, boolean) from public, anon, authenticated;

create or replace function public.mdr_rel_chat_edit_own(
  p_actor_id uuid,
  p_pin text,
  p_message_id uuid,
  p_text text,
  p_is_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_msg public.mdr_shared_messages%rowtype;
  v_body text := btrim(coalesce(p_text, ''));
  v_err text;
begin
  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'empty_message'); end if;
  v_actor := private.mdr_chat_actor(p_actor_id, p_pin, p_is_admin);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;

  select * into v_msg from public.mdr_shared_messages where id = p_message_id for update;
  v_err := private.mdr_chat_own_editable(v_msg, v_actor, p_is_admin);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  update public.mdr_shared_messages
  set body = v_body, edited_at = now()
  where id = p_message_id;

  return jsonb_build_object('ok', true, 'id', p_message_id, 'thread_id', v_msg.thread_id);
end;
$$;

create or replace function public.mdr_rel_chat_delete_own(
  p_actor_id uuid,
  p_pin text,
  p_message_id uuid,
  p_is_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_msg public.mdr_shared_messages%rowtype;
  v_err text;
begin
  v_actor := private.mdr_chat_actor(p_actor_id, p_pin, p_is_admin);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;

  select * into v_msg from public.mdr_shared_messages where id = p_message_id for update;
  v_err := private.mdr_chat_own_editable(v_msg, v_actor, p_is_admin);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  delete from public.mdr_shared_notifications where source_type = 'message' and source_id = p_message_id;
  delete from public.mdr_shared_messages where id = p_message_id;

  return jsonb_build_object('ok', true, 'id', p_message_id, 'thread_id', v_msg.thread_id);
end;
$$;

-- bootstrap: reply_to আর edited_at-ও ফেরত দেয়; মুছে ফেলা বার্তা বাদ।
create or replace function public.mdr_rel_chat_bootstrap(p_actor_id uuid, p_pin text, p_is_admin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_thread text;
  v_admin boolean := coalesce(p_is_admin, false);
begin
  if v_admin then
    v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
    if v_actor.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
  else
    select * into v_actor from public.mdr_shared_users where id = p_actor_id and is_active = true and private.mdr_pin_ok(pin, p_pin, p_actor_id::text);
    if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_actor'); end if;
    v_thread := private.mdr_actor_thread(v_actor);
  end if;

  return jsonb_build_object(
    'ok', true,
    'actor_id', v_actor.id,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'thread_id', m.thread_id,
        'from_role', m.from_role,
        'from_name', m.from_name,
        'from_user_id', m.from_user_id,
        'text', m.body,
        'ts', m.created_at,
        'read_admin', m.read_admin,
        'read_staff', m.read_staff,
        'request', m.request,
        'reply_to', m.reply_to,
        'edited_at', m.edited_at
      ) order by m.created_at), '[]'::jsonb)
      from public.mdr_shared_messages m
      where (v_admin or m.thread_id = v_thread) and m.deleted_at is null
    ),
    'unread_admin', (
      select count(*) from public.mdr_shared_messages m where v_admin and m.from_role <> 'admin' and m.read_admin = false and m.deleted_at is null
    ),
    'unread_staff', (
      select count(*) from public.mdr_shared_messages m where (not v_admin) and m.thread_id = v_thread and m.from_role = 'admin' and m.read_staff = false and m.deleted_at is null
    )
  );
end;
$$;

revoke all on function public.mdr_rel_chat_post(uuid, text, text, text, boolean, jsonb, uuid) from public;
revoke all on function public.mdr_rel_chat_edit_own(uuid, text, uuid, text, boolean) from public;
revoke all on function public.mdr_rel_chat_delete_own(uuid, text, uuid, boolean) from public;
grant execute on function public.mdr_rel_chat_post(uuid, text, text, text, boolean, jsonb, uuid) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_chat_edit_own(uuid, text, uuid, text, boolean) to anon, authenticated, service_role;
grant execute on function public.mdr_rel_chat_delete_own(uuid, text, uuid, boolean) to anon, authenticated, service_role;
