-- Canonical student totals by the status used throughout the admin dashboard.

create or replace view public.mdr_ai_student_status_summary
with (security_invoker = true)
as
select status, count(*)::bigint as student_count
from public.mdr_students
group by status;

revoke all on public.mdr_ai_student_status_summary from public, anon, authenticated;
