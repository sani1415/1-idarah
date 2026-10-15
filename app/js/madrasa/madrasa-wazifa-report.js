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
    dept: '', classId: '', q: '', polling: null, pollUntil: 0, root: null,
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
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.wz-shell{padding:4px 0 24px;}' +
      '.wz-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;}' +
      '.wz-back{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--cream);border-radius:10px;padding:7px 12px;cursor:pointer;}' +
      '.wz-title{font-weight:800;font-size:17px;color:var(--ink);}' +
      '.wz-sub{font-size:11px;color:var(--ink3);margin-top:2px;}' +
      '.wz-sync{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--ink3);margin:0 0 12px;}' +
      '.wz-btn{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--cream);border-radius:9px;padding:6px 11px;cursor:pointer;color:var(--ink);}' +
      '.wz-btn[disabled]{opacity:.55;cursor:default;}' +
      '.wz-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;}' +
      '.wz-filters select,.wz-filters input{font:inherit;font-size:13px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:#fff;min-width:0;width:100%;box-sizing:border-box;}' +
      '.wz-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;}' +
      '.wz-card{border:1px solid var(--cream2);background:var(--cream);border-radius:12px;padding:9px 10px;cursor:pointer;text-align:left;font:inherit;min-width:0;}' +
      '.wz-card.is-on{outline:2px solid var(--gold);}' +
      '.wz-card-lbl{font-size:11px;color:var(--ink3);font-weight:600;}' +
      '.wz-card-val{font-size:20px;font-weight:800;margin-top:2px;}' +
      '.wz-card-sub{font-size:11px;color:var(--ink3);margin-top:1px;}' +
      '.wz-c-ontime .wz-card-val{color:var(--green);}' +
      '.wz-c-late .wz-card-val{color:var(--gold-deep,#9a6b12);}' +
      '.wz-c-due .wz-card-val{color:var(--red);}' +
      '.wz-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px;}' +
      '.wz-tab{font:inherit;font-size:12px;padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;}' +
      '.wz-tab.is-on{background:var(--ink);color:#fff;border-color:var(--ink);}' +
      '.wz-list{border:1px solid var(--cream2);border-radius:12px;background:#fff;overflow:hidden;}' +
      '.wz-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid var(--cream2);}' +
      '.wz-row:last-child{border-bottom:none;}' +
      '.wz-name{font-weight:700;color:var(--ink);font-size:14px;}' +
      '.wz-name a{color:inherit;text-decoration:none;border-bottom:1px dashed var(--line);cursor:pointer;}' +
      '.wz-meta{font-size:11px;color:var(--ink3);margin-top:2px;}' +
      '.wz-right{text-align:right;flex-shrink:0;font-size:13px;}' +
      '.wz-amt{font-weight:800;}' +
      '.wz-amt.due{color:var(--red);}' +
      '.wz-note{font-size:11px;color:var(--ink3);margin-top:2px;}' +
      '.wz-empty{padding:18px;text-align:center;color:var(--ink3);font-size:13px;}' +
      '.wz-sec{font-weight:800;font-size:14px;margin:18px 0 8px;color:var(--ink2);}' +
      '.wz-table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid var(--cream2);border-radius:12px;overflow:hidden;}' +
      '.wz-table th,.wz-table td{padding:7px 8px;border-bottom:1px solid var(--cream2);text-align:right;}' +
      '.wz-table th:first-child,.wz-table td:first-child{text-align:left;}' +
      '.wz-table th{background:var(--cream);font-weight:700;color:var(--ink2);}' +
      '.wz-bar{display:inline-block;height:6px;border-radius:3px;background:var(--green);vertical-align:middle;margin-left:6px;}' +
      '.wz-warn{background:var(--red-light);color:var(--red);border-radius:10px;padding:8px 10px;font-size:12px;margin-bottom:10px;}' +
      '@media (max-width:640px){.wz-filters{grid-template-columns:1fr 1fr;}.wz-cards{grid-template-columns:1fr 1fr;}.wz-hide-sm{display:none;}}';
    document.head.appendChild(st);
  }

  function syncLine() {
    var sy = (S.data && S.data.sync) || {};
    var total = students().filter(function (s) { return s.reg_id; }).length;
    var running = sy.started_at && !sy.finished_at && (Date.now() - new Date(sy.started_at).getTime() < 20 * 60000);
    var latest = null;
    students().forEach(function (s) { if (s.fetched_at && (!latest || s.fetched_at > latest)) latest = s.fetched_at; });
    var txt = running
      ? 'হালনাগাদ চলছে… ' + bn(sy.done_this_run || 0) + '/' + bn(total) + ' জন'
      : (latest ? 'ফি-সফটওয়্যার থেকে শেষ হালনাগাদ: ' + ago(sy.finished_at || latest) : 'এখনো হালনাগাদ হয়নি');
    return '<div class="wz-sync"><span>' + esc(txt) + ' · প্রতি রাতে নিজে হালনাগাদ হয়</span>' +
      '<button type="button" class="wz-btn" onclick="MdrWazifaReport.refresh()"' + (running ? ' disabled' : '') + '>↻ এখনই হালনাগাদ</button></div>';
  }

  function filtersHtml(now) {
    var opts = monthOptions(now);
    if (!S.month && opts.length) S.month = { y: opts[0].y, m: opts[0].m };
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
    var search = '<input type="search" placeholder="নাম বা আইডি" value="' + esc(S.q) + '" oninput="MdrWazifaReport.search(this.value)">';
    return '<div class="wz-filters">' + mSel + dSel + cSel + search + '</div>';
  }

  function rowHtml(st, right) {
    var open = typeof global.openStudentDetail === 'function'
      ? '<a onclick="openStudentDetail(\'' + esc(st.id) + '\')">' + esc(st.name || '—') + '</a>' : esc(st.name || '—');
    return '<div class="wz-row"><div><div class="wz-name">' + open + '</div>' +
      '<div class="wz-meta">' + esc(bn(st.reg_id || '')) + (st.class_name ? ' · ' + esc(st.class_name) : '') + '</div></div>' +
      '<div class="wz-right">' + right + '</div></div>';
  }

  function render() {
    var root = S.root;
    if (!root || !root.isConnected) return;
    ensureStyles();
    var head = '<div class="wz-top"><div><div class="wz-title">ওজিফা — সময়মতো আদায়</div>' +
      '<div class="wz-sub">ফি-সফটওয়্যারের তথ্য · সময়মতো = যে মাসের ওজিফা সেই মাসের মধ্যেই পরিশোধ</div></div>' +
      '<button type="button" class="wz-back" onclick="closeAccGrid()">← হিসাব</button></div>';
    if (S.loading && !S.data) { root.innerHTML = '<div class="wz-shell">' + head + '<div class="wz-empty">লোড হচ্ছে…</div></div>'; return; }
    if (S.error && !S.data) {
      root.innerHTML = '<div class="wz-shell">' + head + '<div class="wz-empty">' + esc(S.error) +
        '<br><button type="button" class="wz-btn" style="margin-top:8px" onclick="MdrWazifaReport.load()">আবার চেষ্টা করুন</button></div></div>';
      return;
    }
    var now = nowHijri();
    var filters = filtersHtml(now);
    var list = filtered();
    var sel = S.month;
    var groups = { ontime: [], late: [], due: [], pending: [], none: [], nodata: [], regular: [] };
    var amtPaid = 0, amtDue = 0;
    list.forEach(function (st) {
      if (!st.status) { groups.nodata.push({ st: st }); return; }
      if (st.status === 'not_found') { groups.nodata.push({ st: st, nf: true }); return; }
      var ds = dueSummary(st, now);
      if (ds.dueMonths >= 2) groups.regular.push({ st: st, ds: ds });
      if (!sel) return;
      var ms = monthStatus(st, sel.y, sel.m, now);
      ms.ds = ds;
      (groups[ms.s] || groups.none).push({ st: st, ms: ms });
      if (ms.s === 'ontime' || ms.s === 'late') amtPaid += ms.amount || 0;
      if (ms.s === 'due' || ms.s === 'pending') amtDue += ms.unpaid || 0;
    });
    groups.regular.sort(function (a, b) { return b.ds.dueMonths - a.ds.dueMonths || b.ds.due - a.ds.due; });
    var isCur = sel && now && key(sel.y, sel.m) === key(now.y, now.m);
    var unpaidKey = isCur ? 'pending' : 'due';
    if (S.view === 'due' || S.view === 'pending') S.view = unpaidKey;

    var card = function (k, cls, label, n, sub) {
      return '<button type="button" class="wz-card ' + cls + (S.view === k ? ' is-on' : '') + '" onclick="MdrWazifaReport.set(\'view\', \'' + k + '\')">' +
        '<div class="wz-card-lbl">' + label + '</div><div class="wz-card-val">' + bn(n) + '</div>' + (sub ? '<div class="wz-card-sub">' + sub + '</div>' : '') + '</button>';
    };
    var cards = '<div class="wz-cards">' +
      card('ontime', 'wz-c-ontime', 'সময়মতো', groups.ontime.length, taka(groups.ontime.reduce(function (s, x) { return s + (x.ms.amount || 0); }, 0))) +
      card('late', 'wz-c-late', 'দেরিতে', groups.late.length, taka(groups.late.reduce(function (s, x) { return s + (x.ms.amount || 0); }, 0))) +
      card(unpaidKey, 'wz-c-due', isCur ? 'এখনো দেয়নি' : 'বাকি', groups[unpaidKey].length, taka(amtDue)) +
      card('regular', 'wz-c-due', 'নিয়মিত বাকিদার', groups.regular.length, '২ বা বেশি মাস বাকি') +
      '</div>';

    var notes = '';
    if (isCur) notes += '<div class="wz-sub" style="margin:-4px 0 10px">চলতি মাস এখনো শেষ হয়নি — যারা দেয়নি তারা «এখনো দেয়নি»; মাস শেষে «বাকি» হবে।</div>';

    var tabs = '<div class="wz-tabs">' + [
      [unpaidKey, isCur ? 'এখনো দেয়নি' : 'বাকি', groups[unpaidKey].length],
      ['late', 'দেরিতে', groups.late.length], ['ontime', 'সময়মতো', groups.ontime.length],
      ['regular', 'নিয়মিত বাকিদার', groups.regular.length], ['nodata', 'তথ্য নেই', groups.nodata.length],
    ].map(function (t) {
      return '<button type="button" class="wz-tab' + (S.view === t[0] ? ' is-on' : '') + '" onclick="MdrWazifaReport.set(\'view\', \'' + t[0] + '\')">' + t[1] + ' (' + bn(t[2]) + ')</button>';
    }).join('') + '</div>';

    var rows = '';
    var cur = groups[S.view] || [];
    if (S.view === 'ontime' || S.view === 'late') {
      rows = cur.map(function (x) {
        var p = x.ms.paid;
        // ফি-সফটওয়্যারের তারিখে কখনো ৩১–৩৩ দিন আসে — অসম্ভব দিন হলে শুধু মাস
        var when = p ? 'পরিশোধ: ' + (p.d >= 1 && p.d <= 30 ? bn(p.d) + ' ' : '') + monthName(p.m) + ' ' + bn(p.y) : 'পরিশোধিত';
        var note = S.view === 'late' ? (x.ms.lateBy === 1 ? 'পরের মাসে দিয়েছে' : bn(x.ms.lateBy) + ' মাস পরে দিয়েছে') : '';
        return rowHtml(x.st, '<div class="wz-amt">' + taka(x.ms.amount) + '</div><div class="wz-note">' + esc(when) + '</div>' + (note ? '<div class="wz-note">' + note + '</div>' : ''));
      }).join('');
    } else if (S.view === 'regular') {
      rows = cur.map(function (x) {
        return rowHtml(x.st, '<div class="wz-amt due">' + taka(x.ds.due) + '</div><div class="wz-note">' + bn(x.ds.dueMonths) + ' মাসের ওজিফা বাকি</div>');
      }).join('');
    } else if (S.view === 'nodata') {
      rows = cur.map(function (x) {
        return rowHtml(x.st, '<div class="wz-note">' + (x.nf ? 'ফি-সফটওয়্যারে আইডি নেই' : 'এখনো আনা হয়নি') + '</div>');
      }).join('');
    } else {
      rows = cur.sort(function (a, b) { return b.ms.ds.due - a.ms.ds.due; }).map(function (x) {
        var more = x.ms.ds.dueMonths > (S.view === 'due' ? 1 : 0) ? 'মোট বাকি ' + taka(x.ms.ds.due) + ' (' + bn(x.ms.ds.dueMonths) + ' মাস)' : '';
        return rowHtml(x.st, '<div class="wz-amt due">' + taka(x.ms.unpaid) + '</div>' + (more ? '<div class="wz-note">' + more + '</div>' : ''));
      }).join('');
    }
    if (!rows) rows = '<div class="wz-empty">এই তালিকায় কেউ নেই</div>';

    root.innerHTML = '<div class="wz-shell">' + head + syncLine() +
      (S.error ? '<div class="wz-warn">' + esc(S.error) + '</div>' : '') +
      filters + cards + notes + tabs + '<div class="wz-list">' + rows + '</div>' +
      classTable(list, now) + monthTable(list, now) + '</div>';
  }

  // জামাতভিত্তিক: নির্বাচিত মাসে সময়মতো / দেরিতে / বাকি
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
    if (keys.length < 2) return '';
    return '<div class="wz-sec">জামাতভিত্তিক — ' + esc(monthName(S.month.m) + ' ' + bn(S.month.y)) + '</div>' +
      '<table class="wz-table"><thead><tr><th>জামাত</th><th>সময়মতো</th><th>দেরিতে</th><th>বাকি</th><th class="wz-hide-sm">সময়মতো %</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var b = by[k], pct = Math.round(b.ontime * 100 / b.n);
        return '<tr><td>' + esc(b.name) + (b.dept && DEPT_BN[b.dept] ? ' <span style="color:var(--ink3);font-size:10px">' + DEPT_BN[b.dept] + '</span>' : '') + '</td><td>' + bn(b.ontime) + '</td><td>' + bn(b.late) + '</td><td>' + bn(b.due) + '</td>' +
          '<td class="wz-hide-sm">' + bn(pct) + '%<span class="wz-bar" style="width:' + Math.max(2, Math.round(pct * 0.6)) + 'px"></span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  // মাসভিত্তিক: এই শিক্ষাবর্ষের প্রতিটি মাসে কতজন সময়মতো
  function monthTable(list, now) {
    var opts = monthOptions(now).slice(0, 12);
    if (opts.length < 2) return '';
    return '<div class="wz-sec">মাসভিত্তিক চিত্র</div>' +
      '<table class="wz-table"><thead><tr><th>মাস</th><th>সময়মতো</th><th>দেরিতে</th><th>বাকি</th><th class="wz-hide-sm">আদায়</th></tr></thead><tbody>' +
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
        return '<tr><td>' + esc(monthName(o.m) + ' ' + bn(o.y)) + (cur ? ' (চলতি)' : '') + '</td><td>' + bn(c.ontime) + '</td><td>' + bn(c.late) + '</td><td>' + bn(c.due) + '</td><td class="wz-hide-sm">' + taka(c.paid) + '</td></tr>';
      }).join('') + '</tbody></table>';
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
    if (!(running || waiting) || !S.root || !S.root.isConnected) return;
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

  var _searchT = null;
  global.MdrWazifaReport = {
    load: function () { load(false); },
    refresh: refresh,
    set: function (k, v) {
      if (k === 'month') { var p = String(v).split('-'); S.month = { y: Number(p[0]), m: Number(p[1]) }; }
      else if (k === 'dept') { S.dept = v; S.classId = ''; }
      else S[k] = v;
      render();
    },
    search: function (v) {
      S.q = v;
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
    if (!S.data) { _lastLoad = Date.now(); load(false); return; }
    render();
    // হিসাব পাতা বারবার আঁকলেও এক মিনিটে একবারের বেশি নতুন করে আনা নয়
    if (Date.now() - _lastLoad > 60000) { _lastLoad = Date.now(); load(true); }
  };
})(typeof window !== 'undefined' ? window : this);
