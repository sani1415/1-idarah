/* Client session (PIN / role) until replaced by server auth. Key names live here only. */
(function (global) {
  'use strict';

  var K = {
    role: 'mm_role',
    name: 'mm_name',
    staffUserId: 'mm_staff_user_id',
    staffPin: 'mm_staff_pin',
    teacherId: 'mm_teacher_id',
    teacherProfile: 'mm_teacher_profile',
    adminUserId: 'mm_admin_user_id',
    adminPin: 'mm_admin_pin',
    adminPerms: 'mm_admin_perms',
    deptRole: 'mm_dept_role',
    deptId: 'mm_dept_id',
    deptName: 'mm_dept_name',
    deptEmoji: 'mm_dept_emoji',
  };

  var ALL_APP_KEYS = [
    K.role, K.name, K.staffUserId, K.staffPin, K.teacherId, K.teacherProfile, K.adminUserId, K.adminPin, K.adminPerms,
    K.deptRole, K.deptId, K.deptName, K.deptEmoji,
  ];

  // ── Persistent admin login (admin subdomain only) ──
  // sessionStorage অ্যাপ বন্ধ হলে মুছে যায়; admin PWA-তে যাতে বারবার লগইন না
  // লাগে, admin session localStorage-এ রাখি ও fresh entry-র পর restore করি।
  // শুধু explicit logout-এ মুছি — auto stale-clear-এ নয়।
  var ADMIN_PERSIST_KEY = 'mm_admin_persist_v1';

  function isAdminHost() {
    try { return typeof location !== 'undefined' && /^admin\./i.test(location.hostname); }
    catch (e) { return false; }
  }
  function persistAdminSession(blob) {
    if (!isAdminHost()) return;
    try { localStorage.setItem(ADMIN_PERSIST_KEY, JSON.stringify(blob)); } catch (e) {}
  }
  function clearPersistedAdminSession() {
    try { localStorage.removeItem(ADMIN_PERSIST_KEY); } catch (e) {}
  }
  function restorePersistedAdminSession() {
    if (!isAdminHost()) return;
    try {
      if (sessionStorage.getItem(K.role)) return;
      var raw = localStorage.getItem(ADMIN_PERSIST_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (!p || !p.adminPin) return;
      sessionStorage.setItem(K.role, 'admin');
      sessionStorage.setItem(K.name, p.name || 'জিম্মাদার');
      if (p.adminUserId) sessionStorage.setItem(K.adminUserId, p.adminUserId);
      sessionStorage.setItem(K.adminPin, p.adminPin);
      if (p.adminPerms) sessionStorage.setItem(K.adminPerms, p.adminPerms);
    } catch (e) {}
  }

  var SESSION_CACHE_VERSION = 1;
  var SESSION_CACHE_META = 'mm_data_cache_meta';
  var SESSION_CACHE_PREFIX = 'mm_sc_';
  var PROGRAMS_CACHE_KEY = 'mm_programs_sc_v1';

  function sessionActorKeyForCache() {
    try {
      var role = sessionStorage.getItem(K.role) || '';
      if (role === 'admin') {
        return 'admin:' + String(sessionStorage.getItem(K.adminUserId) || '') + ':' + String(sessionStorage.getItem(K.adminPin) || '');
      }
      return role + ':' + String(sessionStorage.getItem(K.staffUserId) || '') + ':' +
        String(sessionStorage.getItem(K.teacherId) || '') + ':' + String(sessionStorage.getItem(K.deptId) || '');
    } catch (e) {
      return '';
    }
  }

  function isAppSessionCacheWarm() {
    if (global.API) {
      try {
        if (API.isDaftarSessionCacheWarm) return API.isDaftarSessionCacheWarm();
      } catch (e0) {}
      if (API.isSessionCacheWarm) return API.isSessionCacheWarm();
    }
    try {
      var actor = sessionActorKeyForCache();
      if (!actor) return false;
      var meta = JSON.parse(sessionStorage.getItem(SESSION_CACHE_META) || 'null');
      if (!meta || meta.v !== SESSION_CACHE_VERSION || meta.actor !== actor) return false;
      var students = JSON.parse(sessionStorage.getItem(SESSION_CACHE_PREFIX + 'mm_students') || '[]');
      var classes = JSON.parse(sessionStorage.getItem(SESSION_CACHE_PREFIX + 'mm_classes') || '[]');
      if (!Array.isArray(students) || !students.length || !Array.isArray(classes) || !classes.length) return false;
      if (meta && meta.daftar_boot) return true;
      var attRaw = sessionStorage.getItem(SESSION_CACHE_PREFIX + 'mm_attendance');
      if (attRaw != null) {
        try {
          var att = JSON.parse(attRaw);
          if (Array.isArray(att) && att.length) return true;
        } catch (eAtt) {}
      }
      if (sessionStorage.getItem('mm_absent_summary_v1') != null) return true;
      return false;
    } catch (e2) {
      return false;
    }
  }

  function readTeacherProfile() {
    try {
      var raw = sessionStorage.getItem(K.teacherProfile);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function readPerms() {
    try {
      var raw = sessionStorage.getItem(K.adminPerms);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function isSuperAdminPerms(perms) {
    return !!(perms && perms.super_admin === true);
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  function sessionErrorMessage(error) {
    if (error === 'invalid_current_pin' || error === 'invalid_pin') return 'বর্তমান PIN ভুল';
    if (error === 'invalid_new_pin' || error === 'pin_too_short') return 'নতুন PIN ৪ সংখ্যার হতে হবে';
    if (error === 'same_pin') return 'নতুন PIN আগের PIN থেকে আলাদা দিন';
    if (error === 'missing_user') return 'ব্যবহারকারী পাওয়া যায়নি';
    return 'PIN পরিবর্তন হয়নি';
  }

  var MMSession = {
    K: K,

    get: function (key) { return sessionStorage.getItem(key); },
    set: function (key, val) { sessionStorage.setItem(key, val); },
    remove: function (key) { sessionStorage.removeItem(key); },

    getRole: function () { return sessionStorage.getItem(K.role); },
    getName: function () { return sessionStorage.getItem(K.name); },
    getStaffUserId: function () { return sessionStorage.getItem(K.staffUserId); },
    getStaffPin: function () { return sessionStorage.getItem(K.staffPin); },
    getTeacherId: function () { return sessionStorage.getItem(K.teacherId); },
    getTeacherProfile: readTeacherProfile,
    setTeacherProfile: function (profile) {
      if (!profile || !profile.id) {
        sessionStorage.removeItem(K.teacherProfile);
        return;
      }
      sessionStorage.setItem(K.teacherProfile, JSON.stringify(profile));
    },
    clearTeacherProfile: function () { sessionStorage.removeItem(K.teacherProfile); },
    /** Volatile API cache reset হলে login session থেকে teacher row পুনরায় লোড */
    hydrateTeacherRecord: function () {
      var tid = this.getTeacherId();
      if (!tid) return null;
      var api = global.API;
      if (!api || !api.Teachers) return null;
      var teacher = api.Teachers.getById(tid);
      if (teacher) return teacher;
      var profile = readTeacherProfile();
      if (!profile || String(profile.id) !== String(tid)) return null;
      if (api.Teachers.getById(tid)) api.Teachers.update(tid, profile);
      else api.Teachers.add(profile);
      return api.Teachers.getById(tid);
    },
    getAdminUserId: function () { return sessionStorage.getItem(K.adminUserId); },
    getAdminPin: function () { return sessionStorage.getItem(K.adminPin); },
    getAdminPerms: readPerms,
    getDeptRole: function () { return sessionStorage.getItem(K.deptRole); },
    getDeptId: function () { return sessionStorage.getItem(K.deptId); },
    getDeptName: function () { return sessionStorage.getItem(K.deptName); },
    getDeptEmoji: function () { return sessionStorage.getItem(K.deptEmoji); },
    getId: function () {
      return this.isAdmin() ? this.getAdminUserId() : this.getStaffUserId();
    },
    getPin: function () {
      return this.isAdmin() ? this.getAdminPin() : this.getStaffPin();
    },
    getChatActorId: function () {
      return this.isAdmin() ? this.getAdminUserId() : this.getStaffUserId();
    },
    getChatPin: function () {
      return this.isAdmin() ? this.getAdminPin() : this.getStaffPin();
    },
    getChatThread: function () {
      if (this.getDeptRole() === 'dept') return 'dept-' + (this.getDeptId() || 'x');
      var role = this.getRole();
      if (role === 'teacher') return 'teacher-' + (this.getTeacherId() || 'x');
      if (['daftar', 'hifz', 'library', 'alumni', 'khedmat'].indexOf(role) >= 0) return role;
      return null;
    },

    setRole: function (v) { sessionStorage.setItem(K.role, v); },
    setName: function (v) { sessionStorage.setItem(K.name, v); },
    setStaffSession: function (role, name, userId, pin) {
      sessionStorage.setItem(K.role, role);
      sessionStorage.setItem(K.name, name || '');
      if (userId) sessionStorage.setItem(K.staffUserId, userId);
      else sessionStorage.removeItem(K.staffUserId);
      if (pin) sessionStorage.setItem(K.staffPin, pin);
      else sessionStorage.removeItem(K.staffPin);
      if (role !== 'teacher') {
        sessionStorage.removeItem(K.teacherId);
        sessionStorage.removeItem(K.teacherProfile);
      }
      sessionStorage.removeItem(K.adminUserId);
      sessionStorage.removeItem(K.adminPin);
      sessionStorage.removeItem(K.adminPerms);
    },
    setTeacherId: function (v) { sessionStorage.setItem(K.teacherId, v); },
    setAdminSession: function (name, perms, userId, pin) {
      sessionStorage.setItem(K.role, 'admin');
      sessionStorage.setItem(K.name, name || 'জিম্মাদার');
      sessionStorage.removeItem(K.staffUserId);
      sessionStorage.removeItem(K.staffPin);
      sessionStorage.removeItem(K.teacherId);
      sessionStorage.removeItem(K.teacherProfile);
      if (userId) sessionStorage.setItem(K.adminUserId, userId);
      else sessionStorage.removeItem(K.adminUserId);
      if (pin) sessionStorage.setItem(K.adminPin, pin);
      else sessionStorage.removeItem(K.adminPin);
      if (perms) sessionStorage.setItem(K.adminPerms, JSON.stringify(perms));
      else sessionStorage.removeItem(K.adminPerms);
      if (pin) {
        persistAdminSession({
          name: name || 'জিম্মাদার',
          adminUserId: userId || '',
          adminPin: pin,
          adminPerms: perms ? JSON.stringify(perms) : '',
        });
      }
    },

    setDeptSession: function (id, name, emoji, userId, pin) {
      sessionStorage.setItem(K.deptRole, 'dept');
      sessionStorage.setItem(K.deptId, id);
      sessionStorage.setItem(K.deptName, name);
      sessionStorage.setItem(K.deptEmoji, emoji);
      sessionStorage.setItem(K.role, 'dept_head');
      sessionStorage.setItem(K.name, name || 'বিভাগ দায়িত্বশীল');
      if (userId) sessionStorage.setItem(K.staffUserId, userId);
      else sessionStorage.removeItem(K.staffUserId);
      if (pin) sessionStorage.setItem(K.staffPin, pin);
      else sessionStorage.removeItem(K.staffPin);
      sessionStorage.removeItem(K.adminUserId);
      sessionStorage.removeItem(K.adminPin);
      sessionStorage.removeItem(K.adminPerms);
      sessionStorage.removeItem(K.teacherId);
      sessionStorage.removeItem(K.teacherProfile);
    },
    changeStaffPin: async function (currentPin, newPin, localChangeFn) {
      var uid = this.getStaffUserId();
      if (!uid) return { ok: false, error: 'missing_user' };
      var hasRemote = !!(global.MMSharedAPI && global.MMSharedAPI.supabaseClient && global.MMSharedAPI.staffChangeOwnPin && isUuid(uid));
      if (hasRemote) {
        try {
          var res = await global.MMSharedAPI.staffChangeOwnPin(uid, currentPin, newPin);
          if (!res || res.ok !== true) return { ok: false, error: (res && res.error) || 'pin_change_failed' };
          if (typeof localChangeFn === 'function') {
            try { localChangeFn(uid, currentPin, newPin); } catch (e) {}
          }
          this.setStaffSession(this.getRole(), this.getName(), uid, newPin);
          return { ok: true, source: 'database' };
        } catch (e2) {
          return { ok: false, error: 'database_failed' };
        }
      }
      if (typeof localChangeFn === 'function' && localChangeFn(uid, currentPin, newPin)) {
        this.setStaffSession(this.getRole(), this.getName(), uid, newPin);
        return { ok: true, source: 'local' };
      }
      return { ok: false, error: 'invalid_current_pin' };
    },
    pinChangeErrorMessage: sessionErrorMessage,

    isAdmin: function () { return sessionStorage.getItem(K.role) === 'admin'; },
    /** ছাত্র/শ্রেণি সেশন ক্যাশ — নেভিগেশনে পুনরায় বুটস্ট্র্যাপ এড়াতে */
    isAppDataWarm: function () { return isAppSessionCacheWarm(); },

    /**
     * দফতর শেল — প্রথমবার লোডিং সহ, পরে নেভে শান্ত (silent) বুটস্ট্র্যাপ।
     * @param {{ silent?: boolean, force?: boolean }} opts
     */
    ensureDaftarDataReady: async function (opts) {
      opts = opts || {};
      var silent = opts.silent === true || (opts.silent !== false && isAppSessionCacheWarm());
      var wrap = function (fn) {
        if (!silent && global.MMLoading && MMLoading.runDaftarPage) return MMLoading.runDaftarPage(fn);
        return fn();
      };
      if (global.API && API.hydrateSessionCache) API.hydrateSessionCache();
      if (global.MDRDaftarSupabase && MDRDaftarSupabase.hydrateClassTeachersCache) {
        MDRDaftarSupabase.hydrateClassTeachersCache();
      }
      var needDaftar = opts.force || !(global.API && API.isDaftarSessionCacheWarm && API.isDaftarSessionCacheWarm());
      if (needDaftar && global.MDRDaftarSupabase && MDRDaftarSupabase.sync) {
        await wrap(async function () {
          await MDRDaftarSupabase.sync(opts.force ? { force: true } : undefined);
        });
      }
      var needAcc = global.MdrAccAPI && MdrAccAPI.bootstrapRemote &&
        (!MdrAccAPI.isLocalCacheWarm || !MdrAccAPI.isLocalCacheWarm());
      if (needAcc) {
        await wrap(async function () {
          await MdrAccAPI.bootstrapRemote(opts.force ? { force: true } : undefined);
        });
      }
      if (global.API && API.rebuildDaftarAbsentSummary && API.loadDaftarAbsentSummaryRaw &&
          !API.loadDaftarAbsentSummaryRaw() && API.hasSessionCacheEntry) {
        try {
          if (API.hasSessionCacheEntry('mm_attendance')) {
            var attN = API.Attendance && API.Attendance.getAll ? API.Attendance.getAll().length : 0;
            if (attN > 0) API.rebuildDaftarAbsentSummary();
          }
        } catch (e) {}
      }
      if (global.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.enforceAfterBootstrap) {
        try { MDRDaftarAttendanceGate.enforceAfterBootstrap(); } catch (eGate) {}
      }
      return true;
    },
    isRestrictedAdmin: function () {
      var p = readPerms();
      return this.isAdmin() && !!p && !isSuperAdminPerms(p);
    },
    isMainAdmin: function () {
      var p = readPerms();
      return this.isAdmin() && (!p || isSuperAdminPerms(p));
    },
    getAllowedMadrasaDepts: function () {
      var p = readPerms();
      if (!p || !p.scope || !Array.isArray(p.scope.madrasa_depts) || !p.scope.madrasa_depts.length) {
        return ['kitab', 'maktab'];
      }
      return p.scope.madrasa_depts.filter(function (d) { return d === 'kitab' || d === 'maktab'; });
    },
    canUseMadrasaDept: function (dept) {
      return this.getAllowedMadrasaDepts().indexOf(dept) >= 0;
    },
    canAdmin: function (permKey) {
      var p = readPerms();
      if (!p) return true;
      if (isSuperAdminPerms(p)) return true;
      if (!permKey) return true;
      if (permKey === 'dashboard') return true;
      if (p.permissions && Object.prototype.hasOwnProperty.call(p.permissions, permKey)) {
        return !!p.permissions[permKey];
      }
      if (permKey === 'messages' || permKey === 'recent') return true;
      return false;
    },
    requireAdminPerm: function (permKey, fallbackHref) {
      if (!this.isAdmin()) {
        location.href = fallbackHref || '/admin/madrasa.html';
        return false;
      }
      if (!this.canAdmin(permKey)) {
        location.href = fallbackHref || '/admin/madrasa.html';
        return false;
      }
      return true;
    },
    requireStaffRoleOrAdminPerm: function (roles, permKey, fallbackHref) {
      var allowedRoles = Array.isArray(roles) ? roles : [roles];
      var role = this.getRole();
      if (this.isAdmin()) return this.requireAdminPerm(permKey, fallbackHref);
      if (allowedRoles.indexOf(role) >= 0) return true;
      location.href = fallbackHref || '../index.html';
      return false;
    },
    applyAdminNavRestrictions: function () {
      if (!this.isRestrictedAdmin()) return;
      var firstDept = this.getAllowedMadrasaDepts()[0] || 'kitab';
      var deptQuery = '?dept=' + encodeURIComponent(firstDept);
      document.querySelectorAll('a[href*="/admin/madrasa.html"]').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        a.setAttribute('href', href.split('?')[0] + deptQuery);
      });
      document.querySelectorAll(
        'a[href*="/admin/dept.html"], a[href*="/admin/khedmat.html"], [data-admin-hub="dept"]'
      ).forEach(function (el) {
        el.style.display = 'none';
      });
      document.querySelectorAll('[data-admin-perm]').forEach(function (el) {
        var key = el.getAttribute('data-admin-perm');
        if (!key || MMSession.canAdmin(key)) return;
        el.style.display = 'none';
      });
      if (!this.canAdmin('messages')) {
        document.querySelectorAll('a[href*="chat.html"]').forEach(function (a) { a.style.display = 'none'; });
      }
      if (!this.canAdmin('recent')) {
        document.querySelectorAll('a[href*="/admin/recent.html"]').forEach(function (a) { a.style.display = 'none'; });
      }
    },

    clearDeptSession: function () {
      sessionStorage.removeItem(K.deptRole);
      sessionStorage.removeItem(K.deptId);
      sessionStorage.removeItem(K.deptName);
      sessionStorage.removeItem(K.deptEmoji);
    },

    clearAppSession: function () {
      ALL_APP_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });
      if (global.API && API.clearSessionCache) API.clearSessionCache();
      try { sessionStorage.removeItem(PROGRAMS_CACHE_KEY); } catch (e) {}
      try { sessionStorage.removeItem('mm_absent_summary_v1'); } catch (e) {}
      try { sessionStorage.removeItem('mm_class_teachers_sc_v1'); } catch (e) {}
      clearNavLoadingFlag();
      if (global.MdrAccAPI && MdrAccAPI.clearLocalCache) MdrAccAPI.clearLocalCache();
      updateOsBadge(0);
    },

    /** Clear app session then go to role selection (use from madrasa/*, khedmat staff, etc.). */
    logoutToIndex: function (href) {
      this.clearAppSession();
      clearPersistedAdminSession();
      // Admin app runs on its own subdomain with a dedicated login entry,
      // so logout there must return to /admin/ — not the shared staff login.
      try {
        if (typeof location !== 'undefined' && /^admin\./i.test(location.hostname)) {
          location.href = '/admin/';
          return;
        }
      } catch (e) {}
      location.href = href;
    },

    /**
     * Top bar: #topbar-hub → main admin (only if isAdmin). #topbar-lockout → session clear + index (staff).
     * Hub button should start hidden (style="display:none") so staff never see admin PIN by mistake.
     */
    configureTopbarHubAndLockout: function () {
      var hub = document.getElementById('topbar-hub');
      var lock = document.getElementById('topbar-lockout');
      if (!hub && !lock) return;
      if (this.isAdmin()) {
        if (hub) hub.style.removeProperty('display');
        if (lock) lock.style.display = 'none';
      } else {
        if (hub) hub.style.display = 'none';
        if (lock) lock.style.removeProperty('display');
      }
    },
  };

  global.MMSession = MMSession;
  (function clearStaleSessionOnFreshEntry() {
    if (typeof document === 'undefined' || typeof location === 'undefined') return;
    var path = String(location.pathname || '').replace(/\\/g, '/');
    var isIndex = !path || /(^|\/)(index\.html)?$/.test(path);
    if (isIndex) return;
    var navType = '';
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      navType = nav && nav.type ? nav.type : '';
    } catch (e) {}
    if (navType === 'reload') return;
    var sameOriginReferrer = false;
    try {
      sameOriginReferrer = !!document.referrer && new URL(document.referrer, location.href).origin === location.origin;
    } catch (e2) {}
    if (!sameOriginReferrer) MMSession.clearAppSession();
  })();
  // Fresh-entry stale-clear-এর পর persisted admin login ফিরিয়ে আনি (admin host)।
  restorePersistedAdminSession();
  var chatUnreadCount = 0;
  function readChatUnreadCount() { return chatUnreadCount; }
  function bnNum(n) {
    return String(n || 0).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; });
  }
  function updateOsBadge(count) {
    // Installed-PWA app-icon badge (Badging API): reflects unread chat count
    // and clears on read. Silent no-op where the API is unsupported.
    try {
      if (typeof navigator === 'undefined') return;
      if (count > 0) {
        if (navigator.setAppBadge) navigator.setAppBadge(count);
      } else if (navigator.clearAppBadge) {
        navigator.clearAppBadge();
      }
    } catch (e) {}
  }
  function applyChatBadges() {
    updateOsBadge(readChatUnreadCount());
    if (typeof document === 'undefined') return;
    var count = readChatUnreadCount();
    var nodes = document.querySelectorAll('a[href$="chat.html"], a[href*="/chat.html"], [onclick*="chat.html"]');
    nodes.forEach(function (node) {
      var badge = node.querySelector('.mm-chat-badge');
      if (!count) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mm-chat-badge';
        badge.setAttribute('aria-label', 'অপঠিত বার্তা');
        node.appendChild(badge);
      }
      badge.textContent = count > 99 ? '৯৯+' : bnNum(count);
    });
  }
  async function syncChatBadgeRemote() {
    if (!global.MMSharedAPI || !MMSession.getChatPin()) {
      chatUnreadCount = 0;
      applyChatBadges();
      return false;
    }
    try {
      var res = await MMSharedAPI.chatBootstrap(MMSession.getChatActorId() || null, MMSession.getChatPin(), MMSession.isAdmin());
      if (!res || !res.ok) throw new Error((res && res.error) || 'chat_bootstrap_failed');
      chatUnreadCount = MMSession.isAdmin() ? Number(res.unread_admin || 0) : Number(res.unread_staff || 0);
      applyChatBadges();
      return true;
    } catch (e) {
      chatUnreadCount = 0;
      applyChatBadges();
      return false;
    }
  }
  global.MMRefreshChatBadges = applyChatBadges;
  global.MMSyncChatBadges = syncChatBadgeRemote;
  global.addEventListener && global.addEventListener('mm-chat-updated', applyChatBadges);

  var reviewPendingCount = 0;
  function applyReviewBadges() {
    if (typeof document === 'undefined') return;
    var count = reviewPendingCount;
    document.querySelectorAll('.topbar-actions').forEach(function (actions) {
      var btn = actions.querySelector('.mm-review-btn');
      if (!count) {
        if (btn) btn.remove();
        return;
      }
      if (!btn) {
        btn = document.createElement('a');
        btn.className = 'topbar-btn topbar-btn--icon mm-review-btn';
        btn.href = '/admin/recent.html?filter=review';
        btn.title = 'রিভিউ বাকি';
        btn.setAttribute('aria-label', 'রিভিউ বাকি');
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
          '<span class="mm-review-count-badge"></span>';
        actions.insertBefore(btn, actions.firstChild);
      }
      var badgeEl = btn.querySelector('.mm-review-count-badge');
      if (badgeEl) badgeEl.textContent = count > 99 ? '৯৯+' : bnNum(count);
    });
  }
  async function syncReviewBadgeRemote() {
    if (!global.MMSharedAPI || !MMSession.isAdmin() || !MMSession.getAdminPin()) {
      reviewPendingCount = 0;
      applyReviewBadges();
      return false;
    }
    try {
      var res = await global.MMSharedAPI.adminPendingReviewCount(MMSession.getAdminUserId(), MMSession.getAdminPin());
      if (!res || !res.ok) throw new Error((res && res.error) || 'pending_review_count_failed');
      reviewPendingCount = Number(res.count || 0);
      applyReviewBadges();
      return true;
    } catch (e) {
      reviewPendingCount = 0;
      applyReviewBadges();
      return false;
    }
  }
  global.MMSyncReviewBadge = syncReviewBadgeRemote;

  var settingsSyncInFlight = false;

  function readCurrentAcademicYear() {
    var settings = null;
    try {
      var raw = localStorage.getItem('mm_settings');
      settings = raw ? JSON.parse(raw) : null;
    } catch (e) {
      settings = null;
    }
    if (!settings && global.API && global.API.Settings) {
      try { settings = global.API.Settings.get(); } catch (e2) { settings = null; }
    }
    var year = settings && settings.hijri_year != null ? String(settings.hijri_year).trim() : '';
    if (!year || year === '-' || year === '\u2014') return '';
    return year.replace(/[0-9]/g, function (d) { return '\u09e6\u09e7\u09e8\u09e9\u09ea\u09eb\u09ec\u09ed\u09ee\u09ef'[d]; });
  }

  function renderCurrentAcademicYear() {
    if (typeof document === 'undefined') return;
    var topbars = document.querySelectorAll('.topbar, .inbox-topbar, .chat-topbar');
    if (!topbars || !topbars.length) return;
    var year = readCurrentAcademicYear();
    topbars.forEach(function (topbar) {
      var label = topbar.querySelector('.mm-monitor-topbar-label');
      if (!year) {
        if (label) label.remove();
        topbar.classList.remove('mm-monitor-topbar');
        return;
      }
      topbar.classList.add('mm-monitor-topbar');
      if (!label) {
        label = document.createElement('div');
        label.className = 'mm-monitor-topbar-label';
        topbar.appendChild(label);
      }
      label.textContent = year + ' \u09b9\u09bf\u099c\u09b0\u09bf';
    });
  }

  function mergeAcademicSettings(settings) {
    if (!settings || (!settings.institution && !settings.hijri_year && !settings.session_start_date && settings.hijri_offset_days == null)) {
      return false;
    }
    var local = {};
    try {
      var raw = localStorage.getItem('mm_settings');
      local = raw ? JSON.parse(raw) : {};
    } catch (e) {
      local = {};
    }
    var next = {
      institution: settings.institution || local.institution,
      hijri_year: settings.hijri_year || local.hijri_year,
      session_start_date: settings.session_start_date || local.session_start_date,
      hijri_offset_days: settings.hijri_offset_days != null
        ? Number(settings.hijri_offset_days) || 0
        : Number(local.hijri_offset_days) || 0,
    };
    try {
      localStorage.setItem('mm_settings', JSON.stringify(Object.assign({}, local, next)));
    } catch (e2) {}
    if (global.MMHijri && next.hijri_offset_days != null) {
      try { global.MMHijri.setOffsetDays(next.hijri_offset_days); } catch (e3) {}
    }
    renderCurrentAcademicYear();
    return true;
  }

  async function syncCurrentAcademicYearSettings() {
    if (settingsSyncInFlight || !global.MMSharedAPI || !global.MMSharedAPI.publicSettings) return false;
    settingsSyncInFlight = true;
    try {
      var res = await global.MMSharedAPI.publicSettings();
      if (!res || res.ok !== true) return false;
      return mergeAcademicSettings(res.settings || {});
    } catch (e) {
      return false;
    } finally {
      settingsSyncInFlight = false;
    }
  }

  global.MMRenderCurrentAcademicYear = renderCurrentAcademicYear;
  global.MMSyncCurrentAcademicYearSettings = syncCurrentAcademicYearSettings;
  function autoRestrictNav() { if (global.MMSession) global.MMSession.applyAdminNavRestrictions(); }
  if (typeof document !== 'undefined') {
    var onReady = function () { autoRestrictNav(); renderCurrentAcademicYear(); syncCurrentAcademicYearSettings(); syncChatBadgeRemote(); syncReviewBadgeRemote(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else setTimeout(onReady, 0);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        renderCurrentAcademicYear();
        syncCurrentAcademicYearSettings();
        syncReviewBadgeRemote();
      }
    });
    global.addEventListener && global.addEventListener('storage', function (event) {
      if (!event || event.key === 'mm_settings') renderCurrentAcademicYear();
    });
    global.addEventListener && global.addEventListener('mm-settings-updated', renderCurrentAcademicYear);
    global.setInterval && global.setInterval(renderCurrentAcademicYear, 3000);
  }

  var LOADING_MSG = 'ধৈর্য ধরুন। নিশ্চয়ই আল্লাহ ধৈর্য ধারণকারীদের পছন্দ করেন।';
  var LOADING_OVERLAY_ID = 'mm-app-load-screen';
  var LOADING_STYLE_ID = 'mm-app-load-style';
  var loadingVisible = false;

  function injectLoadingStyles() {
    if (typeof document === 'undefined' || document.getElementById(LOADING_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = LOADING_STYLE_ID;
    style.textContent =
      'html.mm-app-boot:not(.mm-app-ready){background:var(--cream,#faf6ef)}' +
      'html.mm-app-boot:not(.mm-app-ready) body{overflow:hidden}' +
      'html.mm-app-boot:not(.mm-app-ready) body>:not(#mm-app-load-screen){visibility:hidden!important}' +
      '.mm-app-load-screen{position:fixed;inset:0;z-index:2147483000;background:var(--cream,#faf6ef);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}' +
      '.mm-app-load-screen.is-hidden{display:none!important}' +
      '.mm-app-load-inner{text-align:center;max-width:340px}' +
      '.mm-app-load-spinner{width:42px;height:42px;margin:0 auto;border:3px solid rgba(201,149,42,.22);border-top-color:var(--gold,#c9952a);border-radius:50%;animation:mmAppLoadSpin .85s linear infinite}' +
      '@keyframes mmAppLoadSpin{to{transform:rotate(360deg)}}' +
      '.mm-app-load-text{font-family:"Tiro Bangla",serif;font-size:15px;line-height:1.65;color:var(--ink2);margin:18px 0 0}';
    document.head.appendChild(style);
  }

  function ensureLoadingOverlay() {
    if (typeof document === 'undefined') return null;
    injectLoadingStyles();
    var el = document.getElementById(LOADING_OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = LOADING_OVERLAY_ID;
    el.className = 'mm-app-load-screen is-hidden';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-busy', 'false');
    el.innerHTML =
      '<div class="mm-app-load-inner">' +
      '<div class="mm-app-load-spinner" aria-hidden="true"></div>' +
      '<p class="mm-app-load-text"></p>' +
      '</div>';
    if (document.body) document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function setBootCoverActive(active) {
    if (typeof document === 'undefined') return;
    var root = document.documentElement;
    if (!root) return;
    if (active) {
      root.classList.add('mm-app-boot');
      root.classList.remove('mm-app-ready');
    } else {
      root.classList.add('mm-app-ready');
      root.classList.remove('mm-app-boot');
    }
  }

  function releaseBootCoverIfWarm() {
    if (!isAppSessionCacheWarm()) return;
    var el = document.getElementById(LOADING_OVERLAY_ID);
    if (el) {
      el.classList.add('is-hidden');
      el.setAttribute('aria-busy', 'false');
    }
    loadingVisible = false;
    setBootCoverActive(false);
    clearNavLoadingFlag();
  }

  function primeBootOverlay(message) {
    var el = ensureLoadingOverlay();
    if (!el) return;
    var text = el.querySelector('.mm-app-load-text');
    if (text) text.textContent = message || LOADING_MSG;
    el.classList.remove('is-hidden');
    el.setAttribute('aria-busy', 'true');
    loadingVisible = true;
  }

  var MMLoading = {
    MESSAGE: LOADING_MSG,
    show: function (message) {
      setBootCoverActive(true);
      primeBootOverlay(message);
    },
    hide: function () {
      if (typeof document === 'undefined') return;
      var el = document.getElementById(LOADING_OVERLAY_ID);
      var finish = function () {
        if (el) {
          el.classList.add('is-hidden');
          el.setAttribute('aria-busy', 'false');
        }
        loadingVisible = false;
        setBootCoverActive(false);
      };
      if (global.requestAnimationFrame) {
        global.requestAnimationFrame(function () {
          global.requestAnimationFrame(finish);
        });
      } else {
        setTimeout(finish, 32);
      }
    },
    isVisible: function () { return loadingVisible; },
    run: async function (fn, message, options) {
      options = options || {};
      var warm = options.forceLoading !== true && isAppSessionCacheWarm();
      if (!warm) MMLoading.show(message);
      try {
        return await fn();
      } finally {
        if (!warm) MMLoading.hide();
        else releaseBootCoverIfWarm();
        clearNavLoadingFlag();
      }
    },
    /** দফতর/স্টাফ — অ্যাডমিনের মতো: ক্যাশ ওয়ার্ম হলে লোডিং ও রিমোট বুটস্ট্র্যাপ স্কিপ */
    runDaftarPage: function (fn, message) {
      return MMLoading.run(fn, message);
    },
  };

  function clearNavLoadingFlag() {
    try { sessionStorage.removeItem('mm_nav_loading'); } catch (e) {}
  }

  function resumeNavLoadingIfNeeded() {
    try {
      if (isAppSessionCacheWarm()) {
        clearNavLoadingFlag();
        return;
      }
      var navPending = sessionStorage.getItem('mm_nav_loading') === '1';
      var bootClass = typeof document !== 'undefined' && document.documentElement &&
        document.documentElement.classList.contains('mm-app-boot');
      if ((navPending || bootClass) && global.MMLoading && MMLoading.show && !MMLoading.isVisible()) {
        MMLoading.show();
      }
    } catch (e) {}
  }

  global.MMLoading = MMLoading;
  global.MMIsAppSessionCacheWarm = isAppSessionCacheWarm;
  global.MMReleaseBootCoverIfWarm = releaseBootCoverIfWarm;
  if (typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.classList.contains('mm-app-boot') &&
      !isAppSessionCacheWarm()) {
    injectLoadingStyles();
    primeBootOverlay(LOADING_MSG);
  }
  resumeNavLoadingIfNeeded();
  if (global.API && API.hydrateSessionCache) API.hydrateSessionCache();
})(typeof window !== 'undefined' ? window : globalThis);
