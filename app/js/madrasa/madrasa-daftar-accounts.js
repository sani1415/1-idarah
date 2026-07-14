'use strict';
/* global MdrAccAPI, renderAccountsReports, openModal, closeModal, showToast */

/* ── global state (settable from inline onclick) ── */
var _tab      = 'summary';
var _monFs    = [];   /* multi-select months — empty = all */
var _accFs    = [];   /* multi-select account books — empty = all */
var _catFs    = [];   /* multi-select categories — empty = all */
var _dayF     = 'all';
var _sortF    = 'date_desc';
var _dueAccFs  = [];
var _fromKey  = 'all';
var _toKey    = 'all';
var _detailAccount = '';
var _detailMonth = 'all';
var _detailMonthFs = [];
var _detailCategory = 'all';
var _detailCatFs = [];
var _detailSupFs = [];
var _detailSearch = '';
var _detailSort = 'date_desc';
var _accDefaulted = false;
var _metricModalKind = '';
var _settingsModalOpen = false;
var _yearFs       = [];
var _editEntryId  = null;
var _editEntryType = '';
var _editNeedsApproval = false;
var _paymentMethod = 'cash';
var _qardTab = 'entries'; /* 'entries' | 'recovery' */
var _payQardOpenBucket = null; /* করজ আদায় কার্ড — কোন খাত-কী খোলা */
var _qardGiveInlineOpen = false; /* করজ বিস্তারিত মডালে নিচে ইনলাইন নতুন করজ ফর্ম */

