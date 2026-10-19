/**
 * ছাত্র ভর্তি / তথ্য সম্পাদনা — সার্ভারে (RPC mdr_rel_student_save), তারপর লোকাল ক্যাশ হালনাগাদ।
 * অনুমতি: জিম্মাদার ও দফতর (backend-এ যাচাই)।
 *
 * MMStudentSave.save(data, localId?) → Promise<{ ok, student?, error?, message? }>
 *   data: { name, permanent_id, class_id (অ্যাপের বর্ষ-id), roll, guardian, guardian_job, phone, district, upazila, hifz }
 *   localId দিলে সেই ছাত্রের তথ্য বদল, না দিলে নতুন ভর্তি।
 */
(function (global) {
  'use strict';

  /* অ্যাপের বর্ষ-id ↔ ডাটাবেজের ক্লাস-কোড (mdr-daftar-supabase.js / mdr-supabase-sync.js-এর একই তালিকা) */
  var CODE_TO_LOCAL = {
    kitab_y1: 'cls_k1', kitab_iyada: 'cls_ky', kitab_y2: 'cls_k2', kitab_y3: 'cls_k3', kitab_y4: 'cls_k4',
    kitab_y5: 'cls_k5', kitab_y6: 'cls_k6', kitab_y7: 'cls_k7',
    maktab_y1: 'cls_m1', maktab_y2: 'cls_m2', maktab_y3: 'cls_m3', maktab_y4: 'cls_m4', maktab_y5: 'cls_m5',
  };
  var LOCAL_TO_CODE = {};
  Object.keys(CODE_TO_LOCAL).forEach(function (c) { LOCAL_TO_CODE[CODE_TO_LOCAL[c]] = c; });

  var ERR = {
    invalid_actor: 'এই কাজের অনুমতি নেই — আবার লগইন করে দেখুন',
    name_required: 'নাম আবশ্যক',
    permanent_id_required: 'স্থায়ী দাখেলা আবশ্যক',
    roll_required: 'পরিচিতি নম্বর আবশ্যক',
    class_required: 'বর্ষ নির্বাচন করুন',
    class_not_found: 'এই বর্ষ পাওয়া যায়নি',
    student_not_found: 'ছাত্র পাওয়া যায়নি',
    permanent_id_taken: 'এই স্থায়ী দাখেলা ইতিমধ্যে অন্য ছাত্রের আছে',
  };

  function actor() {
    var S = global.MMSession;
    if (!S) return null;
    if (S.isAdmin && S.isAdmin()) return { id: S.getAdminUserId && S.getAdminUserId(), pin: S.getAdminPin && S.getAdminPin() };
    return { id: S.getStaffUserId && S.getStaffUserId(), pin: S.getStaffPin && S.getStaffPin() };
  }

  function canEdit() {
    try {
      var role = global.MMSession && global.MMSession.getRole && global.MMSession.getRole();
      return role === 'admin' || role === 'daftar';
    } catch (e) { return false; }
  }

  function toLocal(row) {
    return {
      id: String(row.id || ''),
      supabase_id: String(row.id || ''),
      permanent_id: row.student_id || '',
      name: row.name || '',
      class_id: CODE_TO_LOCAL[row.class_code] || row.class_code || '',
      roll: row.current_roll || '',
      guardian: row.guardian_name || '',
      guardian_job: row.guardian_occupation || '',
      phone: row.guardian_phone || '',
      district: row.district || '',
      upazila: row.upazila || '',
      status: row.status || 'active',
      active: row.status !== 'dropped' && row.status !== 'alumni',
      hifz: !!row.is_hifz,
      special_watch: !!row.special_watch,
      alhamdulillah: !!row.alhamdulillah,
      alhamdulillah_reason: row.alhamdulillah_reason ? String(row.alhamdulillah_reason).trim() : '',
      dept: row.division_code === 'maktab' ? 'maktab' : 'kitab',
    };
  }

  function upsertLocal(localId, st) {
    var API = global.API;
    if (!API || !API.Students) return;
    var all = API.Students.getAll() || [];
    var key = String(localId || st.id);
    var found = all.some(function (s) { return String(s.id) === key || String(s.supabase_id || '') === st.id; });
    if (found) {
      var prev = all.filter(function (s) { return String(s.id) === key || String(s.supabase_id || '') === st.id; })[0];
      API.Students.update(prev.id, Object.assign({}, st, { id: prev.id }));
    } else if (API.Students.replaceAll) {
      API.Students.replaceAll(all.concat([st]));
    }
  }

  async function save(data, localId) {
    var API = global.API;
    if (!global.MMSharedAPI || !global.MMSharedAPI.studentSave) return { ok: false, message: 'সার্ভার সংযোগ নেই' };
    var a = actor();
    if (!a || !a.id || !a.pin) return { ok: false, message: ERR.invalid_actor };
    var uuid = null;
    if (localId && API && API.Students) {
      var cur = API.Students.getById(localId);
      uuid = cur ? (cur.supabase_id || cur.id) : localId;
    }
    var payload = {
      name: String(data.name || '').trim(),
      student_id: String(data.permanent_id || '').trim(),
      roll: String(data.roll || '').trim(),
      class_code: LOCAL_TO_CODE[data.class_id] || data.class_id || '',
      guardian_name: data.guardian || '',
      guardian_occupation: data.guardian_job || '',
      guardian_phone: data.phone || '',
      district: data.district || '',
      upazila: data.upazila || '',
      is_hifz: !!data.hifz,
    };
    var res;
    try {
      res = await global.MMSharedAPI.studentSave(a.id, a.pin, uuid, payload);
    } catch (e) {
      return { ok: false, message: 'সংরক্ষণ হয়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন' };
    }
    if (!res || !res.ok) {
      var code = res && res.error;
      var msg = code === 'roll_taken'
        ? 'এই বর্ষে এই পরিচিতি নম্বর ইতিমধ্যে ' + (res.other_name || 'অন্য ছাত্রের') + '-এর আছে'
        : (ERR[code] || 'সংরক্ষণ হয়নি');
      return { ok: false, error: code, message: msg };
    }
    var st = toLocal(res.student || {});
    upsertLocal(localId, st);
    try { global.dispatchEvent(new CustomEvent('mm:student-status-changed', { detail: { student_id: st.id } })); } catch (e2) {}
    return { ok: true, student: st };
  }

  global.MMStudentSave = { save: save, canEdit: canEdit, toLocal: toLocal };
})(typeof window !== 'undefined' ? window : this);
