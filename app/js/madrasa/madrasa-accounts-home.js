/**
 * হিসাব পাতার প্রথম স্ক্রিন (দফতর ও জিম্মাদার) — ওজিফা রিপোর্টের ধাঁচে সাজানো ড্যাশবোর্ড।
 * madrasa-daftar-accounts.js-এর renderAccounts() সারসংক্ষেপ দেখানোর সময়
 * window.MdrAccHome.build({ tools, excelCard }) ডাকে; না থাকলে পুরনো সারসংক্ষেপই দেখায়।
 * তথ্য: MdrAccAPI (আয়/ব্যয়/বকেয়া) আর MdrWazifaReport.summary() (ওজিফার ছোট সারাংশ)।
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'mdr-acd-style';

  function A() { return global.MdrAccAPI; }
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
  function signed(n) { return (n < 0 ? '−' : '') + taka(n); }
  function num(v) { return Number(v) || 0; }

  var ICON = {
    wallet: '<path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5z"/><path d="M4 7.5 15.5 4.2v3.3"/><circle cx="16" cy="13.5" r="1"/>',
    up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
    alert: '<path d="M12 7v6"/><path d="M12 16.8v.2"/>',
    hand: '<path d="M4 14h3l3.5 2.5h4a1.5 1.5 0 0 0 0-3H11"/><path d="M7 14V9.5L11 6h4.5"/><path d="M14.5 13.5l4.2-3a1.4 1.4 0 0 1 1.8 2.1L15 18H8"/>',
    cash: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.2"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.6 14.2c2.4.1 4.1 1.7 4.7 4.3"/>',
    chev: '<path d="M9.5 6l6 6-6 6"/>',
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
      // পাতার .content ডেস্কটপে ১১০০–১২৪০px-এ বাঁধা — এই পাতায় পুরো চওড়া, যেন বড় পর্দায় বেশি কলাম বসে
      '.content:has(.acd-shell){max-width:none !important;}' +
      '.acd-shell{--acd-ok:#3f7a50;--acd-ok-bg:#e8f2e7;--acd-warn:#b07a14;--acd-warn-bg:#fbf0d6;--acd-bad:#b5573a;--acd-bad-bg:#fbe7df;' +
        '--acd-card:#fffdf9;--acd-bd:#ece3d2;container-type:inline-size;color:var(--ink);padding:2px 4px 24px;}' +
      '.acd-box{background:var(--acd-card);border:1px solid var(--acd-bd);border-radius:16px;box-shadow:0 1px 2px rgba(42,35,24,.04),0 6px 18px -10px rgba(42,35,24,.12);}' +
      '.acd-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;}' +
      '.acd-head{display:flex;align-items:center;gap:4px 14px;flex-wrap:wrap;min-width:0;}' +
      '.acd-title{font-family:var(--font-bn);font-weight:700;font-size:22px;line-height:1.25;margin:0;color:var(--ink);}' +
      '.acd-sub{font-size:13px;color:var(--ink3);}' +
      '.acd-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}' +
      '.acd-tools .acc-btn,.acd-tools .acc-report-top{height:34px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:700;box-shadow:0 1px 2px rgba(42,35,24,.06);width:auto;}' +
      '.acd-tools .acc-report-top{border:1px solid var(--acd-bd);background:var(--acd-card);color:var(--ink2);}' +
      '.acd-tools .acc-report-top:hover{border-color:var(--acd-bad);color:var(--acd-bad);}' +
      '.acd-xl{margin:0 0 10px;}' +
      '.acd-xl>summary{list-style:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12.5px;font-weight:600;' +
        'color:#2f5f80;background:var(--blue-light,#e8f1f7);border:1px solid rgba(47,107,147,.18);border-radius:999px;padding:4px 12px;}' +
      '.acd-xl.is-off>summary{color:var(--ink3);background:var(--cream);border-color:var(--cream2);}' +
      '.acd-xl>summary::-webkit-details-marker{display:none;}' +
      '.acd-xl[open]>summary{margin-bottom:6px;}' +
      '.acd-xl .acc-xl-banner{margin:0;}' +
      '.acd-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:8px;}' +
      '.acd-card{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;text-align:left;font:inherit;color:var(--ink);' +
        'background:var(--acd-card);border:1.5px solid var(--acd-bd);border-radius:14px;padding:10px 12px;min-width:0;' +
        'box-shadow:0 1px 2px rgba(42,35,24,.04);}' +
      'button.acd-card{cursor:pointer;transition:box-shadow .15s,border-color .15s;}' +
      'button.acd-card:hover{box-shadow:0 6px 18px -10px rgba(42,35,24,.3);}' +
      '.acd-ic{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;}' +
      '.acd-txt{display:flex;flex-direction:column;min-width:0;}' +
      '.acd-lbl{font-size:12.5px;font-weight:600;color:var(--ink2);white-space:nowrap;}' +
      '.acd-val{font-family:var(--font-bn);font-size:19px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.acd-ok{background:linear-gradient(135deg,var(--acd-ok-bg),var(--acd-card) 70%);}.acd-ok .acd-ic{background:var(--acd-ok);}.acd-ok .acd-val{color:var(--acd-ok);}' +
      '.acd-bad{background:linear-gradient(135deg,var(--acd-bad-bg),var(--acd-card) 70%);}.acd-bad .acd-ic{background:var(--acd-bad);}.acd-bad .acd-val{color:var(--acd-bad);}' +
      '.acd-warn{background:linear-gradient(135deg,var(--acd-warn-bg),var(--acd-card) 70%);}.acd-warn .acd-ic{background:var(--acd-warn);}.acd-warn .acd-val{color:var(--acd-warn);}' +
      '.acd-note{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink3);margin:0 2px 12px;}' +
      '.acd-main{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start;}' +
      '.acd-panel{overflow:hidden;min-width:0;}' +
      '.acd-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid var(--acd-bd);flex-wrap:wrap;}' +
      '.acd-ph h3{font-family:var(--font-bn);font-size:16px;font-weight:700;margin:0;color:var(--ink);}' +
      '.acd-ph small{font-size:12px;color:var(--ink3);}' +
      '.acd-tbl{width:100%;border-collapse:collapse;font-size:13.5px;}' +
      '.acd-tbl th,.acd-tbl td{padding:9px 12px;border-bottom:1px solid var(--cream2);text-align:right;white-space:nowrap;}' +
      '.acd-tbl th:first-child,.acd-tbl td:first-child{text-align:left;white-space:normal;}' +
      '.acd-tbl th{font-size:12.5px;font-weight:700;color:var(--ink3);background:var(--cream);}' +
      '.acd-tbl tbody tr{cursor:pointer;}' +
      '.acd-tbl tbody tr:hover td{background:var(--cream);}' +
      '.acd-tbl tfoot td{font-weight:800;background:var(--cream);border-bottom:none;border-top:1px solid var(--acd-bd);}' +
      '.acd-red{color:var(--acd-bad);font-weight:700;}.acd-green{color:var(--acd-ok);}' +
      '.acd-track{display:block;width:100%;min-width:60px;height:8px;border-radius:4px;background:var(--cream2);overflow:hidden;}' +
      '.acd-fill{display:block;height:100%;border-radius:4px;background:#c9973a;}' +
      '.acd-due{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;}' +
      '.acd-chips{display:flex;gap:4px;flex-wrap:wrap;}' +
      '.acd-chip{font:inherit;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--acd-bd);background:#fff;color:var(--ink2);cursor:pointer;}' +
      '.acd-chip.is-on{background:var(--acd-bad);border-color:var(--acd-bad);color:#fff;}' +
      '.acd-crow{display:grid;grid-template-columns:22px minmax(0,1.4fr) minmax(50px,1fr) auto;gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--cream2);cursor:pointer;}' +
      '.acd-crow:hover{background:var(--cream);}' +
      '.acd-rank{width:22px;height:22px;border-radius:50%;background:var(--cream2);color:var(--ink3);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;}' +
      '.acd-cname{display:flex;flex-direction:column;min-width:0;}' +
      '.acd-cname b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.acd-cname small,.acd-camt small{font-size:11.5px;color:var(--ink3);}' +
      '.acd-camt{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap;}' +
      '.acd-camt b{color:var(--acd-bad);font-size:14px;}' +
      '.acd-cfoot{padding:9px 14px;font-size:12.5px;color:var(--ink3);background:var(--cream);}' +
      '.acd-wz{display:flex;flex-direction:column;}' +
      '.acd-wz-months{display:grid;grid-template-columns:minmax(0,1fr);}' +
      '.acd-wz-m{padding:10px 14px 12px;}' +
      '.acd-wz-m+.acd-wz-m{border-top:1px solid var(--cream2);}' +
      '.acd-wz-h{font-size:13px;font-weight:700;color:var(--ink2);margin-bottom:8px;}' +
      '.acd-wz-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}' +
      '.acd-wz-it{border-radius:12px;padding:8px 10px;background:var(--cream);min-width:0;}' +
      '.acd-wz-it b{display:block;font-family:var(--font-bn);font-size:20px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.acd-wz-it span{display:block;font-size:12.5px;color:var(--ink2);font-weight:600;}' +
      '.acd-wz-it em{display:block;font-style:normal;font-size:11.5px;color:var(--ink3);}' +
      '.acd-wz-open{display:flex;align-items:center;justify-content:center;gap:4px;font:inherit;font-size:14px;font-weight:600;color:var(--acd-bad);' +
        'background:transparent;border:none;border-top:1px solid var(--cream2);padding:11px;cursor:pointer;width:100%;}' +
      '.acd-wz-open:hover{background:var(--cream);}' +
      '.acd-empty{padding:18px;text-align:center;color:var(--ink3);font-size:13px;}' +
      '@container (max-width:1100px){.acd-cards{grid-template-columns:repeat(3,minmax(0,1fr));}}' +
      '@container (min-width:860px){' +
        '.acd-main{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}' +
        '.acd-main>.acd-wz{grid-column:1/-1;}' +
        '.acd-main>.acd-wz .acd-wz-months{grid-template-columns:repeat(2,minmax(0,1fr));}' +
        '.acd-main>.acd-wz .acd-wz-m+.acd-wz-m{border-top:none;border-left:1px solid var(--cream2);}' +
      '}' +
      '@container (min-width:1200px){' +
        '.acd-main{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) minmax(0,.85fr);}' +
        '.acd-main>.acd-wz{grid-column:auto;}' +
        '.acd-main>.acd-wz .acd-wz-months{grid-template-columns:minmax(0,1fr);}' +
        '.acd-main>.acd-wz .acd-wz-m+.acd-wz-m{border-left:none;border-top:1px solid var(--cream2);}' +
      '}' +
      '@media (max-width:640px){' +
        '.acd-title{font-size:19px;}' +
        '.acd-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}' +
        '.acd-card{padding:8px 10px;gap:8px;}' +
        '.acd-ic{width:30px;height:30px;}' +
        '.acd-val{font-size:17px;}' +
        '.acd-tools{width:100%;}' +
        '.acd-tools>*{flex:1 1 auto;}' +
        '.acd-tbl th,.acd-tbl td{padding:8px 8px;}' +
        '.acd-hide-sm{display:none;}' +
        '.acd-shell{padding:2px 10px 24px;}' +
        '.acd-crow{grid-template-columns:22px minmax(0,1fr) auto;padding:8px 10px;}' +
        '.acd-cbar{display:none;}' +
        '.acd-wz-it b{font-size:17px;}' +
      '}';
    document.head.appendChild(st);
  }

  // সর্বশেষ এন্ট্রির তারিখ
  function lastEntryLabel(inc, exp) {
    var best = null, bestKey = '';
    inc.concat(exp).forEach(function (r) {
      var k = String(r.dateKey || '');
      if (k > bestKey) { bestKey = k; best = r; }
    });
    if (!best) return '';
    try { return 'শেষ এন্ট্রি: ' + A().dateLabel(best); } catch (e) { return ''; }
  }

  function card(tone, ic, label, value, onclick, title) {
    var tag = onclick ? 'button' : 'div';
    return '<' + tag + (onclick ? ' type="button" onclick="' + onclick + '"' : '') + ' class="acd-card acd-' + tone + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
      '<span class="acd-ic">' + icon(ic, 18) + '</span>' +
      '<span class="acd-txt"><span class="acd-lbl">' + label + '</span><span class="acd-val">' + value + '</span></span></' + tag + '>';
  }

  function ledgerPanel(s, inc, exp, dues) {
    var api = A(), AL = api.ACCOUNT_LABELS;
    var accs = Object.keys(AL).filter(function (a) { return a !== 'qard' && a !== 'qard_return'; });
    var rows = accs.map(function (acc) {
      var e = 0, n = 0;
      exp.forEach(function (r) { if (r.account === acc) { e += num(r.amount); n++; } });
      var due = 0;
      dues.forEach(function (d) { if (d.account === acc) due += Math.max(0, num(d.due)); });
      if (!e && !due) return null;
      return { id: acc, label: AL[acc], exp: e, due: due, pct: s.te ? Math.round(e / s.te * 100) : 0 };
    }).filter(Boolean).sort(function (a, b) { return b.exp - a.exp; });
    var body = rows.map(function (r) {
      return '<tr onclick="openAccAccountDetails(\'' + esc(r.id) + '\')">' +
        '<td><b>' + esc(r.label) + '</b></td>' +
        '<td class="acd-red">' + taka(r.exp) + '</td>' +
        '<td class="acd-hide-sm" style="width:26%"><span class="acd-track"><span class="acd-fill" style="width:' + r.pct + '%"></span></span></td>' +
        '<td>' + bn(r.pct) + '%</td>' +
        (r.due > 0
          ? '<td><span class="acd-red acd-due" onclick="event.stopPropagation();openAccDueDetails(\'' + esc(r.id) + '\')">' + taka(r.due) + '</span></td>'
          : '<td class="acd-green">—</td>') +
        '</tr>';
    }).join('');
    return '<section class="acd-box acd-panel"><div class="acd-ph"><h3>খাতওয়ারী হিসাব</h3><small>খাতে চাপলে বিস্তারিত</small></div>' +
      '<div style="overflow-x:auto"><table class="acd-tbl"><thead><tr><th>হিসাব বিভাগ</th><th>ব্যয়</th><th class="acd-hide-sm"></th><th>শতকরা</th><th>বর্তমান বকেয়া</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="5" class="acd-empty">তথ্য নেই</td></tr>') + '</tbody>' +
      '<tfoot><tr><td>সর্বমোট</td><td class="acd-red">' + taka(s.te) + '</td><td class="acd-hide-sm"></td><td>' + bn(100) + '%</td><td class="acd-red">' + taka(s.td) + '</td></tr></tfoot>' +
      '</table></div></section>';
  }

  // খাতভিত্তিক বড় ব্যয়: নির্বাচিত সময়ে কোন খাতে (হিসাব বিভাগসহ) সবচেয়ে বেশি খরচ
  var PERIODS = [['cur', 'চলতি মাস'], ['prev', 'গত মাস'], ['year', 'এই শিক্ষাবর্ষ'], ['all', 'সব']];
  var _period = 'year';
  function inPeriod(r, t) {
    var api = A();
    if (_period === 'all') return true;
    if (_period === 'year') return api.academicYearOf(r.hijriYear, r.month) === api.academicYearOf(t.year, t.month);
    var y = t.year, m = t.monthNo;
    if (_period === 'prev') { m -= 1; if (m < 1) { m = 12; y -= 1; } }
    return Number(r.hijriYear) === y && api.monthNo(r.month) === m;
  }
  function topCatsPanel(exp) {
    var api = A(), AL = api.ACCOUNT_LABELS, t = api.todayHijri();
    var by = {}, total = 0;
    exp.forEach(function (r) {
      if (r.account === 'qard' || !inPeriod(r, t)) return;
      var cat = api.clean(r.category, '') || 'খাত লেখা নেই';
      var k = r.account + '|' + cat;
      var g = by[k] || (by[k] = { acc: r.account, cat: cat, amt: 0, n: 0 });
      g.amt += num(r.amount); g.n++;
      total += num(r.amount);
    });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.amt - a.amt; });
    var top = list.slice(0, 10);
    var max = top.length ? top[0].amt : 1;
    var chips = '<div class="acd-chips">' + PERIODS.map(function (p) {
      return '<button type="button" class="acd-chip' + (_period === p[0] ? ' is-on' : '') + '" onclick="MdrAccHome.setPeriod(\'' + p[0] + '\')">' + p[1] + '</button>';
    }).join('') + '</div>';
    var body = top.map(function (g, i) {
      var pc = total ? Math.round(g.amt * 100 / total) : 0;
      return '<div class="acd-crow" onclick="openAccAccountDetails(\'' + esc(g.acc) + '\')" title="' + esc(g.cat) + ' — ' + bn(g.n) + 'টি এন্ট্রি">' +
        '<span class="acd-rank">' + bn(i + 1) + '</span>' +
        '<span class="acd-cname"><b>' + esc(g.cat) + '</b><small>' + esc(AL[g.acc] || g.acc) + ' · ' + bn(g.n) + 'টি এন্ট্রি</small></span>' +
        '<span class="acd-cbar"><span class="acd-track"><span class="acd-fill" style="width:' + Math.max(2, Math.round(g.amt / max * 100)) + '%"></span></span></span>' +
        '<span class="acd-camt"><b>' + taka(g.amt) + '</b><small>' + bn(pc) + '%</small></span></div>';
    }).join('');
    var label = { cur: 'চলতি মাসে', prev: 'গত মাসে', year: 'এই শিক্ষাবর্ষে', all: 'সব মিলিয়ে' }[_period];
    return '<section class="acd-box acd-panel"><div class="acd-ph"><h3>খাতভিত্তিক বড় ব্যয়</h3>' + chips + '</div>' +
      (body || '<div class="acd-empty">' + esc(label) + ' কোনো ব্যয় নেই</div>') +
      (list.length ? '<div class="acd-cfoot">' + esc(label) + ' মোট ব্যয় ' + taka(total) + (list.length > 10 ? ' · শীর্ষ ১০টি খাত দেখানো হলো (মোট ' + bn(list.length) + 'টি)' : '') + '</div>' : '') +
      '</section>';
  }

  function wazifaPanel() {
    var W = global.MdrWazifaReport;
    if (!W || !W.summary || typeof global.openWazifaReport !== 'function') return '';
    var sm = W.summary(function () { if (typeof global.renderAccounts === 'function') global.renderAccounts(); });
    var body;
    if (!sm) body = '<div class="acd-empty">ওজিফার তথ্য আনা হচ্ছে…</div>';
    else if (sm.error) body = '<div class="acd-empty">' + esc(sm.error) + '</div>';
    else {
      var it = function (val, lbl, color, sub) {
        return '<div class="acd-wz-it"><b style="color:' + color + '">' + val + '</b><span>' + lbl + '</span>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
      };
      var pctOf = function (n, t) { return t ? bn(Math.round(n * 100 / t)) + '%' : ''; };
      var cur = sm.cur
        ? '<div class="acd-wz-m"><div class="acd-wz-h">চলতি মাস · ' + esc(sm.cur.label) + '</div><div class="acd-wz-grid">' +
            it(bn(sm.cur.paid), 'দিয়েছে', 'var(--acd-ok)', pctOf(sm.cur.paid, sm.cur.total)) +
            it(bn(sm.cur.unpaid), 'এখনো দেয়নি', 'var(--acd-bad)', pctOf(sm.cur.unpaid, sm.cur.total)) +
            it(taka(sm.cur.amount), 'আদায় হয়েছে', 'var(--ink)', bn(sm.cur.total) + ' জনের মধ্যে') +
          '</div></div>'
        : '<div class="acd-wz-m"><div class="acd-wz-h">চলতি মাস</div><div class="acd-empty">চলতি মাসের তথ্য এখনো আসেনি</div></div>';
      var prev = sm.prev
        ? '<div class="acd-wz-m"><div class="acd-wz-h">গত মাস · ' + esc(sm.prev.label) + '</div><div class="acd-wz-grid">' +
            it(bn(sm.prev.ontime), 'সময়মতো', 'var(--acd-ok)', pctOf(sm.prev.ontime, sm.prev.total)) +
            it(bn(sm.prev.late), 'দেরিতে', 'var(--acd-warn)', pctOf(sm.prev.late, sm.prev.total)) +
            it(bn(sm.prev.due), 'বকেয়া', 'var(--acd-bad)', pctOf(sm.prev.due, sm.prev.total)) +
          '</div></div>'
        : '';
      body = '<div class="acd-wz-months">' + cur + prev + '</div>';
    }
    return '<section class="acd-box acd-panel acd-wz"><div class="acd-ph"><h3>ওজিফা</h3><small>ফি-সফটওয়্যার থেকে</small></div>' + body +
      '<button type="button" class="acd-wz-open" onclick="openWazifaReport()">পুরো ওজিফা রিপোর্ট ' + icon('chev', 15) + '</button></section>';
  }

  function build(opts) {
    opts = opts || {};
    var api = A();
    if (!api) return '';
    ensureStyles();
    var inc = api.Income.getAll(), exp = api.Expense.getAll(), dues = api.Dues.getAll();
    var s = api.Summary.fromRows(inc, exp, dues);
    var sub = lastEntryLabel(inc, exp);
    var head = '<div class="acd-top"><div class="acd-head"><h2 class="acd-title">হিসাব</h2>' + (sub ? '<span class="acd-sub">' + esc(sub) + '</span>' : '') + '</div>' +
      '<div class="acd-tools">' + (opts.tools || '') + '</div></div>';
    var xl = opts.excelCard
      ? '<details class="acd-xl' + (opts.excelOn ? '' : ' is-off') + '"><summary>' + icon('info', 14) + (opts.excelOn ? 'Excel মোড চালু' : 'হিসাব অ্যাপে সরাসরি লেখা হয়') + ' — বিস্তারিত</summary>' + opts.excelCard + '</details>'
      : '';
    var cards = '<div class="acd-cards">' +
      card(s.operatingBalance >= 0 ? 'ok' : 'bad', 'wallet', 'বর্তমান', signed(s.operatingBalance), '', 'আয় − ব্যয়') +
      card('ok', 'up', 'আয়', taka(s.regularIncome), "openAccMetricModal('income')") +
      card('bad', 'down', 'ব্যয়', taka(s.regularExpense), "openAccMetricModal('expense')") +
      card('warn', 'alert', 'বকেয়া', taka(s.supplierDue), "openAccMetricModal('dues')") +
      card('warn', 'hand', 'করজ', taka(s.qardRemaining), "openAccAccountDetails('qard')") +
      card(s.cashFlow >= 0 ? 'ok' : 'bad', 'cash', 'নগদ', signed(s.cashFlow), '', 'আয় − ব্যয় − করজ দেওয়া + করজ আদায়') +
      '</div>';
    var note = '<div class="acd-note">' + icon('info', 14) + '<span>নগদ = আয় − ব্যয় − করজ দেওয়া + করজ আদায় · ঘরে চাপলে বিস্তারিত</span></div>';
    return '<div class="acd-shell">' + head + xl + cards + note +
      '<div class="acd-main">' + ledgerPanel(s, inc, exp, dues) + topCatsPanel(exp) + wazifaPanel() + '</div></div>';
  }

  global.MdrAccHome = {
    build: build,
    setPeriod: function (p) { _period = p; if (typeof global.renderAccounts === 'function') global.renderAccounts(); },
  };
})(typeof window !== 'undefined' ? window : this);
