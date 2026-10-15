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
        x = self.new[idx]
        if re.search(r'<protection\b[^>]*locked="0"', x):  # আগে থেকেই খোলা — আবার চালালে নতুন style নয়
            self.cache[idx] = idx
            return idx
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

    def add_fill(self, rgb):
        m = re.search(r'<fills count="(\d+)">(.*?)</fills>', self.xml, re.S)
        n = int(m.group(1))
        fill = '<fill><patternFill patternType="solid"><fgColor rgb="%s"/><bgColor indexed="64"/></patternFill></fill>' % rgb
        self.xml = self.xml.replace(m.group(0), '<fills count="%d">%s%s</fills>' % (n + 1, m.group(2), fill))
        self.m = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', self.xml, re.S)
        return n

    def add_font(self, bold=False, size=11, rgb='FF1A1208'):
        m = re.search(r'<fonts count="(\d+)"([^>]*)>(.*?)</fonts>', self.xml, re.S)
        n = int(m.group(1))
        font = '<font>%s<sz val="%s"/><color rgb="%s"/><name val="Calibri"/><family val="2"/></font>' % ('<b/>' if bold else '', size, rgb)
        self.xml = self.xml.replace(m.group(0), '<fonts count="%d"%s>%s%s</fonts>' % (n + 1, m.group(2), m.group(3), font))
        self.m = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', self.xml, re.S)
        return n

    def add_xf(self, num_fmt=0, font=0, fill=0, border=0, unlocked=False, wrap=False, center=False):
        al = '<alignment vertical="center"%s%s/>' % (' horizontal="center"' if center else '', ' wrapText="1"' if wrap else '')
        pr = '<protection locked="0"/>' if unlocked else ''
        self.new.append('<xf numFmtId="%d" fontId="%d" fillId="%d" borderId="%d" xfId="0" applyNumberFormat="1" applyFont="1" '
                        'applyFill="1" applyBorder="1" applyAlignment="1"%s>%s%s</xf>'
                        % (num_fmt, font, fill, border, ' applyProtection="1"' if unlocked else '', al, pr))
        return len(self.new) - 1

    def num_fmt(self, code):
        if '<numFmts' not in self.xml:
            self.xml = self.xml.replace('<fonts', '<numFmts count="0"></numFmts><fonts', 1)
        m = re.search(r'<numFmts count="(\d+)">(.*?)</numFmts>', self.xml, re.S)
        for fid, fc in re.findall(r'<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/>', m.group(2)):
            if fc == code:
                return int(fid)
        ids = [int(i) for i in re.findall(r'numFmtId="(\d+)"', m.group(2))] + [163]
        fid = max(ids) + 1
        self.xml = self.xml.replace(m.group(0), '<numFmts count="%d">%s<numFmt numFmtId="%d" formatCode="%s"/></numFmts>'
                                    % (int(m.group(1)) + 1, m.group(2), fid, code))
        self.m = re.search(r'<cellXfs count="(\d+)">(.*?)</cellXfs>', self.xml, re.S)
        return fid

    def border_id(self):
        return 1 if int(re.search(r'<borders count="(\d+)"', self.xml).group(1)) > 1 else 0

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


SEARCH_SHEET = 'খোঁজ'
SEARCH_ROWS = 500
HIJRI_MONTHS = ['মুহাররম', 'সফর', 'রবিউল আউয়াল', 'রবিউস সানি', 'জুমাদাল উলা', 'জুমাদাল উখরা',
                'রজব', 'শাবান', 'রমজান', 'শাওয়াল', 'জিলকদ', 'জিলহজ']


