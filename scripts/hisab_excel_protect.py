"""দফতরের হিসাব Excel-এ শীট-সুরক্ষা — ডাটা, ফরম্যাট, ড্রপডাউন ও ফাইল-পরিচয় (নির্দেশনা!Z1) অক্ষত রেখে XML-এ সরাসরি।

    python scripts/hisab_excel_protect.py in.xlsx [out.xlsx]     (out না দিলে একই ফাইলে)

make-hisab-excel-template.py টেমপ্লেট বানানোর পর নিজে এটা চালায়; দফতরের চলতি ফাইলেও চালানো যায়।
অ্যাপ প্রতিটি এন্ট্রি চেনে «শীট + সারি নম্বর» দিয়ে (madrasa-daftar-accounts.js → impSourceId), তাই
সারি ঢোকানো/মোছা/sort আর শীটের নাম বদল বন্ধ রাখাই এর উদ্দেশ্য। পাসওয়ার্ড নেই (Review → Unprotect
দিয়ে খোলা যায়) — ভুল ঠেকাতে, নিরাপত্তার জন্য নয়।

- লেখার ঘর খোলা: ব্যয় A–F,H–K; আয় A–C; করজ A–E; পরিশোধ A–F (২–২০০০০ সারি), বকেয়া A10:A109
  (সরবরাহকারীর তালিকা), ড্যাশবোর্ড B21, D21 (বছর/মাস) ও A25:A39 (খাতের নাম)।
- বাকি সব তালাবদ্ধ: হেডার, সূত্রের কলাম, নির্দেশনা শীট।
- শীট: সারি/কলাম ঢোকানো-মোছা, sort ও ফিল্টার বন্ধ (ফিল্টারের ড্রপডাউন দিয়ে sort হয়ে যায়);
  কলাম/সারির মাপ বদলানো চালু। খুঁজতে Ctrl+F।
- বই: শীটের নাম বদল/মোছা/সরানো বন্ধ।
- ব্যয়ের সূত্র-কলাম (G একক মূল্য, L/M হিজরী বছর/মাস), ড্রপডাউন এবং বকেয়া/ড্যাশবোর্ডের
  সূত্রের সারি-সীমা ২০০০০ পর্যন্ত — তালা দেওয়ার পর দফতর নিজে এগুলো নিচে টানতে পারে না।
"""
import os
import re
import sys
import tempfile
import zipfile
from html import unescape

LAST = 20000
# ফিল্টারও বন্ধ: ফিল্টার চালু রাখলে Excel তার ড্রপডাউন থেকে sort করতে দেয় (পরীক্ষায় দেখা গেছে)
PROTECT = ('<sheetProtection sheet="1" objects="1" scenarios="1" '
           'formatColumns="0" formatRows="0"/>')
FORMULAS = {
    'G': 'IF(AND(E{0}&lt;&gt;"",E{0}&lt;&gt;0,H{0}&lt;&gt;""),H{0}/E{0},"")',
    'L': 'IF(B{0}="","",IFERROR(VALUE(TEXT(B{0},"[$-1170401]yyyy")),""))',
    'M': 'IF(B{0}="","",IFERROR(VALUE(TEXT(B{0},"[$-1170401]mm")),""))',
}


