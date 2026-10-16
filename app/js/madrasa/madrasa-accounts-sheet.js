'use strict';
/* global MdrAccAPI, MdrAccSheetCore, showToast */
/* «বড় লেখা» (html-এ CSS zoom) থাকলে মাপ zoom ছাড়া আসে — fixed প্যানেল বসাতে zoom দিয়ে ভাগ */
function _zf() { var d = document.documentElement; return d.currentCSSZoom || parseFloat(getComputedStyle(d).zoom) || 1; }
function _zr(el) { var r = el.getBoundingClientRect(), z = _zf(); return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z }; }
function _zw() { return window.innerWidth / _zf(); }
function _zh() { return window.innerHeight / _zf(); }

/*
 * হিসাব ▦ শীট — Excel-এর মতো ঘর-ঘর করে হিসাব লেখা (দফতরের টেমপ্লেটের একই কলাম)।
 *  - মাস বেছে নিলে সেই মাসের এন্ট্রি সারি হয়ে আসে; নিচে খালি সারিতে নতুন লেখা।
 *  - Enter = নিচের ঘর, Tab = ডানের ঘর, তীর = ঘর বদল, Esc = ঘরের লেখা আগের মতো, Ctrl+S = সংরক্ষণ।
 *  - Shift+তীর / মাউস টেনে কয়েক ঘর বাছাই → Ctrl+C কপি, Ctrl+X কাট, Delete খালি, Ctrl+D উপরের ঘর নিচে,
 *    নিচে বাছাইয়ের যোগফল। Ctrl+Z / Ctrl+Y = আগের/পরের অবস্থা (পেস্ট, মোছা, ভরাট সবকিছুর)।
 *  - Excel থেকে কয়েক সারি/কলাম কপি করে যেকোনো ঘরে পেস্ট করা যায়; এক ঘরের লেখা বাছাই করা সব ঘরে বসে।
 *  - লেখার সময়ই ভুল ঘর লাল, নতুন খাত হলুদ (Excel আপলোডের একই পার্সার দিয়ে সারি যাচাই)।
 *  - তালিকার ঘরে (বিভাগ, খাত, মাপ, সরবরাহকারী, পরিশোধ, ধরন) লিখতে লিখতে মিলের তালিকা।
 *  - খোঁজা ও দিনভিত্তিক মোট — শুধু দেখার জন্য ছাঁকা, ডাটা বদলায় না।
 *  - সংরক্ষণ = Excel আপলোডের একই পার্সার ও যাচাই (MdrAccSheetCore) + একই atomic সার্ভার batch
 *    (payload.source = 'grid' — Excel মোডে সার্ভার আটকায়)। হয় সব সারি যায়, নয়তো কোনোটাই না।
 *    সংরক্ষণের আগে সার্ভার থেকে মাসটা আবার এনে দেখা হয় অন্য ডিভাইস থেকে কিছু বদলেছে কিনা।
 *  - ২৪ ঘণ্টার পুরনো এন্ট্রি দফতরের জন্য তালাবদ্ধ (আগের নিয়ম) — বদলাতে সাধারণ এডিট/অনুমোদন।
 */
