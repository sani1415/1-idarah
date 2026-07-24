-- Generic relational, read-only query gateway for the admin AI agent.
-- It accepts a validated JSON plan (not SQL), supports joins/grouping/ranking,
-- excludes security fields, and is available only after super-admin PIN auth.

create or replace function public.mdr_rel_admin_ai_schema(
  p_actor_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
set statement_timeout = '5s'
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_tables jsonb;
  v_relationships jsonb;
begin
  select * into v_actor from public.mdr_shared_users u
  where u.id=p_actor_id and u.pin=p_pin and u.is_active=true
    and (u.role='admin' or coalesce(u.admin_perms->>'super_admin','false')='true') limit 1;
  if v_actor.id is null and not private.verify_admin_pin(p_pin) then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;

  select coalesce(jsonb_agg(x order by x->>'table'),'[]'::jsonb) into v_tables
  from (
    select jsonb_build_object(
      'table',c.table_name,
      'columns',jsonb_agg(jsonb_build_object('name',c.column_name,'type',c.data_type) order by c.ordinal_position)
    ) x
    from information_schema.columns c
    join pg_class pc on pc.relname=c.table_name
    join pg_namespace pn on pn.oid=pc.relnamespace and pn.nspname='public'
    where c.table_schema='public' and pc.relkind in ('r','p','v')
      and c.table_name ~ '^mdr_' and c.table_name !~* '(^|_)(bak|backup|dup_bak)(_|$)'
      and c.table_name <> 'mdr_shared_push_subscriptions'
      and c.column_name !~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
    group by c.table_name
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'from_table',src.relname,
    'from_columns',(select jsonb_agg(sa.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum,ord) join pg_attribute sa on sa.attrelid=con.conrelid and sa.attnum=k.attnum),
    'to_table',dst.relname,
    'to_columns',(select jsonb_agg(da.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum,ord) join pg_attribute da on da.attrelid=con.confrelid and da.attnum=k.attnum)
  ) order by src.relname,dst.relname),'[]'::jsonb) into v_relationships
  from pg_constraint con
  join pg_class src on src.oid=con.conrelid
  join pg_namespace sn on sn.oid=src.relnamespace and sn.nspname='public'
  join pg_class dst on dst.oid=con.confrelid
  join pg_namespace dn on dn.oid=dst.relnamespace and dn.nspname='public'
  where con.contype='f' and src.relname ~ '^mdr_' and dst.relname ~ '^mdr_'
    and src.relname !~* '(^|_)(bak|backup)(_|$)' and dst.relname !~* '(^|_)(bak|backup)(_|$)';

  return jsonb_build_object('ok',true,'generated_at',now(),'tables',v_tables,'relationships',v_relationships);
end;
$$;

