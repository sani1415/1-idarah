-- One-time data fix (approved by the user, 2026-10-14).
-- The June 1447-48 import kept matbakh + madrasa supplier dues together under
-- account 'general' (metadata.combinedAccounts). The daftar Excel template keeps them
-- per account, so payments from that file could not find their dues and June
-- payments were not recognised as already present. Move each combined due (and its
-- payments) to the account the template uses. No rows are deleted; every changed row
-- keeps its previous values in metadata so this can be reversed.

-- সাগর → matbakh (merge into the existing empty matbakh row)
update public.mdr_account_dues t
   set total = t.total + g.total, paid = t.paid + g.paid, due = t.due + g.due,
       source_file = coalesce(t.source_file, g.source_file),
       metadata = t.metadata || jsonb_build_object('mergedFrom', jsonb_build_object('id', g.id, 'account', g.account, 'total', g.total, 'paid', g.paid, 'due', g.due, 'at', '2026-10-14')),
       updated_at = now()
  from public.mdr_account_dues g
 where t.id = 'due-a967a0c058640a28613a' and g.id = 'xlsx-4748-due-general-002' and g.account = 'general' and g.total > 0;
update public.mdr_account_due_payments
   set due_id = 'due-a967a0c058640a28613a', account = 'matbakh',
       metadata = metadata || '{"movedFromDue":"xlsx-4748-due-general-002","movedFromAccount":"general"}'::jsonb
 where due_id = 'xlsx-4748-due-general-002';
update public.mdr_account_dues
   set metadata = metadata || jsonb_build_object('mergedInto', 'due-a967a0c058640a28613a', 'before', jsonb_build_object('total', total, 'paid', paid, 'due', due)),
       total = 0, paid = 0, due = 0, updated_at = now()
 where id = 'xlsx-4748-due-general-002' and account = 'general' and total > 0;

-- আল মদিনা → madrasa (merge into the existing empty madrasa row)
update public.mdr_account_dues t
   set total = t.total + g.total, paid = t.paid + g.paid, due = t.due + g.due,
       source_file = coalesce(t.source_file, g.source_file),
       metadata = t.metadata || jsonb_build_object('mergedFrom', jsonb_build_object('id', g.id, 'account', g.account, 'total', g.total, 'paid', g.paid, 'due', g.due, 'at', '2026-10-14')),
       updated_at = now()
  from public.mdr_account_dues g
 where t.id = 'due-919cb7f8af3432eeaac2' and g.id = 'xlsx-4748-due-general-003' and g.account = 'general' and g.total > 0;
update public.mdr_account_due_payments
   set due_id = 'due-919cb7f8af3432eeaac2', account = 'madrasa',
       metadata = metadata || '{"movedFromDue":"xlsx-4748-due-general-003","movedFromAccount":"general"}'::jsonb
 where due_id = 'xlsx-4748-due-general-003';
update public.mdr_account_dues
   set metadata = metadata || jsonb_build_object('mergedInto', 'due-919cb7f8af3432eeaac2', 'before', jsonb_build_object('total', total, 'paid', paid, 'due', due)),
       total = 0, paid = 0, due = 0, updated_at = now()
 where id = 'xlsx-4748-due-general-003' and account = 'general' and total > 0;

-- গ্যাস, ডিম, লাকড়ি, জমিনের সবজী → matbakh; বেলাল → madrasa (in place)
update public.mdr_account_dues
   set metadata = metadata || jsonb_build_object('movedFromAccount', 'general', 'supplierBefore', supplier),
       account = case when id = 'xlsx-4748-due-general-006' then 'madrasa' else 'matbakh' end,
       supplier = case when id = 'xlsx-4748-due-general-008' then 'জমিনের সবজি' else supplier end,
       updated_at = now()
 where id in ('xlsx-4748-due-general-004','xlsx-4748-due-general-005','xlsx-4748-due-general-006','xlsx-4748-due-general-007','xlsx-4748-due-general-008')
   and account = 'general';
update public.mdr_account_due_payments p
   set account = d.account, supplier = d.supplier,
       metadata = p.metadata || jsonb_build_object('movedFromAccount', 'general', 'supplierBefore', p.supplier)
  from public.mdr_account_dues d
 where p.due_id = d.id
   and d.id in ('xlsx-4748-due-general-004','xlsx-4748-due-general-005','xlsx-4748-due-general-006','xlsx-4748-due-general-007','xlsx-4748-due-general-008')
   and p.account = 'general';
