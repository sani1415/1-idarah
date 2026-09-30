-- ২০২৬-০৬-২৯ তারিখের ডুপ্লিকেট-পরিষ্কারের সময় রাখা এককালীন ব্যাকআপ table।
-- এতে RLS বন্ধ ছিল, তাই anon key দিয়ে পড়া/লেখা/মুছা যেত (Supabase advisor: ERROR)।
-- কোনো function/view এটা ব্যবহার করে না (শুধু backup/AI function-এ exclude pattern আছে)।
-- মূল ডাটা public.mdr_account_expenses-এ অক্ষত আছে। ব্যবহারকারীর অনুমোদনে মুছে ফেলা হলো।
drop table if exists public.mdr_account_expenses_dup_bak_20260629;
