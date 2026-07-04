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
      'html.mm-app-boot:not(.mm-app-ready) body>:not(#mm-app-load-screen){visibility:hidden!important}';
    var head = g.document.head || g.document.getElementsByTagName('head')[0];
    if (head) head.insertBefore(st, head.firstChild);
  }

  function armBootCover() {
    g.document.documentElement.classList.add('mm-app-boot');
    g.document.documentElement.classList.remove('mm-app-ready');
    injectBootCriticalCss();
  }

  var path = (g.location.pathname || '').replace(/\\/g, '/');
  var daftarShell = /(?:^|\/)(madrasa-home|madrasa-daftar|madrasa-yearend|madrasa-kormosuchi)\.html$/i.test(path);
  // অ্যাডমিন শেল পেজ — login/nav-এর পর dashboard ফ্ল্যাশ এড়াতে cold লোডে cover।
  var adminShell = /(?:^|\/)admin\/(?:madrasa|khedmat|dept|recent)\.html$/i.test(path) ||
    /\/madrasa\/admin\/accounts\.html$/i.test(path);
  var navPending = false;
  try {
    navPending = g.sessionStorage.getItem('mm_nav_loading') === '1';
  } catch (e) {}
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
})(typeof window !== 'undefined' ? window : this);
