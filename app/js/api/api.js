/* ═══════════════════════════════════════════
   মাদরাসাতুল মদীনা — api.js
   সব ডেটা লজিক এখানে। localStorage ব্যবহার।
   ═══════════════════════════════════════════ */

const API = (() => {

  /* ── KEYS ── */
  const KEYS = {
    students:    'mm_students',
    classes:     'mm_classes',
    attendance:  'mm_attendance',
    kitabs:      'mm_kitabs',
    kitab_prog:  'mm_kitab_progress',
    khuluk:      'mm_khuluk',
    exams:       'mm_exams',
    results:     'mm_results',
    logs:        'mm_logs',
    fees:        'mm_fees',
    teachers:    'mm_teachers',
    users:       'mm_users',
    settings:    'mm_settings',
    sessions:    'mm_sessions',
    holidays:    'mm_holidays',
  };

  /* ── HELPERS ── */
  const volatileStore = {};

  /**
   * ডেটা keys — localStorage-এ লেখা হবে না।
   * প্রতিটি page load-এ DB থেকে fresh fetch হবে।
   * settings/sessions/holidays persist থাকবে (keep keys)।
   */
  const DATA_KEYS = new Set([
    'mm_students', 'mm_classes', 'mm_attendance', 'mm_kitabs', 'mm_kitab_progress',
    'mm_khuluk', 'mm_exams', 'mm_results', 'mm_logs', 'mm_fees', 'mm_teachers', 'mm_users',
    'mm_withdrawals', 'mm_alumni', 'mm_alumni_contacts',
    'mm_lib_books', 'mm_lib_issues',
    'mm_hifz_groups', 'mm_hifz_progress', 'mm_hifz_members', 'mm_hifz_activity',
  ]);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const today = () => new Date().toISOString().split('T')[0];
  const now = () => new Date().toISOString();
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  /** UI-তে লাতিন অংক → বাংলা অংক (০–৯); তারিখ/ফোন ইত্যাদি স্ট্রিংও পাস করা যায় */
  function toBn(v) {
    return String(v == null ? '' : v).replace(/\d/g, (ch) => String.fromCharCode(0x09e6 + ch.charCodeAt(0) - 48));
  }
  function escBn(v) {
    return esc(toBn(v));
  }

  /** Tab session cache — survives in-app navigation; cleared on logout. */
  const SESSION_CACHE_VERSION = 1;
  const SESSION_CACHE_META = 'mm_data_cache_meta';
  const SESSION_CACHE_PREFIX = 'mm_sc_';
  const ABSENT_SUMMARY_KEY = 'mm_absent_summary_v1';
  /** হাজিরা অডিট — শুধু তারিখের তালিকা (হালকা; সেশন জুড়ে নেভে টিকে থাকে) */
  const ATTENDANCE_DATES_KEY = 'mm_attendance_dates_v1';
  let sessionHydrateAttempted = false;

  function sessionActorKey() {
    if (typeof window === 'undefined' || !window.MMSession) return '';
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      return 'admin:' + String(MMSession.getAdminUserId && MMSession.getAdminUserId() || '') + ':' + String(MMSession.getAdminPin && MMSession.getAdminPin() || '');
    }
    const role = MMSession.getRole && MMSession.getRole() || 'staff';
    const uid = MMSession.getStaffUserId && MMSession.getStaffUserId() || '';
    const tid = MMSession.getTeacherId && MMSession.getTeacherId() || '';
    const deptId = MMSession.getDeptId && MMSession.getDeptId() || '';
    return role + ':' + uid + ':' + tid + ':' + deptId;
  }

  function sessionCacheStorageKey(key) {
    return SESSION_CACHE_PREFIX + key;
  }

  function readSessionCacheMeta() {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_META);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function touchSessionCacheMeta(extra) {
    const actor = sessionActorKey();
    if (!actor) return;
    try {
      const prev = readSessionCacheMeta() || {};
      const next = {
        v: SESSION_CACHE_VERSION,
        actor,
        ts: Date.now(),
        daftar_boot: !!(extra && extra.daftar_boot) || !!prev.daftar_boot,
        admin_madrasa_boot: !!(extra && extra.admin_madrasa_boot) || !!prev.admin_madrasa_boot,
      };
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'att_count')) {
        next.att_count = extra.att_count;
      } else if (prev.att_count != null) {
        next.att_count = prev.att_count;
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'att_dates')) {
        next.att_dates = extra.att_dates;
      } else if (prev.att_dates != null) {
        next.att_dates = prev.att_dates;
      }
      sessionStorage.setItem(SESSION_CACHE_META, JSON.stringify(next));
    } catch (e) {
      console.warn('[API] session cache meta write failed', e);
    }
  }

  function loadAttendanceDateIndex() {
    try {
      const raw = sessionStorage.getItem(ATTENDANCE_DATES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.actor !== sessionActorKey()) return [];
      return Array.isArray(parsed.dates) ? parsed.dates : [];
    } catch (e) {
      return [];
    }
  }

  function writeAttendanceDateIndex(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const fromRows = list.map((a) => String(a && a.date || '').slice(0, 10)).filter(Boolean);
    const merged = Array.from(new Set(loadAttendanceDateIndex().concat(fromRows))).sort();
    try {
      sessionStorage.setItem(ATTENDANCE_DATES_KEY, JSON.stringify({
        actor: sessionActorKey(),
        dates: merged,
        ts: Date.now(),
      }));
      return true;
    } catch (e) {
      console.warn('[API] attendance date index write failed', e);
      return false;
    }
  }

  /** bootstrap attendance_dates — সার্ভার থেকে পূর্ণ তারিখ তালিকা */
  function applyAttendanceDateIndexFromServer(dates) {
    const merged = Array.from(new Set(
      (Array.isArray(dates) ? dates : [])
        .map((d) => String(d || '').slice(0, 10))
        .filter(Boolean)
    )).sort();
    try {
      sessionStorage.setItem(ATTENDANCE_DATES_KEY, JSON.stringify({
        actor: sessionActorKey(),
        dates: merged,
        ts: Date.now(),
      }));
      return merged;
    } catch (e) {
      console.warn('[API] attendance date index from server failed', e);
      return loadAttendanceDateIndex();
    }
  }

  function markDaftarBootstrapComplete(opts) {
    opts = opts || {};
    ensureSessionCacheHydrated();
    const att = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.attendance)
      ? volatileStore[KEYS.attendance]
      : load(KEYS.attendance);
    if (!opts.skipRowIndex && Array.isArray(att) && att.length) writeAttendanceDateIndex(att);
    const attCount = Array.isArray(att) ? att.length : 0;
    const attDates = opts.attDatesCount != null
      ? Number(opts.attDatesCount) || 0
      : loadAttendanceDateIndex().length;
    touchSessionCacheMeta({ daftar_boot: true, att_count: attCount, att_dates: attDates });
  }

  function isAdminMadrasaExtrasWarm() {
    ensureSessionCacheHydrated();
    const meta = readSessionCacheMeta();
    return !!(meta && meta.admin_madrasa_boot);
  }

  function markAdminMadrasaBootstrapComplete() {
    touchSessionCacheMeta({ admin_madrasa_boot: true });
  }

  function studentIdSetForClass(cid) {
    const sidSet = new Set();
    Students.getByClass(cid).forEach((s) => {
      sidSet.add(String(s.id || ''));
      if (s.supabase_id) sidSet.add(String(s.supabase_id));
    });
    return sidSet;
  }

  /** daftar_boot আছে কিন্তু হাজিরা row ক্যাশ নেই — heal (তারিখ-ইনডেক্স একা যথেষ্ট নয়) */
  function isDaftarSessionCacheStale() {
    ensureSessionCacheHydrated();
    const meta = readSessionCacheMeta();
    const att = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.attendance)
      ? volatileStore[KEYS.attendance]
      : load(KEYS.attendance);
    const current = Array.isArray(att) ? att.length : 0;
    if (meta && meta.daftar_boot) {
      if (current > 0) return false;
      if (loadAttendanceDateIndex().length > 0) return false;
      const expectedDates = Number(meta.att_dates) || 0;
      if (expectedDates > 0) return true;
      const expected = Number(meta.att_count) || 0;
      if (expected > 0) return true;
      const summary = loadDaftarAbsentSummaryRaw();
      return !!(summary && Array.isArray(summary.rows) && summary.rows.length > 0);
    }
    /* অ্যাডমিন ড্যাশবোর্ড bootstrap — ছাত্র/শ্রেণি ওয়ার্ম, daftar_boot নেই, হাজিরা খালি */
    if (current === 0 && isSessionCacheWarm()) {
      if (loadAttendanceDateIndex().length > 0) return true;
      if (hasSessionCacheEntry(KEYS.attendance)) return true;
    }
    return false;
  }

  function writeSessionCache(key, data) {
    if (!DATA_KEYS.has(key)) return;
    try {
      sessionStorage.setItem(sessionCacheStorageKey(key), JSON.stringify(data));
      touchSessionCacheMeta();
    } catch (e) {
      console.warn('[API] session cache write failed', key, e);
    }
  }

  function hydrateSessionCache() {
    sessionHydrateAttempted = true;
    const actor = sessionActorKey();
    if (!actor) return false;
    const meta = readSessionCacheMeta();
    if (!meta || meta.v !== SESSION_CACHE_VERSION || meta.actor !== actor) return false;
    DATA_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(volatileStore, key)) return;
      try {
        const raw = sessionStorage.getItem(sessionCacheStorageKey(key));
        if (raw == null) return;
        volatileStore[key] = JSON.parse(raw);
      } catch (e) {
        console.warn('[API] session cache hydrate failed', key, e);
      }
    });
    return true;
  }

  function ensureSessionCacheHydrated() {
    if (!sessionHydrateAttempted) hydrateSessionCache();
  }

  function clearSessionCache() {
    DATA_KEYS.forEach((key) => {
      try { sessionStorage.removeItem(sessionCacheStorageKey(key)); } catch (e) {}
      delete volatileStore[key];
    });
    try { sessionStorage.removeItem(SESSION_CACHE_META); } catch (e) {}
    try { sessionStorage.removeItem(ABSENT_SUMMARY_KEY); } catch (e) {}
    try { sessionStorage.removeItem(ATTENDANCE_DATES_KEY); } catch (e) {}
    sessionHydrateAttempted = false;
  }

  function hasSessionCacheEntry(key) {
    ensureSessionCacheHydrated();
    if (Object.prototype.hasOwnProperty.call(volatileStore, key)) return true;
    try {
      return sessionStorage.getItem(sessionCacheStorageKey(key)) != null;
    } catch (e) {
      return false;
    }
  }

  function isSessionCacheWarm() {
    ensureSessionCacheHydrated();
    const actor = sessionActorKey();
    if (!actor) return false;
    const meta = readSessionCacheMeta();
    if (!meta || meta.v !== SESSION_CACHE_VERSION || meta.actor !== actor) return false;
    const students = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.students)
      ? volatileStore[KEYS.students]
      : [];
    const classes = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.classes)
      ? volatileStore[KEYS.classes]
      : [];
    return Array.isArray(students) && students.length > 0 && Array.isArray(classes) && classes.length > 0;
  }

  /** দফতর হোম/হাজিরা — এক সেশনে bootstrap-পর নেভে DB আবার নয় */
  function isDaftarSessionCacheWarm() {
    if (!isSessionCacheWarm()) return false;
    if (isDaftarSessionCacheStale()) return false;
    ensureSessionCacheHydrated();
    const meta = readSessionCacheMeta();
    if (meta && meta.daftar_boot) return true;
    const att = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.attendance)
      ? volatileStore[KEYS.attendance]
      : load(KEYS.attendance);
    if (Array.isArray(att) && att.length > 0) return true;
    const summary = loadDaftarAbsentSummaryRaw();
    if (summary && Array.isArray(summary.rows) && summary.rows.length > 0) return true;
    return false;
  }

  function loadDaftarAbsentSummaryRaw() {
    try {
      const raw = sessionStorage.getItem(ABSENT_SUMMARY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.actor !== sessionActorKey()) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function studentAbsentDayCount(by, student) {
    if (!by || !student) return 0;
    const id = String(student.id || '');
    const supa = String(student.supabase_id || student.id || '');
    const perm = String(student.permanent_id || '');
    return by[id] || by[supa] || by[perm] || 0;
  }

  function rebuildDaftarAbsentSummary() {
    const existing = loadDaftarAbsentSummaryRaw();
    const attList = load(KEYS.attendance);
    if (!attList.length && existing && Array.isArray(existing.rows) && existing.rows.length) {
      return existing.rows;
    }
    const by = Attendance.getAbsentStatsByStudent();
    const rows = [];
    Students.getAll().forEach((s) => {
      if (!s || !s.active) return;
      const absentDays = studentAbsentDayCount(by, s);
      if (absentDays <= 0) return;
      const cls = Classes.getById(s.class_id);
      rows.push({
        student: {
          id: s.id,
          name: s.name || '',
          roll: s.roll || '',
          class_id: s.class_id || '',
        },
        absentDays,
        dept: cls && cls.dept === 'maktab' ? 'maktab' : 'kitab',
      });
    });
    rows.sort((a, b) => (b.absentDays || 0) - (a.absentDays || 0));
    if (!rows.length && existing && Array.isArray(existing.rows) && existing.rows.length) {
      return existing.rows;
    }
    try {
      sessionStorage.setItem(ABSENT_SUMMARY_KEY, JSON.stringify({
        actor: sessionActorKey(),
        rows,
        ts: Date.now(),
      }));
    } catch (e) {
      console.warn('[API] absent summary cache write failed', e);
    }
    return rows;
  }

  function loadDaftarAbsentSummaryRows(depts) {
    const parsed = loadDaftarAbsentSummaryRaw();
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    const allowed = Array.isArray(depts) && depts.length ? depts : ['kitab', 'maktab'];
    return parsed.rows.filter((x) => allowed.indexOf(x.dept) >= 0);
  }

  function load(key) {
    if (DATA_KEYS.has(key)) ensureSessionCacheHydrated();
    if (Object.prototype.hasOwnProperty.call(volatileStore, key)) return volatileStore[key];
    if (DATA_KEYS.has(key)) return [];
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }
  function loadObj(key, def = {}) {
    if (DATA_KEYS.has(key)) ensureSessionCacheHydrated();
    if (Object.prototype.hasOwnProperty.call(volatileStore, key)) return volatileStore[key];
    if (DATA_KEYS.has(key)) return def;
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; }
  }
  function save(key, data) {
    volatileStore[key] = data;
    if (DATA_KEYS.has(key)) {
      writeSessionCache(key, data);
      if (key === KEYS.attendance) writeAttendanceDateIndex(Array.isArray(data) ? data : []);
    } else {
      localStorage.setItem(key, JSON.stringify(data));
    }
    if (key === KEYS.settings && typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('mm-settings-updated', { detail: data }));
    }
  }

  function isQuotaError(e) {
    return !!(e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014));
  }

  function compactAttendanceCache(rows, maxDates = 90, requiredDates = []) {
    const list = Array.isArray(rows) ? rows : [];
    const required = new Set((requiredDates || []).map((d) => String(d || '')).filter(Boolean));
    const dates = Array.from(new Set(list.map((a) => String(a && a.date || '')).filter(Boolean)))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, maxDates);
    const keep = new Set(dates.concat(Array.from(required)));
    return list.filter((a) => keep.has(String(a && a.date || '')));
  }

  function saveAttendanceCache(rows, requiredDates = []) {
    const list = Array.isArray(rows) ? rows : [];
    volatileStore[KEYS.attendance] = list;
    writeAttendanceDateIndex(list);
    try {
      save(KEYS.attendance, list);
      volatileStore[KEYS.attendance] = list;
      return;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
    console.warn('[API.Attendance] local cache quota exceeded; compacting attendance cache');
    const windows = [90, 45, 14, 7, 1];
    let lastErr = null;
    for (const days of windows) {
      try {
        save(KEYS.attendance, compactAttendanceCache(list, days, requiredDates));
        volatileStore[KEYS.attendance] = list;
        return;
      } catch (e2) {
        lastErr = e2;
        if (!isQuotaError(e2)) throw e2;
      }
    }
    const required = new Set((requiredDates || []).map((d) => String(d || '')).filter(Boolean));
    if (required.size) {
      try {
        save(KEYS.attendance, list.filter((a) => required.has(String(a && a.date || ''))));
        volatileStore[KEYS.attendance] = list;
        return;
      } catch (e3) {
        lastErr = e3;
        if (!isQuotaError(e3)) throw e3;
      }
    }
    console.warn('[API.Attendance] session cache full; compact persist (memory retains full list)');
    volatileStore[KEYS.attendance] = list;
    persistDaftarAttendanceSessionCache();
  }

  /** দফতর বুটস্ট্র্যাপ পর হাজিরা sessionStorage-এ লেখা নিশ্চিত */
  function persistDaftarAttendanceSessionCache() {
    const list = Object.prototype.hasOwnProperty.call(volatileStore, KEYS.attendance)
      ? volatileStore[KEYS.attendance]
      : load(KEYS.attendance);
    if (!Array.isArray(list)) return false;
    writeAttendanceDateIndex(list);
    const windows = [90, 45, 30, 14, 7, 1];
    for (const days of windows) {
      try {
        writeSessionCache(KEYS.attendance, compactAttendanceCache(list, days));
        volatileStore[KEYS.attendance] = list;
        return true;
      } catch (e) {
        if (!isQuotaError(e)) break;
      }
    }
    if (!list.length) {
      try {
        writeSessionCache(KEYS.attendance, []);
        return true;
      } catch (e2) {
        console.warn('[API] persistDaftarAttendanceSessionCache failed', e2);
      }
    }
    rebuildDaftarAbsentSummary();
    return false;
  }

  function purgeKnownSampleData() {
    const filterKey = (key, isSample) => {
      const rows = load(key);
      if (!rows.length) return;
      const next = rows.filter((row) => !isSample(row));
      if (next.length !== rows.length) save(key, next);
    };
    const sampleStudent = (row) => /^std_([1-9]|[12][0-9]|3[01])$/.test(String(row && row.id || '')) && !row.supabase_id;
    const sampleTeacher = (row) => /^(tch_([1-8]|1[0-4])|daftar|usr_(hifz|lib|alumni|khedmat))$/.test(String(row && row.id || '')) && !row.supabase_id;
    const sampleRef = (row) => {
      const id = String(row && row.id || '');
      return /^(att_d|mm_ex|exam_|r|ktb_|kp_|kh_|log_|fee_|bk_|grp_|al_)_?\d+/.test(id) ||
        /^mm_ex_/.test(id) ||
        sampleStudent({ id: row && row.student_id }) ||
        sampleStudent({ id: row && row.ref_id }) ||
        /^(ktb_|grp_|bk_|al_)\d+/.test(String(row && (row.kitab_id || row.book_id || row.group_id || row.alumni_id) || ''));
    };

    filterKey(KEYS.students, sampleStudent);
    filterKey(KEYS.teachers, sampleTeacher);
    [KEYS.attendance, KEYS.kitabs, KEYS.kitab_prog, KEYS.khuluk, KEYS.exams, KEYS.results, KEYS.logs, KEYS.fees].forEach((key) => filterKey(key, sampleRef));
    ['mm_lib_books', 'mm_lib_issues', 'mm_hifz_groups', 'mm_hifz_progress', 'mm_hifz_members', 'mm_hifz_activity', 'mm_alumni', 'mm_alumni_contacts'].forEach((key) => filterKey(key, sampleRef));
  }

  /** মক্তব: স্থায়ী আইডি digit-only, leading zero সহ; রোল/পরিচিতি `ম` দিয়ে শুরু */
  function bnDigitsToInt(str) {
    if (!str) return 0;
    const t = String(str).trim().replace(/[০-৯]/g, (ch) => {
      const i = '০১২৩৪৫৬৭৮৯'.indexOf(ch);
      return i < 0 ? ch : String(i);
    });
    const digits = t.replace(/[^0-9]/g, '');
    return parseInt(digits, 10) || 0;
  }
  function intToBnPadded(n, minLen) {
    const s = String(n).split('').map((c) => '০১২৩৪৫৬৭৮৯'[Number(c)]).join('');
    return s.length >= minLen ? s : '০'.repeat(minLen - s.length) + s;
  }
  function intToAsciiPadded(n, minLen) {
    return String(n || 0).padStart(minLen, '0');
  }
  function parseMaktabPermanentIdToInt(pid) {
    const s = String(pid || '').trim();
    if (!/^0[0-9০-৯]+$/.test(s)) return 0;
    return bnDigitsToInt(s);
  }

  /* ══════════════════════════════
     LEGACY LOCAL MIGRATIONS
     ══════════════════════════════ */
  function seedIfEmpty() {
    return false;
  }

  /* ══════════════════════════════
     STUDENTS
     ══════════════════════════════ */
  const Students = {
    getAll: () => load(KEYS.students),
    getById: id => load(KEYS.students).find(s => s.id === id),
    getByClass: cid => load(KEYS.students).filter(s => s.class_id === cid && s.active),
    replaceAll(list) {
      const existing = load(KEYS.students);
      const byId = new Map();
      existing.forEach((s) => {
        [s.id, s.supabase_id, s.permanent_id].filter(Boolean).forEach((k) => byId.set(String(k), s));
      });
      const next = (Array.isArray(list) ? list : []).map((s) => {
        const prev = byId.get(String(s.id || '')) || byId.get(String(s.supabase_id || '')) || byId.get(String(s.permanent_id || ''));
        let out = { ...s };
        if (prev && prev.special_watch && s.special_watch == null) out = { ...out, special_watch: true };
        if (prev && prev.alhamdulillah && s.alhamdulillah == null) out = { ...out, alhamdulillah: true };
        if (prev && Array.isArray(prev.program_history) && !Array.isArray(s.program_history)) out = { ...out, program_history: prev.program_history };
        return out;
      });
      save(KEYS.students, next);
    },
    /** কিতাব বা মক্তব বিভাগের সক্রিয় ছাত্র সংখ্যা */
    countActiveByDept(dept) {
      const cids = baseClassIdsByDept(dept);
      return load(KEYS.students).filter((s) => s.active && cids.has(s.class_id)).length;
    },
    add(data) {
      const list = load(KEYS.students);
      const s = { id: 'std_' + uid(), ...data, active: true };
      list.push(s);
      save(KEYS.students, list);
      return s;
    },
    update(id, data) {
      const list = load(KEYS.students).map(s => s.id === id ? { ...s, ...data } : s);
      save(KEYS.students, list);
    },
    markInactive(id, reason, date) {
      const leftDate = date || today();
      const student = load(KEYS.students).find(s => s.id === id);
      if (!student) return null;
      this.update(id, { active: false, status: 'dropped', left_date: leftDate, left_reason: reason || '' });
      const withdrawals = persistLoadArr('mm_withdrawals');
      if (!withdrawals.some(w => w.student_id === id)) {
        withdrawals.push({
          id: 'wd_' + uid(),
          student_id: id,
          student_name: student.name,
          permanent_id: student.permanent_id,
          last_class_id: student.class_id,
          last_roll: student.roll,
          reason: reason || 'বিদায়',
          note: reason || '',
          date: leftDate,
        });
        persistSaveArr('mm_withdrawals', withdrawals);
      }
      const alumni = persistLoadArr('mm_alumni');
      if (!alumni.some(a => a.student_id === id || a.permanent_id === student.permanent_id)) {
        alumni.push({
          id: 'al_' + uid(),
          student_id: id,
          name: student.name,
          permanent_id: student.permanent_id,
          phone: student.phone,
          year: leftDate.slice(0, 4),
          reason: reason || 'মাঝপথে বিদায়',
          location: '',
          status: 'মাঝপথে',
        });
        persistSaveArr('mm_alumni', alumni);
      }
      return { ...student, active: false, status: 'dropped', left_date: leftDate, left_reason: reason || '' };
    },
    promoteClass(id, new_class_id) {
      const list = load(KEYS.students).map(s => {
        if (s.id !== id) return s;
        const history = s.class_history || [];
        history.push({ from: s.class_id, to: new_class_id, date: today() });
        return { ...s, class_id: new_class_id, class_history: history };
      });
      save(KEYS.students, list);
    },
    /**
     * বর্ষ উন্নীতকরণ — bulk year-end promotion
     * changes: [{id, new_class_id, new_roll, action: 'promote'|'repeat'|'alumni_pass'|'dropout'}]
     */
    bulkYearEnd(changes, newHijriYear) {
      const list = load(KEYS.students);
      const withdrawals = persistLoadArr('mm_withdrawals');
      const updated = list.map(s => {
        const c = changes.find(ch => ch.id === s.id);
        if (!c) return s;
        if (c.action === 'alumni_pass' || c.action === 'dropout') {
          withdrawals.push({
            id: 'wd_' + uid(), student_id: s.id, name: s.name,
            permanent_id: s.permanent_id, last_class_id: s.class_id,
            last_roll: s.roll,
            reason: c.action === 'alumni_pass' ? 'পাস করেছেন' : 'মাঝপথে বিদায়',
            date: today(), hijri_year: newHijriYear,
          });
          return { ...s, active: false };
        }
        const history = s.class_history || [];
        history.push({ from: s.class_id, to: c.new_class_id, roll_from: s.roll, roll_to: c.new_roll, date: today(), hijri: newHijriYear });
        return { ...s, class_id: c.new_class_id, roll: c.new_roll, class_history: history };
      });
      save(KEYS.students, updated);
      persistSaveArr('mm_withdrawals', withdrawals);
    },
    /**
     * স্থায়ী আইডি DB তে কারও আছে কিনা (অবস্থা স্বতন্ত্র)।
     */
    isPermanentIdTaken(permanentId) {
      const p = String(permanentId || '').trim();
      if (!p) return false;
      return load(KEYS.students).some((s) => String(s.permanent_id || '').trim() === p);
    },
    /**
     * একই ব্যাচে ইতোমধ্যে বরাদ্দ/ম্যানুয়াল ধরা আইডি (virtual) + DB = পরের ফাঁকা।
     * @param {Set<string>} virtualPids
     */
    getNextPermanentIdRespecting(virtualPids, dept, hijriYear) {
      if (dept === 'maktab') {
        const nums = [];
        const classMap = Object.fromEntries(load(KEYS.classes).map((c) => [c.id, c]));
        load(KEYS.students).forEach((s) => {
          if (s.permanent_id && classMap[s.class_id] && classMap[s.class_id].dept === 'maktab') {
            nums.push(parseMaktabPermanentIdToInt(s.permanent_id));
          }
        });
        if (virtualPids && virtualPids.forEach) {
          virtualPids.forEach((id) => nums.push(parseMaktabPermanentIdToInt(id)));
        }
        const next = nums.length ? Math.max(0, ...nums) + 1 : 1;
        return intToAsciiPadded(next, 6);
      }
      const yr = String(hijriYear).slice(-2);
      const head = yr;
      const takeNum = (pid) => {
        if (!pid || !String(pid).startsWith(head)) return 0;
        return parseInt(String(pid).slice(head.length), 10) || 0;
      };
      const nums = [];
      load(KEYS.students).forEach((s) => {
        if (s.permanent_id) nums.push(takeNum(s.permanent_id));
      });
      if (virtualPids && virtualPids.forEach) {
        virtualPids.forEach((id) => nums.push(takeNum(id)));
      }
      const next = nums.length ? Math.max(...nums) + 1 : 1;
      return head + String(next).padStart(3, '0');
    },
    getNextPermanentId(dept, hijriYear) {
      return Students.getNextPermanentIdRespecting(new Set(), dept, hijriYear);
    },
    /** শিক্ষক কর্তৃক চিহ্নিত বিশেষ পর্যবেক্ষণ */
    countSpecialWatchByDept(dept) {
      const cids = baseClassIdsByDept(dept);
      return load(KEYS.students).filter(
        (s) => s.active && cids.has(s.class_id) && s.special_watch
      ).length;
    },
    getSpecialWatchByDeptSorted(dept) {
      const cids = baseClassIdsByDept(dept);
      return load(KEYS.students)
        .filter((s) => s.active && cids.has(s.class_id) && s.special_watch)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'bn'));
    },
    /** শিক্ষক কর্তৃক চিহ্নিত আলহামদুলিল্লাহ */
    countAlhamdulillahByDept(dept) {
      const cids = baseClassIdsByDept(dept);
      return load(KEYS.students).filter(
        (s) => s.active && cids.has(s.class_id) && s.alhamdulillah
      ).length;
    },
    getAlhamdulillahByDeptSorted(dept) {
      const cids = baseClassIdsByDept(dept);
      return load(KEYS.students)
        .filter((s) => s.active && cids.has(s.class_id) && s.alhamdulillah)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'bn'));
    },
    /**
     * mm_withdrawals — বর্ষ শেষে বা ড্রপআউটে last_class_id অনুসারে।
     * @param {string} classId
     * @param {string|null|undefined} hijriYearFilter — API.Settings-এর hijri_year; null হলে সব
     */
    getWithdrawalsFromClass(classId, hijriYearFilter) {
      const w = persistLoadArr('mm_withdrawals');
      let list = w.filter((x) => x.last_class_id === classId);
      if (hijriYearFilter != null && String(hijriYearFilter).trim() !== '' && String(hijriYearFilter) !== '—') {
        const y = String(hijriYearFilter);
        list = list.filter((x) => String(x.hijri_year || '') === y);
      }
      return list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    },
  };

  /* ══════════════════════════════
     CLASSES
     ══════════════════════════════ */
  const DEFAULT_CLASS_NEXT = {
    cls_k1: 'cls_ky', cls_ky: 'cls_k2', cls_k2: 'cls_k3', cls_k3: 'cls_k4',
    cls_k4: 'cls_k5', cls_k5: 'cls_k6', cls_k6: 'cls_k7',
    cls_k7: 'alumni_pass',
    cls_m1: 'cls_m2', cls_m2: 'cls_m3', cls_m3: 'cls_m4', cls_m4: 'cls_m5',
    cls_m5: 'cls_k1',
  };
  const DEFAULT_CLASS_ORDER = {
    cls_k1: 10, cls_ky: 20, cls_k2: 30, cls_k3: 40, cls_k4: 50,
    cls_k5: 60, cls_k6: 70, cls_k7: 80,
    cls_m1: 10, cls_m2: 20, cls_m3: 30, cls_m4: 40, cls_m5: 50,
  };
  function normalizeClass(c) {
    if (!c) return c;
    return {
      active: c.active !== false,
      sort_order: c.sort_order != null ? Number(c.sort_order) : (DEFAULT_CLASS_ORDER[c.id] || Number(c.year) * 10 || 999),
      next_class_id: c.next_class_id || DEFAULT_CLASS_NEXT[c.id] || 'alumni_pass',
      ...c,
      active: c.active !== false,
    };
  }
  function sortClasses(list) {
    return list.map(normalizeClass).sort((a, b) =>
      (a.dept || '').localeCompare(b.dept || '') ||
      (Number(a.sort_order) || 999).toString().localeCompare((Number(b.sort_order) || 999).toString(), undefined, { numeric: true }) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'bn')
    );
  }
  const Classes = {
    getAll: (includeInactive = false) => sortClasses(load(KEYS.classes).filter(c => isBaseClass(c, includeInactive))),
    getById: id => {
      const c = load(KEYS.classes).find(c => c.id === id);
      return isHifzClass(c) ? null : normalizeClass(c);
    },
    getByDept: (dept, includeInactive = false) => sortClasses(load(KEYS.classes).filter(c => c.dept === dept && isBaseClass(c, includeInactive))),
    getName: id => { const c = load(KEYS.classes).find(c => c.id === id && !isHifzClass(c)); return c ? c.name : '—'; },
    add(data) {
      const list = load(KEYS.classes);
      const id = data.id || 'cls_' + uid();
      const entry = normalizeClass({ active: true, sort_order: 999, next_class_id: 'alumni_pass', ...data, id });
      list.push(entry);
      save(KEYS.classes, list);
      return entry;
    },
    update(id, data) {
      save(KEYS.classes, load(KEYS.classes).map(c => c.id === id ? normalizeClass({ ...c, ...data, id: c.id }) : c));
    },
    replaceAll(list) {
      save(KEYS.classes, Array.isArray(list) ? list.map(normalizeClass) : []);
    },
  };

  /* ══════════════════════════════
     TEACHERS
     ══════════════════════════════ */
  const Teachers = {
    getAll: () => load(KEYS.teachers),
    getById: id => load(KEYS.teachers).find(t => t.id === id),
    getByClassId: cid => load(KEYS.teachers).find(t => t.class_id === cid && t.is_active !== false),
    replaceAll(list) {
      save(KEYS.teachers, Array.isArray(list) ? list : []);
    },
    /** ওই বিভাগের ক্লাসে নিয়োজিত শিক্ষক (ক্লাসবিহীন স্টাফ বাদ) */
    getByDept(dept) {
      const cids = new Set(Classes.getByDept(dept).map(c => c.id));
      return load(KEYS.teachers)
        .filter(t => t.class_id && t.is_active !== false && cids.has(t.class_id))
        .sort((a, b) => {
          const classA = Classes.getById(a.class_id)?.name || '';
          const classB = Classes.getById(b.class_id)?.name || '';
          const byClass = classA.localeCompare(classB, 'bn');
          if (byClass !== 0) return byClass;
          return String(a.name || '').localeCompare(String(b.name || ''), 'bn');
        });
    },
    verifyPin(id, pin) { const t = load(KEYS.teachers).find(t => t.id === id); return t && t.pin === pin; },
    changeOwnPin(id, currentPin, newPin) {
      const list = load(KEYS.teachers);
      const t = list.find(t => t.id === id);
      if (!t || t.pin !== currentPin) return false;
      save(KEYS.teachers, list.map(t => t.id === id ? { ...t, pin: newPin } : t));
      return true;
    },
    update(id, data) {
      save(KEYS.teachers, load(KEYS.teachers).map(t => t.id === id ? { ...t, ...data } : t));
    },
    add(data) {
      const list = load(KEYS.teachers);
      const t = { id: 'tch_' + uid(), ...data };
      list.push(t);
      save(KEYS.teachers, list);
      return t;
    },
  };

  /* ══════════════════════════════
     ATTENDANCE
     স্ট্যাটাস: 'present' | 'absent' | 'holiday'
     'leave' পুরনো ডেটায় থাকতে পারে — মাইগ্রেশনে absent হয়
     ══════════════════════════════ */
  const Attendance = {
    statusOf(a) {
      if (!a) return 'present';
      if (a.status === 'present' || a.status === 'absent' || a.status === 'holiday') return a.status;
      if (a.status === 'leave') return 'absent';
      return a.present ? 'present' : 'absent';
    },
    getByDate(date) {
      const iso = String(date || '').slice(0, 10);
      if (!iso) return [];
      return load(KEYS.attendance).filter((a) => String(a.date || '').slice(0, 10) === iso);
    },
    /** সেশন ক্যাশ/তারিখ-ইনডেক্স — অডিট ক্যালেন্ডারে “হাজিরা নেওয়া হয়েছে” */
    hasAnyForDate(date) {
      const iso = String(date || '').slice(0, 10);
      if (!iso) return false;
      if (this.getByDate(iso).length > 0) return true;
      return loadAttendanceDateIndex().includes(iso);
    },
    getAll: () => load(KEYS.attendance).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    replaceAll(list) {
      saveAttendanceCache(Array.isArray(list) ? list : []);
    },
    replaceDate(date, rows) {
      const day = String(date || '').slice(0, 10);
      if (!day) return;
      const incoming = (Array.isArray(rows) ? rows : []).filter(a => String(a.date || '').slice(0, 10) === day);
      const next = load(KEYS.attendance).filter(a => String(a.date || '').slice(0, 10) !== day).concat(incoming);
      saveAttendanceCache(next, [day]);
    },
    /** সেভের পর গেট/অডিট — তারিখ ইনডেক্সে নিশ্চিত */
    noteDateSaved(date) {
      const iso = String(date || '').slice(0, 10);
      if (!iso) return;
      writeAttendanceDateIndex([{ date: iso }]);
      try { persistDaftarAttendanceSessionCache(); } catch (e) {}
    },
    /** ছাত্রের সকল হাজিরা রেকর্ড — নতুন থেকে পুরনো */
    getByStudent: sid =>
      load(KEYS.attendance)
        .filter(a => a.student_id === sid)
        .sort((a, b) => b.date.localeCompare(a.date)),
    getByStudentDate: (sid, date) => load(KEYS.attendance).find(a => a.student_id === sid && a.date === date),
    getByClassDate(cid, date) {
      const iso = String(date || '').slice(0, 10);
      const sidSet = studentIdSetForClass(cid);
      return load(KEYS.attendance).filter(a =>
        String(a.date || '').slice(0, 10) === iso && sidSet.has(String(a.student_id || ''))
      );
    },
    /**
     * @param statusIn 'present' | 'absent' | 'holiday' | boolean (legacy)
     * @param absentReason শুধু status absent হলে — অনুপস্থিতির কারণ
     */
    save(student_id, date, statusIn, absentReason) {
      let status;
      if (statusIn === true || statusIn === 'present') status = 'present';
      else if (statusIn === false || statusIn === 'absent' || statusIn === 'leave') status = 'absent';
      else if (statusIn === 'holiday') status = 'holiday';
      else status = 'absent';
      const hijri_year = (Settings.get().hijri_year || '').trim() || null;
      const list = load(KEYS.attendance);
      const idx = list.findIndex(a => a.student_id === student_id && a.date === date);
      const prev = idx >= 0 ? list[idx] : null;
      const id = prev ? prev.id : uid();
      const reasonIn =
        typeof absentReason === 'string' ? absentReason.trim() : (prev && prev.absent_reason) ? String(prev.absent_reason).trim() : '';
      const row = { id, student_id, date, status };
      if (hijri_year) row.hijri_year = hijri_year;
      if (status === 'absent') row.absent_reason = reasonIn;
      if (idx >= 0) list[idx] = row;
      else list.push(row);
      save(KEYS.attendance, list);
    },
    getSummary(cid, month) {
      const sids = Students.getByClass(cid).map(s => s.id);
      const records = load(KEYS.attendance).filter(a => sids.includes(a.student_id) && a.date.startsWith(month));
      const present = records.filter(a => this.statusOf(a) === 'present').length;
      const absent = records.filter(a => this.statusOf(a) === 'absent').length;
      const holiday = records.filter(a => this.statusOf(a) === 'holiday').length;
      const total = present + absent;
      return { total, present, absent, holiday, pct: total ? Math.round(present / total * 100) : 0 };
    },
    getTodaySummary() {
      return this.getDateSummary(today());
    },
    getDateSummary(date) {
      const all = load(KEYS.attendance).filter(a => a.date === date);
      const st = a => this.statusOf(a);
      const present = all.filter(a => st(a) === 'present').length;
      const absent = all.filter(a => st(a) === 'absent').length;
      const holiday = all.filter(a => st(a) === 'holiday').length;
      return { present, absent, holiday, total: present + absent };
    },
    getDateSummaryForDept(date, dept) {
      if (dept !== 'kitab' && dept !== 'maktab') return this.getDateSummary(date);
      const cids = new Set(Classes.getByDept(dept).map(c => c.id));
      const sidSet = new Set();
      Students.getAll().filter(s => s.active && cids.has(s.class_id)).forEach((s) => {
        sidSet.add(String(s.id || ''));
        if (s.supabase_id) sidSet.add(String(s.supabase_id));
      });
      const iso = String(date || '').slice(0, 10);
      const all = load(KEYS.attendance).filter(a =>
        String(a.date || '').slice(0, 10) === iso && sidSet.has(String(a.student_id || ''))
      );
      const st = (a) => this.statusOf(a);
      const present = all.filter((a) => st(a) === 'present').length;
      const absent = all.filter((a) => st(a) === 'absent').length;
      const holiday = all.filter((a) => st(a) === 'holiday').length;
      return { present, absent, holiday, total: present + absent };
    },
    /** ছাত্র প্রতি মোট অনুপস্থিত দিন (স্ট্যাটাস absent, holiday বাদ) */
    getAbsentStatsByStudent() {
      const byStudent = {};
      load(KEYS.attendance).forEach((a) => {
        if (this.statusOf(a) !== 'absent') return;
        const sid = String(a.student_id || '');
        if (!sid) return;
        byStudent[sid] = (byStudent[sid] || 0) + 1;
      });
      return byStudent;
    },
    /** যে ছাত্রদের কমপক্ষে এক দিন অনুপস্থিত রেকর্ড আছে — অনুপস্থিত দিন বেশি থেকে কম */
    getStudentsWithAbsentSorted() {
      const by = this.getAbsentStatsByStudent();
      return Students.getAll()
        .filter((s) => s.active)
        .map((s) => ({ student: s, absentDays: studentAbsentDayCount(by, s) }))
        .filter((x) => x.absentDays > 0)
        .sort((a, b) => b.absentDays - a.absentDays);
    },
    getStudentsWithAbsentSortedByDept(dept) {
      if (dept !== 'kitab' && dept !== 'maktab') return this.getStudentsWithAbsentSorted();
      const cids = new Set(Classes.getByDept(dept).map((c) => c.id));
      const by = this.getAbsentStatsByStudent();
      return Students.getAll()
        .filter((s) => s.active && cids.has(s.class_id))
        .map((s) => ({ student: s, absentDays: studentAbsentDayCount(by, s) }))
        .filter((x) => x.absentDays > 0)
        .sort((a, b) => b.absentDays - a.absentDays);
    },
    countStudentsWithAnyAbsentByDept(dept) {
      return this.getStudentsWithAbsentSortedByDept(dept).length;
    },
    /**
     * ছাত্রের নির্দিষ্ট শিক্ষাবর্ষের হাজিরার সারসংক্ষেপ।
     * holiday বাদে মোট পাঠদান দিন ভিত্তিতে হিসাব।
     */
    getStudentYearSummary(student_id, hijri_year) {
      let recs = load(KEYS.attendance).filter(a => a.student_id === student_id);
      if (hijri_year) recs = recs.filter(a => (a.hijri_year || '') === String(hijri_year));
      const present = recs.filter(a => this.statusOf(a) === 'present').length;
      const absent = recs.filter(a => this.statusOf(a) === 'absent').length;
      const holiday = recs.filter(a => this.statusOf(a) === 'holiday').length;
      const schoolDays = present + absent;
      return { present, absent, holiday, schoolDays, pct: schoolDays ? Math.round(present / schoolDays * 100) : null };
    },
  };

  /* ══════════════════════════════
     KITAB PROGRESS
     ══════════════════════════════ */
  const KitabProgress = {
    getByClass: cid => {
      const kitabs = load(KEYS.kitabs).filter(k => k.class_id === cid);
      const prog = load(KEYS.kitab_prog);
      return kitabs.map(k => {
        const entries = prog.filter(p => String(p.kitab_id) === String(k.id));
        const teacherEntries = entries.filter(p => !String(p.id || '').endsWith('_current'));
        const snapshot = entries.find(p => String(p.id || '').endsWith('_current'));
        const sorted = teacherEntries.slice().sort((a, b) =>
          String(b.date || '').localeCompare(String(a.date || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        );
        const latestTeacher = sorted[0] || null;
        const pagesFromTeacher = latestTeacher ? Number(latestTeacher.pages_done) : NaN;
        const pagesFromSnap = snapshot ? Number(snapshot.pages_done) : NaN;
        const pages_done = Number.isFinite(pagesFromTeacher)
          ? pagesFromTeacher
          : (Number.isFinite(pagesFromSnap) ? pagesFromSnap : 0);
        const last_updated = latestTeacher
          ? latestTeacher.date
          : (snapshot ? snapshot.date : null);
        const history = teacherEntries.length ? teacherEntries : entries;
        return { ...k, pages_done, last_updated, history };
      });
    },
    update(kitab_id, class_id, pages_done, note = '') {
      const td = today();
      const list = load(KEYS.kitab_prog).filter(p => !(p.kitab_id === kitab_id && p.date === td));
      list.push({ id: uid(), kitab_id, class_id, date: td, pages_done, note });
      save(KEYS.kitab_prog, list);
    },
    addKitab(data) {
      const list = load(KEYS.kitabs);
      const k = { id: 'ktb_' + uid(), ...data };
      list.push(k);
      save(KEYS.kitabs, list);
      return k;
    },
    getKitabsByClass: cid => load(KEYS.kitabs).filter(k => k.class_id === cid),
    /** নতুন শিক্ষাবর্ষে সব progress রিসেট */
    resetAllProgress() { save(KEYS.kitab_prog, []); },
  };

  /* ══════════════════════════════
     KHULUK (হুসনুল খুলুক)
     ══════════════════════════════ */
  function khulukSortValue(k) {
    return String((k && (k.at || k.evaluated_at || k.created_at || k.date)) || '');
  }

  function sortKhulukRows(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) =>
      khulukSortValue(b).localeCompare(khulukSortValue(a)) ||
      String(b && b.id || '').localeCompare(String(a && a.id || ''))
    );
  }

  const Khuluk = {
    getByStudent: sid => sortKhulukRows(load(KEYS.khuluk).filter(k => k.student_id === sid)),
    getLatest: sid => { const list = Khuluk.getByStudent(sid); return list[0] || null; },
    add(student_id, score, reason, by) {
      const list = load(KEYS.khuluk);
      const entry = { id: uid(), student_id, score: parseInt(score), reason, date: today(), at: now(), by };
      list.push(entry);
      save(KEYS.khuluk, list);
      return entry;
    },
    update(id, data) {
      const list = load(KEYS.khuluk).map(k => k.id === id ? { ...k, ...data } : k);
      save(KEYS.khuluk, list);
    },
    getClassAvg(cid) {
      const sids = Students.getByClass(cid).map(s => s.id);
      const scores = sids.map(sid => { const k = Khuluk.getLatest(sid); return k ? k.score : null; }).filter(s => s !== null);
      return scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : null;
    },
    /** সর্বশেষ হুসনুল খুলুক: ৮১+ মুস্তাহিদ, ৬০–৮০ মুতাওয়াস্সিত, ৬০-এর নিচে মুজতাহিদ, রেকর্ড ছাড়া আলাদা (মেইন এডমিন ও বর্ষ পেজ এক মাপ) */
    getClassKhulukBands(cid) {
      const sids = Students.getByClass(cid).map(s => s.id);
      const out = { high: 0, mid: 0, low: 0, none: 0, total: sids.length };
      sids.forEach((sid) => {
        const k = Khuluk.getLatest(sid);
        if (!k) { out.none++; return; }
        const sc = Number(k.score);
        if (Number.isNaN(sc)) { out.none++; return; }
        if (sc >= 81) out.high++;
        else if (sc >= 60) out.mid++;
        else out.low++;
      });
      return out;
    },
    /** বর্ষের সক্রিয় ছাত্রদের — সর্বশেষ খুলুক এন্ট্রি, তারিখ অনুসারে */
    getRecentByClass(classId, limit = 12) {
      const sids = new Set(Students.getByClass(classId).map((s) => s.id));
      return sortKhulukRows(load(KEYS.khuluk).filter((k) => sids.has(k.student_id))).slice(0, limit);
    },
  };

  /* ══════════════════════════════
     LOGS
     ══════════════════════════════ */
  const Logs = {
    getByClass: cid => load(KEYS.logs).filter(l => l.type === 'class' && l.ref_id === cid).sort((a,b) => b.date.localeCompare(a.date)),
    getByStudent: sid => load(KEYS.logs).filter(l => l.type === 'student' && l.ref_id === sid).sort((a,b) => b.date.localeCompare(a.date)),
    getByTeacher: tid => load(KEYS.logs).filter(l => l.type === 'teacher' && l.ref_id === tid).sort((a,b) => b.date.localeCompare(a.date)),
    add(type, ref_id, text, by, tag = 'normal', extra) {
      const list = load(KEYS.logs);
      const entry = {
        id: uid(), type, ref_id, text, date: today(), by, tag,
        reviewRequested: !!(extra && extra.reviewRequested),
        reviewedAt: null,
        reviewedByName: '',
        adminReply: '',
      };
      list.push(entry);
      save(KEYS.logs, list);
      return entry;
    },
    update(id, data) {
      const list = load(KEYS.logs).map(l => l.id === id ? { ...l, ...data } : l);
      save(KEYS.logs, list);
    },
    remove(id) {
      const list = load(KEYS.logs).filter(l => l.id !== id);
      save(KEYS.logs, list);
    },
    getAll: () => load(KEYS.logs).sort((a,b) => b.date.localeCompare(a.date))
  };

  /* ══════════════════════════════
     FEES SUMMARY
     ══════════════════════════════ */
  const Fees = {
    getByClass: cid => load(KEYS.fees).filter(f => f.class_id === cid).sort((a,b) => b.month.localeCompare(a.month)),
    getLatest: cid => { const list = load(KEYS.fees).filter(f => f.class_id === cid).sort((a,b) => b.month.localeCompare(a.month)); return list[0] || null; },
    add(data) {
      const list = load(KEYS.fees);
      const entry = { id: uid(), date: today(), ...data };
      list.push(entry);
      save(KEYS.fees, list);
      return entry;
    }
  };

  /* ══════════════════════════════
     EXAMS & RESULTS
     ══════════════════════════════ */
  const Exams = {
    getAll: () => load(KEYS.exams),
    getByClass: cid => load(KEYS.exams).filter(e => e.class_id === cid),
    add(data) {
      const list = load(KEYS.exams);
      const e = { id: 'exam_' + uid(), ...data, created: today() };
      list.push(e);
      save(KEYS.exams, list);
      return e;
    },
    addResult(data) {
      const list = load(KEYS.results);
      const existing = list.findIndex(r => r.exam_id === data.exam_id && r.student_id === data.student_id);
      const entry = { id: uid(), date: today(), ...data };
      if (existing >= 0) list[existing] = entry;
      else list.push(entry);
      save(KEYS.results, list);
      return entry;
    },
    getResults: exam_id => load(KEYS.results).filter(r => r.exam_id === exam_id),
    getStudentResults: sid => load(KEYS.results).filter(r => r.student_id === sid),
    update(exam_id, data) {
      save(KEYS.exams, load(KEYS.exams).map(e => e.id === exam_id ? { ...e, ...data } : e));
    },
    delete(exam_id) {
      save(KEYS.exams, load(KEYS.exams).filter(e => e.id !== exam_id));
      save(KEYS.results, load(KEYS.results).filter(r => r.exam_id !== exam_id));
    },
  };

  /* ══════════════════════════════
     SETTINGS
     ══════════════════════════════ */
  const Settings = {
    get: () => loadObj(KEYS.settings, {}),
    save: data => save(KEYS.settings, data),
  };

  /** Raw localStorage array helpers — used by feature pages until moved into domain APIs. */
  function persistLoadArr(storageKey) {
    if (DATA_KEYS.has(storageKey)) {
      ensureSessionCacheHydrated();
      return Object.prototype.hasOwnProperty.call(volatileStore, storageKey) ? volatileStore[storageKey] : [];
    }
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  }
  function persistSaveArr(storageKey, data) {
    if (DATA_KEYS.has(storageKey)) {
      volatileStore[storageKey] = data;
      writeSessionCache(storageKey, data);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  function isHifzClass(c) {
    if (!c) return false;
    const id = String(c.id || '').trim();
    const code = String(c.code || '').trim();
    const year = String(c.year || '').trim();
    const name = String(c.name || '').trim();
    return id === 'cls_kh' ||
      id === 'cls_hifz' ||
      code === 'kitab_hifz' ||
      year === 'hifz' ||
      name === 'হেফয' ||
      name === 'হিফজ বিভাগ';
  }

  function isBaseClass(c, includeInactive) {
    return !!c && !isHifzClass(c) && (includeInactive || c.active !== false);
  }

  function baseClassIdsByDept(dept) {
    return new Set(load(KEYS.classes).filter((c) => isBaseClass(c, false) && c.dept === dept).map((c) => c.id));
  }

  function migrateAttendanceStatus() {
    const list = load(KEYS.attendance);
    const needsMigration = list.some(a =>
      (a.present !== undefined && !a.status) || a.status === 'leave'
    );
    if (!needsMigration) return;
    save(KEYS.attendance, list.map(a => {
      const next = { ...a };
      if (!next.status && next.present !== undefined) {
        next.status = next.present ? 'present' : 'absent';
        delete next.present;
      }
      if (next.status === 'leave') next.status = 'absent';
      return next;
    }));
  }

  /* ══════════════════════════════
     SESSIONS — শিক্ষাবর্ষ সেশন
     { id, hijri_year, start_date, end_date|null }
     ══════════════════════════════ */
  const Sessions = {
    getAll: () => load(KEYS.sessions),
    getCurrent() {
      const s = Settings.get();
      return load(KEYS.sessions).find(s2 => !s2.end_date) || null;
    },
    /**
     * প্রথম সেটআপ বা নতুন বর্ষ শুরু করার সময় call করুন।
     * আগের open সেশন থাকলে সেটা end_date দিয়ে বন্ধ করে নতুনটা খোলে।
     */
    startNew(hijri_year, start_date) {
      const list = load(KEYS.sessions);
      const prev = list.find(s => !s.end_date);
      const today_ = today();
      if (prev) prev.end_date = today_;
      list.push({ id: uid(), hijri_year: String(hijri_year), start_date: start_date || today_, end_date: null });
      save(KEYS.sessions, list);
    },
    /** বর্তমান সেশন শেষ করুন (end_date সেট) */
    endCurrent(end_date) {
      const list = load(KEYS.sessions);
      const cur = list.find(s => !s.end_date);
      if (cur) { cur.end_date = end_date || today(); save(KEYS.sessions, list); }
    },
    /** চালু সেশনের start_date (সেটিংসে শিক্ষাবর্ষ শুরু) আপডেট */
    setCurrentStartDate(iso) {
      if (!iso) return;
      const list = load(KEYS.sessions);
      const cur = list.find(s2 => !s2.end_date);
      if (!cur) return;
      cur.start_date = String(iso).trim();
      save(KEYS.sessions, list);
    },
    ensureInitialized() {
      if (this.getCurrent()) return;
      const s = Settings.get();
      const sd = (s.session_start_date || '').trim();
      if (!sd) return;
      let hy = (s.hijri_year || '').trim();
      if (!hy || hy === '—') hy = '১৪৪৭';
      this.startNew(hy, sd);
    },
  };

  /* ══════════════════════════════
     HOLIDAYS — বিরতির দিন (শ্রেণিব্যাপী)
     { id, from_date, to_date, note }
     বিরতির দিনে সব ছাত্রের status='holiday' সংরক্ষণ হয়
     ══════════════════════════════ */
  const Holidays = {
    getAll: () => load(KEYS.holidays),
    /**
     * from_date থেকে to_date পর্যন্ত সব ছাত্রের হাজিরা 'holiday' হিসেবে save করে।
     * প্রতিটি তারিখে API.Attendance.save call করে।
     */
    markRange(from_date, to_date, note) {
      const d1 = new Date(from_date + 'T12:00:00');
      const d2 = new Date(to_date + 'T12:00:00');
      if (isNaN(d1) || isNaN(d2) || d1 > d2) return 0;
      const students = Students.getAll().filter(s => s.active);
      let days = 0;
      for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().split('T')[0];
        students.forEach(s => Attendance.save(s.id, iso, 'holiday'));
        days++;
      }
      const list = load(KEYS.holidays);
      list.push({ id: uid(), from_date, to_date, note: note || '', created_at: now() });
      save(KEYS.holidays, list);
      return days;
    },
    isHoliday(date) {
      return load(KEYS.holidays).some(h => date >= h.from_date && date <= h.to_date);
    },
    remove(id) {
      save(KEYS.holidays, load(KEYS.holidays).filter(h => h.id !== id));
    },
  };

  /** পুরনো ডেটায় মক্তব বর্ষের নাম: মক্তব ১ম → প্রথম শ্রেণি ইত্যাদি (কাস্টম নাম স্পর্শ করে না) */
  function migrateMaktabClassNames() {
    const nextName = {
      cls_m1: 'প্রথম শ্রেণি',
      cls_m2: 'দ্বিতীয় শ্রেণি',
      cls_m3: 'তৃতীয় শ্রেণি',
      cls_m4: 'চতুর্থ শ্রেণি',
      cls_m5: 'পঞ্চম শ্রেণি',
    };
    const oldName = {
      cls_m1: 'মক্তব ১ম',
      cls_m2: 'মক্তব ২য়',
      cls_m3: 'মক্তব ৩য়',
      cls_m4: 'মক্তব ৪র্থ',
      cls_m5: 'মক্তব ৫ম',
    };
    const list = load(KEYS.classes);
    let changed = false;
    const next = list.map((c) => {
      const nn = nextName[c.id];
      const on = oldName[c.id];
      if (!nn || !on) return c;
      if (c.name === nn) return c;
      if (c.name !== on) return c;
      changed = true;
      return { ...c, name: nn };
    });
    if (changed) save(KEYS.classes, next);
  }

  const OldMadrasaImport = {
    summarize(pack) {
      const data = pack || {};
      const hifzClassIds = new Set((Array.isArray(data.classes) ? data.classes : []).filter(isHifzClass).map((c) => c.id));
      const classes = (Array.isArray(data.classes) ? data.classes : []).filter((c) => !hifzClassIds.has(c.id) && !isHifzClass(c));
      const students = (Array.isArray(data.students) ? data.students : []).filter((s) => !hifzClassIds.has(s.class_id));
      const kitabs = (Array.isArray(data.kitabs) ? data.kitabs : []).filter((k) => !hifzClassIds.has(k.class_id));
      return {
        classes: classes.length,
        students: students.length,
        kitabs: kitabs.length,
      };
    },
    replaceCoreData(pack) {
      if (!pack || !Array.isArray(pack.classes) || !Array.isArray(pack.students) || !Array.isArray(pack.kitabs)) {
        throw new Error('invalid import pack');
      }
      const hifzClassIds = new Set(pack.classes.filter(isHifzClass).map((c) => c.id));
      const baseClassIds = new Set(pack.classes.filter((c) => !hifzClassIds.has(c.id) && !isHifzClass(c)).map((c) => c.id));
      save(KEYS.classes, pack.classes.filter((c) => baseClassIds.has(c.id)).map(normalizeClass));
      save(KEYS.students, pack.students.map((s) => {
        if (!hifzClassIds.has(s.class_id)) return s;
        return { ...s, class_id: '', hifz: true, active: false, import_needs_review: true };
      }));
      save(KEYS.kitabs, pack.kitabs.filter((k) => baseClassIds.has(k.class_id)));
      save(KEYS.kitab_prog, Array.isArray(pack.kitab_progress) ? pack.kitab_progress : []);
      [KEYS.attendance, KEYS.khuluk, KEYS.logs, KEYS.fees, KEYS.exams, KEYS.results].forEach((key) => save(key, []));
      persistSaveArr('mm_withdrawals', []);
      return this.summarize(pack);
    },
  };

  /* ── INIT ── */
  seedIfEmpty();
  purgeKnownSampleData();
  migrateAttendanceStatus();
  migrateMaktabClassNames();
  Sessions.ensureInitialized();

  /* ── PUBLIC API ── */
  return {
    Students, Classes, Teachers, Attendance, KitabProgress, Khuluk, Logs, Fees, Exams,
    Settings, Sessions, Holidays,
    OldMadrasaImport,
    persistLoadArr, persistSaveArr,
    hydrateSessionCache, clearSessionCache, isSessionCacheWarm, isDaftarSessionCacheWarm, hasSessionCacheEntry,
    markDaftarBootstrapComplete, persistDaftarAttendanceSessionCache, applyAttendanceDateIndexFromServer,
    isAdminMadrasaExtrasWarm, markAdminMadrasaBootstrapComplete,
    rebuildDaftarAbsentSummary, loadDaftarAbsentSummaryRows, loadDaftarAbsentSummaryRaw,
    uid, today, now, esc, escBn, toBn,
  };

})();

if (typeof globalThis !== 'undefined' && typeof API !== 'undefined') {
  globalThis.API = API;
  globalThis.toBn = API.toBn;
  globalThis.escBn = API.escBn;
}
