-- Atomic, idempotent Excel -> accounts import.
alter table public.mdr_account_incomes drop constraint if exists mdr_account_incomes_account_check;
alter table public.mdr_account_incomes add constraint mdr_account_incomes_account_check
  check (account in ('matbakh','madrasa','tamirat','general','qard_return'));
alter table public.mdr_account_expenses drop constraint if exists mdr_account_expenses_account_check;
alter table public.mdr_account_expenses add constraint mdr_account_expenses_account_check
  check (account in ('matbakh','madrasa','tamirat','general','qard'));

create unique index if not exists mdr_account_due_payments_source_key
  on public.mdr_account_due_payments ((metadata->>'sourceKey'))
  where nullif(metadata->>'sourceKey','') is not null;

create or replace function public.mdr_rel_accounts_import_batch(
  p_actor_id uuid, p_pin text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_actor public.shared_users%rowtype;
  v_e jsonb; v_i jsonb; v_p jsonb; v_old public.mdr_account_expenses%rowtype; v_oldp public.mdr_account_due_payments%rowtype;
  v_due public.mdr_account_dues%rowtype; v_id text; v_name text;
  v_ec int := 0; v_ic int := 0; v_pc int := 0;
  v_et numeric := 0; v_it numeric := 0; v_pt numeric := 0; v_delta numeric;
begin
  v_actor := private.mdr_account_actor(p_actor_id, p_pin, false);
  if v_actor.id is null then return jsonb_build_object('ok',false,'error','invalid_actor'); end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;

  for v_e in select value from jsonb_array_elements(coalesce(p_payload->'expenses','[]'::jsonb)) loop
    v_id := nullif(v_e->>'id','');
    if v_id is null or nullif(v_e->>'month','') is null or coalesce((v_e->>'amount')::numeric,0) <= 0 then
      raise exception 'invalid_expense_row';
    end if;
    select * into v_old from public.mdr_account_expenses where id=v_id for update;
    if v_old.id is not null and v_old.payment_method='due' and nullif(btrim(v_old.supplier),'') is not null and v_old.account <> 'qard' then
      update public.mdr_account_dues set total=greatest(total-v_old.amount,0), due=greatest(total-v_old.amount,0)-paid, updated_at=now()
      where account=v_old.account and lower(supplier)=lower(v_old.supplier);
    end if;
    insert into public.mdr_account_expenses(id,account,project,hijri_year,month,day,gregorian_date,category,description,quantity,unit,unit_price,amount,supplier,receipt_no,payment_method,source_file,source_sheet,source_row,metadata,created_by,updated_at)
    values(v_id,coalesce(nullif(v_e->>'account',''),'general'),nullif(v_e->>'project',''),nullif(v_e->>'hijriYear',''),v_e->>'month',nullif(v_e->>'day','')::int,nullif(v_e->>'date','')::date,nullif(v_e->>'category',''),coalesce(v_e->>'description',''),nullif(v_e->>'quantity','')::numeric,nullif(v_e->>'unit',''),nullif(v_e->>'unitPrice','')::numeric,(v_e->>'amount')::numeric,nullif(v_e->>'supplier',''),nullif(v_e->>'receiptNo',''),nullif(v_e->>'paymentMethod',''),nullif(v_e->>'sourceFile',''),nullif(v_e->>'sourceSheet',''),nullif(v_e->>'sourceRow','')::int,v_e-array['id','account','project','hijriYear','month','day','date','category','description','quantity','unit','unitPrice','amount','supplier','receiptNo','paymentMethod','sourceFile','sourceSheet','sourceRow'],v_actor.id,now())
    on conflict(id) do update set account=excluded.account,project=excluded.project,hijri_year=excluded.hijri_year,month=excluded.month,day=excluded.day,gregorian_date=excluded.gregorian_date,category=excluded.category,description=excluded.description,quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,amount=excluded.amount,supplier=excluded.supplier,receipt_no=excluded.receipt_no,payment_method=excluded.payment_method,source_file=excluded.source_file,source_sheet=excluded.source_sheet,source_row=excluded.source_row,metadata=excluded.metadata,updated_at=now();
    if (v_e->>'paymentMethod')='due' and nullif(btrim(v_e->>'supplier'),'') is not null and (v_e->>'account') <> 'qard' then
      v_id := 'due-'||substr(md5((v_e->>'account')||':'||lower(btrim(v_e->>'supplier'))),1,20);
      insert into public.mdr_account_dues(id,account,supplier,total,paid,due,created_by,updated_at)
      values(v_id,v_e->>'account',btrim(v_e->>'supplier'),(v_e->>'amount')::numeric,0,(v_e->>'amount')::numeric,v_actor.id,now())
      on conflict(account,lower(supplier)) do update set total=public.mdr_account_dues.total+excluded.total,due=public.mdr_account_dues.total+excluded.total-public.mdr_account_dues.paid,updated_at=now();
    end if;
    v_ec:=v_ec+1; v_et:=v_et+(v_e->>'amount')::numeric;
  end loop;

  if exists(select 1 from public.mdr_account_dues where due < 0) then
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
