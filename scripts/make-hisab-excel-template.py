# -*- coding: utf-8 -*-
"""দপ্তর হিসাব — স্ট্যান্ডার্ড .xlsx টেমপ্লেট (অ্যাপ ফাইল-আপলোড ইমপোর্ট)।"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTS = [
    ROOT / "app" / "madrasa" / "templates" / "daftar-hisab-template.xlsx",
    ROOT / "output" / "daftar-hisab-template.xlsx",
]

header_fill = PatternFill("solid", fgColor="1A1208")
header_font = Font(name="Calibri", bold=True, color="F5E6C8", size=11)
title_font = Font(name="Calibri", bold=True, size=14, color="1A1208")
note_font = Font(name="Calibri", size=10, color="5C5346")
sample_fill = PatternFill("solid", fgColor="FFFBF2")
dash_fill = PatternFill("solid", fgColor="F7F1E6")
auto_fill = PatternFill("solid", fgColor="F0F7F4")
thin = Border(
    left=Side(style="thin", color="D9D0C3"),
    right=Side(style="thin", color="D9D0C3"),
    top=Side(style="thin", color="D9D0C3"),
    bottom=Side(style="thin", color="D9D0C3"),
)
wrap = Alignment(wrap_text=True, vertical="top")

# ব্যয়: E=পরিমাণ, G=একক মূল্য, H=মোট
TOTAL_FORMULA = '=IF(AND(E{r}<>"",G{r}<>""),E{r}*G{r},"")'
FORMULA_ROWS = 500


def style_header(ws, cols, widths):
    for i, (name, w) in enumerate(zip(cols, widths), 1):
        cell = ws.cell(1, i, name)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}1"


def style_data_row(ws, row_idx, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row_idx, c)
        cell.border = thin
        cell.fill = sample_fill
        cell.alignment = Alignment(vertical="center")


def set_total_auto(ws, row_idx):
    cell = ws.cell(row_idx, 8)
    cell.value = TOTAL_FORMULA.format(r=row_idx)
    cell.number_format = '#,##0.##'
    cell.fill = auto_fill
    cell.border = thin
    cell.alignment = Alignment(vertical="center")


def set_total_manual(ws, row_idx, amount):
    cell = ws.cell(row_idx, 8, amount)
    cell.number_format = '#,##0.##'
    cell.fill = sample_fill
    cell.border = thin
    cell.alignment = Alignment(vertical="center")


def main():
    wb = Workbook()

    # ── নির্দেশনা ──
    ws = wb.active
    ws.title = "নির্দেশনা"
    ws["A1"] = "দপ্তর হিসাব — স্ট্যান্ডার্ড Excel টেমপ্লেট"
    ws["A1"].font = title_font
    ws.merge_cells("A1:B1")
    lines = [
        ("এই ফাইল কী", "একটি .xlsx ফাইলে সব হিসাব রাখুন। অ্যাপে «এক্সেল ↧» → ফাইল আপলোড করলে ব্যয়/আয়/করজ শীট থেকে ডেটা নেবে।"),
        ("শীট", "ব্যয় · আয় · করজ · ড্যাশবোর্ড (ড্যাশবোর্ড শুধু দেখার জন্য — অ্যাপ আপলোড করে না)।"),
        ("ব্যয়", "মাতবাখ/মাদরাসা/তামিরাত/সাধারণ — «হিসাব বই» কলামে লিখুন। করজ এখানে নয়।"),
        ("মোট টাকা", "অ্যাপের মতো অটো: পরিমাণ × একক মূল্য দিলে মোট নিজে হিসাব হয় (সবুজ ঘর)। বিল টাইপ হলে পরিমাণ/দর খালি রেখে শুধু মোট লিখুন।"),
        ("আয়", "নিয়মিত আয় (অনুদান, ওয়াযিফা ইত্যাদি)। করজ আদায় «করজ» শীটে।"),
        ("করজ", "ধরন = দেওয়া বা আদায়। খাত নাম দেওয়া ও আদায়ে একই রাখুন।"),
        ("তারিখ", "হিজরী: ১৪৪৭-১০-০৯ · ইংরেজি: ২০২৬-০৭-১৪ বা ১৪-০৭-২০২৬ · Excel তারিখ ঘরও চলবে।"),
        ("পরিশোধ", "নগদ বা বাকি। বাকি হলে সরবরাহকারী আবশ্যক।"),
        ("নিয়ম", "কলামের শিরোনাম মুছবেন/সরাবেন না। নমুনা সারি মুছে আসল ডেটা বসান। শুধু সংখ্যা লিখুন (৳/কমা ছাড়া)।"),
        ("অ্যাপে", "হিসাব → এক্সেল ↧ → টেমপ্লেট ডাউনলোড (প্রয়োজনে) → ভরা ফাইল বেছে নিন → প্রিভিউ → সংরক্ষণ।"),
    ]
    r = 3
    for a, b in lines:
        ws.cell(r, 1, a).font = Font(bold=True, size=11)
        ws.cell(r, 2, b).alignment = wrap
        ws.row_dimensions[r].height = 40
        r += 1
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 92

    # ── ব্যয় ──
    ws = wb.create_sheet("ব্যয়")
    exp_cols = [
        "হিসাব বই *", "তারিখ *", "খাত", "বিবরণ", "পরিমাণ", "মাপ",
        "একক মূল্য", "মোট টাকা (অটো)", "সরবরাহকারী", "রশিদ নং", "পরিশোধ",
    ]
    style_header(ws, exp_cols, [14, 14, 14, 26, 10, 10, 12, 16, 18, 12, 10])

    # qty×price rows → formula; bill-only → manual total
    qty_rows = [
        (2, ["মাতবাখ", "1447-10-02", "কাঁচামাল", "চাল", 50, "কেজি", 70], "রহিম স্টোর", "১০১", "নগদ"),
        (3, ["মাতবাখ", "1447-10-03", "কাঁচামাল", "ডাল", 20, "কেজি", 120], "রহিম স্টোর", "", "নগদ"),
        (4, ["মাদরাসা", "1447-10-04", "স্টেশনারি", "খাতা ও কলম", 10, "প্যাকেট", 80], "বইঘর", "", "নগদ"),
        (5, ["তামিরাত", "1447-09-20", "মেরামত", "ছাদের প্লাস্টার", 1, "পিস", 15000], "রাজমিস্ত্রি করিম", "", "বাকি"),
    ]
    for row_idx, left, supplier, receipt, pay in qty_rows:
        for c, val in enumerate(left, 1):
            ws.cell(row_idx, c, val)
        ws.cell(row_idx, 9, supplier)
        ws.cell(row_idx, 10, receipt)
        ws.cell(row_idx, 11, pay)
        style_data_row(ws, row_idx, 11)
        set_total_auto(ws, row_idx)

    bill_rows = [
        (6, ["সাধারণ", "1447-10-06", "পরিবহন", "বাজার আনা-নেওয়া", "", "", ""], 500, "", "", "নগদ"),
        (7, ["মাদরাসা", "2026-07-10", "বিদ্যুৎ", "বিদ্যুৎ বিল", "", "", ""], 4500, "পল্লী বিদ্যুৎ", "বিল-৮৮", "নগদ"),
    ]
    for row_idx, left, amount, supplier, receipt, pay in bill_rows:
        for c, val in enumerate(left, 1):
            ws.cell(row_idx, c, val)
        ws.cell(row_idx, 9, supplier)
        ws.cell(row_idx, 10, receipt)
        ws.cell(row_idx, 11, pay)
        style_data_row(ws, row_idx, 11)
        set_total_manual(ws, row_idx, amount)

    # খালি সারিতেও অটো ফর্মুলা — নতুন এন্ট্রিতে মোট নিজে আসবে
    for row_idx in range(8, FORMULA_ROWS + 1):
        set_total_auto(ws, row_idx)

    ws["M1"] = (
        "মোট টাকা = পরিমাণ × একক মূল্য (অটো)। "
        "বিল হলে পরিমাণ/মূল্য খালি রেখে মোট ঘরে সরাসরি টাকা লিখুন।"
    )
    ws["M1"].font = note_font
    ws.column_dimensions["M"].width = 55

    dv_book = DataValidation(type="list", formula1='"মাতবাখ,মাদরাসা,তামিরাত,সাধারণ"', allow_blank=False)
    ws.add_data_validation(dv_book)
    dv_book.add("A2:A5000")
    dv_unit = DataValidation(
        type="list",
        formula1='"কেজি,গ্রাম,লিটার,মিলি,পিস,প্যাকেট,বস্তা,ডজন,ফুট,মিটার"',
        allow_blank=True,
    )
    ws.add_data_validation(dv_unit)
    dv_unit.add("F2:F5000")
    dv_pay = DataValidation(type="list", formula1='"নগদ,বাকি"', allow_blank=True)
    ws.add_data_validation(dv_pay)
    dv_pay.add("K2:K5000")

    # ── আয় ──
    ws = wb.create_sheet("আয়")
    style_header(ws, ["তারিখ *", "টাকা *", "উৎস / বিবরণ"], [16, 14, 40])
    for i, row in enumerate([
        ["1447-10-01", 50000, "বিকাশ অনুদান"],
        ["1447-10-05", 12000, "ওয়াযিফা আদায় — শাওয়াল"],
        ["2026-07-10", 3000, "নগদ দান"],
    ], start=2):
        for c, val in enumerate(row, 1):
            cell = ws.cell(i, c, val)
            cell.border = thin
            cell.fill = sample_fill

    # ── করজ ──
    ws = wb.create_sheet("করজ")
    style_header(ws, ["ধরন *", "তারিখ *", "টাকা *", "খাত *", "বিবরণ"], [12, 14, 12, 22, 28])
    for i, row in enumerate([
        ["দেওয়া", "1447-08-15", 20000, "করিম ভাই", "করজে হাসানা"],
        ["দেওয়া", "1447-09-01", 10000, "মাদরাসা ফান্ড", "জরুরি করজ"],
        ["আদায়", "1447-10-07", 5000, "করিম ভাই", ""],
        ["আদায়", "1447-10-11", 2000, "মাদরাসা ফান্ড", ""],
    ], start=2):
        for c, val in enumerate(row, 1):
            cell = ws.cell(i, c, val)
            cell.border = thin
            cell.fill = sample_fill
    dv_kind = DataValidation(type="list", formula1='"দেওয়া,আদায়"', allow_blank=False)
    ws.add_data_validation(dv_kind)
    dv_kind.add("A2:A5000")

    # ── ড্যাশবোর্ড ──
    ws = wb.create_sheet("ড্যাশবোর্ড")
    ws["A1"] = "সামারি (অটো — অ্যাপে আপলোড হয় না)"
    ws["A1"].font = title_font
    ws.merge_cells("A1:C1")

    labels = [
        (3, "মোট ব্যয় (সব বই)", "=SUM(ব্যয়!H:H)"),
        (4, "মোট আয়", "=SUM(আয়!B:B)"),
        (5, "করজ দেওয়া", '=SUMIF(করজ!A:A,"দেওয়া",করজ!C:C)'),
        (6, "করজ আদায়", '=SUMIF(করজ!A:A,"আদায়",করজ!C:C)'),
        (7, "করজ বাকি", "=B5-B6"),
        (8, "নগদ (আনুমানিক)", "=B4-B3-B5+B6"),
    ]
    ws["A2"] = "বিবরণ"
    ws["B2"] = "টাকা"
    for c in (ws["A2"], ws["B2"]):
        c.fill = header_fill
        c.font = header_font
        c.border = thin
    for row, label, formula in labels:
        a = ws.cell(row, 1, label)
        b = ws.cell(row, 2, formula)
        a.border = thin
        b.border = thin
        a.fill = dash_fill
        b.number_format = '#,##0'
    ws["A10"] = "বই অনুযায়ী ব্যয়"
    ws["A10"].font = Font(bold=True, size=12)
    books = ["মাতবাখ", "মাদরাসা", "তামিরাত", "সাধারণ"]
    ws["A11"] = "হিসাব বই"
    ws["B11"] = "মোট"
    for c in (ws["A11"], ws["B11"]):
        c.fill = header_fill
        c.font = header_font
        c.border = thin
    for i, book in enumerate(books):
        rr = 12 + i
        ws.cell(rr, 1, book).border = thin
        cell = ws.cell(rr, 2, f"=SUMIF(ব্যয়!A:A,A{rr},ব্যয়!H:H)")
        cell.border = thin
        cell.number_format = "#,##0"
    ws["A17"] = (
        "নোট: ব্যয়ের মোট কলাম পরিমাণ×একক মূল্যে অটো। "
        "নমুনা মুছে আসল ডেটা বসালে ড্যাশবোর্ড আপডেট হবে।"
    )
    ws["A17"].font = note_font
    ws.merge_cells("A17:C18")
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 40

    for out in OUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            wb.save(out)
            print("saved:", out.as_posix())
        except PermissionError:
            alt = out.with_name(out.stem + "-latest.xlsx")
            wb.save(alt)
            print("locked, saved alt:", alt.as_posix())


if __name__ == "__main__":
    main()
