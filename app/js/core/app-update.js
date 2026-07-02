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
    if (readSession(RELOAD_KEY) === currentVersion) {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
    }
  }

  function reloadWithVersion(version) {
    if (!version || readSession(RELOAD_KEY) === version) return;
    writeSession(RELOAD_KEY, version);
    var next = new URL(location.href);
    next.searchParams.set('_mmv', version);
    location.replace(next.toString());
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
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkForUpdate();
  });
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
})();
