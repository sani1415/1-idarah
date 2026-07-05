/**
 * বর্ষ দায়িত্বশীল — বাকি দায়িত্ব (কিতাব/খুলুক/লগ) শেষ না হলে
 * শুধু সংশ্লিষ্ট ট্যাব/মোডাল; বাকি সব বন্ধ।
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'mm-class-duty-gate-css';
  var BANNER_ID = 'mm-class-duty-gate-banner';
  var lastNotifyAt = 0;
  var hooks = {
    getClassId: function () { return null; },
    notify: null,
    forceSwitchTab: null,
    openDutyPanel: null,
  };

  function isTeacherUser() {
    return !!(global.MMSession && MMSession.getRole && MMSession.getRole() === 'teacher');
  }

  function toBn(n) {
    if (global.API && API.toBn) return API.toBn(n);
    return String(n).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[Number(d)]; });
  }

  function notify(msg) {
    var now = Date.now();
    if (now - lastNotifyAt < 2200) return;
    lastNotifyAt = now;
    if (typeof hooks.notify === 'function') {
      hooks.notify(msg);
      return;
    }
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function computeDuty() {
    var classId = hooks.getClassId();
    if (!classId || !global.MDRClassDutyAlerts) {
      return { ok: true, items: [], overdueCount: 0, pending: {} };
    }
    var result = MDRClassDutyAlerts.computeClassDutyAlerts(classId);
    var pending = { kitab: false, khuluk: false, log: false };
    (result.items || []).forEach(function (item) {
      if (item.id === 'kitab') pending.kitab = true;
      if (item.id === 'khuluk') pending.khuluk = true;
      if (item.id === 'class-log') pending.log = true;
    });
    return {
      ok: !!result.ok,
      items: result.items || [],
      overdueCount: result.overdueCount || 0,
      pending: pending,
    };
  }

  function getDutyState() {
    if (!isTeacherUser()) return { active: false, pending: {}, overdueCount: 0 };
    var result = computeDuty();
    return {
      active: !result.ok && result.overdueCount > 0,
      pending: result.pending,
      overdueCount: result.overdueCount,
      items: result.items,
    };
  }

  function isGateActive() {
    return getDutyState().active;
  }

  function allowedTabs(pending) {
    var tabs = [];
    if (pending.khuluk) tabs.push('std');
    if (pending.kitab) tabs.push('kitab');
    if (pending.log) tabs.push('log');
    return tabs;
  }

  function currentTab() {
    if (global.document.getElementById('panel-kitab') &&
      global.document.getElementById('panel-kitab').style.display !== 'none') return 'kitab';
    if (global.document.getElementById('panel-log') &&
      global.document.getElementById('panel-log').style.display !== 'none') return 'log';
    return 'std';
  }

  function injectStyles() {
    if (!global.document || global.document.getElementById(STYLE_ID)) return;
    var st = global.document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      'body.mm-class-duty-gate-active .bottom-nav .nav-item:not([data-gate-allow="1"]){opacity:.4;pointer-events:none}' +
      'body.mm-class-duty-gate-active button.stat-tile:not([data-gate-allow="1"]){opacity:.4;pointer-events:none}' +
      'body.mm-class-duty-gate-active .topbar-btn:not([data-gate-logout="1"]){opacity:.4;pointer-events:none}' +
      'body.mm-class-duty-gate-active.mm-duty-pending-khuluk #panel-std .std-icon-btn,' +
      'body.mm-class-duty-gate-active.mm-duty-pending-khuluk #panel-std .s-name-btn{opacity:.4;pointer-events:none}' +
      'body.mm-class-duty-gate-active.mm-duty-pending-log #panel-log .log-tab[data-log-tab="student"],' +
      'body.mm-class-duty-gate-active.mm-duty-pending-log #panel-log .log-student-expand,' +
      'body.mm-class-duty-gate-active.mm-duty-pending-log #panel-log .log-item--student .mini-edit-btn{opacity:.4;pointer-events:none}' +
      '.mm-class-duty-gate-banner{background:linear-gradient(135deg,#7a1f1f,#a93226);color:#fff;border-radius:10px;padding:8px 11px;margin:0 0 8px;font-size:11px;line-height:1.4;box-shadow:0 4px 14px rgba(122,31,31,.18)}' +
      '.mm-class-duty-gate-banner strong{font-weight:700}';
    (global.document.head || global.document.documentElement).appendChild(st);
  }

  function markNav(state) {
    var pending = state.pending;
    global.document.querySelectorAll('.bottom-nav .nav-item').forEach(function (btn) {
      var allow = false;
      var oc = btn.getAttribute('onclick') || '';
      if (/switchTab\s*\(\s*['"]std['"]/.test(oc) || btn.id === 'nav-std') allow = !!pending.khuluk;
      if (/switchTab\s*\(\s*['"]kitab['"]/.test(oc) || btn.id === 'nav-kitab') allow = !!pending.kitab;
      if (/switchTab\s*\(\s*['"]log['"]/.test(oc) || btn.id === 'nav-log') allow = !!pending.log;
      if (allow) btn.setAttribute('data-gate-allow', '1');
      else btn.removeAttribute('data-gate-allow');
    });
    var logout = global.document.querySelector('.topbar-btn[onclick*="logoutToIndex"]');
    if (logout) logout.setAttribute('data-gate-logout', '1');
  }

  function markStatTiles(state) {
    global.document.querySelectorAll('#stat-grid button.stat-tile').forEach(function (btn) {
      btn.removeAttribute('data-gate-allow');
    });
  }

  function updateBanner(state) {
    injectStyles();
    var host = global.document.querySelector('#panel-std .std-sticky-head') ||
      global.document.getElementById('duty-panel-wrap');
    if (!host) return;
    var el = global.document.getElementById(BANNER_ID);
    if (!state.active) {
      if (el) el.remove();
      return;
    }
    var parts = [];
    if (state.pending.kitab) parts.push('কিতাব');
    if (state.pending.khuluk) parts.push('খুলুক');
    if (state.pending.log) parts.push('লগ');
    var html = 'বর্ষের দায়িত্ব বাকি — <strong>' + toBn(state.overdueCount) + '</strong>টি · ' +
      parts.join(', ') + ' সম্পন্ন করুন · অন্য মেনু বন্ধ';
    if (!el) {
      el = global.document.createElement('div');
      el.id = BANNER_ID;
      el.className = 'mm-class-duty-gate-banner';
      el.setAttribute('role', 'status');
      host.insertBefore(el, host.firstChild);
    }
    el.innerHTML = html;
  }

  function applyBodyClasses(state) {
    var body = global.document.body;
    body.classList.toggle('mm-class-duty-gate-active', !!state.active);
    body.classList.toggle('mm-duty-pending-kitab', !!(state.active && state.pending.kitab));
    body.classList.toggle('mm-duty-pending-khuluk', !!(state.active && state.pending.khuluk));
    body.classList.toggle('mm-duty-pending-log', !!(state.active && state.pending.log));
  }

  function ensureAllowedTab(state) {
    if (!state.active || typeof hooks.forceSwitchTab !== 'function') return;
    var tabs = allowedTabs(state.pending);
    if (!tabs.length) return;
    var cur = currentTab();
    if (tabs.indexOf(cur) >= 0) return;
    hooks.forceSwitchTab(tabs[0]);
  }

  function clearLocks() {
    if (!global.document) return;
    global.document.body.classList.remove(
      'mm-class-duty-gate-active',
      'mm-duty-pending-kitab',
      'mm-duty-pending-khuluk',
      'mm-duty-pending-log'
    );
    global.document.querySelectorAll('[data-gate-allow],[data-gate-logout]').forEach(function (el) {
      el.removeAttribute('data-gate-allow');
      el.removeAttribute('data-gate-logout');
    });
    var el = global.document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function refresh() {
    if (!isTeacherUser()) {
      clearLocks();
      return false;
    }
    var state = getDutyState();
    if (!state.active) {
      clearLocks();
      return false;
    }
    injectStyles();
    applyBodyClasses(state);
    markNav(state);
    markStatTiles(state);
    updateBanner(state);
    ensureAllowedTab(state);
    if (typeof hooks.openDutyPanel === 'function') hooks.openDutyPanel();
    return true;
  }

  function blockTab(name) {
    if (!isGateActive()) return false;
    var state = getDutyState();
    var tabs = allowedTabs(state.pending);
    if (tabs.indexOf(name) >= 0) return false;
    notify('আগে বর্ষের বাকি দায়িত্ব সম্পন্ন করুন');
    return true;
  }

  function blockExternalNav(kind) {
    if (!isGateActive()) return false;
    notify('দায়িত্ব শেষ করুন — তারপর ' + (kind === 'chat' ? 'বার্তা' : 'পরীক্ষা') + ' খুলতে পারবেন');
    return true;
  }

  function blockMisc(kind) {
    if (!isGateActive()) return false;
    if (kind === 'pin') {
      notify('দায়িত্ব শেষ করুন — তারপর PIN পরিবর্তন করতে পারবেন');
      return true;
    }
    notify('আগে বর্ষের বাকি দায়িত্ব সম্পন্ন করুন');
    return true;
  }

  var ALLOWED_MODALS = {
    'modal-khuluk': 'khuluk',
    'modal-duty-khuluk': 'khuluk',
    'modal-book-prog': 'kitab',
    'modal-log': 'log',
  };

  function blockModal(id) {
    if (!isGateActive()) return false;
    var state = getDutyState();
    var pending = state.pending;
    var need = ALLOWED_MODALS[id];
    if (!need) {
      notify('আগে বর্ষের বাকি দায়িত্ব সম্পন্ন করুন');
      return true;
    }
    if (need === 'kitab' && pending.kitab) return false;
    if (need === 'khuluk' && pending.khuluk) return false;
    if (need === 'log' && pending.log) return false;
    notify('আগে বর্ষের বাকি দায়িত্ব সম্পন্ন করুন');
    return true;
  }

  function blockLogSubTab(which) {
    if (!isGateActive()) return false;
    var state = getDutyState();
    if (state.pending.log && which === 'student') {
      notify('আগে শ্রেণী লগ দিন');
      return true;
    }
    if (!state.pending.log && which === 'class') return blockMisc('log-tab');
    return false;
  }

  function bind(nextHooks) {
    hooks = Object.assign({}, hooks, nextHooks || {});
  }

  global.MDRClassDutyGate = {
    bind: bind,
    refresh: refresh,
    isGateActive: isGateActive,
    getDutyState: getDutyState,
    blockTab: blockTab,
    blockExternalNav: blockExternalNav,
    blockMisc: blockMisc,
    blockModal: blockModal,
    blockLogSubTab: blockLogSubTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
