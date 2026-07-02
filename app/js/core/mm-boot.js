/**
 * <head>-এ সিঙ্ক লোড — শুধু প্রথম (কোল্ড) লোডে কন্টেন্ট লুকায়; ক্যাশ ওয়ার্ম নেভে ফ্ল্যাশ এড়ায়।
 */
(function (g) {
  'use strict';
  if (!g.document || !g.document.documentElement) return;

  function sessionActorKeyForCache() {
    try {
      var role = g.sessionStorage.getItem('mm_role') || '';
      if (role === 'admin') {
        return 'admin:' + String(g.sessionStorage.getItem('mm_admin_user_id') || '') + ':' +
          String(g.sessionStorage.getItem('mm_admin_pin') || '');
      }
      return role + ':' + String(g.sessionStorage.getItem('mm_staff_user_id') || '') + ':' +
        String(g.sessionStorage.getItem('mm_teacher_id') || '') + ':' + String(g.sessionStorage.getItem('mm_dept_id') || '');
    } catch (e) {
      return '';
    }
  }

  function isSessionDataWarm() {
    if (g.MMIsAppSessionCacheWarm) return g.MMIsAppSessionCacheWarm();
    try {
      var actor = sessionActorKeyForCache();
      if (!actor) return false;
      var meta = JSON.parse(g.sessionStorage.getItem('mm_data_cache_meta') || 'null');
      if (!meta || meta.v !== 1 || meta.actor !== actor) return false;
      var students = JSON.parse(g.sessionStorage.getItem('mm_sc_mm_students') || '[]');
      var classes = JSON.parse(g.sessionStorage.getItem('mm_sc_mm_classes') || '[]');
      if (!Array.isArray(students) || !students.length || !Array.isArray(classes) || !classes.length) return false;
      var role = g.sessionStorage.getItem('mm_role') || '';
      if (role !== 'admin') {
        if (meta && meta.daftar_boot) return true;
        if (g.sessionStorage.getItem('mm_sc_mm_attendance') == null &&
            g.sessionStorage.getItem('mm_absent_summary_v1') == null) return false;
      }
      return true;
    } catch (e2) {
      return false;
    }
  }

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
  var warm = isSessionDataWarm();

  // cold (ওয়ার্ম নয়) লোডে cover: শেল পেজ, অথবা nav থেকে এলে (navPending) —
  // যাতে নতুন পেজ প্রথম পেইন্ট থেকেই লোডিং দেখায়, পুরনো content ফ্ল্যাশ না করে।
  if (!warm && (daftarShell || adminShell || chatFromNav || navPending)) {
    armBootCover();
  }
  try { g.sessionStorage.removeItem('mm_nav_loading'); } catch (e3) {}
})(typeof window !== 'undefined' ? window : this);