(function () {
  var A = MdrAccAPI;
  var esc = function (s) { return A.esc(s); };
  var bn = function (s) { return String(s == null ? '' : s).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }); };
  var fa = function (n) { return A.fa(n); };
  var toEn = function (s) { return String(s == null ? '' : s).replace(/[০-৯]/g, function (d) { return String('০১২৩৪৫৬৭৮৯'.indexOf(d)); }).trim(); };
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); };

  var BOOKS = ['মাতবাখ', 'মাদরাসা', 'তামিরাত', 'সাধারণ'];
  var UNITS = ['কেজি', 'গ্রাম', 'লিটার', 'মিলি', 'পিস', 'প্যাকেট', 'বস্তা', 'ডজন', 'ফুট', 'মিটার'];
  var BLANK_ROWS = 15;
  var UNDO_MAX = 100;

  /* h = পার্সারের কলাম-নাম (টেমপ্লেটের মতো); দিন-কলাম পার্সারে «তারিখ» হয়ে যায়।
     calc = শুধু দেখানো (একক মূল্য = মোট ÷ পরিমাণ) — টেমপ্লেটের G কলামের জায়গায়, যাতে
     টেমপ্লেট থেকে পুরো সারি পেস্ট করলে কলাম না সরে। */
  var SHEETS = {
    expense: { label: 'ব্যয়', cols: [
      { k: 'book', h: 'হিসাব বিভাগ', w: 92, list: 'books' },
      { k: 'day', h: 'দিন', w: 46, num: true },
      { k: 'cat', h: 'খাত', w: 118, list: 'cats' },
      { k: 'desc', h: 'বিবরণ', w: 190 },
      { k: 'qty', h: 'পরিমাণ', w: 66, num: true },
      { k: 'unit', h: 'মাপ', w: 62, list: 'units' },
      { k: '_up', h: 'একক মূল্য', w: 76, num: true, calc: true },
      { k: 'amt', h: 'মোট টাকা', w: 92, num: true },
      { k: 'sup', h: 'সরবরাহকারী', w: 118, list: 'sups' },
      { k: 'rec', h: 'রশিদ নং', w: 66 },
      { k: 'pay', h: 'পরিশোধ', w: 66, list: 'pays' },
    ] },
    income: { label: 'আয়', cols: [
      { k: 'day', h: 'দিন', w: 46, num: true },
      { k: 'amt', h: 'টাকা', w: 110, num: true },
      { k: 'note', h: 'উৎস / বিবরণ', w: 320 },
    ] },
    qard: { label: 'করজ', cols: [
      { k: 'kind', h: 'ধরন', w: 70, list: 'kinds' },
      { k: 'day', h: 'দিন', w: 46, num: true },
      { k: 'amt', h: 'টাকা', w: 96, num: true },
      { k: 'cat', h: 'খাত', w: 150 },
      { k: 'note', h: 'বিবরণ', w: 220 },
    ] },
    payment: { label: 'পরিশোধ', cols: [
      { k: 'book', h: 'হিসাব বিভাগ', w: 92, list: 'books' },
      { k: 'day', h: 'দিন', w: 46, num: true },
      { k: 'sup', h: 'সরবরাহকারী', w: 140, list: 'sups' },
      { k: 'amt', h: 'টাকা', w: 100, num: true },
      { k: 'rec', h: 'রশিদ নং', w: 70 },
      { k: 'note', h: 'মন্তব্য', w: 200 },
    ] },
  };
  var TAB_ORDER = ['expense', 'income', 'qard', 'payment'];

  var S = {
    tab: 'expense', year: 0, monthNo: 0, rows: null, busy: false, focus: null,
    sel: null,          /* { ar, ac, fr, fc } — ar/ac = সক্রিয় ঘর, fr/fc = বাছাইয়ের অন্য কোণ */
    edit: null,         /* { r, c, start, pushed } — এখন যে ঘরে লেখা চলছে */
    undo: [], redo: [],
    filter: { q: '', day: '' },
    dd: null,           /* তালিকা-ঘরের ড্রপডাউন { r, c, items, hi } */
    sig: '',            /* মাস লোডের সময় ডাটাবেজের অবস্থা — অন্য ডিভাইসের পরিবর্তন ধরতে */
    lists: null,
    drag: null,
  };

  function core() { return window.MdrAccSheetCore || {}; }
  function readOnly() { return !!(core().isReadOnly && core().isReadOnly()); }
  function cols(sheet) { return SHEETS[sheet || S.tab].cols; }
  function inMonth(e) { return A.dateKey(e.hijriYear, e.month, 1).slice(0, 7) === String(S.year).padStart(4, '0') + '-' + String(S.monthNo).padStart(2, '0'); }
  function numTxt(v) { var n = Number(v); return (v === null || v === undefined || v === '' || isNaN(n)) ? '' : bn(String(Math.round(n * 100) / 100)); }
  function numVal(v) {
    var t = toEn(v).replace(/,/g, '');
    if (t === '') return null;
    var n = Number(t);
    return isNaN(n) ? NaN : n;
  }
  function sortEntries(a, b) { return (Number(a.day) || 0) - (Number(b.day) || 0) || (Number(a._at) || 0) - (Number(b._at) || 0); }

  function lockedEntry(e) {
    if (!e) return false;
    var c = core();
    if (c.isAdminSession && c.isAdminSession()) return false;
    return c.entryAgeHours ? c.entryAgeHours(e) > 24 : false;
  }

  function mkRow(sheet, v, orig, origKind) {
    var row = { sheet: sheet, v: v || {}, orig: orig || null, origKind: origKind || '', del: false, err: '', locked: lockedEntry(orig) };
    row.base = rowKey(row);
    return row;
  }

  function rowKey(row, sheet) {
    var cs = cols(sheet || row.sheet || S.tab);
    return cs.filter(function (c) { return !c.calc; }).map(function (c) { return String(row.v[c.k] == null ? '' : row.v[c.k]).trim(); }).join('\u0001');
  }
  function isEmpty(row, sheet) { return !rowKey(row, sheet).replace(/\u0001/g, ''); }
  function isChanged(row, sheet) {
    if (row.del) return !!row.orig;
    if (!row.orig) return !isEmpty(row, sheet);
    return rowKey(row, sheet) !== row.base;
  }

  /* একক মূল্য = মোট ÷ পরিমাণ (দুটোই থাকলে) */
  function unitPrice(row) {
    var amt = numVal(row.v.amt), qty = numVal(row.v.qty);
    if (!(amt > 0) || !(qty > 0)) return '';
    return bn(String(Math.round(amt / qty * 100) / 100));
  }
  function cellValue(row, c) {
    if (c.calc) return unitPrice(row);
    return row.v[c.k] == null ? '' : row.v[c.k];
  }
  function cellEditable(row, c) {
    if (readOnly() || row.locked || row.del || c.calc) return false;
    if (c.k === 'kind' && row.orig) return false; /* পুরনো করজের ধরন বদলানো যায় না */
    return true;
  }

  /* ── মাসের এন্ট্রি → সারি ── */
  function monthEntries() {
    return {
      exp: A.Expense.getAll().filter(inMonth).sort(sortEntries),
      inc: A.Income.getAll().filter(inMonth).sort(sortEntries),
      pays: (A.Dues.payments ? A.Dues.payments() : []).filter(inMonth).sort(sortEntries),
    };
  }

  /* মাসের ডাটার ছাপ — সংরক্ষণের আগে মিলিয়ে দেখা হয় অন্য ডিভাইস থেকে কিছু বদলেছে কিনা */
  function monthSig() {
    var m = monthEntries();
    var pick = function (e) {
      return [e.id, e.account, e.day, e.amount, e.category, e.description, e.quantity, e.unit, e.supplier, e.receiptNo, e.paymentMethod, e.note].join('|');
    };
    return [m.exp.map(pick).sort().join('~'), m.inc.map(pick).sort().join('~'), m.pays.map(pick).sort().join('~')].join('#');
  }

  function loadRows() {
    var lbl = A.ACCOUNT_LABELS || {};
    var m = monthEntries();
    var R = { expense: [], income: [], qard: [], payment: [] };
    m.exp.forEach(function (e) {
      if (e.account === 'qard') {
        R.qard.push(mkRow('qard', { kind: 'দেওয়া', day: numTxt(e.day), amt: numTxt(e.amount), cat: e.category || '', note: e.description || '' }, e, 'give'));
        return;
      }
      R.expense.push(mkRow('expense', {
        book: lbl[e.account] || e.account || '', day: numTxt(e.day), cat: e.category || '', desc: e.description || '',
        qty: numTxt(e.quantity), unit: e.unit || '', amt: numTxt(e.amount), sup: e.supplier || '', rec: e.receiptNo || '',
        pay: e.paymentMethod === 'due' ? 'বাকি' : 'নগদ',
      }, e, 'expense'));
    });
    m.inc.forEach(function (e) {
      if (e.account === 'qard_return') {
        var parts = String(e.note || '').split(' — ');
        var cat = parts.length > 1 ? parts[1] : '';
        var note = parts.length > 2 ? parts.slice(2).join(' — ') : (parts.length > 1 ? '' : String(e.note || ''));
        R.qard.push(mkRow('qard', { kind: 'আদায়', day: numTxt(e.day), amt: numTxt(e.amount), cat: cat, note: note }, e, 'return'));
        return;
      }
      R.income.push(mkRow('income', { day: numTxt(e.day), amt: numTxt(e.amount), note: e.note || '' }, e, 'income'));
    });
    R.qard.sort(function (a, b) { return sortEntries(a.orig, b.orig); });
    m.pays.forEach(function (p) {
      R.payment.push(mkRow('payment', { book: lbl[p.account] || p.account || '', day: numTxt(p.day), sup: p.supplier || '', amt: numTxt(p.amount), rec: p.receiptNo || '', note: '' }, p, 'payment'));
    });
    TAB_ORDER.forEach(function (t) { padBlank(R[t], t); });
    S.rows = R;
    S.sig = monthSig();
    S.undo = []; S.redo = [];
    S.sel = null; S.edit = null; S.dd = null;
    S.filter = { q: '', day: '' };
    S.lists = null;
  }

  function padBlank(list, sheet) {
    sheet = sheet || S.tab;
    var blanks = 0;
    for (var i = list.length - 1; i >= 0 && !list[i].orig && isEmpty(list[i], sheet); i--) blanks++;
    while (blanks < BLANK_ROWS) { list.push(mkRow(sheet, {})); blanks++; }
  }

  function dirtyCount() {
    if (!S.rows) return 0;
    var n = 0;
    TAB_ORDER.forEach(function (t) { S.rows[t].forEach(function (r) { if (isChanged(r, t)) n++; }); });
    return n;
  }
  /* অ্যাপ আপডেট এলে (app-update.js) সেভ-না-করা কাজ থাকলে হঠাৎ রিফ্রেশ নয় */
  (function () { var prev = window.MMAppBusy; window.MMAppBusy = function () { return (prev ? prev() : false) || dirtyCount() > 0; }; })();

  function ensureState() {
    if (!S.year) {
      var t = A.todayHijri();
      S.year = Number(t.year); S.monthNo = Number(t.monthNo || A.monthNo(t.month));
    }
    if (!S.rows) loadRows();
  }

  /* ── তালিকা (ড্রপডাউন) ── */
  function lists() {
    if (S.lists) return S.lists;
    var sups = {};
    (A.Dues.getAll ? A.Dues.getAll() : []).forEach(function (d) { if (d.supplier) sups[d.supplier] = 1; });
    A.Expense.getAll().forEach(function (e) { if (e.supplier) sups[e.supplier] = 1; });
    S.lists = {
      books: BOOKS, units: UNITS, pays: ['নগদ', 'বাকি'], kinds: ['দেওয়া', 'আদায়'],
      cats: A.Categories.getAll().slice(), sups: Object.keys(sups).sort(),
    };
    return S.lists;
  }

  /* ── লেখার সময় ঘর যাচাই ── */
  function knownCat(v) {
    var n = norm(v);
    return lists().cats.some(function (c) { return norm(c) === n; });
  }

  /* ঘরের নিজস্ব নিয়ম: { bad } = লাল (সংরক্ষণ হবে না), { warn } = হলুদ (চলবে, জেনে রাখুন) */
  function cellCheck(row, c, sheet) {
    if (row.del || row.locked || c.calc || isEmpty(row, sheet)) return null;
    if (row.orig && !isChanged(row, sheet)) return null;
    var raw = String(row.v[c.k] == null ? '' : row.v[c.k]).trim();
    /* যে সারিতে এখন লেখা চলছে, তার খালি ঘর এখনই লাল নয় — সারি ছাড়লে দেখাবে */
    if (!raw && S.edit && S.rows[S.tab] && S.rows[S.tab][S.edit.r] === row) return null;
    var C = core();
    if (c.k === 'day') {
      if (!raw) return { bad: 'দিন লিখুন (১–৩০)' };
      var d = numVal(raw);
      if (!(d >= 1 && d <= 30) || Math.floor(d) !== d) return { bad: 'দিন ১ থেকে ৩০-এর মধ্যে পূর্ণ সংখ্যা হবে' };
      return null;
    }
    if (c.k === 'amt') {
      if (!raw) return { bad: 'টাকার অঙ্ক লিখুন' };
      var a = numVal(raw);
      if (isNaN(a) || a <= 0) return { bad: 'টাকার অঙ্ক সংখ্যায় লিখুন' };
      return null;
    }
    if (c.k === 'qty') {
      if (!raw) return null;
      var q = numVal(raw);
      return (isNaN(q) || q < 0) ? { bad: 'পরিমাণ সংখ্যায় লিখুন' } : null;
    }
    if (c.k === 'book') {
      if (!raw) return sheet === 'payment' ? { bad: 'হিসাব বিভাগ লিখুন' } : null;
      if (C.resolveBook && !C.resolveBook(raw)) return { bad: 'হিসাব বিভাগ হবে মাতবাখ / মাদরাসা / তামিরাত / সাধারণ' };
      return null;
    }
    if (c.k === 'kind') {
      if (C.resolveQardKind && !C.resolveQardKind(raw)) return { bad: 'ধরন «দেওয়া» বা «আদায়» হবে' };
      return null;
    }
    if (c.k === 'pay') {
      if (raw && !/^(নগদ|বাকি|বাকী|cash|due|paid|credit)$/i.test(raw)) return { warn: '«নগদ» বা «বাকি» লিখুন — না হলে নগদ ধরা হবে' };
      return null;
    }
    if (c.k === 'sup') {
      if (!raw && sheet === 'payment') return { bad: 'সরবরাহকারীর নাম লিখুন' };
      if (!raw && sheet === 'expense' && /^(বাকি|বাকী|due|credit)$/i.test(String(row.v.pay || '').trim())) return { bad: 'বাকি হলে সরবরাহকারী লাগবে' };
      return null;
    }
    if (c.k === 'cat') {
      if (sheet === 'qard') return raw ? null : { bad: 'খাতের নাম লিখুন' };
      if (raw && !knownCat(raw)) return { warn: 'নতুন খাত — সংরক্ষণ করলে খাতের তালিকায় যোগ হবে' };
      return null;
    }
    return null;
  }

  function rowBad(row, sheet) {
    return cols(sheet).some(function (c) { var r = cellCheck(row, c, sheet); return r && r.bad; });
  }

  /* ── দেখানোর ছাঁকা (খোঁজা / দিন) ── */
  function filterOn() { return !!(S.filter.q || S.filter.day); }
  function rowVisible(row) {
    if (!filterOn()) return true;
    if (!row.orig && isEmpty(row)) return false;
    if (S.filter.day && String(numVal(row.v.day)) !== S.filter.day) return false;
    if (S.filter.q) {
      var q = norm(S.filter.q);
      var hay = norm(cols().map(function (c) { return cellValue(row, c); }).join(' ') + ' ' + toEn(cols().map(function (c) { return cellValue(row, c); }).join(' ')));
      if (hay.indexOf(q) < 0 && hay.indexOf(norm(toEn(S.filter.q))) < 0) return false;
    }
    return true;
  }

  /* ── রেন্ডার ── */
  function rowClass(row) {
    return 'accg-row' + (row.del ? ' is-del' : '') + ((row.err || rowBad(row)) ? ' is-err' : '') + (row.locked ? ' is-locked' : '') +
      (isChanged(row) ? ' is-dirty' : '') + (rowVisible(row) ? '' : ' is-hidden');
  }
  function rowMark(row) {
    return (row.err || rowBad(row)) ? '⚠' : (row.locked ? '🔒' : (isChanged(row) ? '●' : ''));
  }
  function rowTitle(row) {
    if (row.err) return row.err;
    if (row.locked) return '২৪ ঘণ্টার পুরনো — বদলাতে হিসাবের তালিকা থেকে এডিট করুন (জিম্মাদারের অনুমতি লাগে)';
    var msgs = [];
    cols().forEach(function (c) { var r = cellCheck(row, c, S.tab); if (r && r.bad) msgs.push(c.h + ': ' + r.bad); });
    return msgs.join(' · ');
  }

  function cellHtml(row, i, c, j) {
    var chk = cellCheck(row, c, S.tab);
    var tdCls = (c.calc ? 'is-calc' : '') + (chk && chk.bad ? ' is-bad' : (chk && chk.warn ? ' is-warn' : '')) + (c.list ? ' has-list' : '');
    var title = chk ? (chk.bad || chk.warn) : (c.calc ? 'অটো: মোট টাকা ÷ পরিমাণ' : '');
    return '<td class="' + tdCls.trim() + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><input class="accg-in' + (c.num ? ' is-num' : '') + '" data-r="' + i + '" data-c="' + j + '"' +
      ' value="' + esc(cellValue(row, c)) + '"' + (c.num ? ' inputmode="decimal"' : '') +
      (cellEditable(row, c) ? '' : ' readonly') + (c.calc ? ' tabindex="-1"' : '') + ' autocomplete="off" spellcheck="false"></td>';
  }

  function delBtnHtml(row, i) {
    var canDel = !readOnly() && !row.locked && !(S.tab === 'payment' && row.orig) && (row.orig || !isEmpty(row));
    return canDel ? '<button type="button" class="accg-del" data-del="' + i + '" tabindex="-1" title="' + (row.del ? 'মোছা বাতিল' : 'সারি মুছুন') + '">' + (row.del ? '↺' : '✕') + '</button>' : '';
  }

  function rowHtml(row, i) {
    var mark = rowMark(row);
    var cells = cols().map(function (c, j) { return cellHtml(row, i, c, j); }).join('');
    return '<tr class="' + rowClass(row) + '" data-row="' + i + '"><th class="accg-no" title="' + esc(rowTitle(row)) + '">' + bn(i + 1) +
      (mark ? '<span class="accg-mark">' + mark + '</span>' : '') + '</th>' + cells + '<td class="accg-act">' + delBtnHtml(row, i) + '</td></tr>';
  }

  function tabTotal(t, onlyVisible) {
    return (S.rows[t] || []).reduce(function (s, r) {
      if (r.del) return s;
      if (onlyVisible && !rowVisible(r)) return s;
      if (t === 'qard' && /আদায়|আদায়/.test(r.v.kind || '')) return s;
      var n = numVal(r.v.amt);
      return s + (n > 0 ? n : 0);
    }, 0);
  }

  /* দিনভিত্তিক মোট (এই ট্যাবের) */
  function dayTotals() {
    var out = {};
    (S.rows[S.tab] || []).forEach(function (r) {
      if (r.del || isEmpty(r)) return;
      if (S.tab === 'qard' && /আদায়|আদায়/.test(r.v.kind || '')) return;
      var d = numVal(r.v.day), a = numVal(r.v.amt);
      if (!(d >= 1 && d <= 30) || !(a > 0)) return;
      out[d] = (out[d] || 0) + a;
    });
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; }).map(function (d) { return { d: d, t: out[d] }; });
  }

  function errRows() {
    var out = [];
    TAB_ORDER.forEach(function (t) { S.rows[t].forEach(function (r, i) { if (r.err) out.push({ t: t, i: i }); }); });
    return out;
  }
  function badRows() {
    var out = [];
    TAB_ORDER.forEach(function (t) { S.rows[t].forEach(function (r, i) { if (isChanged(r, t) && !r.del && rowBad(r, t)) out.push({ t: t, i: i }); }); });
    return out;
  }

  function tableWidth() {
    return cols().reduce(function (w, c) { return w + c.w; }, 44 + 34);
  }

  function selSummaryHtml() {
    var r = selRange();
    if (!r || (r.r0 === r.r1 && r.c0 === r.c1)) return '';
    var cells = 0, nums = 0, sum = 0;
    for (var i = r.r0; i <= r.r1; i++) {
      var row = S.rows[S.tab][i];
      if (!row || !rowVisible(row)) continue;
      for (var j = r.c0; j <= r.c1; j++) {
        var c = cols()[j];
        cells++;
        if (!c.num || c.k === 'day') continue;
        var n = numVal(cellValue(row, c));
        if (n !== null && !isNaN(n)) { nums++; sum += n; }
      }
    }
    return 'বাছাই: ' + bn(cells) + ' ঘর' + (nums ? ' · যোগফল <b>৳' + fa(sum) + '</b> · গড় ৳' + fa(Math.round(sum / nums * 100) / 100) : '');
  }

  function daysHtml() {
    var list = dayTotals();
    if (!list.length) return '';
    return '<span class="accg-days-lbl">দিনভিত্তিক মোট:</span>' + list.map(function (x) {
      var on = S.filter.day === String(x.d);
      return '<button type="button" class="accg-day' + (on ? ' active' : '') + '" data-day="' + x.d + '" title="শুধু এই দিনের সারি দেখুন">' + bn(x.d) + ' · ৳' + fa(x.t) + '</button>';
    }).join('');
  }

  function footHtml() {
    var ro = readOnly();
    var dirty = dirtyCount();
    var errs = errRows().length + badRows().length;
    var fsum = filterOn() ? ' · ছাঁকা অনুযায়ী: <b>৳' + fa(tabTotal(S.tab, true)) + '</b>' : '';
    return '<div class="accg-sum">এই মাসে ' + esc(SHEETS[S.tab].label) + (S.tab === 'qard' ? ' (দেওয়া)' : '') + ': <b>৳' + fa(tabTotal(S.tab)) + '</b>' + fsum +
      (dirty ? ' · <span class="accg-dirty">' + bn(dirty) + 'টি পরিবর্তন সংরক্ষণ বাকি</span>' : '') +
      (errs ? ' · <span class="accg-errtxt">' + bn(errs) + 'টি সারিতে সমস্যা (লাল ঘর বা ⚠-এর উপর মাউস রাখুন)</span>' : '') +
      '<div class="accg-selsum" id="accg-selsum">' + selSummaryHtml() + '</div></div>' +
      (ro ? '' : '<div class="accg-btns">' +
        '<button type="button" class="accg-btn" id="accg-undo" title="আগের অবস্থা (Ctrl+Z)"' + (S.undo.length ? '' : ' disabled') + '>↶</button>' +
        '<button type="button" class="accg-btn" id="accg-redo" title="পরের অবস্থা (Ctrl+Y)"' + (S.redo.length ? '' : ' disabled') + '>↷</button>' +
        '<button type="button" class="accg-btn" id="accg-reset"' + (dirty ? '' : ' disabled') + '>বাতিল</button>' +
        '<button type="button" class="accg-btn is-primary" id="accg-save"' + (dirty && !S.busy ? '' : ' disabled') + '>' + (S.busy ? 'সংরক্ষণ হচ্ছে…' : '✓ সংরক্ষণ') + '</button></div>');
  }

  function tabsHtml() {
    return TAB_ORDER.map(function (t) {
      var n = S.rows[t].filter(function (r) { return r.orig || !isEmpty(r, t); }).length;
      var d = S.rows[t].filter(function (r) { return isChanged(r, t); }).length;
      var e = S.rows[t].filter(function (r) { return r.err || (isChanged(r, t) && !r.del && rowBad(r, t)); }).length;
      return '<button type="button" class="accg-tab' + (t === S.tab ? ' active' : '') + (e ? ' has-err' : '') + '" data-tab="' + t + '">' +
        esc(SHEETS[t].label) + ' <span>' + bn(n) + '</span>' + (d ? '<i>●' + bn(d) + '</i>' : '') + '</button>';
    }).join('');
  }

  function buildHtml() {
    var ro = readOnly();
    var years = {};
    [S.year - 1, S.year, S.year + 1].forEach(function (y) { years[y] = 1; });
    A.Expense.getAll().concat(A.Income.getAll()).forEach(function (e) { var y = Number(e.hijriYear); if (y) years[y] = 1; });
    var yOpts = Object.keys(years).sort().map(function (y) { return '<option value="' + y + '"' + (Number(y) === S.year ? ' selected' : '') + '>' + bn(y) + '</option>'; }).join('');
    /* শিক্ষাবর্ষের ক্রমে (শাওয়াল → রমজান) */
    var mOpts = (A.MONTHS || []).map(function (m) { var no = A.monthNo(m); return '<option value="' + no + '"' + (no === S.monthNo ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    var colgroup = '<colgroup><col style="width:44px">' + cols().map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join('') + '<col style="width:34px"></colgroup>';
    var head = '<tr><th class="accg-no">#</th>' + cols().map(function (c) { return '<th' + (c.calc ? ' class="is-calc"' : '') + '>' + esc(c.h) + '</th>'; }).join('') + '<th></th></tr>';
    var body = S.rows[S.tab].map(rowHtml).join('');
    var note = ro
      ? '<div class="accg-note is-ro">' + esc(core().lockMsg ? core().lockMsg() : 'এখানে শুধু দেখা যায়') + ' — শীটে এখন শুধু দেখা যায় (কপি, খোঁজা ও বাছাইয়ের যোগফল চলবে)।</div>'
      : '<div class="accg-note">Enter = নিচে · Tab = ডানে · Esc = ঘরের লেখা আগের মতো · Shift+তীর বা মাউস টেনে কয়েক ঘর বাছাই → Ctrl+C কপি · Ctrl+X কাট · Delete খালি · Ctrl+D উপরের ঘর নিচে · Ctrl+Z / Ctrl+Y = আগের / পরের অবস্থা · Ctrl+S = সংরক্ষণ · Excel থেকে কপি করে যেকোনো ঘরে পেস্ট</div>';
    return '<div class="acc-ws accg-ws">' +
      '<div class="acc-ws-top">' +
      '<button type="button" class="acc-ws-back" onclick="closeAccGridSafe()">← হিসাব</button>' +
      '<div class="acc-ws-title">হিসাব শীট</div>' +
      '<div class="accg-month"><select id="accg-month" aria-label="হিজরী মাস">' + mOpts + '</select><select id="accg-year" aria-label="হিজরী বছর">' + yOpts + '</select></div>' +
      '</div>' +
      '<div class="accg-tabs">' + tabsHtml() + '</div>' + note +
      (S.tab === 'payment' && !ro ? '<div class="accg-note">পরিশোধ: সরবরাহকারীর নাম ও বিভাগ বাকিতে কেনার সাথে মিলতে হবে। আগে সংরক্ষিত পরিশোধ শীট থেকে মোছা যায় না।</div>' : '') +
      '<div class="accg-tools"><input type="search" id="accg-q" class="accg-q" placeholder="🔍 এই ট্যাবে খুঁজুন (খাত, বিবরণ, সরবরাহকারী, টাকা…)" value="' + esc(S.filter.q) + '" autocomplete="off">' +
      (filterOn() ? '<button type="button" class="accg-btn accg-clearf" id="accg-clearf">ছাঁকা মুছুন</button>' : '') + '</div>' +
      '<div class="accg-days" id="accg-days">' + daysHtml() + '</div>' +
      (filterOn() ? '<div class="accg-note is-filter">ছাঁকা চালু — শুধু মিলে যাওয়া সারি দেখাচ্ছে। নতুন সারি লিখতে ছাঁকা মুছুন।</div>' : '') +
      '<div class="accg-wrap" id="accg-wrap"><table class="accg-table" style="width:' + tableWidth() + 'px">' + colgroup + '<thead>' + head + '</thead><tbody id="accg-body">' + body + '</tbody></table></div>' +
      '<div class="accg-foot">' + footHtml() + '</div>' +
      '<div class="accg-dd" id="accg-dd" hidden></div></div>';
  }

  function render(root) {
    ensureState();
    injectCss();
    closeDD();
    root.innerHTML = '<div class="acc-shell">' + buildHtml() + '</div>';
    wire(root);
    paintSel();
    if (S.focus) { var f = S.focus; S.focus = null; focusCell(f.r, f.c, true, true); }
  }

  function rerender(keepFocus) {
    var root = document.getElementById('accounts-root');
    if (!root) return;
    if (keepFocus !== false && S.sel && !S.focus) S.focus = { r: S.sel.ar, c: S.sel.ac };
    render(root);
  }

  /* শুধু নিচের অংশ, ট্যাব আর দিনের মোট — টাইপের সময় ফোকাস না হারাতে */
  function refreshChrome() {
    var root = document.getElementById('accounts-root');
    if (!root || !S.rows) return;
    var foot = root.querySelector('.accg-foot'), tabs = root.querySelector('.accg-tabs'), days = root.querySelector('#accg-days');
    if (foot) foot.innerHTML = footHtml();
    if (tabs) tabs.innerHTML = tabsHtml();
    if (days) days.innerHTML = daysHtml();
    wireButtons(root);
  }

  function refreshRow(i) {
    var tr = document.querySelector('#accg-body tr[data-row="' + i + '"]');
    var row = S.rows[S.tab][i];
    if (!tr || !row) return;
    tr.className = rowClass(row);
    var no = tr.querySelector('.accg-no');
    var mark = rowMark(row);
    if (no) { no.innerHTML = bn(i + 1) + (mark ? '<span class="accg-mark">' + mark + '</span>' : ''); no.title = rowTitle(row); }
    var tds = tr.querySelectorAll('td');
    cols().forEach(function (c, j) {
      var td = tds[j];
      if (!td) return;
      var chk = cellCheck(row, c, S.tab);
      td.className = ((c.calc ? 'is-calc' : '') + (chk && chk.bad ? ' is-bad' : (chk && chk.warn ? ' is-warn' : '')) + (c.list ? ' has-list' : '')).trim();
      var t = chk ? (chk.bad || chk.warn) : (c.calc ? 'অটো: মোট টাকা ÷ পরিমাণ' : '');
      if (t) td.title = t; else td.removeAttribute('title');
      var inp = td.querySelector('input');
      if (inp) {
        var val = String(cellValue(row, c));
        if (inp.value !== val && document.activeElement !== inp) inp.value = val;
        if (c.calc) inp.value = val;
        var ed = cellEditable(row, c);
        if (ed) inp.removeAttribute('readonly'); else inp.setAttribute('readonly', '');
      }
    });
    var act = tr.querySelector('.accg-act');
    if (act) act.innerHTML = delBtnHtml(row, i);
    if (S.sel) paintSel();
  }

  function inputAt(r, c) {
    return document.querySelector('#accg-body input[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function growTo(r) {
    var list = S.rows[S.tab];
    if (readOnly() || filterOn() || r < list.length - 2) return;
    while (list.length <= r + 3) list.push(mkRow(S.tab, {}));
    var body = document.getElementById('accg-body');
    if (body) for (var n = body.children.length; n < list.length; n++) body.insertAdjacentHTML('beforeend', rowHtml(list[n], n));
  }

  function focusCell(r, c, select, keepSel) {
    var list = S.rows[S.tab];
    if (r < 0 || c < 0 || c >= cols().length) return false;
    growTo(r);
    if (r >= list.length) return false;
    var el = inputAt(r, c);
    if (!el) return false;
    if (!keepSel) S.sel = { ar: r, ac: c, fr: r, fc: c };
    S._focusing = true;
    el.focus();
    S._focusing = false;
    if (select) { try { el.select(); } catch (e) {} }
    paintSel();
    return true;
  }

  /* ছাঁকা চালু থাকলে লুকানো সারি টপকে পরের দেখা-সারি */
  function stepRow(i, dir) {
    var list = S.rows[S.tab];
    var k = i + dir;
    while (k >= 0 && k < list.length && !rowVisible(list[k])) k += dir;
    if (k < 0) return i;
    if (k >= list.length) return filterOn() ? i : k;
    return k;
  }

  /* ── বাছাই (range) ── */
  function selRange() {
    if (!S.sel) return null;
    return {
      r0: Math.min(S.sel.ar, S.sel.fr), r1: Math.max(S.sel.ar, S.sel.fr),
      c0: Math.min(S.sel.ac, S.sel.fc), c1: Math.max(S.sel.ac, S.sel.fc),
    };
  }
  function multiSel() {
    var r = selRange();
    return !!(r && (r.r0 !== r.r1 || r.c0 !== r.c1));
  }

  function paintSel() {
    var body = document.getElementById('accg-body');
    if (!body) return;
    var r = multiSel() ? selRange() : null;
    var olds = body.querySelectorAll('td.is-sel');
    for (var k = 0; k < olds.length; k++) olds[k].classList.remove('is-sel');
    if (r) {
      for (var i = r.r0; i <= r.r1; i++) for (var j = r.c0; j <= r.c1; j++) {
        var el = inputAt(i, j);
        if (el && el.parentNode) el.parentNode.classList.add('is-sel');
      }
    }
    var ss = document.getElementById('accg-selsum');
    if (ss) ss.innerHTML = selSummaryHtml();
  }

  function extendSel(dr, dc) {
    if (!S.sel) return;
    var list = S.rows[S.tab];
    var fr = dr ? stepRow(S.sel.fr, dr) : S.sel.fr;
    var fc = Math.max(0, Math.min(cols().length - 1, S.sel.fc + dc));
    if (fr >= list.length) fr = list.length - 1;
    S.sel.fr = fr; S.sel.fc = fc;
    var el = inputAt(fr, fc);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    paintSel();
  }

  function rangeTsv() {
    var r = selRange();
    if (!r) return '';
    var lines = [];
    for (var i = r.r0; i <= r.r1; i++) {
      var row = S.rows[S.tab][i];
      if (!row || !rowVisible(row)) continue;
      var cells = [];
      for (var j = r.c0; j <= r.c1; j++) cells.push(String(cellValue(row, cols()[j])).replace(/[\t\n\r]+/g, ' '));
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  /* ── Undo / Redo — ট্যাবের সব সারির অবস্থার ছবি ── */
  function snapshot(tab) {
    tab = tab || S.tab;
    return { tab: tab, items: S.rows[tab].map(function (r) { return { r: r, v: Object.assign({}, r.v), del: r.del }; }), sel: S.sel ? Object.assign({}, S.sel) : null };
  }
  function restore(snap) {
    S.tab = snap.tab;
    S.rows[snap.tab] = snap.items.map(function (it) { it.r.v = Object.assign({}, it.v); it.r.del = it.del; it.r.err = ''; return it.r; });
    S.sel = snap.sel;
  }
  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > UNDO_MAX) S.undo.shift();
    S.redo = [];
  }
  function undo() {
    if (!S.undo.length) { showToast('আর আগের অবস্থা নেই'); return; }
    var snap = S.undo.pop();
    S.redo.push(snapshot(snap.tab));
    restore(snap);
    S.edit = null;
    rerender();
  }
  function redo() {
    if (!S.redo.length) { showToast('আর পরের অবস্থা নেই'); return; }
    var snap = S.redo.pop();
    S.undo.push(snapshot(snap.tab));
    restore(snap);
    S.edit = null;
    rerender();
  }

  /* ── ঘরে লেখা বসানো (এক জায়গা থেকে) ── */
  function setCell(i, j, value) {
    var row = S.rows[S.tab][i];
    var c = cols()[j];
    if (!row || !c || !cellEditable(row, c)) return false;
    var wasEmpty = isEmpty(row);
    row.v[c.k] = value;
    row.err = '';
    if (wasEmpty && String(value).trim()) carryDefaults(i);
    return true;
  }

  /* নতুন সারিতে প্রথম লেখা — উপরের সারি থেকে শুধু বিভাগ (ও করজের ধরন); দিন সবসময় নিজে লিখতে হয় */
  function carryDefaults(i) {
    var list = S.rows[S.tab];
    var row = list[i];
    if (row.orig) return;
    var prev = null;
    for (var k = i - 1; k >= 0; k--) { if (!list[k].del && !isEmpty(list[k])) { prev = list[k]; break; } }
    var keys = S.tab === 'qard' ? ['kind'] : (S.tab === 'income' ? [] : ['book']);
    keys.forEach(function (key) {
      if (String(row.v[key] || '').trim()) return;
      var val = prev ? prev.v[key] : '';
      if (!val && key === 'kind') val = 'দেওয়া';
      if (!val) return;
      row.v[key] = val;
      var j = cols().findIndex(function (c) { return c.k === key; });
      var el = inputAt(i, j);
      if (el) el.value = val;
    });
  }

  function afterCellChange(i) {
    var list = S.rows[S.tab];
    if (i >= list.length - 3 && !filterOn()) {
      while (list.length <= i + BLANK_ROWS) list.push(mkRow(S.tab, {}));
      var body = document.getElementById('accg-body');
      if (body) for (var n = body.children.length; n < list.length; n++) body.insertAdjacentHTML('beforeend', rowHtml(list[n], n));
    }
    refreshRow(i);
    refreshChrome();
  }

  function onInput(e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) {
      if (el.id === 'accg-q') onSearch(el.value);
      return;
    }
    var i = Number(el.getAttribute('data-r')), j = Number(el.getAttribute('data-c'));
    var row = S.rows[S.tab][i];
    if (!row || !cellEditable(row, cols()[j])) return;
    if (!S.edit || S.edit.r !== i || S.edit.c !== j) S.edit = { r: i, c: j, start: String(row.v[cols()[j].k] == null ? '' : row.v[cols()[j].k]), pushed: false };
    if (!S.edit.pushed) { pushUndo(); S.edit.pushed = true; }
    setCell(i, j, el.value);
    afterCellChange(i);
    if (cols()[j].list) openDD(i, j, el.value);
  }

  /* বাছাই করা ঘরগুলো খালি (Delete / Backspace / Ctrl+X) */
  function clearRange() {
    var r = selRange();
    if (!r || readOnly()) return;
    pushUndo();
    var n = 0;
    for (var i = r.r0; i <= r.r1; i++) {
      var row = S.rows[S.tab][i];
      if (!row || !rowVisible(row)) continue;
      for (var j = r.c0; j <= r.c1; j++) {
        if (!cellEditable(row, cols()[j])) continue;
        if (String(row.v[cols()[j].k] || '') !== '') { row.v[cols()[j].k] = ''; row.err = ''; n++; }
      }
    }
    if (!n) { S.undo.pop(); return; }
    rerender();
  }

  /* Ctrl+D: বাছাইয়ের উপরের সারির লেখা নিচের সারিগুলোতে; এক ঘর হলে উপরের সারি থেকে */
  function fillDown() {
    if (readOnly() || !S.sel) return;
    var r = selRange();
    var list = S.rows[S.tab];
    var srcRow = r.r0, from = r.r0 + 1, to = r.r1;
    if (r.r0 === r.r1) {
      srcRow = stepRow(r.r0, -1);
      if (srcRow === r.r0) return;
      from = r.r0; to = r.r0;
    }
    var src = list[srcRow];
    if (!src) return;
    pushUndo();
    var n = 0;
    for (var i = from; i <= to; i++) {
      var row = list[i];
      if (!row || !rowVisible(row)) continue;
      for (var j = r.c0; j <= r.c1; j++) {
        var c = cols()[j];
        if (!cellEditable(row, c)) continue;
        if (setCell(i, j, src.v[c.k] == null ? '' : src.v[c.k])) n++;
      }
    }
    if (!n) { S.undo.pop(); return; }
    padBlank(list);
    rerender();
  }

  /* ── তালিকার ড্রপডাউন ── */
  function ddEl() { return document.getElementById('accg-dd'); }
  function closeDD() {
    S.dd = null;
    var dd = ddEl();
    if (dd) { dd.hidden = true; dd.innerHTML = ''; }
  }
  function openDD(i, j, text, showAll) {
    var c = cols()[j];
    var row = S.rows[S.tab][i];
    if (!c || !c.list || !row || !cellEditable(row, c)) { closeDD(); return; }
    var all = lists()[c.list] || [];
    var q = showAll ? '' : norm(text);
    var items = (q ? all.filter(function (x) { return norm(x).indexOf(q) >= 0; }) : all.slice()).slice(0, 60);
    if (!items.length || (items.length === 1 && norm(items[0]) === q)) { closeDD(); return; }
    var hi = q ? 0 : -1;
    S.dd = { r: i, c: j, items: items, hi: hi };
    paintDD();
  }
  function paintDD() {
    var dd = ddEl();
    var el = S.dd && inputAt(S.dd.r, S.dd.c);
    if (!dd || !el) { closeDD(); return; }
    dd.innerHTML = S.dd.items.map(function (x, k) {
      return '<div class="accg-dd-it' + (k === S.dd.hi ? ' is-hi' : '') + '" data-k="' + k + '">' + esc(x) + '</div>';
    }).join('');
    var rc = _zr(el);
    dd.style.left = Math.round(rc.left) + 'px';
    dd.style.minWidth = Math.max(140, Math.round(rc.width)) + 'px';
    var below = _zh() - rc.bottom;
    if (below < 180 && rc.top > below) { dd.style.top = ''; dd.style.bottom = Math.round(_zh() - rc.top + 2) + 'px'; }
    else { dd.style.bottom = ''; dd.style.top = Math.round(rc.bottom + 2) + 'px'; }
    dd.hidden = false;
    var hiEl = dd.querySelector('.is-hi');
    if (hiEl && hiEl.scrollIntoView) hiEl.scrollIntoView({ block: 'nearest' });
  }
  function acceptDD(k) {
    if (!S.dd) return;
    var val = S.dd.items[k];
    var i = S.dd.r, j = S.dd.c;
    closeDD();
    if (val == null) return;
    var row = S.rows[S.tab][i];
    if (!row) return;
    if (String(row.v[cols()[j].k] || '') !== val) {
      if (!S.edit || S.edit.r !== i || S.edit.c !== j || !S.edit.pushed) {
        S.edit = { r: i, c: j, start: String(row.v[cols()[j].k] || ''), pushed: true };
        pushUndo();
      }
      setCell(i, j, val);
    }
    var el = inputAt(i, j);
    if (el) el.value = val;
    afterCellChange(i);
  }

  /* ── কিবোর্ড ── */
  function onKey(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var key = e.key;
    var el = e.target;
    if (el && el.id === 'accg-q') {
      if (key === 'Escape') { e.preventDefault(); clearFilter(); }
      return;
    }
    if (ctrl && (key === 's' || key === 'S')) { e.preventDefault(); if (!readOnly()) saveGrid(); return; }
    if (!el.classList || !el.classList.contains('accg-in')) return;
    var i = Number(el.getAttribute('data-r')), j = Number(el.getAttribute('data-c'));

    if (S.dd) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        var n = S.dd.items.length;
        S.dd.hi = key === 'ArrowDown' ? Math.min(n - 1, S.dd.hi + 1) : Math.max(0, S.dd.hi - 1);
        paintDD();
        return;
      }
      if ((key === 'Enter' || key === 'Tab') && S.dd.hi >= 0) acceptDD(S.dd.hi);
      else if (key === 'Escape') { e.preventDefault(); closeDD(); return; }
      else if (key === 'Enter' || key === 'Tab') closeDD();
    }

    if (ctrl && !e.altKey && (key === 'z' || key === 'Z') && !e.shiftKey) { e.preventDefault(); if (!readOnly()) undo(); return; }
    if (ctrl && ((key === 'y' || key === 'Y') || ((key === 'z' || key === 'Z') && e.shiftKey))) { e.preventDefault(); if (!readOnly()) redo(); return; }
    if (ctrl && (key === 'd' || key === 'D')) { e.preventDefault(); fillDown(); return; }
    if (e.altKey && key === 'ArrowDown' && cols()[j].list) { e.preventDefault(); openDD(i, j, '', true); return; }

    if (key === 'Escape') {
      e.preventDefault();
      var row = S.rows[S.tab][i];
      if (S.edit && S.edit.r === i && S.edit.c === j && row && el.value !== S.edit.start) {
        row.v[cols()[j].k] = S.edit.start;
        el.value = S.edit.start;
        if (S.edit.pushed) { S.undo.pop(); S.edit.pushed = false; }
        row.err = '';
        afterCellChange(i);
        try { el.select(); } catch (e2) {}
      }
      return;
    }
    if ((key === 'Delete' || key === 'Backspace') && multiSel()) { e.preventDefault(); clearRange(); return; }

    if (e.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      extendSel(key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0, key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0);
      return;
    }

    var len = String(el.value || '').length;
    var atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    var atEnd = el.selectionStart === len && el.selectionEnd === len;
    var whole = el.selectionStart === 0 && el.selectionEnd === len;
    if (key === 'Enter') { e.preventDefault(); focusCell(stepRow(i, e.shiftKey ? -1 : 1), j, true); }
    else if (key === 'Tab') {
      e.preventDefault();
      var nc = j + (e.shiftKey ? -1 : 1);
      while (nc >= 0 && nc < cols().length && cols()[nc].calc) nc += e.shiftKey ? -1 : 1;
      if (nc >= cols().length) focusCell(stepRow(i, 1), 0, true);
      else if (nc < 0) { var pr = stepRow(i, -1); if (pr !== i) focusCell(pr, cols().length - 1, true); }
      else focusCell(i, nc, true);
    }
    else if (key === 'ArrowDown') { e.preventDefault(); focusCell(stepRow(i, 1), j, true); }
    else if (key === 'ArrowUp') { e.preventDefault(); focusCell(stepRow(i, -1), j, true); }
    else if (key === 'ArrowRight' && (atEnd || whole || el.readOnly)) { e.preventDefault(); focusCell(i, j + 1, true); }
    else if (key === 'ArrowLeft' && (atStart || whole || el.readOnly)) { e.preventDefault(); focusCell(i, j - 1, true); }
  }

  function onFocusIn(e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) return;
    var i = Number(el.getAttribute('data-r')), j = Number(el.getAttribute('data-c'));
    var row = S.rows[S.tab][i];
    var prevRow = S.edit ? S.edit.r : -1;
    if (!S.edit || S.edit.r !== i || S.edit.c !== j) S.edit = { r: i, c: j, start: row ? String(row.v[cols()[j].k] == null ? '' : row.v[cols()[j].k]) : '', pushed: false };
    if (prevRow >= 0 && prevRow !== i) { refreshRow(prevRow); refreshChrome(); }
    if (!S._focusing && !S.drag) { S.sel = { ar: i, ac: j, fr: i, fc: j }; paintSel(); }
    if (S.dd && (S.dd.r !== i || S.dd.c !== j)) closeDD();
  }

  /* ── মাউস: টেনে বাছাই, Shift+ক্লিক ── */
  function cellFromPoint(target) {
    var inp = target && target.closest ? target.closest('#accg-body td') : null;
    inp = inp && inp.querySelector('input.accg-in');
    if (!inp) return null;
    return { r: Number(inp.getAttribute('data-r')), c: Number(inp.getAttribute('data-c')), el: inp };
  }
  function onMouseDown(e) {
    if (e.button !== 0) return;
    var cell = cellFromPoint(e.target);
    if (!cell) return;
    if (e.shiftKey && S.sel) {
      e.preventDefault();
      S.sel.fr = cell.r; S.sel.fc = cell.c;
      paintSel();
      return;
    }
    S.drag = { r: cell.r, c: cell.c, moved: false };
    var wasFocused = document.activeElement === cell.el;
    S.sel = { ar: cell.r, ac: cell.c, fr: cell.r, fc: cell.c };
    /* Excel-এর মতো: প্রথম ক্লিকে পুরো ঘর বাছাই (লিখলে বদলে যায়); একই ঘরে আবার ক্লিক = লেখার ভেতরে কার্সর */
    if (!wasFocused) { e.preventDefault(); focusCell(cell.r, cell.c, true, true); }
    paintSel();
    if (wasFocused && cols()[cell.c].list) {
      if (S.dd) closeDD(); else openDD(cell.r, cell.c, '', true);
    }
  }
  function onMouseMove(e) {
    if (!S.drag || !(e.buttons & 1)) return;
    var cell = cellFromPoint(e.target);
    if (!cell) return;
    if (cell.r === S.drag.r && cell.c === S.drag.c && !S.drag.moved) return;
    e.preventDefault();
    S.drag.moved = true;
    S.sel = { ar: S.drag.r, ac: S.drag.c, fr: cell.r, fc: cell.c };
    try { window.getSelection().removeAllRanges(); } catch (er) {}
    var a = inputAt(S.drag.r, S.drag.c);
    if (a && document.activeElement !== a) { S._focusing = true; a.focus(); S._focusing = false; }
    closeDD();
    paintSel();
  }
  function onMouseUp() {
    if (S.drag && S.drag.moved) {
      var a = inputAt(S.sel.ar, S.sel.ac);
      if (a) { try { a.setSelectionRange(a.value.length, a.value.length); } catch (er) {} }
    }
    S.drag = null;
  }

  /* ── কপি / কাট / পেস্ট ── */
  function onCopy(e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) return;
    if (!multiSel()) return; /* এক ঘর — ব্রাউজারের স্বাভাবিক কপি */
    e.preventDefault();
    (e.clipboardData || window.clipboardData).setData('text/plain', rangeTsv());
    showToast('কপি হয়েছে — Excel-এ বা শীটের অন্য ঘরে পেস্ট করুন');
  }
  function onCut(e) {
    if (!multiSel()) return;
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) return;
    e.preventDefault();
    (e.clipboardData || window.clipboardData).setData('text/plain', rangeTsv());
    clearRange();
  }

  function onPaste(e) {
    var el = e.target;
    if (readOnly() || !el.classList || !el.classList.contains('accg-in')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (text == null) return;
    var multiLine = text.indexOf('\t') >= 0 || text.replace(/\r?\n$/, '').indexOf('\n') >= 0;
    var list = S.rows[S.tab];
    var cs = cols();
    /* এক ঘরের লেখা, কয়েক ঘর বাছাই করা — সব ঘরে একই লেখা */
    if (!multiLine && multiSel()) {
      e.preventDefault();
      var v = text.replace(/\r?\n$/, '').trim();
      var rg = selRange();
      pushUndo();
      for (var i0 = rg.r0; i0 <= rg.r1; i0++) {
        if (!list[i0] || !rowVisible(list[i0])) continue;
        for (var j0 = rg.c0; j0 <= rg.c1; j0++) setCell(i0, j0, v);
      }
      padBlank(list);
      rerender();
      return;
    }
    if (!multiLine) return; /* এক ঘরের লেখা — স্বাভাবিক পেস্ট (onInput ধরে) */
    e.preventDefault();
    var lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var r0 = Number(el.getAttribute('data-r')), c0 = Number(el.getAttribute('data-c'));
    var skipped = 0, filled = 0;
    pushUndo();
    lines.forEach(function (line, a) {
      var r = r0 + a;
      while (list.length <= r) list.push(mkRow(S.tab, {}));
      var row = list[r];
      if (row.locked || row.del) { skipped++; return; }
      line.split('\t').forEach(function (cell, b) {
        var c = cs[c0 + b];
        if (!c || c.calc || (c.k === 'kind' && row.orig)) return;
        row.v[c.k] = cell.trim();
      });
      row.err = '';
      filled++;
    });
    if (!filled) S.undo.pop();
    padBlank(list);
    S.sel = { ar: r0, ac: c0, fr: Math.min(list.length - 1, r0 + lines.length - 1), fc: Math.min(cs.length - 1, c0 + Math.max.apply(null, lines.map(function (l) { return l.split('\t').length; })) - 1) };
    S.focus = { r: r0, c: c0 };
    rerender();
    showToast(bn(filled) + 'টি সারিতে পেস্ট হয়েছে' + (skipped ? ' · ' + bn(skipped) + 'টি তালাবদ্ধ সারি বাদ' : ''));
  }

  function onClick(e) {
    var dd = e.target.closest ? e.target.closest('.accg-dd-it') : null;
    if (dd) return;
    var t = e.target.closest ? e.target.closest('[data-tab],[data-del],[data-day]') : null;
    if (!t) return;
    if (t.hasAttribute('data-tab')) {
      S.tab = t.getAttribute('data-tab');
      S.sel = null; S.edit = null;
      S.filter = { q: '', day: '' };
      rerender(false);
      return;
    }
    if (t.hasAttribute('data-day')) {
      var d = t.getAttribute('data-day');
      S.filter.day = S.filter.day === d ? '' : d;
      S.sel = null;
      rerender(false);
      return;
    }
    var i = Number(t.getAttribute('data-del'));
    var row = S.rows[S.tab][i];
    if (!row) return;
    pushUndo();
    if (!row.orig) { S.rows[S.tab].splice(i, 1); padBlank(S.rows[S.tab]); S.sel = null; rerender(false); return; }
    row.del = !row.del;
    row.err = '';
    rerender(false);
  }

  /* ── খোঁজা ── */
  function onSearch(v) {
    S.filter.q = String(v || '').trim();
    S.sel = null;
    var root = document.getElementById('accounts-root');
    var body = document.getElementById('accg-body');
    if (!root || !body) return;
    S.rows[S.tab].forEach(function (row, i) {
      var tr = body.querySelector('tr[data-row="' + i + '"]');
      if (tr) tr.classList.toggle('is-hidden', !rowVisible(row));
    });
    var tools = root.querySelector('.accg-tools');
    var hasClear = !!root.querySelector('#accg-clearf');
    if (tools && filterOn() !== hasClear) {
      if (filterOn()) tools.insertAdjacentHTML('beforeend', '<button type="button" class="accg-btn accg-clearf" id="accg-clearf">ছাঁকা মুছুন</button>');
      else { var b = root.querySelector('#accg-clearf'); if (b) b.remove(); }
    }
    refreshChrome();
    paintSel();
  }
  function clearFilter() {
    S.filter = { q: '', day: '' };
    S.sel = null;
    rerender(false);
  }

  async function onMonthChange() {
    var m = Number(document.getElementById('accg-month').value);
    var y = Number(document.getElementById('accg-year').value);
    if (dirtyCount() && !await MMUI.confirm('সংরক্ষণ না করা পরিবর্তন বাদ যাবে। মাস বদলাবেন?')) {
      document.getElementById('accg-month').value = String(S.monthNo);
      document.getElementById('accg-year').value = String(S.year);
      return;
    }
    S.monthNo = m; S.year = y; S.rows = null;
    rerender(false);
  }

  function wireButtons(root) {
    var save = root.querySelector('#accg-save'), reset = root.querySelector('#accg-reset');
    var u = root.querySelector('#accg-undo'), r = root.querySelector('#accg-redo'), cf = root.querySelector('#accg-clearf');
    if (save) save.onclick = saveGrid;
    if (reset) reset.onclick = resetGrid;
    if (u) u.onclick = undo;
    if (r) r.onclick = redo;
    if (cf) cf.onclick = clearFilter;
  }

  function wire(root) {
    var ws = root.querySelector('.accg-ws');
    if (!ws) return;
    ws.addEventListener('input', onInput);
    ws.addEventListener('keydown', onKey);
    ws.addEventListener('paste', onPaste);
    ws.addEventListener('copy', onCopy);
    ws.addEventListener('cut', onCut);
    ws.addEventListener('click', onClick);
    ws.addEventListener('focusin', onFocusIn);
    ws.addEventListener('mousedown', onMouseDown);
    ws.addEventListener('mousemove', onMouseMove);
    var dd = ws.querySelector('#accg-dd');
    if (dd) dd.addEventListener('mousedown', function (e) {
      var it = e.target.closest('.accg-dd-it');
      e.preventDefault(); /* ঘরের ফোকাস না হারাক */
      if (it) acceptDD(Number(it.getAttribute('data-k')));
    });
    var wrap = ws.querySelector('#accg-wrap');
    if (wrap) wrap.addEventListener('scroll', function () { if (S.dd) paintDD(); }, { passive: true });
    var mSel = root.querySelector('#accg-month'), ySel = root.querySelector('#accg-year');
    if (mSel) mSel.onchange = onMonthChange;
    if (ySel) ySel.onchange = onMonthChange;
    wireButtons(root);
  }

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousedown', function (e) {
    if (S.dd && !(e.target.closest && (e.target.closest('#accg-dd') || e.target.closest('#accg-body td.has-list')))) closeDD();
  });
  window.addEventListener('resize', function () { if (S.dd) paintDD(); });

  async function resetGrid() {
    if (dirtyCount() && !await MMUI.confirm('সংরক্ষণ না করা সব পরিবর্তন বাদ দেবেন?')) return;
    S.rows = null;
    rerender(false);
  }

  /* ── সংরক্ষণ: Excel আপলোডের একই পার্সার → এক atomic batch ── */
  function dateCell(row) {
    var d = parseInt(toEn(row.v.day), 10);
    if (!d || d < 1 || d > 30) return null;
    return S.year + '-' + String(S.monthNo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function parseTab(t, changed) {
    var c = core();
    var cs = cols(t).filter(function (col) { return !col.calc; });
    var header = cs.map(function (col) { return col.k === 'day' ? 'তারিখ' : col.h; });
    var matrix = [header];
    var src = [];
    changed.forEach(function (row) {
      var dc = dateCell(row);
      if (!dc) { row.err = 'দিন (১–৩০) লিখুন'; return; }
      matrix.push(cs.map(function (col) { return col.k === 'day' ? dc : String(row.v[col.k] == null ? '' : row.v[col.k]).trim(); }));
      src.push(row);
    });
    var parsed;
    if (t === 'expense') parsed = c.parseExpense(matrix, 'শীট-ব্যয়');
    else if (t === 'income') parsed = c.parseIncome(matrix, 'শীট-আয়');
    else if (t === 'payment') parsed = c.parsePayment(matrix, 'শীট-পরিশোধ');
    else { var q = c.parseQard(matrix, 'শীট-করজ'); parsed = q.give.concat(q.ret); }
    var out = [];
    parsed.forEach(function (pr) {
      var row = src[pr.line - 2];
      if (!row) return;
      if (pr.status !== 'ok' || !pr.data) { row.err = pr.msg || 'সারিটি বোঝা যায়নি'; return; }
      var newKind = pr.kind === 'qardReturn' ? 'return' : (pr.kind === 'qardGive' ? 'give' : row.origKind);
      if (row.orig && t === 'qard' && newKind !== row.origKind) { row.err = 'পুরনো করজের ধরন বদলানো যায় না — সারি মুছে নতুন লিখুন'; return; }
      var d = pr.data;
      if (row.orig) {
        d.id = row.orig.id;
        if (t === 'income' && row.orig.account) d.account = row.orig.account;
        ['sourceFile', 'sourceSheet', 'sourceRow'].forEach(function (k) { if (row.orig[k] != null && row.orig[k] !== '') d[k] = row.orig[k]; });
        pr.status = 'upd';
        pr.prev = row.orig;
      } else {
        d.id = 'grd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
      }
      pr.gridRow = row;
      out.push(pr);
    });
    return out;
  }

  /* সার্ভার থেকে মাসটা আবার এনে দেখা — অন্য ডিভাইস থেকে বদলালে জানানো */
  async function checkConflict() {
    if (!A.remoteReady || !A.remoteReady()) return true;
    try { await A.bootstrapRemote({ force: true }); } catch (e) { return true; }
    if (monthSig() === S.sig) return true;
    var ids = {};
    var m = monthEntries();
    m.exp.concat(m.inc, m.pays).forEach(function (e) { ids[e.id] = 1; });
    var gone = 0;
    TAB_ORDER.forEach(function (t) {
      S.rows[t].forEach(function (row) {
        if (row.orig && isChanged(row, t) && !ids[row.orig.id]) { row.err = 'এই এন্ট্রি অন্য ডিভাইস থেকে মুছে ফেলা হয়েছে'; gone++; }
      });
    });
    S.lists = null;
    if (gone) return false;
    var ok = await MMUI.confirm('এই মাসের হিসাব শীট খোলার পর অন্য কোনো ডিভাইস থেকে বদলানো হয়েছে।\n\n' +
      'তবুও আপনার পরিবর্তন সংরক্ষণ করবেন? «এখন নয়» চাপলে কিছু সংরক্ষণ হবে না; পরে «বাতিল» বোতাম চাপলে নতুন অবস্থা দেখাবে।',
      { ok: 'তবুও সংরক্ষণ করুন', cancel: 'এখন নয়', danger: false });
    if (ok) S.sig = monthSig();
    return ok;
  }

  async function saveGrid() {
    if (S.busy || readOnly()) { if (readOnly()) showToast(core().lockMsg ? core().lockMsg() : 'এখানে বদলানো যায় না'); return; }
    closeDD();
    S.edit = null;
    var all = [], dels = [];
    TAB_ORDER.forEach(function (t) {
      var changed = [];
      S.rows[t].forEach(function (row) {
        row.err = '';
        if (!isChanged(row, t)) return;
        if (row.del) { dels.push({ t: t, row: row }); return; }
        changed.push(row);
      });
      if (changed.length) all = all.concat(parseTab(t, changed));
    });
    if (core().checkDues) core().checkDues(all);
    all.forEach(function (pr) { if (pr.status === 'err' && pr.gridRow) pr.gridRow.err = pr.msg || 'সমস্যা'; });
    var bad = errRows().concat(badRows());
    if (bad.length) {
      S.tab = bad[0].t;
      S.filter = { q: '', day: '' };
      S.focus = { r: bad[0].i, c: 0 };
      S.sel = null;
      rerender();
      showToast(bn(bad.length) + 'টি সারিতে সমস্যা — লাল ঘর / ⚠ চিহ্নিত সারি ঠিক করুন, কিছুই সংরক্ষণ হয়নি');
      return;
    }
    if (!all.length && !dels.length) { showToast('সংরক্ষণের মতো কোনো পরিবর্তন নেই'); return; }
    if (dels.length && !await MMUI.confirm(bn(dels.length) + 'টি সারি মুছে যাবে। চালিয়ে যাবেন?')) return;
    if (!A.remoteReady || !A.remoteReady()) { showToast('সার্ভার সংযোগ নেই — নেট/লগইন দেখে আবার চেষ্টা করুন'); return; }

    S.busy = true;
    refreshChrome();
    var proceed = await checkConflict();
    if (!proceed) {
      S.busy = false;
      rerender();
      showToast(errRows().length ? 'কিছু এন্ট্রি অন্য ডিভাইস থেকে মুছে গেছে — ⚠ সারি দেখুন, কিছুই সংরক্ষণ হয়নি'
        : 'সংরক্ষণ করা হয়নি — «বাতিল» চাপলে নতুন অবস্থা আসবে');
      return;
    }
    try {
      if (all.length) {
        var expList = [], incList = [], payList = [], cats = [];
        all.forEach(function (pr) {
          if (pr.kind === 'payment') payList.push(pr.data);
          else if (pr.kind === 'income' || pr.kind === 'qardReturn') incList.push(pr.data);
          else {
            expList.push(pr.data);
            var c = core().normTxt ? core().normTxt(pr.data.category) : pr.data.category;
            if (c && pr.data.account !== 'qard' && cats.indexOf(c) < 0) cats.push(c);
          }
        });
        var sum = function (l) { return l.reduce(function (s, e) { return s + Number(e.amount || 0); }, 0); };
        var expected = { expenseCount: expList.length, incomeCount: incList.length, paymentCount: payList.length, expenseTotal: sum(expList), incomeTotal: sum(incList), paymentTotal: sum(payList) };
        var res = await A.importBatch({ source: 'grid', expenses: expList, incomes: incList, payments: payList, categories: cats, expected: expected });
        var act = (res && res.reconciliation) || {};
        if (Number(act.expenseCount) !== expected.expenseCount || Number(act.incomeCount) !== expected.incomeCount || Number(act.paymentCount) !== expected.paymentCount) {
          throw new Error('reconciliation');
        }
      }
      var delFail = 0;
      for (var k = 0; k < dels.length; k++) {
        var o = dels[k].row.orig;
        try {
          if (dels[k].row.origKind === 'income' || dels[k].row.origKind === 'return') await A.Income.del(o.id);
          else {
            var r = await A.Expense.del(o.id);
            if (o.paymentMethod === 'due' && o.supplier && o.account !== 'qard' && !(r && r.dues_adjusted)) {
              await A.Dues.cancelPurchase(o.supplier, o.account, Number(o.amount || 0));
            }
          }
        } catch (e2) { delFail++; console.warn('[AccSheet] delete failed', e2); }
      }
      try { await A.bootstrapRemote({ force: true }); } catch (e3) {}
      S.busy = false;
      S.rows = null;
      rerender(false);
      showToast(delFail ? bn(delFail) + 'টি সারি মোছা যায়নি — বাকি সব সংরক্ষিত'
        : bn(all.length + dels.length) + 'টি পরিবর্তন ডাটাবেজে সংরক্ষিত ✓');
    } catch (err) {
      console.warn('[AccSheet] save failed', err);
      S.busy = false;
      var m = String((err && (err.message || err.details)) || err || '');
      var sm = m.match(/payment_exceeds_due:\s*(.+)/) || m.match(/payment_due_not_found:\s*(.+)/);
      var msg = /excel_mode/.test(m) ? 'হিসাব এখন Excel মোডে — অ্যাপে লেখা বন্ধ (জিম্মাদার বদলাতে পারেন)'
        : sm ? '«' + sm[1].trim() + '»-এর পরিশোধ বাকির চেয়ে বেশি বা বাকি পাওয়া যায়নি'
        : /purchase_total_below_existing_payments/.test(m) ? 'কোনো সরবরাহকারীর কেনা তাঁর পরিশোধের চেয়ে কমে যাচ্ছে'
        : 'সংরক্ষণ হয়নি — নেট দেখে আবার চেষ্টা করুন';
      if (/excel_mode/.test(m)) { try { await A.bootstrapRemote({ force: true }); } catch (e4) {} }
      rerender();
      showToast('কিছুই সংরক্ষণ হয়নি — ' + msg);
    }
  }

  window.closeAccGridSafe = async function () {
    if (dirtyCount() && !await MMUI.confirm('সংরক্ষণ না করা পরিবর্তন বাদ যাবে। শীট বন্ধ করবেন?')) return;
    S.rows = null;
    closeDD();
    if (typeof window.closeAccGrid === 'function') window.closeAccGrid();
  };

  window.renderAccSheet = function (root) {
    render(root);
  };

  window.addEventListener('beforeunload', function (e) {
    if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; }
  });

  var _css = false;
  function injectCss() {
    if (_css) return;
    _css = true;
    var st = document.createElement('style');
    st.textContent = [
      '.accg-ws{display:flex;flex-direction:column;gap:8px}',
      '.accg-month{display:flex;gap:6px;margin-left:auto}',
      '.accg-month select{height:34px;border:1px solid var(--cream2);border-radius:10px;background:#fff;padding:0 8px;font-family:inherit;font-size:13px;color:var(--ink)}',
      '.accg-tabs{display:flex;gap:6px;flex-wrap:wrap}',
      '.accg-tab{height:34px;padding:0 12px;border:1px solid var(--cream2);border-radius:10px;background:#fff;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink2);cursor:pointer}',
      '.accg-tab span{font-weight:600;color:var(--ink3)}',
      '.accg-tab i{font-style:normal;color:#c2410c;margin-left:4px;font-size:11px}',
      '.accg-tab.active{background:var(--sel-bg);color:var(--sel-fg);border-color:var(--sel-line)}',
      '.accg-tab.has-err{border-color:#e0a39a}',
      '.accg-note{font-size:11.5px;color:var(--ink3);line-height:1.6}',
      '.accg-note.is-ro{padding:8px 10px;border-radius:10px;background:var(--blue-light,#e8f1f7);color:var(--ink2)}',
      '.accg-note.is-filter{padding:6px 10px;border-radius:10px;background:#fff6dc;color:#8a5a00}',
      '.accg-tools{display:flex;gap:8px;align-items:center}',
      '.accg-q{flex:1;min-width:0;height:34px;border:1px solid var(--cream2);border-radius:10px;background:#fff;padding:0 10px;font-family:inherit;font-size:13px;color:var(--ink);outline:none}',
      '.accg-q:focus{border-color:#c9a227}',
      '.accg-clearf{height:34px}',
      '.accg-days{display:flex;gap:5px;flex-wrap:wrap;align-items:center}',
      '.accg-days:empty{display:none}',
      '.accg-days-lbl{font-size:11px;color:var(--ink3);margin-right:2px}',
      '.accg-day{height:24px;padding:0 8px;border:1px solid var(--cream2);border-radius:999px;background:#fff;font-family:inherit;font-size:11px;color:var(--ink2);cursor:pointer;white-space:nowrap}',
      '.accg-day.active{background:var(--sel-bg);color:var(--sel-fg);border-color:var(--sel-line)}',
      '.accg-wrap{overflow:auto;max-height:calc(100vh - 330px);min-height:260px;border:1px solid var(--cream2);border-radius:12px;background:#fff;-webkit-overflow-scrolling:touch}',
      '.accg-table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%;font-size:13px}',
      '.accg-table thead th{position:sticky;top:0;z-index:2;background:#f6f1e7;color:var(--ink2);font-size:11.5px;font-weight:800;text-align:left;padding:7px 6px;border-bottom:1px solid var(--cream2);border-right:1px solid #eee5d5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.accg-table thead th.is-calc{color:var(--ink3);font-weight:700}',
      '.accg-table td{padding:0;border-bottom:1px solid #f0e9dc;border-right:1px solid #f0e9dc;position:relative}',
      '.accg-no{position:sticky;left:0;z-index:1;background:#faf7f0;color:var(--ink3);font-size:11px;font-weight:700;text-align:center;padding:0 2px;border-bottom:1px solid #f0e9dc;border-right:1px solid var(--cream2);white-space:nowrap}',
      '.accg-table thead .accg-no{z-index:3}',
      '.accg-mark{display:block;font-size:10px;line-height:1}',
      '.accg-in{width:100%;height:32px;border:none;background:transparent;padding:0 6px;font-family:inherit;font-size:13px;color:var(--ink);outline:none;box-sizing:border-box}',
      '.accg-in.is-num{text-align:right;font-variant-numeric:tabular-nums}',
      '.accg-in:focus{background:#fffbe8;box-shadow:inset 0 0 0 2px #c9a227}',
      '.accg-in[readonly]{color:var(--ink2);cursor:default}',
      'td.is-calc{background:#faf8f3}',
      'td.is-calc .accg-in{color:var(--ink3);font-style:italic}',
      'td.has-list .accg-in{padding-right:16px}',
      'td.has-list::after{content:"▾";position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:9px;color:var(--ink3);pointer-events:none;opacity:0}',
      '.accg-row:hover td.has-list::after,td.has-list:focus-within::after{opacity:.65}',
      '.accg-row.is-dirty td{background:#fff8ec}',
      '.accg-row.is-dirty .accg-mark{color:#c2410c}',
      '.accg-row.is-err .accg-no{background:#fdecea}',
      '.accg-row.is-err .accg-mark{color:#b42318}',
      '.accg-row.is-locked td{background:#f7f5f1}',
      '.accg-row.is-del td .accg-in{text-decoration:line-through;color:#b42318}',
      '.accg-row.is-hidden{display:none}',
      '.accg-table td.is-bad{background:#fdecea !important;box-shadow:inset 0 0 0 1px #e8a29a}',
      '.accg-table td.is-warn{background:#fff6dc !important}',
      '.accg-table td.is-sel{background:#e6efff !important;box-shadow:inset 0 0 0 1px #9db8e8}',
      '.accg-act{text-align:center}',
      '.accg-del{width:26px;height:26px;border:none;background:transparent;color:var(--ink3);cursor:pointer;border-radius:8px;font-size:12px}',
      '.accg-del:hover{background:#fdecea;color:#b42318}',
      '.accg-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:4px 2px}',
      '.accg-sum{font-size:12.5px;color:var(--ink2)}',
      '.accg-selsum{font-size:12px;color:#1e4fa3;margin-top:2px;min-height:16px}',
      '.accg-dirty{color:#c2410c;font-weight:700}',
      '.accg-errtxt{color:#b42318;font-weight:700}',
      '.accg-btns{display:flex;gap:8px}',
      '.accg-btn{height:38px;padding:0 16px;border-radius:11px;border:1px solid var(--cream2);background:#fff;font-family:inherit;font-size:13px;font-weight:800;color:var(--ink2);cursor:pointer}',
      '#accg-undo,#accg-redo{padding:0 12px;font-size:16px}',
      '.accg-btn.is-primary{background:var(--gold,#b8892b);border-color:transparent;color:#fff}',
      '.accg-btn[disabled]{opacity:.5;cursor:default}',
      '.accg-dd{position:fixed;z-index:500;max-height:220px;overflow-y:auto;background:#fff;border:1px solid var(--cream2);border-radius:10px;box-shadow:0 10px 28px rgba(42,35,24,.18);padding:4px 0;font-size:13px}',
      '.accg-dd[hidden]{display:none}',
      '.accg-dd-it{padding:6px 12px;cursor:pointer;white-space:nowrap;color:var(--ink)}',
      '.accg-dd-it:hover,.accg-dd-it.is-hi{background:#fff3cc}',
      '@media (max-width:640px){.accg-month{margin-left:0;width:100%}.accg-month select{flex:1}.accg-wrap{max-height:calc(100vh - 370px)}}',
    ].join('\n');
    document.head.appendChild(st);
  }
})();
