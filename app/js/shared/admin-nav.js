/**
 * জিম্মাদার নেভ — স্লাইডিং পিল ইন্ডিকেটর
 * .main-nav-এ স্বয়ংক্রিয়ভাবে কাজ করে।
 */
(function () {
  'use strict';

  var NAVIGATION_COMMIT_DELAY = 72;

  function init() {
    var nav = document.querySelector('.main-nav');
    if (!nav || nav.querySelector('.main-nav-pill')) return;
    var navigating = false;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.remove('mm-admin-page-entering');
      });
    });

    var pill = document.createElement('span');
    pill.className = 'main-nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.insertBefore(pill, nav.firstChild);

    var active = nav.querySelector('.main-nav-btn.is-active');
    if (active) {
      active.setAttribute('aria-current', 'page');
      place(pill, active);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          nav.classList.add('pill-active');
        });
      });
    }

    nav.querySelectorAll('.main-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var href = btn.getAttribute('href');
        var target = btn.getAttribute('target');
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
            target === '_blank' || btn.hasAttribute('download')) return;
        if (!href || btn.classList.contains('is-active') || navigating) return;
        e.preventDefault();
        giveNativeTapFeedback();
        navigating = true;
        nav.classList.add('is-navigating');
        var prev = nav.querySelector('.is-active');
        if (prev) {
          prev.classList.remove('is-active');
          prev.removeAttribute('aria-current');
        }
        btn.classList.add('is-active');
        btn.setAttribute('aria-current', 'page');
        place(pill, btn);
        document.documentElement.classList.add('mm-admin-nav-committing');
        try { sessionStorage.setItem('mm_admin_nav_enter', '1'); } catch (e2) {}
        requestAnimationFrame(function () {
          prepareNavCover();
          setTimeout(function () {
            location.replace(href);
          }, prefersReducedMotion() ? 0 : NAVIGATION_COMMIT_DELAY);
        });
      });
    });

    var reposition = function () {
      var current = nav.querySelector('.main-nav-btn.is-active');
      if (current) place(pill, current);
    };
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('pageshow', function () {
      navigating = false;
      nav.classList.remove('is-navigating');
      document.documentElement.classList.remove('mm-admin-nav-committing');
      reposition();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(reposition).observe(nav);
    }
  }

  function isWarm() {
    return !!(window.MMSession && MMSession.isAppDataWarm && MMSession.isAppDataWarm());
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function giveNativeTapFeedback() {
    try {
      var cap = window.Capacitor;
      if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() &&
          navigator.vibrate) {
        navigator.vibrate(8);
      }
    } catch (e) {}
  }

  function prepareNavCover() {
    if (isWarm()) return;
    try { sessionStorage.setItem('mm_nav_loading', '1'); } catch (e) {}
  }

  function place(pill, btn) {
    if (!pill || !btn || !btn.getClientRects().length) return;
    var nr = pill.parentElement.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    pill.style.transform = 'translate3d(' + (br.left - nr.left) + 'px,' + (br.top - nr.top) + 'px,0)';
    pill.style.width  = br.width             + 'px';
    pill.style.height = br.height            + 'px';
  }

  /* permission-check শেষ হওয়ার পরে run করতে rAF ব্যবহার */
  if (document.readyState !== 'loading') {
    requestAnimationFrame(init);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(init);
    });
  }
})();
