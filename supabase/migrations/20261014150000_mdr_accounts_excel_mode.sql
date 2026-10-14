-- হিসাব: «Excel মোড» + অ্যাপের শীট (Excel-এর মতো এন্ট্রি)
--
-- Excel মোড চালু থাকলে দফতরের হিসাব শুধু Excel আপলোডে আসে — অ্যাপ থেকে আয়/ব্যয়/পরিশোধ যোগ,
-- বদলানো বা মোছা সার্ভারেই আটকায় (টেবিল trigger), যাতে দুই জায়গায় লেখা না হয়।
--   * সুইচ: mdr_settings.accounts_excel_mode — শুধু মূল জিম্মাদার বদলাতে পারেন
--     (mdr_rel_admin_accounts_excel_mode_set)। চালু করে রাখা হলো, কারণ এখন Excel-ই মূল হিসাব।
--   * লিখতে পারে: mdr_rel_accounts_import_batch (Excel আপলোড; payload.source = 'grid' হলে না),
--     আর delete_entry দিয়ে Excel থেকে আসা (id 'xl-…') সারি মোছা — «ফাইলে নেই» তালিকার জন্য।
--   * delete_entry এখন ব্যয় মুছলে সংশ্লিষ্ট বাকিও একই transaction-এ কমায়
--     (আগে client আলাদা RPC-তে করত — মাঝপথে ব্যর্থ হলে বাকি ভুল থাকত)।
--   * bootstrap এখন 'excel_mode' ফেরত দেয়।
--
-- Rollback:
--   drop trigger mdr_account_excel_guard on public.mdr_account_expenses;   (একইভাবে incomes, dues, due_payments)
--   drop function private.mdr_accounts_write_guard(); drop function private.mdr_accounts_excel_mode();
--   drop function public.mdr_rel_admin_accounts_excel_mode_set(uuid, text, boolean);
--   alter table public.mdr_settings drop column accounts_excel_mode;
--   আগের delete_entry / bootstrap / import_batch: 20260614… ও 20261014130500 migration দেখুন।

alter table public.mdr_settings add column if not exists accounts_excel_mode boolean not null default false;
update public.mdr_settings set accounts_excel_mode = true where id = true;

create or replace function private.mdr_accounts_excel_mode()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select s.accounts_excel_mode from public.mdr_settings s limit 1), false) $$;
revoke all on function private.mdr_accounts_excel_mode() from public, anon, authenticated;

create or replace function private.mdr_accounts_write_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_writer text := coalesce(current_setting('mdr.accounts_writer', true), '');
begin
  if private.mdr_accounts_excel_mode() and v_writer <> 'batch' then
    if v_writer = 'xl_delete' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    raise exception 'excel_mode' using hint = 'হিসাব এখন Excel মোডে — শুধু Excel আপলোডে বদলায়';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.mdr_accounts_write_guard() from public, anon, authenticated;

drop trigger if exists mdr_account_excel_guard on public.mdr_account_expenses;
create trigger mdr_account_excel_guard before insert or update or delete on public.mdr_account_expenses
  for each row execute function private.mdr_accounts_write_guard();
drop trigger if exists mdr_account_excel_guard on public.mdr_account_incomes;
create trigger mdr_account_excel_guard before insert or update or delete on public.mdr_account_incomes
  for each row execute function private.mdr_accounts_write_guard();
drop trigger if exists mdr_account_excel_guard on public.mdr_account_dues;
create trigger mdr_account_excel_guard before insert or update or delete on public.mdr_account_dues
  for each row execute function private.mdr_accounts_write_guard();
drop trigger if exists mdr_account_excel_guard on public.mdr_account_due_payments;
create trigger mdr_account_excel_guard before insert or update or delete on public.mdr_account_due_payments
  for each row execute function private.mdr_accounts_write_guard();

