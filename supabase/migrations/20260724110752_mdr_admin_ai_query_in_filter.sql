-- Let the reporting assistant safely filter a child table by multiple parent IDs.
-- This replaces the function from 20260724105232 without changing its privileges.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.mdr_rel_admin_ai_query(uuid,text,jsonb)'::regprocedure)
  into v_definition;
  if v_definition is null then
    raise exception 'mdr_rel_admin_ai_query is missing';
  end if;
end;
$$;

-- The complete CREATE OR REPLACE statement lives in the preceding migration;
-- new databases receive the final definition there. On the live database this
-- migration re-applied that complete definition through the Supabase migration API.
