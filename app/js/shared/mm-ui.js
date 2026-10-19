/**
 * সাধারণ নকশা-ভিত্তির ছোট সহায়ক (app/css/mm-ui.css-এর সাথে)।
 * MMUI.icon(name, size) · MMUI.stat({...}) · MMUI.pctTone(p) · MMUI.esc / bn / taka
 * MMUI.confirm(msg, opts) → Promise<boolean> (নিজের CSS নিজে যোগ করে)
 * MMUI.skeleton({ stats, rows, panel }) / MMUI.skRows(n) — লোডের ছায়া · MMUI.empty({ icon, title, sub, action, onclick })
 */
(function (global) {
  'use strict';

  var ICON = {
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    x: '<path d="M7 7l10 10M17 7 7 17"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 7v6"/><path d="M12 16.8v.2"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.6 14.2c2.4.1 4.1 1.7 4.7 4.3"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    chev: '<path d="M9.5 6l6 6-6 6"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    star: '<path d="M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/>',
    wallet: '<path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5z"/><path d="M4 7.5 15.5 4.2v3.3"/><circle cx="16" cy="13.5" r="1"/>',
    up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
    door: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  };
  function icon(name, size) {
    var z = size || 18;
    return '<svg aria-hidden="true" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || '') + '</svg>';
  }
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
  // শতকরা রং: ৭০+ সবুজ, ৫০–৬৯ হলুদ, ৫০-এর কম লাল
  function pctTone(p) { return p >= 70 ? 'ui-ok' : (p >= 50 ? 'ui-warn' : 'ui-bad'); }

  /** রঙিন ঘর। o: { tone:'ok|bad|warn|info|deep', icon, label, short (মোবাইল .is-compact-এ ছোট লেবেল), value, sub, onclick, on, id, title } */
  function stat(o) {
    var tag = o.onclick ? 'button' : 'div';
    return '<' + tag + (o.onclick ? ' type="button" onclick="' + o.onclick + '"' : '') + (o.id ? ' id="' + o.id + '"' : '') +
      ' class="ui-stat' + (o.tone ? ' is-' + o.tone : '') + (o.on ? ' is-on' : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' +
      '<span class="ui-stat-ic">' + icon(o.icon || 'info', 18) + '</span>' +
      '<span class="ui-stat-txt"><span class="ui-stat-lbl">' + (o.short ? '<span class="ui-lf">' + o.label + '</span><span class="ui-ls">' + o.short + '</span>' : o.label) + '</span><span class="ui-stat-val">' + o.value + '</span>' +
      (o.sub ? '<span class="ui-stat-sub">' + o.sub + '</span>' : '') + '</span></' + tag + '>';
  }

  /* ── নিশ্চিতকরণ বাক্স: ব্রাউজারের confirm()-এর বদলে ──
     MMUI.confirm(msg, { title, ok, cancel, danger, note }) → Promise<boolean>
     msg-এ "\n\n" থাকলে প্রথম অংশ শিরোনাম, বাকিটা বিবরণ।
     MMUI.alert(msg, opts) — একই বাক্স, শুধু «ঠিক আছে» বোতাম (ব্রাউজারের alert()-এর বদলে) → Promise */
  var CONFIRM_CSS =
    '.mmc-bg{position:fixed;inset:0;z-index:10050;background:rgba(42,35,24,.42);display:flex;align-items:center;justify-content:center;padding:16px;animation:mmcIn .12s ease-out}' +
    '.mmc{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:var(--ui-card,#fffdf8);border-radius:20px;box-shadow:0 28px 80px rgba(26,18,8,.3);padding:22px 20px 16px;text-align:center;font-family:var(--font-bn,inherit)}' +
    '.mmc-ic{width:54px;height:54px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;background:var(--ui-warn-bg,#fbefd6);color:var(--ui-warn,#b07a12)}' +
    '.mmc.is-danger .mmc-ic{background:var(--ui-bad-bg,#fbe6e1);color:var(--ui-bad,#b5573a)}' +
    '.mmc h3{margin:0 0 6px;font-size:18px;font-weight:700;color:var(--ink,#2a2318);line-height:1.45}' +
    '.mmc p{margin:0;font-size:14px;color:var(--ink2,#4a4032);line-height:1.6;white-space:pre-line}' +
    '.mmc-note{margin-top:12px;background:var(--ui-bad-bg,#fbe6e1);color:var(--ui-bad,#b5573a);border-radius:12px;padding:9px 12px;font-size:13px;text-align:left;white-space:pre-line}' +
    '.mmc-bt{display:flex;gap:8px;margin-top:16px}' +
    '.mmc-bt button{flex:1;min-height:42px;border-radius:12px;font:inherit;font-size:14.5px;font-weight:700;cursor:pointer;padding:6px 10px}' +
    '.mmc-c{background:#fff;border:1px solid var(--ui-bd,#e8dcc6);color:var(--ink2,#4a4032)}' +
    '.mmc-o{background:var(--ui-accent,#b5573a);border:none;color:#fff}' +
    '.mmc-bt button:focus-visible{outline:3px solid rgba(181,87,58,.35);outline-offset:2px}' +
    '@keyframes mmcIn{from{opacity:0}to{opacity:1}}';
  var DANGER_RE = /মুছ|ডিলিট|বাদ |বাদ দ|বাতিল|সরিয়ে|লগআউট|পূর্বাবস্থা/;
  function confirmBox(msg, o) {
    o = o || {};
    if (typeof document === 'undefined' || !document.body) {
      if (o.alert) { global.alert(msg); return Promise.resolve(true); }
      return Promise.resolve(global.confirm(msg));
    }
    if (!document.getElementById('mmc-css')) {
      var st = document.createElement('style');
      st.id = 'mmc-css';
      st.textContent = CONFIRM_CSS;
      document.head.appendChild(st);
    }
    var text = String(msg == null ? '' : msg);
    var parts = text.split(/\n\s*\n/);
    var title = o.title || '';
    var body = text;
    if (!title) {
      if (parts.length > 1) { title = parts.shift(); body = parts.join('\n\n'); }
      else if (text.length <= 70) { title = text; body = ''; }
      else title = 'নিশ্চিত করুন';
    }
    var danger = o.danger != null ? !!o.danger : (!o.alert && DANGER_RE.test(text));
    var prevFocus = document.activeElement;
    return new Promise(function (resolve) {
      var bg = document.createElement('div');
      bg.className = 'mmc-bg';
      bg.innerHTML = '<div class="mmc' + (danger ? ' is-danger' : '') + '" role="alertdialog" aria-modal="true" aria-labelledby="mmc-t">' +
        '<div class="mmc-ic">' + icon('alert', 26) + '</div>' +
        '<h3 id="mmc-t">' + esc(title) + '</h3>' +
        (body ? '<p>' + esc(body) + '</p>' : '') +
        (o.note ? '<div class="mmc-note">⚠ ' + esc(o.note) + '</div>' : '') +
        '<div class="mmc-bt">' + (o.alert ? '' : '<button type="button" class="mmc-c">' + esc(o.cancel || 'না, থাক') + '</button>') +
        '<button type="button" class="mmc-o">' + esc(o.ok || (o.alert ? 'ঠিক আছে' : (danger ? 'হ্যাঁ, নিশ্চিত' : 'হ্যাঁ'))) + '</button></div></div>';
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        if (bg.parentNode) bg.parentNode.removeChild(bg);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(!!o.alert); }
        else if (e.key === 'Tab') {
          var bs = bg.querySelectorAll('button');
          var i = Array.prototype.indexOf.call(bs, document.activeElement);
          e.preventDefault();
          bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
        }
      }
      if (!o.alert) bg.querySelector('.mmc-c').onclick = function () { done(false); };
      bg.querySelector('.mmc-o').onclick = function () { done(true); };
      bg.addEventListener('click', function (e) { if (e.target === bg) done(!!o.alert); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(bg);
      bg.querySelector(danger && !o.alert ? '.mmc-c' : '.mmc-o').focus();
    });
  }

  /* ── লোড হওয়ার সময় ছায়া-কাঠামো ── */
  function skRows(n) {
    var h = '';
    for (var i = 0; i < (n || 3); i++) {
      h += '<div class="ui-sk-row"><span class="ui-sk" style="width:30px;height:20px"></span><span style="flex:1">' +
        '<span class="ui-sk" style="height:12px;width:' + (40 + (i * 17) % 35) + '%"></span>' +
        '<span class="ui-sk" style="height:10px;width:' + (22 + (i * 11) % 20) + '%;margin-top:6px"></span></span></div>';
    }
    return h;
  }
  /** o: { stats: ঘর-সংখ্যা, rows: সারি-সংখ্যা, panel: true হলে সারিগুলো কার্ডে } */
  function skeleton(o) {
    o = o || {};
    var h = '<div class="ui-sk-wrap" aria-busy="true" aria-label="লোড হচ্ছে">';
    if (o.stats) {
      h += '<div class="ui-stats' + (o.stats === 3 ? ' is-3' : '') + '">';
      for (var i = 0; i < o.stats; i++) {
        h += '<div class="ui-sk-stat"><span class="ui-sk" style="width:36px;height:36px;border-radius:50%"></span><span style="flex:1">' +
          '<span class="ui-sk" style="height:10px;width:60%"></span><span class="ui-sk" style="height:18px;width:40%;margin-top:6px"></span></span></div>';
      }
      h += '</div>';
    }
    if (o.rows !== 0) h += o.panel === false ? skRows(o.rows) : '<section class="ui-box ui-panel">' + skRows(o.rows || 4) + '</section>';
    return h + '</div>';
  }
  /** খালি অবস্থা। o: { icon, title, sub, action, onclick } */
  function empty(o) {
    o = o || {};
    return '<div class="ui-emptybox"><div class="ui-emptybox-ic">' + icon(o.icon || 'info', 26) + '</div>' +
      '<b>' + esc(o.title || 'কিছু নেই') + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') +
      (o.action && o.onclick ? '<button type="button" class="ui-pill" onclick="' + o.onclick + '">' + esc(o.action) + '</button>' : '') +
      '</div>';
  }

  function alertBox(msg, o) { o = Object.assign({}, o || {}, { alert: true }); return confirmBox(msg, o); }

  global.MMUI = { icon: icon, esc: esc, bn: bn, taka: taka, pctTone: pctTone, stat: stat, confirm: confirmBox, alert: alertBox,
    skeleton: skeleton, skRows: skRows, empty: empty };
})(typeof window !== 'undefined' ? window : this);
