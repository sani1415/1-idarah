/**
 * সাধারণ নকশা-ভিত্তির ছোট সহায়ক (app/css/mm-ui.css-এর সাথে)।
 * MMUI.icon(name, size) · MMUI.stat({...}) · MMUI.pctTone(p) · MMUI.esc / bn / taka
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

  /** রঙিন ঘর। o: { tone:'ok|bad|warn|info|deep', icon, label, value, sub, onclick, on, id, title } */
  function stat(o) {
    var tag = o.onclick ? 'button' : 'div';
    return '<' + tag + (o.onclick ? ' type="button" onclick="' + o.onclick + '"' : '') + (o.id ? ' id="' + o.id + '"' : '') +
      ' class="ui-stat' + (o.tone ? ' is-' + o.tone : '') + (o.on ? ' is-on' : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' +
      '<span class="ui-stat-ic">' + icon(o.icon || 'info', 18) + '</span>' +
      '<span class="ui-stat-txt"><span class="ui-stat-lbl">' + o.label + '</span><span class="ui-stat-val">' + o.value + '</span>' +
      (o.sub ? '<span class="ui-stat-sub">' + o.sub + '</span>' : '') + '</span></' + tag + '>';
  }

  global.MMUI = { icon: icon, esc: esc, bn: bn, taka: taka, pctTone: pctTone, stat: stat };
})(typeof window !== 'undefined' ? window : this);
