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

  // নেভের পরে sync লোড হলে প্রথম paint-এর আগেই layout ঠিক হয়ে যায়
  if (document.body) update();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
