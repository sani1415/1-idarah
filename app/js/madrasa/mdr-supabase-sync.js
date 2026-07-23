/* Bridge Supabase madrasa students into the prototype API cache. */
(function (global) {
  'use strict';

  var CLASS_CODE_TO_LOCAL_ID = {
    kitab_y1: 'cls_k1',
    kitab_iyada: 'cls_ky',
    kitab_y2: 'cls_k2',
    kitab_y3: 'cls_k3',
    kitab_y4: 'cls_k4',
    kitab_y5: 'cls_k5',
    kitab_y6: 'cls_k6',
    kitab_y7: 'cls_k7',
    maktab_y1: 'cls_m1',
    maktab_y2: 'cls_m2',
    maktab_y3: 'cls_m3',
    maktab_y4: 'cls_m4',
    maktab_y5: 'cls_m5',
  };

  var LOCAL_ID_TO_CLASS_CODE = {};
  Object.keys(CLASS_CODE_TO_LOCAL_ID).forEach(function (code) {
    LOCAL_ID_TO_CLASS_CODE[CLASS_CODE_TO_LOCAL_ID[code]] = code;
  });

  var SUPA_ROLE_TO_LOCAL = {
    madrasa_teacher: 'teacher',
    daftar: 'daftar',
    hifz: 'hifz',
    library: 'library',
    alumni_tracker: 'alumni',
    khedmat: 'khedmat',
    restricted_admin: 'restricted_admin',
  };

  function toLocalStudent(row) {
    return {
      id: String(row.id || row.student_id || ''),
      permanent_id: row.student_id || '',
      name: row.name || '',
      class_id: row.class_code === 'kitab_hifz' ? '' : (CLASS_CODE_TO_LOCAL_ID[row.class_code] || row.class_code || ''),
      roll: row.current_roll || '',
      guardian: row.guardian_name || '',
      guardian_job: '',
      phone: row.guardian_phone || '',
      district: row.district || '',
      upazila: row.upazila || '',
      status: row.status || 'active',
      active: row.status !== 'dropped' && row.status !== 'alumni',
      hifz: !!row.is_hifz || row.class_code === 'kitab_hifz',
      // row-এ কী নেই (কোনো bootstrap ভবিষ্যতে এই ফিল্ড বাদ দিলে) তা undefined-ই থাকুক,
      // false-এ coerce না করে — যাতে api.js-এর merge guard (prev true, নতুন null/undefined
      // হলে পুরনো true রক্ষা করা) আসলে কাজ করে; সরাসরি false বসালে সেই guard কখনো ধরতে পারে না।
      special_watch: row.special_watch == null ? undefined : !!row.special_watch,
      alhamdulillah: row.alhamdulillah == null ? undefined : !!row.alhamdulillah,
      left_date: row.left_date || '',
      left_reason: row.left_reason || '',
      supabase_id: row.id || '',
    };
  }

  function syncAlumniRows(rows) {
    var withdrawals = [];
    var alumni = [];
    var existingAlumni = API.persistLoadArr ? API.persistLoadArr('mm_alumni') : [];
    var existingById = {};
    existingAlumni.forEach(function (row) {
      existingById[String(row.id || row.student_id || '')] = row;
    });
    (rows || []).forEach(function (r) {
      var id = String(r.id || r.student_id || '');
      var prev = existingById[id] || {};
      var studentUuid = String(r.student_id || r.id || '');
      var lastClass = CLASS_CODE_TO_LOCAL_ID[r.class_code] || r.class_code || '';
      var division = String(r.division_code || '').trim();
      if (!division && lastClass) {
        if (String(lastClass).indexOf('cls_k') === 0 || String(lastClass).indexOf('kitab') === 0) division = 'kitab';
        else if (String(lastClass).indexOf('cls_m') === 0 || String(lastClass).indexOf('maktab') === 0) division = 'maktab';
      }
      withdrawals.push({
        id: id,
        student_id: studentUuid,
        student_name: r.name || '',
        permanent_id: r.permanent_id || '',
        last_class_id: lastClass,
        division_code: division,
        reason: r.left_reason || (r.left_type === 'completed' ? 'পড়া শেষ' : 'মাঝপথে বিদায়'),
        note: r.left_reason || '',
        date: String(r.left_date || ''),
      });
      alumni.push(Object.assign({}, prev, {
        id: id,
        student_id: studentUuid,
        name: r.name || '',
        permanent_id: r.permanent_id || '',
        phone: r.phone || prev.phone || '',
        year: String(r.left_date || '').slice(0, 4) || prev.year || '',
        reason: r.left_reason || prev.reason || '',
        location: prev.location || '',
        latest_verified_status: prev.latest_verified_status || '',
        status: r.status || (r.left_type === 'completed' ? 'সম্পন্ন' : 'মাঝপথে'),
        source_type: 'current_student',
        left_date: r.left_date || '',
        left_type: r.left_type || '',
        class_code: r.class_code || '',
        class_name: r.class_name || '',
        division_code: division || prev.division_code || '',
      }));
    });
    if (API.persistSaveArr) {
      API.persistSaveArr('mm_withdrawals', withdrawals);
      var incomingIds = {};
      alumni.forEach(function (row) { incomingIds[String(row.id || '')] = true; });
      var keep = existingAlumni.filter(function (row) {
        var id = String(row.id || row.student_id || '');
        return !incomingIds[id] && row.source_type !== 'current_student';
      });
      API.persistSaveArr('mm_alumni', keep.concat(alumni));
    }
  }

  function mergeScopedArray(storageKey, scopeFn, incoming) {
    if (!API.persistLoadArr || !API.persistSaveArr) return;
    var keep = API.persistLoadArr(storageKey).filter(function (row) {
      return !scopeFn(row);
    });
    API.persistSaveArr(storageKey, keep.concat(incoming || []));
  }

  function syncTeacherExtras(res, classId) {
    if (!res || !classId || !global.API) return;
    var classCode = LOCAL_ID_TO_CLASS_CODE[classId] || '';
    var studentIds = {};
    API.Students.getByClass(classId).forEach(function (s) {
      studentIds[String(s.id)] = true;
      if (s.supabase_id) studentIds[String(s.supabase_id)] = true;
    });

    var books = (res.books || []).map(function (b) {
      return {
        id: String(b.id || ''),
        name: b.name || '',
        class_id: CLASS_CODE_TO_LOCAL_ID[b.class_code] || b.class_code || classId,
        total_pages: b.total_pages,
        sort_order: b.sort_order || 0,
        is_active: b.is_active !== false,
      };
    });
    mergeScopedArray('mm_kitabs', function (b) { return b.class_id === classId; }, books);

    var progress = [];
    (res.books || []).forEach(function (b) {
      if (b.pages_done == null) return;
      progress.push({
        id: String(b.id || '') + '_current',
        kitab_id: String(b.id || ''),
        class_id: CLASS_CODE_TO_LOCAL_ID[b.class_code] || b.class_code || classId,
        date: String(b.updated_at || '').slice(0, 10) || API.today(),
        pages_done: Number(b.pages_done) || 0,
        note: b.notes || '',
      });
    });
    (res.book_progress_history || []).forEach(function (h) {
      progress.push({
        id: String(h.id || ''),
        kitab_id: String(h.book_id || ''),
        class_id: CLASS_CODE_TO_LOCAL_ID[h.class_code] || h.class_code || classId,
        date: String(h.date || '').slice(0, 10) || API.today(),
        pages_done: Number(h.pages_done) || 0,
        note: h.note || '',
        by: h.by || '',
      });
    });
    mergeScopedArray('mm_kitab_progress', function (p) { return p.class_id === classId; }, progress);

    var akhlaq = (res.akhlaq || []).map(function (a) {
      return {
        id: String(a.id || ''),
        student_id: String(a.student_id || ''),
        score: Number(a.score) || 0,
        reason: a.reason || '',
        date: String(a.date || '').slice(0, 10) || API.today(),
        at: String(a.at || a.evaluated_at || a.created_at || a.date || ''),
        by: a.by || '',
      };
    });
    mergeScopedArray('mm_khuluk', function (k) { return studentIds[String(k.student_id)]; }, akhlaq);

    var logs = (res.logs || []).map(function (l) {
      var isStudent = l.type === 'student';
      return {
        id: String(l.id || ''),
        type: isStudent ? 'student' : 'class',
        ref_id: isStudent ? String(l.student_id || '') : (CLASS_CODE_TO_LOCAL_ID[l.class_code] || l.class_code || classId),
        text: l.content || '',
        date: String(l.date || '').slice(0, 10) || API.today(),
        by: l.by || '',
        tag: 'normal',
        reviewRequested: !!l.review_requested,
        reviewedAt: l.reviewed_at || null,
        reviewedByName: l.reviewed_by_name || '',
        adminReply: l.admin_reply || '',
      };
    });
    mergeScopedArray('mm_logs', function (l) {
      return (l.type === 'class' && l.ref_id === classId) || (l.type === 'student' && studentIds[String(l.ref_id)]);
    }, logs);
  }

  function toLocalClass(row) {
    var localId = CLASS_CODE_TO_LOCAL_ID[row.code] || row.code || row.id || '';
    return {
      id: String(localId),
      name: row.name || '',
      dept: row.division_code === 'maktab' ? 'maktab' : 'kitab',
      roll_prefix: row.roll_prefix || '',
      sort_order: row.sort_order || 999,
      active: true,
    };
  }

  function upsertLocalClasses(rows) {
    if (!global.API || !API.Classes) return;
    var mapped = (rows || []).map(toLocalClass).filter(function (c) { return c.id; });
    if (API.Classes.replaceAll) {
      API.Classes.replaceAll(mapped);
      return;
    }
    mapped.forEach(function (c) {
      if (API.Classes.getById && API.Classes.getById(c.id)) API.Classes.update(c.id, c);
      else if (API.Classes.add) API.Classes.add(c);
    });
  }

  function syncBookRows(res) {
    var classIds = {};
    (res.classes || []).forEach(function (c) {
      var localId = CLASS_CODE_TO_LOCAL_ID[c.code] || c.code || c.id || '';
      if (localId) classIds[String(localId)] = true;
    });
    (res.books || []).forEach(function (b) {
      var localId = CLASS_CODE_TO_LOCAL_ID[b.class_code] || b.class_code || '';
      if (localId) classIds[String(localId)] = true;
    });

    var books = (res.books || []).map(function (b) {
      return {
        id: String(b.id || ''),
        name: b.name || '',
        class_id: CLASS_CODE_TO_LOCAL_ID[b.class_code] || b.class_code || '',
        total_pages: b.total_pages,
        sort_order: b.sort_order || 0,
        is_active: b.is_active !== false,
      };
    }).filter(function (b) { return b.id && b.class_id; });
    mergeScopedArray('mm_kitabs', function (b) { return !!classIds[String(b.class_id || '')]; }, books);

    var progress = [];
    (res.books || []).forEach(function (b) {
      var classId = CLASS_CODE_TO_LOCAL_ID[b.class_code] || b.class_code || '';
      if (!b.id || !classId || b.pages_done == null) return;
      progress.push({
        id: String(b.id) + '_current',
        kitab_id: String(b.id),
        class_id: classId,
        date: String(b.updated_at || '').slice(0, 10) || API.today(),
        pages_done: Number(b.pages_done) || 0,
        note: b.notes || '',
      });
    });
    (res.book_progress_history || []).forEach(function (h) {
      var classId = CLASS_CODE_TO_LOCAL_ID[h.class_code] || h.class_code || '';
      if (!h.id || !h.book_id || !classId) return;
      progress.push({
        id: String(h.id || ''),
        kitab_id: String(h.book_id || ''),
        class_id: classId,
        date: String(h.date || '').slice(0, 10) || API.today(),
        pages_done: Number(h.pages_done) || 0,
        note: h.note || '',
        by: h.by || '',
      });
    });
    mergeScopedArray('mm_kitab_progress', function (p) { return !!classIds[String(p.class_id || '')]; }, progress);
  }

  function scopedClassIdsFromRows(rows) {
    var classIds = {};
    (rows || []).forEach(function (c) {
      var localId = CLASS_CODE_TO_LOCAL_ID[c.code] || c.code || c.id || '';
      if (localId) classIds[String(localId)] = true;
    });
    return classIds;
  }

  function scopedStudentIds() {
    var studentIds = {};
    if (!global.API || !API.Students) return studentIds;
    API.Students.getAll().forEach(function (s) {
      studentIds[String(s.id)] = true;
      if (s.supabase_id) studentIds[String(s.supabase_id)] = true;
    });
    return studentIds;
  }

  function syncAttendanceRows(res) {
    if (!res || !global.API) return;
    if (res.attendance === undefined) return;
    var studentIds = scopedStudentIds();
    var rows = (res.attendance || []).map(function (a) {
      return {
        id: String(a.id || ''),
        student_id: String(a.student_id || ''),
        date: String(a.date || '').slice(0, 10),
        status: a.status || 'absent',
        absent_reason: a.absent_reason || '',
        hijri_year: a.hijri_year || null,
      };
    }).filter(function (a) { return a.id && a.student_id && a.date; });
    if (!rows.length && API.persistLoadArr) {
      var existing = API.persistLoadArr('mm_attendance') || [];
      if (existing.length) return;
    }
    mergeScopedArray('mm_attendance', function (a) { return studentIds[String(a.student_id)]; }, rows);
  }

  function syncAdminTeacherRows(res) {
    if (!res || !global.API) return;
    var classIds = scopedClassIdsFromRows(res.classes || []);
    var studentIds = scopedStudentIds();

    // Only merge if the response includes akhlaq — old fallback API omits this field
    // and calling mergeScopedArray with [] would wipe all cached khuluk data.
    if (res.akhlaq !== undefined) {
      var akhlaq = (res.akhlaq || []).map(function (a) {
        return {
          id: String(a.id || ''),
          student_id: String(a.student_id || ''),
          score: Number(a.score) || 0,
          reason: a.reason || '',
          date: String(a.date || '').slice(0, 10) || API.today(),
          at: String(a.at || a.evaluated_at || a.created_at || a.date || ''),
          by: a.by || '',
        };
      }).filter(function (a) { return a.id && a.student_id; });
      mergeScopedArray('mm_khuluk', function (k) { return studentIds[String(k.student_id)]; }, akhlaq);
    }

    // Same guard for logs — old API does not return this field.
    if (res.logs !== undefined) {
      var logs = (res.logs || []).map(function (l) {
        var isStudent = l.type === 'student';
        return {
          id: String(l.id || ''),
          type: isStudent ? 'student' : 'class',
          ref_id: isStudent ? String(l.student_id || '') : (CLASS_CODE_TO_LOCAL_ID[l.class_code] || l.class_code || ''),
          text: l.content || '',
          date: String(l.date || '').slice(0, 10) || API.today(),
          by: l.by || '',
          tag: 'normal',
          reviewRequested: !!l.review_requested,
          reviewedAt: l.reviewed_at || null,
          reviewedByName: l.reviewed_by_name || '',
          adminReply: l.admin_reply || '',
        };
      }).filter(function (l) { return l.id && l.ref_id; });
      mergeScopedArray('mm_logs', function (l) {
        return (l.type === 'class' && classIds[String(l.ref_id || '')]) ||
          (l.type === 'student' && studentIds[String(l.ref_id || '')]);
      }, logs);
    }
  }

  function isAdminDataWarm() {
    return !!(global.API && API.isSessionCacheWarm && API.isSessionCacheWarm());
  }

  function isAdminMadrasaExtrasWarm() {
    return !!(global.API && API.isAdminMadrasaExtrasWarm && API.isAdminMadrasaExtrasWarm());
  }

  async function syncAdminStudents(options) {
    if (!options || !options.force) {
      if (isAdminMadrasaExtrasWarm()) return true;
    }
    if (!global.MMSession || !global.API) return false;
    var pin = MMSession.getAdminPin && MMSession.getAdminPin();
    if (!pin) return false;
    var actorId = MMSession.getAdminUserId && MMSession.getAdminUserId();
    var res;
    if (global.MMSharedAPI && MMSharedAPI.adminMadrasaBootstrap) {
      try {
        res = await MMSharedAPI.adminMadrasaBootstrap(actorId || null, pin);
        if (!res || !res.ok) return false;
      } catch (e) {
        if (!global.MMMadrasaAPI) throw e;
        res = await MMMadrasaAPI.adminStudents(pin);
      }
    } else if (global.MMMadrasaAPI) {
      res = await MMMadrasaAPI.adminStudents(pin);
    } else {
      return false;
    }
    upsertLocalClasses(res.classes || []);
    API.Students.replaceAll((res.students || []).map(toLocalStudent));
    var attDates = Array.isArray(res.attendance_dates) ? res.attendance_dates : [];
    if (attDates.length && API.applyAttendanceDateIndexFromServer) {
      API.applyAttendanceDateIndexFromServer(attDates);
    }
    syncAttendanceRows(res);
    if (global.MMSharedAPI && MMSharedAPI.adminAbsentSummary && API.applyDaftarAbsentSummaryFromServer) {
      try {
        var absentSummary = await MMSharedAPI.adminAbsentSummary(actorId || null, pin);
        if (absentSummary && absentSummary.ok) {
          API.applyDaftarAbsentSummaryFromServer(absentSummary.rows || []);
        }
      } catch (e) {
        console.warn('[MDRSupabaseSync] full absent summary sync failed', e);
      }
    }
    syncBookRows(res);
    syncAdminTeacherRows(res);
    if (API.markAdminMadrasaBootstrapComplete) API.markAdminMadrasaBootstrapComplete();
    return true;
  }

  async function syncAdminUsers(options) {
    if (!options || !options.force) {
      if (isAdminMadrasaExtrasWarm()) return true;
    }
    if (!global.MMSession || !global.MMSharedAPI || !global.API || !API.Teachers) return false;
    var pin = MMSession.getAdminPin && MMSession.getAdminPin();
    if (!pin) return false;
    var res = await MMSharedAPI.adminUsers(pin);
    if (!res || !res.ok) return false;
    var users = (res.users || []).map(function (u) {
      return {
        id: String(u.id || ''),
        name: u.name || '',
        login_id: u.login_id || '',
        class_id: CLASS_CODE_TO_LOCAL_ID[u.class_code] || '',
        class_code: u.class_code || '',
        pin: u.pin || '',
        role: SUPA_ROLE_TO_LOCAL[u.role] || u.role,
        admin_perms: u.admin_perms || {},
        is_active: u.is_active !== false,
      };
    }).filter(function (u) { return u.id; });
    if (API.Teachers.replaceAll) API.Teachers.replaceAll(users);
    else if (API.persistSaveArr) API.persistSaveArr('mm_teachers', users);
    return true;
  }

  async function syncAdminDars(options) {
    if (!options || !options.force) {
      if (isAdminMadrasaExtrasWarm()) return true;
    }
    if (!global.MMSession || !global.MMSharedAPI || !global.API) return false;
    var pin = MMSession.getAdminPin && MMSession.getAdminPin();
    if (!pin || !MMSharedAPI.adminDarsBootstrap) return false;
    var actorId = MMSession.getAdminUserId && MMSession.getAdminUserId();
    var res = await MMSharedAPI.adminDarsBootstrap(actorId || null, pin);
    if (!res || !res.ok) return false;
    upsertLocalClasses(res.classes || []);
    syncBookRows(res);
    return true;
  }

  async function syncSettingsBooks() {
    if (!global.MMSession || !global.MMSharedAPI || !global.API) return false;
    var pin = MMSession.getAdminPin && MMSession.getAdminPin();
    if (!pin || !MMSharedAPI.settingsBooksBootstrap) return false;
    var actorId = MMSession.getAdminUserId && MMSession.getAdminUserId();
    var res = await MMSharedAPI.settingsBooksBootstrap(actorId || null, pin);
    if (!res || !res.ok) return false;
    upsertLocalClasses(res.classes || []);
    syncBookRows(res);
    return true;
  }

  function ensureTeacherClassFromProfile(teacher) {
    if (!teacher || !global.API || !API.Classes) return null;
    var code = String(teacher.class_code || '').trim();
    var classId = String(teacher.class_id || '').trim();
    if (!classId && code) classId = CLASS_CODE_TO_LOCAL_ID[code] || code;
    if (!classId) return null;
    var existing = API.Classes.getById(classId);
    if (existing) return existing;
    var name = String(teacher.class_name || '').trim();
    if (!name) return null;
    var division = code.indexOf('maktab') === 0 ? 'maktab' : 'kitab';
    var stub = toLocalClass({ code: code || classId, name: name, division_code: division });
    if (String(stub.id) !== String(classId)) stub.id = classId;
    if (API.Classes.getById(classId)) API.Classes.update(classId, stub);
    else API.Classes.add(stub);
    return API.Classes.getById(classId);
  }

  function mergeTeacherClassMeta(teacher, meta) {
    if (!teacher || !meta) return teacher;
    var code = String(meta.class_code || teacher.class_code || '').trim();
    var classId = String(teacher.class_id || '').trim();
    if (!classId && code) classId = CLASS_CODE_TO_LOCAL_ID[code] || code;
    return Object.assign({}, teacher, {
      class_id: classId,
      class_code: code,
      class_name: String(meta.class_name || teacher.class_name || '').trim(),
    });
  }

  async function syncTeacherClass() {
    if (!global.MMSession || !global.MMSharedAPI || !global.API) return false;
    var actorId = MMSession.getStaffUserId && MMSession.getStaffUserId();
    var pin = MMSession.getStaffPin && MMSession.getStaffPin();
    if (!actorId || !pin) return false;
    var res = await MMSharedAPI.teacherClassBootstrap(actorId, pin);
    if (!res || !res.ok) return false;
    var rows = res.students || [];
    if (rows.length) {
      upsertLocalClasses([{
        code: rows[0].class_code,
        name: rows[0].class_name,
        division_code: rows[0].division_code,
      }]);
      if (global.MMSession && MMSession.hydrateTeacherRecord) {
        var teacher = MMSession.hydrateTeacherRecord();
        if (teacher) {
          var next = mergeTeacherClassMeta(teacher, rows[0]);
          if (next.class_id && (next.class_id !== teacher.class_id || next.class_name !== teacher.class_name)) {
            MMSession.setTeacherProfile(next);
            if (API.Teachers.getById(teacher.id)) API.Teachers.update(teacher.id, next);
          }
        }
      }
    }
    var incoming = rows.map(toLocalStudent);
    var incomingIds = {};
    incoming.forEach(function (s) { incomingIds[s.id] = true; });
    var keep = API.Students.getAll().filter(function (s) { return !incomingIds[s.id]; });
    API.Students.replaceAll(keep.concat(incoming));
    var classId = incoming.length ? incoming[0].class_id : '';
    if (classId) syncTeacherExtras(res, classId);
    return true;
  }

  async function syncAlumni(actorId, pin) {
    if (!global.MMSharedAPI || !global.API || !actorId || !pin) return false;
    var res = await MMSharedAPI.alumniBootstrap(actorId, pin);
    if (!res || !res.ok) return false;
    syncAlumniRows(res.alumni || []);
    return true;
  }

  async function ensureAdminBootstrap(options) {
    options = options || {};
    var pin = global.MMSession && MMSession.getAdminPin && MMSession.getAdminPin();
    var actorId = global.MMSession && MMSession.getAdminUserId && MMSession.getAdminUserId();

    async function refreshWithdrawals() {
      try {
        if (pin && actorId) await syncAlumni(actorId, pin);
      } catch (e) {
        console.warn('[MDRSupabaseSync] alumni/withdrawals sync failed', e);
      }
    }

    if (!options.force && isAdminMadrasaExtrasWarm()) {
      await refreshWithdrawals();
      return true;
    }
    var ok = false;
    try {
      if (await syncAdminUsers()) ok = true;
    } catch (e) {
      console.warn('[MDRSupabaseSync] admin users sync failed', e);
    }
    try {
      if (await syncAdminStudents()) ok = true;
    } catch (e) {
      console.warn('[MDRSupabaseSync] admin students sync failed', e);
    }
    try {
      if (await syncAdminDars()) ok = true;
    } catch (e) {
      console.warn('[MDRSupabaseSync] admin dars sync failed', e);
    }
    await refreshWithdrawals();
    return ok || isAdminMadrasaExtrasWarm();
  }

  global.MDRSupabaseSync = {
    syncAdminStudents: syncAdminStudents,
    syncAdminUsers: syncAdminUsers,
    syncAdminDars: syncAdminDars,
    syncSettingsBooks: syncSettingsBooks,
    syncTeacherClass: syncTeacherClass,
    syncAlumni: syncAlumni,
    syncAdminTeacherRows: syncAdminTeacherRows,
    syncTeacherExtras: syncTeacherExtras,
    ensureTeacherClassFromProfile: ensureTeacherClassFromProfile,
    mergeTeacherClassMeta: mergeTeacherClassMeta,
    toLocalStudent: toLocalStudent,
    isAdminDataWarm: isAdminDataWarm,
    isAdminMadrasaExtrasWarm: isAdminMadrasaExtrasWarm,
    ensureAdminBootstrap: ensureAdminBootstrap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
