'use strict';
/* global MdrAccAPI, MdrAccSheetCore, showToast */

/*
 * হিসাব ▦ শীট — Excel-এর মতো ঘর-ঘর করে হিসাব লেখা (দফতরের টেমপ্লেটের একই কলাম)।
 *  - মাস বেছে নিলে সেই মাসের এন্ট্রি সারি হয়ে আসে; নিচে খালি সারিতে নতুন লেখা।
 *  - Enter = নিচের ঘর, Tab = ডানের ঘর, ↑↓ = সারি বদল, Ctrl+S = সংরক্ষণ।
 *  - Excel থেকে কয়েক সারি/কলাম কপি করে যেকোনো ঘরে পেস্ট করা যায়।
 *  - সংরক্ষণ = Excel আপলোডের একই পার্সার ও যাচাই (MdrAccSheetCore) + একই atomic সার্ভার batch
 *    (payload.source = 'grid' — Excel মোডে সার্ভার আটকায়)। হয় সব সারি যায়, নয়তো কোনোটাই না।
 *  - ২৪ ঘণ্টার পুরনো এন্ট্রি দফতরের জন্য তালাবদ্ধ (আগের নিয়ম) — বদলাতে সাধারণ এডিট/অনুমোদন।
 */
(function () {
  var A = MdrAccAPI;
  var esc = function (s) { return A.esc(s); };
  var bn = function (s) { return String(s == null ? '' : s).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }); };
  var fa = function (n) { return A.fa(n); };
  var toEn = function (s) { return String(s == null ? '' : s).replace(/[০-৯]/g, function (d) { return String('০১২৩৪৫৬৭৮৯'.indexOf(d)); }).trim(); };

  var BOOKS = ['মাতবাখ', 'মাদরাসা', 'তামিরাত', 'সাধারণ'];
  var UNITS = ['কেজি', 'গ্রাম', 'লিটার', 'মিলি', 'পিস', 'প্যাকেট', 'বস্তা', 'ডজন', 'ফুট', 'মিটার'];
  var BLANK_ROWS = 15;

  /* h = পার্সারের কলাম-নাম (টেমপ্লেটের মতো); দিন-কলাম পার্সারে «তারিখ» হয়ে যায় */
  var SHEETS = {
    expense: { label: 'ব্যয়', cols: [
      { k: 'book', h: 'হিসাব বিভাগ', w: 92, list: 'books' },
      { k: 'day', h: 'দিন', w: 46, num: true },
      { k: 'cat', h: 'খাত', w: 118, list: 'cats' },
      { k: 'desc', h: 'বিবরণ', w: 190 },
      { k: 'qty', h: 'পরিমাণ', w: 66, num: true },
      { k: 'unit', h: 'মাপ', w: 62, list: 'units' },
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

  var S = { tab: 'expense', year: 0, monthNo: 0, rows: null, busy: false, focus: null };

  function core() { return window.MdrAccSheetCore || {}; }
  function readOnly() { return !!(core().isReadOnly && core().isReadOnly()); }
  function cols() { return SHEETS[S.tab].cols; }
  function monthName() { return A.monthFromNo(S.monthNo); }
  function inMonth(e) { return A.dateKey(e.hijriYear, e.month, 1).slice(0, 7) === String(S.year).padStart(4, '0') + '-' + String(S.monthNo).padStart(2, '0'); }
  function numTxt(v) { var n = Number(v); return (v === null || v === undefined || v === '' || isNaN(n)) ? '' : bn(String(Math.round(n * 100) / 100)); }
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
    var cs = (SHEETS[sheet || row.sheet || S.tab] || SHEETS[S.tab]).cols;
    return cs.map(function (c) { return String(row.v[c.k] == null ? '' : row.v[c.k]).trim(); }).join('\u0001');
  }
  function isEmpty(row, sheet) { return !rowKey(row, sheet).replace(/\u0001/g, ''); }
  function isChanged(row, sheet) {
    if (row.del) return !!row.orig;
    if (!row.orig) return !isEmpty(row, sheet);
    return rowKey(row, sheet) !== row.base;
  }

  /* ── মাসের এন্ট্রি → সারি ── */
  function loadRows() {
    var lbl = A.ACCOUNT_LABELS || {};
    var exp = A.Expense.getAll().filter(inMonth).sort(sortEntries);
    var inc = A.Income.getAll().filter(inMonth).sort(sortEntries);
    var pays = (A.Dues.payments ? A.Dues.payments() : []).filter(inMonth).sort(sortEntries);
    var R = { expense: [], income: [], qard: [], payment: [] };
    exp.forEach(function (e) {
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
    inc.forEach(function (e) {
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
    pays.forEach(function (p) {
      R.payment.push(mkRow('payment', { book: lbl[p.account] || p.account || '', day: numTxt(p.day), sup: p.supplier || '', amt: numTxt(p.amount), rec: p.receiptNo || '', note: '' }, p, 'payment'));
    });
    TAB_ORDER.forEach(function (t) { padBlank(R[t], t); });
    S.rows = R;
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

  function ensureState() {
    if (!S.year) {
      var t = A.todayHijri();
      S.year = Number(t.year); S.monthNo = Number(t.monthNo || A.monthNo(t.month));
    }
    if (!S.rows) loadRows();
  }

  /* ── রেন্ডার ── */
  function datalists() {
    var sups = {};
    (A.Dues.getAll ? A.Dues.getAll() : []).forEach(function (d) { if (d.supplier) sups[d.supplier] = 1; });
    A.Expense.getAll().forEach(function (e) { if (e.supplier) sups[e.supplier] = 1; });
    var opt = function (arr) { return arr.map(function (x) { return '<option value="' + esc(x) + '">'; }).join(''); };
    return '<datalist id="accg-books">' + opt(BOOKS) + '</datalist>' +
      '<datalist id="accg-units">' + opt(UNITS) + '</datalist>' +
      '<datalist id="accg-pays">' + opt(['নগদ', 'বাকি']) + '</datalist>' +
      '<datalist id="accg-kinds">' + opt(['দেওয়া', 'আদায়']) + '</datalist>' +
      '<datalist id="accg-cats">' + opt(A.Categories.getAll()) + '</datalist>' +
      '<datalist id="accg-sups">' + opt(Object.keys(sups).sort()) + '</datalist>';
  }

  function rowHtml(row, i) {
    var ro = readOnly();
    var lockAll = ro || row.locked || row.del;
    var cls = 'accg-row' + (row.del ? ' is-del' : '') + (row.err ? ' is-err' : '') + (row.locked ? ' is-locked' : '') + (isChanged(row) ? ' is-dirty' : '');
    var mark = row.err ? '⚠' : (row.locked ? '🔒' : (isChanged(row) ? '●' : ''));
    var title = row.err ? row.err : (row.locked ? '২৪ ঘণ্টার পুরনো — বদলাতে হিসাবের তালিকা থেকে এডিট করুন (জিম্মাদারের অনুমতি লাগে)' : '');
    var cells = cols().map(function (c, j) {
      var v = row.v[c.k] == null ? '' : row.v[c.k];
      var kindLocked = c.k === 'kind' && row.orig; /* পুরনো করজের ধরন বদলানো যায় না */
      return '<td><input class="accg-in' + (c.num ? ' is-num' : '') + '" data-r="' + i + '" data-c="' + j + '"' +
        (c.list ? ' list="accg-' + c.list + '"' : '') + ' value="' + esc(v) + '"' +
        (c.num ? ' inputmode="decimal"' : '') + (lockAll || kindLocked ? ' readonly' : '') + ' autocomplete="off" spellcheck="false"></td>';
    }).join('');
    var canDel = !ro && !row.locked && !(S.tab === 'payment' && row.orig) && (row.orig || !isEmpty(row));
    var delBtn = canDel ? '<button type="button" class="accg-del" data-del="' + i + '" title="' + (row.del ? 'মোছা বাতিল' : 'সারি মুছুন') + '">' + (row.del ? '↺' : '✕') + '</button>' : '';
    return '<tr class="' + cls + '" data-row="' + i + '"><th class="accg-no" title="' + esc(title) + '">' + bn(i + 1) +
      (mark ? '<span class="accg-mark">' + mark + '</span>' : '') + '</th>' + cells + '<td class="accg-act">' + delBtn + '</td></tr>';
  }

  function tabTotal(t) {
    return (S.rows[t] || []).reduce(function (s, r) {
      if (r.del) return s;
      var n = parseFloat(toEn(r.v.amt).replace(/,/g, ''));
      if (t === 'qard' && /আদায়|আদায়/.test(r.v.kind || '')) return s;
      return s + (isNaN(n) ? 0 : n);
    }, 0);
  }

  function errRows() {
    var out = [];
    TAB_ORDER.forEach(function (t) { S.rows[t].forEach(function (r, i) { if (r.err) out.push({ t: t, i: i }); }); });
    return out;
  }

  function tableWidth() {
    return cols().reduce(function (w, c) { return w + c.w; }, 44 + 34);
  }

  function buildHtml() {
    var ro = readOnly();
    var years = {};
    [S.year - 1, S.year, S.year + 1].forEach(function (y) { years[y] = 1; });
    A.Expense.getAll().concat(A.Income.getAll()).forEach(function (e) { var y = Number(e.hijriYear); if (y) years[y] = 1; });
    var yOpts = Object.keys(years).sort().map(function (y) { return '<option value="' + y + '"' + (Number(y) === S.year ? ' selected' : '') + '>' + bn(y) + '</option>'; }).join('');
    var mOpts = (A.HIJRI_MONTHS || []).map(function (m, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === S.monthNo ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    var tabs = TAB_ORDER.map(function (t) {
      var n = S.rows[t].filter(function (r) { return r.orig || !isEmpty(r, t); }).length;
      var d = S.rows[t].filter(function (r) { return isChanged(r, t); }).length;
      var e = S.rows[t].filter(function (r) { return r.err; }).length;
      return '<button type="button" class="accg-tab' + (t === S.tab ? ' active' : '') + (e ? ' has-err' : '') + '" data-tab="' + t + '">' +
        esc(SHEETS[t].label) + ' <span>' + bn(n) + '</span>' + (d ? '<i>●' + bn(d) + '</i>' : '') + '</button>';
    }).join('');
    var colgroup = '<colgroup><col style="width:44px">' + cols().map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join('') + '<col style="width:34px"></colgroup>';
    var head = '<tr><th class="accg-no">#</th>' + cols().map(function (c) { return '<th>' + esc(c.h) + '</th>'; }).join('') + '<th></th></tr>';
    var body = S.rows[S.tab].map(rowHtml).join('');
    var dirty = dirtyCount();
    var errs = errRows().length;
    var note = ro
      ? '<div class="accg-note is-ro">' + esc(core().lockMsg ? core().lockMsg() : 'এখানে শুধু দেখা যায়') + ' — শীটে এখন শুধু দেখা যায়।</div>'
      : '<div class="accg-note">Enter = নিচের ঘর · Tab = ডানের ঘর · ↑↓ = সারি বদল · Ctrl+S = সংরক্ষণ · Excel থেকে কপি করে যেকোনো ঘরে পেস্ট করা যায় · নতুন সারিতে হিসাব বিভাগ উপরের সারি থেকে আসে, দিন নিজে লিখুন</div>';
    return '<div class="acc-ws accg-ws">' +
      '<div class="acc-ws-top">' +
      '<button type="button" class="acc-ws-back" onclick="closeAccGridSafe()">← হিসাব</button>' +
      '<div class="acc-ws-title">হিসাব শীট</div>' +
      '<div class="accg-month"><select id="accg-month" aria-label="হিজরী মাস">' + mOpts + '</select><select id="accg-year" aria-label="হিজরী বছর">' + yOpts + '</select></div>' +
      '</div>' +
      '<div class="accg-tabs">' + tabs + '</div>' + note +
      (S.tab === 'payment' && !ro ? '<div class="accg-note">পরিশোধ: সরবরাহকারীর নাম ও বিভাগ বাকিতে কেনার সাথে মিলতে হবে। আগে সংরক্ষিত পরিশোধ শীট থেকে মোছা যায় না।</div>' : '') +
      '<div class="accg-wrap" id="accg-wrap"><table class="accg-table" style="width:' + tableWidth() + 'px">' + colgroup + '<thead>' + head + '</thead><tbody id="accg-body">' + body + '</tbody></table></div>' +
      '<div class="accg-foot">' +
      '<div class="accg-sum">এই মাসে ' + esc(SHEETS[S.tab].label) + (S.tab === 'qard' ? ' (দেওয়া)' : '') + ': <b>৳' + fa(tabTotal(S.tab)) + '</b>' +
      (dirty ? ' · <span class="accg-dirty">' + bn(dirty) + 'টি পরিবর্তন সংরক্ষণ বাকি</span>' : '') +
      (errs ? ' · <span class="accg-errtxt">' + bn(errs) + 'টি সারিতে সমস্যা (⚠-এর উপর আঙুল/মাউস রাখুন)</span>' : '') + '</div>' +
      (ro ? '' : '<div class="accg-btns"><button type="button" class="accg-btn" id="accg-reset"' + (dirty ? '' : ' disabled') + '>বাতিল</button>' +
        '<button type="button" class="accg-btn is-primary" id="accg-save"' + (dirty && !S.busy ? '' : ' disabled') + '>' + (S.busy ? 'সংরক্ষণ হচ্ছে…' : '✓ সংরক্ষণ') + '</button></div>') +
      '</div>' + datalists() + '</div>';
  }

  function render(root) {
    ensureState();
    injectCss();
    root.innerHTML = '<div class="acc-shell">' + buildHtml() + '</div>';
    wire(root);
    if (S.focus) { var f = S.focus; S.focus = null; focusCell(f.r, f.c, true); }
  }

  function rerender() {
    var root = document.getElementById('accounts-root');
    if (root) render(root);
  }

  /* শুধু নিচের অংশ (মোট/বোতাম) ও ট্যাব হালনাগাদ — টাইপের সময় ফোকাস না হারাতে */
  function refreshChrome() {
    var root = document.getElementById('accounts-root');
    if (!root) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildHtml();
    ['.accg-foot', '.accg-tabs'].forEach(function (sel) {
      var a = root.querySelector(sel), b = tmp.querySelector(sel);
      if (a && b) a.innerHTML = b.innerHTML;
    });
    var save = root.querySelector('#accg-save'), reset = root.querySelector('#accg-reset');
    if (save) save.onclick = saveGrid;
    if (reset) reset.onclick = resetGrid;
  }

  function refreshRow(i) {
    var tr = document.querySelector('#accg-body tr[data-row="' + i + '"]');
    var row = S.rows[S.tab][i];
    if (!tr || !row) return;
    tr.className = 'accg-row' + (row.del ? ' is-del' : '') + (row.err ? ' is-err' : '') + (row.locked ? ' is-locked' : '') + (isChanged(row) ? ' is-dirty' : '');
    var no = tr.querySelector('.accg-no');
    var mark = row.err ? '⚠' : (row.locked ? '🔒' : (isChanged(row) ? '●' : ''));
    if (no) { no.innerHTML = bn(i + 1) + (mark ? '<span class="accg-mark">' + mark + '</span>' : ''); no.title = row.err || ''; }
    var act = tr.querySelector('.accg-act');
    var canDel = !readOnly() && !row.locked && !(S.tab === 'payment' && row.orig) && (row.orig || !isEmpty(row));
    if (act) act.innerHTML = canDel ? '<button type="button" class="accg-del" data-del="' + i + '" title="' + (row.del ? 'মোছা বাতিল' : 'সারি মুছুন') + '">' + (row.del ? '↺' : '✕') + '</button>' : '';
  }

  function focusCell(r, c, select) {
    var list = S.rows[S.tab];
    if (r < 0 || c < 0 || c >= cols().length) return;
    if (r >= list.length - 2 && !readOnly()) {
      while (list.length <= r + 3) list.push(mkRow(S.tab, {}));
      var body = document.getElementById('accg-body');
      if (body) body.innerHTML = list.map(rowHtml).join('');
    }
    var el = document.querySelector('#accg-body input[data-r="' + r + '"][data-c="' + c + '"]');
    if (!el) return;
    el.focus();
    if (select) { try { el.select(); } catch (e) {} }
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
      var el = document.querySelector('#accg-body input[data-r="' + i + '"][data-c="' + j + '"]');
      if (el) el.value = val;
    });
  }

  function onInput(e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) return;
    var i = Number(el.getAttribute('data-r')), j = Number(el.getAttribute('data-c'));
    var row = S.rows[S.tab][i];
    if (!row) return;
    var wasEmpty = isEmpty(row);
    row.v[cols()[j].k] = el.value;
    row.err = '';
    if (wasEmpty && el.value.trim()) carryDefaults(i);
    var list = S.rows[S.tab];
    if (i >= list.length - 3) {
      while (list.length <= i + BLANK_ROWS) list.push(mkRow(S.tab, {}));
      var body = document.getElementById('accg-body');
      if (body) {
        for (var n = body.children.length; n < list.length; n++) body.insertAdjacentHTML('beforeend', rowHtml(list[n], n));
      }
    }
    refreshRow(i);
    refreshChrome();
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (!readOnly()) saveGrid();
      return;
    }
    var el = e.target;
    if (!el.classList || !el.classList.contains('accg-in')) return;
    var i = Number(el.getAttribute('data-r')), j = Number(el.getAttribute('data-c'));
    var len = String(el.value || '').length;
    var atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    var atEnd = el.selectionStart === len && el.selectionEnd === len;
    if (e.key === 'Enter') { e.preventDefault(); focusCell(e.shiftKey ? i - 1 : i + 1, j, true); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.getAttribute('list') && len && !el.readOnly) { /* তালিকা থেকে বাছাই */ }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(i + 1, j, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(i - 1, j, true); }
    else if (e.key === 'ArrowRight' && (atEnd || el.readOnly)) { e.preventDefault(); focusCell(i, j + 1, true); }
    else if (e.key === 'ArrowLeft' && (atStart || el.readOnly)) { e.preventDefault(); focusCell(i, j - 1, true); }
  }

  function onPaste(e) {
    var el = e.target;
    if (readOnly() || !el.classList || !el.classList.contains('accg-in')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || (text.indexOf('\t') < 0 && text.indexOf('\n') < 0)) return; /* এক ঘরের লেখা — স্বাভাবিক পেস্ট */
    e.preventDefault();
    var lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var r0 = Number(el.getAttribute('data-r')), c0 = Number(el.getAttribute('data-c'));
    var list = S.rows[S.tab];
    var cs = cols();
    var skipped = 0, filled = 0;
    lines.forEach(function (line, a) {
      var r = r0 + a;
      while (list.length <= r) list.push(mkRow(S.tab, {}));
      var row = list[r];
      if (row.locked || row.del) { skipped++; return; }
      line.split('\t').forEach(function (cell, b) {
        var c = cs[c0 + b];
        if (!c || (c.k === 'kind' && row.orig)) return;
        row.v[c.k] = cell.trim();
      });
      row.err = '';
      filled++;
    });
    padBlank(list);
    S.focus = { r: r0, c: c0 };
    rerender();
    showToast(bn(filled) + 'টি সারিতে পেস্ট হয়েছে' + (skipped ? ' · ' + bn(skipped) + 'টি তালাবদ্ধ সারি বাদ' : ''));
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-tab],[data-del]') : null;
    if (!t) return;
    if (t.hasAttribute('data-tab')) {
      S.tab = t.getAttribute('data-tab');
      rerender();
      return;
    }
    var i = Number(t.getAttribute('data-del'));
    var row = S.rows[S.tab][i];
    if (!row) return;
    if (!row.orig) { S.rows[S.tab].splice(i, 1); padBlank(S.rows[S.tab]); rerender(); return; }
    row.del = !row.del;
    row.err = '';
    rerender();
  }

  function onMonthChange() {
    var m = Number(document.getElementById('accg-month').value);
    var y = Number(document.getElementById('accg-year').value);
    if (dirtyCount() && !confirm('সংরক্ষণ না করা পরিবর্তন বাদ যাবে। মাস বদলাবেন?')) {
      document.getElementById('accg-month').value = String(S.monthNo);
      document.getElementById('accg-year').value = String(S.year);
      return;
    }
    S.monthNo = m; S.year = y; S.rows = null;
    rerender();
  }

  function wire(root) {
    var ws = root.querySelector('.accg-ws');
    if (!ws) return;
    ws.addEventListener('input', onInput);
    ws.addEventListener('keydown', onKey);
    ws.addEventListener('paste', onPaste);
    ws.addEventListener('click', onClick);
    var mSel = root.querySelector('#accg-month'), ySel = root.querySelector('#accg-year');
    if (mSel) mSel.onchange = onMonthChange;
    if (ySel) ySel.onchange = onMonthChange;
    var save = root.querySelector('#accg-save'), reset = root.querySelector('#accg-reset');
    if (save) save.onclick = saveGrid;
    if (reset) reset.onclick = resetGrid;
  }

  function resetGrid() {
    if (dirtyCount() && !confirm('সংরক্ষণ না করা সব পরিবর্তন বাদ দেবেন?')) return;
    S.rows = null;
    rerender();
  }

  /* ── সংরক্ষণ: Excel আপলোডের একই পার্সার → এক atomic batch ── */
  function dateCell(row) {
    var d = parseInt(toEn(row.v.day), 10);
    if (!d || d < 1 || d > 30) return null;
    return S.year + '-' + String(S.monthNo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function parseTab(t, changed) {
    var c = core();
    var cs = SHEETS[t].cols;
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

  async function saveGrid() {
    if (S.busy || readOnly()) { if (readOnly()) showToast(core().lockMsg ? core().lockMsg() : 'এখানে বদলানো যায় না'); return; }
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
    var bad = errRows();
    if (bad.length) {
      S.tab = bad[0].t;
      S.focus = { r: bad[0].i, c: 0 };
      rerender();
      showToast(bn(bad.length) + 'টি সারিতে সমস্যা — ⚠ চিহ্নিত সারি ঠিক করুন, কিছুই সংরক্ষণ হয়নি');
      return;
    }
    if (!all.length && !dels.length) { showToast('সংরক্ষণের মতো কোনো পরিবর্তন নেই'); return; }
    if (dels.length && !confirm(bn(dels.length) + 'টি সারি মুছে যাবে। চালিয়ে যাবেন?')) return;
    if (!A.remoteReady || !A.remoteReady()) { showToast('সার্ভার সংযোগ নেই — নেট/লগইন দেখে আবার চেষ্টা করুন'); return; }

    S.busy = true;
    refreshChrome();
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
      rerender();
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

  window.closeAccGridSafe = function () {
    if (dirtyCount() && !confirm('সংরক্ষণ না করা পরিবর্তন বাদ যাবে। শীট বন্ধ করবেন?')) return;
    S.rows = null;
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
      '.accg-wrap{overflow:auto;max-height:calc(100vh - 290px);min-height:260px;border:1px solid var(--cream2);border-radius:12px;background:#fff;-webkit-overflow-scrolling:touch}',
      '.accg-table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%;font-size:13px}',
      '.accg-table thead th{position:sticky;top:0;z-index:2;background:#f6f1e7;color:var(--ink2);font-size:11.5px;font-weight:800;text-align:left;padding:7px 6px;border-bottom:1px solid var(--cream2);border-right:1px solid #eee5d5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.accg-table td{padding:0;border-bottom:1px solid #f0e9dc;border-right:1px solid #f0e9dc}',
      '.accg-no{position:sticky;left:0;z-index:1;background:#faf7f0;color:var(--ink3);font-size:11px;font-weight:700;text-align:center;padding:0 2px;border-bottom:1px solid #f0e9dc;border-right:1px solid var(--cream2);white-space:nowrap}',
      '.accg-table thead .accg-no{z-index:3}',
      '.accg-mark{display:block;font-size:10px;line-height:1}',
      '.accg-in{width:100%;height:32px;border:none;background:transparent;padding:0 6px;font-family:inherit;font-size:13px;color:var(--ink);outline:none;box-sizing:border-box}',
      '.accg-in.is-num{text-align:right;font-variant-numeric:tabular-nums}',
      '.accg-in:focus{background:#fffbe8;box-shadow:inset 0 0 0 2px #c9a227}',
      '.accg-in[readonly]{color:var(--ink2);cursor:default}',
      '.accg-row.is-dirty td{background:#fff8ec}',
      '.accg-row.is-dirty .accg-mark{color:#c2410c}',
      '.accg-row.is-err td,.accg-row.is-err .accg-no{background:#fdecea}',
      '.accg-row.is-err .accg-mark{color:#b42318}',
      '.accg-row.is-locked td{background:#f7f5f1}',
      '.accg-row.is-del td .accg-in{text-decoration:line-through;color:#b42318}',
      '.accg-act{text-align:center}',
      '.accg-del{width:26px;height:26px;border:none;background:transparent;color:var(--ink3);cursor:pointer;border-radius:8px;font-size:12px}',
      '.accg-del:hover{background:#fdecea;color:#b42318}',
      '.accg-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:4px 2px}',
      '.accg-sum{font-size:12.5px;color:var(--ink2)}',
      '.accg-dirty{color:#c2410c;font-weight:700}',
      '.accg-errtxt{color:#b42318;font-weight:700}',
      '.accg-btns{display:flex;gap:8px}',
      '.accg-btn{height:38px;padding:0 16px;border-radius:11px;border:1px solid var(--cream2);background:#fff;font-family:inherit;font-size:13px;font-weight:800;color:var(--ink2);cursor:pointer}',
      '.accg-btn.is-primary{background:var(--gold,#b8892b);border-color:transparent;color:#fff}',
      '.accg-btn[disabled]{opacity:.5;cursor:default}',
      '@media (max-width:640px){.accg-month{margin-left:0;width:100%}.accg-month select{flex:1}.accg-wrap{max-height:calc(100vh - 330px)}}',
    ].join('\n');
    document.head.appendChild(st);
  }
})();
