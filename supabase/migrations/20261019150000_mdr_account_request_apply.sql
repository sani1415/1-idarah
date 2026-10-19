-- দফতরের «হিসাব সংশোধন অনুরোধ» (account_entry_edit / account_entry_delete) জিম্মাদার অনুমোদন দিলে
-- এন্ট্রি বদল/মোছা এবং অনুরোধের অবস্থা — দুটোই এক server transaction-এ হয়।
--
-- আগের সমস্যা: chat.html অনুমোদনের সময় দফতরের লেখার RPC (mdr_rel_account_delete_entry /
-- upsert_*) জিম্মাদারের PIN দিয়ে ডাকত; ওগুলো শুধু daftar role মানে (mdr_account_actor(..., false)),
-- তাই সবসময় invalid_actor → «হিসাবের এন্ট্রি আপডেট/ডিলিট করা যায়নি।» এডিট-অনুরোধে লোকাল
-- ক্যাশে এন্ট্রি না থাকলে সার্ভার না ডেকেই «অনুমোদিত» দেখাত।
--
-- জিম্মাদারকে সরাসরি হিসাব লেখার অধিকার দেওয়া হয়নি; শুধু দফতর যে অনুরোধ পাঠিয়েছে সেটাই
-- এই RPC প্রয়োগ করে।

