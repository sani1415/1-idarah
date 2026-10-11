/**
 * দফতর দায়িত্বশীলের নিচের নেভ — একই মেনু সব জায়গায় (মাদ্রাসা শেল + chat.html স্টাফ নেভ)।
 */
(function (global) {
  'use strict';

  var ICON = {
    madrasa:
      '<path d="M3 10.5L12 3l9 7 9 7v11a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    attendance:
      '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    accounts:
      '<path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    program:
      '<path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    year:
      '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    chat:
      '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function iconSpan(key) {
    return '<span class="nav-icon" aria-hidden="true"><svg class="nav-svg" viewBox="0 0 24 24" fill="none">' + ICON[key] + '</svg></span>';
  }

  function lbl(text) {
    return '<span class="nav-label">' + esc(text) + '</span>';
  }

  function isNavDataWarm() {
    if (global.MMSession && MMSession.isAppDataWarm) return MMSession.isAppDataWarm();
    if (global.API && API.isSessionCacheWarm) return API.isSessionCacheWarm();
    if (global.MMIsAppSessionCacheWarm) return global.MMIsAppSessionCacheWarm();
    return false;
  }

  function showNavLoading() {
    if (isNavDataWarm()) return;
    try { sessionStorage.setItem('mm_nav_loading', '1'); } catch (e) {}
    if (global.MMLoading && MMLoading.show) MMLoading.show();
  }

  function isSpaNavItem(item) {
    var oc = item.getAttribute('onclick') || '';
    return /switchMadrasaTab|goDaftarAccounts/.test(oc);
  }

  function bindNavLoading(navEl) {
    if (!navEl || navEl.getAttribute('data-mm-nav-load-bound')) return;
    navEl.setAttribute('data-mm-nav-load-bound', '1');
    navEl.addEventListener(
      'click',
      function (e) {
        var item = e.target.closest('.nav-item, a.nav-item');
        if (!item || item.classList.contains('active')) return;
        if (item.getAttribute('data-gate-allow') === '1') return;
        if (global.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.blockNavigation) {
          var blockHref = item.getAttribute('href') || '';
          if (!blockHref && isSpaNavItem(item)) {
            var oc = item.getAttribute('onclick') || '';
            if (/goDaftarAccounts/.test(oc)) blockHref = '#accounts';
            else if (/switchMadrasaTab/.test(oc)) blockHref = 'madrasa-daftar.html';
          }
          if (MDRDaftarAttendanceGate.blockNavigation(blockHref)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        if (isSpaNavItem(item)) return;
        if (isNavDataWarm()) return;
        showNavLoading();
      },
      true
    );
  }

  function linkRow(href, iconKey, labelText, isActive, useAnchor) {
    var inner = iconSpan(iconKey) + lbl(labelText);
    var cls = 'nav-item' + (isActive ? ' active' : '');
    var aria = isActive ? ' aria-current="page"' : '';
    if (useAnchor) return '<a class="' + cls + '" href="' + esc(href) + '"' + aria + '>' + inner + '</a>';
    return (
      '<div class="' +
      cls +
      '"' +
      aria +
      ' onclick="MMDaftarBottomNav.go(\'' +
      esc(href).replace(/\\/g, '\\\\').replace(/'/g, "\\'") +
      '\')">' +
      inner +
      '</div>'
    );
  }

  function go(href) {
    if (!href) return;
    if (global.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.blockNavigation &&
        MDRDaftarAttendanceGate.blockNavigation(href)) return;
    if (!isNavDataWarm()) showNavLoading();
    if (global.MMNav && MMNav.go) MMNav.go(href);
    else location.href = href;
  }

  /**
   * @param {object} o
   * @param {string} [o.active] — madrasa | daftar | accounts | yearend | chat
   * @param {string} [o.pathPrefix] — '' (madrasa/), 'madrasa/' (repo root থেকে chat ইত্যাদি)
   * @param {boolean} [o.spaDaftar] — madrasa-daftar.html: হাজিরা/হিসাব SPA অন ক্লিক
   * @param {boolean} [o.useAnchor] — true হলে <a href> (ডিফল্ট false)
   * @param {boolean} [o.omitChat] — chat স্লট আলাদা দেখালে true (chat.html স্টাফ নেভ)
   * @param {string} [o.chatHref] — ডিফল্ট ../chat.html
   */
  function shellInnerHtml(o) {
    o = o || {};
    var active = o.active || 'madrasa';
    var prefix = o.pathPrefix == null ? '' : o.pathPrefix;
    var spa = !!o.spaDaftar;
    var useA = !!o.useAnchor;
    var omitChat = !!o.omitChat;
    var chatHref = o.chatHref != null ? o.chatHref : '../chat.html';

    function p(file) {
      return prefix + file;
    }

    var rows = [];

    rows.push(linkRow(p('madrasa-home.html'), 'madrasa', 'মাদ্রাসা', active === 'madrasa', useA));

    if (spa) {
      rows.push(
        '<div class="nav-item' +
          (active === 'daftar' ? ' active' : '') +
          '" id="nav-madrasa" onclick="switchMadrasaTab(\'home\')">' +
          iconSpan('attendance') +
          lbl('হাজিরা') +
          '</div>'
      );
      rows.push(
        '<div class="nav-item' +
          (active === 'accounts' ? ' active' : '') +
          '" id="nav-fees" onclick="goDaftarAccounts()">' +
          iconSpan('accounts') +
          lbl('হিসাব') +
          '</div>'
      );
    } else {
      rows.push(linkRow(p('madrasa-daftar.html'), 'attendance', 'হাজিরা', active === 'daftar', useA));
      rows.push(linkRow(p('madrasa-daftar.html#accounts'), 'accounts', 'হিসাব', active === 'accounts', useA));
    }

    rows.push(linkRow(p('madrasa-yearend.html'), 'year', 'বর্ষ', active === 'yearend', useA));

    if (!omitChat) rows.push(linkRow(chatHref, 'chat', 'বার্তা', active === 'chat', useA));

    return rows.join('');
  }

  function mount(navEl, options) {
    if (!navEl) return;
    navEl.innerHTML = shellInnerHtml(options || {});
    bindNavLoading(navEl);
  }

  global.MMDaftarBottomNav = {
    shellInnerHtml: shellInnerHtml,
    mount: mount,
    go: go,
    showNavLoading: showNavLoading,
  };
})(typeof window !== 'undefined' ? window : this);
