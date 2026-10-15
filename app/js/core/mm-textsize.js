/**
 * বড় লেখা — এই ডিভাইসের জন্য পছন্দ (সাধারণ / বড় / আরও বড়)।
 * <head>-এ সিঙ্ক লোড: প্রথম পেইন্টের আগেই html-এ class বসে, তাই লেখা লাফ দেয় না।
 * উপরের বারে (.topbar-actions) «অ» বোতাম বসায়; চাপলে মাপ পাল্টায়। CSS: style.css → "বড় লেখা"।
 * শুধু দেখার সুবিধা (per-device), কোনো ডেটা নয়।
 */
(function (g) {
  'use strict';
  var KEY = 'mm_text_size';
  var CLASSES = ['', 'mm-text-lg', 'mm-text-xl'];
  var LABELS = ['সাধারণ লেখা', 'বড় লেখা', 'আরও বড় লেখা'];
  var root = g.document && g.document.documentElement;
  if (!root) return;

  function read() {
    try { var v = parseInt(g.localStorage.getItem(KEY), 10); return v === 1 || v === 2 ? v : 0; } catch (e) { return 0; }
  }
  function apply(level) {
    CLASSES.forEach(function (c) { if (c) root.classList.remove(c); });
    if (CLASSES[level]) root.classList.add(CLASSES[level]);
  }
  apply(read());

  function toast(msg) {
    if (typeof g.showToast === 'function') { g.showToast(msg); return; }
    var t = g.document.createElement('div');
    t.className = 'mm-ts-toast';
    t.textContent = msg;
    g.document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1600);
  }

  function cycle() {
    var next = (read() + 1) % 3;
    try { if (next) g.localStorage.setItem(KEY, String(next)); else g.localStorage.removeItem(KEY); } catch (e) {}
    apply(next);
    syncButtons();
    toast(LABELS[next]);
  }

  function syncButtons() {
    var lv = read();
    var bs = g.document.querySelectorAll('.mm-ts-btn');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('data-level', String(lv));
      bs[i].title = 'লেখার মাপ: ' + LABELS[lv] + ' (চাপলে বদলাবে)';
      bs[i].setAttribute('aria-label', bs[i].title);
    }
  }

  function mountButton() {
    var bars = g.document.querySelectorAll('.topbar-actions');
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].querySelector('.mm-ts-btn')) continue;
      var b = g.document.createElement('button');
      b.type = 'button';
      b.className = 'topbar-btn topbar-btn--icon mm-ts-btn';
      b.innerHTML = '<span aria-hidden="true">অ</span>';
      b.addEventListener('click', cycle);
      bars[i].insertBefore(b, bars[i].firstChild);
    }
    syncButtons();
  }

  if (g.document.readyState === 'loading') g.document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();

  g.MMTextSize = { get: read, cycle: cycle };
})(window);
