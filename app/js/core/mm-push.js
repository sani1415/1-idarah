/* মাদরাসাতুল মদীনা — mm-push.js
   Web Push subscribe/refresh helper. SW register করে, permission নেয়,
   subscription RPC দিয়ে সংরক্ষণ করে। enablePush() অবশ্যই user gesture
   (বোতাম click) থেকে ডাকতে হবে। */
(function (global) {
  'use strict';

  // VAPID public key (নিরাপদ/public; private key শুধু Edge Function secret-এ)।
  // এই value-টি অবশ্যই Supabase project-এর VAPID_PUBLIC_KEY env-এর সমান হতে হবে,
  // নইলে push পাঠানোর সময় FCM 403 দেয়।
  var VAPID_PUBLIC_KEY = 'BGZXq0n_Pi7CK9sMsslUflJ4Vo1b6lP7xUatroi5uEjSrBKZMEWfzOzK2FZ-vfxIs1KDUY3WhQiMhPmvyEWXwr0';

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function uint8ToBase64Url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // বিদ্যমান subscription বর্তমান VAPID key দিয়েই তৈরি কিনা যাচাই করে।
  // আগে অন্য key দিয়ে subscribe করা থাকলে false → পুনরায় subscribe করাতে হবে।
  function subKeyMatches(sub) {
    try {
      var ask = sub && sub.options && sub.options.applicationServerKey;
      if (!ask) return false;
      return uint8ToBase64Url(ask) === VAPID_PUBLIC_KEY;
    } catch (e) { return false; }
  }

  function supported() {
    return (typeof navigator !== 'undefined') &&
      ('serviceWorker' in navigator) &&
      (typeof window !== 'undefined') &&
      ('PushManager' in window) &&
      ('Notification' in window);
  }

  function permission() {
    return (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
  }

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/sw.js'); }
    catch (e) { return null; }
  }

  async function saveSub(sub) {
    if (!global.MMSharedAPI || !global.MMSession || !MMSession.getChatPin()) return false;
    var json = sub.toJSON();
    if (!json || !json.endpoint || !json.keys) return false;
    try {
      var res = await MMSharedAPI.pushSubscribe(
        MMSession.getChatActorId() || null,
        MMSession.getChatPin(),
        json.endpoint,
        json.keys.p256dh,
        json.keys.auth,
        MMSession.isAdmin(),
        navigator.userAgent
      );
      return !!(res && res.ok);
    } catch (e) { return false; }
  }

  // user gesture থেকে ডাকুন।
  async function enablePush() {
    if (!supported()) return { ok: false, error: 'unsupported' };
    await registerSW();
    var reg = await navigator.serviceWorker.ready;
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'denied' };
    var sub = await reg.pushManager.getSubscription();
    if (sub && !subKeyMatches(sub)) {
      try { await sub.unsubscribe(); } catch (e) {}
      sub = null;
    }
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      } catch (e) { return { ok: false, error: 'subscribe_failed' }; }
    }
    var ok = await saveSub(sub);
    return ok ? { ok: true } : { ok: false, error: 'save_failed' };
  }

  // permission আগে থেকেই granted হলে subscription RPC-তে পুনরায় সংরক্ষণ করে
  // (re-login/refresh-এর পর actor-এর সাথে আবার যুক্ত রাখে)। কোনো prompt দেখায় না।
  async function refreshSub() {
    if (!supported() || permission() !== 'granted') return false;
    await registerSW();
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    // পুরনো/ভুল key দিয়ে subscribe থাকলে সরিয়ে সঠিক key দিয়ে আবার subscribe করি।
    if (sub && !subKeyMatches(sub)) {
      try { await sub.unsubscribe(); } catch (e) {}
      sub = null;
    }
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      } catch (e) { return false; }
    }
    if (sub) return await saveSub(sub);
    return false;
  }

  async function disableForSession(actorId, pin, isAdmin) {
    if (!supported()) return true;
    var reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return true;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    var endpoint = sub.endpoint || '';
    // Server unbind is best-effort; local unsubscribe is the hard logout boundary.
    if (endpoint && global.MMSharedAPI && MMSharedAPI.pushUnsubscribe && pin) {
      try { await MMSharedAPI.pushUnsubscribe(actorId || null, pin, endpoint, !!isAdmin); } catch (e) {}
    }
    try { await sub.unsubscribe(); } catch (e2) {}
    return true;
  }

  async function refreshCurrentSession() {
    if (!global.MMSession || !MMSession.getRole || !MMSession.getRole()) return false;
    return refreshSub();
  }

  function scheduleSessionRefresh() {
    if (permission() !== 'granted') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshCurrentSession, { once: true });
    } else {
      setTimeout(refreshCurrentSession, 0);
    }
  }

  global.MMPush = {
    supported: supported,
    permission: permission,
    registerSW: registerSW,
    enablePush: enablePush,
    refreshSub: refreshSub,
    disableForSession: disableForSession
  };
  scheduleSessionRefresh();
})(window);
