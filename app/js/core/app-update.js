/* Automatic frontend release update check. */
(function () {
  var CHECK_INTERVAL_MS = 5 * 60 * 1000;
  var STORAGE_KEY = 'mm_app_seen_version';
  var RELOAD_KEY = 'mm_app_reload_for_version';

  function getCurrentVersion() {
    var script = document.currentScript;
    if (script && script.src) {
      try {
        return new URL(script.src, location.href).searchParams.get('v') || '';
      } catch (e) {}
    }
    return (window.MM_APP_VERSION && String(window.MM_APP_VERSION)) || '';
  }

  function getManifestUrl() {
    var script = document.currentScript;
    if (script && script.src) {
      try {
        return new URL('/app-version.json', script.src).toString();
      } catch (e) {}
    }
    return new URL('/app-version.json', location.origin).toString();
  }

  var currentVersion = getCurrentVersion();
  var manifestUrl = getManifestUrl();
  var checkInFlight = false;

  function readStorage(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) {}
  }

  function clearReloadFlagIfCurrent() {
    if (!currentVersion) return;
    if (readSession(RELOAD_KEY).split('|')[0] === currentVersion) {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
    }
  }

  /* ইনস্টল করা অ্যাপে sessionStorage দিনের পর দিন থাকে — তাই «একবারই» নয়, একই সংস্করণে ২ মিনিটে একবার (লুপ ঠেকাতে) */
  function recentlyTried(version) {
    var raw = readSession(RELOAD_KEY);
    if (!raw) return false;
    var parts = raw.split('|');
    return parts[0] === version && Date.now() - (Number(parts[1]) || 0) < 2 * 60 * 1000;
  }

  /* কেউ কিছু লিখছেন / খোলা ফর্মে আছেন — তখন হঠাৎ রিফ্রেশ নয়, বোতাম দেখাও */
  function isBusy() {
    try {
      if (typeof window.MMAppBusy === 'function' && window.MMAppBusy()) return true;
      var a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
      if (document.querySelector('.modal-bg.open, .cls-overlay.is-open, .kh-overlay.is-open, .mmc-bg')) return true;
    } catch (e) {}
    return false;
  }

  function goReload(version) {
    writeSession(RELOAD_KEY, version + '|' + Date.now());
    var next = new URL(location.href);
    next.searchParams.set('_mmv', version);
    location.replace(next.toString());
  }

  function showBar(version, busy) {
    var bar = document.getElementById('mm-update-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mm-update-bar';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:10070;' +
        'display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:9px 10px 9px 14px;border-radius:999px;' +
        'background:rgba(42,35,24,.94);color:#fff;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:inherit;white-space:nowrap';
      document.body.appendChild(bar);
    }
    if (busy) {
      bar.innerHTML = '<span>নতুন সংস্করণ এসেছে</span>' +
        '<button type="button" style="border:none;border-radius:999px;padding:6px 12px;font:inherit;font-weight:700;background:#b5573a;color:#fff;cursor:pointer">হালনাগাদ করুন</button>';
      bar.querySelector('button').onclick = function () { goReload(version); };
    } else {
      bar.innerHTML = '<span>নতুন সংস্করণ — হালনাগাদ হচ্ছে…</span>';
    }
  }

  function reloadWithVersion(version) {
    if (!version || recentlyTried(version)) return;
    if (isBusy()) { showBar(version, true); return; }
    showBar(version, false);
    setTimeout(function () { goReload(version); }, 900);
  }

  async function checkForUpdate() {
    if (checkInFlight) return;
    checkInFlight = true;
    try {
      var url = new URL(manifestUrl);
      url.searchParams.set('t', String(Date.now()));
      var res = await fetch(url.toString(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;
      var manifest = await res.json();
      var remoteVersion = manifest && manifest.version ? String(manifest.version) : '';
      if (!remoteVersion) return;
      var seenVersion = readStorage(STORAGE_KEY);
      if (!seenVersion) writeStorage(STORAGE_KEY, remoteVersion);
      if (currentVersion && remoteVersion !== currentVersion) {
        writeStorage(STORAGE_KEY, remoteVersion);
        reloadWithVersion(remoteVersion);
      } else if (currentVersion) {
        writeStorage(STORAGE_KEY, currentVersion);
      }
    } catch (e) {
      if (window.console && console.debug) console.debug('[app-update] version check skipped', e);
    } finally {
      checkInFlight = false;
    }
  }

  clearReloadFlagIfCurrent();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdate, { once: true });
  } else {
    setTimeout(checkForUpdate, 0);
  }
  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('pageshow', function (e) { if (e.persisted) checkForUpdate(); });
  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkForUpdate();
  });
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
})();