def _x(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def _s(ref, text, style):
    return '<c r="%s" s="%d" t="inlineStr"><is><t>%s</t></is></c>' % (ref, style, _x(text))


def _f(ref, formula, style, shared=None):
    if shared and shared[0] == 'slave':
        return '<c r="%s" s="%d"><f t="shared" si="%d"/></c>' % (ref, style, shared[1])
    if shared:
        return '<c r="%s" s="%d"><f t="shared" ref="%s" si="%d">%s</f></c>' % (ref, style, shared[2], shared[1], _x(formula))
    return '<c r="%s" s="%d"><f>%s</f></c>' % (ref, style, _x(formula))


def build_search_sheet(st):
    """«খোঁজ» শীট: ব্যয় শীট থেকে শর্ত মিলিয়ে সারি দেখায় (সব Excel-এ চলে এমন INDEX/MATCH; মূল শীট ছোঁয় না)।
    লুকানো কলাম AA = ব্যয়ের প্রতিটি সারি পর্যন্ত মোট মিল (চলমান গণনা), AB = k-তম মিলের সারি নং,
    AC = মিলে যাওয়া সারির টাকা, AD5 = মাসের নম্বর।"""
    E = "'ব্যয়'!"
    bd = st.border_id()
    f_hdr = st.add_font(bold=True, rgb='FFF5E6C8')
    f_title = st.add_font(bold=True, size=14)
    f_bold = st.add_font(bold=True)
    fill_hdr = st.add_fill('FF1A1208')
    fill_in = st.add_fill('FFFFF2CC')
    fill_lab = st.add_fill('FFF7F1E6')
    S = {
        'title': st.add_xf(font=f_title),
        'note': st.add_xf(wrap=True),
        'label': st.add_xf(font=f_bold, fill=fill_lab, border=bd),
        'input': st.add_xf(fill=fill_in, border=bd, unlocked=True),
        'hdr': st.add_xf(font=f_hdr, fill=fill_hdr, border=bd, wrap=True, center=True),
        'cell': st.add_xf(border=bd),
        'date': st.add_xf(num_fmt=st.num_fmt('[$-1170401]yyyy\\-mm\\-dd'), border=bd),
        'money': st.add_xf(num_fmt=st.num_fmt('#,##0'), border=bd),
        'moneyb': st.add_xf(num_fmt=st.num_fmt('#,##0'), font=f_bold, fill=fill_lab, border=bd),
        'plain': 0,
    }
    rows = {}

    def put(r, cell):
        rows.setdefault(r, []).append(cell)

    put(1, _s('A1', 'ব্যয় খোঁজ', S['title']))
    put(2, _s('A2', 'হলুদ ঘরে যা জানা বেছে দিন বা লিখুন — ফাঁকা ঘর মানে «সব»। খাত, সরবরাহকারী ও বিবরণে শব্দের অংশ লিখলেই মেলে। '
                    'এই শীট শুধু দেখার জন্য: এখানে কিছু লিখলে মূল হিসাব বদলায় না, অ্যাপেও যায় না।', S['note']))
    crit = [(3, 'হিসাব বিভাগ'), (4, 'হিজরী বছর'), (5, 'হিজরী মাস'), (6, 'খাত'), (7, 'সরবরাহকারী'), (8, 'বিবরণে শব্দ'), (9, 'পরিশোধ (নগদ/বাকি)')]
    for r, label in crit:
        put(r, _s('A%d' % r, label, S['label']))
        put(r, '<c r="B%d" s="%d"/>' % (r, S['input']))
    months = ','.join('"%s"' % m for m in HIJRI_MONTHS)
    put(5, _f('AD5', 'IF(B5="","",IFERROR(MATCH(B5,{%s},0),-1))' % months, S['plain']))

    put(11, _s('A11', 'মিলেছে (টি)', S['label']))
    put(11, _f('B11', 'MAX($AA$1:$AA$%d)' % LAST, S['moneyb']))
    put(11, _s('C11', 'মোট টাকা', S['label']))
    put(11, _f('D11', 'SUM($AC$2:$AC$%d)' % LAST, S['moneyb']))
    put(11, _f('E11', 'IF(B11>%d,"প্রথম %dটি সারি দেখানো হচ্ছে — আরও শর্ত দিয়ে খোঁজ ছোট করুন","")' % (SEARCH_ROWS, SEARCH_ROWS), S['plain']))

    cols = [('A', '#', None, 'cell'), ('B', 'তারিখ', 'B', 'date'), ('C', 'বিভাগ', 'A', 'cell'), ('D', 'খাত', 'C', 'cell'),
            ('E', 'বিবরণ', 'D', 'cell'), ('F', 'পরিমাণ', 'E', 'cell'), ('G', 'মাপ', 'F', 'cell'), ('H', 'মোট টাকা', 'H', 'money'),
            ('I', 'সরবরাহকারী', 'I', 'cell'), ('J', 'পরিশোধ', 'K', 'cell'), ('K', 'রশিদ নং', 'J', 'cell'), ('L', 'ব্যয় শীটের সারি', None, 'cell')]
    hdr_row = 13
    for c, h, _, _ in cols:
        put(hdr_row, _s('%s%d' % (c, hdr_row), h, S['hdr']))
    first = hdr_row + 1
    last = hdr_row + SEARCH_ROWS
    for r in range(first, last + 1):
        k = r - hdr_row
        put(r, _f('AB%d' % r, 'IFERROR(MATCH(%d,$AA$1:$AA$%d,0),"")' % (k, LAST), S['plain']))
        for c, _, src, sty in cols:
            if c == 'A':
                fm = 'IF($AB%d="","",%d)' % (r, k)
            elif c == 'L':
                fm = 'IF($AB%d="","",$AB%d)' % (r, r)
            else:
                ix = 'INDEX(%s$%s$1:$%s$%d,$AB%d)' % (E, src, src, LAST, r)
                fm = 'IF($AB%d="","",IF(%s="","",%s))' % (r, ix, ix)
            put(r, _f('%s%d' % (c, r), fm, S[sty]))

    # চলমান গণনা: AA1 = 0, AA{r} = AA{r-1} + (ব্যয়ের সারি r শর্ত মেলে?)
    put(1, '<c r="AA1"><v>0</v></c>')
    cond = ('AND({E}$H2<>"",OR($B$3="",{E}$A2=$B$3),OR($B$4="",{E}$L2=$B$4),OR($AD$5="",{E}$M2=$AD$5),'
            'OR($B$6="",ISNUMBER(SEARCH($B$6,{E}$C2))),OR($B$7="",ISNUMBER(SEARCH($B$7,{E}$I2))),'
            'OR($B$8="",ISNUMBER(SEARCH($B$8,{E}$D2))),OR($B$9="",{E}$K2=$B$9))').format(E=E)
    for r in range(2, LAST + 1):
        if r == 2:
            put(r, _f('AA2', 'AA1+IF(%s,1,0)' % cond, S['plain'], ('master', 0, 'AA2:AA%d' % LAST)))
            put(r, _f('AC2', 'IF(AA2>AA1,N(%s$H2),0)' % E, S['plain'], ('master', 1, 'AC2:AC%d' % LAST)))
        else:
            put(r, _f('AA%d' % r, '', S['plain'], ('slave', 0)))
            put(r, _f('AC%d' % r, '', S['plain'], ('slave', 1)))

    def colnum(ref):
        return col_num(re.match(r'([A-Z]+)', ref).group(1))

    body = []
    for r in sorted(rows):
        cells = sorted(rows[r], key=lambda c: colnum(re.search(r'r="([A-Z]+)', c).group(1)))
        ht = ' ht="44" customHeight="1"' if r == 2 else (' ht="30" customHeight="1"' if r == hdr_row else '')
        body.append('<row r="%d"%s>%s</row>' % (r, ht, ''.join(cells)))
    widths = [(1, 1, 18), (2, 2, 16), (3, 3, 12), (4, 4, 16), (5, 5, 30), (6, 7, 9), (8, 8, 13), (9, 9, 16), (10, 11, 10), (12, 12, 12)]
    colxml = ''.join('<col min="%d" max="%d" width="%s" customWidth="1"/>' % w for w in widths)
    colxml += '<col min="27" max="30" width="9" hidden="1" customWidth="1"/>'
    dv = ('<dataValidations count="4">'
          '<dataValidation type="list" allowBlank="1" sqref="B3"><formula1>"মাতবাখ,মাদরাসা,তামিরাত,সাধারণ"</formula1></dataValidation>'
          '<dataValidation type="list" allowBlank="1" sqref="B4"><formula1>"1446,1447,1448,1449,1450,1451"</formula1></dataValidation>'
          '<dataValidation type="list" allowBlank="1" sqref="B5"><formula1>"%s"</formula1></dataValidation>'
          '<dataValidation type="list" allowBlank="1" sqref="B9"><formula1>"নগদ,বাকি"</formula1></dataValidation>'
          '</dataValidations>') % ','.join(HIJRI_MONTHS)
    # সরবরাহকারীর ড্রপডাউন — বানান ঠিক রাখতে; তালিকার বাইরের শব্দও লেখা যায়
    dv = dv.replace('</dataValidations>', '<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="B7">'
                    '<formula1>SupplierList</formula1></dataValidation></dataValidations>').replace('count="4"', 'count="5"')
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
           '<dimension ref="A1:AD%d"/>' % LAST +
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/>'
           '<selection pane="bottomLeft" activeCell="B3" sqref="B3"/></sheetView></sheetViews>' % (hdr_row, first) +
           '<sheetFormatPr defaultRowHeight="15"/><cols>%s</cols>' % colxml +
           '<sheetData>%s</sheetData>' % ''.join(body) + PROTECT +
           '<mergeCells count="1"><mergeCell ref="A2:L2"/></mergeCells>' + dv +
           '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>')
    return xml


