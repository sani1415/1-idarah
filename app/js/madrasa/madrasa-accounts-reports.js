'use strict';
/* global MdrAccAPI */

var _rptView = 'overview';
var _rptItem = '';
var _rptSearch = '';

(function () {
  var A = MdrAccAPI;
  var esc = function (s) { return A.esc(s); };
  var fa = function (n) { return A.fa(n); };
  var bn = function (s) { return A.bn ? A.bn(s) : String(s || '').replace(/[0-9]/g, function (d) { return String.fromCharCode(0x09e6 + (+d)); }); };
  var pct = function (n) { return A.pct ? A.pct(n) : bn(n) + '%'; };
  var count = function (n, label) { return A.count ? A.count(n, label) : bn(n) + (label ? ' ' + label : ''); };
  var num = function (n) { return A.num(n); };

  if (!document.getElementById('rpt-style')) {
    var cs = document.createElement('style');
    cs.id = 'rpt-style';
    cs.textContent = `
.rpt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.rpt-title{font-family:'Tiro Bangla',serif;font-size:16px;font-weight:900;color:var(--ink2)}
.rpt-sub{font-size:11px;color:var(--ink3);line-height:1.45;margin-top:2px}
.rpt-back{border:1px solid var(--cream3);background:#fff;border-radius:999px;padding:7px 11px;font-family:inherit;font-size:12px;color:var(--ink2);cursor:pointer;white-space:nowrap}
.rpt-alerts{display:grid;gap:7px;margin-bottom:10px}
.rpt-alert{border:1px solid rgba(26,18,8,.07);border-radius:14px;background:#fff;padding:10px 11px;font-size:12px;line-height:1.45;color:var(--ink2)}
.rpt-alert strong{display:block;font-size:13px;margin-bottom:2px}
.rpt-alert.bad{border-color:rgba(193,68,14,.2);background:#fff7ed}.rpt-alert.good{border-color:rgba(15,122,74,.2);background:#f0fdf4}.rpt-alert.warn{border-color:rgba(154,106,33,.22);background:#fffbeb}
.rpt-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rpt-menu-card{border:1px solid rgba(26,18,8,.07);border-radius:16px;background:#fff;padding:12px 11px;text-align:left;font-family:inherit;color:var(--ink2);cursor:pointer;box-shadow:0 5px 14px rgba(26,18,8,.055)}
.rpt-menu-card strong{display:block;font-size:13px;margin-bottom:4px}.rpt-menu-card span{display:block;font-size:11px;color:var(--ink3);line-height:1.45}.rpt-menu-card em{display:block;font-style:normal;font-family:'Tiro Bangla',serif;font-size:16px;font-weight:900;margin-bottom:3px;color:var(--gold)}
.rpt-stat-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:8px 0 11px}
.rpt-stat{background:#fff;border:1px solid rgba(26,18,8,.07);border-radius:13px;padding:9px 7px;text-align:center}
.rpt-stat-lbl{font-size:10px;color:var(--ink3);margin-bottom:2px}.rpt-stat-val{font-family:'Tiro Bangla',serif;font-size:15px;font-weight:900;color:var(--ink2)}
.rpt-card{background:#fff;border:1px solid rgba(26,18,8,.07);border-radius:14px;padding:11px 12px;margin-bottom:8px;box-shadow:0 4px 12px rgba(26,18,8,.045)}
.rpt-card-title{font-weight:900;font-size:13px;color:var(--ink2);margin-bottom:6px}.rpt-card-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--ink2);padding:3px 0}
.rpt-bar-row{display:flex;align-items:center;gap:7px;margin-bottom:7px}.rpt-bar-lbl{font-size:11px;color:var(--ink2);width:78px;flex-shrink:0;line-height:1.25}.rpt-bar-wrap{flex:1;background:var(--cream2);height:16px;border-radius:999px;overflow:hidden}.rpt-bar-fill{height:100%;border-radius:999px}.rpt-bar-val{font-size:11px;color:var(--ink1);font-weight:800;min-width:82px;text-align:right}
.rpt-sec{font-family:'Tiro Bangla',serif;font-weight:900;font-size:14px;margin:12px 0 8px;color:var(--ink2)}
.rpt-tbl{width:100%;border-collapse:collapse;font-size:11px}.rpt-tbl th{background:var(--cream2);padding:6px;text-align:right;font-weight:900;font-size:10px}.rpt-tbl td{padding:6px;border-bottom:1px solid var(--cream2);text-align:right}.rpt-tbl tr:last-child td{border-bottom:none}
.rpt-sel{font-size:12px;border:1px solid var(--cream2);border-radius:10px;padding:8px 10px;background:#fff;color:var(--ink1);font-family:inherit;width:100%;box-sizing:border-box;margin-bottom:8px}
.rpt-empty{text-align:center;padding:24px;color:var(--ink3);font-size:12px}.rpt-up{color:var(--red)}.rpt-dn{color:var(--green)}.rpt-eq{color:var(--ink3)}
.rpt-chip{display:inline-block;padding:2px 5px;border-radius:4px;font-size:9px;font-weight:800;margin-left:3px}.rpt-chip-hi{background:#fee2e2;color:#991b1b}.rpt-chip-lo{background:#d1fae5;color:#065f46}
.rpt-stat-row-4{grid-template-columns:repeat(2,minmax(0,1fr))}
.rpt-stat-row-6{grid-template-columns:repeat(2,minmax(0,1fr))}
.rpt-stat-click{appearance:none;-webkit-appearance:none;font:inherit;cursor:pointer;transition:border-color .12s,background .12s,transform .12s}
.rpt-stat-click:hover,.rpt-stat-click:focus-visible{border-color:rgba(154,106,33,.4);background:#fffaf2;outline:none;transform:translateY(-1px)}
.rpt-card-grid{display:grid;gap:8px;grid-template-columns:1fr}
.rpt-card-grid .rpt-card{margin-bottom:0}
@media(min-width:700px){.rpt-stat-row-4{grid-template-columns:repeat(4,minmax(0,1fr))}.rpt-stat-row-6{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:900px){.acc-ws-body .rpt-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.acc-ws-body .rpt-overview-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:520px){.rpt-overview-grid{grid-template-columns:1fr}.rpt-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(cs);
  }

  function activeContainer() {
    return document.getElementById('acc-ws-reports') ||
      document.getElementById('account-details-root') ||
      document.getElementById('acc-ws-body') ||
      document.getElementById('acc-body');
  }
  function rerenderReports() { window.renderAccountsReports(activeContainer()); }
  function money(v) { return '৳' + fa(Math.abs(num(v))); }
  function sumRows(rows) { return rows.reduce(function (s, r) { return s + num(r.amount); }, 0); }
  /* ── গ্লোবাল ফিল্টার: ওয়ার্কস্পেস (daftar-accounts.js) window.MdrAccRptRowFilter দিলে
     সব রিপোর্ট সেটা মানে; না দিলে আগের মতো সব ডেটা। ── */
  function filterRows(rows, kind) {
    var f = window.MdrAccRptRowFilter;
    if (typeof f !== 'function') return rows;
    return rows.filter(function (r) { return f(r, kind); });
  }
  function allExpRows() { return filterRows(A.Expense.getAll(), 'expense'); }
  function allIncRows() { return filterRows(A.Income.getAll(), 'income'); }
  function summaryAll() { return A.Summary.fromRows(allIncRows(), allExpRows(), A.Dues.getAll()); }
  function regularExpenses() { return allExpRows().filter(function (r) { return r.account !== 'qard'; }); }
  function regularItemNames() {
    var names = {};
    regularExpenses().forEach(function (r) {
      var item = A.clean(r.description, '');
      if (item && num(r.quantity) > 0) names[item] = true;
    });
    return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'bn'); });
  }
  function nonZeroMonths() {
    var inc = allIncRows();
    var exp = allExpRows();
    return A.MONTHS.map(function (m) {
      var s = A.Summary.fromRows(
        inc.filter(function (r) { return A.monthKey(r.month) === m; }),
        exp.filter(function (r) { return A.monthKey(r.month) === m; }),
        []
      );
      return {
        m: m,
        inc: s.regularIncome,
        exp: s.regularExpense,
        qardGiven: s.qardGiven,
        qardReturned: s.qardReturned,
        cashFlow: s.cashFlow,
      };
    }).filter(function (x) { return x.inc || x.exp || x.qardGiven || x.qardReturned; });
  }
  function topEntry(obj, key) {
    var rows = Object.keys(obj).map(function (k) { return { name: k, value: obj[k][key] || obj[k] }; }).sort(function (a, b) { return b.value - a.value; });
    return rows[0] || { name: 'তথ্য নেই', value: 0 };
  }
  function groupedExpense(field) {
    var out = {};
    regularExpenses().forEach(function (r) {
      var k = A.clean(r[field], '') || (field === 'supplier' ? 'সরবরাহকারী নেই' : 'খাত নেই');
      if (!out[k]) out[k] = { amount: 0, count: 0 };
      out[k].amount += num(r.amount);
      out[k].count += 1;
    });
    return out;
  }
  function groupedAccount() {
    var out = {};
    Object.keys(A.ACCOUNT_LABELS).forEach(function (k) {
      if (k === 'qard' || k === 'qard_return') return;
      out[k] = { amount: 0, count: 0 };
    });
    regularExpenses().forEach(function (r) {
      var k = r.account || 'general';
      if (!out[k]) out[k] = { amount: 0, count: 0 };
      out[k].amount += num(r.amount);
      out[k].count += 1;
    });
    return out;
  }
  function itemPriceSignals() {
    return regularItemNames().map(function (item) {
      var rows = A.Expense.getByItem(item).filter(function (r) { return r.account !== 'qard' && num(r.unitPrice) > 0; });
      var prices = rows.map(function (r) { return num(r.unitPrice); });
      var min = prices.length ? Math.min.apply(null, prices) : 0;
      var max = prices.length ? Math.max.apply(null, prices) : 0;
      return { item: item, min: min, max: max, spread: max - min, count: rows.length };
    }).filter(function (x) { return x.count; }).sort(function (a, b) { return b.spread - a.spread; });
  }
  function reportMeta(kind) {
    var map = {
      health: ['নিয়মিত হিসাব ও নগদ', 'আয়-ব্যয় ব্যালেন্স, বকেয়া ও নগদ প্রবাহ এক নজরে'],
      cash: ['নিয়মিত হিসাব ও নগদ', 'আয়-ব্যয় ব্যালেন্স, বকেয়া ও নগদ প্রবাহ এক নজরে'],
      qard: ['করজে হাসানা', 'করজ দেওয়া, আদায় এবং বর্তমান বাকি'],
      monthly: ['মাসভিত্তিক তুলনা', 'নিয়মিত আয়-ব্যয় ও নগদ প্রবাহের মাসিক চিত্র'],
      account: ['হিসাব বিভাগ বিশ্লেষণ', 'মাতবাখ, মাদ্রাসা, তামিরাত ও সাধারণ বিভাগের ব্যয়ভাগ'],
      item: ['পণ্য/দর বিশ্লেষণ', 'একই পণ্যের দামের ওঠানামা ও অস্বাভাবিকতা'],
      supplier: ['সরবরাহকারী রিপোর্ট', 'কার কাছে কত কেনা, কত বকেয়া ও কী বেশি নেওয়া হয়েছে'],
      due: ['বকেয়া সতর্কতা', 'বেশি বকেয়া, আংশিক পরিশোধ ও ঝুঁকিপূর্ণ সরবরাহকারী'],
    };
    return map[kind] || ['রিপোর্ট', ''];
  }
  function buildHeader() {
    var meta = _rptView === 'overview' ? ['হিসাব রিপোর্ট', 'ড্যাশবোর্ডের পুনরাবৃত্তি নয়; এখানে সতর্কতা ও গভীর বিশ্লেষণ।'] : reportMeta(_rptView);
    return '<div class="rpt-head"><div><div class="rpt-title">' + esc(meta[0]) + '</div><div class="rpt-sub">' + esc(meta[1]) + '</div></div>' +
      (_rptView === 'overview' ? '' : '<button type="button" class="rpt-back" onclick="showRptOverview()">← রিপোর্ট</button>') + '</div>';
  }
  function buildOverview() {
    var s = summaryAll();
    var bal = num(s.operatingBalance);
    var due = num(s.supplierDue);
    var months = nonZeroMonths();
    var topSup = topEntry(groupedExpense('supplier'), 'amount');
    var priceSignal = itemPriceSignals()[0];
    var cards = [
      ['qard', money(s.qardRemaining), 'করজে হাসানা', 'দেওয়া, আদায় ও বাকি'],
      ['health', money(bal), 'নিয়মিত হিসাব ও নগদ', 'ব্যালেন্স, বকেয়া ও নগদ প্রবাহ'],
      ['monthly', count(months.length, 'মাস'), 'মাসিক তুলনা', 'আয়-ব্যয়ের প্রবণতা'],
      ['account', money(topEntry(groupedAccount(), 'amount').value), 'হিসাব বিভাগ', 'কোন বিভাগে ব্যয় বেশি'],
      ['item', priceSignal ? money(priceSignal.spread) : '—', 'পণ্য/দর', 'দর পরিবর্তন ও অস্বাভাবিকতা'],
      ['supplier', money(topSup.value), 'সরবরাহকারী', 'বেশি কেনা ও বকেয়া'],
      ['due', money(due), 'বকেয়া সতর্কতা', 'কাকে আগে পরিশোধ জরুরি'],
    ].map(function (c) {
      return '<button type="button" class="rpt-menu-card" onclick="openRptDetail(\'' + c[0] + '\')"><em>' + c[1] + '</em><strong>' + c[2] + '</strong><span>' + c[3] + '</span></button>';
    }).join('');
    return '<div class="rpt-overview-grid">' + cards + '</div>';
  }
  function buildHealthReport() {
    var s = summaryAll();
    var dueRate = num(s.regularExpense) ? Math.round(num(s.supplierDue) / num(s.regularExpense) * 100) : 0;
    var entryCount = regularExpenses().length + allIncRows().filter(function (r) { return r.account !== 'qard_return'; }).length;
    var cf = num(s.cashFlow);
    return '<div class="rpt-stat-row rpt-stat-row-6">' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">আয়-ব্যয় ব্যালেন্স</div><div class="rpt-stat-val ' + (s.operatingBalance >= 0 ? 'rpt-dn' : 'rpt-up') + '">' + (s.operatingBalance < 0 ? '−' : '+') + money(s.operatingBalance) + '</div></div>' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">বকেয়া হার</div><div class="rpt-stat-val">' + pct(dueRate) + '</div></div>' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">নিয়মিত এন্ট্রি</div><div class="rpt-stat-val">' + count(entryCount, '') + '</div></div>' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">মোট নগদ আসা</div><div class="rpt-stat-val rpt-dn">' + money(s.cashIn) + '</div></div>' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">মোট নগদ যাওয়া</div><div class="rpt-stat-val rpt-up">' + money(s.cashOut) + '</div></div>' +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">নেট নগদ প্রবাহ</div><div class="rpt-stat-val ' + (cf >= 0 ? 'rpt-dn' : 'rpt-up') + '">' + (cf < 0 ? '−' : '+') + money(cf) + '</div></div>' +
      '</div>';
  }
  function buildCashReport() {
    return buildHealthReport();
  }
  function buildQardReport() {
    var s = summaryAll();
    var cf = num(s.cashFlow);
    var canOpen = typeof window.openAccAccountDetails === 'function';
    function qardStat(lbl, val, cls, tab) {
      var inner = '<div class="rpt-stat-lbl">' + lbl + '</div><div class="rpt-stat-val ' + (cls || '') + '">' + val + '</div>';
      if (canOpen && tab) {
        return '<button type="button" class="rpt-stat rpt-stat-click" onclick="openAccAccountDetails(\'qard\',\'' + tab + '\')">' + inner + '</button>';
      }
      return '<div class="rpt-stat">' + inner + '</div>';
    }
    return '<div class="rpt-stat-row rpt-stat-row-4">' +
      qardStat('করজ দেওয়া', money(s.qardGiven), 'rpt-up', 'entries') +
      qardStat('করজ আদায়', money(s.qardReturned), 'rpt-dn', 'recovery') +
      qardStat('করজ বাকি', money(s.qardRemaining), '', 'entries') +
      '<div class="rpt-stat"><div class="rpt-stat-lbl">নেট নগদ প্রবাহ</div><div class="rpt-stat-val ' + (cf >= 0 ? 'rpt-dn' : 'rpt-up') + '">' + (cf < 0 ? '−' : '+') + money(cf) + '</div></div>' +
      '</div>' +
      (s.qardOverpaid ? '<div class="rpt-alert warn"><strong>অতিরিক্ত আদায় শনাক্ত</strong>দেওয়া করজের তুলনায় ' + money(s.qardOverpaid) + ' বেশি আদায় নথিভুক্ত আছে। এন্ট্রি যাচাই করুন।</div>' : '');
  }
  function buildMonthlyReport() {
    var rows = nonZeroMonths();
    if (!rows.length) return '<div class="rpt-empty">মাসিক তথ্য নেই</div>';
    var maxVal = Math.max.apply(null, rows.map(function (d) { return Math.max(d.inc, d.exp); }).concat([1]));
    return '<div class="rpt-card-grid">' + rows.map(function (d) {
      var bal = d.inc - d.exp;
      return '<div class="rpt-card"><div class="rpt-card-title">' + esc(d.m) + '</div>' +
        '<div class="rpt-bar-row"><div class="rpt-bar-lbl">আয়</div><div class="rpt-bar-wrap"><div class="rpt-bar-fill" style="width:' + Math.round(d.inc / maxVal * 100) + '%;background:var(--green)"></div></div><div class="rpt-bar-val">' + money(d.inc) + '</div></div>' +
        '<div class="rpt-bar-row"><div class="rpt-bar-lbl">ব্যয়</div><div class="rpt-bar-wrap"><div class="rpt-bar-fill" style="width:' + Math.round(d.exp / maxVal * 100) + '%;background:var(--red)"></div></div><div class="rpt-bar-val">' + money(d.exp) + '</div></div>' +
        '<div class="rpt-card-row"><span>করজ দেওয়া / আদায়</span><span>' + money(d.qardGiven) + ' / ' + money(d.qardReturned) + '</span></div>' +
        '<div class="rpt-card-row"><span>নেট নগদ প্রবাহ</span><span class="' + (d.cashFlow >= 0 ? 'rpt-dn' : 'rpt-up') + '">' + (d.cashFlow < 0 ? '−' : '+') + money(d.cashFlow) + '</span></div>' +
        '<div class="rpt-card-row" style="font-weight:900"><span>নিয়মিত উদ্বৃত্ত/ঘাটতি</span><span class="' + (bal >= 0 ? 'rpt-dn' : 'rpt-up') + '">' + (bal < 0 ? '−' : '+') + money(bal) + '</span></div></div>';
    }).join('') + '</div>';
  }
  function buildAccountReport() {
    var data = groupedAccount();
    var total = Object.keys(data).reduce(function (s, k) { return s + num(data[k].amount); }, 0);
    if (!total) return '<div class="rpt-empty">হিসাব বিভাগের ব্যয় নেই</div>';
    var max = Math.max.apply(null, Object.keys(data).map(function (k) { return data[k].amount; }).concat([1]));
    return Object.keys(A.ACCOUNT_LABELS).filter(function (k) { return k !== 'qard' && k !== 'qard_return'; }).map(function (k) {
      var v = data[k] || { amount: 0, count: 0 };
      return '<div class="rpt-bar-row"><div class="rpt-bar-lbl">' + esc(A.ACCOUNT_LABELS[k]) + '</div><div class="rpt-bar-wrap"><div class="rpt-bar-fill" style="width:' + Math.round(num(v.amount) / max * 100) + '%;background:var(--gold)"></div></div><div class="rpt-bar-val">' + money(v.amount) + ' <span style="color:var(--ink3)">(' + pct(Math.round(num(v.amount) / total * 100)) + ')</span></div></div>';
    }).join('');
  }
  function buildItemReport() {
    var allItems = regularItemNames();
    if (!allItems.length) return '<div class="rpt-empty">পরিমাণসহ কোনো ব্যয় রেকর্ড নেই</div>';
    var items = _rptSearch ? allItems.filter(function(i){ return i.toLowerCase().indexOf(_rptSearch.toLowerCase()) >= 0 || i.indexOf(_rptSearch) >= 0; }) : allItems;
    if (!_rptItem || items.indexOf(_rptItem) < 0) _rptItem = items[0] || '';
    var selHTML = '<input class="rpt-sel" id="rpt-item-search" placeholder="পণ্য খুঁজুন..." value="' + esc(_rptSearch) + '" oninput="updateRptSearch(this.value)">' +
      (items.length ? '<select class="rpt-sel" onchange="_rptItem=this.value;activeRptContainer() && renderAccountsReports(activeRptContainer())">' + items.map(function (i) { return '<option value="' + esc(i) + '"' + (i === _rptItem ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') + '</select>' : '<div class="rpt-empty">কোনো পণ্য পাওয়া যায়নি</div>');
    var records = _rptItem ? regularExpenses().filter(function (r) { return A.clean(r.description, '') === _rptItem && num(r.quantity) > 0; }) : [];
    if (!records.length) return selHTML + '<div class="rpt-empty">পরিমাণসহ কোনো রেকর্ড নেই</div>';
    var prices = records.map(function (r) { return num(r.unitPrice); }).filter(function (p) { return p > 0; });
    var minP = prices.length ? Math.min.apply(null, prices) : 0;
    var maxP = prices.length ? Math.max.apply(null, prices) : 0;
    var totalQty = records.reduce(function (s, r) { return s + num(r.quantity); }, 0);
    var totalAmt = sumRows(records);
    var rows = records.map(function (r) {
      var p = num(r.unitPrice);
      var chip = p === maxP && prices.length > 1 ? '<span class="rpt-chip rpt-chip-hi">সর্বোচ্চ</span>' : p === minP && prices.length > 1 ? '<span class="rpt-chip rpt-chip-lo">সর্বনিম্ন</span>' : '';
      var receipt = A.clean(r.receiptNo, '');
      return '<tr><td>' + esc(A.dateLabel(r)) + '</td><td>' + fa(r.quantity) + '</td><td>' + (p ? money(p) + chip : '—') + '</td><td>' + money(r.amount) + '</td><td>' + esc(A.clean(r.supplier, '—')) + '</td><td style="color:var(--ink3)">' + (receipt ? esc(receipt) : '—') + '</td></tr>';
    }).join('');
    return selHTML + '<div class="rpt-stat-row"><div class="rpt-stat"><div class="rpt-stat-lbl">মোট পরিমাণ</div><div class="rpt-stat-val">' + fa(totalQty) + '</div></div><div class="rpt-stat"><div class="rpt-stat-lbl">মোট খরচ</div><div class="rpt-stat-val">' + money(totalAmt) + '</div></div><div class="rpt-stat"><div class="rpt-stat-lbl">দর ফারাক</div><div class="rpt-stat-val rpt-up">' + money(maxP - minP) + '</div></div></div>' +
      '<div style="overflow-x:auto"><table class="rpt-tbl"><thead><tr><th>তারিখ</th><th>পরিমাণ</th><th>একক দর</th><th>মোট</th><th>সরবরাহকারী</th><th>রশিদ নং</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function buildSupplierReport() {
    var bySup = groupedExpense('supplier');
    var dues = A.Dues.getAll();
    var sorted = Object.keys(bySup).map(function (k) { return [k, bySup[k]]; }).sort(function (a, b) { return b[1].amount - a[1].amount; });
    if (!sorted.length) return '<div class="rpt-empty">সরবরাহকারীর তথ্য নেই</div>';
    var rows = sorted.map(function (e) {
      var due = dues.filter(function (d) { return (A.clean(d.supplier, '') || 'সরবরাহকারী নেই') === e[0]; })[0];
      var dueAmt = due ? num(due.due) : 0;
      return '<tr><td style="text-align:left">' + esc(e[0]) + '</td><td>' + money(e[1].amount) + '</td><td>' + count(e[1].count, 'টি') + '</td><td class="' + (dueAmt > 0 ? 'rpt-up' : '') + '">' + (due ? money(dueAmt) : '—') + '</td></tr>';
    }).join('');
    return '<div style="overflow-x:auto"><table class="rpt-tbl"><thead><tr><th style="text-align:left">সরবরাহকারী</th><th>মোট কেনা</th><th>এন্ট্রি</th><th>বকেয়া</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function buildDueReport() {
    var dues = A.Dues.getAll().filter(function (d) { return num(d.due) > 0; }).sort(function (a, b) { return num(b.due) - num(a.due); });
    if (!dues.length) return '<div class="rpt-empty">কোনো বকেয়া নেই</div>';
    return '<div style="overflow-x:auto"><table class="rpt-tbl"><thead><tr><th>সরবরাহকারী</th><th>হিসাব</th><th>মোট</th><th>পরিশোধ</th><th>বাকি</th></tr></thead><tbody>' + dues.map(function (d) {
      return '<tr><td>' + esc(A.clean(d.supplier, 'সরবরাহকারী')) + '</td><td>' + esc(A.ACCOUNT_LABELS[d.account] || d.account) + '</td><td>' + money(d.total) + '</td><td>' + money(d.paid) + '</td><td><strong class="rpt-up">' + money(d.due) + '</strong></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function buildDetail() {
    if (_rptView === 'health') return buildHealthReport();
    if (_rptView === 'cash') return buildCashReport();
    if (_rptView === 'qard') return buildQardReport();
    if (_rptView === 'monthly') return buildMonthlyReport();
    if (_rptView === 'account') return buildAccountReport();
    if (_rptView === 'item') return buildItemReport();
    if (_rptView === 'supplier') return buildSupplierReport();
    if (_rptView === 'due') return buildDueReport();
    return buildOverview();
  }

  window.renderAccountsReports = function (container, opts) {
    if (!container) return;
    if (opts && opts.reset) _rptView = 'overview';
    container.innerHTML = buildHeader() + (_rptView === 'overview' ? buildOverview() : buildDetail());
    /* ওয়ার্কস্পেসের সাইড-মেনুর সক্রিয় অবস্থা মিলিয়ে দাও (থাকলে) */
    if (typeof window.MdrAccWsSyncMenu === 'function') window.MdrAccWsSyncMenu(_rptView);
  };
  window.activeRptContainer = activeContainer;
  window.openRptDetail = function (kind) {
    if (kind === 'cash') kind = 'health';
    _rptView = kind;
    _rptItem = '';
    rerenderReports();
  };
  window.showRptOverview = function () { _rptView = 'overview'; rerenderReports(); };
  window.updateRptSearch = function (value) {
    _rptSearch = value; _rptItem = '';
    rerenderReports();
    setTimeout(function () {
      var el = document.getElementById('rpt-item-search');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 0);
  };
})();