-- ── সুইচ (শুধু মূল জিম্মাদার)
create or replace function public.mdr_rel_admin_accounts_excel_mode_set(p_actor_id uuid, p_pin text, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid := private.mdr_duty_pause_main_admin(p_actor_id, p_pin);
begin
  if v_admin is null then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  update public.mdr_settings set accounts_excel_mode = coalesce(p_on, false), updated_by = v_admin, updated_at = now() where id = true;
  return jsonb_build_object('ok', true, 'excel_mode', private.mdr_accounts_excel_mode());
end;
$$;
revoke all on function public.mdr_rel_admin_accounts_excel_mode_set(uuid, text, boolean) from public, authenticated;
grant execute on function public.mdr_rel_admin_accounts_excel_mode_set(uuid, text, boolean) to anon;

-- ── মোছা: ব্যয়ের বাকিও একসাথে কমে; Excel মোডে শুধু Excel থেকে আসা ('xl-…') সারি
create or replace function public.mdr_rel_account_delete_entry(p_actor_id uuid, p_pin text, p_type text, p_id text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_exp public.mdr_account_expenses%rowtype;
  v_deleted int;
begin
  v_actor := private.mdr_account_actor(p_actor_id, p_pin, false);
  if v_actor.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_actor'); end if;
  if private.mdr_accounts_excel_mode() then
    if coalesce(p_id, '') not like 'xl-%' then return jsonb_build_object('ok', false, 'error', 'excel_mode'); end if;
    perform set_config('mdr.accounts_writer', 'xl_delete', true);
  end if;

  if p_type = 'income' then
    delete from public.mdr_account_incomes where id = p_id;
  elsif p_type = 'expense' then
    select * into v_exp from public.mdr_account_expenses where id = p_id for update;
    if v_exp.id is not null and v_exp.payment_method = 'due' and nullif(btrim(v_exp.supplier), '') is not null and v_exp.account <> 'qard' then
      update public.mdr_account_dues
         set total = greatest(total - v_exp.amount, 0), due = greatest(total - v_exp.amount, 0) - paid, updated_at = now()
       where account = v_exp.account and lower(supplier) = lower(btrim(v_exp.supplier));
    end if;
    delete from public.mdr_account_expenses where id = p_id;
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  get diagnostics v_deleted = ROW_COUNT;
  if v_deleted < 1 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'dues_adjusted', true);
end;
$$;

-- ── Excel আপলোড / অ্যাপের শীট: একই atomic batch
create or replace function public.mdr_rel_accounts_import_batch(
  p_actor_id uuid, p_pin text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_touched text[] := array[]::text[]; v_tid text;
  v_e jsonb; v_i jsonb; v_p jsonb; v_old public.mdr_account_expenses%rowtype; v_oldp public.mdr_account_due_payments%rowtype;
  v_due public.mdr_account_dues%rowtype; v_id text; v_name text;
  v_ec int := 0; v_ic int := 0; v_pc int := 0;
  v_et numeric := 0; v_it numeric := 0; v_pt numeric := 0; v_delta numeric;
begin
  v_actor := private.mdr_account_actor(p_actor_id, p_pin, false);
  if v_actor.id is null then return jsonb_build_object('ok',false,'error','invalid_actor'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;
  -- Excel মোডে অ্যাপের শীট (source = 'grid') থেকে লেখা বন্ধ; Excel আপলোড চলে।
  if coalesce(p_payload->>'source','') = 'grid' and private.mdr_accounts_excel_mode() then
    return jsonb_build_object('ok',false,'error','excel_mode');
  end if;
  perform set_config('mdr.accounts_writer', 'batch', true);

  for v_e in select value from jsonb_array_elements(coalesce(p_payload->'expenses','[]'::jsonb)) loop
    v_id := nullif(v_e->>'id','');
    if v_id is null or nullif(v_e->>'month','') is null or coalesce((v_e->>'amount')::numeric,0) <= 0 then
      raise exception 'invalid_expense_row';
    end if;
    select * into v_old from public.mdr_account_expenses where id=v_id for update;
    if v_old.id is not null and v_old.payment_method='due' and nullif(btrim(v_old.supplier),'') is not null and v_old.account <> 'qard' then
      update public.mdr_account_dues set total=greatest(total-v_old.amount,0), due=greatest(total-v_old.amount,0)-paid, updated_at=now()
      where account=v_old.account and lower(supplier)=lower(v_old.supplier) returning id into v_tid;
      if v_tid is not null then v_touched := v_touched || v_tid; end if;
    end if;
    insert into public.mdr_account_expenses(id,account,project,hijri_year,month,day,gregorian_date,category,description,quantity,unit,unit_price,amount,supplier,receipt_no,payment_method,source_file,source_sheet,source_row,metadata,created_by,updated_at)
    values(v_id,coalesce(nullif(v_e->>'account',''),'general'),nullif(v_e->>'project',''),nullif(v_e->>'hijriYear',''),v_e->>'month',nullif(v_e->>'day','')::int,nullif(v_e->>'date','')::date,nullif(v_e->>'category',''),coalesce(v_e->>'description',''),nullif(v_e->>'quantity','')::numeric,nullif(v_e->>'unit',''),nullif(v_e->>'unitPrice','')::numeric,(v_e->>'amount')::numeric,nullif(v_e->>'supplier',''),nullif(v_e->>'receiptNo',''),nullif(v_e->>'paymentMethod',''),nullif(v_e->>'sourceFile',''),nullif(v_e->>'sourceSheet',''),nullif(v_e->>'sourceRow','')::int,v_e-array['id','account','project','hijriYear','month','day','date','category','description','quantity','unit','unitPrice','amount','supplier','receiptNo','paymentMethod','sourceFile','sourceSheet','sourceRow'],v_actor.id,now())
    on conflict(id) do update set account=excluded.account,project=excluded.project,hijri_year=excluded.hijri_year,month=excluded.month,day=excluded.day,gregorian_date=excluded.gregorian_date,category=excluded.category,description=excluded.description,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,amount=excluded.amount,supplier=excluded.supplier,receipt_no=excluded.receipt_no,payment_method=excluded.payment_method,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_row=excluded.source_row,metadata=excluded.metadata,updated_at=now();
    if (v_e->>'paymentMethod')='due' and nullif(btrim(v_e->>'supplier'),'') is not null and (v_e->>'account') <> 'qard' then
      v_id := 'due-'||substr(md5((v_e->>'account')||':'||lower(btrim(v_e->>'supplier'))),1,20);
      insert into public.mdr_account_dues(id,account,supplier,total,paid,due,created_by,updated_at)
      values(v_id,v_e->>'account',btrim(v_e->>'supplier'),(v_e->>'amount')::numeric,0,(v_e->>'amount')::numeric,v_actor.id,now())
      on conflict(account,lower(supplier)) do update set total=public.mdr_account_dues.total+excluded.total,due=public.mdr_account_dues.total+excluded.total-public.mdr_account_dues.paid,updated_at=now()
      returning id into v_tid;
      v_touched := v_touched || v_tid;
    end if;
    v_ec:=v_ec+1; v_et:=v_et+(v_e->>'amount')::numeric;
  end loop;

  -- শুধু এই আপলোডে বদলানো সরবরাহকারী; আগে থেকে ঋণাত্মক অন্য কোনো বাকির জন্য পুরো আপলোড আটকাবে না
  if exists(select 1 from public.mdr_account_dues where id = any(v_touched) and due < 0) then
    raise exception 'purchase_total_below_existing_payments';
  end if;

  for v_i in select value from jsonb_array_elements(coalesce(p_payload->'incomes','[]'::jsonb)) loop
    v_id:=nullif(v_i->>'id','');
    if v_id is null or nullif(v_i->>'month','') is null or coalesce((v_i->>'amount')::numeric,0)<=0 then raise exception 'invalid_income_row'; end if;
    insert into public.mdr_account_incomes(id,account,hijri_year,month,day,gregorian_date,amount,note,source_file,source_sheet,source_row,metadata,created_by,updated_at)
    values(v_id,coalesce(nullif(v_i->>'account',''),'general'),nullif(v_i->>'hijriYear',''),v_i->>'month',nullif(v_i->>'day','')::int,nullif(v_i->>'date','')::date,(v_i->>'amount')::numeric,coalesce(v_i->>'note',''),nullif(v_i->>'sourceFile',''),nullif(v_i->>'sourceSheet',''),nullif(v_i->>'sourceRow','')::int,v_i-array['id','account','hijriYear','month','day','date','amount','note','sourceFile','sourceSheet','sourceRow'],v_actor.id,now())
    on conflict(id) do update set account=excluded.account,hijri_year=excluded.hijri_year,month=excluded.month,day=excluded.day,gregorian_date=excluded.gregorian_date,amount=excluded.amount,note=excluded.note,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_row=excluded.source_row,metadata=excluded.metadata,updated_at=now();
    v_ic:=v_ic+1; v_it:=v_it+(v_i->>'amount')::numeric;
  end loop;

  for v_p in select value from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    v_id:=nullif(v_p->>'id','');
    if v_id is null or nullif(v_p->>'supplier','') is null or coalesce((v_p->>'amount')::numeric,0)<=0 then raise exception 'invalid_payment_row'; end if;
    select * into v_oldp from public.mdr_account_due_payments where id=v_id for update;
    if v_oldp.id is not null then
      update public.mdr_account_dues set paid=greatest(paid-v_oldp.amount,0),due=total-greatest(paid-v_oldp.amount,0),updated_at=now() where id=v_oldp.due_id;
    end if;
    select * into v_due from public.mdr_account_dues where account=v_p->>'account' and lower(supplier)=lower(btrim(v_p->>'supplier')) for update;
    if v_due.id is null then raise exception 'payment_due_not_found: %',v_p->>'supplier'; end if;
    v_delta:=(v_p->>'amount')::numeric;
    if v_delta > v_due.due then raise exception 'payment_exceeds_due: %',v_p->>'supplier'; end if;
    update public.mdr_account_dues set paid=paid+v_delta,due=due-v_delta,updated_at=now() where id=v_due.id;
    insert into public.mdr_account_due_payments(id,due_id,account,supplier,hijri_year,month,day,gregorian_date,raw_date,amount,receipt_no,source_file,source_sheet,source_row,metadata,created_by)
    values(v_id,v_due.id,v_due.account,v_due.supplier,nullif(v_p->>'hijriYear',''),nullif(v_p->>'month',''),nullif(v_p->>'day','')::int,nullif(v_p->>'date','')::date,nullif(v_p->>'rawDate',''),(v_p->>'amount')::numeric,nullif(v_p->>'receiptNo',''),nullif(v_p->>'sourceFile',''),nullif(v_p->>'sourceSheet',''),nullif(v_p->>'sourceRow','')::int,v_p-array['id','account','supplier','hijriYear','month','day','date','rawDate','amount','receiptNo','sourceFile','sourceSheet','sourceRow'],v_actor.id)
    on conflict(id) do update set due_id=excluded.due_id,account=excluded.account,supplier=excluded.supplier,amount=excluded.amount,hijri_year=excluded.hijri_year,month=excluded.month,day=excluded.day,gregorian_date=excluded.gregorian_date,receipt_no=excluded.receipt_no,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_row=excluded.source_row,metadata=excluded.metadata;
    v_pc:=v_pc+1; v_pt:=v_pt+(v_p->>'amount')::numeric;
  end loop;

  for v_name in select btrim(value) from jsonb_array_elements_text(coalesce(p_payload->'categories','[]'::jsonb)) loop
    if v_name<>'' then insert into public.mdr_account_categories(name,created_by) values(v_name,v_actor.id) on conflict(name) do nothing; end if;
  end loop;
  if coalesce((p_payload#>>'{expected,expenseCount}')::int,v_ec)<>v_ec
    or coalesce((p_payload#>>'{expected,incomeCount}')::int,v_ic)<>v_ic
    or coalesce((p_payload#>>'{expected,paymentCount}')::int,v_pc)<>v_pc
    or abs(coalesce((p_payload#>>'{expected,expenseTotal}')::numeric,v_et)-v_et)>0.009
    or abs(coalesce((p_payload#>>'{expected,incomeTotal}')::numeric,v_it)-v_it)>0.009
    or abs(coalesce((p_payload#>>'{expected,paymentTotal}')::numeric,v_pt)-v_pt)>0.009 then
    raise exception 'import_reconciliation_failed';
  end if;
  return jsonb_build_object('ok',true,'reconciliation',jsonb_build_object('expenseCount',v_ec,'incomeCount',v_ic,'paymentCount',v_pc,'expenseTotal',v_et,'incomeTotal',v_it,'paymentTotal',v_pt));
end;
$$;

revoke execute on function public.mdr_rel_accounts_import_batch(uuid,text,jsonb) from public,authenticated;
grant execute on function public.mdr_rel_accounts_import_batch(uuid,text,jsonb) to anon;

-- ── bootstrap: excel_mode যোগ (বাকি অংশ আগের মতো)
create or replace function public.mdr_rel_accounts_bootstrap(p_actor_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
begin
  v_actor := private.mdr_account_actor(p_actor_id, p_pin, true);
  if v_actor.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_actor');
  end if;

  return jsonb_build_object(
    'ok', true,
    'read_only', v_actor.role = 'admin',
    'excel_mode', private.mdr_accounts_excel_mode(),
    'incomes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'account', i.account, 'hijriYear', i.hijri_year, 'month', i.month, 'day', i.day,
        'date', coalesce(i.gregorian_date::text, ''), 'amount', i.amount, 'note', i.note,
        'sourceFile', i.source_file, 'sourceSheet', i.source_sheet, 'sourceRow', i.source_row,
        '_at', floor(extract(epoch from i.created_at) * 1000)::bigint,
        '_updatedAt', floor(extract(epoch from i.updated_at) * 1000)::bigint
      ) order by i.hijri_year, i.month, i.day, i.id)
      from public.mdr_account_incomes i
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'account', e.account, 'project', e.project, 'hijriYear', e.hijri_year, 'month', e.month, 'day', e.day,
        'date', coalesce(e.gregorian_date::text, ''), 'category', e.category, 'description', e.description,
        'quantity', e.quantity, 'unit', e.unit, 'unitPrice', e.unit_price, 'amount', e.amount,
        'supplier', e.supplier, 'receiptNo', e.receipt_no, 'paymentMethod', e.payment_method,
        'sourceFile', e.source_file, 'sourceSheet', e.source_sheet, 'sourceRow', e.source_row,
        '_at', floor(extract(epoch from e.created_at) * 1000)::bigint,
        '_updatedAt', floor(extract(epoch from e.updated_at) * 1000)::bigint
      ) order by e.hijri_year, e.month, e.day, e.id)
      from public.mdr_account_expenses e
    ), '[]'::jsonb),
    'dues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'account', d.account, 'supplier', d.supplier, 'total', d.total, 'paid', d.paid, 'due', d.due,
        'sourceFile', d.source_file, 'sourceSheet', d.source_sheet, 'sourceRow', d.source_row
      ) order by d.account, d.supplier)
      from public.mdr_account_dues d
    ), '[]'::jsonb),
    'duePayments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'dueId', p.due_id, 'account', p.account, 'supplier', p.supplier,
        'hijriYear', p.hijri_year, 'month', p.month, 'day', p.day,
        'date', coalesce(p.gregorian_date::text, ''), 'rawDate', p.raw_date, 'amount', p.amount,
        'receiptNo', p.receipt_no, 'sourceFile', p.source_file, 'sourceSheet', p.source_sheet, 'sourceRow', p.source_row,
        '_at', floor(extract(epoch from p.created_at) * 1000)::bigint
      ) order by p.created_at, p.id)
      from public.mdr_account_due_payments p
    ), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(c.name order by c.name) from public.mdr_account_categories c), '[]'::jsonb)
  );
end;
$$;