create or replace function public.mdr_rel_admin_ai_relational_query(
  p_actor_id uuid,
  p_pin text,
  p_query jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
set statement_timeout = '8s'
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_base text := p_query->>'table';
  v_base_alias text := coalesce(nullif(p_query->>'alias',''),'t0');
  v_aliases jsonb := '{}'::jsonb;
  v_from text;
  v_select text := '';
  v_where text := 'true';
  v_group text := '';
  v_order text := '';
  v_sql text;
  v_result jsonb;
  v_item jsonb;
  v_join jsonb;
  v_ref text;
  v_left text;
  v_right text;
  v_ref_alias text;
  v_col text;
  v_table text;
  v_alias text;
  v_out_alias text;
  v_fn text;
  v_op text;
  v_values text;
  v_dir text;
  v_join_type text;
  v_limit integer := least(greatest(coalesce((p_query->>'limit')::integer,100),1),200);
  v_join_count integer := 0;
begin
  select * into v_actor from public.mdr_shared_users u
  where u.id=p_actor_id and u.pin=p_pin and u.is_active=true
    and (u.role='admin' or coalesce(u.admin_perms->>'super_admin','false')='true') limit 1;
  if v_actor.id is null and not private.verify_admin_pin(p_pin) then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;

  if v_base is null or v_base !~ '^mdr_[a-z0-9_]+$' or v_base_alias !~ '^[a-z][a-z0-9_]*$'
    or v_base ~* '(^|_)(bak|backup|dup_bak)(_|$)' or v_base='mdr_shared_push_subscriptions'
    or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=v_base and c.relkind in ('r','p','v'))
  then return jsonb_build_object('ok',false,'error','base_table_not_allowed'); end if;

  v_aliases := jsonb_set(v_aliases,array[v_base_alias],to_jsonb(v_base),true);
  v_from := format('public.%I %I',v_base,v_base_alias);

  for v_join in select value from jsonb_array_elements(coalesce(p_query->'joins','[]'::jsonb))
  loop
    v_join_count := v_join_count+1;
    if v_join_count>5 then return jsonb_build_object('ok',false,'error','too_many_joins'); end if;
    v_table := v_join->>'table'; v_alias := v_join->>'alias';
    v_left := v_join->>'left'; v_right := v_join->>'right';
    v_join_type := lower(coalesce(v_join->>'type','inner'));
    if v_table !~ '^mdr_[a-z0-9_]+$' or v_alias !~ '^[a-z][a-z0-9_]*$'
      or v_aliases ? v_alias or v_join_type not in ('inner','left')
      or v_table ~* '(^|_)(bak|backup|dup_bak)(_|$)' or v_table='mdr_shared_push_subscriptions'
      or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=v_table and c.relkind in ('r','p','v'))
    then return jsonb_build_object('ok',false,'error','join_not_allowed','table',v_table); end if;
    v_aliases := jsonb_set(v_aliases,array[v_alias],to_jsonb(v_table),true);

    -- Validate both qualified equality references after registering the new alias.
    foreach v_ref in array array[v_left,v_right] loop
      if v_ref !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','invalid_join_reference'); end if;
      v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
      if v_table is null or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
        or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
      then return jsonb_build_object('ok',false,'error','join_column_not_allowed','column',v_ref); end if;
    end loop;
    v_from:=v_from||format(' %s join public.%I %I on %I.%I = %I.%I',v_join_type,v_aliases->>v_alias,v_alias,
      split_part(v_left,'.',1),split_part(v_left,'.',2),split_part(v_right,'.',1),split_part(v_right,'.',2));
  end loop;

  -- Selected fields are objects: {ref:"s.name", alias:"student_name"}.
  for v_item in select value from jsonb_array_elements(coalesce(p_query->'columns','[]'::jsonb)) loop
    v_ref:=v_item->>'ref'; v_out_alias:=coalesce(nullif(v_item->>'alias',''),replace(v_ref,'.','_'));
    if v_ref !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' or v_out_alias !~ '^[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','invalid_select'); end if;
    v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
    if v_table is null or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
      or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
    then return jsonb_build_object('ok',false,'error','select_column_not_allowed','column',v_ref); end if;
    if v_select<>'' then v_select:=v_select||', '; end if;
    v_select:=v_select||format('%I.%I as %I',v_ref_alias,v_col,v_out_alias);
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_query->'aggregates','[]'::jsonb)) loop
    v_fn:=lower(coalesce(v_item->>'function','')); v_ref:=coalesce(v_item->>'ref','*'); v_out_alias:=v_item->>'alias';
    if v_fn not in ('count','sum','avg','min','max') or v_out_alias !~ '^[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','aggregate_not_allowed'); end if;
    if v_ref='*' then
      if v_fn<>'count' then return jsonb_build_object('ok',false,'error','aggregate_ref_required'); end if;
    else
      if v_ref !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','invalid_aggregate_ref'); end if;
      v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
      if v_table is null or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
        or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
      then return jsonb_build_object('ok',false,'error','aggregate_column_not_allowed','column',v_ref); end if;
    end if;
    if v_select<>'' then v_select:=v_select||', '; end if;
    v_select:=v_select||case when v_ref='*' then format('%s(*) as %I',v_fn,v_out_alias)
      else format('%s(%I.%I) as %I',v_fn,split_part(v_ref,'.',1),split_part(v_ref,'.',2),v_out_alias) end;
  end loop;
  if v_select='' then v_select:='count(*) as count'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_query->'filters','[]'::jsonb)) loop
    v_ref:=v_item->>'ref'; v_op:=lower(coalesce(v_item->>'operator','eq'));
    if v_ref !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','invalid_filter_ref'); end if;
    v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
    if v_table is null or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
      or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
    then return jsonb_build_object('ok',false,'error','filter_column_not_allowed','column',v_ref); end if;
    if v_op='is_null' then v_where:=v_where||format(' and %I.%I is null',v_ref_alias,v_col);
    elsif v_op='not_null' then v_where:=v_where||format(' and %I.%I is not null',v_ref_alias,v_col);
    elsif v_op in ('in','not_in') then
      select string_agg(quote_literal(value),',') into v_values from jsonb_array_elements_text(coalesce(v_item->'values','[]'::jsonb));
      if v_values is null then v_where:=v_where||case when v_op='in' then ' and false' else ' and true' end;
      else v_where:=v_where||format(' and (%I.%I)::text %s (%s)',v_ref_alias,v_col,case when v_op='in' then 'in' else 'not in' end,v_values); end if;
    elsif v_op in ('eq','neq','gt','gte','lt','lte','ilike') then
      v_where:=v_where||format(' and (%I.%I)::text %s %L',v_ref_alias,v_col,
        case v_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' else 'ilike' end,
        coalesce(v_item->>'value',''));
    else return jsonb_build_object('ok',false,'error','operator_not_allowed','operator',v_op); end if;
  end loop;

  if jsonb_array_length(coalesce(p_query->'group_by','[]'::jsonb))>0 then
    v_group:=' group by ';
    for v_item in select value from jsonb_array_elements(p_query->'group_by') loop
      v_ref:=trim(both '"' from v_item::text);
      if v_ref !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then return jsonb_build_object('ok',false,'error','invalid_group_ref'); end if;
      v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
      if v_table is null or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
      then return jsonb_build_object('ok',false,'error','group_column_not_allowed'); end if;
      if right(v_group,9)<>'group by ' then v_group:=v_group||', '; end if;
      v_group:=v_group||format('%I.%I',v_ref_alias,v_col);
    end loop;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_query->'order_by','[]'::jsonb)) loop
    v_ref:=v_item->>'ref'; v_dir:=lower(coalesce(v_item->>'direction','asc'));
    if v_dir not in ('asc','desc') then return jsonb_build_object('ok',false,'error','invalid_order_direction'); end if;
    if v_ref ~ '^[a-z][a-z0-9_]*$' then
      if not exists(select 1 from jsonb_array_elements(coalesce(p_query->'aggregates','[]'::jsonb)) a where a->>'alias'=v_ref)
        and not exists(select 1 from jsonb_array_elements(coalesce(p_query->'columns','[]'::jsonb)) c where c->>'alias'=v_ref)
      then return jsonb_build_object('ok',false,'error','order_alias_not_allowed'); end if;
      v_ref:=format('%I',v_ref);
    elsif v_ref ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then
      v_ref_alias:=split_part(v_ref,'.',1); v_col:=split_part(v_ref,'.',2); v_table:=v_aliases->>v_ref_alias;
      if v_table is null or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
      then return jsonb_build_object('ok',false,'error','order_column_not_allowed'); end if;
      v_ref:=format('%I.%I',v_ref_alias,v_col);
    else return jsonb_build_object('ok',false,'error','invalid_order_ref'); end if;
    if v_order='' then v_order:=' order by '; else v_order:=v_order||', '; end if;
    v_order:=v_order||v_ref||' '||v_dir;
  end loop;

  v_sql:=format('select coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) from (select %s from %s where %s%s%s limit %s) q',
    v_select,v_from,v_where,v_group,v_order,v_limit);
  execute v_sql into v_result;
  return jsonb_build_object('ok',true,'generated_at',now(),'rows',v_result);
exception
  when query_canceled then return jsonb_build_object('ok',false,'error','query_timeout');
  when others then return jsonb_build_object('ok',false,'error','query_failed','detail',sqlerrm);
end;
$$;

revoke all on function public.mdr_rel_admin_ai_schema(uuid,text) from public,authenticated;
revoke all on function public.mdr_rel_admin_ai_relational_query(uuid,text,jsonb) from public,authenticated;
grant execute on function public.mdr_rel_admin_ai_schema(uuid,text) to anon;
grant execute on function public.mdr_rel_admin_ai_relational_query(uuid,text,jsonb) to anon;
