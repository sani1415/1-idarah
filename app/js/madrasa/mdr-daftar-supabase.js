/* Bridge Supabase daftar attendance into the prototype API cache. */
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

  function actor() {
    if (!global.MMSession) return null;
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      return { id: MMSession.getAdminUserId && MMSession.getAdminUserId(), pin: MMSession.getAdminPin && MMSession.getAdminPin() };
    }
    return { id: MMSession.getStaffUserId && MMSession.getStaffUserId(), pin: MMSession.getStaffPin && MMSession.getStaffPin() };
  }

  function toLocalStudent(row) {
    return {
      id: String(row.id || ''),
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
      special_watch: !!row.special_watch,
      alhamdulillah: !!row.alhamdulillah,
      alhamdulillah_reason: row.alhamdulillah_reason ? String(row.alhamdulillah_reason).trim() : '',
      left_date: row.left_date || '',
      left_reason: row.left_reason || '',
      supabase_id: row.id || '',
    };
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

  function toLocalAttendance(row) {
    var out = {
      id: String(row.id || ''),
      student_id: String(row.student_id || ''),
      date: String(row.date || ''),
      status: row.status || 'present',
    };
    if (row.absent_reason) out.absent_reason = row.absent_reason;
    if (row.hijri_year) out.hijri_year = row.hijri_year;
    return out;
  }

  /** বর্ষ id (prototype) → শিক্ষকের নাম; Supabase বুটস্ট্র্যাপ থেকে পূরণ */
  var _classTeacherByLocalId = {};
  var CLASS_TEACHERS_CACHE_KEY = 'mm_class_teachers_sc_v1';

  function cacheActorKey() {
    var a = actor();
    if (!a || !a.id) {
      try {
        var role = sessionStorage.getItem('mm_role') || '';
        if (role === 'admin') {
          return 'admin:' + String(sessionStorage.getItem('mm_admin_user_id') || '') + ':' +
            String(sessionStorage.getItem('mm_admin_pin') || '');
        }
        return role + ':' + String(sessionStorage.getItem('mm_staff_user_id') || '') + ':' +
          String(sessionStorage.getItem('mm_teacher_id') || '') + ':' + String(sessionStorage.getItem('mm_dept_id') || '');
      } catch (e) {
        return '';
      }
    }
    if (global.MMSession && MMSession.isAdmin && MMSession.isAdmin()) {
      return 'admin:' + String(a.id) + ':' + String(a.pin || '');
    }
    var role = (MMSession.getRole && MMSession.getRole()) || 'staff';
    return role + ':' + String(a.id) + ':' + String((MMSession.getTeacherId && MMSession.getTeacherId()) || '') + ':' +
      String((MMSession.getDeptId && MMSession.getDeptId()) || '');
  }

  function saveClassTeachersCache() {
    try {
      sessionStorage.setItem(CLASS_TEACHERS_CACHE_KEY, JSON.stringify({
        actor: cacheActorKey(),
        map: _classTeacherByLocalId,
        ts: Date.now(),
      }));
    } catch (e) {
      console.warn('MDRDaftarSupabase: class teachers cache write failed', e);
    }
  }

  function hydrateClassTeachersCache() {
    try {
      var raw = sessionStorage.getItem(CLASS_TEACHERS_CACHE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      var key = cacheActorKey();
      if (!parsed || !key || parsed.actor !== key || !parsed.map) return;
      _classTeacherByLocalId = parsed.map;
    } catch (e) {
      console.warn('MDRDaftarSupabase: class teachers cache hydrate failed', e);
    }
  }

  function applyClassTeachers(rows) {
    _classTeacherByLocalId = {};
    (rows || []).forEach(function (row) {
      var lid = CLASS_CODE_TO_LOCAL_ID[row.class_code] || '';
      var nm = row.name != null ? String(row.name) : '';
      if (lid && nm) _classTeacherByLocalId[lid] = nm;
    });
    saveClassTeachersCache();
  }

  /** প্রোটোটাইপ mm_teachers + সেশন ক্যাশ (নেভিগেশনে সিঙ্ক স্কিপ হলেও নাম থাকে) */
  function classTeachersMergedMap() {
    hydrateClassTeachersCache();
    var map = {};
    if (global.API && API.Teachers && API.Teachers.getAll) {
      API.Teachers.getAll().forEach(function (t) {
        if (t.class_id && t.is_active !== false) map[t.class_id] = t.name;
      });
    }
    Object.keys(_classTeacherByLocalId).forEach(function (lid) {
      map[lid] = _classTeacherByLocalId[lid];
    });
    return map;
  }

  /** দফতর পেজের হাজিরা অডিট «শিক্ষাবর্ষ শুরু→আজ» গণনা করে API.Settings.session_start_date দিয়ে; সেটা শুধু localStorage। একই ইউজারের দুই ডিভাইসে DB-তে সেশন শুরু থাকলেও লোকাল ভিন্ন হলে বাকি দিনের সংখ্যা ভিন্ন হয়। */
  function mergePublicMadrasaSettingsFromServer() {
    if (!global.MMSharedAPI || !global.API || !API.Settings || !MMSharedAPI.publicSettings) return;
    return MMSharedAPI.publicSettings().then(function (pub) {
      var remote = pub && pub.settings;
      if (!remote || typeof remote !== 'object') return;
      var cur = API.Settings.get() || {};
      var next = Object.assign({}, cur);
      var sd = remote.session_start_date != null && String(remote.session_start_date).trim() !== ''
        ? String(remote.session_start_date).trim().slice(0, 10)
        : '';
      if (sd) next.session_start_date = sd;
      var hy = remote.hijri_year != null && String(remote.hijri_year).trim() !== ''
        ? String(remote.hijri_year).trim()
        : '';
      if (hy) next.hijri_year = hy;
      var inst = remote.institution != null && String(remote.institution).trim() !== ''
        ? String(remote.institution).trim()
        : '';
      if (inst) next.institution = inst;
      if (remote.hijri_offset_days != null && remote.hijri_offset_days !== '') {
        next.hijri_offset_days = remote.hijri_offset_days;
      }
      API.Settings.save(next);
      if (sd && API.Sessions && API.Sessions.getCurrent && API.Sessions.setCurrentStartDate && API.Sessions.getCurrent()) {
        try {
          API.Sessions.setCurrentStartDate(sd);
        } catch (e) {
          console.warn('MDRDaftarSupabase: setCurrentStartDate failed', e);
        }
      }
    }).catch(function (e) {
      console.warn('MDRDaftarSupabase: publicSettings failed', e);
    });
  }

  async function sync(options) {
    if (global.API && API.hydrateSessionCache) API.hydrateSessionCache();
    if (!options || !options.force) {
      if (global.API && API.isDaftarSessionCacheWarm && API.isDaftarSessionCacheWarm()) {
        hydrateClassTeachersCache();
        return true;
      }
    }
    if (!global.MMSharedAPI || !global.API) return false;
    var a = actor();
    if (!a || !a.id || !a.pin) return false;
    var res = await MMSharedAPI.daftarBootstrap(a.id, a.pin);
    if (!res || !res.ok) return false;
    if (API.Classes && API.Classes.replaceAll) {
      API.Classes.replaceAll((res.classes || []).map(toLocalClass).filter(function (c) { return c.id; }));
    }
    API.Students.replaceAll((res.students || []).map(toLocalStudent));
    var attDates = Array.isArray(res.attendance_dates) ? res.attendance_dates : [];
    var attDateCount = 0;
    if (API.applyAttendanceDateIndexFromServer) {
      attDateCount = API.applyAttendanceDateIndexFromServer(attDates).length;
    }
    if (API.Attendance && API.Attendance.replaceAll) {
      API.Attendance.replaceAll((res.attendance || []).map(toLocalAttendance));
    }
    if (res.session_start_date && API.Sessions && API.Sessions.setCurrentStartDate && API.Sessions.getCurrent && API.Sessions.getCurrent()) {
      try {
        API.Sessions.setCurrentStartDate(String(res.session_start_date).slice(0, 10));
      } catch (eSd) {
        console.warn('MDRDaftarSupabase: setCurrentStartDate failed', eSd);
      }
    }
    if (API.persistDaftarAttendanceSessionCache) API.persistDaftarAttendanceSessionCache();
    /* শিক্ষাবর্ষের পূর্ণ অনুপস্থিত aggregate — লোকাল ~৩০ দিনের হাজিরা দিয়ে হিসাব নয় */
    var summaryOk = false;
    if (global.MMSharedAPI && MMSharedAPI.adminAbsentSummary && API.applyDaftarAbsentSummaryFromServer) {
      try {
        var absSum = await MMSharedAPI.adminAbsentSummary(a.id, a.pin);
        if (absSum && absSum.ok) {
          API.applyDaftarAbsentSummaryFromServer(absSum.rows || []);
          summaryOk = true;
        }
      } catch (eAbs) {
        console.warn('MDRDaftarSupabase: absent summary failed', eAbs);
      }
    }
    if (!summaryOk && API.rebuildDaftarAbsentSummary) {
      var existing = API.loadDaftarAbsentSummaryRaw && API.loadDaftarAbsentSummaryRaw();
      if (!existing || existing.source !== 'server') API.rebuildDaftarAbsentSummary();
    }
    if (API.markDaftarBootstrapComplete) {
      API.markDaftarBootstrapComplete({ attDatesCount: attDateCount, skipRowIndex: attDateCount > 0 });
    }
    if (Array.isArray(res.class_teachers)) applyClassTeachers(res.class_teachers);
    try {
      await mergePublicMadrasaSettingsFromServer();
    } catch (e) {
      console.warn('MDRDaftarSupabase: merge settings failed', e);
    }
    return true;
  }

  async function saveDay(date, records, hijriYear) {
    if (!global.MMSharedAPI || !global.API) throw new Error('supabase_unavailable');
    var a = actor();
    if (!a || !a.id || !a.pin) throw new Error('missing_remote_session');
    if (!Array.isArray(records) || !records.length) throw new Error('empty_attendance_payload');
    var res = await MMSharedAPI.saveAttendanceDay(a.id, a.pin, date, records || [], hijriYear || null);
    if (!res || !res.ok) throw new Error((res && res.error) || 'attendance_save_failed');
    var expectedDate = String(date || '').slice(0, 10);
    var attendanceRows = res.attendance || [];
    var savedCount = (attendanceRows || []).filter(function (row) {
      return String(row.date || '').slice(0, 10) === expectedDate;
    }).length;
    if (savedCount < records.length) {
      var fresh = MMSharedAPI.daftarAttendanceForDate
        ? await MMSharedAPI.daftarAttendanceForDate(a.id, a.pin, expectedDate)
        : await MMSharedAPI.daftarBootstrap(a.id, a.pin);
      if (!fresh || !fresh.ok) throw new Error((fresh && fresh.error) || 'attendance_readback_failed');
      attendanceRows = fresh.attendance || attendanceRows;
      savedCount = (attendanceRows || []).filter(function (row) {
        return String(row.date || '').slice(0, 10) === expectedDate;
      }).length;
    }
    if (savedCount < records.length) {
      var err = new Error('attendance_readback_mismatch');
      err.expected = records.length;
      err.actual = savedCount;
      throw err;
    }
    if (API.Attendance) {
      var dayRows = attendanceRows.filter(function (row) {
        return String(row.date || '').slice(0, 10) === expectedDate;
      }).map(toLocalAttendance);
      if (API.Attendance.replaceDate) API.Attendance.replaceDate(date, dayRows);
      else if (API.Attendance.replaceAll) API.Attendance.replaceAll(dayRows);
      if (API.Attendance.noteDateSaved) API.Attendance.noteDateSaved(expectedDate);
    }
    return true;
  }

  async function ensureDateInCache(date) {
    if (!global.API || !API.Attendance) return [];
    var iso = String(date || '').slice(0, 10);
    if (!iso) return [];
    var existing = API.Attendance.getByDate(iso);
    if (existing.length) return existing;
    if (API.Attendance.hasAnyForDate && !API.Attendance.hasAnyForDate(iso)) return [];
    if (!global.MMSharedAPI) return [];
    var a = actor();
    if (!a || !a.id || !a.pin) return [];
    var fresh = MMSharedAPI.daftarAttendanceForDate
      ? await MMSharedAPI.daftarAttendanceForDate(a.id, a.pin, iso)
      : await MMSharedAPI.daftarBootstrap(a.id, a.pin);
    if (!fresh || !fresh.ok) return [];
    var dayRows = (fresh.attendance || []).filter(function (row) {
      return String(row.date || '').slice(0, 10) === iso;
    }).map(toLocalAttendance);
    if (dayRows.length && API.Attendance.replaceDate) {
      API.Attendance.replaceDate(iso, dayRows);
    }
    return API.Attendance.getByDate(iso);
  }

  hydrateClassTeachersCache();

  global.MDRDaftarSupabase = {
    sync: sync,
    saveDay: saveDay,
    ensureDateInCache: ensureDateInCache,
    classTeachersMergedMap: classTeachersMergedMap,
    hydrateClassTeachersCache: hydrateClassTeachersCache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
