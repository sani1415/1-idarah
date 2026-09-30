-- List inventory movement history for a department (stock in/out log).

create or replace function public.mdr_dept_rel_list_inventory_movements(
  p_actor_id uuid,
  p_pin text,
  p_dept_code text,
  p_product_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor public.mdr_shared_users%rowtype;
  v_dept_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows jsonb := '[]'::jsonb;
begin
  v_actor := private.dept_authorized_actor(p_actor_id, p_pin, p_dept_code);
  if v_actor.id is null and not private.verify_admin_pin(p_pin) then
    return jsonb_build_object('ok', false, 'error', 'invalid_login');
  end if;

  select id into v_dept_id
  from public.mdr_dept_departments
  where code = p_dept_code and is_active = true;
  if v_dept_id is null then
    return jsonb_build_object('ok', false, 'error', 'dept_not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      m.id,
      m.product_id,
      m.item_name,
      m.unit,
      m.quantity_delta,
      m.reason,
      m.notes,
      m.created_at,
      m.transaction_id
    from public.mdr_dept_inventory_movements m
    where m.dept_id = v_dept_id
      and (p_product_id is null or m.product_id = p_product_id)
    order by m.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'movements', v_rows);
end;
$$;

revoke execute on function public.mdr_dept_rel_list_inventory_movements(uuid, text, text, uuid, integer) from public, authenticated;
grant execute on function public.mdr_dept_rel_list_inventory_movements(uuid, text, text, uuid, integer) to anon;