def col_num(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def rng(a, b):
    return set(range(col_num(a), col_num(b) + 1))


EDIT_SHEETS = {
    'ব্যয়': rng('A', 'F') | rng('H', 'K'),
    'আয়': rng('A', 'C'),
    'করজ': rng('A', 'E'),
    'পরিশোধ': rng('A', 'F'),
}


def attr(tag, name):
    m = re.search(r'\s%s="([^"]*)"' % re.escape(name), tag)
    return m.group(1) if m else None


class Styles:
    def __init__(self, xml):
        self.xml = xml
        self.m = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', xml, re.S)
        self.xfs = re.findall(r'<xf\b[^>]*/>|<xf\b[^>]*>.*?</xf>', self.m.group(2), re.S)
        assert len(self.xfs) == int(self.m.group(1)), 'cellXfs count mismatch'
        self.new = list(self.xfs)
        self.cache = {}

    def unlocked(self, idx):
        idx = int(idx or 0)
        if idx in self.cache:
            return self.cache[idx]
        x = self.xfs[idx]
        if x.endswith('/>'):
            open_tag, inner = x[:-2], ''
        else:
            open_tag, inner = x[:x.index('>')], x[x.index('>') + 1:x.rindex('</xf>')]
        open_tag = re.sub(r'\s+applyProtection="[^"]*"', '', open_tag) + ' applyProtection="1"'
        inner = re.sub(r'<protection\b[^>]*/>', '', inner)
        if '<extLst' in inner:
            inner = inner.replace('<extLst', '<protection locked="0"/><extLst', 1)
        else:
            inner += '<protection locked="0"/>'
        self.new.append(open_tag + '>' + inner + '</xf>')
        self.cache[idx] = len(self.new) - 1
        return self.cache[idx]

    def dump(self):
        return self.xml.replace(self.m.group(0), '<cellXfs count="%d">%s</cellXfs>' % (len(self.new), ''.join(self.new)))


def add_protection(x):
    if '<sheetProtection' in x:
        x = re.sub(r'<sheetProtection\b[^>]*/>', '', x)
    if '<sheetCalcPr' in x:
        i = x.index('/>', x.index('<sheetCalcPr')) + 2
    elif '</sheetData>' in x:
        i = x.index('</sheetData>') + len('</sheetData>')
    else:
        i = x.index('<sheetData/>') + len('<sheetData/>')
    return x[:i] + PROTECT + x[i:]


def unlock_cells(x, st, cols, r1, r2):
    def rep(mm):
        col, row, rest = mm.group(1), int(mm.group(2)), mm.group(3)
        if col_num(col) not in cols or row < r1 or row > r2:
            return mm.group(0)
        sm = re.search(r'\ss="(\d+)"', rest)
        if sm:
            rest = rest.replace(sm.group(0), ' s="%d"' % st.unlocked(sm.group(1)), 1)
        else:
            rest = ' s="%d"' % st.unlocked(0) + rest
        return '<c r="%s%d"%s' % (col, row, rest)
    return re.sub(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?=/?>)', rep, x)


def ensure_cells(x, st, refs):
    """XML-এ না থাকা ফাঁকা ঘর unlocked style সহ যোগ (column style নেই এমন জায়গায়)"""
    for ref in refs:
        col, row = re.match(r'([A-Z]+)(\d+)', ref).groups()
        row = int(row)
        if re.search(r'<c r="%s%d"[ >/]' % (col, row), x):
            continue
        cell = '<c r="%s%d" s="%d"/>' % (col, row, st.unlocked(0))
        rm = re.search(r'<row r="%d"[^>]*?(/>|>)' % row, x)
        if not rm:
            pos = x.index('</sheetData>')
            for mm in re.finditer(r'<row r="(\d+)"', x):
                if int(mm.group(1)) > row:
                    pos = mm.start()
                    break
            x = x[:pos] + '<row r="%d">%s</row>' % (row, cell) + x[pos:]
            continue
        if rm.group(1) == '/>':
            x = x[:rm.start()] + rm.group(0)[:-2] + '>' + cell + '</row>' + x[rm.end():]
            continue
        end = x.index('</row>', rm.end())
        pos = end
        for cm in re.finditer(r'<c r="([A-Z]+)\d+"', x[rm.end():end]):
            if col_num(cm.group(1)) > col_num(col):
                pos = rm.end() + cm.start()
                break
        x = x[:pos] + cell + x[pos:]
    return x


def col_styles(x, st, cols):
    """খালি সারির জন্য কলামের default style — unlocked"""
    def rep(mm):
        tag = mm.group(0)
        span = set(range(int(attr(tag, 'min')), int(attr(tag, 'max')) + 1))
        if not span & cols:
            return tag
        assert span <= cols, ('partial col range', tag)
        sv = attr(tag, 'style')
        if sv is not None:
            return re.sub(r'\sstyle="\d+"', ' style="%d"' % st.unlocked(sv), tag)
        return tag.replace('<col ', '<col style="%d" ' % st.unlocked(0), 1)
    if '<cols>' not in x:
        x = x.replace('<sheetData', '<cols></cols><sheetData', 1)
    x = re.sub(r'<col\b[^>]*/>', rep, x)
    have = set()
    for tag in re.findall(r'<col\b[^>]*/>', x):
        have |= set(range(int(attr(tag, 'min')), int(attr(tag, 'max')) + 1))
    for c in sorted(cols - have):
        new = '<col min="%d" max="%d" width="12" style="%d" customWidth="1"/>' % (c, c, st.unlocked(0))
        pos = x.index('</cols>')
        for t in re.finditer(r'<col\b[^>]*/>', x):
            if int(attr(t.group(0), 'min')) > c:
                pos = t.start()
                break
        x = x[:pos] + new + x[pos:]
    return x


def extend_sqref(x):
    """ড্রপডাউনের সারি-সীমা 20000 (শুরু থেকে নয়, শেষ সীমা ≥100 হলে)"""
    def fix(sq):
        ends = [int(e) for e in re.findall(r'[A-Z]+\d+:[A-Z]+(\d+)', sq)]
        top = max(ends) if ends else 0
        if top < 100:
            return sq
        # শুধু সবচেয়ে নিচের অংশটা বাড়ে — মাঝের ইচ্ছাকৃত ফাঁক থাকে
        return re.sub(r'([A-Z]+\d+:[A-Z]+)(\d+)', lambda m: m.group(1) + (str(LAST) if int(m.group(2)) == top else m.group(2)), sq)
    if '<dataValidations' not in x:
        return x
    a = x.index('<dataValidations')
    b = x.index('</dataValidations>', a)
    seg = re.sub(r'sqref="([^"]*)"', lambda m: 'sqref="%s"' % fix(m.group(1)), x[a:b])
    return x[:a] + seg + x[b:]


def set_autofilter(x):
    return re.sub(r'<autoFilter ref="A1:([A-Z]+)\d+"', lambda m: '<autoFilter ref="A1:%s%d"' % (m.group(1), LAST), x)


def fix_ranges(x):
    """সূত্রে অন্য শীটের $X$2:$X$N (N ≥ 100) → 20000"""
    return re.sub(r'(!\$[A-Z]+\$2:\$[A-Z]+\$)(\d+)', lambda m: m.group(1) + (str(LAST) if int(m.group(2)) >= 100 else m.group(2)), x)


def fill_expense_formulas(x):
    rows = [int(r) for r in re.findall(r'<row r="(\d+)"', x)]
    last_row = max(rows)
    if last_row >= LAST:
        return x
    si = max([int(s) for s in re.findall(r'\ssi="(\d+)"', x)] or [-1]) + 1
    styles = {}
    for col in FORMULAS:
        mm = re.search(r'<c r="%s%d"(?:[^>]*?\ss="(\d+)")?' % (col, last_row), x) or re.search(r'<c r="%s2"(?:[^>]*?\ss="(\d+)")?' % col, x)
        styles[col] = mm.group(1) if mm and mm.group(1) else None
    start = last_row + 1
    out = []
    for r in range(start, LAST + 1):
        cells = []
        for k, col in enumerate(('G', 'L', 'M')):
            s_attr = ' s="%s"' % styles[col] if styles[col] else ''
            if r == start:
                f = '<f t="shared" ref="{0}{1}:{0}{2}" si="{3}">{4}</f>'.format(col, start, LAST, si + k, FORMULAS[col].format(start))
            else:
                f = '<f t="shared" si="%d"/>' % (si + k)
            cells.append('<c r="%s%d"%s>%s</c>' % (col, r, s_attr, f))
        out.append('<row r="%d">%s</row>' % (r, ''.join(cells)))
    i = x.index('</sheetData>')
    x = x[:i] + ''.join(out) + x[i:]
    return re.sub(r'<dimension ref="A1:([A-Z]+)\d+"/>', lambda m: '<dimension ref="A1:%s%d"/>' % (m.group(1), LAST), x)


def protect_file(src, dst=None):
    dst = dst or src
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        infos = {i.filename: i for i in zin.infolist()}
        parts = {n: zin.read(n) for n in names}

    wb = parts['xl/workbook.xml'].decode('utf-8')
    rels = parts['xl/_rels/workbook.xml.rels'].decode('utf-8')
    targets = {}
    for tag in re.findall(r'<Relationship\b[^>]*/>', rels):
        t = attr(tag, 'Target')
        targets[attr(tag, 'Id')] = t.lstrip('/') if t.startswith('/') else 'xl/' + t
    sheets = {}
    for tag in re.findall(r'<sheet\b[^>]*/>', wb):
        sheets[unescape(attr(tag, 'name'))] = targets[attr(tag, 'r:id')]
    for n in list(EDIT_SHEETS) + ['নির্দেশনা', 'বকেয়া', 'ড্যাশবোর্ড']:
        assert n in sheets, ('sheet missing', n)

    st = Styles(parts['xl/styles.xml'].decode('utf-8'))

    for name, cols in EDIT_SHEETS.items():
        x = parts[sheets[name]].decode('utf-8')
        if name == 'ব্যয়':
            x = fill_expense_formulas(x)
        x = unlock_cells(x, st, cols, 2, LAST)
        x = col_styles(x, st, cols)
        x = set_autofilter(x)
        x = extend_sqref(x)
        parts[sheets[name]] = add_protection(x).encode('utf-8')

    x = parts[sheets['বকেয়া']].decode('utf-8')
    x = fix_ranges(x)
    x = unlock_cells(x, st, {1}, 10, 109)
    x = ensure_cells(x, st, ['A%d' % r for r in range(10, 110)])
    parts[sheets['বকেয়া']] = add_protection(x).encode('utf-8')

    x = parts[sheets['ড্যাশবোর্ড']].decode('utf-8')
    x = fix_ranges(x)
    dash = ['B21', 'D21'] + ['A%d' % r for r in range(25, 40)]
    for ref in dash:
        col, row = re.match(r'([A-Z]+)(\d+)', ref).groups()
        x = unlock_cells(x, st, {col_num(col)}, int(row), int(row))
    x = ensure_cells(x, st, dash)
    parts[sheets['ড্যাশবোর্ড']] = add_protection(x).encode('utf-8')

    x = parts[sheets['নির্দেশনা']].decode('utf-8')
    parts[sheets['নির্দেশনা']] = add_protection(x).encode('utf-8')

    parts['xl/styles.xml'] = st.dump().encode('utf-8')

    wb = re.sub(r'<workbookProtection\b[^>]*/>', '', wb)
    wb = wb.replace('<bookViews>', '<workbookProtection lockStructure="1"/><bookViews>', 1)
    wb = re.sub(r'(<definedName name="_xlnm\._FilterDatabase"[^>]*>[^<]*!\$A\$1:\$)([A-Z]+)\$\d+',
                lambda m: m.group(1) + m.group(2) + '$' + str(LAST), wb)
    parts['xl/workbook.xml'] = wb.encode('utf-8')

    # নতুন সূত্রের জন্য calcChain Excel নিজে বানায়
    if 'xl/calcChain.xml' in parts:
        del parts['xl/calcChain.xml']
        names = [n for n in names if n != 'xl/calcChain.xml']
        r = parts['xl/_rels/workbook.xml.rels'].decode('utf-8')
        parts['xl/_rels/workbook.xml.rels'] = re.sub(r'<Relationship\b[^>]*calcChain\.xml[^>]*/>', '', r).encode('utf-8')
        ct = parts['[Content_Types].xml'].decode('utf-8')
        parts['[Content_Types].xml'] = re.sub(r'<Override\b[^>]*/xl/calcChain\.xml[^>]*/>', '', ct).encode('utf-8')

    fd, tmp = tempfile.mkstemp(suffix='.xlsx', dir=os.path.dirname(os.path.abspath(dst)))
    os.close(fd)
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zi = zipfile.ZipInfo(n, date_time=infos[n].date_time)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, parts[n])
    os.replace(tmp, dst)
    return len(st.new) - len(st.xfs)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    added = protect_file(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print('protected:', sys.argv[-1], '(unlocked styles added: %d)' % added)
