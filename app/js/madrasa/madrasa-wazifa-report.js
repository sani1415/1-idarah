/**
 * ওজিফা রিপোর্ট — কে সময়মতো দিচ্ছে, কে দেরিতে, কে বাকি (জিম্মাদার ও দফতরের হিসাব পাতা)।
 * তথ্য: mdr_rel_wazifa_report (ফি-সফটওয়্যার থেকে আনা snapshot; রাতে নিজে হালনাগাদ হয়,
 * «হালনাগাদ করুন» দিয়েও)। সময়মতো = যে মাসের ওজিফা সেই মাসের মধ্যেই (বা আগে) পরিশোধ।
 * হিসাব পাতা (madrasa-daftar-accounts.js) _tab = 'wazifa' হলে window.renderWazifaReport(root) ডাকে।
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'mdr-wz-style';
  var MONTHS_BN = ['', 'মুহাররম', 'সফর', 'রবিউল আউয়াল', 'রবিউস সানি', 'জুমাদাল উলা', 'জুমাদাল উখরা',
    'রজব', 'শাবান', 'রমজান', 'শাওয়াল', 'জিলকদ', 'জিলহজ'];
  var DEPT_BN = { kitab: 'কিতাব', maktab: 'মক্তব' };

  var S = {
    data: null, loading: false, error: '', month: null, view: 'due',
    dept: '', classId: '', q: '', sort: 'amount', limit: 40, polling: null, pollUntil: 0, root: null, active: false,
  };

  /* ── ছোট সহায়ক ── */
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function bn(n) { return String(n).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }); }
  function taka(n) {
    var t = String(Math.round(Math.abs(Number(n) || 0)));
    var h = t.slice(0, -3), r = t.slice(-3);
    while (h.length > 2) { r = h.slice(-2) + ',' + r; h = h.slice(0, -2); }
    return '৳' + bn(h ? h + ',' + r : r);
  }
  function monthName(no) {
    var A = global.MdrAccAPI;
    if (A && A.monthFromNo) { try { var m = A.monthFromNo(no); if (m) return m; } catch (e) {} }
    return MONTHS_BN[no] || '';
  }
  function key(y, m) { return y * 12 + m; }
  function nowHijri() {
    try {
      if (global.MMHijri && global.MMHijri.todayHijri) {
        var h = global.MMHijri.todayHijri();
        if (h && h.year && h.monthNo) return { y: h.year, m: h.monthNo, d: h.day || 1 };
      }
    } catch (e) {}
    return null;
  }
  function actor() {
    var M = global.MMSession;
    if (!M || !M.getId || !M.getPin) return null;
    var id = M.getId(), pin = M.getPin();
    return id && pin ? { id: id, pin: pin } : null;
  }
  function ago(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (!(ms >= 0)) return '';
    var min = Math.round(ms / 60000);
    if (min < 1) return 'এইমাত্র';
    if (min < 60) return bn(min) + ' মিনিট আগে';
    var hr = Math.round(min / 60);
    if (hr < 24) return bn(hr) + ' ঘণ্টা আগে';
    return bn(Math.round(hr / 24)) + ' দিন আগে';
  }

  /* ── ছাত্রভিত্তিক হিসাব ── */
  // এক মাসের মাসিক ওজিফার অবস্থা: ontime / late / due (আগের মাস, দেয়নি) / pending (চলতি মাস, এখনো দেয়নি) / none
  function monthStatus(st, y, m, now) {
    var rows = (st.months || []).filter(function (x) { return x.k === 'm' && x.y === y && x.mn === m; });
    if (!rows.length) return { s: 'none' };
    var amount = 0, unpaid = 0, lastPaid = null;
    rows.forEach(function (x) {
      amount += x.a || 0;
      if (!x.p) unpaid += x.a || 0;
      else if (x.py && x.pm) {
        var k = key(x.py, x.pm);
        if (!lastPaid || k > lastPaid.k || (k === lastPaid.k && (x.pd || 0) > lastPaid.d)) lastPaid = { k: k, d: x.pd || 0, y: x.py, m: x.pm };
      }
    });
    if (unpaid > 0) {
      var isCurrent = now && key(y, m) === key(now.y, now.m);
      return { s: isCurrent ? 'pending' : 'due', amount: amount, unpaid: unpaid };
    }
    if (!lastPaid || lastPaid.k <= key(y, m)) return { s: 'ontime', amount: amount, paid: lastPaid };
    return { s: 'late', amount: amount, paid: lastPaid, lateBy: lastPaid.k - key(y, m) };
  }

  // মোট বাকি (চলতি মাস পর্যন্ত, সব ধরনের) আর পরপর কত মাস মাসিক ওজিফা বাকি
  function dueSummary(st, now) {
    var due = 0, dueMonths = 0;
    var past = {};
    (st.months || []).forEach(function (x) {
      if (!x.y || !x.mn || x.p) return;
      if (now && key(x.y, x.mn) > key(now.y, now.m)) return;
      due += x.a || 0;
      if (x.k === 'm' && (!now || key(x.y, x.mn) < key(now.y, now.m))) { dueMonths++; past[key(x.y, x.mn)] = 1; }
    });
    return { due: due, dueMonths: dueMonths };
  }

  function students() {
    return (S.data && S.data.students) || [];
  }

  function filtered() {
    var q = S.q.trim().toLowerCase();
    return students().filter(function (st) {
      if (S.dept && st.dept !== S.dept) return false;
      if (S.classId && st.class_id !== S.classId) return false;
      if (q && String(st.name || '').toLowerCase().indexOf(q) < 0 && String(st.reg_id || '').indexOf(q) < 0) return false;
      return true;
    });
  }

  // নির্বাচনের জন্য মাস: ডেটায় থাকা মাস, আজকের মাস পর্যন্ত, নতুন আগে
  function monthOptions(now) {
    var seen = {}, list = [];
    students().forEach(function (st) {
      (st.months || []).forEach(function (x) {
        if (x.k !== 'm' || !x.y || !x.mn) return;
        var k = key(x.y, x.mn);
        if (now && k > key(now.y, now.m)) return;
        if (!seen[k]) { seen[k] = 1; list.push({ y: x.y, m: x.mn, k: k }); }
      });
    });
    return list.sort(function (a, b) { return b.k - a.k; });
  }

  /* ── আঁকা ── */
  var ICON = {
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 7v6"/><path d="M12 16.8v.2"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.6 14.2c2.4.1 4.1 1.7 4.7 4.3"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    chev: '<path d="M9.5 6l6 6-6 6"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
  };
  function icon(name, size) {
    var z = size || 18;
    return '<svg aria-hidden="true" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      // পাতার .content ডেস্কটপ শেলে var(--desk-max)/১১০০–১২০০px-এ বাঁধা (বেশি জোরালো selector-এ) —
      // রিপোর্ট খোলা থাকলে পুরো চওড়া, যেন জুম আউট/বড় মনিটরে তিন কলাম আসে
      '.content:has(.wz-shell){max-width:none !important;}' +
      '.wz-shell{--wz-ok:#3f7a50;--wz-ok-bg:#e8f2e7;--wz-late:#b07a14;--wz-late-bg:#fbf0d6;--wz-due:#b5573a;--wz-due-bg:#fbe7df;' +
        '--wz-card:#fffdf9;--wz-bd:#ece3d2;padding:4px 0 28px;container-type:inline-size;color:var(--ink);}' +
      '.wz-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}' +
      '.wz-head{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;min-width:0;}' +
      '.wz-title{font-family:var(--font-bn);font-weight:700;font-size:22px;line-height:1.25;color:var(--ink);margin:0;}' +
      '.wz-sync{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--ink3);}' +
      '.wz-pill{font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--wz-bd);' +
        'background:var(--wz-card);color:var(--ink2);border-radius:999px;padding:4px 12px;cursor:pointer;box-shadow:0 1px 2px rgba(42,35,24,.05);}' +
      '.wz-pill:hover{border-color:var(--wz-due);color:var(--wz-due);}' +
      '.wz-pill[disabled]{opacity:.55;cursor:default;}' +
      '.wz-back{font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--wz-bd);' +
        'background:var(--wz-card);color:var(--ink2);border-radius:11px;padding:6px 11px;cursor:pointer;flex-shrink:0;}' +
      '.wz-btn{font:inherit;font-size:13px;border:1px solid var(--wz-bd);background:var(--wz-card);border-radius:10px;padding:7px 12px;cursor:pointer;color:var(--ink);}' +
      '.wz-box{background:var(--wz-card);border:1px solid var(--wz-bd);border-radius:16px;box-shadow:0 1px 2px rgba(42,35,24,.04),0 6px 18px -10px rgba(42,35,24,.12);}' +
      '.wz-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:10px 12px;margin-bottom:10px;}' +
      '.wz-f{display:flex;flex-direction:column;gap:3px;min-width:0;}' +
      '.wz-f>span{font-size:11.5px;font-weight:600;color:var(--ink3);}' +
      '.wz-filters select,.wz-filters input{font:inherit;font-size:14px;height:36px;padding:0 10px;border:1px solid var(--wz-bd);border-radius:10px;' +
        'background:#fff;color:var(--ink);min-width:0;width:100%;box-sizing:border-box;}' +
      '.wz-filters select:focus,.wz-filters input:focus{outline:none;border-color:var(--wz-due);box-shadow:0 0 0 3px rgba(181,87,58,.14);}' +
      '.wz-search{position:relative;}' +
      '.wz-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-muted);pointer-events:none;}' +
      '.wz-filters .wz-search input{padding-left:34px;}' +
      '.wz-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:8px;}' +
      '.wz-card{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;text-align:left;font:inherit;color:var(--ink);' +
        'background:var(--wz-card);border:1.5px solid var(--wz-bd);border-radius:14px;padding:9px 12px;cursor:pointer;min-width:0;' +
        'box-shadow:0 1px 2px rgba(42,35,24,.04);transition:border-color .15s,box-shadow .15s;}' +
      '.wz-card:hover{box-shadow:0 6px 18px -10px rgba(42,35,24,.25);}' +
      '.wz-ic{width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;}' +
      '.wz-card-txt{display:flex;flex-direction:column;min-width:0;position:relative;z-index:1;}' +
      '.wz-card-lbl{font-size:13px;font-weight:600;color:var(--ink2);}' +
      '.wz-card-val{font-family:var(--font-bn);font-size:24px;font-weight:700;line-height:1.15;}' +
      '.wz-card-sub{font-size:12.5px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wz-ghost{position:absolute;right:-4px;bottom:-8px;opacity:.13;pointer-events:none;}' +
      '.wz-t-ok{background:linear-gradient(135deg,var(--wz-ok-bg),var(--wz-card) 70%);}' +
      '.wz-t-ok .wz-ic{background:var(--wz-ok);}.wz-t-ok .wz-card-val,.wz-t-ok .wz-ghost{color:var(--wz-ok);}' +
      '.wz-t-late{background:linear-gradient(135deg,var(--wz-late-bg),var(--wz-card) 70%);}' +
      '.wz-t-late .wz-ic{background:var(--wz-late);}.wz-t-late .wz-card-val,.wz-t-late .wz-ghost{color:var(--wz-late);}' +
      '.wz-t-due{background:linear-gradient(135deg,var(--wz-due-bg),var(--wz-card) 70%);}' +
      '.wz-t-due .wz-ic{background:var(--wz-due);}.wz-t-due .wz-card-val,.wz-t-due .wz-ghost{color:var(--wz-due);}' +
      '.wz-t-reg{background:linear-gradient(135deg,#f6e3dc,var(--wz-card) 70%);}' +
      '.wz-t-reg .wz-ic{background:#8f3f2a;}.wz-t-reg .wz-card-val,.wz-t-reg .wz-ghost{color:#8f3f2a;}' +
      '.wz-card.is-on.wz-t-ok{border-color:var(--wz-ok);}.wz-card.is-on.wz-t-late{border-color:var(--wz-late);}' +
      '.wz-card.is-on.wz-t-due{border-color:var(--wz-due);}.wz-card.is-on.wz-t-reg{border-color:#8f3f2a;}' +
      '.wz-card.is-on{box-shadow:0 8px 22px -12px rgba(42,35,24,.35);}' +
      '.wz-note-line{display:flex;align-items:flex-start;gap:6px;font-size:12.5px;color:var(--ink3);margin:0 2px 8px;}' +
      '.wz-note-line svg{flex-shrink:0;margin-top:1px;}' +
      '.wz-tabs{display:flex;gap:4px;padding:4px;margin-bottom:12px;overflow-x:auto;scrollbar-width:none;}' +
      '.wz-tabs::-webkit-scrollbar{display:none;}' +
      '.wz-tab{flex:1 0 auto;font:inherit;font-size:14px;font-weight:600;padding:7px 12px;border-radius:10px;border:none;background:transparent;color:var(--ink2);cursor:pointer;white-space:nowrap;}' +
      '.wz-tab:hover{background:var(--cream2);}' +
      '.wz-tab.is-on{background:var(--wz-due);color:#fff;box-shadow:0 4px 12px -6px rgba(181,87,58,.7);}' +
      '.wz-main{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start;}' +
      '.wz-panel{overflow:hidden;min-width:0;}' +
      '.wz-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid var(--wz-bd);flex-wrap:wrap;}' +
      '.wz-ph h3{font-family:var(--font-bn);font-size:16px;font-weight:700;margin:0;color:var(--ink);}' +
      '.wz-ph select{font:inherit;font-size:13px;height:34px;padding:0 8px;border:1px solid var(--wz-bd);border-radius:9px;background:#fff;color:var(--ink2);}' +
      '.wz-list{max-height:none;overflow:auto;}' +
      '.wz-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--cream2);}' +
      '.wz-row:last-child{border-bottom:none;}' +
      '.wz-row.is-link{cursor:pointer;}' +
      '.wz-row.is-link:hover{background:var(--cream);}' +
      '.wz-who{min-width:0;}' +
      '.wz-name{font-weight:700;color:var(--ink);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wz-meta{font-size:12.5px;color:var(--ink3);margin-top:2px;}' +
      '.wz-end{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
      '.wz-right{text-align:right;font-size:13px;}' +
      '.wz-chev{color:var(--ink-muted);display:flex;}' +
      '.wz-amt{font-weight:800;font-size:15px;}' +
      '.wz-amt.due{color:var(--wz-due);}.wz-amt.ok{color:var(--wz-ok);}.wz-amt.late{color:var(--wz-late);}' +
      '.wz-note{font-size:12px;color:var(--ink3);margin-top:1px;}' +
      '.wz-more{display:block;width:100%;font:inherit;font-size:14px;font-weight:600;color:var(--wz-due);background:var(--cream);border:none;border-top:1px solid var(--cream2);padding:12px;cursor:pointer;}' +
      '.wz-empty{padding:22px;text-align:center;color:var(--ink3);font-size:14px;}' +
      '.wz-table{width:100%;border-collapse:collapse;font-size:13.5px;}' +
      '.wz-table th,.wz-table td{padding:8px 12px;border-bottom:1px solid var(--cream2);text-align:right;white-space:nowrap;}' +
      '.wz-table th:first-child,.wz-table td:first-child{text-align:left;white-space:normal;}' +
      '.wz-table th{font-size:12.5px;font-weight:700;color:var(--ink3);background:var(--cream);}' +
      '.wz-table tbody tr:last-child td{border-bottom:none;}' +
      '.wz-table tfoot td{font-weight:800;background:var(--cream);border-bottom:none;border-top:1px solid var(--wz-bd);}' +
      '.wz-dept{color:var(--ink3);font-size:11px;font-weight:500;margin-left:4px;}' +
      '.wz-track{display:block;width:100%;min-width:70px;height:8px;border-radius:4px;background:var(--cream2);overflow:hidden;}' +
      '.wz-fill{display:block;height:100%;border-radius:4px;}' +
      '.wz-g{color:var(--wz-ok);}.wz-a{color:var(--wz-late);}.wz-r{color:var(--wz-due);}' +
      '.wz-fill.wz-g{background:var(--wz-ok);}.wz-fill.wz-a{background:#d29a2c;}.wz-fill.wz-r{background:var(--wz-due);}' +
      '.wz-pct{font-weight:800;}' +
      '.wz-scroll{overflow-x:auto;}' +
      '.wz-months{container-type:inline-size;}' +
      '@container (max-width:560px){.wz-hide-nar{display:none;}}' +
      '.wz-warn{background:var(--red-light);color:var(--red);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px;}' +
      '@container (min-width:860px){' +
        '.wz-main{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch;}' +
        '.wz-main>.wz-months{grid-column:1/-1;}' +
        '.wz-listp{contain:size;min-height:440px;display:flex;flex-direction:column;}' +
        '.wz-listp .wz-list{flex:1 1 0;min-height:0;}' +
      '}' +
      '@container (min-width:1200px){' +
        '.wz-main{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr);}' +
        '.wz-main>.wz-months{grid-column:auto;}' +
      '}' +
      '@media (max-width:760px){.wz-filters{grid-template-columns:1fr 1fr;}.wz-cards{grid-template-columns:1fr 1fr;gap:10px;}}' +
      '@media (max-width:640px){' +
        '.wz-title{font-size:19px;}' +
        '.wz-filters{padding:10px;gap:8px;}' +
        '.wz-card{gap:8px;padding:8px 10px;}' +
        '.wz-ghost{display:none;}' +
        '.wz-card-lbl{font-size:12px;}' +
        '.wz-ic{width:30px;height:30px;}' +
        '.wz-card-val{font-size:21px;}' +
        '.wz-row{padding:11px 12px;}' +
        '.wz-ph{padding:12px;}' +
        '.wz-table th,.wz-table td{padding:9px 8px;}' +
        '.wz-hide-sm{display:none;}' +
      '}';
    document.head.appendChild(st);
  }

  function syncInfo() {
    var sy = (S.data && S.data.sync) || {};
    var total = students().filter(function (s) { return s.reg_id; }).length;
    var running = sy.started_at && !sy.finished_at && (Date.now() - new Date(sy.started_at).getTime() < 20 * 60000);
    var latest = null;
    students().forEach(function (s) { if (s.fetched_at && (!latest || s.fetched_at > latest)) latest = s.fetched_at; });
    var txt = running
      ? 'হালনাগাদ চলছে… ' + bn(sy.done_this_run || 0) + '/' + bn(total) + ' জন'
      : (latest ? 'শেষ হালনাগাদ: ' + ago(sy.finished_at || latest) : 'এখনো হালনাগাদ হয়নি');
    return '<div class="wz-sync"><span title="প্রতি রাতে নিজে হালনাগাদ হয়">' + esc(txt) + '</span>' +
      '<button type="button" class="wz-pill" onclick="MdrWazifaReport.refresh()"' + (running ? ' disabled' : '') + '>' + icon('refresh', 15) + 'হালনাগাদ</button></div>';
  }

  function filtersHtml(now) {
    var opts = monthOptions(now);
    if (!S.month && opts.length) S.month = { y: opts[0].y, m: opts[0].m };
    var field = function (label, inner, cls) { return '<label class="wz-f' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + inner + '</label>'; };
    var mSel = '<select onchange="MdrWazifaReport.set(\'month\', this.value)">' + opts.map(function (o) {
      var on = S.month && S.month.y === o.y && S.month.m === o.m;
      var cur = now && o.k === key(now.y, now.m);
      return '<option value="' + o.y + '-' + o.m + '"' + (on ? ' selected' : '') + '>' + esc(monthName(o.m) + ' ' + bn(o.y) + (cur ? ' (চলতি)' : '')) + '</option>';
    }).join('') + '</select>';
    var depts = {}, classes = {};
    students().forEach(function (s) {
      if (s.dept) depts[s.dept] = 1;
      if (s.class_id && (!S.dept || s.dept === S.dept)) classes[s.class_id] = { name: s.class_name || '—', sort: s.class_sort };
    });
    var dSel = '<select onchange="MdrWazifaReport.set(\'dept\', this.value)"><option value="">সব বিভাগ</option>' +
      Object.keys(depts).map(function (d) { return '<option value="' + esc(d) + '"' + (S.dept === d ? ' selected' : '') + '>' + esc(DEPT_BN[d] || d) + '</option>'; }).join('') + '</select>';
    var cSel = '<select onchange="MdrWazifaReport.set(\'classId\', this.value)"><option value="">সব জামাত</option>' +
      Object.keys(classes).sort(function (a, b) { return (classes[a].sort || 0) - (classes[b].sort || 0); })
        .map(function (c) { return '<option value="' + esc(c) + '"' + (S.classId === c ? ' selected' : '') + '>' + esc(classes[c].name) + '</option>'; }).join('') + '</select>';
    var search = '<div class="wz-search">' + icon('search', 16) +
      '<input type="search" placeholder="নাম বা আইডি দিয়ে খুঁজুন…" value="' + esc(S.q) + '" oninput="MdrWazifaReport.search(this.value)"></div>';
    return '<div class="wz-box wz-filters">' + field('মাস', mSel) + field('বিভাগ', dSel) + field('জামাত', cSel) + field('খুঁজুন', search) + '</div>';
  }

  function rowHtml(st, right) {
    var can = typeof global.openStudentDetail === 'function';
    return '<div class="wz-row' + (can ? ' is-link' : '') + '"' + (can ? ' onclick="openStudentDetail(\'' + esc(st.id) + '\')"' : '') + '>' +
      '<div class="wz-who"><div class="wz-name">' + esc(st.name || '—') + '</div>' +
      '<div class="wz-meta">' + esc(bn(st.reg_id || '')) + (st.class_name ? ' · ' + esc(st.class_name) : '') + '</div></div>' +
      '<div class="wz-end"><div class="wz-right">' + right + '</div>' + (can ? '<span class="wz-chev">' + icon('chev', 16) + '</span>' : '') + '</div></div>';
  }

  var SORTS = { amount: 'বেশি বকেয়া আগে', months: 'বেশি মাস বকেয়া আগে', name: 'নাম অনুযায়ী' };
  function sortRows(arr, getDue, getMonths) {
    var by = S.sort;
    return arr.sort(function (a, b) {
      if (by === 'name') return String(a.st.name || '').localeCompare(String(b.st.name || ''), 'bn');
      if (by === 'months') return getMonths(b) - getMonths(a) || getDue(b) - getDue(a);
      return getDue(b) - getDue(a) || getMonths(b) - getMonths(a);
    });
  }

  function render() {
    var root = S.root;
    if (!S.active || !root || !root.isConnected) return;
    ensureStyles();
    var head = function (withSync) {
      return '<div class="wz-top"><div class="wz-head"><h2 class="wz-title">ওজিফা — সময়মতো আদায়</h2>' + (withSync ? syncInfo() : '') + '</div>' +
        '<button type="button" class="wz-back" onclick="closeAccGrid()">' + icon('back', 15) + 'হিসাব</button></div>';
    };
    if (S.loading && !S.data) { root.innerHTML = '<div class="wz-shell">' + head(false) + (global.MMUI ? global.MMUI.skeleton({ stats: 4, rows: 5 }) : '<div class="wz-box wz-empty">লোড হচ্ছে…</div>') + '</div>'; return; }
    if (S.error && !S.data) {
      root.innerHTML = '<div class="wz-shell">' + head(false) + '<div class="wz-box wz-empty">' + esc(S.error) +
        '<br><button type="button" class="wz-btn" style="margin-top:10px" onclick="MdrWazifaReport.load()">আবার চেষ্টা করুন</button></div></div>';
      return;
    }
    var now = nowHijri();
    var filters = filtersHtml(now);
    var list = filtered();
    var sel = S.month;
    var groups = { ontime: [], late: [], due: [], pending: [], none: [], nodata: [], regular: [] };
    list.forEach(function (st) {
      if (!st.status) { groups.nodata.push({ st: st }); return; }
      if (st.status === 'not_found') { groups.nodata.push({ st: st, nf: true }); return; }
      var ds = dueSummary(st, now);
      if (ds.dueMonths >= 2) groups.regular.push({ st: st, ds: ds });
      if (!sel) return;
      var ms = monthStatus(st, sel.y, sel.m, now);
      ms.ds = ds;
      (groups[ms.s] || groups.none).push({ st: st, ms: ms });
    });
    var isCur = sel && now && key(sel.y, sel.m) === key(now.y, now.m);
    var unpaidKey = isCur ? 'pending' : 'due';
    if (S.view === 'due' || S.view === 'pending') S.view = unpaidKey;
    if (S.view === 'nodata' && !groups.nodata.length) S.view = unpaidKey;
    var sum = function (arr, f) { return arr.reduce(function (s, x) { return s + (f(x) || 0); }, 0); };
    var unpaidLbl = 'বর্তমান বকেয়া';

    var card = function (k, tone, ic, label, n, sub) {
      return '<button type="button" class="wz-card wz-t-' + tone + (S.view === k ? ' is-on' : '') + '" onclick="MdrWazifaReport.set(\'view\', \'' + k + '\')">' +
        '<span class="wz-ic">' + icon(ic, 20) + '</span>' +
        '<span class="wz-card-txt"><span class="wz-card-lbl">' + label + '</span><span class="wz-card-val">' + bn(n) + '</span>' +
        (sub ? '<span class="wz-card-sub">' + sub + '</span>' : '') + '</span>' +
        '<span class="wz-ghost">' + icon(ic, 64) + '</span></button>';
    };
    var cards = '<div class="wz-cards">' +
      card('ontime', 'ok', 'check', 'সময়মতো', groups.ontime.length, taka(sum(groups.ontime, function (x) { return x.ms.amount; }))) +
      card('late', 'late', 'clock', 'দেরিতে', groups.late.length, taka(sum(groups.late, function (x) { return x.ms.amount; }))) +
      card(unpaidKey, 'due', 'alert', unpaidLbl, groups[unpaidKey].length, taka(sum(groups[unpaidKey], function (x) { return x.ms.unpaid; }))) +
      card('regular', 'reg', 'users', 'একাধিক বকেয়া', groups.regular.length, '২ বা বেশি মাস বকেয়া') +
      '</div>';

    var note = isCur
      ? 'চলতি মাস এখনো শেষ হয়নি — এই মাসে এখন পর্যন্ত যারা দেয়নি তারা «বর্তমান বকেয়া»-তে।'
      : 'সময়মতো = যে মাসের ওজিফা সেই মাসের মধ্যেই পরিশোধ।';
    var notes = '<div class="wz-note-line">' + icon('info', 15) + '<span>' + note + '</span></div>';

    var tabList = [
      [unpaidKey, unpaidLbl, groups[unpaidKey].length],
      ['late', 'দেরিতে', groups.late.length], ['ontime', 'সময়মতো', groups.ontime.length],
      ['regular', 'একাধিক বকেয়া', groups.regular.length],
    ];
    if (groups.nodata.length) tabList.push(['nodata', 'তথ্য নেই', groups.nodata.length]);
    var tabs = '<div class="wz-box wz-tabs" role="tablist">' + tabList.map(function (t) {
      var on = S.view === t[0];
      return '<button type="button" role="tab" aria-selected="' + on + '" class="wz-tab' + (on ? ' is-on' : '') + '" onclick="MdrWazifaReport.set(\'view\', \'' + t[0] + '\')">' + t[1] + ' (' + bn(t[2]) + ')</button>';
    }).join('') + '</div>';

    var rows = '';
    var cur = groups[S.view] || [];
    var sortable = false;
    if (S.view === 'ontime' || S.view === 'late') {
      rows = cur.slice().sort(function (a, b) { return String(a.st.name || '').localeCompare(String(b.st.name || ''), 'bn'); }).map(function (x) {
        var p = x.ms.paid;
        // ফি-সফটওয়্যারের তারিখে কখনো ৩১–৩৩ দিন আসে — অসম্ভব দিন হলে শুধু মাস
        var when = p ? 'পরিশোধ: ' + (p.d >= 1 && p.d <= 30 ? bn(p.d) + ' ' : '') + monthName(p.m) + ' ' + bn(p.y) : 'পরিশোধিত';
        var late = S.view === 'late' ? (x.ms.lateBy === 1 ? 'পরের মাসে দিয়েছে' : bn(x.ms.lateBy) + ' মাস পরে দিয়েছে') : '';
        return rowHtml(x.st, '<div class="wz-amt ' + (S.view === 'late' ? 'late' : 'ok') + '">' + taka(x.ms.amount) + '</div><div class="wz-note">' + esc(when) + '</div>' +
          (late ? '<div class="wz-note">' + late + '</div>' : ''));
      }).slice(0, S.limit).join('');
    } else if (S.view === 'regular') {
      sortable = true;
      rows = sortRows(cur.slice(), function (x) { return x.ds.due; }, function (x) { return x.ds.dueMonths; }).map(function (x) {
        return rowHtml(x.st, '<div class="wz-amt due">' + taka(x.ds.due) + '</div><div class="wz-note">' + bn(x.ds.dueMonths) + ' মাসের ওজিফা বকেয়া</div>');
      }).slice(0, S.limit).join('');
    } else if (S.view === 'nodata') {
      rows = cur.map(function (x) {
        return rowHtml(x.st, '<div class="wz-note">' + (x.nf ? 'ফি-সফটওয়্যারে আইডি নেই' : 'এখনো আনা হয়নি') + '</div>');
      }).slice(0, S.limit).join('');
    } else {
      sortable = true;
      rows = sortRows(cur.slice(), function (x) { return x.ms.ds.due; }, function (x) { return x.ms.ds.dueMonths; }).map(function (x) {
        var more = x.ms.ds.dueMonths > (S.view === 'due' ? 1 : 0) ? 'মোট বকেয়া ' + taka(x.ms.ds.due) + ' (' + bn(x.ms.ds.dueMonths) + ' মাস)' : '';
        return rowHtml(x.st, '<div class="wz-amt due">' + taka(x.ms.unpaid) + '</div>' + (more ? '<div class="wz-note">' + more + '</div>' : ''));
      }).slice(0, S.limit).join('');
    }
    if (!rows) rows = '<div class="wz-empty">এই তালিকায় কেউ নেই</div>';
    else if (cur.length > S.limit) {
      rows += '<button type="button" class="wz-more" onclick="MdrWazifaReport.more()">আরও দেখুন (' + bn(cur.length - S.limit) + ' জন বাকি)</button>';
    }
    var titles = {
      due: 'বকেয়া থাকা শিক্ষার্থী', pending: 'এই মাসে এখনো দেয়নি এমন শিক্ষার্থী', late: 'দেরিতে দেওয়া শিক্ষার্থী',
      ontime: 'সময়মতো দেওয়া শিক্ষার্থী', regular: 'একাধিক মাস বকেয়া', nodata: 'যাদের তথ্য নেই',
    };
    var sortSel = sortable ? '<select aria-label="সাজানো" onchange="MdrWazifaReport.set(\'sort\', this.value)">' + Object.keys(SORTS).map(function (k) {
      return '<option value="' + k + '"' + (S.sort === k ? ' selected' : '') + '>' + SORTS[k] + '</option>';
    }).join('') + '</select>' : '';
    var panel = '<section class="wz-box wz-panel wz-listp"><div class="wz-ph"><h3>' + (titles[S.view] || '') + ' (' + bn(cur.length) + ' জন)</h3>' + sortSel + '</div>' +
      '<div class="wz-list">' + rows + '</div></section>';

    root.innerHTML = '<div class="wz-shell">' + head(true) +
      (S.error ? '<div class="wz-warn">' + esc(S.error) + '</div>' : '') +
      filters + cards + notes + tabs +
      '<div class="wz-main">' + panel + classTable(list, now) + monthTable(list, now) + '</div></div>';
  }

  function pctTone(p) { return p >= 70 ? 'wz-g' : (p >= 50 ? 'wz-a' : 'wz-r'); }
  function pctCells(ok, n) {
    var pct = n ? Math.round(ok * 100 / n) : 0, t = pctTone(pct);
    return '<td class="wz-hide-sm" style="width:28%"><span class="wz-track"><span class="wz-fill ' + t + '" style="width:' + pct + '%"></span></span></td>' +
      '<td class="wz-pct ' + t + '">' + bn(pct) + '%</td>';
  }

  // জামাতভিত্তিক: নির্বাচিত মাসে কতজন সময়মতো
  function classTable(list, now) {
    if (!S.month) return '';
    var by = {};
    list.forEach(function (st) {
      if (st.status !== 'ok') return;
      var k = st.class_id || '-';
      var b = by[k] || (by[k] = { name: st.class_name || '—', dept: st.dept || '', sort: st.class_sort || 0, ontime: 0, late: 0, due: 0, n: 0 });
      var s = monthStatus(st, S.month.y, S.month.m, now).s;
      if (s === 'none') return;
      b.n++;
      if (s === 'ontime') b.ontime++; else if (s === 'late') b.late++; else b.due++;
    });
    var keys = Object.keys(by).filter(function (k) { return by[k].n; }).sort(function (a, b) {
      return by[a].dept === by[b].dept ? by[a].sort - by[b].sort : (by[a].dept < by[b].dept ? -1 : 1);
    });
    if (!keys.length) return '';
    var depts = {};
    keys.forEach(function (k) { depts[by[k].dept] = 1; });
    var showDept = Object.keys(depts).length > 1;
    var tot = { n: 0, ontime: 0 };
    var body = keys.map(function (k) {
      var b = by[k];
      tot.n += b.n; tot.ontime += b.ontime;
      return '<tr><td>' + esc(b.name) + (showDept && DEPT_BN[b.dept] ? '<span class="wz-dept">' + DEPT_BN[b.dept] + '</span>' : '') + '</td>' +
        '<td>' + bn(b.n) + '</td><td>' + bn(b.ontime) + '</td>' + pctCells(b.ontime, b.n) + '</tr>';
    }).join('');
    return '<section class="wz-box wz-panel"><div class="wz-ph"><h3>জামাতভিত্তিক ওজিফা আদায়ের চিত্র</h3>' +
      '<span class="wz-meta">' + esc(monthName(S.month.m) + ' ' + bn(S.month.y)) + '</span></div>' +
      '<div class="wz-scroll"><table class="wz-table"><thead><tr><th>জামাত</th><th>মোট শিক্ষার্থী</th><th>সময়মতো</th><th class="wz-hide-sm"></th><th>শতকরা হার</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      (keys.length > 1 ? '<tfoot><tr><td>মোট</td><td>' + bn(tot.n) + '</td><td>' + bn(tot.ontime) + '</td>' + pctCells(tot.ontime, tot.n) + '</tr></tfoot>' : '') +
      '</table></div></section>';
  }

  // মাসভিত্তিক: এই শিক্ষাবর্ষের প্রতিটি মাসে কতজন সময়মতো
  function monthTable(list, now) {
    var opts = monthOptions(now).slice(0, 12);
    if (opts.length < 2) return '';
    return '<section class="wz-box wz-panel wz-months"><div class="wz-ph"><h3>মাসভিত্তিক চিত্র</h3></div>' +
      '<div class="wz-scroll"><table class="wz-table"><thead><tr><th>মাস</th><th>সময়মতো</th><th>দেরিতে</th><th>বকেয়া</th><th class="wz-hide-sm wz-hide-nar">আদায়</th><th>সময়মতো %</th></tr></thead><tbody>' +
      opts.map(function (o) {
        var c = { ontime: 0, late: 0, due: 0, n: 0, paid: 0 };
        list.forEach(function (st) {
          if (st.status !== 'ok') return;
          var ms = monthStatus(st, o.y, o.m, now);
          if (ms.s === 'none') return;
          c.n++;
          if (ms.s === 'ontime') { c.ontime++; c.paid += ms.amount || 0; }
          else if (ms.s === 'late') { c.late++; c.paid += ms.amount || 0; }
          else c.due++;
        });
        var cur = now && o.k === key(now.y, now.m);
        var pct = c.n ? Math.round(c.ontime * 100 / c.n) : 0;
        return '<tr><td>' + esc(monthName(o.m) + ' ' + bn(o.y)) + (cur ? ' (চলতি)' : '') + '</td><td>' + bn(c.ontime) + '</td><td>' + bn(c.late) + '</td><td>' + bn(c.due) + '</td>' +
          '<td class="wz-hide-sm wz-hide-nar">' + taka(c.paid) + '</td><td class="wz-pct ' + pctTone(pct) + '">' + bn(pct) + '%</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  /* ── ডেটা ── */
  async function load(silent) {
    var a = actor();
    if (!a || !global.MMSharedAPI || !global.MMSharedAPI.wazifaReport) { S.error = 'লগইন তথ্য পাওয়া যায়নি — পেজ রিফ্রেশ করুন'; render(); return; }
    if (!silent) { S.loading = true; render(); }
    var res;
    try { res = await global.MMSharedAPI.wazifaReport(a.id, a.pin); } catch (e) { res = null; }
    S.loading = false;
    if (!res || !res.ok) {
      S.error = res && res.error === 'not_allowed' ? 'ওজিফা রিপোর্ট শুধু জিম্মাদার ও দফতর দেখতে পারেন' : 'রিপোর্ট আনা যায়নি — নেট দেখে আবার চেষ্টা করুন';
    } else {
      S.error = '';
      S.data = res;
    }
    render();
    schedulePoll();
  }

  // হালনাগাদ চলার সময় কিছুক্ষণ পরপর নিজে থেকে নতুন তথ্য আনা
  function schedulePoll() {
    if (S.polling) { clearTimeout(S.polling); S.polling = null; }
    var sy = (S.data && S.data.sync) || {};
    var running = sy.started_at && !sy.finished_at && (Date.now() - new Date(sy.started_at).getTime() < 20 * 60000);
    var waiting = S.pollUntil > Date.now();
    if (!(running || waiting) || !S.active || !S.root || !S.root.isConnected) return;
    S.polling = setTimeout(function () { load(true); }, 15000);
  }

  async function refresh() {
    var a = actor();
    if (!a || !global.MMSharedAPI || !global.MMSharedAPI.wazifaRefresh) return;
    var res;
    try { res = await global.MMSharedAPI.wazifaRefresh(a.id, a.pin); } catch (e) { res = null; }
    if (!res || !res.ok) { if (global.showToast) global.showToast('হালনাগাদ শুরু করা যায়নি'); return; }
    if (global.showToast) global.showToast(res.started ? 'হালনাগাদ শুরু হয়েছে — কয়েক মিনিট লাগবে' : 'কিছুক্ষণ আগেই হালনাগাদ শুরু হয়েছে — একটু অপেক্ষা করুন');
    S.pollUntil = Date.now() + 10 * 60000;
    setTimeout(function () { load(true); }, 4000);
  }

  // হিসাব পাতার ছোট সারাংশ: চলতি মাসে কতজন দিয়েছে/দেয়নি ও আদায়; গত মাসে সময়মতো/দেরিতে/বকেয়া
  var _sumFetching = false, _sumAt = 0, _sumErr = '';
  function summary(onReady) {
    if (!S.data) {
      if (_sumErr) return { error: _sumErr };
      if (!_sumFetching && Date.now() - _sumAt > 60000) {
        var a = actor();
        if (!a || !global.MMSharedAPI || !global.MMSharedAPI.wazifaReport) return { error: 'লগইন তথ্য পাওয়া যায়নি' };
        _sumFetching = true; _sumAt = Date.now();
        global.MMSharedAPI.wazifaReport(a.id, a.pin).then(function (res) {
          _sumFetching = false;
          if (res && res.ok) S.data = res;
          else _sumErr = res && res.error === 'not_allowed' ? 'শুধু জিম্মাদার ও দফতর দেখতে পারেন' : 'ওজিফার তথ্য আনা যায়নি';
          if (onReady) onReady();
        }, function () { _sumFetching = false; _sumErr = 'ওজিফার তথ্য আনা যায়নি'; if (onReady) onReady(); });
      }
      return null;
    }
    var now = nowHijri();
    var opts = monthOptions(now);
    if (!opts.length) return { error: 'ওজিফার তথ্য নেই' };
    var list = students().filter(function (st) { return st.status === 'ok'; });
    var cur = now && opts[0].k === key(now.y, now.m) ? opts[0] : null;
    var prev = cur ? opts[1] : opts[0];
    var out = {};
    if (prev) {
      var c = { ontime: 0, late: 0, due: 0, total: 0 };
      list.forEach(function (st) {
        var s = monthStatus(st, prev.y, prev.m, now).s;
        if (s === 'none') return;
        c.total++;
        if (s === 'ontime') c.ontime++; else if (s === 'late') c.late++; else c.due++;
      });
      c.label = monthName(prev.m) + ' ' + bn(prev.y);
      out.prev = c;
    }
    if (cur) {
      var d = { paid: 0, total: 0, unpaid: 0, amount: 0 };
      list.forEach(function (st) {
        var ms = monthStatus(st, cur.y, cur.m, now);
        if (ms.s === 'none') return;
        d.total++;
        if (ms.s === 'pending' || ms.s === 'due') d.unpaid++; else { d.paid++; d.amount += ms.amount || 0; }
      });
      d.label = monthName(cur.m) + ' ' + bn(cur.y);
      out.cur = d;
    }
    return out;
  }

  var _searchT = null;
  global.MdrWazifaReport = {
    summary: summary,
    leave: function () { S.active = false; if (S.polling) { clearTimeout(S.polling); S.polling = null; } },
    load: function () { load(false); },
    refresh: refresh,
    set: function (k, v) {
      if (k === 'month') { var p = String(v).split('-'); S.month = { y: Number(p[0]), m: Number(p[1]) }; }
      else if (k === 'dept') { S.dept = v; S.classId = ''; }
      else S[k] = v;
      if (k !== 'sort') S.limit = 40;
      render();
    },
    more: function () { S.limit += 100; render(); },
    search: function (v) {
      S.q = v;
      S.limit = 40;
      clearTimeout(_searchT);
      _searchT = setTimeout(function () {
        var el = S.root && S.root.querySelector('.wz-filters input');
        var pos = el ? el.selectionStart : null;
        render();
        var el2 = S.root && S.root.querySelector('.wz-filters input');
        if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (e) {} }
      }, 250);
    },
  };

  var _lastLoad = 0;
  global.renderWazifaReport = function (root) {
    S.root = root;
    S.active = true;
    if (!S.data) { _lastLoad = Date.now(); load(false); return; }
    render();
    // হিসাব পাতা বারবার আঁকলেও এক মিনিটে একবারের বেশি নতুন করে আনা নয়
    if (Date.now() - _lastLoad > 60000) { _lastLoad = Date.now(); load(true); }
  };
})(typeof window !== 'undefined' ? window : this);
