-- বার্তায় বিভাগের লেনদেন এডিট/ডিলিট অনুরোধ অনুমোদন/রিজেক্ট করলে শুধু chat message-এর
-- request.status বদলাত; mdr_dept_edit_requests-এর সারি 'pending'-ই থেকে যেত। বিভাগের পোর্টাল
-- ওই টেবিল দেখে «অনুমতির অপেক্ষায়» দেখায়, তাই অনুমোদনের পরেও লেবেল সরত না।
-- এখন chat request review করলে মিলে যাওয়া pending edit request-ও একই status পায়।

create or replace function public.mdr_rel_chat_update_request(
  p_actor_id uuid,
  p_pin text,
  p_message_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_msg public.mdr_shared_messages%rowtype;
  v_reviewer text := 'জিম্মাদার';
  v_kind text;
  v_txn uuid;
begin
  v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;
  v_reviewer := coalesce(nullif(btrim(v_actor.name), ''), v_reviewer);

  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select * into v_msg from public.mdr_shared_messages where id = p_message_id;
  if v_msg.id is null then return jsonb_build_object('ok', false, 'error', 'message_not_found'); end if;
  if v_msg.request is null then return jsonb_build_object('ok', false, 'error', 'request_not_found'); end if;
  if coalesce(v_msg.request->>'status', 'pending') <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'request_already_reviewed');
  end if;

  update public.mdr_shared_messages
  set request = request || jsonb_build_object(
        'status', p_status,
        'reviewedAt', now(),
        'reviewedBy', v_reviewer
      ),
      read_staff = false
  where id = p_message_id;

  v_kind := v_msg.request->>'kind';
  if v_kind in ('dept_transaction_edit', 'dept_transaction_delete')
     and coalesce(v_msg.request->>'entryId', '') ~* '^[0-9a-f-]{36}$' then
    v_txn := (v_msg.request->>'entryId')::uuid;
    update public.mdr_dept_edit_requests r
    set status = p_status,
        resolved_by = v_actor.id,
        resolved_at = now()
    from public.mdr_dept_departments d
    where d.id = r.dept_id
      and v_msg.thread_id = 'dept-' || d.code
      and r.transaction_id = v_txn
      and r.kind = v_kind
      and r.status = 'pending';
  end if;

  return jsonb_build_object('ok', true, 'id', p_message_id);
end;
$$;

-- আগের যেসব অনুরোধ বার্তায় ইতোমধ্যে review হয়েছে কিন্তু edit request pending রয়ে গেছে, সেগুলো মিলিয়ে দেওয়া।
update public.mdr_dept_edit_requests r
set status = m.request->>'status',
    resolved_at = coalesce((m.request->>'reviewedAt')::timestamptz, now())
from public.mdr_shared_messages m, public.mdr_dept_departments d
where r.status = 'pending'
  and d.id = r.dept_id
  and m.thread_id = 'dept-' || d.code
  and m.request->>'kind' = r.kind
  and m.request->>'entryId' = r.transaction_id::text
  and m.request->>'status' in ('approved', 'rejected');
