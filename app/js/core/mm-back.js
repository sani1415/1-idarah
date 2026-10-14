/**
 * অ্যাপের (installed/standalone) Android Back বোতাম:
 *  1. কোনো modal/sheet খোলা থাকলে আগে সেটি বন্ধ হয়।
 *  2. পেজ চাইলে নিজের কাজ করতে পারে — window.MMBackHandler() true ফেরত দিলে এখানে আর কিছু হয় না
 *     (যেমন বার্তায় খোলা কথোপকথন থেকে তালিকায় ফেরা)।
 *  3. নিচের/পাশের মেনুর প্রথম আইটেম (হোম/মাদ্রাসা) ছাড়া অন্য মেনুতে থাকলে → প্রথম আইটেমে ফেরে।
 *  4. প্রথম আইটেমে থাকলে → «অ্যাপ বন্ধ করবেন?» জিজ্ঞাসা; তখন আবার Back চাপলে অ্যাপ বন্ধ হয়।
 * মেনু নেই এমন পেজে (বিস্তারিত/সাব-পেজ) Back আগের মতোই আগের পেজে নেয়।
 * ব্রাউজারের সাধারণ ট্যাবে কিছু বদলায় না — শুধু হোম-স্ক্রিন অ্যাপে চলে।
 */
(function (g) {
  'use strict';
  var doc = g.document;
  if (!doc || !g.history || !g.history.pushState) return;

  function isStandalone() {
    try {
      if (g.navigator && g.navigator.standalone) return true;
      if (!g.matchMedia) return false;
      return g.matchMedia('(display-mode: standalone)').matches ||
        g.matchMedia('(display-mode: fullscreen)').matches ||
        g.matchMedia('(display-mode: minimal-ui)').matches;
    } catch (e) { return false; }
  }
  if (!isStandalone()) return;

  var GUARD = 'mmBackGuard';
  var NAV_SEL = '.main-nav, .bottom-nav';
  var ITEM_SEL = '.main-nav-btn, .nav-item';
  var HREF_RE = /(?:location\.(?:href\s*=|replace\(|assign\()|MMNav\.go\(|\.go\()\s*['"]([^'"]+\.html(?:[?#][^'"]*)?)['"]/;
  var OPEN_SEL = '.modal-bg.open, .cls-overlay.is-open, .kh-overlay.is-open, .hz-sheet-bg.is-open';
  var guarded = false;
  var exitBox = null;

  function shown(el) {
    if (!el || el.hidden) return false;
    var cs = g.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function visibleNav() {
    var navs = doc.querySelectorAll(NAV_SEL);
    for (var i = 0; i < navs.length; i++) {
      if (shown(navs[i]) && navs[i].querySelector(ITEM_SEL)) return navs[i];
    }
    return null;
  }

  function navItems(nav) {
    return Array.prototype.filter.call(nav.querySelectorAll(ITEM_SEL), shown);
  }

  function isActive(el) {
    return el.classList.contains('is-active') || el.classList.contains('active') ||
      el.getAttribute('aria-current') === 'page';
  }

  function itemUrl(el) {
    var raw = el.getAttribute('href');
    if (!raw) {
      var m = HREF_RE.exec(el.getAttribute('onclick') || '');
      raw = m ? m[1] : '';
    }
    if (!raw) return null;
    try { return new URL(raw, g.location.href); } catch (e) { return null; }
  }

  /* মেনুর অবস্থা: home = প্রথম আইটেম; active = বর্তমান আইটেম (না থাকলে null) */
  function navState() {
    var nav = visibleNav();
    if (!nav) return null;
    var items = navItems(nav);
    if (!items.length) return null;
    var active = null;
    for (var i = 0; i < items.length; i++) if (isActive(items[i])) { active = items[i]; break; }
    return { home: items[0], active: active };
  }

  function pushGuard() {
    if (g.history.state && g.history.state[GUARD]) { guarded = true; return; }
    var st = {};
    st[GUARD] = 1;
    try { g.history.pushState(st, '', g.location.href); guarded = true; } catch (e) {}
  }

  function closeTopOverlay() {
    var open = doc.querySelectorAll(OPEN_SEL);
    if (!open.length) return false;
    var top = open[open.length - 1];
    var btn = top.querySelector('.modal-close, [data-close], .sheet-close');
    if (btn) btn.click();
    if (top.matches(OPEN_SEL)) top.classList.remove('open', 'is-open');
    return true;
  }

  /* আগের কোনো history entry হোম পেজের হলে সেখানেই ফেরা — নতুন entry জমে না, তাই হোম থেকে
     আবার Back চাপলে অ্যাপ বন্ধ হতে পারে। না পেলে মেনুর প্রথম আইটেমে চাপ দেওয়া। */
  function goHome(st) {
    var url = itemUrl(st.home);
    var nav = g.navigation;
    if (url && nav && nav.entries && nav.currentEntry) {
      var entries = nav.entries();
      var cur = nav.currentEntry.index;
      for (var i = cur - 1; i >= 0; i--) {
        var e = entries[i];
        var u;
        try { u = new URL(e.url); } catch (err) { continue; }
        if (u.pathname === url.pathname && u.search === url.search) {
          nav.traverseTo(e.key);
          return;
        }
      }
    }
    st.home.click();
  }

  function hideExit() {
    if (exitBox) exitBox.classList.remove('open');
  }

  function showExit() {
    if (!exitBox) {
      exitBox = doc.createElement('div');
      exitBox.className = 'modal-bg';
      exitBox.id = 'mm-exit-confirm';
      exitBox.style.zIndex = '10050';
      exitBox.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mm-exit-title" style="max-width:340px;text-align:center;">' +
          '<div id="mm-exit-title" style="font-family:\'Tiro Bangla\',serif;font-size:17px;font-weight:700;color:var(--ink,#1a1208);margin-bottom:6px;">অ্যাপ বন্ধ করবেন?</div>' +
          '<div style="font-size:12px;color:var(--ink3,#7a6a55);line-height:1.6;margin-bottom:16px;">বন্ধ করতে আবার Back চাপুন, অথবা নিচের বোতাম।</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<button type="button" data-act="stay" style="flex:1;padding:11px;border-radius:12px;border:1px solid rgba(26,18,8,.14);background:#fff;font-family:inherit;font-size:14px;cursor:pointer;">থাকুন</button>' +
            '<button type="button" data-act="exit" style="flex:1;padding:11px;border-radius:12px;border:none;background:#1a1208;color:#f3d785;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;">বন্ধ করুন</button>' +
          '</div>' +
        '</div>';
      exitBox.addEventListener('click', function (e) {
        var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'exit') {
          try { g.close(); } catch (err) {}
          // ব্রাউজার close আটকালে: guard নেই, তাই পরের Back-এই অ্যাপ বন্ধ হবে
          setTimeout(function () {
            var hint = exitBox.querySelector('#mm-exit-title');
            if (hint) hint.textContent = 'এখন Back চাপুন';
          }, 250);
          return;
        }
        if (act === 'stay' || e.target === exitBox) {
          hideExit();
          pushGuard();
        }
      });
      doc.body.appendChild(exitBox);
    }
    var t = exitBox.querySelector('#mm-exit-title');
    if (t) t.textContent = 'অ্যাপ বন্ধ করবেন?';
    exitBox.classList.add('open');
  }

  function onBack() {
    // guard সরে গেছে — এখন আমরা ঠিক করব কী হবে
    guarded = false;
    if (exitBox && exitBox.classList.contains('open')) { hideExit(); pushGuard(); return; }
    if (closeTopOverlay()) { pushGuard(); return; }
    if (typeof g.MMBackHandler === 'function') {
      var handled = false;
      try { handled = g.MMBackHandler() === true; } catch (e) {}
      if (handled) { pushGuard(); return; }
    }
    var st = navState();
    if (!st || !st.active) { g.history.back(); return; }
    if (st.active !== st.home) {
      pushGuard();
      goHome(st);
      return;
    }
    showExit();
  }

  g.addEventListener('popstate', function (e) {
    if (e.state && e.state[GUARD]) { guarded = true; return; }
    if (!guarded) return;
    onBack();
  });

  function init() {
    // মেনু কিছু পেজে পরে আঁকা হয় (chat, daftar) — একটু অপেক্ষা করে দেখা
    setTimeout(function () {
      if (navState()) pushGuard();
    }, 400);
  }
  g.addEventListener('pageshow', function (e) {
    if (e.persisted) { guarded = !!(g.history.state && g.history.state[GUARD]); hideExit(); if (!guarded && navState()) pushGuard(); }
  });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
