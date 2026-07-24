-- Read-only, super-admin-only reporting gateway for the AI assistant.
-- The model never receives SQL access. It can inspect a safe catalog and submit
-- a small JSON query plan; this function validates every table/column/operator.

create or replace function public.mdr_rel_admin_ai_query(
  p_actor_id uuid,
  p_pin text,
  p_request jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
set statement_timeout = '8s'
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_action text := lower(coalesce(p_request->>'action', 'catalog'));
  v_table text := p_request->>'table';
  v_columns jsonb := coalesce(p_request->'columns', '[]'::jsonb);
  v_filters jsonb := coalesce(p_request->'filters', '[]'::jsonb);
  v_group_by jsonb := coalesce(p_request->'group_by', '[]'::jsonb);
  v_aggregates jsonb := coalesce(p_request->'aggregates', '[]'::jsonb);
  v_limit integer := least(greatest(coalesce((p_request->>'limit')::integer, 100), 1), 200);
  v_order_col text := p_request#>>'{order,column}';
  v_order_dir text := lower(coalesce(p_request#>>'{order,direction}', 'asc'));
  v_select text := '';
  v_where text := 'true';
  v_group text := '';
  v_order text := '';
  v_sql text;
  v_result jsonb;
  v_item jsonb;
  v_col text;
  v_op text;
  v_alias text;
  v_fn text;
  v_type text;
  v_values text;
begin
  select * into v_actor
  from public.mdr_shared_users u
  where u.id = p_actor_id
    and u.pin = p_pin
    and u.is_active = true
    and (u.role = 'admin' or coalesce(u.admin_perms->>'super_admin', 'false') = 'true')
  limit 1;

  if v_actor.id is null and not private.verify_admin_pin(p_pin) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if v_action = 'catalog' then
    select coalesce(jsonb_agg(t order by t->>'table'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'table', c.table_name,
        'columns', jsonb_agg(jsonb_build_object(
          'name', c.column_name,
          'type', c.data_type
        ) order by c.ordinal_position)
      ) as t
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public'
        and pc.relkind in ('r', 'p', 'v')
        and c.table_name ~ '^mdr_'
        and c.table_name !~* '(^|_)(bak|backup|dup_bak)(_|$)'
        and c.table_name <> 'mdr_shared_push_subscriptions'
        and c.column_name !~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
      group by c.table_name
    ) q;
    return jsonb_build_object('ok', true, 'generated_at', now(), 'tables', v_result);
  end if;

  if v_action <> 'query' or v_table is null or v_table !~ '^mdr_[a-z0-9_]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;
  if v_table ~* '(^|_)(bak|backup|dup_bak)(_|$)' or v_table = 'mdr_shared_push_subscriptions' then
    return jsonb_build_object('ok', false, 'error', 'table_not_allowed');
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = v_table
  ) then
    return jsonb_build_object('ok', false, 'error', 'table_not_found');
  end if;

  -- Plain selected/grouped columns.
  for v_item in select value from jsonb_array_elements(v_group_by || v_columns)
  loop
    v_col := trim(both '"' from v_item::text);
    if v_col !~ '^[a-z][a-z0-9_]*$'
       or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
    then return jsonb_build_object('ok', false, 'error', 'column_not_allowed', 'column', v_col);
    end if;
    if v_select <> '' then v_select := v_select || ', '; end if;
    v_select := v_select || format('%I', v_col);
  end loop;

  -- Aggregates: count(*) or sum/avg/min/max on a validated column.
  for v_item in select value from jsonb_array_elements(v_aggregates)
  loop
    v_fn := lower(coalesce(v_item->>'function', ''));
    v_col := coalesce(v_item->>'column', '*');
    v_alias := coalesce(nullif(v_item->>'alias',''), v_fn || '_' || replace(v_col, '*', 'all'));
    if v_fn not in ('count','sum','avg','min','max') or v_alias !~ '^[a-z][a-z0-9_]*$' then
      return jsonb_build_object('ok', false, 'error', 'aggregate_not_allowed');
    end if;
    if v_col = '*' and v_fn <> 'count' then
      return jsonb_build_object('ok', false, 'error', 'aggregate_column_required');
    end if;
    if v_col <> '*' and (
      v_col !~ '^[a-z][a-z0-9_]*$'
      or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
      or not exists (select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
    ) then return jsonb_build_object('ok', false, 'error', 'column_not_allowed', 'column', v_col);
    end if;
    if v_select <> '' then v_select := v_select || ', '; end if;
    v_select := v_select || case when v_col='*' then format('%s(*) as %I', v_fn, v_alias)
      else format('%s(%I) as %I', v_fn, v_col, v_alias) end;
  end loop;

  if v_select = '' then v_select := 'count(*) as count'; end if;

  for v_item in select value from jsonb_array_elements(v_filters)
  loop
    v_col := v_item->>'column';
    v_op := lower(coalesce(v_item->>'operator', 'eq'));
    if v_col !~ '^[a-z][a-z0-9_]*$'
       or v_col ~* '(^|_)(pin|password|secret|token|auth|p256dh|endpoint|api_?key)(_|$)'
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_col)
    then return jsonb_build_object('ok', false, 'error', 'filter_column_not_allowed', 'column', v_col);
    end if;
    if v_op = 'is_null' then
      v_where := v_where || format(' and %I is null', v_col);
    elsif v_op = 'not_null' then
      v_where := v_where || format(' and %I is not null', v_col);
    elsif v_op in ('in','not_in') then
      select string_agg(quote_literal(value), ',') into v_values
      from jsonb_array_elements_text(coalesce(v_item->'values', '[]'::jsonb));
      if v_values is null then
        v_where := v_where || case when v_op='in' then ' and false' else ' and true' end;
      else
        v_where := v_where || format(' and (%I)::text %s (%s)', v_col,
          case when v_op='in' then 'in' else 'not in' end, v_values);
      end if;
    elsif v_op in ('eq','neq','gt','gte','lt','lte','ilike') then
      v_where := v_where || format(' and (%I)::text %s %L', v_col,
        case v_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>='
          when 'lt' then '<' when 'lte' then '<=' else 'ilike' end,
        coalesce(v_item->>'value',''));
    else
      return jsonb_build_object('ok', false, 'error', 'operator_not_allowed', 'operator', v_op);
    end if;
  end loop;

  if jsonb_array_length(v_group_by) > 0 then
    select string_agg(format('%I', trim(both '"' from value::text)), ', ')
    into v_group from jsonb_array_elements(v_group_by);
    v_group := ' group by ' || v_group;
  end if;

  if v_order_col is not null then
    if v_order_col !~ '^[a-z][a-z0-9_]*$' or v_order_dir not in ('asc','desc') then
      return jsonb_build_object('ok', false, 'error', 'invalid_order');
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name=v_order_col)
       and not exists (select 1 from jsonb_array_elements(v_aggregates) a where a->>'alias'=v_order_col) then
      return jsonb_build_object('ok', false, 'error', 'order_column_not_allowed');
    end if;
    v_order := format(' order by %I %s', v_order_col, v_order_dir);
  end if;

  v_sql := format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (select %s from public.%I where %s%s%s limit %s) q',
    v_select, v_table, v_where, v_group, v_order, v_limit);
  execute v_sql into v_result;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'table', v_table, 'rows', v_result);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  when query_canceled then
    return jsonb_build_object('ok', false, 'error', 'query_timeout');
end;
$$;

revoke all on function public.mdr_rel_admin_ai_query(uuid, text, jsonb) from public, authenticated;
grant execute on function public.mdr_rel_admin_ai_query(uuid, text, jsonb) to anon;