create or replace function public.mdr_rel_account_request_apply(
  p_actor_id uuid,
  p_pin text,
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_msg public.mdr_shared_messages%rowtype;
  v_req jsonb;
  v_kind text;
  v_type text;
  v_id text;
  v_inc public.mdr_account_incomes%rowtype;
  v_exp public.mdr_account_expenses%rowtype;
  v_prop jsonb;
  v_entry jsonb;
  v_reviewer text := 'জিম্মাদার';
  v_xl boolean := private.mdr_accounts_excel_mode();
begin
  v_actor := private.mdr_resolve_chat_admin(p_actor_id, p_pin);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;
  if not (v_actor.role = 'admin' or coalesce(v_actor.admin_perms->>'super_admin', 'false') = 'true') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  v_reviewer := coalesce(nullif(btrim(v_actor.name), ''), v_reviewer);

  select * into v_msg from public.mdr_shared_messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_at is not null then return jsonb_build_object('ok', false, 'error', 'message_not_found'); end if;
  v_req := v_msg.request;
  if v_req is null then return jsonb_build_object('ok', false, 'error', 'request_not_found'); end if;
  v_kind := v_req->>'kind';
  if v_kind not in ('account_entry_edit', 'account_entry_delete') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;
  if coalesce(v_req->>'status', 'pending') <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'request_already_reviewed');
  end if;

  v_type := v_req->>'entryType';
  v_id := nullif(btrim(coalesce(v_req->>'entryId', '')), '');
  if v_type not in ('income', 'expense') or v_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  -- Excel মোডে দফতর নিজে যা পারে, অনুমোদনও শুধু তা-ই পারে: Excel-এর (xl-) এন্ট্রি মোছা।
  if v_xl then
    if v_kind <> 'account_entry_delete' or v_id not like 'xl-%' then
      return jsonb_build_object('ok', false, 'error', 'excel_mode');
    end if;
    perform set_config('mdr.accounts_writer', 'xl_delete', true);
  end if;

  if v_kind = 'account_entry_delete' then
    if v_type = 'income' then
      delete from public.mdr_account_incomes where id = v_id returning * into v_inc;
      if v_inc.id is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;
    else
      select * into v_exp from public.mdr_account_expenses where id = v_id for update;
      if v_exp.id is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;
      -- mdr_rel_account_delete_entry-এর মতোই: বাকিতে কেনা হলে সরবরাহকারীর বাকি কমে
      if v_exp.payment_method = 'due' and nullif(btrim(v_exp.supplier), '') is not null and v_exp.account <> 'qard' then
        update public.mdr_account_dues
           set total = greatest(total - v_exp.amount, 0), due = greatest(total - v_exp.amount, 0) - paid, updated_at = now()
         where account = v_exp.account and lower(supplier) = lower(btrim(v_exp.supplier));
      end if;
      delete from public.mdr_account_expenses where id = v_id;
    end if;
  else
    v_prop := v_req->'proposed';
    if v_prop is null or jsonb_typeof(v_prop) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid_request');
    end if;
    v_prop := v_prop - array['id', 'sourceFile', 'sourceSheet', 'sourceRow'];

    if v_type = 'income' then
      select * into v_inc from public.mdr_account_incomes where id = v_id for update;
      if v_inc.id is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;
      v_entry := coalesce(v_inc.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'account', v_inc.account, 'hijriYear', v_inc.hijri_year, 'month', v_inc.month, 'day', v_inc.day,
        'date', v_inc.gregorian_date, 'amount', v_inc.amount, 'note', v_inc.note)) || v_prop;
      update public.mdr_account_incomes set
        account = coalesce(nullif(v_entry->>'account', ''), 'general'),
        hijri_year = nullif(v_entry->>'hijriYear', ''),
        month = nullif(v_entry->>'month', ''),
        day = nullif(v_entry->>'day', '')::integer,
        gregorian_date = nullif(v_entry->>'date', '')::date,
        amount = greatest(coalesce(nullif(v_entry->>'amount', '')::numeric, 0), 0),
        note = coalesce(v_entry->>'note', ''),
        metadata = metadata || (v_prop - array['account','hijriYear','month','day','date','amount','note']),
        updated_at = now()
      where id = v_id;
    else
      select * into v_exp from public.mdr_account_expenses where id = v_id for update;
      if v_exp.id is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;
      v_entry := coalesce(v_exp.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'account', v_exp.account, 'project', v_exp.project, 'hijriYear', v_exp.hijri_year, 'month', v_exp.month,
        'day', v_exp.day, 'date', v_exp.gregorian_date, 'category', v_exp.category, 'description', v_exp.description,
        'quantity', v_exp.quantity, 'unit', v_exp.unit, 'unitPrice', v_exp.unit_price, 'amount', v_exp.amount,
        'supplier', v_exp.supplier, 'receiptNo', v_exp.receipt_no, 'paymentMethod', v_exp.payment_method)) || v_prop;
      update public.mdr_account_expenses set
        account = coalesce(nullif(v_entry->>'account', ''), 'general'),
        project = nullif(v_entry->>'project', ''),
        hijri_year = nullif(v_entry->>'hijriYear', ''),
        month = nullif(v_entry->>'month', ''),
        day = nullif(v_entry->>'day', '')::integer,
        gregorian_date = nullif(v_entry->>'date', '')::date,
        category = nullif(v_entry->>'category', ''),
        description = coalesce(v_entry->>'description', ''),
        quantity = nullif(v_entry->>'quantity', '')::numeric,
        unit = nullif(v_entry->>'unit', ''),
        unit_price = nullif(v_entry->>'unitPrice', '')::numeric,
        amount = greatest(coalesce(nullif(v_entry->>'amount', '')::numeric, 0), 0),
        supplier = nullif(v_entry->>'supplier', ''),
        receipt_no = nullif(v_entry->>'receiptNo', ''),
        payment_method = nullif(v_entry->>'paymentMethod', ''),
        metadata = metadata || (v_prop - array['account','project','hijriYear','month','day','date','category','description',
          'quantity','unit','unitPrice','amount','supplier','receiptNo','paymentMethod']),
        updated_at = now()
      where id = v_id;
    end if;
  end if;

  update public.mdr_shared_messages
  set request = request || jsonb_build_object('status', 'approved', 'reviewedAt', now(), 'reviewedBy', v_reviewer),
      read_staff = false
  where id = p_message_id;

  return jsonb_build_object('ok', true, 'id', p_message_id, 'kind', v_kind, 'entry_id', v_id);
end;
$$;

revoke all on function public.mdr_rel_account_request_apply(uuid, text, uuid) from public;
grant execute on function public.mdr_rel_account_request_apply(uuid, text, uuid) to anon;

-- সাধারণ অবস্থা-বদলের RPC দিয়ে হিসাব-অনুরোধ «অনুমোদিত» চিহ্নিত করা যাবে না (এন্ট্রি না বদলে)।
-- রিজেক্ট আগের মতোই এখান দিয়ে হয়।
create or replace function public.mdr_rel_chat_update_request(p_actor_id uuid, p_pin text, p_message_id uuid, p_status text)
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

  v_kind := v_msg.request->>'kind';
  if p_status = 'approved' and v_kind in ('account_entry_edit', 'account_entry_delete') then
    return jsonb_build_object('ok', false, 'error', 'use_account_request_apply');
  end if;

  update public.mdr_shared_messages
  set request = request || jsonb_build_object(
        'status', p_status,
        'reviewedAt', now(),
        'reviewedBy', v_reviewer
      ),
      read_staff = false
  where id = p_message_id;

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
