/**
 * ডেস্কটপ শেল — বড় স্ক্রিনে (≥ 1024px) নিচের পিল নেভকে বাঁ পাশের sidebar বানায়।
 * মোবাইলে কিছুই বদলায় না; সব layout CSS-এ (style.css → "DESKTOP APP SHELL")।
 * এখানে শুধু: দৃশ্যমান নেভ আছে কিনা দেখে html-এ class দেওয়া আর sidebar-এ brand বসানো।
 */
(function () {
  'use strict';

  var MQ = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
  var NAV_SELECTOR = '.main-nav, .bottom-nav';

  function visibleNav() {
    var navs = document.querySelectorAll(NAV_SELECTOR);
    for (var i = 0; i < navs.length; i++) {
      var n = navs[i];
      if (n.hidden) continue;
      if (getComputedStyle(n).display === 'none') continue;
      if (!n.children.length) continue;
      return n;
    }
    return null;
  }

  function ensureBrand(nav) {
    if (nav.querySelector('.mm-sb-brand')) return;
    var root = document.querySelector('script[src*="js/core/mm-shell.js"]');
    var src = root ? root.getAttribute('src') : '';
    var base = src.replace(/js\/core\/mm-shell\.js.*$/, '');
    var brand = document.createElement('a');
    brand.className = 'mm-sb-brand';
    brand.setAttribute('aria-hidden', 'true');
    brand.tabIndex = -1;
    var first = nav.querySelector('.main-nav-btn, .nav-item');
    var firstHref = first && first.getAttribute('href');
    if (firstHref) brand.href = firstHref;
    var img = document.createElement('img');
    img.className = 'mm-sb-logo';
    img.src = base + 'icons/icon.svg';
    img.alt = '';
    var text = document.createElement('span');
    text.className = 'mm-sb-text';
    var ar = document.createElement('span');
    ar.className = 'mm-sb-ar';
    ar.textContent = 'مدرسة المدينة';
    var bn = document.createElement('span');
    bn.className = 'mm-sb-bn';
    bn.textContent = 'মাদরাসাতুল মদীনা';
    text.appendChild(ar);
    text.appendChild(bn);
    brand.appendChild(img);
    brand.appendChild(text);
    nav.insertBefore(brand, nav.firstChild);
  }

  function update() {
    var html = document.documentElement;
    var nav = MQ && MQ.matches ? visibleNav() : null;
    if (nav) {
      ensureBrand(nav);
      html.classList.add('mm-desk-shell');
    } else {
      html.classList.remove('mm-desk-shell');
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      update();
    });
  }

  function init() {
    update();
    if (MQ) {
      if (MQ.addEventListener) MQ.addEventListener('change', schedule);
      else if (MQ.addListener) MQ.addListener(schedule);
    }
    // কিছু পেজ নেভ পরে বানায় বা দেখায়/লুকায় (chat, daftar-bottom-nav.js)
    if (window.MutationObserver) {
      var navs = document.querySelectorAll(NAV_SELECTOR);
      var mo = new MutationObserver(schedule);
      for (var i = 0; i < navs.length; i++) {
        mo.observe(navs[i], { attributes: true, attributeFilter: ['style', 'hidden', 'class'], childList: true });
      }
    }
  }

  /*
   * মেনু বদল দ্রুত করা — ব্যবহারকারী লিংকে আঙুল/মাউস রাখলেই পরের পেজের HTML আগেভাগে আনা
   * (Speculation Rules prefetch)। JS/CSS আগে থেকেই cache-এ থাকে, তাই ক্লিকে শুধু HTML-এর
   * অপেক্ষা থাকে — সেটাও এখানে আগেই চলে আসে। শুধু prefetch (prerender নয়), তাই পরের পেজের
   * কোনো JS/RPC আগে চলে না। যে ব্রাউজার সমর্থন করে না সেখানে কিছুই হয় না।
   */
  var NAV_HREF_RE = /location\.(?:href\s*=|replace\(|assign\()\s*['"]([^'"]+\.html(?:[?#][^'"]*)?)['"]/;
  var prefetched = {};

  function canSpeculate() {
    return !!(window.HTMLScriptElement && HTMLScriptElement.supports &&
      HTMLScriptElement.supports('speculationrules'));
  }

  function addRules(rules) {
    var s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify(rules);
    (document.head || document.documentElement).appendChild(s);
  }

  // <div onclick="location.href='x.html'"> ধরনের নেভ আইটেম — document rule এগুলো চেনে না
  function prefetchFromElement(target) {
    var el = target && target.closest && target.closest('[onclick]');
    if (!el) return;
    var m = NAV_HREF_RE.exec(el.getAttribute('onclick') || '');
    if (!m) return;
    var url;
    try { url = new URL(m[1], location.href); } catch (e) { return; }
    if (url.origin !== location.origin || url.pathname === location.pathname) return;
    var key = url.pathname + url.search;
    if (prefetched[key]) return;
    prefetched[key] = true;
    addRules({ prefetch: [{ source: 'list', urls: [key] }] });
  }

  function initPrefetch() {
    if (!canSpeculate()) return;
    addRules({
      prefetch: [{
        source: 'document',
        where: { and: [
          { href_matches: '/*.html' },
          { not: { selector_matches: '[download], [target="_blank"], [data-no-prefetch]' } }
        ] },
        eagerness: 'moderate'
      }]
    });
    var onIntent = function (e) { prefetchFromElement(e.target); };
    document.addEventListener('pointerdown', onIntent, { passive: true, capture: true });
    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      clearTimeout(onIntent.t);
      onIntent.t = setTimeout(function () { prefetchFromElement(t); }, 120);
    }, { passive: true });
  }

  // নেভের পরে sync লোড হলে প্রথম paint-এর আগেই layout ঠিক হয়ে যায়
  if (document.body) update();
  try { initPrefetch(); } catch (ePrefetch) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
