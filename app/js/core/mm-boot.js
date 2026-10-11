/**
 * <head>-এ সিঙ্ক লোড — শেল পেজে প্রথম পেইন্টের আগেই body cover করে, যাতে পুরনো/স্টেল কন্টেন্ট
 * ফ্ল্যাশ না করে। mm-session.js লোড হওয়ার পর warm হলে দ্রুত cover সরিয়ে দেয়।
 */
(function (g) {
  'use strict';
  if (!g.document || !g.document.documentElement) return;

  function injectBootCriticalCss() {
    if (g.document.getElementById('mm-boot-critical')) return;
    var st = g.document.createElement('style');
    st.id = 'mm-boot-critical';
    st.textContent =
      'html.mm-app-boot:not(.mm-app-ready){background:var(--cream,#faf6ef)}' +
      'html.mm-app-boot:not(.mm-app-ready) body{overflow:hidden}' +
      'html.mm-app-boot:not(.mm-app-ready) body>:not(#mm-app-load-screen):not(.main-nav):not(.bottom-nav){visibility:hidden!important}';
    var head = g.document.head || g.document.getElementsByTagName('head')[0];
    if (head) head.insertBefore(st, head.firstChild);
  }

  function armBootCover() {
    g.document.documentElement.classList.add('mm-app-boot');
    g.document.documentElement.classList.remove('mm-app-ready');
    injectBootCriticalCss();
  }

  /*
   * সহকারী (restricted admin): যে মেনু/লিংক তাঁর অনুমতির বাইরে, সেগুলো প্রথম paint-এর আগেই CSS দিয়ে
   * লুকানো — নইলে DOMContentLoaded-এ mm-session.js-এর applyAdminNavRestrictions() চলার আগে চোখের
   * পলকে দেখা যেত। নিয়ম হুবহু applyAdminNavRestrictions()/canAdmin()-এর মতো; ওখানে বদলালে এখানেও।
   * (শুধু দেখানো-লুকানো; আসল অনুমতি backend RPC-তে যাচাই হয়।)
   */
  function readSessionKey(key, persistKey) {
    try {
      var v = g.sessionStorage.getItem(key);
      if (v != null) return v;
    } catch (e) {}
    // mm-session.js পরে localStorage থেকে session ফিরিয়ে আনে — সেই একই উৎস
    try {
      var app = JSON.parse(g.localStorage.getItem('mm_app_persist_v1') || 'null');
      if (app && app.mm_role && app[key] != null) return String(app[key]);
    } catch (e2) {}
    try {
      if (/^admin\./i.test(g.location.hostname)) {
        var adm = JSON.parse(g.localStorage.getItem('mm_admin_persist_v1') || 'null');
        if (adm && adm.adminPin) {
          if (key === 'mm_role') return 'admin';
          if (persistKey && adm[persistKey] != null) return String(adm[persistKey]);
        }
      }
    } catch (e3) {}
    return null;
  }

  function injectRestrictedAdminCss() {
    if (readSessionKey('mm_role') !== 'admin') return;
    var perms = null;
    try { perms = JSON.parse(readSessionKey('mm_admin_perms', 'adminPerms') || 'null'); } catch (e) { perms = null; }
    if (!perms || perms.super_admin === true) return;
    var granted = perms.permissions || {};
    function can(key) {
      if (key === 'dashboard') return true;
      if (Object.prototype.hasOwnProperty.call(granted, key)) return !!granted[key];
      return key === 'messages' || key === 'recent';
    }
    var hide = ['a[href*="/admin/dept.html"]', 'a[href*="/admin/khedmat.html"]', '[data-admin-hub="dept"]'];
    var allowed = ['dashboard'];
    Object.keys(granted).forEach(function (k) { if (granted[k]) allowed.push(k); });
    if (can('messages')) allowed.push('messages');
    if (can('recent')) allowed.push('recent');
    hide.push('[data-admin-perm]' + allowed.map(function (k) {
      return ':not([data-admin-perm="' + String(k).replace(/["\\]/g, '') + '"])';
    }).join(''));
    if (!can('messages')) hide.push('a[href*="chat.html"]');
    if (!can('recent')) hide.push('a[href*="/admin/recent.html"]');
    var st = g.document.createElement('style');
    st.id = 'mm-admin-restrict';
    st.textContent = hide.join(',') + '{display:none!important}';
    var head = g.document.head || g.document.getElementsByTagName('head')[0];
    if (head) head.appendChild(st);
  }
  try { injectRestrictedAdminCss(); } catch (eRestrict) {}

  var path = (g.location.pathname || '').replace(/\\/g, '/');
  var daftarShell = /(?:^|\/)(madrasa-home|madrasa-daftar|madrasa-yearend|madrasa-kormosuchi)\.html$/i.test(path);
  // অ্যাডমিন শেল পেজ — login/nav-এর পর dashboard ফ্ল্যাশ এড়াতে cold লোডে cover।
  var adminShell = /(?:^|\/)admin\/(?:madrasa|khedmat|dept|recent)\.html$/i.test(path) ||
    /\/madrasa\/admin\/accounts\.html$/i.test(path);
  var navPending = false;
  var adminNavEnter = false;
  try {
    navPending = g.sessionStorage.getItem('mm_nav_loading') === '1';
    adminNavEnter = g.sessionStorage.getItem('mm_admin_nav_enter') === '1';
  } catch (e) {}
  if (adminNavEnter) g.document.documentElement.classList.add('mm-admin-page-entering');
  var chatFromNav = /(?:^|\/)chat\.html$/i.test(path) && navPending;
  // শেল পেজে সবসময় cover আর্ম করা হয় (warm/cold নির্বিশেষে) — কারণ এই ফাইলের নিজস্ব
  // isSessionDataWarm() heuristic api.js লোড হওয়ার আগেই চলে, তাই mm-session.js-এর আসল
  // (বেশি নির্ভুল) warm-check-এর সাথে মাঝেমধ্যে ভিন্ন রায় দেয় — সেই মিসম্যাচেই পুরনো/স্টেল
  // কন্টেন্ট মুহূর্তের জন্য ফ্ল্যাশ করত। warm হলে mm-session.js-এর releaseBootCoverIfWarm()
  // প্রায় সাথে সাথেই cover সরিয়ে দেয়, তাই ঝুঁকি নেই।
  if (daftarShell || adminShell || chatFromNav || navPending) {
    armBootCover();
  }
  try { g.sessionStorage.removeItem('mm_nav_loading'); } catch (e3) {}
  try { g.sessionStorage.removeItem('mm_admin_nav_enter'); } catch (e4) {}
})(typeof window !== 'undefined' ? window : this);
