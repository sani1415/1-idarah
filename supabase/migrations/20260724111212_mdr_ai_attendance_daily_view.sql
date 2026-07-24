-- Deterministic semantic source for date-level attendance questions.
-- It remains inaccessible through PostgREST; only the authenticated AI gateway
-- (SECURITY DEFINER) reads it after validating the super-admin PIN.

create or replace view public.mdr_ai_attendance_daily
with (security_invoker = true)
as
select
  a.date,
  count(*) filter (where d.status = 'present')::bigint as present_count,
  count(*) filter (where d.status = 'absent')::bigint as absent_count,
  count(*)::bigint as recorded_count,
  count(distinct a.class_id)::bigint as classes_recorded,
  max(a.created_at) as last_recorded_at
from public.mdr_attendance a
join public.mdr_attendance_details d on d.attendance_id = a.id
group by a.date;

revoke all on public.mdr_ai_attendance_daily from public, anon, authenticated;