def add_search_sheet(parts, names, wb, st):
    """«খোঁজ» শীট না থাকলে যোগ — workbook, rels, content types, app.xml মিলিয়ে।"""
    if re.search(r'<sheet\b[^>]*name="%s"' % SEARCH_SHEET, wb):
        return wb
    existing = [int(n) for n in re.findall(r'xl/worksheets/sheet(\d+)\.xml', ' '.join(names))]
    num = max(existing) + 1
    part = 'xl/worksheets/sheet%d.xml' % num
    rels = parts['xl/_rels/workbook.xml.rels'].decode('utf-8')
    rid = 'rId%d' % (max(int(i) for i in re.findall(r'Id="rId(\d+)"', rels)) + 1)
    abs_target = '/xl/worksheets/' in rels
    target = ('/xl/worksheets/sheet%d.xml' if abs_target else 'worksheets/sheet%d.xml') % num
    rels = rels.replace('</Relationships>', '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="%s"/></Relationships>' % (rid, target))
    parts['xl/_rels/workbook.xml.rels'] = rels.encode('utf-8')
    ct = parts['[Content_Types].xml'].decode('utf-8')
    ct = ct.replace('</Types>', '<Override PartName="/%s" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' % part)
    parts['[Content_Types].xml'] = ct.encode('utf-8')
    sid = max(int(i) for i in re.findall(r'<sheet\b[^>]*sheetId="(\d+)"', wb)) + 1
    root = re.search(r'<workbook\b[^>]*>', wb).group(0)
    ns = '' if 'xmlns:r=' in root else ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    wb = wb.replace('</sheets>', '<sheet%s name="%s" sheetId="%d" r:id="%s"/></sheets>' % (ns, SEARCH_SHEET, sid, rid))
    # Excel খোলার সময় সব সূত্র হিসাব করুক (নতুন সূত্রে আগের ফল নেই)
    if '<calcPr' in wb:
        if 'fullCalcOnLoad' not in re.search(r'<calcPr\b[^>]*>', wb).group(0):
            wb = re.sub(r'<calcPr\b', '<calcPr fullCalcOnLoad="1"', wb, count=1)
    else:
        wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
    if 'docProps/app.xml' in parts:
        app = parts['docProps/app.xml'].decode('utf-8')
        m = re.search(r'(<vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>)(\d+)(</vt:i4>)', app)
        t = re.search(r'<TitlesOfParts><vt:vector size="(\d+)" baseType="lpstr">', app)
        if m and t:
            n_ws = int(m.group(2))
            app = app.replace(m.group(0), m.group(1) + str(n_ws + 1) + m.group(3))
            items = list(re.finditer(r'<vt:lpstr>[^<]*</vt:lpstr>', app[t.end():]))
            pos = t.end() + items[n_ws - 1].end()
            app = app[:pos] + '<vt:lpstr>%s</vt:lpstr>' % SEARCH_SHEET + app[pos:]
            app = app.replace(t.group(0), '<TitlesOfParts><vt:vector size="%d" baseType="lpstr">' % (int(t.group(1)) + 1))
            parts['docProps/app.xml'] = app.encode('utf-8')
    parts[part] = build_search_sheet(st).encode('utf-8')
    names.append(part)
    return wb


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

    wb = add_search_sheet(parts, names, wb, st)
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
            zi = zipfile.ZipInfo(n, date_time=infos[n].date_time if n in infos else (2026, 10, 15, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, parts[n])
    os.replace(tmp, dst)
    return len(st.new) - len(st.xfs)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    added = protect_file(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print('protected:', sys.argv[-1], '(unlocked styles added: %d)' % added)