(function () {
  var A   = MdrAccAPI;
  var esc = function (s) { return A.esc(s); };
  var fa  = function (n) { return A.fa(n); };
  var pct = function (n) { return A.pct ? A.pct(n) : bn(n) + '%'; };
  var count = function (n, label) { return A.count ? A.count(n, label) : bn(n) + (label ? ' ' + label : ''); };
  var bn  = function (s) { return String(s || '').replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }); };

  /* সংখ্যার ঘরে ভুলবশত বাংলা মাত্রা/অক্ষর (যেমন "১০া") ঢুকে গেলে ডাটাবেজ সেভ ভেঙে
     যায় ("invalid input syntax for type numeric")। তাই সংখ্যা-ঘরের মান এখানে
     পরিষ্কার করা হয়: বাংলা/আরবি অঙ্ক → ইংরেজি অঙ্ক, এবং শুধু অঙ্ক + একটি দশমিক বিন্দু রাখা হয়। */
  function sanitizeNumStr(v) {
    var s = String(v == null ? '' : v)
      .replace(/[০-৯]/g, function (d) { return String('০১২৩৪৫৬৭৮৯'.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/[^\d.]/g, '');
    var dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    return s;
  }

  /* সংখ্যা-ঘরে টাইপ করার সময়ই অবৈধ অক্ষর বাদ দেওয়া হয় — তাই ব্যবহারকারী সাথে সাথে
     বোঝেন ঘরটা অক্ষর নিচ্ছে না, এবং খারাপ মান কখনো ডাটাবেজ পর্যন্ত যায় না।
     (type="number" ঘর ব্রাউজার নিজেই আটকায়, তাই শুধু text ঘরগুলো এখানে ধরা হয়।) */
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.type === 'number' || typeof el.value !== 'string') return;
    var isNumField = (el.classList && el.classList.contains('acc-num-input')) ||
      el.id === 'acc-qard-amt' || el.id === 'acc-qard-inline-amt' || el.id === 'qpay-expand-amt';
    if (!isNumField) return;
    var cleaned = sanitizeNumStr(el.value);
    if (cleaned === el.value) return;
    var pos = null;
    try { pos = el.selectionStart; } catch (e2) { pos = null; }
    var removed = el.value.length - cleaned.length;
    el.value = cleaned;
    if (pos !== null) {
      try { var np = Math.max(0, pos - removed); el.setSelectionRange(np, np); } catch (e3) {}
    }
  }, true);

  /* হিসাব বই ফিল্টার/সারাংশে শুধু ব্যয়-বই — qard_return শুধু আয়ের ধরন */
  function expenseBookKeys() {
    return Object.keys(A.ACCOUNT_LABELS).filter(function (k) { return k !== 'qard_return'; });
  }
  function expenseBookEntries() {
    return Object.entries(A.ACCOUNT_LABELS).filter(function (e) { return e[0] !== 'qard_return'; });
  }

  function filterIconBtn(active, count, mode) {
    var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>';
    var modeArg = mode ? ",'" + mode + "'" : '';
    return '<button type="button" class="acc-filter-icon-btn' + (active ? ' is-on' : '') + '" onclick="openAccFilterSheet(this' + modeArg + ')">' + svg + 'ফিল্টার' + (active && count ? '<span class="acc-filter-badge">' + bn(count) + '</span>' : '') + '</button>';
  }

  function monthOptions(selected) {
    var current = selected === 'all' ? 'all' : A.monthKey(selected);
    return '<option value="all">সব মাস</option>' + A.MONTHS.map(function (m) {
      return '<option value="' + esc(m) + '"' + (current === m ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
  }

  function normalizeMonthFilters() {
    _monFs = _monFs.map(function (m) { return A.monthKey(m); });
  }

  function getAllYears() {
    var years = new Set();
    A.Income.getAll().forEach(function (r) { if (r.hijriYear) years.add(String(r.hijriYear)); });
    A.Expense.getAll().forEach(function (r) { if (r.hijriYear) years.add(String(r.hijriYear)); });
    return Array.from(years).sort();
  }
  function yearOptions(selected) {
    return '<option value="all">সব বছর</option>' + getAllYears().map(function (y) {
      return '<option value="' + y + '"' + (selected === y ? ' selected' : '') + '>' + A.bn(y) + '</option>';
    }).join('');
  }

  /* ── inject CSS once ── */

  function ensureCurrentMonthDefault() {
    if (_accDefaulted) return;
    _monFs = [];
    _accDefaulted = true;
  }

  if (!document.getElementById('acc-style')) {
    var cs = document.createElement('style');
    cs.id = 'acc-style';
    cs.textContent = `
body.page-daftar #panel-fees{margin-left:-12px;margin-right:-12px}
.acc-shell{padding-top:2px}
.acc-add-btns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:2px 4px 8px}
.acc-add-btns.has-month{gap:6px;padding-bottom:6px}
.acc-add-btns.acc-readonly{grid-template-columns:1fr;align-items:stretch}
.acc-btn{position:relative;overflow:hidden;height:38px;padding:0 4px;border:none;border-radius:12px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 8px 18px rgba(26,18,8,.08);white-space:nowrap}
.acc-add-btns.has-month .acc-btn{height:38px;padding:0 4px;font-size:12px;border-radius:12px}
.acc-filter-icon-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid rgba(26,18,8,.12);background:#fff;color:var(--ink2);border-radius:12px;padding:0 10px;height:38px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(26,18,8,.06);white-space:nowrap;width:100%}
.acc-filter-icon-btn.is-on{background:var(--ink);color:var(--gold2);border-color:var(--ink)}
.acc-filter-badge{position:absolute;top:-5px;right:-5px;background:#e53e3e;color:#fff;border-radius:50%;min-width:16px;height:16px;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 2px;line-height:1}
.acc-report-top{height:38px;border:1px solid var(--cream2);border-radius:12px;background:#fff;color:var(--ink2);font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;padding:0 4px;box-shadow:0 5px 13px rgba(26,18,8,.055);white-space:nowrap}
.acc-report-top.active{background:var(--ink);color:var(--gold2);border-color:var(--ink)}
.acc-top-settings{white-space:nowrap}
.acc-btn:active{transform:scale(.98)}
.acc-btn-inc{background:linear-gradient(135deg,#dcfce7,#bbf7d0);color:#065f46}
.acc-btn-exp{background:linear-gradient(135deg,#fee2e2,#fecaca);color:#991b1b}
.acc-tabs{display:flex;margin:0 4px 6px;padding:3px;gap:3px;overflow-x:auto;scrollbar-width:none;background:rgba(255,255,255,.72);border:1px solid rgba(26,18,8,.07);border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}
.acc-qard-tab-bar{display:flex;gap:0;margin:0 0 12px;padding:0 2px;border-bottom:2px solid var(--cream2);border-radius:12px 12px 0 0;background:rgba(255,255,255,.5)}
.acc-qard-toolbar{margin:0 0 10px}
.acc-qard-new-btn{width:100%;padding:10px 12px;border-radius:12px;border:1.5px dashed rgba(154,106,33,.38);background:linear-gradient(180deg,#fffefb,#fff8e8);color:var(--ink2);font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(26,18,8,.05)}
.acc-qard-new-btn:active{transform:scale(.99)}
.acc-qard-new-btn.is-open{border-style:solid;border-color:rgba(154,106,33,.55);background:linear-gradient(180deg,#fff4e0,#ffecc8)}
.acc-qard-inline-give{margin-top:10px;padding:12px 12px 10px;border:1px solid rgba(154,106,33,.28);border-radius:14px;background:linear-gradient(180deg,#fffefb,#fff8e8);box-shadow:inset 0 1px 0 rgba(255,255,255,.75)}
.acc-qard-inline-give .form-row{margin-bottom:8px}
.acc-qard-inline-give .form-row:last-of-type{margin-bottom:0}
.acc-qard-inline-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px dashed rgba(26,18,8,.12)}
.acc-qard-tab{flex:1;padding:10px 6px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink3);cursor:pointer;transition:color .15s,border-color .15s}
.acc-qard-tab.is-active{color:var(--ink2);border-bottom-color:var(--gold);font-weight:800}
.acc-qard-tab.is-recovery.is-active{color:var(--green);border-bottom-color:var(--green)}
.qard-person-card{background:#fff;border:1px solid rgba(26,18,8,.09);border-radius:14px;padding:11px 13px;margin-bottom:8px;box-shadow:0 4px 10px rgba(26,18,8,.05)}
.qard-person-card:last-child{margin-bottom:0}
.qard-expand-wrap{border-top:1px solid var(--cream2);margin-top:9px;padding-top:9px}
.qard-expand-row{display:flex;gap:8px;align-items:center;margin-top:6px}
.acc-qard-pane{display:flex;flex-direction:column;flex:1;min-height:0}
.acc-qard-pane--recovery{padding-top:4px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.acc-tab-btn{padding:7px 11px;border:none;border-radius:11px;background:none;cursor:pointer;font-size:12px;color:var(--ink3);white-space:nowrap;font-family:inherit}
.acc-tab-btn.active{color:#fff;background:linear-gradient(135deg,var(--gold),#9a6a21);font-weight:800;box-shadow:0 6px 14px rgba(154,106,33,.23)}
.acc-content{padding:0 4px 10px}
.acc-dashboard{background:transparent;border:0;border-radius:0;padding:0;box-shadow:none;position:relative;overflow:visible}
.acc-dashboard:before{display:none}
.acc-topline{display:flex;align-items:center;gap:8px;margin-bottom:6px;position:relative}
.acc-topline .acc-sel{max-width:180px;margin-left:auto;background:#fff}
.acc-period{font-size:12px;color:var(--ink3);font-weight:700}
.acc-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;position:relative}
.acc-metric{min-width:0;max-width:100%;border:none;background:#fff;border-radius:var(--radius-sm);box-shadow:var(--shadow);padding:10px 4px;min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-sizing:border-box;overflow:hidden;-webkit-appearance:none;appearance:none;color:inherit}
.acc-metric-click{cursor:pointer;font-family:inherit}
.acc-metric-click:hover{background:#fff8e8;box-shadow:0 5px 13px rgba(26,18,8,.08)}
.acc-metric-click:focus-visible{outline:2px solid rgba(154,106,33,.35);outline-offset:2px}
.acc-metric-lbl{width:100%;font-size:10px;font-weight:700;color:var(--ink3);margin-bottom:4px;line-height:1.2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.acc-metric-val{width:100%;max-width:100%;font-family:'Tiro Bangla',serif;font-size:17px;font-weight:700;color:var(--ink2);line-height:1.12;overflow:hidden;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;word-break:break-word}
.acc-metric.good .acc-metric-val{color:var(--green)}.acc-metric.bad .acc-metric-val{color:var(--red)}.acc-metric.warn .acc-metric-val{color:var(--gold)}
@media (min-width:960px){.acc-metrics{grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.acc-metric{min-height:100px}.acc-metric-val{font-size:16px}}
@media (max-width:520px){.acc-metric{padding:10px 4px;min-height:88px}.acc-metric-val{font-size:15px}}
.acc-summary-section{margin-bottom:10px}
.acc-summary-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 2px 6px}
.acc-summary-title{font-family:'Tiro Bangla',serif;font-size:14px;font-weight:900;color:var(--ink2)}
.acc-summary-note{font-size:10px;color:var(--ink3);text-align:right}
.acc-summary-section.secondary .acc-metric{background:rgba(255,250,242,.88)}
.acc-cash-formula{margin:-3px 2px 10px;padding:8px 10px;border-radius:10px;background:rgba(154,106,33,.08);color:var(--ink3);font-size:10px;line-height:1.45;text-align:center}
.acc-ledger-card{background:#fff;border:1px solid rgba(26,18,8,.07);border-radius:16px;overflow:hidden;position:relative;box-shadow:0 5px 13px rgba(26,18,8,.055);margin-top:2px}
.acc-ledger-title{display:flex;align-items:center;justify-content:space-between;padding:10px 11px;border-bottom:1px solid var(--cream2);font-size:12px;font-weight:800;color:var(--ink2)}
.acc-ledger-title--center{justify-content:center;text-align:center}
.acc-ledger-card.acc-ledger-flat{background:transparent;border:0;border-radius:0;overflow:visible}
.acc-ledger-flat .acc-ledger-title{padding:6px 2px 8px;border-bottom:0}
.acc-sum-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.acc-sum-tbl th{background:#faf3e8;padding:8px 6px;text-align:left;font-weight:800;font-size:11px;color:var(--ink3)}
.acc-sum-tbl th:first-child{text-align:left}
.acc-sum-tbl td{padding:7px 5px;border-bottom:1px solid rgba(26,18,8,.06);text-align:left;background:#fff}
.acc-sum-tbl tbody tr:nth-child(even) td{background:#fffaf2}
.acc-sum-tbl tfoot td{font-weight:800;border-top:1px solid var(--cream3);background:#f8eddc}
.acc-sum-row{cursor:pointer}
.acc-sum-row:hover td{background:#fff4d9}
.acc-sum-row:focus{outline:2px solid rgba(154,106,33,.32);outline-offset:-2px}
.acc-money-hero{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(145deg,#fff,#fff4d9);border:1px solid rgba(184,134,45,.18);border-radius:16px;padding:8px 10px;margin-bottom:7px;text-align:center;box-shadow:0 8px 18px rgba(154,106,33,.08);position:relative;overflow:hidden}
.acc-money-hero:after{display:none}
.acc-money-label{font-size:11px;color:var(--ink3);font-weight:800;position:relative}
.acc-money-main{font-family:'Tiro Bangla',serif;font-size:20px;font-weight:900;color:var(--ink2);position:relative;margin-top:0}
.acc-money-main.good{color:var(--green)}.acc-money-main.bad{color:var(--red)}
.acc-break-row{display:grid;grid-template-columns:1.05fr .9fr .75fr .7fr;gap:0;align-items:center}
.acc-break-name{font-weight:900;color:var(--ink2);text-align:left}
.acc-pct-track{height:7px;background:#f3eadc;border-radius:999px;overflow:hidden;margin-top:5px}
.acc-pct-fill{height:100%;background:linear-gradient(90deg,var(--gold),#d8aa55);border-radius:999px}
.acc-ledger-list{display:grid;gap:8px}
.acc-ledger-row{background:rgba(255,255,255,.92);border:1px solid rgba(26,18,8,.07);border-radius:16px;padding:10px 11px;box-shadow:0 7px 18px rgba(26,18,8,.055)}
.acc-ledger-grid{display:grid;grid-template-columns:74px 1fr auto;gap:9px;align-items:center}
.acc-ledger-date{font-size:11px;color:var(--ink3);font-weight:900;background:#fff8e8;border:1px solid rgba(154,106,33,.14);border-radius:12px;padding:7px 6px;text-align:center}
.acc-ledger-desc{font-size:13px;font-weight:900;color:var(--ink2);line-height:1.25}
.acc-ledger-meta{font-size:10px;color:var(--ink3);font-weight:700;margin-top:3px}
.acc-ledger-amt{font-family:'Tiro Bangla',serif;font-size:14px;font-weight:900;color:var(--red);white-space:nowrap}
.acc-ledger-table{margin-top:8px;border-top:1px dashed rgba(26,18,8,.12);padding-top:7px;display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-size:10px;color:var(--ink3)}
.acc-ledger-table b{color:var(--ink2);font-size:11px}
.acc-table-wrap{overflow:auto;border:1px solid rgba(26,18,8,.07);border-radius:16px;background:#fff;max-height:none;flex:1;min-height:0}
body.page-daftar #modal-account-details .modal-title,
body.page-admin-accounts #modal-account-details .modal-title,
#modal-account-details .modal-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
#modal-account-details .modal-close{
  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:36px;height:36px;min-width:36px;padding:0;margin:0;
  border:1px solid rgba(26,18,8,.12);border-radius:9px;background:#fff;color:var(--ink2);
  z-index:6;position:relative;cursor:pointer;line-height:1;box-sizing:border-box
}
#modal-account-details .modal-close:hover{background:#faf7f2;border-color:rgba(26,18,8,.2)}
#modal-account-details .modal-close svg{
  width:16px;height:16px;max-width:16px;max-height:16px;
  stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;display:block;flex-shrink:0
}
body.page-daftar #account-details-title,
body.page-admin-accounts #account-details-title,
#modal-account-details #account-details-title{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;flex:1;overflow:hidden}
body.page-daftar #account-details-title.acc-title-root--qard,
body.page-admin-accounts #account-details-title.acc-title-root--qard,
#modal-account-details #account-details-title.acc-title-root--qard{flex-direction:column;align-items:stretch;gap:0;padding-right:2px;overflow:hidden;max-width:calc(100% - 48px)}
.acc-title-main{font-size:15px;overflow:hidden;text-overflow:ellipsis;min-width:0}
.acc-title-meta{font-size:10px;color:var(--ink3);font-family:'Tiro Bangla',serif;font-weight:800;flex-shrink:0}
.acc-title-total{font-family:'Tiro Bangla',serif;font-size:12px;font-weight:900;color:var(--red);background:#fff4d9;border:1px solid rgba(154,106,33,.16);border-radius:999px;padding:4px 7px;white-space:nowrap;flex-shrink:0}
/* করজ মডাল শিরোনাম — এক কার্ডে মোট + তিন স্তম্ভ স্ট্যাট */
.acc-qard-title-card{
  width:100%;box-sizing:border-box;
  background:linear-gradient(168deg,#fffcf7 0%,#fff6e8 45%,#fdf3df 100%);
  border:1px solid rgba(184,134,45,.24);border-radius:16px;
  padding:12px 12px 11px;box-shadow:0 8px 22px rgba(26,18,8,.07);
}
.acc-qard-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;min-width:0}
.acc-qard-title-name{font-size:16px;font-weight:900;color:var(--ink2);line-height:1.25;min-width:0;flex:1}
.acc-qard-title-amount{font-family:'Tiro Bangla',serif;font-size:20px;font-weight:900;color:#a67c1f;line-height:1;white-space:nowrap;flex-shrink:0;letter-spacing:-.02em}
.acc-qard-title-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;text-align:center}
.acc-qard-stat{
  background:rgba(255,255,255,.88);border:1px solid rgba(26,18,8,.08);
  border-radius:12px;padding:8px 4px 9px;min-width:0;
}
.acc-qard-stat-lbl{display:block;font-size:10px;font-weight:800;color:var(--ink3);margin:0 0 5px;line-height:1.2}
.acc-qard-stat-val{display:block;font-size:15px;font-weight:900;color:var(--ink2);font-family:'Tiro Bangla',serif;line-height:1.2;word-break:break-word}
.acc-qard-stat-val--green{color:#15803d}
.acc-qard-stat-val--gold{color:#a16207}
.acc-detail-tools{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:stretch}
.acc-detail-tools .acc-sel{min-width:0;padding:6px 8px;flex:1}
.acc-detail-tools .acc-filter-icon-btn{flex:0 0 auto;min-width:90px}
.acc-detail-clear{border:1px solid rgba(193,68,14,.16);background:rgba(193,68,14,.07);color:var(--red);border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer;font-family:inherit}
body.page-daftar #modal-account-details .modal{display:flex;flex-direction:column;height:min(760px,calc(100vh - 32px));padding-bottom:14px}
body.page-daftar #account-details-root{display:flex;flex-direction:column;flex:1;min-height:0}
#modal-account-entry .modal{width:min(1100px,calc(100vw - 24px));max-width:1100px;height:min(820px,calc(100vh - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:24px 22px 28px;box-sizing:border-box}
body.page-daftar #modal-account-entry .modal,body.page-admin-accounts #modal-account-entry .modal{width:min(1100px,calc(100vw - 24px));height:min(820px,calc(100vh - 24px));max-height:calc(100vh - 24px)}
#modal-account-entry .modal-title{font-size:18px;margin-bottom:14px}
#modal-account-entry .form-row{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
#modal-account-entry .acc-entry-top-row{grid-template-columns:minmax(140px,1fr);gap:12px;margin-bottom:2px;align-items:end}
#modal-account-entry .acc-expense-top-fields{display:none}
#modal-account-entry .acc-expense-top-fields.is-open{display:contents}
#modal-account-entry .acc-entry-top-row > .form-group,#modal-account-entry .acc-expense-top-fields > .form-group{margin-bottom:10px}
#modal-account-entry .form-group{min-width:0}
#modal-account-entry .form-label{font-size:12px;margin-bottom:6px}
#modal-account-entry .form-input{min-height:42px;font-size:14px;padding:10px 12px}
#modal-account-entry .submit-btn{min-height:44px;margin-top:12px}
@media (min-width:641px){#modal-account-entry:has(.acc-expense-top-fields.is-open) .acc-entry-top-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:900px){#modal-account-entry:has(.acc-expense-top-fields.is-open) .acc-entry-top-row{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}
.acc-detail-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.acc-detail-table th{position:sticky;top:0;background:#faf3e8;color:var(--ink3);font-size:10px;font-weight:900;text-align:left;padding:7px 5px;border-bottom:1px solid rgba(26,18,8,.08);z-index:1;white-space:nowrap}
.acc-detail-table td{padding:7px 5px;border-bottom:1px solid rgba(26,18,8,.06);white-space:nowrap;text-align:left;background:#fff}
.acc-detail-table tbody tr:nth-child(even) td{background:#fffaf2}
.acc-detail-table .acc-desc-cell{white-space:nowrap;color:var(--ink2);font-weight:800;line-height:1.35}
.acc-detail-table th:nth-child(1),.acc-detail-table td:nth-child(1){min-width:74px}
.acc-detail-table th:nth-child(2),.acc-detail-table td:nth-child(2){min-width:48px}
.acc-detail-table th:nth-child(3),.acc-detail-table td:nth-child(3){min-width:66px}
.acc-detail-table th:nth-child(4),.acc-detail-table td:nth-child(4){min-width:104px}
.acc-detail-table th:nth-child(5),.acc-detail-table td:nth-child(5){min-width:74px}
.acc-detail-table th:nth-child(6),.acc-detail-table td:nth-child(6){min-width:78px}
.acc-detail-table th:nth-child(7),.acc-detail-table td:nth-child(7){min-width:58px}
.acc-detail-table th:nth-child(8),.acc-detail-table td:nth-child(8){min-width:64px}
.acc-detail-table th:nth-child(9),.acc-detail-table td:nth-child(9){min-width:58px}
/* করজে হাসানা: মাস কলাম নেই — nth-child ভিন্ন; না হলে খাত/বিবরণ কলাম ভুল min-width পায় */
/* করজ এন্ট্রি টেবিল: মাস+সরবরাহকারী কলাম নেই — তারিখ,খাত,বিবরণ,পরিমাণ,রশিদ,টাকা,(কর্ম) */
.acc-table-wrap--qard .acc-detail-table th:nth-child(1),.acc-table-wrap--qard .acc-detail-table td:nth-child(1){min-width:86px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(2),.acc-table-wrap--qard .acc-detail-table td:nth-child(2){min-width:76px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(3),.acc-table-wrap--qard .acc-detail-table td:nth-child(3){min-width:132px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(4),.acc-table-wrap--qard .acc-detail-table td:nth-child(4){min-width:76px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(5),.acc-table-wrap--qard .acc-detail-table td:nth-child(5){min-width:68px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(6),.acc-table-wrap--qard .acc-detail-table td:nth-child(6){min-width:70px}
.acc-table-wrap--qard .acc-detail-table th:nth-child(7),.acc-table-wrap--qard .acc-detail-table td:nth-child(7){min-width:56px}
.acc-table-wrap--qard.acc-table-wrap--qard-ro .acc-detail-table th:nth-child(6),.acc-table-wrap--qard.acc-table-wrap--qard-ro .acc-detail-table td:nth-child(6){min-width:74px}
.acc-expense-wrap{overflow:auto;border:1px solid rgba(26,18,8,.07);border-radius:17px;background:#fff;max-height:60vh;box-shadow:0 10px 24px rgba(26,18,8,.055)}
.acc-expense-table{width:100%;min-width:720px;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:12px}
.acc-expense-table th{position:sticky;top:0;background:#faf3e8;color:var(--ink3);font-size:10px;font-weight:900;text-align:left;padding:7px 5px;border-bottom:1px solid rgba(26,18,8,.08);z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acc-expense-table td{padding:7px 5px;border-bottom:1px solid rgba(26,18,8,.06);white-space:nowrap;text-align:left;background:#fff;overflow:hidden;text-overflow:ellipsis}
.acc-expense-table tbody tr:nth-child(even) td{background:#fffaf2}
.acc-expense-table th:nth-child(1),.acc-expense-table td:nth-child(1){width:74px;min-width:74px}
.acc-expense-table th:nth-child(2),.acc-expense-table td:nth-child(2){width:72px;min-width:72px}
.acc-expense-table th:nth-child(3),.acc-expense-table td:nth-child(3){width:66px;min-width:66px}
.acc-expense-table th:nth-child(4),.acc-expense-table td:nth-child(4){width:104px;min-width:104px}
.acc-expense-table th:nth-child(5),.acc-expense-table td:nth-child(5){width:74px;min-width:74px}
.acc-expense-table th:nth-child(6),.acc-expense-table td:nth-child(6){width:78px;min-width:78px}
.acc-expense-table th:nth-child(7),.acc-expense-table td:nth-child(7){width:58px;min-width:58px}
.acc-expense-table th:nth-child(8),.acc-expense-table td:nth-child(8){width:64px;min-width:64px}
.acc-expense-table th:nth-child(9),.acc-expense-table td:nth-child(9){width:58px;min-width:58px}
.acc-expense-table .acc-desc-cell{color:var(--ink2);font-weight:800}
.acc-expense-table .acc-ledger-amt{font-size:13px;font-weight:800}
.acc-expense-table td:nth-child(9){overflow:visible;text-overflow:clip}
.acc-expense-table .acc-row-actions{flex-wrap:nowrap}
.acc-filter-bar{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.acc-sel{font-size:12px;border:1px solid var(--cream2);border-radius:8px;padding:6px 10px;background:#fff;color:var(--ink1);flex:1;min-width:90px;font-family:inherit}
.acc-list-item{background:#fff;border-radius:8px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.07);margin-bottom:6px}
.acc-list-top{display:flex;justify-content:space-between;align-items:flex-start;gap:4px}
.acc-list-desc{font-size:13px;font-weight:600;flex:1;line-height:1.3}
.acc-list-amt{font-weight:700;font-size:14px;white-space:nowrap}
.acc-list-amt.inc{color:var(--green)}.acc-list-amt.exp{color:var(--red)}
.acc-list-meta{font-size:11px;color:var(--ink3);margin-top:3px}
.acc-day-group{margin-bottom:10px;background:rgba(255,255,255,.55);border:1px solid rgba(26,18,8,.06);border-radius:14px;padding:8px}
.acc-day-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:800;color:var(--ink2);margin-bottom:7px}
.acc-day-head span:last-child{color:var(--red);font-family:'Tiro Bangla',serif}
.acc-date-btn{font-size:12px;border:1px solid var(--cream2);border-radius:10px;padding:7px 10px;background:#fff;color:var(--ink1);min-width:118px;cursor:pointer;font-family:inherit;text-align:right}
.acc-date-btn.is-on{border-color:rgba(184,134,45,.45);background:#fff8e8;box-shadow:0 4px 12px rgba(154,106,33,.12)}
.acc-date-clear{border:none;background:rgba(193,68,14,.08);color:var(--red);border-radius:10px;padding:7px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.acc-toolbar{display:flex;align-items:center;gap:7px;margin-bottom:8px;flex-wrap:nowrap}
.acc-tool-btn{border:1px solid rgba(154,106,33,.18);background:rgba(255,255,255,.9);color:var(--ink2);border-radius:13px;padding:8px 11px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 5px 14px rgba(26,18,8,.06);white-space:nowrap}
.acc-tool-btn.is-on{background:linear-gradient(135deg,#fff8e8,#f4eadb);border-color:rgba(154,106,33,.36);color:#7a5118}
.acc-sort-btn{width:38px;padding:8px 0;font-size:16px}
.acc-chipline{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;margin:-2px 0 8px}
.acc-chip{font-size:10px;color:var(--ink3);background:rgba(255,255,255,.72);border:1px solid rgba(26,18,8,.06);border-radius:999px;padding:4px 8px;white-space:nowrap}
.acc-sheet-backdrop{position:fixed;inset:0;background:rgba(26,18,8,.28);z-index:9997;display:flex;align-items:flex-end;justify-content:center;padding:12px}
.acc-sheet{width:min(430px,100%);background:#fffaf1;border:1px solid rgba(154,106,33,.2);border-radius:22px 22px 18px 18px;box-shadow:0 22px 64px rgba(26,18,8,.25);padding:12px;animation:accCalIn .16s ease-out;max-height:88vh;overflow-y:auto}
.acc-sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.acc-sheet-title{font-family:'Tiro Bangla',serif;font-size:15px;font-weight:800;color:var(--ink2)}
.acc-sheet-close{border:none;background:rgba(26,18,8,.06);border-radius:50%;width:30px;height:30px;cursor:pointer;color:var(--ink2)}
.acc-sheet-grid{display:grid;grid-template-columns:1fr;gap:9px}
.acc-sheet-field label{display:block;font-size:10px;color:var(--ink3);font-weight:800;margin:0 0 4px}
.acc-sort-list{display:grid;gap:7px}
.acc-sort-opt{border:1px solid rgba(26,18,8,.07);background:#fff;border-radius:12px;padding:10px;text-align:right;font-family:inherit;font-size:12px;cursor:pointer;color:var(--ink2)}
.acc-sort-opt.is-on{background:linear-gradient(135deg,var(--gold),#9a6a21);color:#fff;font-weight:800;border-color:transparent}
.acc-range-picks{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}
.acc-range-pick{border:1px solid rgba(26,18,8,.08);background:#fff;border-radius:13px;padding:8px;font-family:inherit;text-align:right;color:var(--ink2);cursor:pointer}
.acc-range-pick small{display:block;color:var(--ink3);font-size:9px;margin-bottom:2px}.acc-range-pick.is-on{border-color:rgba(154,106,33,.45);background:#fff8e8}
.acc-cal-backdrop{position:fixed;inset:0;background:rgba(26,18,8,.32);z-index:9998;display:flex;align-items:flex-end;justify-content:center;padding:12px}
.acc-cal{width:min(430px,100%);background:#fffaf1;border:1px solid rgba(154,106,33,.22);border-radius:22px 22px 18px 18px;box-shadow:0 24px 70px rgba(26,18,8,.28);padding:12px;animation:accCalIn .16s ease-out}
.acc-cal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.acc-cal-title{font-family:'Tiro Bangla',serif;font-weight:800;color:var(--ink2);font-size:15px}
.acc-cal-close{border:none;background:rgba(26,18,8,.06);border-radius:50%;width:30px;height:30px;cursor:pointer;color:var(--ink2)}
.acc-cal-year{display:flex;gap:8px;margin-bottom:10px}.acc-cal-year input{flex:1;text-align:center}
.acc-cal-months{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
.acc-cal-month,.acc-cal-day{border:1px solid rgba(26,18,8,.07);background:#fff;border-radius:11px;padding:8px 4px;font-family:inherit;cursor:pointer;color:var(--ink2)}
.acc-cal-month.is-on,.acc-cal-day.is-on{background:linear-gradient(135deg,var(--gold),#9a6a21);color:#fff;font-weight:800;border-color:transparent;box-shadow:0 7px 15px rgba(154,106,33,.2)}
.acc-cal-days{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
@keyframes accCalIn{from{transform:translateY(16px);opacity:.7}to{transform:none;opacity:1}}
.acc-del-btn{background:none;border:none;color:var(--ink3);cursor:pointer;font-size:14px;padding:0 4px;line-height:1}
.acc-row-actions{display:flex;align-items:center;justify-content:center;gap:2px}
.acc-icon-btn{border:1px solid rgba(26,18,8,.08);background:#fff;color:var(--ink3);border-radius:7px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;font-family:inherit;padding:0}
.acc-icon-btn.edit{color:#7a5118;background:#fff8e8}
.acc-icon-btn.del{color:var(--red);background:#fff5f2}
.acc-pay-btn{font-size:11px;border:1px solid var(--gold);color:var(--gold);background:none;border-radius:6px;padding:3px 8px;cursor:pointer;font-family:inherit}
.acc-empty{text-align:center;padding:30px;color:var(--ink3);font-size:13px}
.acc-cat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:6px;background:#fff;margin-bottom:4px;font-size:13px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.acc-item-wrap{overflow:auto;border:1px solid rgba(26,18,8,.08);border-radius:14px;background:#fff;box-shadow:0 6px 16px rgba(26,18,8,.045)}
.acc-item-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.acc-item-table th{background:#faf3e8;color:var(--ink3);font-size:11px;font-weight:900;text-align:left;padding:8px 7px;border-bottom:1px solid rgba(26,18,8,.08);white-space:nowrap}
.acc-item-table td{padding:7px;border-bottom:1px solid rgba(26,18,8,.06);background:#fff;vertical-align:middle}
.acc-item-table tr:last-child td{border-bottom:none}
.acc-item-table tbody tr:nth-child(even) td{background:#fffaf2}
.acc-item-table .form-input{font-size:13px;padding:8px 10px;min-height:40px;width:100%;box-sizing:border-box}
.acc-item-table select.form-input{padding:7px 10px}
.acc-item-del{background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:4px 6px;line-height:1}
.acc-item-table th:nth-child(1),.acc-item-table td:nth-child(1){width:150px}
.acc-item-table th:nth-child(2),.acc-item-table td:nth-child(2){width:250px}
.acc-item-table th:nth-child(3),.acc-item-table td:nth-child(3){width:96px}
.acc-item-table th:nth-child(4),.acc-item-table td:nth-child(4){width:112px}
.acc-item-table th:nth-child(5),.acc-item-table td:nth-child(5){width:116px}
.acc-item-table th:nth-child(6),.acc-item-table td:nth-child(6){width:118px}
.acc-item-amt-val{font-weight:900;color:var(--red);font-size:14px}
.acc-item-table th:nth-child(7),.acc-item-table td:nth-child(7){width:42px;text-align:center}
@media (max-width:640px){#modal-account-entry .modal{width:min(100%,calc(100vw - 16px));height:min(92vh,calc(100vh - 16px));padding:18px 14px 22px}#modal-account-entry .form-row,#modal-account-entry .acc-entry-top-row{grid-template-columns:1fr;gap:10px}.acc-item-wrap{max-width:100%;overflow:auto}.acc-item-table th:nth-child(2),.acc-item-table td:nth-child(2){width:210px}}
.acc-ms-section-head{font-size:11px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.acc-ms-selall{background:none;border:none;color:var(--gold);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;padding:0;text-decoration:underline}
.acc-ms-list{display:flex;flex-wrap:wrap;gap:6px;max-height:160px;overflow-y:auto;padding:2px 0 4px}
.acc-ms-item{display:flex;align-items:center;gap:6px;background:#fff;border:1.5px solid rgba(26,18,8,.1);border-radius:999px;padding:6px 12px 6px 8px;cursor:pointer;font-size:12px;color:var(--ink2);user-select:none;transition:background .12s,border-color .12s}
.acc-ms-item.is-on{background:var(--ink);border-color:var(--ink);color:var(--gold2)}
.acc-ms-cb{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
.acc-ms-circle{width:16px;height:16px;flex-shrink:0;border:2px solid rgba(26,18,8,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:transparent;transition:all .12s;font-weight:900}
.acc-ms-item.is-on .acc-ms-circle{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.2);color:var(--gold2)}
.acc-ms-chip{display:inline-flex;align-items:center;gap:4px;background:var(--ink);color:var(--gold2);border-radius:20px;padding:3px 8px 3px 10px;font-size:11px;font-weight:700}
.acc-ms-chip-x{background:none;border:none;color:var(--gold2);cursor:pointer;font-size:13px;padding:0 0 0 2px;line-height:1}
.acc-dd-backdrop{position:fixed;inset:0;z-index:9996;background:rgba(26,18,8,.15)}
.acc-dd-panel{background:#fffaf1;border:1px solid rgba(154,106,33,.22);border-radius:18px;box-shadow:0 20px 52px rgba(26,18,8,.22);overflow-y:auto;animation:accCalIn .12s ease-out}
.acc-dd-section{padding:8px 12px;border-bottom:1px solid rgba(26,18,8,.05)}
.acc-dd-section-list{display:flex;flex-direction:column;gap:3px;padding:2px 0}
@media (min-width:420px){.acc-dd-section{padding:8px 14px}}
.acc-dd-tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:6px 12px 0;border-bottom:1px solid rgba(26,18,8,.06)}
.acc-dd-tab{border:none;background:none;color:var(--ink3);font-size:10px;font-weight:700;cursor:pointer;padding:5px 10px;border-radius:7px 7px 0 0;font-family:inherit;white-space:nowrap}
.acc-dd-tab:hover,.acc-dd-tab:focus-visible{background:rgba(26,18,8,.04);color:var(--ink2)}
.acc-dd-tab.acc-dd-tab-on{background:var(--ink);color:var(--gold2)}
.acc-income-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
.acc-income-table th{position:sticky;top:0;z-index:2;text-align:left;padding:8px 6px;font-size:10px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;border-bottom:1.5px solid var(--cream2);background:#faf3e8;white-space:nowrap;user-select:none}
.acc-income-table th.acc-sort-th{cursor:pointer}
.acc-income-table th.acc-sort-th:hover{color:var(--ink)}
.acc-income-table td{padding:7px 6px;border-bottom:1px solid var(--cream2);vertical-align:middle}
.acc-income-table tr:last-child td{border-bottom:none}
.acc-income-table .acc-list-amt{font-weight:800;text-align:right;white-space:nowrap}
.acc-income-table .acc-list-amt.inc{color:var(--green)}
.acc-col-head{display:flex;align-items:center;gap:3px;min-width:0}
.acc-col-head-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.acc-col-search{display:block;width:100%;min-width:58px;height:26px;margin-top:5px;padding:3px 7px;border:1px solid rgba(26,18,8,.1);border-radius:7px;background:rgba(255,255,255,.7);color:var(--ink);font:600 10px/1.2 inherit;letter-spacing:0;text-transform:none;outline:none;box-sizing:border-box}
.acc-col-search::placeholder{color:var(--ink3);font-weight:500;opacity:.7}
.acc-col-search:focus{border-color:var(--gold);background:#fff;box-shadow:0 0 0 2px rgba(154,106,33,.1)}
.acc-col-search.is-on{border-color:rgba(154,106,33,.45);background:#fff8e8;color:var(--ink)}
.col-flt-icon{display:inline-flex;align-items:center;justify-content:center;margin-left:auto;width:20px;height:20px;border:0;border-radius:5px;background:transparent;cursor:pointer;font:800 11px/1 inherit;color:var(--ink3);user-select:none;flex:0 0 auto}
.col-flt-icon:hover,.col-flt-icon:focus-visible{background:rgba(26,18,8,.08);color:var(--ink);outline:none}
.col-flt-icon.is-on{background:rgba(154,106,33,.12);color:var(--gold)}
.col-flt-panel{background:#fffaf1;border:1px solid rgba(154,106,33,.22);border-radius:14px;box-shadow:0 12px 40px rgba(26,18,8,.2);padding:10px;width:min(260px,calc(100vw - 16px));max-height:min(360px,calc(100vh - 20px));display:flex;flex-direction:column;box-sizing:border-box}
.col-flt-search{width:100%;height:32px;border:1px solid rgba(26,18,8,.12);border-radius:9px;background:#fff;color:var(--ink);font:600 11px/1 inherit;padding:6px 9px;outline:none;box-sizing:border-box}
.col-flt-search:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(154,106,33,.1)}
.col-flt-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0 5px}
.col-flt-link{border:0;background:none;color:var(--gold);font:700 10px/1 inherit;cursor:pointer;padding:3px 0}
.col-flt-options{display:flex;flex-direction:column;gap:2px;overflow-y:auto;min-height:0}
.col-flt-empty{padding:14px 6px;text-align:center;color:var(--ink3);font-size:11px}
/* Modern income detail workspace */
body #modal-account-details.acc-income-detail-open{padding:16px;backdrop-filter:blur(5px);background:rgba(26,18,8,.52)}
body #modal-account-details.acc-income-detail-open .modal{width:min(1180px,calc(100vw - 32px));height:min(820px,calc(100vh - 32px));max-width:none;max-height:calc(100vh - 32px);padding:0;overflow:hidden;border:1px solid rgba(26,18,8,.08);border-radius:22px;background:#fff;box-shadow:0 28px 80px rgba(26,18,8,.24);display:flex;flex-direction:column}
body #modal-account-details.acc-income-detail-open .modal-title{flex:0 0 auto;align-items:center;margin:0;padding:14px 24px 12px;border-bottom:1px solid rgba(26,18,8,.08);font-family:'Tiro Bangla',serif;font-size:22px;font-weight:900;line-height:1.15;color:var(--ink);background:#fff}
body #modal-account-details.acc-income-detail-open .modal-close{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;min-width:34px;padding:0;border:1px solid rgba(26,18,8,.12);border-radius:9px;background:#fff;color:var(--ink2);transition:background .16s,border-color .16s,transform .16s;z-index:6;position:relative}
body #modal-account-details.acc-income-detail-open .modal-close:hover{background:#faf7f2;border-color:rgba(26,18,8,.2);transform:translateY(-1px)}
body #modal-account-details.acc-income-detail-open .modal-close svg{width:16px;height:16px;max-width:16px;max-height:16px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;display:block}
body #modal-account-details.acc-income-detail-open #account-details-root{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:12px 20px 16px;box-sizing:border-box;background:#fff}
.acc-income-shell{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.acc-income-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));min-height:0;border:1px solid rgba(13,116,80,.2);border-radius:12px;background:#fbfdfc;overflow:hidden}
.acc-income-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 12px;text-align:center;min-width:0;position:relative}
.acc-income-stat+.acc-income-stat:before{content:'';position:absolute;left:0;top:18%;bottom:18%;width:1px;background:rgba(26,18,8,.12)}
.acc-income-stat-label{font-size:11px;font-weight:800;color:var(--ink3);line-height:1.15}
.acc-income-stat-value{font-family:'Tiro Bangla',serif;font-size:20px;font-weight:900;line-height:1.05;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.acc-income-stat-value.is-income{color:#087a50;font-size:24px}
.acc-income-stat-value.is-expense{color:var(--red);font-size:24px}
.acc-income-stat-value.is-status{font-size:15px;color:#087a50}
.acc-income-toolbar{display:grid;grid-template-columns:minmax(170px,1fr) minmax(150px,.85fr) auto;gap:8px;align-items:center;flex:0 0 auto}
.acc-income-tool{min-height:38px;display:flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid rgba(26,18,8,.13);border-radius:10px;background:#fff;color:var(--ink2);font:800 12px/1.2 inherit;cursor:pointer;text-align:left;transition:border-color .15s,background .15s,box-shadow .15s}
.acc-income-tool:hover,.acc-income-tool:focus-visible{border-color:rgba(154,106,33,.45);background:#fffaf2;box-shadow:0 0 0 3px rgba(154,106,33,.08);outline:none}
.acc-income-tool svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.acc-income-tool-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.acc-income-tool-copy small{font-size:9px;font-weight:700;color:var(--ink3)}
.acc-income-tool-copy strong{font-size:12px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acc-income-tool-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#087a50;color:#fff;font-size:9px;box-sizing:border-box}
.acc-income-tool.clear{width:auto;color:#9a6a21;border-color:rgba(154,106,33,.45);justify-content:center;padding-inline:16px}
.acc-income-tool.clear:hover{background:#fff8e8}
.acc-income-tool.clear[hidden]{display:none}
#modal-account-details.acc-income-detail-open .acc-table-wrap{border-color:rgba(26,18,8,.11);border-radius:16px;box-shadow:0 8px 24px rgba(26,18,8,.05);scrollbar-color:rgba(26,18,8,.2) transparent}
#modal-account-details.acc-income-detail-open .acc-income-table{min-width:700px;margin:0;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:14px}
#modal-account-details.acc-income-detail-open .acc-income-table th{padding:9px 10px 7px;background:#faf8f4;border-bottom:1px solid rgba(26,18,8,.1);color:var(--ink2);font-size:11px;text-transform:none;letter-spacing:0;z-index:3}
#modal-account-details.acc-income-detail-open .acc-income-table th:nth-child(1){width:21%}
#modal-account-details.acc-income-detail-open .acc-income-table th:nth-child(2){width:auto}
#modal-account-details.acc-income-detail-open .acc-income-table th:nth-child(3){width:21%}
#modal-account-details.acc-income-detail-open .acc-income-table:not(.is-readonly) th:last-child{width:84px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table{min-width:1120px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(1){width:130px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(2){width:130px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(3){width:140px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(4){width:210px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(5){width:155px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(6){width:155px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(7){width:110px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(8){width:145px}
#modal-account-details.acc-income-detail-open .acc-expense-detail-table .acc-list-amt.expense{color:var(--red)}
#modal-account-details.acc-income-detail-open .acc-col-head{gap:5px;margin-bottom:5px}
#modal-account-details.acc-income-detail-open .acc-col-head-label{font-size:12px;font-weight:900;color:var(--ink2)}
#modal-account-details.acc-income-detail-open .col-flt-icon{width:24px;height:24px;border:1px solid rgba(26,18,8,.1);background:#fff;border-radius:6px}
#modal-account-details.acc-income-detail-open .col-flt-icon:hover,#modal-account-details.acc-income-detail-open .col-flt-icon.is-on{border-color:rgba(154,106,33,.38);background:#fff8e8;color:#9a6a21}
#modal-account-details.acc-income-detail-open .acc-col-search{height:30px;margin:0;padding:5px 8px;border-color:rgba(26,18,8,.12);border-radius:8px;background:#fff;font-size:10px;font-weight:700}
#modal-account-details.acc-income-detail-open .acc-income-table td{height:50px;padding:8px 10px;border-bottom:1px solid rgba(26,18,8,.07);background:#fff;color:var(--ink2);box-sizing:border-box}
#modal-account-details.acc-income-detail-open .acc-income-table tbody tr:nth-child(even) td{background:#fcfaf7}
#modal-account-details.acc-income-detail-open .acc-income-table tbody tr:hover td{background:#fff8e8}
#modal-account-details.acc-income-detail-open .acc-income-table td:first-child{font-size:12px!important;font-weight:700;color:var(--ink3)!important;white-space:nowrap}
#modal-account-details.acc-income-detail-open .acc-income-table td:nth-child(2){font-size:14px;font-weight:800;line-height:1.35;white-space:normal;overflow-wrap:anywhere}
#modal-account-details.acc-income-detail-open .acc-income-table .acc-list-amt{font-family:'Tiro Bangla',serif;font-size:15px;font-weight:900;color:#087a50;text-align:right}
.acc-income-actions{display:flex;justify-content:flex-end;gap:6px}
.acc-income-action{display:inline-flex;align-items:center;justify-content:center;width:31px;height:31px;padding:0;border-radius:8px;background:#fff;cursor:pointer;transition:background .15s,transform .15s}
.acc-income-action svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.acc-income-action.edit{border:1px solid rgba(8,122,80,.4);color:#087a50}
.acc-income-action.delete{border:1px solid rgba(193,68,14,.32);color:var(--red)}
.acc-income-action:hover{transform:translateY(-1px)}
.acc-income-action.edit:hover{background:#effaf5}.acc-income-action.delete:hover{background:#fff3ef}
@media (max-width:700px){
 body #modal-account-details.acc-income-detail-open{padding:12px 0 0;align-items:flex-end}
 body #modal-account-details.acc-income-detail-open .modal{width:100vw;height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:24px 24px 0 0;border-bottom:0}
 body #modal-account-details.acc-income-detail-open .modal:before{content:'';position:absolute;top:9px;left:50%;width:44px;height:4px;transform:translateX(-50%);border-radius:999px;background:rgba(26,18,8,.2);z-index:4}
 body #modal-account-details.acc-income-detail-open .modal-title{padding:25px 18px 15px;font-size:21px}
 body #modal-account-details.acc-income-detail-open .modal-close{width:36px;height:36px}
 body #modal-account-details.acc-income-detail-open #account-details-root{padding:14px 14px 16px}
 .acc-income-shell{gap:11px}
 .acc-income-summary{min-height:98px;border-radius:14px}
 .acc-income-stat{gap:5px;padding:10px 3px}
 .acc-income-stat-label{font-size:9px}
 .acc-income-stat-value{font-size:17px}
 .acc-income-stat-value.is-income{font-size:16px;overflow:visible;text-overflow:clip}
 .acc-income-stat-value.is-expense{font-size:16px;overflow:visible;text-overflow:clip}
 .acc-income-stat-value.is-status{font-size:12px}
 .acc-income-toolbar{grid-template-columns:minmax(120px,1fr) minmax(105px,.85fr) auto;gap:7px}
 .acc-income-tool{min-height:40px;padding:7px 9px;border-radius:10px}
 .acc-income-tool svg{width:16px;height:16px}
 .acc-income-tool-copy small{display:none}
 .acc-income-tool-copy strong{font-size:11px}
 .acc-income-tool.clear{padding-inline:10px}
 .acc-income-tool.clear .acc-income-tool-copy{display:none}
 #modal-account-details.acc-income-detail-open .acc-table-wrap{border-radius:14px}
 #modal-account-details.acc-income-detail-open .acc-income-table{min-width:480px;font-size:12px}
 #modal-account-details.acc-income-detail-open .acc-income-table:not(.acc-expense-detail-table) th:nth-child(1){width:22%}
 #modal-account-details.acc-income-detail-open .acc-income-table:not(.acc-expense-detail-table) th:nth-child(3){width:22%}
 #modal-account-details.acc-income-detail-open .acc-income-table:not(.acc-expense-detail-table):not(.is-readonly) th:last-child{width:68px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table{min-width:820px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(1){width:88px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(2){width:90px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(3){width:82px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(4){width:140px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(5){width:95px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(6){width:100px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(7){width:78px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table th:nth-child(8){width:88px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table:not(.is-readonly) th:last-child{width:68px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
 #modal-account-details.acc-income-detail-open .acc-expense-detail-table td.acc-desc-cell{white-space:normal;overflow-wrap:anywhere;line-height:1.3}
 #modal-account-details.acc-income-detail-open .acc-income-table th{padding:6px 5px 5px}
 #modal-account-details.acc-income-detail-open .acc-income-table td{height:auto;min-height:44px;padding:6px 5px}
 #modal-account-details.acc-income-detail-open .acc-col-head{gap:4px;margin-bottom:5px}
 #modal-account-details.acc-income-detail-open .acc-col-head-label{font-size:11px}
 #modal-account-details.acc-income-detail-open .col-flt-icon{width:22px;height:22px;border-radius:6px}
 #modal-account-details.acc-income-detail-open .acc-col-search{height:28px;min-width:0;padding:4px 6px;font-size:10px;border-radius:7px}
 #modal-account-details.acc-income-detail-open .acc-income-table .acc-list-amt{font-size:14px}
 #modal-account-details.acc-income-detail-open .acc-income-action{width:28px;height:28px}
 #modal-account-details.acc-income-detail-open .acc-income-action svg{width:13px;height:13px}
 .col-flt-panel{max-height:min(330px,calc(100vh - 16px))}
}
@media (prefers-reduced-motion:reduce){.acc-income-tool,.acc-income-action,body #modal-account-details.acc-income-detail-open .modal-close{transition:none}}
/* করজ বিস্তারিত মডাল — ডেস্কটপে চওড়া */
body #modal-account-details.acc-qard-detail-open{padding:16px;backdrop-filter:blur(5px);background:rgba(26,18,8,.52)}
body #modal-account-details.acc-qard-detail-open .modal{width:min(1120px,calc(100vw - 32px));max-width:none;height:min(820px,calc(100vh - 32px));max-height:calc(100vh - 32px);padding:18px 20px 16px;overflow:hidden;border:1px solid rgba(26,18,8,.08);border-radius:22px;background:#fff;box-shadow:0 28px 80px rgba(26,18,8,.24);display:flex;flex-direction:column;box-sizing:border-box}
body #modal-account-details.acc-qard-detail-open #account-details-root{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard{flex:1;min-height:0}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table{width:100%;min-width:0;table-layout:fixed}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th,body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td{min-width:0!important}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(1),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(1){width:12%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(2),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(2){width:14%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(3),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(3){width:28%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(4),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(4){width:12%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(5),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(5){width:12%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(6),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(6){width:12%}
body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table th:nth-child(7),body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table td:nth-child(7){width:10%}
body #modal-account-details.acc-qard-detail-open .acc-desc-cell{white-space:normal;overflow-wrap:anywhere}
@media (max-width:700px){body #modal-account-details.acc-qard-detail-open{padding:12px 0 0;align-items:flex-end}body #modal-account-details.acc-qard-detail-open .modal{width:100vw;height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:24px 24px 0 0;border-bottom:0;padding:16px 14px}body #modal-account-details.acc-qard-detail-open .acc-table-wrap--qard .acc-detail-table{min-width:640px;table-layout:auto}}
/* ── Excel import (.xlsx upload) ── */
.acc-add-btns.has-month{grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:700px){.acc-add-btns.has-month{grid-template-columns:repeat(4,minmax(0,1fr))}}
#modal-account-import .modal{width:min(980px,calc(100vw - 24px));max-width:980px;max-height:calc(100vh - 24px);overflow:auto;padding:22px 20px 26px;box-sizing:border-box}
.acc-imp-help{background:rgba(154,106,33,.07);border:1px solid rgba(154,106,33,.14);border-radius:12px;padding:10px 12px;font-size:11px;color:var(--ink3);line-height:1.7;margin-bottom:12px}
.acc-imp-help b{color:var(--ink2)}
.acc-imp-tpl{display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:12px;font-weight:800;color:#7a5118;text-decoration:none;border:none;background:none;padding:0;cursor:pointer;font-family:inherit;border-bottom:1px dashed rgba(122,81,24,.35)}
.acc-imp-drop{border:1.5px dashed rgba(154,106,33,.4);border-radius:14px;background:#fffdf8;padding:22px 16px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:10px}
.acc-imp-drop.is-drag{border-color:var(--gold);background:#fff8e8;border-style:solid}
.acc-imp-drop-title{font-size:14px;font-weight:800;color:var(--ink2);margin:0 0 4px}
.acc-imp-drop-sub{font-size:11px;color:var(--ink3);margin:0}
.acc-imp-file-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 4px;font-size:12px;font-weight:700;color:var(--ink2)}
.acc-imp-file-name{flex:1;min-width:120px;word-break:break-all}
.acc-imp-clear{border:1px solid rgba(26,18,8,.12);background:#fff;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:11px;font-weight:800;color:var(--ink3);cursor:pointer}
.acc-imp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 8px}
.acc-imp-tab{padding:8px 14px;border-radius:9px;border:1.5px solid var(--cream3);background:#fff;color:var(--ink3);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}
.acc-imp-tab.is-on{border-color:var(--gold);background:linear-gradient(135deg,#fff8e8,#f4eadb);color:#7a5118;font-weight:800}
.acc-imp-summary{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.acc-imp-pill{font-size:11px;font-weight:800;border-radius:999px;padding:5px 11px;background:#fff;border:1px solid rgba(26,18,8,.1);color:var(--ink2)}
.acc-imp-pill.ok{color:var(--green);border-color:rgba(13,116,80,.3);background:#f2faf7}
.acc-imp-pill.err{color:var(--red);border-color:rgba(193,68,14,.3);background:#fff5f2}
.acc-imp-wrap{overflow:auto;max-height:340px;border:1px solid rgba(26,18,8,.09);border-radius:12px;background:#fff}
.acc-imp-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.acc-imp-table th{position:sticky;top:0;background:#faf3e8;color:var(--ink3);font-size:10px;font-weight:900;text-align:left;padding:7px 8px;border-bottom:1px solid rgba(26,18,8,.08);white-space:nowrap;z-index:1}
.acc-imp-table td{padding:6px 8px;border-bottom:1px solid rgba(26,18,8,.06);white-space:nowrap;background:#fff;color:var(--ink2)}
.acc-imp-table tr.is-err td{background:#fff6f2}
.acc-imp-table tr.is-saved td{background:#f2faf7}
.acc-imp-status{font-size:10px;font-weight:800}
.acc-imp-status.ok,.acc-imp-status.saved{color:var(--green)}.acc-imp-status.err{color:var(--red)}
#acc-imp-save{margin-top:10px}
/* ── Report workspace ── */
.acc-ws{padding:0 4px 12px}
.acc-ws-top{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.acc-ws-back{border:1px solid rgba(26,18,8,.12);background:#fff;border-radius:12px;padding:9px 13px;font-family:inherit;font-size:12px;font-weight:800;color:var(--ink2);cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(26,18,8,.06)}
.acc-ws-back:active{transform:scale(.98)}
.acc-ws-title{flex:1;font-family:'Tiro Bangla',serif;font-size:17px;font-weight:900;color:var(--ink2)}
.acc-ws-filter{width:auto;flex:0 0 auto;padding:0 12px}
.acc-ws-layout{display:flex;flex-direction:column;gap:10px}
.acc-ws-menu{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:4px;background:rgba(255,255,255,.72);border:1px solid rgba(26,18,8,.07);border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}
.acc-ws-menu-item{flex:0 0 auto;border:none;border-radius:10px;background:none;padding:8px 12px;font-family:inherit;font-size:12px;color:var(--ink3);cursor:pointer;white-space:nowrap}
.acc-ws-menu-item.active{color:#fff;background:linear-gradient(135deg,var(--gold),#9a6a21);font-weight:800;box-shadow:0 6px 14px rgba(154,106,33,.23)}
.acc-ws-body{min-width:0}
@media (min-width:900px){
.acc-ws-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start}
.acc-ws-menu{flex-direction:column;overflow:visible;position:sticky;top:10px;padding:6px}
.acc-ws-menu-item{width:100%;text-align:left;padding:10px 12px;font-size:13px}
}`;
    document.head.appendChild(cs);
  }

  /* ══════════════ EXPENSE ITEMS STATE ══════════════ */
  var _items = [];
  function _blank() { return { category: '', description: '', quantity: '', unit: 'কেজি', unitPrice: '', amount: '' }; }
  var UNIT_OPTIONS = ['', 'কেজি', 'গ্রাম', 'লিটার', 'মিলি', 'পিস', 'টি', 'বস্তা', 'প্যাকেট', 'বোতল', 'সেট', 'জোড়া', 'ফুট', 'গজ', 'হাত', 'দিন', 'জন', 'বার'];
  function unitOptions(value) {
    var current = A.clean(value, '');
    var opts = UNIT_OPTIONS.slice();
    if (current && opts.indexOf(current) < 0) opts.push(current);
    return opts.map(function (u) {
      var label = u || 'মাপ নেই';
      return '<option value="' + esc(u) + '"' + (current === u ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function _renderItems() {
    var c = document.getElementById('acc-items-container');
    if (!c) return;
    var cats = A.Categories.getAll();
    var rows = _items.map(function (item, i) {
      var catOpts = cats.map(function (cat) {
        return '<option value="' + esc(cat) + '"' + (item.category === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
      }).join('');
      return '<tr>' +
        '<td><select class="form-input form-select" onchange="updateAccItem(' + i + ',\'category\',this.value)"><option value="">— খাত —</option>' + catOpts + '</select></td>' +
        '<td><input class="form-input" value="' + esc(item.description) + '" placeholder="পণ্য / বিবরণ" list="acc-desc-dl" oninput="updateAccItem(' + i + ',\'description\',this.value)"></td>' +
        '<td><input class="form-input acc-num-input" value="' + (item.quantity || '') + '" type="text" inputmode="decimal" placeholder="০" oninput="updateAccItem(' + i + ',\'quantity\',this.value)"></td>' +
        '<td><select class="form-input form-select" onchange="updateAccItem(' + i + ',\'unit\',this.value)">' + unitOptions(item.unit) + '</select></td>' +
        '<td><input class="form-input acc-num-input" value="' + (item.unitPrice || '') + '" type="text" inputmode="decimal" placeholder="০" oninput="updateAccItem(' + i + ',\'unitPrice\',this.value)"></td>' +
        '<td><span class="acc-item-amt-val" id="acc-item-amt-' + i + '">' + fa(item.amount || '') + '</span></td>' +
        '<td>' + (_items.length > 1 ? '<button type="button" class="acc-item-del" onclick="removeAccItem(' + i + ')">✕</button>' : '') + '</td>' +
      '</tr>';
    }).join('');
    c.innerHTML = '<div class="acc-item-wrap"><table class="acc-item-table"><thead><tr><th>খাত</th><th>বিবরণ</th><th>পরিমাণ</th><th>মাপ</th><th>একক মূল্য</th><th>মোট</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    _updateGrandTotal();
  }

  function _updateGrandTotal() {
    var total = _items.reduce(function (s, x) { return s + (parseFloat(x.amount) || 0); }, 0);
    var el = document.getElementById('acc-grand-total');
    if (el) el.textContent = fa(total);
  }

  window.addAccItem     = function () { _items.push(_blank()); _renderItems(); };
  window.removeAccItem  = function (i) { _items.splice(i, 1); if (!_items.length) _items.push(_blank()); _renderItems(); };
  window.updateAccItem  = function (i, field, val) {
    if (!_items[i]) return;
    if (field === 'quantity' || field === 'unitPrice') val = sanitizeNumStr(val);
    _items[i][field] = val;
    if (field === 'quantity' || field === 'unitPrice') {
      var q = parseFloat(_items[i].quantity) || 0;
      var p = parseFloat(_items[i].unitPrice) || 0;
      _items[i].amount = q * p;
      var el = document.getElementById('acc-item-amt-' + i);
      if (el) el.textContent = fa(_items[i].amount);
    }
    _updateGrandTotal();
  };

  /* ══════════════ HIJRI DATE PICKER ══════════════ */
  function _keyParts(key) {
    var p = A.parseDateInput(key);
    var hd = A.todayHijri();
    return p || { year: hd.year, month: A.monthFromNo(hd.monthNo), day: hd.day };
  }
  function _dateBtn(label, key, field) {
    var has = key && key !== 'all';
    var text = has ? A.dateLabel({ dateKey: A.toDateKey(key), day: 1 }) : label;
    return '<button type="button" class="acc-date-btn' + (has ? ' is-on' : '') + '" onclick="openAccDatePicker(\'' + field + '\')">' + esc(text) + '</button>';
  }
  function _setPickerPreview() {
    var y = document.getElementById('acc-cal-year');
    var m = document.querySelector('.acc-cal-month.is-on');
    if (!y || !m) return;
    var year = y.value;
    var monthNo = m.getAttribute('data-month');
    document.querySelectorAll('.acc-cal-day').forEach(function (btn) {
      var day = btn.getAttribute('data-day');
      btn.setAttribute('data-key', A.dateKey(year, A.monthFromNo(monthNo), day));
    });
  }
  window._setPickerPreview = _setPickerPreview;
  window.openAccDatePicker = function (field) {
    var old = document.getElementById('acc-date-picker');
    if (old) old.remove();
    var current;
    if (field === 'entry') current = (document.getElementById('acc-date') || {}).value;
    else if (field === 'qardInline') current = (document.getElementById('acc-qard-inline-date') || {}).value;
    else if (field === 'from') current = _fromKey;
    else current = _toKey;
    var parts = _keyParts(current);
    var activeMonth = A.monthNo(parts.month) || 10;
    var months = A.HIJRI_MONTHS.map(function (m, i) {
      var no = i + 1;
      return '<button type="button" class="acc-cal-month' + (no === activeMonth ? ' is-on' : '') + '" data-month="' + no + '" onclick="selectAccCalMonth(this)">' + esc(m) + '</button>';
    }).join('');
    var days = Array.from({ length: 30 }, function (_, i) {
      var d = i + 1;
      return '<button type="button" class="acc-cal-day' + (d === A.num(parts.day) ? ' is-on' : '') + '" data-day="' + d + '" onclick="selectAccCalDay(\'' + field + '\',this)">' + bn(d) + '</button>';
    }).join('');
    var el = document.createElement('div');
    el.id = 'acc-date-picker';
    el.className = 'acc-cal-backdrop';
    el.innerHTML = '<div class="acc-cal" onclick="event.stopPropagation()">' +
      '<div class="acc-cal-head"><div class="acc-cal-title">হিজরী তারিখ নির্বাচন</div><button type="button" class="acc-cal-close" onclick="closeAccDatePicker()">✕</button></div>' +
      '<div class="acc-cal-year"><button type="button" class="acc-cal-month" onclick="stepAccCalYear(-1)">−</button><input class="form-input" id="acc-cal-year" type="number" value="' + esc(parts.year) + '" oninput="_setPickerPreview()"><button type="button" class="acc-cal-month" onclick="stepAccCalYear(1)">＋</button></div>' +
      '<div class="acc-cal-months">' + months + '</div><div class="acc-cal-days">' + days + '</div>' +
      '</div>';
    el.onclick = window.closeAccDatePicker;
    document.body.appendChild(el);
    _setPickerPreview();
  };
  window.closeAccDatePicker = function () {
    var el = document.getElementById('acc-date-picker');
    if (el) el.remove();
  };
  window.selectAccCalMonth = function (btn) {
    document.querySelectorAll('.acc-cal-month[data-month]').forEach(function (b) { b.classList.remove('is-on'); });
    btn.classList.add('is-on');
    _setPickerPreview();
  };
  window.stepAccCalYear = function (delta) {
    var y = document.getElementById('acc-cal-year');
    if (!y) return;
    y.value = A.num(y.value) + delta;
    _setPickerPreview();
  };
  window.selectAccCalDay = function (field, btn) {
    var key = btn.getAttribute('data-key');
    if (field === 'entry') {
      var input = document.getElementById('acc-date');
      if (input) input.value = key;
    } else if (field === 'qardInline') {
      var qin = document.getElementById('acc-qard-inline-date');
      if (qin) qin.value = key;
    } else if (field === 'from') {
      _fromKey = key; _monFs = []; _dayF = 'all';
    } else if (field === 'to') {
      _toKey = key; _monFs = []; _dayF = 'all';
    }
    window.closeAccDatePicker();
    if (field !== 'entry') rerenderAccountsView();
  };
  window.clearAccDateRange = function () {
    _fromKey = 'all'; _toKey = 'all';
    rerenderAccountsView();
  };
  window.clearAccDateRangeOnly = function () {
    _fromKey = 'all'; _toKey = 'all';
    _rebuildMainFilterDropdown();
  };
  function _sheet(title, body) {
    var old = document.getElementById('acc-sheet');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'acc-sheet';
    el.className = 'acc-sheet-backdrop';
    el.innerHTML = '<div class="acc-sheet" onclick="event.stopPropagation()">' +
      '<div class="acc-sheet-head"><div class="acc-sheet-title">' + esc(title) + '</div><button type="button" class="acc-sheet-close" onclick="closeAccSheet()">✕</button></div>' +
      body + '</div>';
    el.onclick = window.closeAccSheet;
    document.body.appendChild(el);
  }
  window.closeAccSheet = function () {
    var el = document.getElementById('acc-sheet');
    if (el) el.remove();
  };
  window.setAccFilter = function (field, value) {
    if (field === 'day') _dayF = value;
  };
  window.applyAccFilters = function () {
    window.closeMainFilterDropdown();
    rerenderAccountsView();
  };
  window.resetAccFilters = function () {
    _monFs = []; _accFs = []; _catFs = []; _yearFs = []; _dayF = 'all'; _fromKey = 'all'; _toKey = 'all';
    clearTimeout(_colSearchTimer);
    _colFilters = {}; _colSearch = {}; _colFltOpen = null;
    window.closeColFilter();
    window.closeMainFilterDropdown();
    rerenderAccountsView();
  };

  /* ── multi-select toggle helpers ── */
  function _msToggle(arr, val, checked) {
    var idx = arr.indexOf(val);
    if (checked && idx < 0) arr.push(val);
    if (!checked && idx >= 0) arr.splice(idx, 1);
  }
  window.toggleAccMonth = function (val, checked) { _msToggle(_monFs, A.monthKey(val), checked); };
  window.toggleAccAccount = function (val, checked) { _msToggle(_accFs, val, checked); };
  window.toggleAccCat = function (val, checked) { _msToggle(_catFs, val, checked); };
  window.toggleAccYear = function (val, checked) { _msToggle(_yearFs, val, checked); };
  window.toggleAllAccMonths = function () {
    _monFs = _monFs.length ? [] : A.MONTHS.slice();
    _rebuildMainFilterDropdown();
  };
  window.toggleAllAccAccounts = function () {
    _accFs = _accFs.length ? [] : expenseBookKeys();
    _rebuildMainFilterDropdown();
  };
  window.toggleAllAccCats = function () {
    var all = A.Categories ? A.Categories.getAll() : [];
    _catFs = _catFs.length ? [] : all.slice();
    _rebuildMainFilterDropdown();
  };
  window.toggleAllAccYears = function () {
    _yearFs = _yearFs.length ? [] : getAllYears().slice();
    _rebuildMainFilterDropdown();
  };

  function _msList(items, activeArr, toggleFn, toggleAllFn) {
    var allOn = activeArr.length === 0;
    var selAllLabel = allOn ? 'বাতিল সব' : 'সব নির্বাচন';
    var chips = items.map(function (item) {
      var val = typeof item === 'object' ? item[0] : item;
      var label = typeof item === 'object' ? item[1] : item;
      var on = allOn || activeArr.indexOf(val) >= 0;
      return '<label class="acc-ms-item' + (on ? ' is-on' : '') + '">' +
        '<input type="checkbox" class="acc-ms-cb" ' + (on ? 'checked' : '') + ' onchange="' + toggleFn + '(\'' + esc(val) + '\',this.checked)">' +
        '<span class="acc-ms-circle">✓</span>' +
        '<span>' + esc(label) + '</span></label>';
    }).join('');
    return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<div class="acc-ms-section-head">' + (arguments[4] || '') + '</div>' +
      '<button type="button" class="acc-ms-selall" onclick="' + toggleAllFn + '()">' + selAllLabel + '</button></div>' +
      '<div class="acc-ms-list">' + chips + '</div>';
  }

  /* ── Global main filter dropdown ── */
  var _mainFilterDropdownTrigger = null;
  var _mainFilterMode = 'full';
  function _rebuildMainFilterDropdown() {
    var trigger = _mainFilterDropdownTrigger;
    var mode = _mainFilterMode;
    var scrollTop = 0;
    var existing = document.getElementById('acc-main-filter-dropdown');
    if (existing) {
      var panel = existing.querySelector('.acc-dd-panel');
      if (panel) scrollTop = panel.scrollTop;
    }
    window.closeMainFilterDropdown();
    window.closeAccFilterDropdown();
    if (trigger) { openAccFilterSheet(trigger, mode); var p = document.querySelector('.acc-dd-panel'); if (p) p.scrollTop = scrollTop; }
  }
  window._rebuildMainFilterDropdown = _rebuildMainFilterDropdown;
  window.closeMainFilterDropdown = function () {
    var el = document.getElementById('acc-main-filter-dropdown');
    if (el) el.remove();
    _mainFilterDropdownTrigger = null;
  };
  window.openAccFilterSheet = function (triggerEl, mode) {
    var existing = document.getElementById('acc-main-filter-dropdown');
    if (existing) { existing.remove(); _mainFilterDropdownTrigger = null; return; }
    window.closeAccFilterDropdown();
    _mainFilterMode = mode || 'full';
    if (!triggerEl) { normalizeMonthFilters(); _sheetBuildMainFilter(_mainFilterMode); return; }
    _mainFilterDropdownTrigger = triggerEl;
    normalizeMonthFilters();
    _sheetBuildMainFilter(_mainFilterMode);
  };
  function _sheetBuildMainFilter(mode) {
    var existing = document.getElementById('acc-main-filter-dropdown');
    if (existing) existing.remove();
    var years = getAllYears();
    var isIncome = mode === 'income';
    /* collect sections + tab labels */
    var sections = [];
    var secIdx = 0;
    function _ddGroup(title, items, activeArr, toggleFn, toggleAllFn) {
      var sid = 'mfs-' + (secIdx++);
      var activeCount = activeArr.length;
      var itemsHtml = items.map(function (item) {
        var val = typeof item === 'object' ? item[0] : item;
        var label = typeof item === 'object' ? item[1] : item;
        var on = activeArr.indexOf(val) >= 0;
        return '<label class="acc-ms-item' + (on ? ' is-on' : '') + '" style="border-radius:10px;display:flex;width:100%;box-sizing:border-box">' +
          '<input type="checkbox" class="acc-ms-cb" ' + (on ? 'checked' : '') + ' onchange="' + toggleFn + '(\'' + esc(val) + '\',this.checked);window._refreshAccDropdownUI()">' +
          '<span class="acc-ms-circle">✓</span>' +
          '<span style="flex:1">' + esc(label) + '</span></label>';
      }).join('');
      var allOn = activeCount === 0;
      var html = '<div class="acc-dd-section" id="' + sid + '">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
        '<div class="acc-ms-section-head">' + title + ' <span class="acc-dds-count" style="font-size:9px;font-weight:400;color:var(--ink3)">(' + bn(activeCount || items.length) + (activeCount ? '/' + bn(items.length) : '') + ')</span></div>' +
        '<button type="button" class="acc-ms-selall" onclick="' + toggleAllFn + '()">' + (allOn ? 'বাতিল সব' : 'সব নির্বাচন') + '</button></div>' +
        '<div class="acc-dd-section-list">' + itemsHtml + '</div>' +
        '<div class="acc-dds-chip-wrap" style="margin-top:4px;display:' + (activeCount ? 'flex' : 'none') + ';flex-wrap:wrap;gap:4px"><span class="acc-chip">' + bn(activeCount) + ' টি</span></div>' +
        '</div>';
      sections.push({ id: sid, title: title });
      return html;
    }
    var dayOpts = '<option value="all">সব দিন</option>' + Array.from({ length: 30 }, function (_, i) { var d = String(i + 1); return '<option value="' + d + '"' + (String(_dayF) === d ? ' selected' : '') + '>' + bn(d) + ' তারিখ</option>'; }).join('') +
      '<option value="__none"' + (_dayF === '__none' ? ' selected' : '') + '>দিন নেই</option>';
    var yrs = years.map(function (y) { return [y, A.bn ? A.bn(y) : y]; });
    var yearSection = years.length ? _ddGroup('বছর (হিজরী)', yrs, _yearFs, 'toggleAccYear', 'toggleAllAccYears') : '';
    var monthSection = _ddGroup('মাস', A.MONTHS, _monFs, 'toggleAccMonth', 'toggleAllAccMonths');
    var accSection = isIncome ? '' : _ddGroup('হিসাব বই', expenseBookEntries(), _accFs, 'toggleAccAccount', 'toggleAllAccAccounts');
    var cats = isIncome ? [] : (A.Categories ? A.Categories.getAll() : []);
    var catSection = isIncome ? '' : _ddGroup('খাত / ক্যাটাগরি', cats, _catFs, 'toggleAccCat', 'toggleAllAccCats');
    var rangeFromOn = _fromKey !== 'all', rangeToOn = _toKey !== 'all';
    var rangeSid = 'mfs-' + (secIdx++);
    var rangeSection = isIncome ? '' : '<div class="acc-dd-section" id="' + rangeSid + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<div class="acc-ms-section-head">তারিখ সীমা</div>' +
      ((rangeFromOn || rangeToOn) ? '<button type="button" class="acc-ms-selall" onclick="clearAccDateRangeOnly()">সাফ</button>' : '') +
      '</div>' +
      '<div class="acc-range-picks">' +
      '<button type="button" class="acc-range-pick' + (rangeFromOn ? ' is-on' : '') + '" onclick="_rebuildMainFilterDropdown();openAccRangeSheet()"><small>শুরু</small><span>' + esc(rangeFromOn ? A.dateLabel({ dateKey: _fromKey, day: 1 }) : 'নির্বাচন করুন') + '</span></button>' +
      '<button type="button" class="acc-range-pick' + (rangeToOn ? ' is-on' : '') + '" onclick="_rebuildMainFilterDropdown();openAccRangeSheet()"><small>শেষ</small><span>' + esc(rangeToOn ? A.dateLabel({ dateKey: _toKey, day: 1 }) : 'নির্বাচন করুন') + '</span></button>' +
      '</div></div>';
    if (!isIncome) sections.push({ id: rangeSid, title: 'তারিখ সীমা' });
    var daySid = 'mfs-' + (secIdx++);
    var daySection = isIncome ? '' : '<div class="acc-dd-section" id="' + daySid + '">' +
      '<div class="acc-ms-section-head" style="margin-bottom:6px">দিন</div>' +
      '<select class="acc-sel" onchange="setAccFilter(\'day\',this.value);window._refreshAccDropdownUI()" style="width:100%">' + dayOpts + '</select></div>';
    if (!isIncome) sections.push({ id: daySid, title: 'দিন' });
    /* build tabs — "সব" first */
    var tabsHtml = '<div class="acc-dd-tabs">' +
      '<button type="button" class="acc-dd-tab acc-dd-tab-on" data-target="all" onclick="window._filterByTab(this)">সব</button>' +
      sections.map(function (s) {
        return '<button type="button" class="acc-dd-tab" data-target="' + s.id + '" onclick="window._filterByTab(this)">' + esc(s.title) + '</button>';
      }).join('') + '</div>';
    var totalActive = _yearFs.length + _monFs.length + _accFs.length + _catFs.length + (_fromKey !== 'all' ? 1 : 0) + (_toKey !== 'all' ? 1 : 0) + (_dayF !== 'all' ? 1 : 0);
    var el = document.createElement('div');
    el.id = 'acc-main-filter-dropdown';
    el.className = 'acc-dd-backdrop';
    el.onclick = closeMainFilterDropdown;
    el.innerHTML = '<div class="acc-dd-panel" onclick="event.stopPropagation()">' +
      '<div class="acc-sheet-head" style="padding:10px 12px 6px"><div class="acc-sheet-title">ফিল্টার' + (totalActive ? ' (' + bn(totalActive) + ')' : '') + '</div><button type="button" class="acc-sheet-close" onclick="closeMainFilterDropdown()">✕</button></div>' +
      tabsHtml +
      '<div class="acc-filter-bar" style="margin:2px 12px 6px;position:sticky;top:0;z-index:2;background:#fffaf1;padding:6px 0;border-radius:10px"><button type="button" class="acc-btn acc-btn-inc" onclick="applyAccFilters()" style="border-radius:10px;flex:2">প্রয়োগ করুন</button><button type="button" class="acc-date-clear" onclick="resetAccFilters()" style="flex:1">সব সাফ</button></div>' +
      (yearSection || '') +
      monthSection +
      accSection +
      catSection +
      rangeSection +
      daySection +
      '</div>';
    var trigger = _mainFilterDropdownTrigger;
    if (trigger) {
      var rect = trigger.getBoundingClientRect();
      var panelEl = el.querySelector('.acc-dd-panel');
      var dw = window.innerWidth >= 520 ? 360 : (window.innerWidth - 12);
      panelEl.style.position = 'fixed';
      panelEl.style.top = Math.min(rect.bottom + 4, window.innerHeight - 20) + 'px';
      panelEl.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - dw - 4)) + 'px';
      panelEl.style.width = dw + 'px';
      panelEl.style.maxHeight = Math.min(560, window.innerHeight - rect.bottom - 24) + 'px';
      panelEl.style.overflowY = 'auto';
    }
    document.body.appendChild(el);
  };
  window.setAccSort = function (value) {
    _sortF = value;
    window.closeAccSheet();
    window.closeMainFilterDropdown();
    rerenderAccountsView();
  };
  window.openAccSortSheet = function () {
    var opts = [
      ['date_asc','তারিখ: পুরাতন আগে'], ['date_desc','তারিখ: নতুন আগে'],
      ['amount_desc','টাকা: বেশি আগে'], ['amount_asc','টাকা: কম আগে'],
      ['newest','এন্ট্রি: নতুন আগে'], ['oldest','এন্ট্রি: পুরাতন আগে'],
    ].map(function (s) {
      return '<button type="button" class="acc-sort-opt' + (_sortF === s[0] ? ' is-on' : '') + '" onclick="setAccSort(\'' + s[0] + '\')">' + s[1] + '</button>';
    }).join('');
    _sheet('সাজানোর ধরন', '<div class="acc-sort-list">' + opts + '</div>');
  };
  var _rangeFocus = 'from';
  window.openAccRangeSheet = function () {
    _rangeFocus = _fromKey !== 'all' ? 'to' : 'from';
    var body = '<div class="acc-range-picks">' +
      '<button type="button" id="acc-range-from" class="acc-range-pick" onclick="setAccRangeFocus(\'from\')"><small>শুরু</small><span>' + esc(_fromKey === 'all' ? 'নির্বাচন করুন' : A.dateLabel({ dateKey: _fromKey, day: 1 })) + '</span></button>' +
      '<button type="button" id="acc-range-to" class="acc-range-pick" onclick="setAccRangeFocus(\'to\')"><small>শেষ</small><span>' + esc(_toKey === 'all' ? 'নির্বাচন করুন' : A.dateLabel({ dateKey: _toKey, day: 1 })) + '</span></button>' +
      '</div><div id="acc-range-cal"></div>' +
      '<button type="button" class="acc-date-clear" onclick="clearAccDateRange();closeAccSheet()" style="width:100%;margin-top:10px">তারিখ পরিষ্কার</button>';
    _sheet('তারিখ সীমা', body);
    window.setAccRangeFocus(_rangeFocus);
  };
  window.setAccRangeFocus = function (field) {
    _rangeFocus = field;
    var f = document.getElementById('acc-range-from'), t = document.getElementById('acc-range-to');
    if (f) f.classList.toggle('is-on', field === 'from');
    if (t) t.classList.toggle('is-on', field === 'to');
    var key = field === 'from' ? _fromKey : _toKey;
    var parts = _keyParts(key);
    var monthNo = A.monthNo(parts.month) || 10;
    var months = A.HIJRI_MONTHS.map(function (m, i) {
      var no = i + 1;
      return '<button type="button" class="acc-cal-month' + (no === monthNo ? ' is-on' : '') + '" data-month="' + no + '" onclick="selectAccCalMonth(this)">' + esc(m) + '</button>';
    }).join('');
    var days = Array.from({ length: 30 }, function (_, i) {
      var d = i + 1;
      return '<button type="button" class="acc-cal-day' + (d === A.num(parts.day) ? ' is-on' : '') + '" data-day="' + d + '" onclick="selectAccRangeDay(this)">' + bn(d) + '</button>';
    }).join('');
    var cal = document.getElementById('acc-range-cal');
    if (cal) cal.innerHTML = '<div class="acc-cal-year"><button type="button" class="acc-cal-month" onclick="stepAccCalYear(-1)">−</button><input class="form-input" id="acc-cal-year" type="number" value="' + esc(parts.year) + '" oninput="_setPickerPreview()"><button type="button" class="acc-cal-month" onclick="stepAccCalYear(1)">＋</button></div><div class="acc-cal-months">' + months + '</div><div class="acc-cal-days">' + days + '</div>';
    _setPickerPreview();
  };
  window.selectAccRangeDay = function (btn) {
    var key = btn.getAttribute('data-key');
    if (_rangeFocus === 'from') { _fromKey = key; _rangeFocus = 'to'; }
    else _toKey = key;
    _monFs = []; _dayF = 'all';
    window.openAccRangeSheet();
    if (_fromKey !== 'all' && _toKey !== 'all') { window.closeAccSheet(); rerenderAccountsView(); }
  };

  function renderEditReasonField() {
    var modal = document.querySelector('#modal-account-entry .modal');
    if (!modal) return;
    var submit = modal.querySelector('.submit-btn');
    var wrap = document.getElementById('acc-edit-reason-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'acc-edit-reason-wrap';
      wrap.className = 'form-group';
      wrap.style.marginTop = '8px';
      wrap.innerHTML =
        '<label class="form-label">সংশোধনের কারণ</label>' +
        '<textarea class="form-input form-textarea" id="acc-edit-reason" rows="2" placeholder="জিম্মাদারের অনুমতির জন্য কারণ লিখুন"></textarea>' +
        '<div style="font-size:10px;color:var(--ink3);margin-top:4px">২৪ ঘণ্টার বেশি পুরনো এন্ট্রি সরাসরি বদলাবে না; বার্তায় অনুমোদন অনুরোধ যাবে।</div>';
      if (submit && submit.parentNode) submit.parentNode.insertBefore(wrap, submit);
      else modal.appendChild(wrap);
    }
    wrap.style.display = _editNeedsApproval ? '' : 'none';
    if (!_editNeedsApproval) {
      var reasonEl = document.getElementById('acc-edit-reason');
      if (reasonEl) reasonEl.value = '';
    }
    if (submit) submit.textContent = _editNeedsApproval ? 'অনুমোদন অনুরোধ পাঠান' : 'সংরক্ষণ করুন';
  }

  function submitEntryApproval(type, originalEntry, proposed) {
    var reasonEl = document.getElementById('acc-edit-reason');
    var reason = reasonEl ? reasonEl.value.trim() : '';
    if (!reason) { showToast('সংশোধনের কারণ লিখুন'); return; }
    requestEntryChange('edit', type, originalEntry, reason, proposed).then(function (ok) {
      if (ok) {
        showToast('এডিট অনুরোধ বার্তায় পাঠানো হয়েছে');
        _editEntryId = null;
        _editEntryType = '';
        _editNeedsApproval = false;
        closeModal('account-entry');
        refreshAccountsViews();
      } else {
        showToast('অনুরোধ পাঠানো যায়নি');
      }
    });
  }

  function ensureQardAccountOption(show) {
    var accSel = document.getElementById('acc-exp-account');
    if (!accSel) return;
    var opt = accSel.querySelector('option[value="qard"]');
    if (show) {
      if (!opt) {
        opt = document.createElement('option');
        opt.value = 'qard';
        opt.textContent = 'করজে হাসানা';
        accSel.appendChild(opt);
      }
    } else if (opt) {
      opt.remove();
    }
  }

  function resetAccEntryAccountChrome() {
    ensureQardAccountOption(false);
    var row = document.getElementById('acc-exp-account-row');
    if (row) row.style.display = '';
    var si = document.getElementById('acc-exp-supplier');
    if (si) si.removeAttribute('list');
    var pickRow = document.getElementById('acc-qard-cat-pick-row');
    if (pickRow) pickRow.style.display = 'none';
    var pick = document.getElementById('acc-qard-cat-pick');
    if (pick) {
      pick.innerHTML = '<option value="">— ইতিপূর্বে যুক্ত খাত বেছে নিন —</option>';
      pick.value = '';
    }
  }

  /* ── আগের এন্ট্রি থেকে টাইপ-সাজেশন (datalist): সরবরাহকারী, বিবরণ, আয়ের উৎস।
     একই দোকান/পণ্যের বানান একরকম থাকলে রিপোর্টে আলাদা হয়ে যায় না। ── */
  function refreshAccDatalists() {
    function fill(id, values) {
      var dl = document.getElementById(id);
      if (!dl) {
        dl = document.createElement('datalist');
        dl.id = id;
        document.body.appendChild(dl);
      }
      dl.innerHTML = values.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
    }
    var byBn = function (a, b) { return a.localeCompare(b, 'bn'); };
    var descs = [], seenD = {};
    A.Expense.getAll().forEach(function (r) {
      if (r.account === 'qard') return;
      var d = A.clean(r.description, '');
      if (d && !seenD[d]) { seenD[d] = 1; descs.push(d); }
    });
    var srcs = [], seenS = {};
    A.Income.getAll().forEach(function (r) {
      var s = A.clean(r.note, '') || A.clean(r.source, '');
      if (s && !seenS[s]) { seenS[s] = 1; srcs.push(s); }
    });
    fill('acc-sup-dl', A.Expense.suppliers().sort(byBn));
    fill('acc-desc-dl', descs.sort(byBn));
    fill('acc-inc-src-dl', srcs.sort(byBn));
  }

  /* ══════════════ OPEN MODAL (new + edit) ══════════════ */
  window.openAccModal = function (type, entryId, opts) {
    opts = opts || {};
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি বদলানো যায় না'); return; }
    resetAccEntryAccountChrome();
    refreshAccDatalists();
    _editEntryId   = entryId || null;
    _editEntryType = type;
    var entry = entryId
      ? (type === 'income' ? A.Income.getById(entryId) : A.Expense.getById(entryId))
      : null;
    _editNeedsApproval = !!(entry && !isAdminSession() && entryAgeHours(entry) > 24);
    var qardGiveOnly = !!(opts.qardGiveOnly && type === 'expense' && !entryId);
    var forceQardUi = type === 'expense' && ((entry && entry.account === 'qard') || qardGiveOnly);

    _items = [_blank()];
    var incF = document.getElementById('acc-income-fields');
    var expF = document.getElementById('acc-expense-fields');
    var expTop = document.getElementById('acc-expense-top-fields');
    if (incF) incF.style.display = type === 'income' ? '' : 'none';
    if (expF) expF.style.display = type === 'expense' ? '' : 'none';
    if (expTop) expTop.classList.toggle('is-open', type === 'expense');
    var t = document.getElementById('account-modal-title');
    if (t) {
      if (type === 'expense' && forceQardUi) {
        t.textContent = entryId ? 'করজে হাসানা — ব্যয় এডিট' : 'করজে হাসানা — নতুন করজ';
      } else {
        t.textContent = entryId
          ? (type === 'income' ? 'আয় এডিট' : 'ব্যয় এডিট')
          : (type === 'income' ? 'আয় এন্ট্রি' : 'ব্যয় এন্ট্রি');
      }
    }
    document.getElementById('account-entry-type').value = type;

    var hd = A.todayHijri();
    var dateEl = document.getElementById('acc-date');
    if (dateEl) {
      dateEl.value = entry
        ? (entry.dateKey || A.dateKey(entry.hijriYear, entry.month, entry.day))
        : A.dateKey(hd.year, A.monthFromNo(hd.monthNo), hd.day);
      dateEl.readOnly = true;
      dateEl.onclick = function () { window.openAccDatePicker('entry'); };
      dateEl.onfocus = dateEl.onclick;
      dateEl.style.cursor = 'pointer';
    }

    if (type === 'income') {
      var ae = document.getElementById('acc-inc-amount');
      var ne = document.getElementById('acc-inc-note');
      if (ae) ae.value = entry ? (entry.amount || '') : '';
      if (ne) ne.value = entry ? (A.clean(entry.note, '') || A.clean(entry.source, '')) : '';
    } else {
      var accSel     = document.getElementById('acc-exp-account');
      var se         = document.getElementById('acc-exp-supplier');
      var receiptEl  = document.getElementById('acc-exp-receipt');
      var qardAmtEl  = document.getElementById('acc-qard-amt');
      var entryAccount = (entry ? entry.account : null) || (qardGiveOnly ? 'qard' : 'matbakh');
      if (forceQardUi) {
        ensureQardAccountOption(true);
        var accRow = document.getElementById('acc-exp-account-row');
        if (accRow) accRow.style.display = 'none';
      }
      if (accSel) accSel.value = entryAccount;
      if (se) {
        se.value = entry
          ? (entry.account === 'qard'
            ? (A.clean(entry.category, '') || A.clean(entry.description, '') || A.clean(entry.supplier, ''))
            : A.clean(entry.supplier, ''))
          : '';
      }
      if (receiptEl) receiptEl.value = entry ? (entry.receiptNo || '') : '';
      if (qardAmtEl) qardAmtEl.value = (entry && entry.account === 'qard') ? (entry.amount || '') : '';
      if (entry && entry.account !== 'qard') {
        _items = [{ category: A.clean(entry.category, ''), description: A.clean(entry.description, ''), quantity: entry.quantity || '', unit: entry.unit || 'কেজি', unitPrice: entry.unitPrice || '', amount: entry.amount || '' }];
      }
      /* account-ভেদে form sections দেখাও/লুকাও */
      window.onAccExpAccountChange(entryAccount);
      _renderItems();
      window.setAccPayment((entry && entry.account !== 'qard') ? (entry.paymentMethod || 'cash') : 'cash');
    }
    renderEditReasonField();
    openModal('account-entry');
  };

  window.onAccQardInlineCatPick = function (v) {
    var inp = document.getElementById('acc-qard-inline-cat-text');
    if (!inp) return;
    if (v) inp.value = v;
  };

  window.toggleQardGiveInline = function (forceClose) {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি বদলানো যায় না'); return; }
    if (_detailAccount !== 'qard') return;
    if (forceClose === true) _qardGiveInlineOpen = false;
    else _qardGiveInlineOpen = !_qardGiveInlineOpen;
    if (_qardGiveInlineOpen) {
      _qardTab = 'entries';
      _payQardOpenBucket = null;
    }
    renderAccAccountDetails(_detailAccount);
  };

  window.saveQardGiveInline = async function () {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি বদলানো যায় না'); return; }
    try {
      var parsed = A.parseDateInput((document.getElementById('acc-qard-inline-date') || {}).value);
      if (!parsed || !parsed.year || !parsed.month || !parsed.day) { showToast('তারিখ লিখুন: সন-মাস-দিন'); return; }
      var qardAmt = parseFloat((document.getElementById('acc-qard-inline-amt') || {}).value) || 0;
      if (!qardAmt || qardAmt <= 0) { showToast('পরিমাণ লিখুন'); var ae = document.getElementById('acc-qard-inline-amt'); if (ae) ae.focus(); return; }
      var cat = ((document.getElementById('acc-qard-inline-cat-text') || {}).value || '').trim();
      if (!cat) { showToast('খাতের নাম লিখুন'); var ce = document.getElementById('acc-qard-inline-cat-text'); if (ce) ce.focus(); return; }
      await A.Expense.add({
        account: 'qard',
        hijriYear: parsed.year,
        month: parsed.month,
        day: parsed.day,
        category: cat,
        description: '',
        quantity: '',
        unit: '',
        unitPrice: '',
        amount: qardAmt,
        supplier: '',
        receiptNo: '',
        paymentMethod: 'cash',
      });
      showToast('করজ সংরক্ষিত ✓');
      _qardGiveInlineOpen = false;
      refreshAccountsViews();
    } catch (err) {
      console.warn('[Accounts] inline qard save failed', err);
      showToast('ডাটাবেজে সংরক্ষণ হয়নি');
      if (A.bootstrapRemote) {
        try { await A.bootstrapRemote(); refreshAccountsViews(); } catch (e) {}
      }
    }
  };

  /** পুরনো onclick সামঞ্জস্য — এখন ইনলাইন টগল */
  window.openQardGiveModal = function () {
    window.toggleQardGiveInline();
  };

  /* করজে হাসানা সিলেক্ট হলে ব্যয় ফর্ম সংক্ষিপ্ত করো */
  window.onAccExpAccountChange = function (val) {
    var isQard = val === 'qard';
    var receiptRow  = document.getElementById('acc-exp-receipt-row');
    var payRow      = document.getElementById('acc-exp-pay-row');
    var itemsSection = document.getElementById('acc-items-section');
    var qardAmtRow  = document.getElementById('acc-qard-amt-row');
    var supLabel    = document.getElementById('acc-exp-supplier-label');
    var supInput    = document.getElementById('acc-exp-supplier');
    if (receiptRow)   receiptRow.style.display   = isQard ? 'none' : '';
    if (payRow)       payRow.style.display        = isQard ? 'none' : '';
    if (itemsSection) itemsSection.style.display  = isQard ? 'none' : '';
    if (qardAmtRow)   qardAmtRow.style.display    = isQard ? '' : 'none';
    if (supLabel)     supLabel.textContent         = isQard ? 'খাত (করজ আদায়ের গ্রুপ)' : 'সরবরাহকারী';
    if (isQard && supInput) supInput.placeholder  = 'নতুন খাতের নাম লিখুন (তালিকায় না থাকলে)';
    if (!isQard && supInput) supInput.placeholder = 'নাম / দোকান';
    var pickRow = document.getElementById('acc-qard-cat-pick-row');
    if (pickRow) pickRow.style.display = isQard ? '' : 'none';
    if (isQard) {
      if (supInput) supInput.removeAttribute('list');
      fillQardCategorySelect();
    } else if (supInput) {
      supInput.setAttribute('list', 'acc-sup-dl');
    }
  };

  /** ড্রপডাউন থেকে বাছাই → খাতের টেক্সট ঘরে কপি */
  window.onAccQardCatPick = function (v) {
    var inp = document.getElementById('acc-exp-supplier');
    if (!inp) return;
    if (v) inp.value = v;
  };

  window.setAccPayment = function (val) {
    _paymentMethod = val === 'due' ? 'due' : 'cash';
    var cashBtn = document.getElementById('acc-pay-cash');
    var dueBtn  = document.getElementById('acc-pay-due');
    if (!cashBtn || !dueBtn) return;
    if (_paymentMethod === 'due') {
      cashBtn.style.cssText = 'flex:1;padding:9px;border-radius:8px;border:1.5px solid var(--cream3);background:#fff;color:var(--ink3);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer';
      dueBtn.style.cssText  = 'flex:1;padding:9px;border-radius:8px;border:1.5px solid var(--red);background:var(--red-light);color:var(--red);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer';
    } else {
      cashBtn.style.cssText = 'flex:1;padding:9px;border-radius:8px;border:1.5px solid var(--green2);background:var(--green-light);color:var(--green);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer';
      dueBtn.style.cssText  = 'flex:1;padding:9px;border-radius:8px;border:1.5px solid var(--cream3);background:#fff;color:var(--ink3);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer';
    }
  };

  /* ══════════════ SAVE (new + edit) ══════════════ */
  window.saveAccountEntry = async function () {
    try {
    var type   = document.getElementById('account-entry-type').value;
    var parsed = A.parseDateInput((document.getElementById('acc-date') || {}).value);
    if (!parsed || !parsed.year || !parsed.month || !parsed.day) { showToast('তারিখ লিখুন: সন-মাস-দিন'); return; }
    var isEdit = !!_editEntryId;
    var originalEntry = isEdit ? (type === 'income' ? A.Income.getById(_editEntryId) : A.Expense.getById(_editEntryId)) : null;

    if (type === 'income') {
      var amt  = parseFloat(document.getElementById('acc-inc-amount').value) || 0;
      var note = (document.getElementById('acc-inc-note').value || '').trim();
      if (!amt) { showToast('পরিমাণ লিখুন'); return; }
      var incomePatch = { hijriYear: parsed.year, month: parsed.month, day: parsed.day, amount: amt, note };
      if (isEdit) {
        if (_editNeedsApproval) {
          submitEntryApproval(type, originalEntry, { ...(originalEntry || {}), ...incomePatch });
          return;
        }
        await A.Income.update(_editEntryId, incomePatch);
        showToast('আয় আপডেট হয়েছে ✓');
      } else {
        await A.Income.add(incomePatch);
        showToast('আয় সংরক্ষিত ✓');
      }
    } else {
      var account   = document.getElementById('acc-exp-account').value;
      var supplier  = (document.getElementById('acc-exp-supplier').value || '').trim();
      var receiptNo = (document.getElementById('acc-exp-receipt') ? document.getElementById('acc-exp-receipt').value : '').trim();
      var isOnCredit = _paymentMethod === 'due';
      var isQardEntry = account === 'qard';
      var valid;
      if (isQardEntry) {
        /* করজে হাসানা: পরিমাণ + খাত (আদায় গ্রুপের কী) */
        var qardAmtEl = document.getElementById('acc-qard-amt');
        var qardAmt = parseFloat(qardAmtEl ? qardAmtEl.value : 0) || 0;
        if (!qardAmt || qardAmt <= 0) { showToast('পরিমাণ লিখুন'); if (qardAmtEl) qardAmtEl.focus(); return; }
        if (!supplier) { showToast('খাতের নাম লিখুন'); document.getElementById('acc-exp-supplier').focus(); return; }
        valid = [{ category: supplier, description: '', quantity: '', unit: '', unitPrice: '', amount: qardAmt }];
      } else {
        valid = _items.filter(function (x) { return parseFloat(x.amount) > 0; });
        if (!valid.length) { showToast('কমপক্ষে একটি আইটেমের মোট টাকা দিন'); return; }
      }
      if (isEdit) {
        var x = valid[0];
        var expensePatch = { account, hijriYear: parsed.year, month: parsed.month, day: parsed.day, category: x.category, description: x.description, quantity: sanitizeNumStr(x.quantity), unit: x.unit, unitPrice: sanitizeNumStr(x.unitPrice), amount: parseFloat(x.amount), supplier: isQardEntry ? '' : supplier, receiptNo, paymentMethod: isOnCredit ? 'due' : 'cash' };
        if (_editNeedsApproval) {
          submitEntryApproval(type, originalEntry, { ...(originalEntry || {}), ...expensePatch });
          return;
        }
        await A.Expense.update(_editEntryId, expensePatch);
        if (originalEntry) {
          var oldSup = A.clean(originalEntry.supplier, '');
          var wasOnCredit = originalEntry.paymentMethod !== 'cash';
          if (oldSup && wasOnCredit) await A.Dues.cancelPurchase(oldSup, originalEntry.account, A.num(originalEntry.amount));
        }
        if (!isQardEntry && supplier && isOnCredit) await A.Dues.addOrUpdate(supplier, account, parseFloat(x.amount));
        showToast('ব্যয় আপডেট হয়েছে ✓');
      } else {
        for (var vi = 0; vi < valid.length; vi++) {
          var item = valid[vi];
          var supSave = isQardEntry ? '' : supplier;
          await A.Expense.add({ account, hijriYear: parsed.year, month: parsed.month, day: parsed.day, category: item.category, description: item.description, quantity: sanitizeNumStr(item.quantity), unit: item.unit, unitPrice: sanitizeNumStr(item.unitPrice), amount: parseFloat(item.amount), supplier: supSave, receiptNo, paymentMethod: isOnCredit ? 'due' : 'cash' });
          if (supSave && isOnCredit) await A.Dues.addOrUpdate(supSave, account, parseFloat(item.amount));
        }
        showToast(count(valid.length, 'টি') + ' ব্যয় সংরক্ষিত ✓');
      }
    }
    _editEntryId  = null;
    _editEntryType = '';
    _editNeedsApproval = false;
    _paymentMethod = 'cash';
    closeModal('account-entry');
    refreshAccountsViews();
    } catch (err) {
      console.warn('[Accounts] save failed', err);
      showToast('ডাটাবেজে সংরক্ষণ হয়নি');
      if (A.bootstrapRemote) {
        try { await A.bootstrapRemote(); refreshAccountsViews(); } catch (e) {}
      }
    }
  };

  /* ══════════════ SUMMARY (Excel table + month + year filter) ══════════════ */
  function buildSummary() {
    normalizeMonthFilters();
    var AL   = A.ACCOUNT_LABELS;
    var accs = expenseBookKeys();
    /* মূল পেইজ সব সময় সার্বিক বর্তমান অবস্থা দেখায়; মাস/বছর ভাগ করে দেখা এখন রিপোর্ট ওয়ার্কস্পেসে */
    var allExp = A.Expense.getAll();
    var allInc = A.Income.getAll();
    var allDues = A.Dues.getAll();
    var s = A.Summary.fromRows(allInc, allExp, allDues);
    var rows = accs.filter(function (acc) { return acc !== 'qard'; }).map(function (acc) {
      var accRows = allExp.filter(function (r) { return r.account === acc; });
      var exp = accRows.reduce(function (sum, r) { return sum + A.num(r.amount); }, 0);
      var due = allDues.filter(function (d) { return d.account === acc; }).reduce(function (sum, d) { return sum + Math.max(0, A.num(d.due)); }, 0);
      if (!exp && !due) return null;
      return { id: acc, label: AL[acc], exp: exp, due: due, count: accRows.length, pct: s.te ? Math.round(exp / s.te * 100) : 0 };
    }).filter(Boolean);
    var tblRows = rows.map(function (r) {
      return '<tr class="acc-sum-row">' +
        '<td onclick="openAccAccountDetails(\'' + esc(r.id) + '\')" style="cursor:pointer"><div class="acc-break-name">' + esc(r.label) + '</div><div class="acc-pct-track"><div class="acc-pct-fill" style="width:' + r.pct + '%"></div></div></td>' +
        '<td onclick="openAccAccountDetails(\'' + esc(r.id) + '\')" style="cursor:pointer;color:var(--red);font-weight:800">৳' + fa(r.exp) + '</td>' +
        '<td>' + pct(r.pct) + '</td>' +
        (r.due > 0
          ? '<td onclick="openAccDueDetails(\'' + esc(r.id) + '\')" style="cursor:pointer;color:var(--red);font-weight:700">৳' + fa(r.due) + '</td>'
          : '<td style="color:var(--green)">—</td>') +
        '</tr>';
    }).join('');
    var balCls = s.operatingBalance >= 0 ? 'good' : 'bad';
    var cashCls = s.cashFlow >= 0 ? 'good' : 'bad';
    var regularMetrics = '<div class="acc-summary-section">' +
      '<div class="acc-summary-head"><div class="acc-summary-title">সারসংক্ষেপ</div><div class="acc-summary-note">নগদ = আয় − ব্যয় − করজ দেওয়া + করজ আদায়</div></div>' +
      '<div class="acc-metrics">' +
      '<button type="button" class="acc-metric acc-metric-click good" onclick="openAccMetricModal(\'income\')"><div class="acc-metric-lbl">নিয়মিত আয়</div><div class="acc-metric-val">৳' + fa(s.regularIncome) + '</div></button>' +
      '<button type="button" class="acc-metric acc-metric-click bad" onclick="openAccMetricModal(\'expense\')"><div class="acc-metric-lbl">নিয়মিত ব্যয়</div><div class="acc-metric-val">৳' + fa(s.regularExpense) + '</div></button>' +
      '<div class="acc-metric ' + balCls + '"><div class="acc-metric-lbl">আয়-ব্যয় ব্যালেন্স</div><div class="acc-metric-val">' + (s.operatingBalance < 0 ? '−' : '+') + '৳' + fa(Math.abs(s.operatingBalance)) + '</div></div>' +
      '<button type="button" class="acc-metric acc-metric-click warn" onclick="openAccMetricModal(\'dues\')"><div class="acc-metric-lbl">বর্তমান বকেয়া</div><div class="acc-metric-val">৳' + fa(s.supplierDue) + '</div></button>' +
      '<button type="button" class="acc-metric acc-metric-click warn" onclick="openAccAccountDetails(\'qard\')"><div class="acc-metric-lbl">করজ</div><div class="acc-metric-val">৳' + fa(s.qardRemaining) + '</div></button>' +
      '<div class="acc-metric ' + cashCls + '"><div class="acc-metric-lbl">নগদ</div><div class="acc-metric-val">' + (s.cashFlow < 0 ? '−' : '') + '৳' + fa(Math.abs(s.cashFlow)) + '</div></div>' +
      '</div></div>';
    var thead = '<tr><th>হিসাব বই</th><th>ব্যয়</th><th>শতকরা</th><th>বর্তমান বকেয়া</th></tr>';
    var tfoot = '<tr><td><strong>সর্বমোট</strong></td>' +
      '<td style="color:var(--red);font-weight:700">৳' + fa(s.te) + '</td>' +
      '<td>' + pct(100) + '</td><td style="color:var(--red);font-weight:700">৳' + fa(s.td) + '</td></tr>';
    return '<div class="acc-dashboard">' +
      regularMetrics +
      '<div class="acc-ledger-card"><div class="acc-ledger-title acc-ledger-title--center"><span>খাতওয়ারী হিসাব</span></div>' +
      '<div style="overflow-x:auto"><table class="acc-sum-tbl"><thead>' + thead + '</thead>' +
      '<tbody>' + (tblRows || '<tr><td colspan="4" style="text-align:center;color:var(--ink3)">তথ্য নেই</td></tr>') + '</tbody>' +
      '<tfoot>' + tfoot + '</tfoot></table></div></div>' +
      '</div>';
  }

  /** করজে হাসানা: আদায়/বাকি গ্রুপ — খাত → বিবরণ → সরবরাহকারী (পুরনো ডাটা) */
  function qardBucketKey(r) {
    var c = A.clean(r.category, '');
    if (c) return c;
    var d = A.clean(r.description, '');
    if (d) return d;
    var s = A.clean(r.supplier, '');
    if (s) return s;
    return 'উল্লেখ নেই';
  }

  /** করজে হাসানা: শুধু আগের করজ ব্যয়ে ব্যবহৃত খাত (qardBucketKey) */
  function fillQardCategorySelectPair(selId, textInputId) {
    var sel = document.getElementById(selId);
    if (!sel) return;
    var inp = textInputId ? document.getElementById(textInputId) : null;
    var cur = (inp && inp.value) ? String(inp.value).trim() : '';
    var seen = {};
    var out = [];
    try {
      A.Expense.getAll().filter(function (r) { return r.account === 'qard'; }).forEach(function (r) {
        var k = qardBucketKey(r);
        if (k && k !== 'উল্লেখ নেই' && !seen[k]) { seen[k] = true; out.push(k); }
      });
    } catch (e) { /* ignore */ }
    out.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    sel.innerHTML = '<option value="">— ইতিপূর্বে যুক্ত খাত বেছে নিন —</option>' +
      out.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
      }).join('');
    if (cur && out.indexOf(cur) >= 0) sel.value = cur;
    else sel.value = '';
  }

  function fillQardCategorySelect() {
    fillQardCategorySelectPair('acc-qard-cat-pick', 'acc-exp-supplier');
  }

  function buildQardGiveInlinePanel() {
    var hd = A.todayHijri();
    var defKey = A.dateKey(hd.year, A.monthFromNo(hd.monthNo), hd.day);
    return '<div class="acc-qard-inline-give">' +
      '<div class="form-row">' +
      '<div class="form-group" style="flex:1">' +
      '<label class="form-label">হিজরী তারিখ</label>' +
      '<input class="form-input" id="acc-qard-inline-date" readonly inputmode="numeric" placeholder="১৪৪৭-১০-০৯" value="' + esc(defKey) + '"' +
      ' onclick="openAccDatePicker(\'qardInline\')" style="cursor:pointer">' +
      '</div>' +
      '<div class="form-group" style="flex:1">' +
      '<label class="form-label">পরিমাণ (টাকা)</label>' +
      '<input class="form-input" type="text" inputmode="decimal" id="acc-qard-inline-amt" placeholder="০">' +
      '</div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="form-group" style="flex:1">' +
      '<label class="form-label" for="acc-qard-inline-cat-pick">আগের করজ খাত</label>' +
      '<select class="form-input form-select" id="acc-qard-inline-cat-pick" onchange="onAccQardInlineCatPick(this.value)">' +
      '<option value="">— ইতিপূর্বে যুক্ত খাত বেছে নিন —</option></select>' +
      '<p style="font-size:10px;color:var(--ink3);margin:5px 0 0;font-weight:600;line-height:1.35">তালিকায় না থাকলে নিচে নতুন নাম লিখুন।</p>' +
      '</div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="form-group" style="flex:1">' +
      '<label class="form-label" for="acc-qard-inline-cat-text">খাত (করজ আদায়ের গ্রুপ)</label>' +
      '<input class="form-input" id="acc-qard-inline-cat-text" placeholder="নতুন বা উপর থেকে বাছুন" autocomplete="off">' +
      '</div>' +
      '</div>' +
      '<div class="acc-qard-inline-actions">' +
      '<button type="button" class="submit-btn gold" style="margin-top:0;padding:10px 16px;font-size:13px;border-radius:10px" onclick="saveQardGiveInline()">সংরক্ষণ করুন</button>' +
      '<button type="button" class="acc-detail-clear" style="margin-top:0" onclick="toggleQardGiveInline(true)">বাতিল</button>' +
      '</div>' +
      '</div>';
  }

  /** qard_return note-এর payKey কোন খাত-বাকেটে যোগ (পুরনো নোটে বিবরণ/সরবরাহকারী হলে মিলিয়ে অনুপাতে ভাগ) */
  function applyQardIncomeToBuckets(byBucket, payKey, returnAmt, qardExpenses) {
    if (!payKey || returnAmt <= 0) return;
    if (byBucket[payKey]) {
      byBucket[payKey].returned += returnAmt;
      return;
    }
    var matches = qardExpenses.filter(function (r) {
      var d = A.clean(r.description, '');
      var c = A.clean(r.category, '');
      var s = A.clean(r.supplier, '');
      return payKey === d || payKey === c || payKey === s || payKey === qardBucketKey(r);
    });
    if (!matches.length) {
      if (!byBucket[payKey]) byBucket[payKey] = { given: 0, returned: 0 };
      byBucket[payKey].returned += returnAmt;
      return;
    }
    var sub = {};
    matches.forEach(function (r) {
      var k = qardBucketKey(r);
      if (!sub[k]) sub[k] = 0;
      sub[k] += A.num(r.amount);
    });
    var keys = Object.keys(sub);
    if (keys.length === 1) {
      if (!byBucket[keys[0]]) byBucket[keys[0]] = { given: 0, returned: 0 };
      byBucket[keys[0]].returned += returnAmt;
      return;
    }
    var totalG = keys.reduce(function (sum, k) { return sum + sub[k]; }, 0);
    if (!totalG) {
      if (!byBucket[payKey]) byBucket[payKey] = { given: 0, returned: 0 };
      byBucket[payKey].returned += returnAmt;
      return;
    }
    var cents = Math.round(returnAmt * 100);
    var allocated = 0;
    keys.forEach(function (k, idx) {
      var share = idx === keys.length - 1 ? cents - allocated : Math.round(cents * sub[k] / totalG);
      allocated += share;
      var part = share / 100;
      if (!byBucket[k]) byBucket[k] = { given: 0, returned: 0 };
      byBucket[k].returned += part;
    });
  }

  function renderAccAccountDetails(account) {
    var label = A.ACCOUNT_LABELS[account] || account || 'হিসাব';
    var baseRows = A.Expense.getAll().filter(function (r) {
      return r.account === account;
    });
    var categories = [];
    var suppliers = [];
    var isQardAcct = account === 'qard';
    baseRows.forEach(function (r) {
      var c = A.clean(r.category, '') || 'অন্যান্য';
      var s = isQardAcct ? qardBucketKey(r) : (A.clean(r.supplier, '') || 'উল্লেখ নেই');
      if (categories.indexOf(c) < 0) categories.push(c);
      if (suppliers.indexOf(s) < 0) suppliers.push(s);
    });
    categories.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    suppliers.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    var rows = baseRows.filter(function (r) {
      var month = A.monthKey(r.month);
      var category = A.clean(r.category, '') || 'অন্যান্য';
      var supplier = A.clean(r.supplier, '') || 'উল্লেখ নেই';
      var bucket = isQardAcct ? qardBucketKey(r) : supplier;
      var desc = A.clean(r.description, '') || category || 'ব্যয়';
      var haystack = [A.dateLabel(r), month, category, desc, supplier, bucket, String(r.amount || '')].join(' ').toLowerCase();
      return (!_detailMonthFs.length || _detailMonthFs.indexOf(month) >= 0) &&
        (!_detailCatFs.length || _detailCatFs.indexOf(category) >= 0) &&
        (!_detailSupFs.length || _detailSupFs.indexOf(bucket) >= 0) &&
        (!_detailSearch || haystack.indexOf(String(_detailSearch).toLowerCase()) >= 0);
    }).sort(function (a, b) {
      if (_detailSort === 'amount_desc') return A.num(b.amount) - A.num(a.amount);
      if (_detailSort === 'amount_asc') return A.num(a.amount) - A.num(b.amount);
      if (_detailSort === 'date_desc') return String(b.dateKey).localeCompare(String(a.dateKey));
      return String(a.dateKey).localeCompare(String(b.dateKey));
    });
    var total = rows.reduce(function (sum, r) { return sum + A.num(r.amount); }, 0);
    var title = document.getElementById('account-details-title');
    var root = document.getElementById('account-details-root');
    if (title) {
      var monMeta = _detailMonthFs.length ? (bn(_detailMonthFs.length) + ' মাস') : 'সব মাস';
      if (account === 'qard') {
        /* করজে হাসানা: শিরোনাম দুই সারিতে — টেবিলে মাস কলাম নেই */
        var allQardInc = A.Income.getAll().filter(function (r) { return r.account === 'qard_return'; });
        var tqrTotal = allQardInc.reduce(function (s, r) { return s + A.num(r.amount); }, 0);
        var tqRem = Math.max(0, total - tqrTotal);
        title.className = 'acc-title-root acc-title-root--qard';
        title.innerHTML =
          '<div class="acc-qard-title-card">' +
            '<div class="acc-qard-title-row">' +
              '<span class="acc-qard-title-name">' + esc(label) + '</span>' +
              '<span class="acc-qard-title-amount">৳' + fa(total) + '</span>' +
            '</div>' +
            '<div class="acc-qard-title-grid">' +
              '<div class="acc-qard-stat"><span class="acc-qard-stat-lbl">এন্ট্রি</span><span class="acc-qard-stat-val">' + count(rows.length, 'টি') + '</span></div>' +
              '<div class="acc-qard-stat"><span class="acc-qard-stat-lbl">আদায়</span><span class="acc-qard-stat-val acc-qard-stat-val--green">৳' + fa(tqrTotal) + '</span></div>' +
              '<div class="acc-qard-stat"><span class="acc-qard-stat-lbl">বাকি</span><span class="acc-qard-stat-val acc-qard-stat-val--gold">৳' + fa(tqRem) + '</span></div>' +
            '</div>' +
          '</div>';
      } else {
        title.className = 'acc-title-root';
        title.innerHTML =
          '<span class="acc-title-main">' + esc(label) + '</span>' +
          '<span class="acc-title-meta">' + esc(monMeta) + ' · ' + count(rows.length, 'টি') + '</span>' +
          '<span class="acc-title-total">৳' + fa(total) + '</span>';
      }
    }
    if (root) {
      var readOnly = isAccountsReadOnly();
      var isQard = account === 'qard';
      var body = rows.map(function (r) {
        var category  = A.clean(r.category, '');
        var supplier  = A.clean(r.supplier, '');
        var receiptNo = A.clean(r.receiptNo, '');
        var desc = A.clean(r.description, '') || category || 'ব্যয়';
        var qInfo = r.quantity ? bn(A.num(r.quantity)) + (r.unit ? ' ' + esc(r.unit) : '') + (r.unitPrice ? ' × ৳' + fa(r.unitPrice) : '') : 'উল্লেখ নেই';
        /* qard-এ শুধু delete — আদায় খাত-ভিত্তিক সারিতে */
        var actionBtns = isQard
          ? '<button class="acc-icon-btn del" title="মুছুন" onclick="delAccEntry(\'expense\',\'' + esc(r.id) + '\')">✕</button>'
          : '<button class="acc-icon-btn edit" title="এডিট" onclick="editAccEntry(\'expense\',\'' + esc(r.id) + '\')">✎</button>' +
            '<button class="acc-icon-btn del" title="মুছুন" onclick="delAccEntry(\'expense\',\'' + esc(r.id) + '\')">✕</button>';
        var monthTd = isQard ? '' : ('<td>' + esc(A.monthKey(r.month) || '') + '</td>');
        var supTd = isQard ? '' : ('<td>' + esc(supplier || 'উল্লেখ নেই') + '</td>');
        return '<tr>' +
          '<td>' + esc(A.dateLabel(r)) + '</td>' +
          monthTd +
          '<td>' + esc(category || 'অন্যান্য') + '</td>' +
          '<td class="acc-desc-cell">' + esc(desc) + '</td>' +
          '<td>' + qInfo + '</td>' +
          supTd +
          '<td style="color:var(--ink3);font-size:11px">' + (receiptNo ? esc(receiptNo) : '—') + '</td>' +
          '<td class="acc-ledger-amt">৳' + fa(r.amount) + '</td>' +
          (readOnly ? '' : '<td><div class="acc-row-actions">' + actionBtns + '</div></td>') +
          '</tr>';
      }).join('');
      var detailFilterOn = _detailMonthFs.length > 0 || _detailCatFs.length > 0 || _detailSupFs.length > 0 || !!_detailSearch;
      var _storeDetailLists = function () {
        window._detailMonthsList = A.MONTHS.filter(function (m) { return baseRows.some(function (r) { return A.monthKey(r.month) === m; }); });
        window._detailCatsList = categories;
        window._detailSuppsList = suppliers;
      };
      _storeDetailLists();
      var activeFilterCount = _detailMonthFs.length + _detailCatFs.length + _detailSupFs.length;
      var filterBadge = activeFilterCount ? '<span class="acc-filter-badge">' + bn(activeFilterCount) + '</span>' : '';
      var filters =
        '<div class="acc-detail-tools">' +
        '<div style="position:relative">' +
        '<button type="button" class="acc-filter-icon-btn' + (activeFilterCount ? ' is-on' : '') + '" onclick="openAccDetailFilterDropdown(this)" style="width:100%">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>' +
        'ফিল্টার' + filterBadge + '</button></div>' +
        '<input class="acc-sel" id="acc-detail-search" value="' + esc(_detailSearch) + '" placeholder="খুঁজুন" oninput="setAccDetailFilter(\'search\',this.value)" style="min-width:0">' +
        '<select class="acc-sel" onchange="setAccDetailFilter(\'sort\',this.value)" style="min-width:0">' +
          '<option value="date_asc"' + (_detailSort === 'date_asc' ? ' selected' : '') + '>পুরাতন আগে</option>' +
          '<option value="date_desc"' + (_detailSort === 'date_desc' ? ' selected' : '') + '>নতুন আগে</option>' +
          '<option value="amount_desc"' + (_detailSort === 'amount_desc' ? ' selected' : '') + '>টাকা বেশি</option>' +
          '<option value="amount_asc"' + (_detailSort === 'amount_asc' ? ' selected' : '') + '>টাকা কম</option>' +
        '</select>' +
        (detailFilterOn ? '<button type="button" class="acc-detail-clear" onclick="clearAccDetailFilters()">রিসেট</button>' : '') +
        '</div>';
      var monthTh = isQard ? '' : '<th>মাস</th>';
      var supTh = isQard ? '' : '<th>সরবরাহকারী</th>';
      var emptyColspan = isQard ? (readOnly ? 6 : 7) : (readOnly ? 8 : 9);
      var wrapCls = 'acc-table-wrap' + (isQard ? ' acc-table-wrap--qard' + (readOnly ? ' acc-table-wrap--qard-ro' : '') : '');
      var tableHtml = '<div class="' + wrapCls + '"><table class="acc-detail-table"><thead><tr><th>তারিখ</th>' + monthTh + '<th>খাত</th><th>বিবরণ</th><th>পরিমাণ</th>' + supTh + '<th>রশিদ নং</th><th>টাকা</th>' + (readOnly ? '' : '<th></th>') + '</tr></thead><tbody>' +
        (body || '<tr><td colspan="' + emptyColspan + '" style="text-align:center;color:var(--ink3)">এই হিসাব বইতে তথ্য নেই</td></tr>') +
        '</tbody></table></div>';
      if (isQard) {
        /* করজে হাসানা: tab system — এন্ট্রি সমূহ | ↩ আদায় */
        var tabBar =
          '<div class="acc-qard-tab-bar">' +
          '<button type="button" class="acc-qard-tab' + (_qardTab === 'entries' ? ' is-active' : '') + '" onclick="switchQardTab(\'entries\')">এন্ট্রি সমূহ</button>' +
          '<button type="button" class="acc-qard-tab is-recovery' + (_qardTab === 'recovery' ? ' is-active' : '') + '" onclick="switchQardTab(\'recovery\')">↩ আদায়</button>' +
          '</div>';
        root.innerHTML =
          tabBar +
          '<div id="qard-tab-entries" class="acc-qard-pane"' + (_qardTab !== 'entries' ? ' style="display:none"' : '') + '>' +
          (readOnly ? '' : '<div class="acc-qard-toolbar">' +
            '<button type="button" class="acc-qard-new-btn' + (_qardGiveInlineOpen ? ' is-open' : '') + '" onclick="toggleQardGiveInline()">' +
            (_qardGiveInlineOpen ? '▲ নতুন করজ বন্ধ করুন' : '＋ নতুন করজ যুক্ত করুন') +
            '</button>' +
            (_qardGiveInlineOpen ? buildQardGiveInlinePanel() : '') +
            '</div>') +
          filters + tableHtml +
          '</div>' +
          '<div id="qard-tab-recovery" class="acc-qard-pane acc-qard-pane--recovery"' + (_qardTab !== 'recovery' ? ' style="display:none"' : '') + '>' +
          buildQardBucketSummary(baseRows, readOnly) +
          '</div>';
        if (!readOnly && _qardGiveInlineOpen && _qardTab === 'entries') {
          fillQardCategorySelectPair('acc-qard-inline-cat-pick', 'acc-qard-inline-cat-text');
        }
      } else {
        root.innerHTML = filters + tableHtml;
      }
    }
  }

  /* খাত-ভিত্তিক করজে হাসানা আদায় সারসংক্ষেপ — card + inline expand */
  function buildQardBucketSummary(expenseRows, readOnly) {
    var PREFIX = 'করজে হাসানা আদায় — ';
    var byBucket = {};
    expenseRows.forEach(function (r) {
      var k = qardBucketKey(r);
      if (!byBucket[k]) byBucket[k] = { given: 0, returned: 0 };
      byBucket[k].given += A.num(r.amount);
    });
    A.Income.getAll().filter(function (r) { return r.account === 'qard_return'; }).forEach(function (r) {
      var note = A.clean(r.note, '');
      var payKey = note.indexOf(PREFIX) === 0 ? note.slice(PREFIX.length).trim() : '';
      if (!payKey) payKey = A.clean(r.source, '') || '';
      applyQardIncomeToBuckets(byBucket, payKey, A.num(r.amount), expenseRows);
    });
    var rows = Object.keys(byBucket).map(function (key) {
      var d = byBucket[key];
      return { key: key, given: d.given, returned: d.returned, remaining: Math.max(0, d.given - d.returned) };
    }).sort(function (a, b) { return b.remaining - a.remaining; });
    if (!rows.length) return '<div style="color:var(--ink3);font-size:13px;padding:16px 0;text-align:center">আদায়যোগ্য করজ নেই</div>';
    var cards = rows.map(function (r) {
      var isOpen = _payQardOpenBucket === r.key;
      var remColor = r.remaining > 0 ? 'var(--gold)' : 'var(--green)';
      /* onclick-এ double-quote ব্যবহার নিষিদ্ধ; single-quote JS string */
      var keyJs = "'" + String(r.key).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      var payBtn = (!readOnly && r.remaining > 0)
        ? '<button type="button" class="acc-pay-btn" style="' + (isOpen ? 'background:var(--ink2);color:#fff;border-color:var(--ink2)' : 'background:var(--green);color:#fff;border-color:var(--green)') + ';padding:5px 12px;font-size:12px" onclick="toggleQardExpand(' + keyJs + ',' + r.remaining + ')">' + (isOpen ? '▲ বন্ধ' : '↩ আদায়') + '</button>'
        : (r.remaining === 0 ? '<span style="color:var(--green);font-size:12px;font-weight:700">✓ পরিশোধিত</span>' : '');
      var statsHtml =
        '<div style="display:flex;gap:14px;margin-top:5px;font-size:11px;color:var(--ink3);flex-wrap:wrap">' +
        '<span>মোট করজ: <b style="color:var(--ink2)">৳' + fa(r.given) + '</b></span>' +
        '<span>আদায়: <b style="color:var(--green)">৳' + fa(r.returned) + '</b></span>' +
        '<span>বাকি: <b style="color:' + remColor + '">' + (r.remaining > 0 ? '৳' + fa(r.remaining) : '—') + '</b></span>' +
        '</div>';
      var expandHtml = (isOpen && !readOnly)
        ? '<div class="qard-expand-wrap">' +
          '<div style="font-size:11px;color:var(--ink3);font-weight:600">আদায়ের পরিমাণ · বাকি ৳' + fa(r.remaining) + '</div>' +
          '<div class="qard-expand-row">' +
          '<input type="text" inputmode="decimal" id="qpay-expand-amt" class="form-input" placeholder="০" style="flex:1;min-height:0;height:40px;font-size:14px;padding:8px 12px">' +
          '<button type="button" style="height:40px;padding:0 16px;border:none;border-radius:10px;background:var(--green);color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0" onclick="confirmQardPay(' + keyJs + ')">✓ সংরক্ষণ</button>' +
          '</div></div>'
        : '';
      return '<div class="qard-person-card">' +
        '<div style="display:flex;align-items:flex-start;gap:8px">' +
        '<span style="font-weight:700;font-size:14px;flex:1;min-width:0;line-height:1.35;word-break:break-word">' + esc(r.key) + '</span>' +
        payBtn +
        '</div>' +
        statsHtml +
        expandHtml +
        '</div>';
    }).join('');
    return cards;
  }

  window.switchQardTab = function (tab) {
    _qardTab = tab;
    _payQardOpenBucket = null; /* ট্যাব বদলালে expand বন্ধ */
    if (tab !== 'entries') _qardGiveInlineOpen = false;
    renderAccAccountDetails(_detailAccount);
  };

  window.openAccAccountDetails = function (account, tab) {
    _metricModalKind = '';
    _settingsModalOpen = false;
    var detailsModal = document.getElementById('modal-account-details');
    if (detailsModal) {
      detailsModal.classList.remove('acc-income-detail-open');
      detailsModal.classList.toggle('acc-qard-detail-open', account === 'qard');
    }
    _detailAccount = account;
    _qardTab = (account === 'qard' && (tab === 'recovery' || tab === 'entries')) ? tab : 'entries';
    _payQardOpenBucket = null;
    _qardGiveInlineOpen = false;
    _detailMonthFs = _monFs.length ? _monFs.slice() : [];
    _detailCatFs = [];
    _detailCategory = 'all';
    _detailSupFs = [];
    _detailSearch = '';
    _detailSort = 'date_desc';
    renderAccAccountDetails(account);
    openModal('account-details');
  };

  window.openAccDueDetails = function (account) {
    _metricModalKind = 'dues';
    _settingsModalOpen = false;
    var detailsModal = document.getElementById('modal-account-details');
    if (detailsModal) detailsModal.classList.remove('acc-qard-detail-open');
    _dueAccFs = account && account !== 'all' ? [account] : [];
    renderAccMetricModal();
    openModal('account-details');
  };

  function metricTitle(kind) {
    if (kind === 'income') return 'আয়ের বিস্তারিত';
    if (kind === 'expense') return 'ব্যয়ের বিস্তারিত';
    if (kind === 'dues') return 'বকেয়ার বিস্তারিত';
    return 'বিস্তারিত হিসাব';
  }

  function isMetricModalOpen() {
    var modal = document.getElementById('modal-account-details');
    return !!(_metricModalKind && modal && (modal.classList.contains('open') || modal.classList.contains('show')));
  }

  function isSettingsModalOpen() {
    var modal = document.getElementById('modal-account-details');
    return !!(_settingsModalOpen && modal && (modal.classList.contains('open') || modal.classList.contains('show')));
  }

  function renderAccMetricModal() {
    if (!_metricModalKind) return;
    var root = document.getElementById('account-details-root');
    var title = document.getElementById('account-details-title');
    var modal = document.getElementById('modal-account-details');
    if (!root) return;
    if (modal) {
      modal.classList.toggle('acc-income-detail-open', _metricModalKind === 'income' || _metricModalKind === 'expense');
      modal.classList.remove('acc-qard-detail-open');
    }
    _detailAccount = '';
    if (title) {
      title.className = '';
      title.textContent = metricTitle(_metricModalKind);
    }
    if (_metricModalKind === 'income') root.innerHTML = buildIncomeList();
    else if (_metricModalKind === 'expense') root.innerHTML = buildExpenseList();
    else if (_metricModalKind === 'dues') root.innerHTML = buildDues('renderAccMetricModal()');
    /* Keep an open value-filter menu anchored after a table re-render. */
    if (_colFltOpen) {
      var openFilter = { key: _colFltOpen.key, label: _colFltOpen.label, query: _colFltOpen.query || '' };
      var _tr = root.querySelector('[data-col-flt="' + openFilter.key + '"]');
      if (_tr) window.openColFilter(_tr, openFilter.key, openFilter.label, openFilter.query);
    }
    if (_colSearchFocus) {
      var searchInput = root.querySelector('[data-col-search="' + _colSearchFocus + '"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
      _colSearchFocus = '';
    }
  }

  window.renderAccMetricModal = renderAccMetricModal;
  window.openAccMetricModal = function (kind) {
    _metricModalKind = kind;
    _settingsModalOpen = false;
    _colFilters = {};
    _colSearch = {};
    _sortF = 'date_desc';
    window.closeColFilter();
    if (kind === 'income' || kind === 'expense') {
      _accFs = [];
      _catFs = [];
      _dayF = 'all';
      _fromKey = 'all';
      _toKey = 'all';
    }
    renderAccMetricModal();
    openModal('account-details');
  };

  window.setAccDetailFilter = function (field, value) {
    if (field === 'search') _detailSearch = value || '';
    else if (field === 'sort') _detailSort = value || 'date_desc';
    renderAccAccountDetails(_detailAccount);
    if (field === 'search') {
      var searchEl = document.getElementById('acc-detail-search');
      if (searchEl) {
        searchEl.focus();
        var len = searchEl.value.length;
        if (searchEl.setSelectionRange) searchEl.setSelectionRange(len, len);
      }
    }
  };

  window.clearAccDetailFilters = function () {
    _detailMonthFs = [];
    _detailCatFs = [];
    _detailSupFs = [];
    _detailSearch = '';
    _detailSort = 'date_desc';
    renderAccAccountDetails(_detailAccount);
  };

  window.toggleDetailMonth = function (val, checked) { _msToggle(_detailMonthFs, A.monthKey(val), checked); };
  window.toggleAllDetailMonths = function () {
    var avail = window._detailMonthsList || A.MONTHS;
    _detailMonthFs = _detailMonthFs.length ? [] : avail.slice();
    _rebuildFilterDropdown();
  };
  window.toggleDetailCat = function (val, checked) { _msToggle(_detailCatFs, val, checked); };
  window.toggleAllDetailCats = function () {
    var avail = window._detailCatsList || [];
    _detailCatFs = _detailCatFs.length ? [] : avail.slice();
    _rebuildFilterDropdown();
  };
  window.openAccDetailFilterSheet = function (focus) {
    var avMons = window._detailMonthsList || A.MONTHS;
    var avCats = window._detailCatsList || [];
    var monSection = _msList(avMons, _detailMonthFs, 'toggleDetailMonth', 'toggleAllDetailMonths', 'মাস');
    var catSection = _msList(avCats, _detailCatFs, 'toggleDetailCat', 'toggleAllDetailCats', 'খাত / ক্যাটাগরি');
    var first = focus === 'cat' ? catSection : monSection;
    var second = focus === 'cat' ? monSection : catSection;
    var body = '<div style="margin-bottom:12px">' + first + '</div>' +
      '<div style="margin-bottom:12px">' + second + '</div>' +
      '<div class="acc-filter-bar" style="margin:4px 0 0"><button type="button" class="acc-btn acc-btn-inc" onclick="closeAccSheet();renderAccAccountDetails(_detailAccount)" style="border-radius:10px;flex:2">প্রয়োগ করুন</button><button type="button" class="acc-date-clear" onclick="clearAccDetailFilters()" style="flex:1">রিসেট</button></div>';
    _sheet('হিসাব বই ফিল্টার', body);
  };

  /* ── Grouped filter dropdown (নতুন ড্রপডাউন ফিল্টার) ── */
  var _detailDropdownTrigger = null;
  window.toggleDetailSupplier = function (val, checked) {
    _msToggle(_detailSupFs, val, checked);
    _rebuildFilterDropdown();
  };
  window.toggleAllDetailSuppliers = function () {
    var avail = window._detailSuppsList || [];
    _detailSupFs = _detailSupFs.length ? [] : avail.slice();
    _rebuildFilterDropdown(); /* rebuild needed because item list may change */
  };
  function _rebuildFilterDropdown() {
    var trigger = _detailDropdownTrigger;
    var scrollTop = 0;
    var existing = document.getElementById('acc-filter-dropdown');
    if (existing) {
      var panel = existing.querySelector('.acc-dd-panel');
      if (panel) scrollTop = panel.scrollTop;
    }
    window.closeAccFilterDropdown();
    if (trigger) { window.openAccDetailFilterDropdown(trigger); var p = document.querySelector('.acc-dd-panel'); if (p) p.scrollTop = scrollTop; }
  }
  window.openAccDetailFilterDropdown = function (triggerEl) {
    var existing = document.getElementById('acc-filter-dropdown');
    if (existing) { existing.remove(); _detailDropdownTrigger = null; return; }
    _detailDropdownTrigger = triggerEl;
    var avMons = window._detailMonthsList || A.MONTHS;
    var avCats = window._detailCatsList || [];
    var avSups = window._detailSuppsList || [];
    var sections = [];
    var secIdx = 0;
    function _ddGroup(title, items, activeArr, toggleFn, toggleAllFn) {
      var sid = 'dfs-' + (secIdx++);
      var activeCount = activeArr.length;
      var itemsHtml = items.map(function (item) {
        var on = activeArr.indexOf(item) >= 0;
        return '<label class="acc-ms-item' + (on ? ' is-on' : '') + '" style="border-radius:10px;display:flex;width:100%;box-sizing:border-box">' +
          '<input type="checkbox" class="acc-ms-cb" ' + (on ? 'checked' : '') + ' onchange="' + toggleFn + '(\'' + esc(item) + '\',this.checked);window._refreshAccDropdownUI()">' +
          '<span class="acc-ms-circle">✓</span>' +
          '<span style="flex:1">' + esc(item) + '</span></label>';
      }).join('');
      var allOn = activeCount === 0;
      var html = '<div class="acc-dd-section" id="' + sid + '">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
        '<div class="acc-ms-section-head">' + title + ' <span class="acc-dds-count" style="font-size:9px;font-weight:400;color:var(--ink3)">(' + bn(activeCount || items.length) + (activeCount ? '/' + bn(items.length) : '') + ')</span></div>' +
        '<button type="button" class="acc-ms-selall" onclick="' + toggleAllFn + '()">' + (allOn ? 'বাতিল সব' : 'সব নির্বাচন') + '</button></div>' +
        '<div class="acc-dd-section-list">' + itemsHtml + '</div>' +
        '<div class="acc-dds-chip-wrap" style="margin-top:4px;display:' + (activeCount ? 'flex' : 'none') + ';flex-wrap:wrap;gap:4px;min-height:4px">' +
        (activeCount === 0 ? '' : '<span class="acc-chip">' + bn(activeCount) + ' টি</span>') +
        '</div>' +
        '</div>';
      sections.push({ id: sid, title: title });
      return html;
    }
    var supGroupTitle = (_detailAccount === 'qard') ? 'খাত (করজ গ্রুপ)' : 'সরবরাহকারী';
    var sectionsHtml = _ddGroup('মাস', avMons, _detailMonthFs, 'toggleDetailMonth', 'toggleAllDetailMonths') +
      _ddGroup('খাত', avCats, _detailCatFs, 'toggleDetailCat', 'toggleAllDetailCats') +
      _ddGroup(supGroupTitle, avSups, _detailSupFs, 'toggleDetailSupplier', 'toggleAllDetailSuppliers');
    var tabsHtml = '<div class="acc-dd-tabs">' +
      '<button type="button" class="acc-dd-tab acc-dd-tab-on" data-target="all" onclick="window._filterByTab(this)">সব</button>' +
      sections.map(function (s) {
        return '<button type="button" class="acc-dd-tab" data-target="' + s.id + '" onclick="window._filterByTab(this)">' + esc(s.title) + '</button>';
      }).join('') + '</div>';
    var totalActive = _detailMonthFs.length + _detailCatFs.length + _detailSupFs.length;
    var el = document.createElement('div');
    el.id = 'acc-filter-dropdown';
    el.className = 'acc-dd-backdrop';
    el.onclick = closeAccFilterDropdown;
    el.innerHTML = '<div class="acc-dd-panel" onclick="event.stopPropagation()">' +
      '<div class="acc-sheet-head" style="padding:10px 12px 6px"><div class="acc-sheet-title">ফিল্টার' + (totalActive ? ' (' + bn(totalActive) + ')' : '') + '</div><button type="button" class="acc-sheet-close" onclick="closeAccFilterDropdown()">✕</button></div>' +
      tabsHtml +
      '<div class="acc-filter-bar" style="margin:2px 12px 6px;position:sticky;top:0;z-index:2;background:#fffaf1;padding:6px 0;border-radius:10px"><button type="button" class="acc-btn acc-btn-inc" onclick="closeAccFilterDropdown();renderAccAccountDetails(_detailAccount)" style="border-radius:10px;flex:2">প্রয়োগ করুন</button><button type="button" class="acc-date-clear" onclick="clearAccDetailFilters();closeAccFilterDropdown()" style="flex:1">রিসেট</button></div>' +
      sectionsHtml +
      '</div>';
    var rect = triggerEl.getBoundingClientRect();
    var panelEl = el.querySelector('.acc-dd-panel');
    var dw = window.innerWidth >= 520 ? 360 : (window.innerWidth - 12);
    panelEl.style.position = 'fixed';
    panelEl.style.top = Math.min(rect.bottom + 4, window.innerHeight - 20) + 'px';
    panelEl.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - dw - 4)) + 'px';
    panelEl.style.width = dw + 'px';
    panelEl.style.maxHeight = Math.min(480, window.innerHeight - rect.bottom - 24) + 'px';
    panelEl.style.overflowY = 'auto';
    document.body.appendChild(el);
  };
  window.closeAccFilterDropdown = function () {
    var el = document.getElementById('acc-filter-dropdown');
    if (el) el.remove();
    _detailDropdownTrigger = null;
  };
  window._rebuildFilterDropdown = _rebuildFilterDropdown;

  window._filterByTab = function (tabBtn) {
    var tabs = tabBtn.parentElement.querySelectorAll('.acc-dd-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('acc-dd-tab-on');
    tabBtn.classList.add('acc-dd-tab-on');
    var target = tabBtn.getAttribute('data-target');
    var panel = tabBtn.closest('.acc-dd-panel');
    if (!panel) return;
    var sections = panel.querySelectorAll('.acc-dd-section');
    for (var s = 0; s < sections.length; s++) {
      if (target === 'all') sections[s].style.display = '';
      else sections[s].style.display = sections[s].id === target ? '' : 'none';
    }
    if (target !== 'all') {
      var targSection = panel.querySelector('#' + target);
      if (targSection) targSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  window._refreshAccDropdownUI = function () {
    var dd = document.getElementById('acc-main-filter-dropdown') || document.getElementById('acc-filter-dropdown');
    if (!dd) return;
    var totalActive = 0;
    var sections = dd.querySelectorAll('.acc-dd-section');
    for (var s = 0; s < sections.length; s++) {
      var section = sections[s];
      var cbs = section.querySelectorAll('.acc-ms-cb');
      var activeCount = 0;
      for (var c = 0; c < cbs.length; c++) if (cbs[c].checked) activeCount++;
      totalActive += activeCount;
      /* update count badge */
      var countSpan = section.querySelector('.acc-dds-count');
      if (countSpan && cbs.length) {
        countSpan.textContent = '(' + bn(activeCount || cbs.length) + (activeCount ? '/' + bn(cbs.length) : '') + ')';
      }
      /* update select-all button */
      var selAll = section.querySelector('.acc-ms-selall');
      if (selAll) selAll.textContent = activeCount === 0 ? 'বাতিল সব' : 'সব নির্বাচন';
      /* update chip */
      var chipWrap = section.querySelector('.acc-dds-chip-wrap');
      var chip = chipWrap ? chipWrap.querySelector('.acc-chip') : null;
      if (activeCount === 0) {
        if (chipWrap) chipWrap.style.display = 'none';
      } else {
        if (chipWrap) { chipWrap.style.display = 'flex'; if (chip) chip.textContent = bn(activeCount) + ' টি'; }
      }
      /* update item is-on classes */
      var items = section.querySelectorAll('.acc-ms-item');
      for (var it = 0; it < items.length; it++) {
        var cb = items[it].querySelector('.acc-ms-cb');
        if (cb) items[it].classList.toggle('is-on', cb.checked);
      }
    }
    /* update title count */
    var title = dd.querySelector('.acc-sheet-title');
    if (title) {
      title.textContent = 'ফিল্টার' + (totalActive ? ' (' + bn(totalActive) + ')' : '');
    }
  };

  /* ── Column-level filter (Excel-style auto-filter) ── */
  var _colFilters = {};
  var _colSearch = {};
  var _colSearchFocus = '';
  var _colSearchTimer = null;
  var _colFltOpen = null;
  var _colFltVals = {};
  window.closeColFilter = function () {
    var el = document.querySelector('.col-flt-dropdown');
    if (el) el.remove();
    document.removeEventListener('click', _closeColFltHandler);
    _colFltOpen = null;
  };
  function _sq(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  }
  function _ha(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function _searchText(s) {
    return String(s == null ? '' : s).toLocaleLowerCase('bn')
      .replace(/[০-৯]/g, function (d) { return '0123456789'['০১২৩৪৫৬৭৮৯'.indexOf(d)]; })
      .replace(/[৳,\s]+/g, ' ').trim();
  }
  window.setColSearch = function (colKey, value) {
    value = String(value || '').trim();
    if (value) _colSearch[colKey] = value;
    else delete _colSearch[colKey];
    _colSearchFocus = colKey;
    clearTimeout(_colSearchTimer);
    _colSearchTimer = setTimeout(rerenderAccountsView, 120);
  };
  window.toggleColFlt = function (colKey, val, checked) {
    var selected = _colFilters[colKey] ? _colFilters[colKey].slice() : [];
    if (checked) { if (selected.indexOf(val) < 0) selected.push(val); }
    else selected = selected.filter(function (v) { return v !== val; });
    if (selected.length) _colFilters[colKey] = selected;
    else delete _colFilters[colKey];
    rerenderAccountsView();
  };
  window.selectAllColFlt = function (colKey) {
    _colFilters[colKey] = (_colFltVals[colKey] || []).slice();
    rerenderAccountsView();
  };
  window.deselectAllColFlt = function (colKey) {
    delete _colFilters[colKey];
    rerenderAccountsView();
  };
  window.filterColFltOptions = function (value) {
    var dropdown = document.querySelector('.col-flt-dropdown');
    if (!dropdown) return;
    if (_colFltOpen) _colFltOpen.query = value || '';
    var needle = _searchText(value);
    var items = dropdown.querySelectorAll('[data-col-option]');
    var visible = 0;
    for (var i = 0; i < items.length; i++) {
      var show = !needle || _searchText(items[i].getAttribute('data-col-option')).indexOf(needle) >= 0;
      items[i].style.display = show ? 'flex' : 'none';
      if (show) visible++;
    }
    var empty = dropdown.querySelector('.col-flt-empty');
    if (empty) empty.hidden = visible > 0;
  };
  window.openColFilter = function (triggerEl, colKey, colLabel, optionQuery) {
    closeColFilter();
    _colFltOpen = { key: colKey, label: colLabel, query: optionQuery || '' };
    var allVals = _colFltVals[colKey] || [];
    var hasFilter = Object.prototype.hasOwnProperty.call(_colFilters, colKey);
    var active = hasFilter ? _colFilters[colKey] : [];
    var itemsHtml = allVals.map(function (v) {
      var on = active.indexOf(v) >= 0;
      return '<label class="acc-ms-item' + (on ? ' is-on' : '') + '" data-col-option="' + _ha(v) + '" style="border-radius:10px;display:flex;width:100%;box-sizing:border-box">' +
        '<input type="checkbox" class="acc-ms-cb" ' + (on ? 'checked' : '') + ' onchange="toggleColFlt(\'' + _ha(_sq(colKey)) + '\',\'' + _ha(_sq(v)) + '\',this.checked)">' +
        '<span class="acc-ms-circle">✓</span><span style="flex:1">' + esc(v) + '</span></label>';
    }).join('');
    var el = document.createElement('div');
    el.className = 'col-flt-dropdown';
    el.style.cssText = 'position:fixed;z-index:9997';
    el.onclick = function (e) { e.stopPropagation(); };
    el.innerHTML = '<div class="col-flt-panel">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<span style="font-size:11px;font-weight:800;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em">' + esc(colLabel) + '</span>' +
      '<button type="button" class="col-flt-link" onclick="closeColFilter()">বন্ধ</button></div>' +
      '<input type="search" class="col-flt-search" value="' + _ha(optionQuery || '') + '" placeholder="এই কলামে খুঁজুন..." aria-label="' + _ha(colLabel) + ' অপশন খুঁজুন" oninput="filterColFltOptions(this.value)">' +
      '<div class="col-flt-actions"><button type="button" class="col-flt-link" onclick="selectAllColFlt(\'' + _sq(colKey) + '\')">সব নির্বাচন</button>' +
      '<button type="button" class="col-flt-link" onclick="deselectAllColFlt(\'' + _sq(colKey) + '\')">সব বাতিল</button></div>' +
      '<div class="col-flt-options">' + itemsHtml + '<div class="col-flt-empty" hidden>কোনো অপশন মেলেনি</div></div>' +
      '</div>';
    var rect = triggerEl.getBoundingClientRect();
    document.body.appendChild(el);
    var panelRect = el.getBoundingClientRect();
    var top = rect.bottom + 4;
    if (top + panelRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - panelRect.height - 4);
    el.style.top = top + 'px';
    el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panelRect.width - 8)) + 'px';
    document.addEventListener('click', _closeColFltHandler);
    if (optionQuery) window.filterColFltOptions(optionQuery);
  };
  function _closeColFltHandler() {
    closeColFilter();
    document.removeEventListener('click', _closeColFltHandler);
  }
  function _colFltIcon(colKey, active) {
    var lbl = colKey === 'date' ? 'তারিখ' : colKey === 'desc' ? 'বিবরণ' : colKey === 'amount' ? 'টাকা' : colKey === 'account' ? 'হিসাব বই' : colKey === 'category' ? 'খাত' : colKey === 'supplier' ? 'সরবরাহকারী' : colKey === 'quantity' ? 'পরিমাণ' : colKey === 'receipt' ? 'রশিদ নং' : colKey;
    return '<button type="button" class="col-flt-icon' + (active ? ' is-on' : '') + '" data-col-flt="' + colKey + '" title="' + esc(lbl) + ' অনুযায়ী বাছাই" aria-label="' + esc(lbl) + ' অনুযায়ী বাছাই" onclick="event.stopPropagation();openColFilter(this,\'' + _sq(colKey) + '\',\'' + _sq(lbl) + '\')">▾</button>';
  }
  function _applyColFilters(rows, colKey, fn) {
    var active = _colFilters[colKey];
    if (!Object.prototype.hasOwnProperty.call(_colFilters, colKey)) return rows;
    return rows.filter(function (r) { return active.indexOf(fn(r)) >= 0; });
  }
  function _buildColVals(rows, fn) {
    var seen = {};
    var out = [];
    rows.forEach(function (r) {
      var v = fn(r);
      if (!seen[v]) { seen[v] = true; out.push(v); }
    });
    out.sort(function (a, b) { return a.localeCompare(b, 'bn'); });
    return out;
  }
  function _applyColSearch(rows, colKey, fn) {
    var needle = _searchText(_colSearch[colKey]);
    if (!needle) return rows;
    return rows.filter(function (r) { return _searchText(fn(r)).indexOf(needle) >= 0; });
  }
  function _colHeader(label, colKey, sortAsc, sortDesc, align) {
    var indicator = _sortF === sortAsc ? ' ▲' : (_sortF === sortDesc ? ' ▼' : '');
    var next = _sortF === sortAsc ? sortDesc : sortAsc;
    var query = _colSearch[colKey] || '';
    return '<th' + (align ? ' style="text-align:' + align + '"' : '') + '><div class="acc-col-head">' +
      '<button type="button" class="acc-col-head-label" style="border:0;background:none;padding:0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;text-align:inherit" onclick="setAccSort(\'' + next + '\')">' + label + indicator + '</button>' +
      _colFltIcon(colKey, Object.prototype.hasOwnProperty.call(_colFilters, colKey)) + '</div>' +
      '<input type="search" class="acc-col-search' + (query ? ' is-on' : '') + '" data-col-search="' + colKey + '" value="' + _ha(query) + '" placeholder="খুঁজুন..." aria-label="' + _ha(label) + ' খুঁজুন" onclick="event.stopPropagation()" oninput="setColSearch(\'' + _sq(colKey) + '\',this.value)"></th>';
  }

  /* ══════════════ INCOME LIST ══════════════ */
  function buildIncomeList() {
    normalizeMonthFilters();
    var rows = A.Income.getAll().filter(function (r) { return r.account !== 'qard_return'; });
    if (_yearFs.length) rows = rows.filter(function (r) { return _yearFs.indexOf(String(r.hijriYear)) >= 0; });
    if (_monFs.length) rows = rows.filter(function (r) { return _monFs.indexOf(A.monthKey(r.month)) >= 0; });
    /* column filters */
    _colFltVals['date'] = _buildColVals(rows, function (r) { return A.dateLabel(r); });
    _colFltVals['desc'] = _buildColVals(rows, function (r) { return A.clean(r.note, '') || A.clean(r.source, '') || 'আয়'; });
    _colFltVals['amount'] = _buildColVals(rows, function (r) { return '৳' + fa(r.amount); });
    rows = _applyColFilters(rows, 'date', function (r) { return A.dateLabel(r); });
    rows = _applyColFilters(rows, 'desc', function (r) { return A.clean(r.note, '') || A.clean(r.source, '') || 'আয়'; });
    rows = _applyColFilters(rows, 'amount', function (r) { return '৳' + fa(r.amount); });
    rows = _applyColSearch(rows, 'date', function (r) { return A.dateLabel(r); });
    rows = _applyColSearch(rows, 'desc', function (r) { return A.clean(r.note, '') || A.clean(r.source, '') || 'আয়'; });
    rows = _applyColSearch(rows, 'amount', function (r) { return '৳' + fa(r.amount); });
    rows = rows.slice().sort(function (a, b) {
      if (_sortF === 'amount_desc') return A.num(b.amount) - A.num(a.amount);
      if (_sortF === 'amount_asc') return A.num(a.amount) - A.num(b.amount);
      if (_sortF === 'oldest') return (a._at || 0) - (b._at || 0);
      if (_sortF === 'newest') return (b._at || 0) - (a._at || 0);
      if (_sortF === 'text_asc') { var da = A.clean(a.note, '') || A.clean(a.source, '') || 'আয়'; var db = A.clean(b.note, '') || A.clean(b.source, '') || 'আয়'; return da.localeCompare(db); }
      if (_sortF === 'text_desc') { var da = A.clean(a.note, '') || A.clean(a.source, '') || 'আয়'; var db = A.clean(b.note, '') || A.clean(b.source, '') || 'আয়'; return db.localeCompare(da); }
      var da = a.dateKey || A.dateKey(a.hijriYear, a.month, a.day) || '';
      var db = b.dateKey || A.dateKey(b.hijriYear, b.month, b.day) || '';
      if (_sortF === 'date_asc') return da.localeCompare(db);
      return db.localeCompare(da);
    });
    var total = rows.reduce(function (s, r) { return s + A.num(r.amount); }, 0);
    var readOnly = isAccountsReadOnly();
    var emptyColspan = readOnly ? 3 : 4;
    var thead = '<thead><tr>' +
      _colHeader('তারিখ', 'date', 'date_asc', 'date_desc') +
      _colHeader('বিবরণ', 'desc', 'text_asc', 'text_desc') +
      _colHeader('টাকা', 'amount', 'amount_asc', 'amount_desc', 'right') +
      (readOnly ? '' : '<th style="width:56px"></th>') +
      '</tr></thead>';
    var tbody = rows.map(function (r) {
      var desc = A.clean(r.note, '') || A.clean(r.source, '') || 'আয়';
      var dateLabel = A.dateLabel ? A.dateLabel(r) : (A.monthKey(r.month) || '') + (r.day ? ' · ' + bn(r.day) : '');
      return '<tr>' +
        '<td style="color:var(--ink3);font-size:11px">' + esc(dateLabel) + '</td>' +
        '<td>' + esc(desc) + '</td>' +
        '<td class="acc-list-amt inc">৳' + fa(r.amount) + '</td>' +
        (readOnly ? '' : '<td><div class="acc-income-actions"><button type="button" class="acc-income-action edit" title="এডিট" aria-label="আয় এডিট করুন" onclick="editAccEntry(\'income\',\'' + esc(r.id) + '\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button><button type="button" class="acc-income-action delete" title="মুছুন" aria-label="আয় মুছুন" onclick="delAccEntry(\'income\',\'' + esc(r.id) + '\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/></svg></button></div></td>') +
        '</tr>';
    }).join('');
    if (!tbody) tbody = '<tr><td colspan="' + emptyColspan + '" style="text-align:center;color:var(--ink3);padding:20px 6px">কোনো আয়ের রেকর্ড নেই</td></tr>';
    var colActiveCount = Object.keys(_colFilters).length + Object.keys(_colSearch).length;
    var filterOn = _monFs.length > 0 || _yearFs.length > 0 || colActiveCount > 0;
    var activeCount = _monFs.length + _yearFs.length + colActiveCount;
    var periodCount = _monFs.length + _yearFs.length;
    var periodLabel = periodCount ? bn(periodCount) + 'টি নির্বাচিত' : 'সব সময়';
    var sortLabels = { date_asc:'পুরাতন আগে', date_desc:'নতুন আগে', amount_desc:'বেশি টাকা আগে', amount_asc:'কম টাকা আগে', newest:'নতুন এন্ট্রি আগে', oldest:'পুরাতন এন্ট্রি আগে', text_asc:'বিবরণ: ক-হ', text_desc:'বিবরণ: হ-ক' };
    var sortLabel = sortLabels[_sortF] || 'নতুন আগে';
    var periodSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
    var sortSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h8M8 18h4M4 4v16m0 0-2-2m2 2 2-2"/></svg>';
    var clearSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M8 5V3h8v2m-9 0 1 16h8l1-16M10 10v7m4-7v7"/></svg>';
    var toolbar = '<div class="acc-income-toolbar" aria-label="আয়ের তালিকা নিয়ন্ত্রণ">' +
      '<button type="button" class="acc-income-tool" onclick="openAccFilterSheet(this,\'income\')" aria-label="সময়কাল নির্বাচন করুন">' + periodSvg + '<span class="acc-income-tool-copy"><small>সময়কাল</small><strong>' + esc(periodLabel) + '</strong></span>' + (periodCount ? '<span class="acc-income-tool-badge">' + bn(periodCount) + '</span>' : '') + '</button>' +
      '<button type="button" class="acc-income-tool" onclick="openAccSortSheet()" aria-label="তালিকা সাজান">' + sortSvg + '<span class="acc-income-tool-copy"><small>সাজান</small><strong>' + esc(sortLabel) + '</strong></span></button>' +
      (filterOn ? '<button type="button" class="acc-income-tool clear" onclick="resetAccFilters()" aria-label="সব ফিল্টার সাফ করুন">' + clearSvg + '<span class="acc-income-tool-copy"><strong>সব সাফ</strong></span></button>' : '') +
      '</div>';
    var filterStatus = activeCount ? bn(activeCount) + 'টি সক্রিয়' : 'সব তথ্য';
    return '<div class="acc-income-shell">' +
      '<section class="acc-income-summary" aria-label="আয়ের সংক্ষিপ্তসার">' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">মোট আয়</span><strong class="acc-income-stat-value is-income">৳' + fa(total) + '</strong></div>' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">রেকর্ড</span><strong class="acc-income-stat-value">' + count(rows.length, 'টি') + '</strong></div>' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">ফিল্টার অবস্থা</span><strong class="acc-income-stat-value is-status">' + esc(filterStatus) + '</strong></div>' +
      '</section>' + toolbar +
      '<div class="acc-table-wrap"><table class="acc-income-table' + (readOnly ? ' is-readonly' : '') + '">' + thead + '<tbody>' + tbody + '</tbody></table></div></div>';
  }

  /* ══════════════ EXPENSE LIST ══════════════ */
  function buildExpenseList() {
    normalizeMonthFilters();
    var rows = A.Expense.getAll().filter(function (r) { return r.account !== 'qard'; });
    if (_yearFs.length) rows = rows.filter(function (r) { return _yearFs.indexOf(String(r.hijriYear)) >= 0; });
    if (_monFs.length) rows = rows.filter(function (r) { return _monFs.indexOf(A.monthKey(r.month)) >= 0; });
    if (_accFs.length) rows = rows.filter(function (r) { return _accFs.indexOf(r.account) >= 0; });
    if (_catFs.length) rows = rows.filter(function (r) { return _catFs.indexOf(A.clean(r.category, '') || '') >= 0; });
    _fromKey = A.toDateKey(_fromKey);
    _toKey = A.toDateKey(_toKey);
    rows = rows.filter(function (r) { return A.inRange(r, _fromKey, _toKey); });
    if (_dayF === '__none') rows = rows.filter(function (r) { return !r.day; });
    else if (_dayF !== 'all') rows = rows.filter(function (r) { return String(r.day || '') === String(_dayF); });
    function expenseCategory(r) { return A.clean(r.category, '') || 'অন্যান্য'; }
    function expenseDesc(r) { return A.clean(r.description, '') || expenseCategory(r) || 'ব্যয়'; }
    function expenseSupplier(r) { return A.clean(r.supplier, '') || 'উল্লেখ নেই'; }
    function expenseReceipt(r) { return A.clean(r.receiptNo, '') || '—'; }
    function expenseQuantity(r) {
      if (!r.quantity) return 'উল্লেখ নেই';
      return bn(A.num(r.quantity)) + (r.unit ? ' ' + A.clean(r.unit, '') : '') + (r.unitPrice ? ' × ৳' + fa(r.unitPrice) : '');
    }
    var colDefs = [
      ['date', function (r) { return A.dateLabel(r); }],
      ['account', function (r) { return A.ACCOUNT_LABELS[r.account] || r.account || ''; }],
      ['category', expenseCategory],
      ['desc', expenseDesc],
      ['quantity', expenseQuantity],
      ['supplier', expenseSupplier],
      ['receipt', expenseReceipt],
      ['amount', function (r) { return '৳' + fa(r.amount); }]
    ];
    colDefs.forEach(function (def) { _colFltVals[def[0]] = _buildColVals(rows, def[1]); });
    colDefs.forEach(function (def) {
      rows = _applyColFilters(rows, def[0], def[1]);
      rows = _applyColSearch(rows, def[0], def[1]);
    });
    rows = rows.slice().sort(function (a, b) {
      if (_sortF === 'amount_desc') return A.num(b.amount) - A.num(a.amount);
      if (_sortF === 'amount_asc') return A.num(a.amount) - A.num(b.amount);
      if (_sortF === 'newest') return (b._at || 0) - (a._at || 0);
      if (_sortF === 'oldest') return (a._at || 0) - (b._at || 0);
      var sortMatch = /^(.+)_(asc|desc)$/.exec(_sortF);
      var sortGetters = {
        date: function (r) { return r.dateKey || A.dateKey(r.hijriYear, r.month, r.day) || ''; },
        account: function (r) { return A.ACCOUNT_LABELS[r.account] || r.account || ''; },
        category: expenseCategory,
        desc: expenseDesc,
        quantity: function (r) { return A.num(r.quantity); },
        supplier: expenseSupplier,
        receipt: expenseReceipt
      };
      if (sortMatch && sortGetters[sortMatch[1]]) {
        var av = sortGetters[sortMatch[1]](a), bv = sortGetters[sortMatch[1]](b);
        var compared = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'bn');
        return sortMatch[2] === 'desc' ? -compared : compared;
      }
      return String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
    });
    var total = rows.reduce(function (s, r) { return s + A.num(r.amount); }, 0);
    var readOnly = isAccountsReadOnly();
    function rowHtml(r) {
      var actionBtns = '<button type="button" class="acc-income-action edit" title="এডিট" aria-label="ব্যয় এডিট করুন" onclick="editAccEntry(\'expense\',\'' + esc(r.id) + '\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button><button type="button" class="acc-income-action delete" title="মুছুন" aria-label="ব্যয় মুছুন" onclick="delAccEntry(\'expense\',\'' + esc(r.id) + '\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/></svg></button>';
      return '<tr>' +
        '<td>' + esc(A.dateLabel(r)) + '</td>' +
        '<td>' + esc(A.ACCOUNT_LABELS[r.account] || r.account || '') + '</td>' +
        '<td>' + esc(expenseCategory(r)) + '</td>' +
        '<td class="acc-desc-cell">' + esc(expenseDesc(r)) + '</td>' +
        '<td>' + esc(expenseQuantity(r)) + '</td>' +
        '<td>' + esc(expenseSupplier(r)) + '</td>' +
        '<td style="color:var(--ink3);font-size:11px">' + esc(expenseReceipt(r)) + '</td>' +
        '<td class="acc-list-amt expense">৳' + fa(r.amount) + '</td>' +
        (readOnly ? '' : '<td><div class="acc-income-actions">' + actionBtns + '</div></td>') +
        '</tr>';
    }
    var items = rows.map(rowHtml).join('');
    var filterOn = _monFs.length > 0 || _accFs.length > 0 || _catFs.length > 0 || _dayF !== 'all';
    var rangeOn = _fromKey !== 'all' || _toKey !== 'all';
    var colActiveCount = Object.keys(_colFilters).length + Object.keys(_colSearch).length;
    var anyFilterOn = filterOn || rangeOn || colActiveCount > 0;
    var activeCount = _monFs.length + _accFs.length + _catFs.length + _yearFs.length + (_dayF !== 'all' ? 1 : 0) + (rangeOn ? 1 : 0) + colActiveCount;
    var sortNames = { date_asc:'পুরাতন আগে', date_desc:'নতুন আগে', amount_desc:'বেশি টাকা আগে', amount_asc:'কম টাকা আগে', newest:'নতুন এন্ট্রি আগে', oldest:'পুরাতন এন্ট্রি আগে' };
    var filterSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    var sortSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h8M8 18h4M4 4v16m0 0-2-2m2 2 2-2"/></svg>';
    var clearSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M8 5V3h8v2m-9 0 1 16h8l1-16M10 10v7m4-7v7"/></svg>';
    var toolbar = '<div class="acc-income-toolbar" aria-label="ব্যয়ের তালিকা নিয়ন্ত্রণ">' +
      '<button type="button" class="acc-income-tool" onclick="openAccFilterSheet(this)" aria-label="ব্যয়ের ফিল্টার খুলুন">' + filterSvg + '<span class="acc-income-tool-copy"><small>ফিল্টার</small><strong>' + (activeCount ? bn(activeCount) + 'টি সক্রিয়' : 'সব তথ্য') + '</strong></span></button>' +
      '<button type="button" class="acc-income-tool" onclick="openAccSortSheet()" aria-label="তালিকা সাজান">' + sortSvg + '<span class="acc-income-tool-copy"><small>সাজান</small><strong>' + esc(sortNames[_sortF] || 'নতুন আগে') + '</strong></span></button>' +
      (anyFilterOn ? '<button type="button" class="acc-income-tool clear" onclick="resetAccFilters()" aria-label="সব ফিল্টার সাফ করুন">' + clearSvg + '<span class="acc-income-tool-copy"><strong>সব সাফ</strong></span></button>' : '') +
      '</div>';
    var thead = '<thead><tr>' +
      _colHeader('তারিখ', 'date', 'date_asc', 'date_desc') +
      _colHeader('হিসাব বই', 'account', 'account_asc', 'account_desc') +
      _colHeader('খাত', 'category', 'category_asc', 'category_desc') +
      _colHeader('বিবরণ', 'desc', 'desc_asc', 'desc_desc') +
      _colHeader('পরিমাণ', 'quantity', 'quantity_asc', 'quantity_desc') +
      _colHeader('সরবরাহকারী', 'supplier', 'supplier_asc', 'supplier_desc') +
      _colHeader('রশিদ নং', 'receipt', 'receipt_asc', 'receipt_desc') +
      _colHeader('টাকা', 'amount', 'amount_asc', 'amount_desc', 'right') +
      (readOnly ? '' : '<th></th>') +
      '</tr></thead>';
    var filterStatus = activeCount ? bn(activeCount) + 'টি সক্রিয়' : 'সব তথ্য';
    return '<div class="acc-income-shell">' +
      '<section class="acc-income-summary" aria-label="ব্যয়ের সংক্ষিপ্তসার">' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">মোট ব্যয়</span><strong class="acc-income-stat-value is-expense">৳' + fa(total) + '</strong></div>' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">রেকর্ড</span><strong class="acc-income-stat-value">' + count(rows.length, 'টি') + '</strong></div>' +
      '<div class="acc-income-stat"><span class="acc-income-stat-label">ফিল্টার অবস্থা</span><strong class="acc-income-stat-value is-status">' + esc(filterStatus) + '</strong></div>' +
      '</section>' + toolbar +
      '<div class="acc-table-wrap"><table class="acc-income-table acc-expense-detail-table' + (readOnly ? ' is-readonly' : '') + '">' + thead + '<tbody>' +
      (items || '<tr><td colspan="' + (readOnly ? '8' : '9') + '" style="text-align:center;color:var(--ink3);padding:24px">কোনো ব্যয়ের রেকর্ড নেই</td></tr>') +
      '</tbody></table></div></div>';
  }

  /* ══════════════ DUES (compact table) ══════════════ */
  var _duesDropdownTrigger = null;
  window.toggleDueAccount = function (id, checked) {
    if (checked) {
      if (_dueAccFs.indexOf(id) < 0) _dueAccFs.push(id);
    } else {
      var idx = _dueAccFs.indexOf(id);
      if (idx >= 0) _dueAccFs.splice(idx, 1);
    }
  };
  window.toggleAllDueAccounts = function () {
    _dueAccFs = _dueAccFs.length ? [] : expenseBookKeys();
    _rebuildDuesDropdown();
  };
  window.openDuesFilterDropdown = function (triggerEl) {
    var existing = document.getElementById('acc-dues-filter-dropdown');
    if (existing) { existing.remove(); _duesDropdownTrigger = null; return; }
    _duesDropdownTrigger = triggerEl;
    var accounts = expenseBookEntries();
    var itemsHtml = accounts.map(function (e) {
      var id = e[0], label = e[1];
      var on = _dueAccFs.indexOf(id) >= 0;
      return '<label class="acc-ms-item' + (on ? ' is-on' : '') + '" style="border-radius:10px;display:flex;width:100%;box-sizing:border-box">' +
        '<input type="checkbox" class="acc-ms-cb" ' + (on ? 'checked' : '') + ' onchange="toggleDueAccount(\'' + esc(id) + '\',this.checked);window._refreshDuesDropdownUI()">' +
        '<span class="acc-ms-circle">✓</span>' +
        '<span style="flex:1">' + esc(label) + '</span></label>';
    }).join('');
    var allOn = _dueAccFs.length === 0;
    var totalActive = _dueAccFs.length;
    var el = document.createElement('div');
    el.id = 'acc-dues-filter-dropdown';
    el.className = 'acc-dd-backdrop';
    el.onclick = window.closeDuesFilterDropdown;
    el.innerHTML = '<div class="acc-dd-panel" onclick="event.stopPropagation()">' +
      '<div class="acc-sheet-head" style="padding:10px 12px 6px"><div class="acc-sheet-title">হিসাব বই' + (totalActive && !allOn ? ' (' + bn(totalActive) + ')' : '') + '</div><button type="button" class="acc-sheet-close" onclick="closeDuesFilterDropdown()">✕</button></div>' +
      '<div class="acc-dd-section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<div class="acc-ms-section-head">হিসাব বই <span class="acc-dds-count" style="font-size:9px;font-weight:400;color:var(--ink3)">(' + bn(totalActive || accounts.length) + (totalActive && !allOn ? '/' + bn(accounts.length) : '') + ')</span></div>' +
      '<button type="button" class="acc-ms-selall" onclick="toggleAllDueAccounts()">' + (allOn ? 'বাতিল সব' : 'সব নির্বাচন') + '</button></div>' +
      '<div class="acc-dd-section-list">' + itemsHtml + '</div></div>' +
      '<div class="acc-filter-bar" style="margin:4px 12px 12px"><button type="button" class="acc-btn acc-btn-inc" onclick="closeDuesFilterDropdown();renderAccMetricModal()" style="border-radius:10px;flex:2">প্রয়োগ করুন</button><button type="button" class="acc-date-clear" onclick="_dueAccFs=[];closeDuesFilterDropdown();renderAccMetricModal()" style="flex:1">রিসেট</button></div>' +
      '</div>';
    var rect = triggerEl.getBoundingClientRect();
    var panelEl = el.querySelector('.acc-dd-panel');
    panelEl.style.position = 'fixed';
    panelEl.style.top = Math.min(rect.bottom + 4, window.innerHeight - 20) + 'px';
    panelEl.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 300)) + 'px';
    panelEl.style.width = '260px';
    panelEl.style.maxHeight = Math.min(380, window.innerHeight - rect.bottom - 24) + 'px';
    panelEl.style.overflowY = 'auto';
    document.body.appendChild(el);
  };
  window.closeDuesFilterDropdown = function () {
    var el = document.getElementById('acc-dues-filter-dropdown');
    if (el) el.remove();
    _duesDropdownTrigger = null;
  };
  window._rebuildDuesDropdown = function () {
    var trigger = _duesDropdownTrigger;
    var scrollTop = 0;
    var existing = document.getElementById('acc-dues-filter-dropdown');
    if (existing) { var panel = existing.querySelector('.acc-dd-panel'); if (panel) scrollTop = panel.scrollTop; }
    window.closeDuesFilterDropdown();
    if (trigger) { window.openDuesFilterDropdown(trigger); var p = document.querySelector('.acc-dd-panel'); if (p) p.scrollTop = scrollTop; }
  };
  window._refreshDuesDropdownUI = function () {
    var dd = document.getElementById('acc-dues-filter-dropdown');
    if (!dd) return;
    var section = dd.querySelector('.acc-dd-section');
    if (!section) return;
    var cbs = section.querySelectorAll('.acc-ms-cb');
    var activeCount = 0;
    for (var c = 0; c < cbs.length; c++) if (cbs[c].checked) activeCount++;
    var countSpan = section.querySelector('.acc-dds-count');
    if (countSpan) countSpan.textContent = '(' + bn(activeCount || cbs.length) + (activeCount ? '/' + bn(cbs.length) : '') + ')';
    var selAll = section.querySelector('.acc-ms-selall');
    if (selAll) selAll.textContent = activeCount === 0 ? 'বাতিল সব' : 'সব নির্বাচন';
    var title = dd.querySelector('.acc-sheet-title');
    if (title) title.textContent = 'হিসাব বই' + (activeCount && activeCount < cbs.length ? ' (' + bn(activeCount) + ')' : '');
    var items = section.querySelectorAll('.acc-ms-item');
    for (var it = 0; it < items.length; it++) {
      var cb = items[it].querySelector('.acc-ms-cb');
      if (cb) items[it].classList.toggle('is-on', cb.checked);
    }
  };

  function buildDues(rerenderCmd) {
    var readOnly = isAccountsReadOnly();
    var activeCount = _dueAccFs.length;
    var badge = activeCount ? '<span class="acc-filter-badge">' + bn(activeCount) + '</span>' : '';
    var filterBar = '<div class="acc-toolbar">' +
      '<button type="button" class="acc-filter-icon-btn' + (activeCount ? ' is-on' : '') + '" onclick="openDuesFilterDropdown(this)" style="width:auto;min-width:100px">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>' +
      'হিসাব বই' + badge + '</button></div>';
    var dues = A.Dues.getAll().filter(function (d) { return A.num(d.due) > 0; });
    if (_dueAccFs.length) dues = dues.filter(function (d) { return _dueAccFs.indexOf(d.account) >= 0; });
    if (!dues.length) return filterBar + '<div class="acc-empty">এই হিসাব বইতে কোনো বকেয়া নেই</div>';
    var rows = dues.map(function (d) {
      var isDue = A.num(d.due) > 0;
      var supplier = A.clean(d.supplier, 'সরবরাহকারী');
      return '<tr>' +
        '<td><div>' + esc(supplier) + '</div><small style="color:var(--ink3)">' + esc(A.ACCOUNT_LABELS[d.account] || d.account) + '</small></td>' +
        '<td>৳' + fa(d.total) + '</td>' +
        '<td style="color:var(--green)">৳' + fa(d.paid) + '</td>' +
        '<td style="color:' + (isDue ? 'var(--red)' : 'var(--green)') + ';font-weight:700">' + (isDue ? '' : '✓') + '৳' + fa(Math.abs(A.num(d.due))) + '</td>' +
        (readOnly ? '' : '<td>' + (isDue ? '<button class="acc-pay-btn" onclick="payDue(\'' + esc(d.id) + '\')">পরিশোধ</button>' : '') + '</td>') +
        '</tr>';
    }).join('');
    var totalDue = dues.reduce(function (s, d) { return s + Math.max(0, A.num(d.due)); }, 0);
    return filterBar +
      '<div style="font-size:12px;color:var(--ink3);margin-bottom:8px">মোট বকেয়া: <strong style="color:var(--red)">৳' + fa(totalDue) + '</strong></div>' +
      '<div style="overflow-x:auto"><table class="acc-sum-tbl"><thead><tr><th>সরবরাহকারী</th><th>মোট</th><th>দেওয়া</th><th>বকেয়া</th>' + (readOnly ? '' : '<th></th>') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ══════════════ SETTINGS ══════════════ */
  function buildSettings() {
    var cats = A.Categories.getAll();
    var catRows = cats.map(function (c) {
      var isDef = A.Categories.isDefault(c);
      return '<div class="acc-cat-row"><span>' + esc(c) + (isDef ? ' <span style="font-size:9px;color:var(--ink3)">(ডিফল্ট)</span>' : '') + '</span>' +
        (isDef ? '' : '<button class="acc-del-btn" onclick="delAccCategory(\'' + esc(c) + '\')">✕</button>') + '</div>';
    }).join('');
    var pinBlock = '';
    if (!isAccountsReadOnly() && typeof MMSession !== 'undefined' && MMSession.getStaffUserId()) {
      pinBlock = '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--cream2)">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:10px">PIN পরিবর্তন</div>' +
        '<form onsubmit="event.preventDefault();saveOwnPin()">' +
        '<div class="form-group"><label class="form-label">বর্তমান PIN</label><input class="form-input" type="password" id="pc-cur" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" placeholder="বর্তমান PIN"></div>' +
        '<div class="form-group"><label class="form-label">নতুন PIN</label><input class="form-input" type="password" id="pc-new" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" placeholder="নতুন ৪-সংখ্যার PIN"></div>' +
        '<div class="form-group"><label class="form-label">নতুন PIN নিশ্চিত করুন</label><input class="form-input" type="password" id="pc-conf" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" placeholder="পুনরায় PIN লিখুন"></div>' +
        '<button type="submit" class="submit-btn" style="margin-top:4px">PIN সংরক্ষণ করুন</button>' +
        '<div style="color:var(--red);font-size:12px;text-align:center;margin-top:8px;min-height:18px" id="pc-err"></div>' +
        '</form>' +
        '</div>';
    }
    return '<div style="font-family:\'Tiro Bangla\',serif;font-weight:700;font-size:14px;margin-bottom:8px">ব্যয়ের খাত ব্যবস্থাপনা</div>' +
      '<div style="margin-bottom:10px">' + catRows + '</div>' +
      '<div class="acc-filter-bar">' +
      '<input class="acc-sel" id="acc-new-cat" placeholder="নতুন খাত লিখুন" style="flex:3;border-radius:8px;padding:6px 10px;border:1px solid var(--cream2)">' +
      '<button class="acc-btn acc-btn-inc" onclick="addAccCategory()" style="flex:1.2;border-radius:8px">যোগ করুন</button>' +
      '</div>' + pinBlock;
  }

  window.addAccCategory = async function () {
    var el = document.getElementById('acc-new-cat');
    var name = el ? el.value.trim() : '';
    if (!name) return;
    try {
      await A.Categories.add(name); el.value = '';
      if (isSettingsModalOpen()) renderAccSettingsModal();
      else window.renderAccounts();
    } catch (err) {
      console.warn('[Accounts] category add failed', err);
      showToast('খাত সংরক্ষণ হয়নি');
    }
  };
  window.delAccCategory = async function (name) {
    if (!confirm('"' + name + '" খাত মুছবেন?')) return;
    try {
      await A.Categories.del(name);
      if (isSettingsModalOpen()) renderAccSettingsModal();
      else window.renderAccounts();
    } catch (err) {
      console.warn('[Accounts] category delete failed', err);
      showToast('খাত মুছা যায়নি');
    }
  };

  function isAdminSession() {
    return !!(typeof MMSession !== 'undefined' && MMSession && MMSession.isAdmin && MMSession.isAdmin());
  }

  function isAdminAccountsPage() {
    return !!document.querySelector('.admin-accounts-shell') ||
      /\/admin\/accounts\.html$/i.test((typeof location !== 'undefined' && location.pathname) || '');
  }

  function isAccountsReadOnly() {
    return isAdminAccountsPage();
  }

  function entryAgeHours(entry) {
    var at = Number(entry && entry._at);
    if (!at) return Infinity;
    return (Date.now() - at) / 36e5;
  }

  function describeEntry(type, entry) {
    if (!entry) return '';
    if (type === 'income') {
      return 'ধরন: আয়\nতারিখ: ' + A.dateLabel(entry) + '\nপরিমাণ: ৳' + fa(entry.amount) + '\nবিবরণ: ' + (A.clean(entry.note, '') || A.clean(entry.source, '') || 'আয়');
    }
    return 'ধরন: ব্যয়\nহিসাব বই: ' + (A.ACCOUNT_LABELS[entry.account] || entry.account || '—') +
      '\nতারিখ: ' + A.dateLabel(entry) +
      '\nখাত: ' + (A.clean(entry.category, '') || 'অন্যান্য') +
      '\nবিবরণ: ' + (A.clean(entry.description, '') || 'ব্যয়') +
      '\nপরিমাণ: ৳' + fa(entry.amount) +
      '\nসরবরাহকারী: ' + (A.clean(entry.supplier, '') || 'উল্লেখ নেই');
  }

  function sessionActorId() {
    if (typeof MMSession === 'undefined' || !MMSession) return null;
    return isAdminSession()
      ? (MMSession.getAdminUserId && MMSession.getAdminUserId())
      : (MMSession.getStaffUserId && MMSession.getStaffUserId());
  }

  function sessionPin() {
    if (typeof MMSession === 'undefined' || !MMSession) return null;
    return isAdminSession()
      ? (MMSession.getAdminPin && MMSession.getAdminPin())
      : (MMSession.getStaffPin && MMSession.getStaffPin());
  }

  async function requestEntryChange(action, type, entry, reason, proposed) {
    var fromName = (typeof MMSession !== 'undefined' && MMSession && MMSession.getName && MMSession.getName()) || 'দফতর দায়িত্বশীল';
    var isEdit = action === 'edit';
    var text = 'হিসাব সংশোধন অনুরোধ\nঅ্যাকশন: এন্ট্রি ' + (isEdit ? 'এডিট করতে চান' : 'মুছতে চান') + '\n' + describeEntry(type, entry);
    if (isEdit) text += '\n\nপ্রস্তাবিত পরিবর্তন\n' + describeEntry(type, proposed);
    text += '\nকারণ: ' + reason;
    var request = {
      kind: isEdit ? 'account_entry_edit' : 'account_entry_delete',
      status: 'pending',
      entryType: type,
      entryId: entry.id,
      snapshot: entry,
      proposed: proposed || null,
      reason: reason,
      requestedAt: new Date().toISOString(),
    };
    if (typeof ChatAPI !== 'undefined' && ChatAPI && ChatAPI.send && ChatAPI.sendRemote && sessionPin()) {
      try {
        var res = await ChatAPI.sendRemote(sessionActorId(), sessionPin(), 'daftar', text, isAdminSession(), { request: request });
        if (!res || !res.ok) throw new Error((res && res.error) || 'chat_request_send_failed');
        var extra = { request: request };
        if (res.id) extra.id = String(res.id);
        ChatAPI.send('daftar', 'daftar', fromName, text, extra);
      } catch (e) {
        console.warn('Account approval request remote send failed', e);
        return false;
      }
      return true;
    }
    return false;
  }

  function applyEntryEdit(type, id, proposed) {
    if (type === 'income') A.Income.update(id, proposed);
    else A.Expense.update(id, proposed);
  }

  function refreshAccountsViews() {
    if (isMetricModalOpen()) {
      renderAccMetricModal();
      return;
    }
    window.renderAccounts();
    if (_detailAccount && document.getElementById('account-details-root')) {
      renderAccAccountDetails(_detailAccount);
    }
  }

  function rerenderAccountsView() {
    if (isMetricModalOpen()) renderAccMetricModal();
    else window.renderAccounts();
  }

  function renderAccSettingsModal() {
    var title = document.getElementById('account-details-title');
    var root = document.getElementById('account-details-root');
    if (title) {
      title.className = '';
      title.textContent = 'হিসাব সেটিংস';
    }
    if (root) root.innerHTML = buildSettings();
  }

  window.renderAccSettingsModal = renderAccSettingsModal;

  window.openAccSettingsPanel = function () {
    _metricModalKind = '';
    _detailAccount = '';
    _settingsModalOpen = true;
    var detailsModal = document.getElementById('modal-account-details');
    if (detailsModal) detailsModal.classList.remove('acc-income-detail-open', 'acc-qard-detail-open');
    renderAccSettingsModal();
    openModal('account-details');
  };

  /* ══════════════ REPORT WORKSPACE (মডাল নয় — পূর্ণ-স্ক্রিন ইন-পেইজ ভিউ) ══════════════ */

  /* রিপোর্টের গ্লোবাল ফিল্টার: ফিল্টার শিটের state-ই (_yearFs/_monFs/_accFs/_catFs/
     _fromKey/_toKey/_dayF) রিপোর্টে খাটে। reports.js প্রতিটি সারিতে এটা ডাকে। */
  window.MdrAccRptRowFilter = function (r, kind) {
    if (_yearFs.length && _yearFs.indexOf(String(r.hijriYear)) < 0) return false;
    if (_monFs.length && _monFs.indexOf(A.monthKey(r.month)) < 0) return false;
    if ((_fromKey !== 'all' || _toKey !== 'all') && !A.inRange(r, _fromKey, _toKey)) return false;
    if (_dayF !== 'all') {
      if (_dayF === '__none') { if (A.num(r.day)) return false; }
      else if (String(A.num(r.day)) !== String(_dayF)) return false;
    }
    if (kind === 'expense') {
      if (_accFs.length && _accFs.indexOf(r.account) < 0) return false;
      if (_catFs.length && _catFs.indexOf(A.clean(r.category, '')) < 0) return false;
    }
    return true;
  };

  function accWsFilterCount() {
    return _yearFs.length + _monFs.length + _accFs.length + _catFs.length +
      (_dayF !== 'all' ? 1 : 0) + ((_fromKey !== 'all' || _toKey !== 'all') ? 1 : 0);
  }

  var ACC_WS_MENU = [
    ['overview', 'সারসংক্ষেপ'],
    ['qard', 'করজে হাসানা'],
    ['health', 'নিয়মিত হিসাব ও নগদ'],
    ['monthly', 'মাসিক তুলনা'],
    ['item', 'পণ্য / দর'],
    ['account', 'হিসাব বই'],
    ['supplier', 'সরবরাহকারী'],
    ['due', 'বকেয়া'],
  ];

  function buildReportsWorkspace() {
    var fCount = accWsFilterCount();
    var view = window._rptView || 'overview';
    var menu = ACC_WS_MENU.map(function (m) {
      return '<button type="button" class="acc-ws-menu-item' + (view === m[0] ? ' active' : '') + '" data-ws-kind="' + m[0] + '" onclick="accWsShow(\'' + m[0] + '\')">' + esc(m[1]) + '</button>';
    }).join('');
    return '<div class="acc-ws">' +
      '<div class="acc-ws-top">' +
      '<button type="button" class="acc-ws-back" onclick="closeAccReports()">← হিসাব</button>' +
      '<div class="acc-ws-title">হিসাব রিপোর্ট</div>' +
      '<button type="button" class="acc-filter-icon-btn acc-ws-filter' + (fCount ? ' is-on' : '') + '" onclick="openAccFilterSheet(this)">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>ফিল্টার' +
      (fCount ? '<span class="acc-filter-badge">' + bn(fCount) + '</span>' : '') + '</button>' +
      '</div>' +
      '<div class="acc-ws-layout">' +
      '<nav class="acc-ws-menu">' + menu + '</nav>' +
      '<div class="acc-ws-body"><div id="acc-ws-reports"></div></div>' +
      '</div></div>';
  }

  window.MdrAccWsSyncMenu = function (view) {
    document.querySelectorAll('.acc-ws-menu-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-ws-kind') === (view || 'overview'));
    });
  };

  window.accWsShow = function (kind) {
    if (kind === 'overview') window.showRptOverview();
    else window.openRptDetail(kind);
  };

  window.openAccReportsPanel = function () {
    _metricModalKind = '';
    _settingsModalOpen = false;
    var detailsModal = document.getElementById('modal-account-details');
    if (detailsModal) detailsModal.classList.remove('open', 'acc-income-detail-open', 'acc-qard-detail-open');
    window._rptView = 'overview';
    _tab = 'reports';
    window.renderAccounts();
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  };

  window.closeAccReports = function () {
    _tab = 'summary';
    window.renderAccounts();
  };

  function ensureAccountSettingsTopbar() { /* settings button এখন acc-add-btns-এ */ }

  /* ══════════════ EXCEL IMPORT (.xlsx ফাইল → প্রিভিউ → সংরক্ষণ) ══════════════ */
  var _impFileName = '';
  var _impBusy = false;
  var _impTab = 'expense'; /* expense | income | qard */
  var _impParsed = null; /* { expense:[], income:[], qardGive:[], qardReturn:[] } */

  var IMP_BOOK_MAP = {
    'মাতবাখ': 'matbakh', matbakh: 'matbakh',
    'মাদরাসা': 'madrasa', 'মাদ্রাসা': 'madrasa', madrasa: 'madrasa',
    'তামিরাত': 'tamirat', tamirat: 'tamirat',
    'সাধারণ': 'general', general: 'general',
  };

  function impEnDigits(s) {
    return String(s == null ? '' : s)
      .replace(/[০-৯]/g, function (d) { return String('০১২৩৪৫৬৭৮৯'.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
  }

  function impNormHeader(h) {
    return impEnDigits(String(h || ''))
      .replace(/\*/g, '')
      .replace(/[_\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function impCellStr(v) {
    if (v == null || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && v > 20000 && v < 80000 && typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
      var p = XLSX.SSF.parse_date_code(v);
      if (p && p.y) return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
    }
    return String(v).trim();
  }

  function impParseDate(raw) {
    var t = impEnDigits(impCellStr(raw));
    if (!t) return { err: 'empty' };
    var p = t.split(/[-/.\s]+/).map(function (x) { return parseInt(x, 10); });
    if (p.length !== 3 || p.some(function (n) { return isNaN(n); })) return { err: 'format' };
    function hij(y, m, d) {
      if (m < 1 || m > 12 || d < 1 || d > 30) return null;
      return { year: y, month: A.monthFromNo(m), day: d };
    }
    if (p[0] >= 1300 && p[0] <= 1600) return hij(p[0], p[1], p[2]) || { err: 'format' };
    if (p[2] >= 1300 && p[2] <= 1600) return hij(p[2], p[1], p[0]) || { err: 'format' };
    var gy = null, gm = null, gd = null;
    if (p[0] >= 1900 && p[0] <= 2200) { gy = p[0]; gm = p[1]; gd = p[2]; }
    else if (p[2] >= 1900 && p[2] <= 2200) { gy = p[2]; gm = p[1]; gd = p[0]; }
    if (gy === null) return { err: 'format' };
    if (gm > 12 && gd <= 12) { var tmp = gm; gm = gd; gd = tmp; }
    if (gm < 1 || gm > 12 || gd < 1 || gd > 31) return { err: 'format' };
    var iso = String(gy) + '-' + String(gm).padStart(2, '0') + '-' + String(gd).padStart(2, '0');
    var g = A.gregorianISOToHijri ? A.gregorianISOToHijri(iso) : null;
    if (!g) return { err: 'range' };
    return { year: g.hijriYear, month: g.month, day: g.day };
  }

  function impResolveBook(raw) {
    var t = impNormHeader(raw);
    if (!t) return null;
    if (IMP_BOOK_MAP[t]) return IMP_BOOK_MAP[t];
    var labels = A.ACCOUNT_LABELS || {};
    var keys = Object.keys(labels);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === 'qard' || keys[i] === 'qard_return') continue;
      if (impNormHeader(labels[keys[i]]) === t || keys[i] === t) return keys[i];
    }
    return null;
  }

  function impResolvePay(raw) {
    var t = impNormHeader(raw);
    if (!t || t === 'নগদ' || t === 'cash' || t === 'paid') return 'cash';
    if (t === 'বাকি' || t === 'due' || t === 'credit' || t === 'বাকী') return 'due';
    return 'cash';
  }

  function impResolveQardKind(raw) {
    var t = impNormHeader(raw);
    if (t === 'দেওয়া' || t === 'দেওয়া' || t === 'দেয়া' || t === 'give' || t === 'given' || t === 'out') return 'give';
    if (t === 'আদায়' || t === 'আদায়' || t === 'ফেরত' || t === 'return' || t === 'recovery' || t === 'in') return 'return';
    return null;
  }

  function impHeaderIndex(headers, aliases) {
    var norms = headers.map(impNormHeader);
    for (var a = 0; a < aliases.length; a++) {
      var want = impNormHeader(aliases[a]);
      for (var i = 0; i < norms.length; i++) {
        if (norms[i] === want || norms[i].indexOf(want) === 0) return i;
      }
    }
    return -1;
  }

  function impSheetKind(name) {
    var n = impNormHeader(name).replace(/\s+/g, '');
    if (/নির্দেশ|dashboard|ড্যাশবোর্ড|dash|বকেয়া|^পরিশোধ$|পরিশোধ/.test(n)) return 'skip';
    if (/^করজ|qard|loan/.test(n)) return 'qard';
    if (/^আয়|^আয়|^income|^inc/.test(n)) return 'income';
    if (/^ব্যয়|^ব্যয়|^expense|^exp|মাস্টার/.test(n)) return 'expense';
    return 'skip';
  }

  function impTplHref() {
    try {
      if (/\/admin\/accounts\.html/i.test(location.pathname || '')) return '../templates/daftar-hisab-template.xlsx';
    } catch (e) {}
    return 'templates/daftar-hisab-template.xlsx';
  }

  window.downloadAccHisabTemplate = function () {
    if (typeof XLSX === 'undefined') { showToast('Excel লাইব্রেরি লোড হয়নি'); return; }
    try {
      var wb = XLSX.utils.book_new();
      var guide = [
        ['দপ্তর হিসাব — স্ট্যান্ডার্ড Excel টেমপ্লেট'],
        [],
        ['শীট', 'ব্যয় · আয় · করজ · পরিশোধ · বকেয়া · ড্যাশবোর্ড'],
        ['ব্যয়', 'হিসাব বই + বাকি হলে পরিশোধ=বাকি ও সরবরাহকারী'],
        ['মোট টাকা', 'পরিমাণ × একক মূল্য হলে অটো; বিল হলে শুধু মোট'],
        ['বকেয়া', 'নাম তালিকা এখানে → ব্যয়/পরিশোধ ড্রপডাউন; অবশিষ্ট = বাকি − পরিশোধ'],
        ['পরিশোধ', 'বকেয়া মেটানো; সরবরাহকারী ড্রপডাউন থেকে'],
        ['আয় / করজ', 'নিয়মিত আয়; করজ দেওয়া/আদায়'],
        ['অ্যাপে', 'দিনশেষে এক্সেল ↧ দিয়ে আপলোড — একই সারি দুবার নয়'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), 'নির্দেশনা');

      var expHeader = ['হিসাব বই *', 'তারিখ *', 'খাত', 'বিবরণ', 'পরিমাণ', 'মাপ', 'একক মূল্য', 'মোট টাকা (অটো)', 'সরবরাহকারী', 'রশিদ নং', 'পরিশোধ'];
      var expSamples = [
        ['মাতবাখ', '1447-10-02', 'কাঁচামাল', 'চাল', 50, 'কেজি', 70, null, 'রহিম স্টোর', '১০১', 'নগদ'],
        ['মাতবাখ', '1447-10-03', 'কাঁচামাল', 'ডাল', 20, 'কেজি', 120, null, 'রহিম স্টোর', '', 'নগদ'],
        ['মাদরাসা', '1447-10-04', 'স্টেশনারি', 'খাতা ও কলম', 10, 'প্যাকেট', 80, null, 'বইঘর', '', 'নগদ'],
        ['তামিরাত', '1447-09-20', 'মেরামত', 'ছাদের প্লাস্টার', 1, 'পিস', 15000, null, 'রাজমিস্ত্রি করিম', '', 'বাকি'],
        ['সাধারণ', '1447-10-06', 'পরিবহন', 'বাজার আনা-নেওয়া', '', '', '', 500, '', '', 'নগদ'],
        ['মাদরাসা', '2026-07-10', 'বিদ্যুৎ', 'বিদ্যুৎ বিল', '', '', '', 4500, 'পল্লী বিদ্যুৎ', 'বিল-৮৮', 'নগদ'],
      ];
      var expWs = XLSX.utils.aoa_to_sheet([expHeader].concat(expSamples));
      var maxR = 500;
      for (var r = 2; r <= maxR; r++) {
        var isBill = r === 6 || r === 7;
        if (!isBill) {
          expWs['H' + r] = { t: 'n', f: 'IF(AND(E' + r + '<>"",G' + r + '<>""),E' + r + '*G' + r + ',"")' };
        }
      }
      expWs.H6 = { t: 'n', v: 500 };
      expWs.H7 = { t: 'n', v: 4500 };
      if (!expWs['!ref']) expWs['!ref'] = 'A1:K' + maxR;
      else {
        var range = XLSX.utils.decode_range(expWs['!ref']);
        if (range.e.r < maxR - 1) range.e.r = maxR - 1;
        if (range.e.c < 10) range.e.c = 10;
        expWs['!ref'] = XLSX.utils.encode_range(range);
      }
      XLSX.utils.book_append_sheet(wb, expWs, 'ব্যয়');

      var inc = [
        ['তারিখ *', 'টাকা *', 'উৎস / বিবরণ'],
        ['1447-10-01', 50000, 'বিকাশ অনুদান'],
        ['1447-10-05', 12000, 'ওয়াযিফা আদায় — শাওয়াল'],
        ['2026-07-10', 3000, 'নগদ দান'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inc), 'আয়');
      var qard = [
        ['ধরন *', 'তারিখ *', 'টাকা *', 'খাত *', 'বিবরণ'],
        ['দেওয়া', '1447-08-15', 20000, 'করিম ভাই', 'করজে হাসানা'],
        ['দেওয়া', '1447-09-01', 10000, 'মাদরাসা ফান্ড', 'জরুরি করজ'],
        ['আদায়', '1447-10-07', 5000, 'করিম ভাই', ''],
        ['আদায়', '1447-10-11', 2000, 'মাদরাসা ফান্ড', ''],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qard), 'করজ');

      var pay = [
        ['তারিখ *', 'সরবরাহকারী *', 'টাকা *', 'মন্তব্য'],
        ['1447-10-15', 'রাজমিস্ত্রি করিম', 5000, 'আংশিক পরিশোধ'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pay), 'পরিশোধ');

      var dueWs = XLSX.utils.aoa_to_sheet([
        ['সরবরাহকারী বকেয়া (লাইভ)'],
        ['বাকি কেনা − পরিশোধ = অবশিষ্ট। নতুন নাম এখানে লিখুন → ব্যয়/পরিশোধ ড্রপডাউনে আসবে।'],
        [],
        ['মোট বাকি কেনা', { f: 'SUMIF(ব্যয়!K:K,"বাকি",ব্যয়!H:H)' }],
        ['মোট পরিশোধ', { f: 'SUM(পরিশোধ!C:C)' }],
        ['এখন মোট বাকি', { f: 'B4-B5' }],
        [],
        ['সরবরাহকারী', 'বাকি কেনা', 'পরিশোধ', 'অবশিষ্ট বাকি', 'বার'],
        ['রাজমিস্ত্রি করিম', null, null, null, null],
      ]);
      for (var dr = 9; dr <= 58; dr++) {
        if (dr > 9) dueWs['A' + dr] = { t: 's', v: '' };
        dueWs['B' + dr] = { t: 'n', f: 'IF(A' + dr + '="","",SUMIFS(ব্যয়!$H$2:$H$500,ব্যয়!$I$2:$I$500,A' + dr + ',ব্যয়!$K$2:$K$500,"বাকি"))' };
        dueWs['C' + dr] = { t: 'n', f: 'IF(A' + dr + '="","",SUMIF(পরিশোধ!$B$2:$B$500,A' + dr + ',পরিশোধ!$C$2:$C$500))' };
        dueWs['D' + dr] = { t: 'n', f: 'IF(A' + dr + '="","",B' + dr + '-C' + dr + ')' };
        dueWs['E' + dr] = { t: 'n', f: 'IF(A' + dr + '="","",COUNTIFS(ব্যয়!$I$2:$I$500,A' + dr + ',ব্যয়!$K$2:$K$500,"বাকি"))' };
      }
      dueWs['!ref'] = 'A1:E58';
      XLSX.utils.book_append_sheet(wb, dueWs, 'বকেয়া');

      var dash = [
        ['সামারি (লাইভ)'],
        ['বিবরণ', 'টাকা'],
        ['মোট ব্যয়', { f: 'SUM(ব্যয়!H:H)' }],
        ['মোট আয়', { f: 'SUM(আয়!B:B)' }],
        ['করজ দেওয়া', { f: 'SUMIF(করজ!A:A,"দেওয়া",করজ!C:C)' }],
        ['করজ আদায়', { f: 'SUMIF(করজ!A:A,"আদায়",করজ!C:C)' }],
        ['করজ বাকি', { f: 'B5-B6' }],
        ['সরবরাহকারী বাকি', { f: 'বকেয়া!B6' }],
        ['নগদ (আনুমানিক)', { f: 'B4-B3-B5+B6' }],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dash), 'ড্যাশবোর্ড');
      XLSX.writeFile(wb, 'daftar-hisab-template.xlsx');
      showToast('টেমপ্লেট ডাউনলোড হয়েছে');
    } catch (err) {
      console.warn('[Accounts] template download failed', err);
      try {
        var a = document.createElement('a');
        a.href = impTplHref();
        a.download = 'daftar-hisab-template.xlsx';
        a.click();
      } catch (e2) {
        showToast('টেমপ্লেট ডাউনলোড যায়নি');
      }
    }
  };

  function impMarkRow(row, d, amt) {
    row.amt = amt;
    row.date = d;
    if (d.err) {
      row.status = 'err';
      row.msg = d.err === 'range' ? 'ইংরেজি তারিখ সীমার বাইরে' : 'তারিখ বোঝা যায়নি';
    } else if (!amt || amt <= 0) {
      row.status = 'err';
      row.msg = 'টাকার অঙ্ক নেই';
    }
    return row;
  }

  function impParseExpenseSheet(matrix, sheetName) {
    if (!matrix || !matrix.length) return [];
    var headers = (matrix[0] || []).map(impCellStr);
    var iBook = impHeaderIndex(headers, ['হিসাব বই', 'বই', 'account', 'book']);
    var iDate = impHeaderIndex(headers, ['তারিখ', 'date']);
    var iCat = impHeaderIndex(headers, ['খাত', 'category']);
    var iDesc = impHeaderIndex(headers, ['বিবরণ', 'description', 'item']);
    var iQty = impHeaderIndex(headers, ['পরিমাণ', 'quantity', 'qty']);
    var iUnit = impHeaderIndex(headers, ['মাপ', 'unit']);
    var iPrice = impHeaderIndex(headers, ['একক মূল্য', 'একক দর', 'দর', 'unit price', 'price']);
    var iAmt = impHeaderIndex(headers, ['মোট টাকা', 'মোট টাকা (অটো)', 'মোট', 'টাকা', 'amount']);
    var iSup = impHeaderIndex(headers, ['সরবরাহকারী', 'supplier']);
    var iRec = impHeaderIndex(headers, ['রশিদ নং', 'রশিদ', 'receipt']);
    var iPay = impHeaderIndex(headers, ['পরিশোধ', 'payment']);
    if (iDate < 0) return [{ line: 1, sheet: sheetName, status: 'err', msg: 'ব্যয় শীটে «তারিখ» কলাম লাগবে', amt: 0 }];
    if (iAmt < 0 && (iQty < 0 || iPrice < 0)) {
      return [{ line: 1, sheet: sheetName, status: 'err', msg: 'ব্যয় শীটে «মোট টাকা» বা পরিমাণ+একক মূল্য কলাম লাগবে', amt: 0 }];
    }
    var rows = [];
    for (var r = 1; r < matrix.length && rows.length < 2000; r++) {
      var cols = matrix[r] || [];
      if (!cols.some(function (c) { return impCellStr(c) !== ''; })) continue;
      var get = function (i) { return i >= 0 ? impCellStr(cols[i]) : ''; };
      var row = { line: r + 1, sheet: sheetName, status: 'ok', msg: '', kind: 'expense' };
      var book = iBook >= 0 ? impResolveBook(get(iBook)) : null;
      if (iBook >= 0 && !book) {
        row.status = 'err';
        row.msg = 'হিসাব বই বোঝা যায়নি («' + get(iBook) + '»)';
        row.amt = 0;
        rows.push(row);
        continue;
      }
      if (!book) book = 'general';
      var d = impParseDate(get(iDate));
      var qty = sanitizeNumStr(get(iQty));
      var price = sanitizeNumStr(get(iPrice));
      var amt = parseFloat(sanitizeNumStr(get(iAmt))) || 0;
      if (!amt) amt = (parseFloat(qty) || 0) * (parseFloat(price) || 0);
      var pay = impResolvePay(get(iPay));
      var supplier = get(iSup);
      row.data = {
        account: book, hijriYear: d.year, month: d.month, day: d.day,
        category: get(iCat), description: get(iDesc),
        quantity: qty, unit: get(iUnit), unitPrice: price,
        amount: amt, supplier: supplier, receiptNo: get(iRec), paymentMethod: pay,
      };
      impMarkRow(row, d, amt);
      if (row.status === 'ok' && pay === 'due' && !supplier) {
        row.status = 'err';
        row.msg = 'বাকি হলে সরবরাহকারী লাগবে';
      }
      rows.push(row);
    }
    return rows;
  }

  function impParseIncomeSheet(matrix, sheetName) {
    if (!matrix || !matrix.length) return [];
    var headers = (matrix[0] || []).map(impCellStr);
    var iDate = impHeaderIndex(headers, ['তারিখ', 'date']);
    var iAmt = impHeaderIndex(headers, ['টাকা', 'পরিমাণ', 'amount', 'মোট']);
    var iNote = impHeaderIndex(headers, ['উৎস / বিবরণ', 'উৎস', 'বিবরণ', 'note', 'source']);
    if (iDate < 0 || iAmt < 0) return [{ line: 1, sheet: sheetName, status: 'err', msg: 'আয় শীটে «তারিখ» ও «টাকা» কলাম লাগবে', amt: 0 }];
    var rows = [];
    for (var r = 1; r < matrix.length && rows.length < 2000; r++) {
      var cols = matrix[r] || [];
      if (!cols.some(function (c) { return impCellStr(c) !== ''; })) continue;
      var get = function (i) { return i >= 0 ? impCellStr(cols[i]) : ''; };
      var row = { line: r + 1, sheet: sheetName, status: 'ok', msg: '', kind: 'income' };
      var d = impParseDate(get(iDate));
      var amt = parseFloat(sanitizeNumStr(get(iAmt))) || 0;
      row.data = { hijriYear: d.year, month: d.month, day: d.day, amount: amt, note: get(iNote) };
      rows.push(impMarkRow(row, d, amt));
    }
    return rows;
  }

  function impParseQardSheet(matrix, sheetName) {
    if (!matrix || !matrix.length) return { give: [], ret: [] };
    var headers = (matrix[0] || []).map(impCellStr);
    var iKind = impHeaderIndex(headers, ['ধরন', 'type', 'kind']);
    var iDate = impHeaderIndex(headers, ['তারিখ', 'date']);
    var iAmt = impHeaderIndex(headers, ['টাকা', 'পরিমাণ', 'amount', 'মোট']);
    var iCat = impHeaderIndex(headers, ['খাত', 'category', 'নাম']);
    var iNote = impHeaderIndex(headers, ['বিবরণ', 'মন্তব্য', 'note']);
    if (iKind < 0 || iDate < 0 || iAmt < 0 || iCat < 0) {
      var err = [{ line: 1, sheet: sheetName, status: 'err', msg: 'করজ শীটে ধরন/তারিখ/টাকা/খাত কলাম লাগবে', amt: 0 }];
      return { give: err, ret: [] };
    }
    var give = [], ret = [];
    for (var r = 1; r < matrix.length && (give.length + ret.length) < 2000; r++) {
      var cols = matrix[r] || [];
      if (!cols.some(function (c) { return impCellStr(c) !== ''; })) continue;
      var get = function (i) { return i >= 0 ? impCellStr(cols[i]) : ''; };
      var kind = impResolveQardKind(get(iKind));
      var row = { line: r + 1, sheet: sheetName, status: 'ok', msg: '', kind: kind === 'return' ? 'qardReturn' : 'qardGive' };
      if (!kind) {
        row.status = 'err';
        row.msg = 'ধরন «দেওয়া» বা «আদায়» হতে হবে';
        row.amt = 0;
        give.push(row);
        continue;
      }
      var d = impParseDate(get(iDate));
      var amt = parseFloat(sanitizeNumStr(get(iAmt))) || 0;
      var cat = get(iCat);
      var note = get(iNote);
      if (!cat) {
        row.status = 'err';
        row.msg = 'খাতের নাম লাগবে';
        row.amt = amt;
        row.date = d;
        (kind === 'give' ? give : ret).push(row);
        continue;
      }
      if (kind === 'give') {
        row.data = {
          account: 'qard', hijriYear: d.year, month: d.month, day: d.day,
          category: cat, description: note || '', quantity: '', unit: '', unitPrice: '',
          amount: amt, supplier: '', receiptNo: '', paymentMethod: 'cash',
        };
        give.push(impMarkRow(row, d, amt));
      } else {
        row.data = {
          account: 'qard_return', hijriYear: d.year, month: d.month, day: d.day,
          amount: amt, note: 'করজে হাসানা আদায় — ' + cat + (note ? ' — ' + note : ''), source: 'করজে হাসানা',
        };
        ret.push(impMarkRow(row, d, amt));
      }
    }
    return { give: give, ret: ret };
  }

  function impParseWorkbook(wb) {
    var out = { expense: [], income: [], qardGive: [], qardReturn: [] };
    var names = wb.SheetNames || [];
    var found = false;
    names.forEach(function (name) {
      var kind = impSheetKind(name);
      if (kind === 'skip') return;
      found = true;
      var sheet = wb.Sheets[name];
      var matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
      if (kind === 'expense') out.expense = out.expense.concat(impParseExpenseSheet(matrix, name));
      else if (kind === 'income') out.income = out.income.concat(impParseIncomeSheet(matrix, name));
      else if (kind === 'qard') {
        var q = impParseQardSheet(matrix, name);
        out.qardGive = out.qardGive.concat(q.give);
        out.qardReturn = out.qardReturn.concat(q.ret);
      }
    });
    if (!found) {
      out.expense = [{ line: 1, sheet: '', status: 'err', msg: 'ব্যয়/আয়/করজ নামের কোনো শীট পাওয়া যায়নি', amt: 0 }];
    }
    return out;
  }

  function impAllRows() {
    if (!_impParsed) return [];
    return [].concat(_impParsed.expense || [], _impParsed.income || [], _impParsed.qardGive || [], _impParsed.qardReturn || []);
  }

  function impTabRows() {
    if (!_impParsed) return [];
    if (_impTab === 'income') return _impParsed.income || [];
    if (_impTab === 'qard') return [].concat(_impParsed.qardGive || [], _impParsed.qardReturn || []);
    return _impParsed.expense || [];
  }

  function impOkRows() {
    return impAllRows().filter(function (r) { return r.status === 'ok'; });
  }

  function bindAccImpDrop() {
    var drop = document.getElementById('acc-imp-drop');
    var input = document.getElementById('acc-imp-file');
    if (!drop || !input) return;
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-drag'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-drag'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) window.handleAccImpFile(f);
    });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) window.handleAccImpFile(f);
      input.value = '';
    });
  }

  function renderAccImport() {
    var root = document.getElementById('acc-import-root');
    if (!root) return;
    var help =
      '<div class="acc-imp-help"><b>স্ট্যান্ডার্ড .xlsx ফাইল আপলোড করুন</b> — শীট: <b>ব্যয়</b>, <b>আয়</b>, <b>করজ</b>। ' +
      'ড্যাশবোর্ড/নির্দেশনা শীট অ্যাপ পড়ে না। ব্যয়ে <b>হিসাব বই</b> কলাম থেকে বই অটো-সাজানো হয়। ' +
      'মোট টাকা = পরিমাণ × একক মূল্য (অটো)। বকেয়া/পরিশোধ শীট Excel-এ লাইভ দেখার জন্য।' +
      '<br><button type="button" class="acc-imp-tpl" onclick="downloadAccHisabTemplate()">⬇ খালি টেমপ্লেট ডাউনলোড</button></div>';
    var drop =
      '<div class="acc-imp-drop" id="acc-imp-drop" role="button" tabindex="0">' +
      '<p class="acc-imp-drop-title">Excel ফাইল এখানে রাখুন বা বেছে নিন</p>' +
      '<p class="acc-imp-drop-sub">শুধু .xlsx · ব্যয় + আয় + করজ একসাথে</p>' +
      '<input type="file" id="acc-imp-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
      '</div>';
    var fileRow = _impFileName
      ? '<div class="acc-imp-file-row"><span class="acc-imp-file-name">📄 ' + esc(_impFileName) + '</span>' +
        '<button type="button" class="acc-imp-clear" onclick="clearAccImpFile()">সরান</button></div>'
      : '';
    root.innerHTML = help + drop + fileRow + '<div id="acc-imp-preview">' + buildImpPreview() + '</div>';
    bindAccImpDrop();
  }

  function buildImpPreview() {
    if (!_impParsed) return '';
    var all = impAllRows();
    if (!all.length) return '<div class="acc-empty">ফাইলে কোনো ডেটা সারি পাওয়া যায়নি</div>';
    var okAll = impOkRows();
    var errN = all.filter(function (r) { return r.status === 'err'; }).length;
    var savedN = all.filter(function (r) { return r.status === 'saved'; }).length;
    var tabs =
      '<div class="acc-imp-tabs">' +
      '<button type="button" class="acc-imp-tab' + (_impTab === 'expense' ? ' is-on' : '') + '" onclick="setAccImpTab(\'expense\')">ব্যয় (' + bn((_impParsed.expense || []).length) + ')</button>' +
      '<button type="button" class="acc-imp-tab' + (_impTab === 'income' ? ' is-on' : '') + '" onclick="setAccImpTab(\'income\')">আয় (' + bn((_impParsed.income || []).length) + ')</button>' +
      '<button type="button" class="acc-imp-tab' + (_impTab === 'qard' ? ' is-on' : '') + '" onclick="setAccImpTab(\'qard\')">করজ (' + bn(((_impParsed.qardGive || []).length + (_impParsed.qardReturn || []).length)) + ')</button>' +
      '</div>';
    var rows = impTabRows();
    var okTab = rows.filter(function (r) { return r.status === 'ok'; });
    var totalAmt = okTab.reduce(function (s, r) { return s + (r.amt || 0); }, 0);
    var statusLabel = { ok: '✓ ঠিক আছে', err: '', saved: 'সংরক্ষিত ✓' };
    var ths;
    if (_impTab === 'income') ths = '<th>#</th><th>তারিখ</th><th>টাকা</th><th>উৎস / বিবরণ</th><th>অবস্থা</th>';
    else if (_impTab === 'qard') ths = '<th>#</th><th>ধরন</th><th>তারিখ</th><th>টাকা</th><th>খাত</th><th>অবস্থা</th>';
    else ths = '<th>#</th><th>বই</th><th>তারিখ</th><th>খাত</th><th>বিবরণ</th><th>মোট</th><th>সরবরাহকারী</th><th>পরিশোধ</th><th>অবস্থা</th>';
    var trs = rows.map(function (r) {
      var d = r.data || {};
      var okDate = r.status === 'ok' || r.status === 'saved';
      var dateTxt = okDate && r.date && !r.date.err ? bn(A.dateKey(r.date.year, r.date.month, r.date.day)) : '—';
      var st = '<span class="acc-imp-status ' + r.status + '">' + esc(statusLabel[r.status] || r.msg || '') + '</span>';
      var cells;
      if (_impTab === 'income') {
        cells = '<td>' + dateTxt + '</td><td><b>' + (r.amt ? fa(r.amt) : '—') + '</b></td><td>' + esc(d.note || '') + '</td>';
      } else if (_impTab === 'qard') {
        var qKind = r.kind === 'qardReturn' ? 'আদায়' : 'দেওয়া';
        var qCat = r.kind === 'qardReturn'
          ? String(d.note || '').replace(/^করজে হাসানা আদায় —\s*/, '').split(' — ')[0]
          : (d.category || '');
        cells = '<td>' + esc(qKind) + '</td><td>' + dateTxt + '</td><td><b>' + (r.amt ? fa(r.amt) : '—') + '</b></td><td>' + esc(qCat) + '</td>';
      } else {
        cells = '<td>' + esc(A.ACCOUNT_LABELS[d.account] || d.account || '') + '</td><td>' + dateTxt + '</td><td>' + esc(d.category || '') + '</td><td>' + esc(d.description || '') + '</td><td><b>' + (r.amt ? fa(r.amt) : '—') + '</b></td><td>' + esc(d.supplier || '') + '</td><td>' + esc(d.paymentMethod === 'due' ? 'বাকি' : 'নগদ') + '</td>';
      }
      return '<tr class="is-' + r.status + '"><td>' + bn(r.line) + '</td>' + cells + '<td>' + st + '</td></tr>';
    }).join('');
    if (!rows.length) trs = '<tr><td colspan="9" style="text-align:center;color:var(--ink3)">এই ট্যাবে সারি নেই</td></tr>';
    var pills =
      '<div class="acc-imp-summary">' +
      '<span class="acc-imp-pill">মোট সারি: ' + bn(all.length) + '</span>' +
      '<span class="acc-imp-pill ok">ঠিক আছে: ' + bn(okAll.length) + '</span>' +
      (errN ? '<span class="acc-imp-pill err">সমস্যা: ' + bn(errN) + '</span>' : '') +
      (savedN ? '<span class="acc-imp-pill ok">সংরক্ষিত: ' + bn(savedN) + '</span>' : '') +
      '<span class="acc-imp-pill">এই ট্যাব: ৳' + fa(totalAmt) + '</span>' +
      '</div>';
    var saveBtn = '<button type="button" class="submit-btn gold" id="acc-imp-save" onclick="saveAccImport()"' + (okAll.length && !_impBusy ? '' : ' disabled') + '>' +
      (okAll.length ? '✓ ' + count(okAll.length, 'টি') + ' এন্ট্রি সংরক্ষণ করুন' : 'সংরক্ষণের মতো সারি নেই') + '</button>';
    return tabs + pills + '<div class="acc-imp-wrap"><table class="acc-imp-table"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div>' + saveBtn;
  }

  window.openAccImportModal = function () {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি যোগ করা যায় না'); return; }
    if (typeof XLSX === 'undefined') { showToast('Excel লাইব্রেরি লোড হয়নি — পেজ রিফ্রেশ করে আবার চেষ্টা করুন'); return; }
    _impParsed = null;
    _impFileName = '';
    _impBusy = false;
    _impTab = 'expense';
    renderAccImport();
    openModal('account-import');
  };

  window.setAccImpTab = function (t) {
    _impTab = t === 'income' ? 'income' : (t === 'qard' ? 'qard' : 'expense');
    var pv = document.getElementById('acc-imp-preview');
    if (pv) pv.innerHTML = buildImpPreview();
  };

  window.clearAccImpFile = function () {
    _impParsed = null;
    _impFileName = '';
    renderAccImport();
  };

  window.handleAccImpFile = function (file) {
    if (!file) return;
    var name = String(file.name || '');
    if (!/\.xlsx$/i.test(name)) { showToast('শুধু .xlsx ফাইল দিন'); return; }
    if (typeof XLSX === 'undefined') { showToast('Excel লাইব্রেরি লোড হয়নি'); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = new Uint8Array(ev.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        _impFileName = name;
        _impParsed = impParseWorkbook(wb);
        if ((_impParsed.expense || []).length) _impTab = 'expense';
        else if ((_impParsed.income || []).length) _impTab = 'income';
        else _impTab = 'qard';
        renderAccImport();
        var pv = document.getElementById('acc-imp-preview');
        if (pv) pv.scrollIntoView({ block: 'nearest' });
        var okN = impOkRows().length;
        var errN = impAllRows().filter(function (r) { return r.status === 'err'; }).length;
        showToast(okN ? (bn(okN) + 'টি ঠিক আছে' + (errN ? ', ' + bn(errN) + 'টি সমস্যা' : '')) : 'সঠিক সারি পাওয়া যায়নি');
      } catch (err) {
        console.warn('[Accounts] xlsx parse failed', err);
        showToast('ফাইল পড়া যায়নি — টেমপ্লেট ফরম্যাট যাচাই করুন');
      }
    };
    reader.onerror = function () { showToast('ফাইল পড়া যায়নি'); };
    reader.readAsArrayBuffer(file);
  };

  window.saveAccImport = async function () {
    if (_impBusy) return;
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি যোগ করা যায় না'); return; }
    var okExpense = (_impParsed && _impParsed.expense || []).filter(function (r) { return r.status === 'ok'; });
    var okIncome = (_impParsed && _impParsed.income || []).filter(function (r) { return r.status === 'ok'; });
    var okQardG = (_impParsed && _impParsed.qardGive || []).filter(function (r) { return r.status === 'ok'; });
    var okQardR = (_impParsed && _impParsed.qardReturn || []).filter(function (r) { return r.status === 'ok'; });
    var totalOk = okExpense.length + okIncome.length + okQardG.length + okQardR.length;
    if (!totalOk) { showToast('সংরক্ষণের মতো কোনো সঠিক সারি নেই'); return; }
    if (!A.remoteReady || !A.remoteReady()) { showToast('সার্ভার সংযোগ নেই — নেট/লগইন দেখে আবার চেষ্টা করুন'); return; }
    _impBusy = true;
    var btn = document.getElementById('acc-imp-save');
    var done = 0;
    function prog() { if (btn) btn.textContent = 'আপলোড হচ্ছে… ' + bn(done) + '/' + bn(totalOk); }
    function markListSaved(list) {
      (list || []).forEach(function (r) { r.status = 'saved'; r.msg = ''; });
    }
    if (btn) { btn.disabled = true; prog(); }
    try {
      var expList = okExpense.concat(okQardG).map(function (r) { return r.data; });
      var incList = okIncome.concat(okQardR).map(function (r) { return r.data; });
      if (expList.length) {
        await A.Expense.bulkAdd(expList, function (d) { done = d; prog(); });
        markListSaved(okExpense);
        markListSaved(okQardG);
        done = expList.length;
        prog();
      }
      if (incList.length) {
        var base = done;
        await A.Income.bulkAdd(incList, function (d) { done = base + d; prog(); });
        markListSaved(okIncome);
        markListSaved(okQardR);
        done = expList.length + incList.length;
        prog();
      }
      for (var i = 0; i < okExpense.length; i++) {
        var ed = (okExpense[i].data || {});
        if (ed.paymentMethod === 'due' && ed.supplier) {
          try { await A.Dues.addOrUpdate(ed.supplier, ed.account, ed.amount); } catch (eDue) {
            console.warn('[Accounts] import due update failed', eDue);
          }
        }
      }
      _impBusy = false;
      _impParsed = null;
      _impFileName = '';
      closeModal('account-import');
      refreshAccountsViews();
      showToast(count(totalOk, 'টি') + ' এন্ট্রি যুক্ত হয়েছে ✓');
    } catch (err) {
      console.warn('[Accounts] excel import failed', err);
      _impBusy = false;
      var up = err && err.uploadedCount ? err.uploadedCount : 0;
      /* বর্তমান ব্যাচের আংশিক আপলোড মার্ক — আগে ব্যয়, পরে আয় */
      if (up > 0) {
        var left = up;
        [].concat(okExpense, okQardG, okIncome, okQardR).forEach(function (r) {
          if (r.status === 'ok' && left > 0) { r.status = 'saved'; r.msg = ''; left--; }
        });
      }
      showToast(up > 0
        ? (bn(up) + 'টি এই ধাপে সংরক্ষিত — বাকিগুলোর জন্য আবার "সংরক্ষণ" চাপুন')
        : 'ডাটাবেজে সংরক্ষণ হয়নি — আবার চেষ্টা করুন');
      refreshAccountsViews();
      renderAccImport();
    }
  };

  /* ══════════════ MAIN RENDER ══════════════ */
  window.renderAccounts = function () {
    A.ensureSeed();
    ensureCurrentMonthDefault();
    normalizeMonthFilters();
    var root = document.getElementById('accounts-root');
    if (!root) return;
    if (_tab === 'reports') {
      root.innerHTML = '<div class="acc-shell">' + buildReportsWorkspace() + '</div>';
      var wsC = document.getElementById('acc-ws-reports');
      if (wsC) {
        if (typeof window.renderAccountsReports === 'function') window.renderAccountsReports(wsC);
        else wsC.innerHTML = '<div class="acc-empty">রিপোর্ট লোড হয়নি</div>';
      }
      return;
    }
    var readOnly = isAccountsReadOnly();
    var actionBtns = '<button type="button" class="acc-report-top" onclick="openAccReportsPanel()">রিপোর্ট</button>';
    var topControls = readOnly
      ? '<div class="acc-add-btns acc-readonly">' + actionBtns + '</div>'
      : '<div class="acc-add-btns has-month"><button class="acc-btn acc-btn-inc" onclick="openAccModal(\'income\')">＋ আয়</button><button class="acc-btn acc-btn-exp" onclick="openAccModal(\'expense\')">＋ ব্যয়</button>' + actionBtns +
        '<button type="button" class="acc-report-top acc-imp-open" onclick="openAccImportModal()">এক্সেল ↧</button></div>';
    root.innerHTML =
      '<div class="acc-shell">' +
      topControls +
      '<div class="acc-content" id="acc-body"></div></div>';
    var body = document.getElementById('acc-body');
    if (_tab === 'settings') body.innerHTML = buildSettings();
    else body.innerHTML = buildSummary();
  };

  /* ══════════════ HELPERS ══════════════ */
  window.delAccEntry = async function (type, id) {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি বদলানো যায় না'); return; }
    var entry = type === 'income' ? A.Income.getById(id) : A.Expense.getById(id);
    if (!entry) { showToast('এন্ট্রি পাওয়া যায়নি'); return; }
    if (!isAdminSession() && entryAgeHours(entry) > 24) {
      var reason = prompt('২৪ ঘণ্টার বেশি পুরনো এন্ট্রি মুছতে জিম্মাদারের অনুমতি লাগবে। কারণ লিখুন:');
      if (!reason || !reason.trim()) return;
      if (await requestEntryChange('delete', type, entry, reason.trim())) showToast('সংশোধন অনুরোধ বার্তায় পাঠানো হয়েছে');
      else showToast('অনুরোধ পাঠানো যায়নি');
      return;
    }
    if (!confirm('এই এন্ট্রি মুছে ফেলবেন?')) return;
    try {
      if (type === 'expense') {
        var sup = A.clean(entry.supplier, '');
        var wasCredit = entry.paymentMethod !== 'cash';
        if (sup && wasCredit) await A.Dues.cancelPurchase(sup, entry.account, A.num(entry.amount));
        await A.Expense.del(id);
      } else {
        await A.Income.del(id);
      }
      refreshAccountsViews();
    } catch (err) {
      console.warn('[Accounts] delete failed', err);
      showToast('ডাটাবেজ থেকে মুছা যায়নি');
      if (A.bootstrapRemote) {
        try { await A.bootstrapRemote(); refreshAccountsViews(); } catch (e) {}
      }
    }
  };

  window.editAccEntry = async function (type, id) {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, এন্ট্রি বদলানো যায় না'); return; }
    var entry = type === 'income' ? A.Income.getById(id) : A.Expense.getById(id);
    if (!entry) { showToast('এন্ট্রি পাওয়া যায়নি'); return; }
    window.openAccModal(type, id);
  };

  window.payDue = async function (dueId) {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে হিসাব দেখা যায়, পরিশোধ এন্ট্রি করা যায় না'); return; }
    var amtStr = prompt('পরিশোধের পরিমাণ (টাকা):');
    var amt = parseFloat(amtStr);
    if (!amt || amt <= 0) return;
    try {
      await A.Dues.recordPayment(dueId, amt);
      rerenderAccountsView();
      showToast('পরিশোধ নথিভুক্ত ✓');
    } catch (err) {
      console.warn('[Accounts] due payment failed', err);
      showToast('ডাটাবেজে পরিশোধ সংরক্ষণ হয়নি');
      if (A.bootstrapRemote) {
        try { await A.bootstrapRemote(); rerenderAccountsView(); } catch (e) {}
      }
    }
  };

  /* ↩ আদায় — inline expand toggle */
  window.toggleQardExpand = function (bucketKey, remaining) {
    _payQardOpenBucket = (_payQardOpenBucket === bucketKey) ? null : bucketKey;
    _qardTab = 'recovery';
    renderAccAccountDetails(_detailAccount);
    /* expand খুললে পরিমাণ input-এ focus */
    if (_payQardOpenBucket === bucketKey) {
      setTimeout(function () {
        var el = document.getElementById('qpay-expand-amt');
        if (el) { el.focus(); el.select(); }
      }, 60);
    }
  };

  /* ↩ আদায় — ইনপুট থেকে সংরক্ষণ */
  window.confirmQardPay = async function (bucketKey) {
    if (isAccountsReadOnly()) { showToast('এডমিন পেইজে আদায় নথিভুক্ত করা যায় না'); return; }
    var amtEl = document.getElementById('qpay-expand-amt');
    var amt = parseFloat(amtEl ? amtEl.value : 0);
    if (!amt || amt <= 0) { showToast('সঠিক পরিমাণ লিখুন'); if (amtEl) amtEl.focus(); return; }
    var todayH = A.todayHijri();
    try {
      await A.Income.add({
        account: 'qard_return',
        hijriYear: todayH.year,
        month: todayH.month,
        day: todayH.day,
        amount: amt,
        note: 'করজে হাসানা আদায় — ' + String(bucketKey || ''),
        source: 'করজে হাসানা',
      });
      _payQardOpenBucket = null;
      refreshAccountsViews();
      showToast('আদায় নথিভুক্ত ✓');
    } catch (err) {
      console.warn('[Accounts] qard return failed', err);
      showToast('ডাটাবেজে সংরক্ষণ হয়নি');
      if (A.bootstrapRemote) {
        try { await A.bootstrapRemote(); refreshAccountsViews(); } catch (e) {}
      }
    }
  };

  /* ── Modal dismiss: visible close + backdrop + Escape ── */
  function dismissAccNestedOverlays() {
    if (typeof window.closeColFilter === 'function') window.closeColFilter();
    if (typeof window.closeAccDatePicker === 'function') window.closeAccDatePicker();
    if (typeof window.closeAccSheet === 'function') window.closeAccSheet();
    if (typeof window.closeMainFilterDropdown === 'function') window.closeMainFilterDropdown();
    if (typeof window.closeAccFilterDropdown === 'function') window.closeAccFilterDropdown();
    if (typeof window.closeDuesFilterDropdown === 'function') window.closeDuesFilterDropdown();
  }

  function hasAccNestedOverlay() {
    return !!(
      document.getElementById('acc-date-picker') ||
      document.getElementById('acc-sheet') ||
      document.querySelector('.acc-dd-backdrop') ||
      document.querySelector('.col-flt-dropdown')
    );
  }

  window.closeAccountDetailsModal = function () {
    dismissAccNestedOverlays();
    _metricModalKind = '';
    _settingsModalOpen = false;
    _detailAccount = '';
    _payQardOpenBucket = null;
    _qardGiveInlineOpen = false;
    var detailsModal = document.getElementById('modal-account-details');
    if (detailsModal) detailsModal.classList.remove('open', 'show', 'acc-income-detail-open', 'acc-qard-detail-open');
  };

  function closeAccNamedModal(id) {
    if (id === 'account-details') {
      window.closeAccountDetailsModal();
      return;
    }
    dismissAccNestedOverlays();
    var modal = document.getElementById('modal-' + id);
    if (modal) modal.classList.remove('open', 'show');
  }

  function wireAccountModalDismiss() {
    if (window.__accModalDismissWired) return;
    window.__accModalDismissWired = true;

    ['modal-account-details', 'modal-account-entry', 'modal-account-import'].forEach(function (id) {
      var bg = document.getElementById(id);
      if (!bg) return;
      bg.addEventListener('click', function (e) {
        if (e.target !== bg) return;
        if (id === 'modal-account-details') window.closeAccountDetailsModal();
        else closeAccNamedModal(id.replace(/^modal-/, ''));
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (hasAccNestedOverlay()) {
        dismissAccNestedOverlays();
        e.preventDefault();
        return;
      }
      var details = document.getElementById('modal-account-details');
      if (details && (details.classList.contains('open') || details.classList.contains('show'))) {
        window.closeAccountDetailsModal();
        e.preventDefault();
        return;
      }
      var entry = document.getElementById('modal-account-entry');
      if (entry && entry.classList.contains('open')) {
        closeAccNamedModal('account-entry');
        e.preventDefault();
        return;
      }
      var imp = document.getElementById('modal-account-import');
      if (imp && imp.classList.contains('open')) {
        closeAccNamedModal('account-import');
        e.preventDefault();
      }
    });

    /* পেজের closeModal পরে ডিফাইন হয় — hook করে account-details স্টেট ক্লিন রাখি */
    function installCloseModalHook() {
      if (window.closeModal && window.closeModal.__accDetailsHook) return;
      var prev = window.closeModal;
      function hooked(id) {
        if (id === 'account-details') {
          window.closeAccountDetailsModal();
          return;
        }
        if (typeof prev === 'function') prev(id);
        else closeAccNamedModal(id);
      }
      hooked.__accDetailsHook = true;
      window.closeModal = hooked;
    }
    setTimeout(installCloseModalHook, 0);
    window.addEventListener('load', function () { setTimeout(installCloseModalHook, 0); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAccountModalDismiss);
  } else {
    wireAccountModalDismiss();
  }

})();
