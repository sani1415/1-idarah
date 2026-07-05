-- Seed/update দ্বিতীয় বর্ষের কিতাব তালিকা.
-- Safe, targeted upsert by (class_code, name). No destructive changes.

DO $$
DECLARE
  v_class_code text := 'kitab_y2';
BEGIN
  -- ১. الطريق إلى الفقه — 184
  UPDATE public.mdr_books
     SET total_pages = 184,
         sort_order = 10
   WHERE class_code = v_class_code
     AND name = 'الطريق إلى الفقه';

  IF NOT FOUND THEN
    INSERT INTO public.mdr_books (class_code, name, total_pages, sort_order)
    VALUES (v_class_code, 'الطريق إلى الفقه', 184, 10);
  END IF;

  -- ২. الطريق إلى القرآن جـ1 — 361
  UPDATE public.mdr_books
     SET total_pages = 361,
         sort_order = 20
   WHERE class_code = v_class_code
     AND name = 'الطريق إلى القرآن جـ1';

  IF NOT FOUND THEN
    INSERT INTO public.mdr_books (class_code, name, total_pages, sort_order)
    VALUES (v_class_code, 'الطريق إلى القرآن جـ1', 361, 20);
  END IF;

  -- ۳. الطريق إلى النحو — 191
  UPDATE public.mdr_books
     SET total_pages = 191,
         sort_order = 30
   WHERE class_code = v_class_code
     AND name = 'الطريق إلى النحو';

  IF NOT FOUND THEN
    INSERT INTO public.mdr_books (class_code, name, total_pages, sort_order)
    VALUES (v_class_code, 'الطريق إلى النحو', 191, 30);
  END IF;

  -- ۴. القراءة الراشدة جـ1 — 89
  UPDATE public.mdr_books
     SET total_pages = 89,
         sort_order = 40
   WHERE class_code = v_class_code
     AND name = 'القراءة الراشدة جـ1';

  IF NOT FOUND THEN
    INSERT INTO public.mdr_books (class_code, name, total_pages, sort_order)
    VALUES (v_class_code, 'القراءة الراشدة جـ1', 89, 40);
  END IF;

  -- ۵. قصص النبيين للأطفال جـ2 — 221
  UPDATE public.mdr_books
     SET total_pages = 221,
         sort_order = 50
   WHERE class_code = v_class_code
     AND name = 'قصص النبيين للأطفال جـ2';

  IF NOT FOUND THEN
    INSERT INTO public.mdr_books (class_code, name, total_pages, sort_order)
    VALUES (v_class_code, 'قصص النبيين للأطفال جـ2', 221, 50);
  END IF;
END $$;
