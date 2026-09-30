  const IS_MAIN_ADMIN = MMSession.isMainAdmin();
  function hasSettingsPerm(key) {
    return IS_MAIN_ADMIN || (MMSession.canAdmin && MMSession.canAdmin(key));
  }
  function canOpenSettingsPage() {
    return IS_MAIN_ADMIN || hasSettingsPerm('settings_teachers') || hasSettingsPerm('settings_kitab');
  }
  if (!canOpenSettingsPage()) location.replace('/admin/madrasa.html');
  document.getElementById('top-name').textContent = MMSession.getName()||'জিম্মাদার';

  let editingTeacherId = null;
  let editingTeacherProfileId = null;
  let editingStaffId = null;
  let editingAdminId = null;
  let editingClassId = null;
  let editingKitabId = null;
  let supabaseUsers = null;
  let settingsLoadedFromDb = false;

  const LOCAL_CLASS_TO_SUPA_CODE = {
    cls_k1: 'kitab_y1',
    cls_ky: 'kitab_iyada',
    cls_k2: 'kitab_y2',
    cls_k3: 'kitab_y3',
    cls_k4: 'kitab_y4',
    cls_k5: 'kitab_y5',
    cls_k6: 'kitab_y6',
    cls_k7: 'kitab_y7',
    cls_m1: 'maktab_y1',
    cls_m2: 'maktab_y2',
    cls_m3: 'maktab_y3',
    cls_m4: 'maktab_y4',
    cls_m5: 'maktab_y5',
  };
  const SUPA_CLASS_TO_LOCAL_ID = Object.keys(LOCAL_CLASS_TO_SUPA_CODE).reduce((out, id) => {
    out[LOCAL_CLASS_TO_SUPA_CODE[id]] = id;
    return out;
  }, {});
  const LOCAL_ROLE_TO_SUPA = {
    teacher: 'madrasa_teacher',
    restricted_admin: 'restricted_admin',
    daftar: 'daftar',
    hifz: 'hifz',
    library: 'library',
    alumni: 'alumni_tracker',
    khedmat: 'khedmat',
  };
  const SUPA_ROLE_TO_LOCAL = {
    madrasa_teacher: 'teacher',
    restricted_admin: 'restricted_admin',
    daftar: 'daftar',
    hifz: 'hifz',
    library: 'library',
    alumni_tracker: 'alumni',
    khedmat: 'khedmat',
  };

  function hasSupabaseAdminSession() {
    return !!(window.MMSharedAPI && MMSession.getAdminPin && MMSession.getAdminPin());
  }

  function toLocalSharedUser(u) {
    return {
      id: u.id,
      name: u.name || '',
      login_id: u.login_id || '',
      class_id: SUPA_CLASS_TO_LOCAL_ID[u.class_code] || '',
      class_code: u.class_code || '',
      has_pin: u.has_pin !== false,
      role: SUPA_ROLE_TO_LOCAL[u.role] || u.role,
      admin_perms: u.admin_perms || {},
      is_active: u.is_active !== false,
    };
  }

  function allowedSettingsTabs() {
    if (IS_MAIN_ADMIN) return ['general', 'pin', 'admins', 'classes', 'teachers', 'kitab'];
    const tabs = [];
    if (hasSettingsPerm('settings_teachers')) tabs.push('teachers');
    if (hasSettingsPerm('settings_kitab')) tabs.push('kitab');
    return tabs;
  }

  function canUseSettingsTab(tab) {
    return allowedSettingsTabs().includes(tab);
  }

  function applySettingsAccess() {
    const allowed = allowedSettingsTabs();
    document.querySelectorAll('[data-settings-tab]').forEach(pill => {
      pill.style.display = allowed.includes(pill.dataset.settingsTab) ? '' : 'none';
    });
    ['general','pin','admins','classes','teachers','kitab'].forEach(tab => {
      const el = document.getElementById('tab-' + tab);
      if (el && !allowed.includes(tab)) el.style.display = 'none';
    });
    const staffBtn = document.getElementById('btn-add-staff');
    if (staffBtn) staffBtn.style.display = IS_MAIN_ADMIN ? '' : 'none';
    document.querySelectorAll('#teacher-filter-pills .pill').forEach(btn => {
      const call = btn.getAttribute('onclick') || '';
      if (call.includes("'other'")) btn.style.display = IS_MAIN_ADMIN ? '' : 'none';
      if (call.includes("'kitab'")) btn.style.display = MMSession.canUseMadrasaDept('kitab') ? '' : 'none';
      if (call.includes("'maktab'")) btn.style.display = MMSession.canUseMadrasaDept('maktab') ? '' : 'none';
    });
  }

  function scopedClasses(includeInactive = false) {
    const allowed = new Set(MMSession.getAllowedMadrasaDepts());
    return API.Classes.getAll(includeInactive).filter(c => allowed.has(c.dept));
  }

  function scopedClassesByDept(dept, includeInactive = false) {
    if (!MMSession.canUseMadrasaDept(dept)) return [];
    return API.Classes.getByDept(dept, includeInactive);
  }

  function canUseClassId(classId) {
    return scopedClasses(true).some(c => c.id === classId);
  }

  function classCodeForLocalId(classId) {
    return LOCAL_CLASS_TO_SUPA_CODE[classId] || null;
  }

  function settingsActorId() {
    return MMSession.getAdminUserId && MMSession.getAdminUserId();
  }

  async function loadSupabaseUsers(force) {
    if (!hasSupabaseAdminSession()) return false;
    if (supabaseUsers && !force) return true;
    const res = IS_MAIN_ADMIN
      ? await MMSharedAPI.adminUsers(MMSession.getAdminPin())
      : await MMSharedAPI.settingsUsersBootstrap(settingsActorId(), MMSession.getAdminPin());
    if (!res || !res.ok) throw new Error('user_load_failed');
    supabaseUsers = (res.users || []).map(toLocalSharedUser);
    return true;
  }

  function currentUserList() {
    return supabaseUsers || API.Teachers.getAll();
  }

  function getManagedUser(id) {
    return currentUserList().find(t => t.id === id) || API.Teachers.getById(id);
  }

  /* পিন DB-তে hash হয়ে থাকে, তাই এডিটে আগের পিন দেখানো যায় না — খালি রাখলে আগেরটাই থাকে */
  function setPinField(id, isEdit, newDefault) {
    const el = document.getElementById(id);
    el.value = isEdit ? '' : newDefault;
    el.placeholder = isEdit ? 'খালি রাখলে আগের পিন থাকবে' : 'যেমন: 1234';
  }
  function pinFieldError(pin, isEdit) {
    if (isEdit && pin === '') return '';
    return /^[0-9]{4}$/.test(pin) ? '' : '৪ সংখ্যার পিন দিন';
  }

  function userSaveErrorMessage(code) {
    const labels = {
      invalid_pin: 'জিম্মাদার পিন মিলছে না',
      pin_locked: 'অনেকবার ভুল পিন — ১৫ মিনিট পরে আবার চেষ্টা করুন',
      invalid_new_pin: 'নতুন পিন অবশ্যই ৪টি ইংরেজি সংখ্যা (০–৯)',
      same_pin: 'নতুন পিন আগের মতোই',
      no_admin_user: 'কোনো সক্রিয় জিম্মাদার ইউজার পাওয়া যায়নি',
      missing_required: 'নাম ও পিন দিন',
      missing_login_id: 'লগইন আইডি দিন',
      class_not_found: 'বর্ষ পাওয়া যায়নি',
      login_id_taken: 'এই লগইন আইডি আগে থেকেই আছে',
      class_teacher_exists: 'এই বর্ষে আগে থেকেই একজন সক্রিয় শিক্ষক আছে',
      user_not_found: 'ব্যবহারকারী পাওয়া যায়নি',
      invalid_role: 'ভূমিকা ঠিক নেই',
      permission_denied: 'এই কাজের অনুমতি নেই',
      scope_denied: 'এই বিভাগের অনুমতি নেই',
      book_not_found: 'কিতাব পাওয়া যায়নি',
    };
    return labels[code] || 'সংরক্ষণ করা যায়নি';
  }

  function switchTab(tab) {
    if (!canUseSettingsTab(tab)) {
      const first = allowedSettingsTabs()[0];
      if (first && first !== tab) switchTab(first);
      return;
    }
    ['general','pin','admins','classes','teachers','kitab'].forEach(t=>{
      document.getElementById('tab-'+t).style.display   = t===tab?'block':'none';
      document.getElementById('pill-'+t).classList.toggle('active',t===tab);
    });
    if (tab==='general')  loadGeneral();
    if (tab==='admins')   renderAdmins();
    if (tab==='classes')  renderClasses();
    if (tab==='teachers') renderTeachers();
    if (tab==='kitab')    initKitab();
  }

  /* GENERAL */
  function toEnDigits(v) {
    return String(v || '').replace(/[\u09E6-\u09EF\u0660-\u0669\u06F0-\u06F9]/g, d => {
      const b = '\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF'.indexOf(d); if (b >= 0) return b;
      const a = '٠١٢٣٤٥٦٧٨٩'.indexOf(d); if (a >= 0) return a;
      return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d);
    });
  }
  function getOffsetInputValue() {
    const el = document.getElementById('hijri-offset');
    return Math.max(-3, Math.min(3, Number(toEnDigits(el && el.value)) || 0));
  }
  function setOffsetInputValue(value) {
    const el = document.getElementById('hijri-offset');
    if (el) el.value = String(Math.max(-2, Math.min(2, Number(value) || 0)));
  }
  function formatDatePreview(iso, offset) {
    if (!iso || !window.MMHijri) return '';
    const d = MMHijri.dualLine(iso, { offsetDays: offset });
    return '<strong>হিজরী:</strong> ' + API.esc(d.primary) + '<br><span style="color:var(--ink3)">' + API.esc(d.secondary || ('খ্রিস্টাব্দ: ' + MMHijri.gregorianLongBn(iso))) + '</span>';
  }
  function updateDatePreviews() {
    const offset = getOffsetInputValue();
    const start = document.getElementById('session-start').value;
    const startPreview = document.getElementById('session-start-preview');
    const offsetPreview = document.getElementById('hijri-offset-preview');
    if (startPreview) startPreview.innerHTML = formatDatePreview(start, offset) || 'তারিখ দিলে এখানে হিজরী ও খ্রিস্টাব্দ দেখা যাবে।';
    if (offsetPreview) {
      const today = API.today ? API.today() : new Date().toISOString().split('T')[0];
      offsetPreview.innerHTML = 'আজকের কার্যকর হিজরী তারিখ: <strong>' + API.esc(MMHijri.hijriOrFallback(today, { offsetDays: offset }) || '—') + '</strong>';
    }
  }
  function loadGeneral() {
    const s = API.Settings.get();
    document.getElementById('inst-name').value    = s.institution||'';
    document.getElementById('hijri-year').value   = s.hijri_year||'';
    setOffsetInputValue(s.hijri_offset_days);
    const cur = API.Sessions.getCurrent();
    /* সেটিংস-এর তারিখই প্রাধান্য, যেন ব্রাউজার রিফ্রেশে সেশন-রো-এর পুরনো 'আজ' লুকিয়ে সেটিংস মুছে না দেখায় */
    document.getElementById('session-start').value = (s.session_start_date && String(s.session_start_date).trim()) || (cur && cur.start_date) || '';
    updateDatePreviews();
    loadGeneralFromSupabase();
  }
  async function loadGeneralFromSupabase() {
    if (settingsLoadedFromDb) return;
    if (!window.MMMadrasaAPI || !MMSession.getAdminPin()) return;
    try {
      const res = await MMMadrasaAPI.getSettings(MMSession.getAdminPin());
      const db = res.settings || {};
      settingsLoadedFromDb = true;
      if (!db || (!db.institution && !db.hijri_year && !db.session_start_date && db.hijri_offset_days == null)) return;
      const local = API.Settings.get();
      const next = {
        ...local,
        institution: db.institution || local.institution,
        hijri_year: db.hijri_year || local.hijri_year,
        session_start_date: db.session_start_date || local.session_start_date,
        hijri_offset_days: db.hijri_offset_days != null ? Number(db.hijri_offset_days) || 0 : (Number(local.hijri_offset_days) || 0),
      };
      API.Settings.save(next);
      if (window.MMHijri) MMHijri.setOffsetDays(next.hijri_offset_days);
      if (next.session_start_date) {
        if (API.Sessions.getCurrent()) API.Sessions.setCurrentStartDate(next.session_start_date);
        else API.Sessions.ensureInitialized();
      }
      document.getElementById('inst-name').value = next.institution || '';
      document.getElementById('hijri-year').value = next.hijri_year || '';
      document.getElementById('session-start').value = next.session_start_date || '';
      setOffsetInputValue(next.hijri_offset_days);
      updateDatePreviews();
    } catch (err) {
      console.warn('settings load skipped', err);
    }
  }
  async function saveGeneral() {
    const s = API.Settings.get();
    s.institution = document.getElementById('inst-name').value.trim()||s.institution;
    const hy = document.getElementById('hijri-year').value.trim();
    const sd = document.getElementById('session-start').value;
    s.hijri_offset_days = getOffsetInputValue();
    if (hy) s.hijri_year = hy;
    if (sd) s.session_start_date = sd;
    API.Settings.save(s);
    if (window.MMHijri) MMHijri.setOffsetDays(s.hijri_offset_days);
    if (sd) {
      if (API.Sessions.getCurrent()) API.Sessions.setCurrentStartDate(sd);
      else API.Sessions.ensureInitialized();
    }
    if (window.MMMadrasaAPI && MMSession.getAdminPin()) {
      try {
        await MMMadrasaAPI.saveSettings(MMSession.getAdminPin(), {
          institution: s.institution || '',
          hijri_year: s.hijri_year || '',
          session_start_date: s.session_start_date || '',
          hijri_offset_days: s.hijri_offset_days || 0,
        });
        settingsLoadedFromDb = true;
        showToast('সংরক্ষণ হয়েছে ✓ ডাটাবেজেও সেভ হয়েছে');
        return;
      } catch (err) {
        console.warn('settings save failed', err);
        showToast('লোকাল সেভ হয়েছে, ডাটাবেজে সেভ হয়নি');
        return;
      }
    }
    showToast('সংরক্ষণ হয়েছে ✓');
  }

  function backupFileDate() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
    ].join('-') + '-' + [
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
  }

  function downloadJsonFile(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadDatabaseBackup() {
    if (!IS_MAIN_ADMIN) { showToast('শুধু মূল জিম্মাদার ব্যাকআপ নিতে পারবেন'); return; }
    if (!window.MMSharedAPI || !MMSharedAPI.fullDatabaseBackup || !MMSession.getAdminPin()) {
      showToast('সার্ভারের সাথে সংযোগ হয়নি — আবার লগইন করুন');
      return;
    }
    const btn = document.getElementById('database-backup-btn');
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'ব্যাকআপ তৈরি হচ্ছে...';
    }
    try {
      const backup = await MMSharedAPI.fullDatabaseBackup(settingsActorId(), MMSession.getAdminPin());
      if (!backup || backup.ok === false) {
        showToast('ব্যাকআপ তৈরি হয়নি: অনুমতি যাচাই করুন');
        return;
      }
      downloadJsonFile('madrasatul-madina-database-backup-' + backupFileDate() + '.json', backup);
      showToast('JSON ব্যাকআপ ডাউনলোড হয়েছে ✓');
    } catch (err) {
      console.warn('database backup failed', err);
      showToast('ব্যাকআপ তৈরি হয়নি; মাইগ্রেশন/ইন্টারনেট চেক করুন');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText || 'JSON ব্যাকআপ ডাউনলোড';
      }
    }
  }

  /* PIN — ডাটাবেসের admin সারিতে পিন (Supabase); লোকাল settings শুধু ফলব্যাক মিল রাখতে */
  async function changeAdminPin() {
    const raw1 = document.getElementById('new-admin-pin').value;
    const raw2 = document.getElementById('confirm-admin-pin').value;
    const p1 = String(raw1 || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d).toString()).trim();
    const p2 = String(raw2 || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d).toString()).trim();
    if (!/^[0-9]{4}$/.test(p1)) { showToast('৪ সংখ্যার পিন দিন (০–৯)'); return; }
    if (p1 !== p2) { showToast('পিন মিলছে না'); return; }
    const cur = MMSession.getAdminPin && MMSession.getAdminPin();
    if (window.MMSharedAPI && MMSharedAPI.supabaseClient && cur) {
      try {
        const res = await MMSharedAPI.adminChangePin(cur, p1);
        if (!res || !res.ok) {
          showToast(userSaveErrorMessage(res && res.error) || 'পিন পরিবর্তন হয়নি');
          return;
        }
        MMSession.setAdminSession(
          MMSession.getName() || 'জিম্মাদার',
          MMSession.getAdminPerms(),
          MMSession.getAdminUserId(),
          p1
        );
        const s = API.Settings.get();
        s.admin_pin = p1;
        API.Settings.save(s);
        document.getElementById('new-admin-pin').value = '';
        document.getElementById('confirm-admin-pin').value = '';
        showToast('অ্যাডমিন পিন পরিবর্তন হয়েছে ✓ (ডাটাবেস)');
        return;
      } catch (e) {
        console.warn('adminChangePin', e);
        showToast('ডাটাবেসে পিন সেভ হয়নি; ইন্টারনেট/মাইগ্রেশন চেক করুন');
      }
    }
    const s = API.Settings.get();
    s.admin_pin = p1;
    API.Settings.save(s);
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      MMSession.setAdminSession(
        MMSession.getName() || 'জিম্মাদার',
        MMSession.getAdminPerms(),
        MMSession.getAdminUserId(),
        p1
      );
    }
    document.getElementById('new-admin-pin').value = '';
    document.getElementById('confirm-admin-pin').value = '';
    showToast('অ্যাডমিন পিন পরিবর্তন হয়েছে ✓ (স্থানীয়)');
  }

  /* ADMINS */
  function defaultAdminPerms() {
    const permissions = {};
    ['dashboard', 'daftar', 'teachers', 'dars', 'exams', 'withdrawn', 'hifz', 'library', 'alumni', 'messages', 'recent'].forEach(k => {
      permissions[k] = true;
    });
    permissions.teacher_hazira = false;
    permissions.settings_teachers = false;
    permissions.settings_kitab = false;
    return { scope: { madrasa_depts: ['kitab', 'maktab'] }, permissions };
  }
  function normalizeAdminPerms(perms) {
    let p = perms;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { p = {}; }
    }
    const d = defaultAdminPerms();
    const rawDepts = (p && p.scope && Array.isArray(p.scope.madrasa_depts)) ? p.scope.madrasa_depts : d.scope.madrasa_depts;
    const permissions = { ...d.permissions, ...((p && p.permissions) || {}) };
    permissions.dashboard = true;
    return {
      scope: { madrasa_depts: rawDepts.filter(x => x === 'kitab' || x === 'maktab') },
      permissions
    };
  }
  function adminPermSummary(perms) {
    const p = normalizeAdminPerms(perms);
    const deptNames = p.scope.madrasa_depts.map(d => d === 'maktab' ? 'মক্তব' : 'কিতাব').join(', ') || 'কোনো বিভাগ নয়';
    const menuLabels = {
      dashboard:'ড্যাশবোর্ড', daftar:'দফতর', teachers:'শিক্ষক', dars:'দরস', teacher_hazira:'শিক্ষক হাজিরা', exams:'পরীক্ষা',
      withdrawn:'বিদায় ছাত্র', hifz:'হিফজ', library:'মাকতাবা', alumni:'পুরনো ছাত্র',
      messages:'বার্তা', recent:'কার্যক্রম', settings_teachers:'শিক্ষক নিয়োগ', settings_kitab:'কিতাব যোগ-বিয়োগ'
    };
    const menuNames = Object.keys(p.permissions).filter(k => p.permissions[k]).map(k => menuLabels[k] || k).join(', ') || 'কোনো মেনু নয়';
    return `${deptNames} · ${menuNames}`;
  }
  async function renderAdmins() {
    if (hasSupabaseAdminSession() && supabaseUsers === null) {
      document.getElementById('admin-list').innerHTML = '<div style="font-size:13px;color:var(--ink3);">তালিকা লোড হচ্ছে...</div>';
      try {
        await loadSupabaseUsers(true);
      } catch (e) {
        showToast('দায়িত্বশীলদের তালিকা লোড হয়নি — আবার চেষ্টা করুন');
      }
    }
    const admins = currentUserList().filter(t => t.role === 'restricted_admin');
    document.getElementById('admin-list').innerHTML = admins.map(a => `
      <div class="perm-card">
        <div class="perm-ico">🛡️</div>
        <div class="perm-meta">
          <div class="perm-name">${API.esc(a.name)}</div>
          <div class="perm-sub">আইডি: ${API.esc(a.login_id || '—')} · ${API.esc(adminPermSummary(a.admin_perms))}</div>
        </div>
        <span class="pin-display">${a.has_pin === false ? 'পিন নেই' : 'পিন সেট আছে'}</span>
        <div class="perm-actions">
          <button class="small-btn" onclick="openAdminModal('${a.id}')">সম্পাদনা</button>
        </div>
      </div>`).join('') || '<div style="font-size:13px;color:var(--ink3);">কোনো সহকারী জিম্মাদার নেই</div>';
  }
  function setAdminPermFields(perms) {
    const p = normalizeAdminPerms(perms || defaultAdminPerms());
    document.getElementById('adm-dept-kitab').checked = p.scope.madrasa_depts.includes('kitab');
    document.getElementById('adm-dept-maktab').checked = p.scope.madrasa_depts.includes('maktab');
    document.querySelectorAll('.adm-menu').forEach(cb => { cb.checked = !!p.permissions[cb.value]; });
  }
  function readAdminPermFields() {
    const depts = [];
    if (document.getElementById('adm-dept-kitab').checked) depts.push('kitab');
    if (document.getElementById('adm-dept-maktab').checked) depts.push('maktab');
    const permissions = {};
    document.querySelectorAll('.adm-menu').forEach(cb => { permissions[cb.value] = !!cb.checked; });
    permissions.dashboard = true;
    return { scope: { madrasa_depts: depts }, permissions };
  }
  function openAdminModal(id) {
    editingAdminId = id;
    const user = id ? getManagedUser(id) : null;
    document.getElementById('adm-name').value = user ? (user.name || '') : '';
    document.getElementById('adm-login-id').value = user ? (user.login_id || '') : '';
    setPinField('adm-pin', !!user, '');
    setAdminPermFields(user ? user.admin_perms : defaultAdminPerms());
    openModal('admin-user');
  }
  async function saveAdminUser() {
    const name = document.getElementById('adm-name').value.trim();
    const login_id = document.getElementById('adm-login-id').value.trim();
    const pin = document.getElementById('adm-pin').value.trim();
    const perms = readAdminPermFields();
    if (!name) { showToast('নাম দিন'); return; }
    if (!login_id) { showToast('লগইন আইডি দিন'); return; }
    const pinErr = pinFieldError(pin, !!editingAdminId);
    if (pinErr) { showToast(pinErr); return; }
    if (!perms.scope.madrasa_depts.length) { showToast('কমপক্ষে একটি বিভাগ দিন'); return; }
    if (!Object.keys(perms.permissions).some(k => perms.permissions[k])) { showToast('কমপক্ষে একটি মেনু দিন'); return; }
    if (hasSupabaseAdminSession() && supabaseUsers === null) {
      try {
        await loadSupabaseUsers(true);
      } catch (e) {
        showToast('দায়িত্বশীলদের তালিকা লোড হয়নি — আবার চেষ্টা করুন');
        return;
      }
    }
    const duplicateLogin = currentUserList().some(t =>
      t.id !== editingAdminId &&
      String(t.login_id || '').trim().toLowerCase() === login_id.toLowerCase()
    );
    if (duplicateLogin) { showToast('এই লগইন আইডি আগে থেকেই আছে'); return; }
    if (!hasSupabaseAdminSession()) {
      showToast('সংরক্ষণ করতে আবার লগইন করুন');
      return;
    }
    const res = await MMSharedAPI.saveMadrasaUser(MMSession.getAdminPin(), {
      id: editingAdminId || null,
      name,
      role: 'restricted_admin',
      login_id,
      pin,
      class_code: null,
      admin_perms: perms,
      is_active: true,
    });
    if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
    await loadSupabaseUsers(true);
    editingAdminId = null;
    closeModal('admin-user');
    showToast('সহকারী জিম্মাদার ডাটাবেজে সংরক্ষণ হয়েছে ✓');
    renderAdmins();
  }

  /* CLASSES */
  function classNextLabel(val) {
    if (val === 'alumni_pass') return 'বিদায় — পাস করেছেন';
    if (val === 'dropout') return 'বিদায় — মাঝপথে';
    return API.Classes.getName(val);
  }
  function renderClasses() {
    const dept = document.getElementById('class-filter').value || 'kitab';
    const classes = API.Classes.getByDept(dept, true);
    document.getElementById('class-list').innerHTML = classes.map(c => `
      <div class="class-row-set ${c.active === false ? 'inactive' : ''}">
        <div style="flex:1;min-width:0;">
          <div class="t-name">${API.esc(c.name)}</div>
          <div class="t-meta">
            <span class="class-badge">পরিচিতি: ${API.escBn(c.roll_prefix || '—')}</span>
            <span class="class-badge">ক্রম: ${API.esc(c.sort_order || '—')}</span>
            <span class="class-badge">পরবর্তী: ${API.esc(classNextLabel(c.next_class_id))}</span>
            ${c.active === false ? '<span class="class-badge">নিষ্ক্রিয়</span>' : ''}
          </div>
        </div>
        <button class="small-btn" onclick="openClassModal('${c.id}')">সম্পাদনা</button>
      </div>`).join('') || '<div style="font-size:13px;color:var(--ink3);">কোনো বর্ষ নেই</div>';
  }
  function populateClassNextOptions(selected) {
    const dept = document.getElementById('cls-dept').value || 'kitab';
    const options = API.Classes.getAll(true)
      .filter(c => !editingClassId || c.id !== editingClassId)
      .map(c => `<option value="${c.id}">${API.esc(c.dept === 'maktab' ? 'মক্তব — ' : 'কিতাব — ')}${API.esc(c.name)}</option>`)
      .join('');
    document.getElementById('cls-next').innerHTML = options +
      '<option value="alumni_pass">বিদায় — পাস করেছেন</option>' +
      '<option value="dropout">বিদায় — মাঝপথে</option>';
    document.getElementById('cls-next').value = selected || (dept === 'maktab' ? 'alumni_pass' : 'alumni_pass');
  }
  function openClassModal(id) {
    editingClassId = id;
    const currentDept = document.getElementById('class-filter')?.value || 'kitab';
    const c = id ? API.Classes.getById(id) : null;
    document.getElementById('cls-dept').value = c ? c.dept : currentDept;
    document.getElementById('cls-name').value = c ? (c.name || '') : '';
    document.getElementById('cls-roll-prefix').value = c ? (c.roll_prefix || '') : '';
    document.getElementById('cls-sort').value = c ? (c.sort_order || '') : '';
    document.getElementById('cls-active').checked = c ? c.active !== false : true;
    populateClassNextOptions(c ? c.next_class_id : 'alumni_pass');
    openModal('class');
  }
  function saveClass() {
    const dept = document.getElementById('cls-dept').value;
    const name = document.getElementById('cls-name').value.trim();
    const rollPrefix = document.getElementById('cls-roll-prefix').value.trim();
    const sortOrder = parseInt(document.getElementById('cls-sort').value, 10) || 999;
    const nextClassId = document.getElementById('cls-next').value || 'alumni_pass';
    const active = document.getElementById('cls-active').checked;
    if (!name) { showToast('নাম দিন'); return; }
    const data = { dept, name, roll_prefix: rollPrefix, sort_order: sortOrder, next_class_id: nextClassId, active };
    if (editingClassId) API.Classes.update(editingClassId, data);
    else API.Classes.add(data);
    document.getElementById('class-filter').value = dept;
    closeModal('class');
    showToast('বর্ষ/শ্রেণি সংরক্ষণ হয়েছে ✓');
    renderClasses();
  }

  /* TEACHERS */
  let currentTeacherFilter = 'all';

  function setTeacherFilter(filter) {
    if (!IS_MAIN_ADMIN && filter === 'other') filter = 'all';
    if ((filter === 'kitab' || filter === 'maktab') && !MMSession.canUseMadrasaDept(filter)) filter = 'all';
    currentTeacherFilter = filter;
    document.querySelectorAll('#teacher-filter-pills .pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('onclick') === `setTeacherFilter('${filter}')`);
    });
    const titles = { all:'👨‍🏫 শিক্ষক তালিকা', kitab:'📖 কিতাব বিভাগ — শ্রেণি শিক্ষক', maktab:'🕌 মক্তব বিভাগ — শ্রেণি শিক্ষক', other:'⭐ অন্যান্য ভূমিকা' };
    document.getElementById('teacher-list-title').textContent = titles[filter] || titles.all;
    renderTeachers();
  }

  async function renderTeachers() {
    if (hasSupabaseAdminSession() && supabaseUsers === null) {
      document.getElementById('teacher-list').innerHTML = '<div style="font-size:13px;color:var(--ink3);">তালিকা লোড হচ্ছে...</div>';
      try {
        await loadSupabaseUsers(true);
      } catch (e) {
        showToast('দায়িত্বশীলদের তালিকা লোড হয়নি — আবার চেষ্টা করুন');
      }
    }
    const classes = scopedClasses();
    const scopedClassIds = new Set(classes.map(c => c.id));
    const allTeachers = currentUserList().filter(t => {
      if (t.role === 'restricted_admin' || t.role === 'admin') return false;
      if (!IS_MAIN_ADMIN && !t.class_id) return false;
      if (t.class_id && !scopedClassIds.has(t.class_id)) return false;
      return true;
    });

    const kitabIds  = new Set(scopedClassesByDept('kitab').map(c => c.id));
    const maktabIds = new Set(scopedClassesByDept('maktab').map(c => c.id));

    const teachers = allTeachers.filter(t => {
      if (currentTeacherFilter === 'kitab')  return t.class_id && kitabIds.has(t.class_id);
      if (currentTeacherFilter === 'maktab') return t.class_id && maktabIds.has(t.class_id);
      if (currentTeacherFilter === 'other')  return IS_MAIN_ADMIN && !t.class_id;
      return true;
    });

    const roleLabel = { daftar:'দফতর', hifz:'হিফজ', library:'মাকতাবা', alumni:'পুরনো ছাত্র', khedmat:'খেদমত', restricted_admin:'সহকারী জিম্মাদার' };
    document.getElementById('teacher-list').innerHTML = teachers.map(t=>{
      const cls = t.class_id ? classes.find(c=>c.id===t.class_id) : null;
      const meta = cls ? API.esc(cls.name) : (t.role ? roleLabel[t.role]||t.role : '—');
      return `<div class="teacher-row ${t.is_active === false ? 'inactive' : ''}">
        <div style="flex:1;">
          <div class="t-name">${API.esc(t.name)}</div>
          <div class="t-meta">${meta}${t.class_id ? ' · আইডি: ' + API.esc(t.login_id || '—') : ''}${t.is_active === false ? ' · নিষ্ক্রিয়' : ''}</div>
        </div>
        <span class="pin-display">${t.has_pin === false ? 'পিন নেই' : 'পিন সেট আছে'}</span>
        ${t.class_id ? `<button class="small-btn" onclick="openTeacherModal('${t.id}')">সম্পাদনা</button>` : (IS_MAIN_ADMIN ? `<button class="small-btn" onclick="openStaffModal('${t.id}')">সম্পাদনা</button>` : '')}
      </div>`;
    }).join('')||`<div style="font-size:13px;color:var(--ink3);padding:12px 0;">এই বিভাগে কেউ নেই</div>`;

    document.getElementById('t-class').innerHTML = classes.map(c=>`<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
  }

  function openEditPin(id, name) {
    editingTeacherId = id;
    const user = getManagedUser(id);
    document.getElementById('ep-name').textContent = name;
    document.getElementById('ep-login-wrap').style.display = user && user.class_id ? 'block' : 'none';
    document.getElementById('ep-login-id').value = user && user.class_id ? (user.login_id || '') : '';
    document.getElementById('ep-pin').value = '';
    openModal('edit-pin');
  }
  async function saveTeacherPin() {
    const pin = document.getElementById('ep-pin').value;
    const user = getManagedUser(editingTeacherId);
    const login_id = document.getElementById('ep-login-id').value.trim();
    if (!user) { showToast('ব্যবহারকারী পাওয়া যায়নি'); return; }
    if (!IS_MAIN_ADMIN && (!user.class_id || !canUseClassId(user.class_id))) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    if (user && user.class_id) {
      if (!login_id) { showToast('লগইন আইডি দিন'); return; }
      const duplicateLogin = currentUserList().some(t =>
        t.id !== editingTeacherId &&
        String(t.login_id || '').trim().toLowerCase() === login_id.toLowerCase()
      );
      if (duplicateLogin) { showToast('এই লগইন আইডি আগে থেকেই আছে'); return; }
    }
    if (pin.length !== 4) { showToast('৪ সংখ্যার পিন দিন'); return; }
    if (hasSupabaseAdminSession() && supabaseUsers !== null) {
      const payload = {
        id: user.id,
        name: user.name,
        role: LOCAL_ROLE_TO_SUPA[user.role] || user.role,
        login_id: user.class_id ? login_id : null,
        pin,
        class_code: user.class_id ? classCodeForLocalId(user.class_id) : null,
        is_active: user.is_active !== false,
      };
      const res = IS_MAIN_ADMIN
        ? await MMSharedAPI.saveMadrasaUser(MMSession.getAdminPin(), payload)
        : await MMSharedAPI.saveScopedMadrasaUser(settingsActorId(), MMSession.getAdminPin(), payload);
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSupabaseUsers(true);
    } else {
      API.Teachers.update(editingTeacherId, user && user.class_id ? {pin, login_id} : {pin});
    }
    closeModal('edit-pin');
    showToast('পিন আপডেট হয়েছে ✓');
    renderTeachers();
  }

  function openTeacherModal(id) {
    editingTeacherProfileId = id;
    const t = id ? getManagedUser(id) : null;
    if (!IS_MAIN_ADMIN && t && (!t.class_id || !canUseClassId(t.class_id))) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    document.getElementById('teacher-modal-title').textContent = id ? 'বর্ষ দায়িত্বশীল সম্পাদনা' : 'বর্ষ দায়িত্বশীল';
    document.getElementById('teacher-save-btn').textContent = id ? 'সংরক্ষণ করুন' : 'যোগ করুন';
    document.getElementById('t-name').value = t ? (t.name || '') : '';
    document.getElementById('t-login-id').value = t ? (t.login_id || '') : '';
    document.getElementById('t-class').innerHTML = scopedClasses().map(c=>`<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
    document.getElementById('t-class').value = t ? (t.class_id || '') : (document.getElementById('t-class').value || '');
    setPinField('t-pin', !!t, '0000');
    document.getElementById('t-active').checked = t ? t.is_active !== false : true;
    openModal('add-teacher');
  }

  async function saveTeacher() {
    const name     = document.getElementById('t-name').value.trim();
    const login_id = document.getElementById('t-login-id').value.trim();
    const class_id = document.getElementById('t-class').value;
    const pin      = document.getElementById('t-pin').value.trim();
    const is_active = document.getElementById('t-active').checked;
    if (!name) { showToast('নাম দিন'); return; }
    if (!login_id) { showToast('লগইন আইডি দিন'); return; }
    const pinErr = pinFieldError(pin, !!editingTeacherProfileId);
    if (pinErr) { showToast(pinErr); return; }
    if (!canUseClassId(class_id)) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    const existing = currentUserList().find(t =>
      t.id !== editingTeacherProfileId &&
      t.class_id === class_id &&
      t.is_active !== false
    );
    if (existing) { showToast('এই বর্ষে আগে থেকেই একজন শিক্ষক নির্ধারিত আছে'); return; }
    const duplicateLogin = currentUserList().some(t =>
      t.id !== editingTeacherProfileId &&
      String(t.login_id || '').trim().toLowerCase() === login_id.toLowerCase()
    );
    if (duplicateLogin) { showToast('এই লগইন আইডি আগে থেকেই আছে'); return; }
    const data = { name, login_id, class_id, role:'teacher', is_active };
    if (pin) data.pin = pin;
    if (hasSupabaseAdminSession()) {
      const payload = {
        id: editingTeacherProfileId || null,
        name,
        role: 'madrasa_teacher',
        login_id,
        pin,
        class_code: classCodeForLocalId(class_id),
        is_active,
      };
      const res = IS_MAIN_ADMIN
        ? await MMSharedAPI.saveMadrasaUser(MMSession.getAdminPin(), payload)
        : await MMSharedAPI.saveScopedMadrasaUser(settingsActorId(), MMSession.getAdminPin(), payload);
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSupabaseUsers(true);
    } else if (editingTeacherProfileId) API.Teachers.update(editingTeacherProfileId, data);
    else API.Teachers.add(data);
    document.getElementById('t-name').value='';
    document.getElementById('t-login-id').value='';
    editingTeacherProfileId = null;
    closeModal('add-teacher');
    showToast('শিক্ষক সংরক্ষণ হয়েছে ✓');
    renderTeachers();
  }

  function openStaffModal(id) {
    if (!IS_MAIN_ADMIN) { showToast('এই কাজের অনুমতি নেই'); return; }
    editingStaffId = id;
    const user = id ? getManagedUser(id) : null;
    document.getElementById('staff-modal-title').textContent = id ? 'বিশেষ ভূমিকা সম্পাদনা' : 'বিশেষ ভূমিকা';
    document.getElementById('staff-save-btn').textContent = id ? 'সংরক্ষণ করুন' : 'যোগ করুন';
    document.getElementById('st-name').value = user ? (user.name || '') : '';
    document.getElementById('st-role').value = user ? (user.role || 'daftar') : 'daftar';
    setPinField('st-pin', !!user, '0000');
    document.getElementById('st-active').checked = user ? user.is_active !== false : true;
    openModal('add-staff');
  }

  async function saveStaff() {
    if (!IS_MAIN_ADMIN) { showToast('এই কাজের অনুমতি নেই'); return; }
    const name = document.getElementById('st-name').value.trim();
    const role = document.getElementById('st-role').value;
    const pin  = document.getElementById('st-pin').value.trim();
    const is_active = document.getElementById('st-active').checked;
    if (!name) { showToast('নাম দিন'); return; }
    const pinErr = pinFieldError(pin, !!editingStaffId);
    if (pinErr) { showToast(pinErr); return; }
    if (hasSupabaseAdminSession()) {
      const res = await MMSharedAPI.saveMadrasaUser(MMSession.getAdminPin(), {
        id: editingStaffId || null,
        name,
        role: LOCAL_ROLE_TO_SUPA[role],
        login_id: null,
        pin,
        class_code: null,
        is_active,
      });
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSupabaseUsers(true);
    } else if (editingStaffId) {
      API.Teachers.update(editingStaffId, pin ? { name, class_id:null, pin, role, is_active } : { name, class_id:null, role, is_active });
    } else {
      API.Teachers.add({name, class_id:null, pin, role, is_active});
    }
    document.getElementById('st-name').value='';
    editingStaffId = null;
    closeModal('add-staff');
    showToast('বিশেষ ভূমিকা সংরক্ষণ হয়েছে ✓');
    renderTeachers();
  }

  /* KITAB */
  async function loadSettingsBooks() {
    if (!window.MDRSupabaseSync || !MMSession.getAdminPin || !MMSession.getAdminPin()) return;
    try {
      await MDRSupabaseSync.syncSettingsBooks();
    } catch (e) {
      console.warn('settings books sync failed', e);
      showToast('কিতাব তালিকা ডাটাবেজ থেকে লোড হয়নি');
    }
  }

  async function initKitab() {
    await loadSettingsBooks();
    const classes = scopedClasses();
    const opts = classes.map(c=>`<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
    document.getElementById('kitab-class').innerHTML      = opts;
    document.getElementById('kitab-view-class').innerHTML = opts;
    renderKitabList();
  }
  async function addKitab() {
    const class_id = document.getElementById('kitab-class').value;
    const name     = document.getElementById('kitab-name').value.trim();
    const pages    = parseInt(document.getElementById('kitab-pages').value)||0;
    if (!name) { showToast('কিতাবের নাম দিন'); return; }
    if (!canUseClassId(class_id)) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    if (window.MMSharedAPI && MMSharedAPI.upsertBook && MMSession.getAdminPin()) {
      const res = await MMSharedAPI.upsertBook(settingsActorId(), MMSession.getAdminPin(), {
        class_code: classCodeForLocalId(class_id),
        name,
        total_pages: pages,
        sort_order: API.KitabProgress.getKitabsByClass(class_id).length + 1,
      });
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSettingsBooks();
    } else if (IS_MAIN_ADMIN) {
      API.KitabProgress.addKitab({class_id, name, total_pages:pages});
    } else {
      showToast('কিতাব সংরক্ষণ করতে আবার লগইন করুন');
      return;
    }
    document.getElementById('kitab-name').value='';
    showToast('কিতাব যোগ হয়েছে ✓');
    renderKitabList();
  }
  function openKitabModal(id) {
    const cid = document.getElementById('kitab-view-class')?.value;
    if (!canUseClassId(cid)) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    const kitab = API.KitabProgress.getKitabsByClass(cid).find(k => String(k.id) === String(id));
    if (!kitab) { showToast('কিতাব পাওয়া যায়নি'); return; }
    editingKitabId = id;
    document.getElementById('kitab-edit-name').value = kitab.name || '';
    document.getElementById('kitab-edit-pages').value = kitab.total_pages ? String(kitab.total_pages) : '';
    openModal('kitab-edit');
  }
  async function saveKitabEdit() {
    const name = document.getElementById('kitab-edit-name').value.trim();
    const pages = parseInt(document.getElementById('kitab-edit-pages').value, 10) || 0;
    if (!name) { showToast('কিতাবের নাম দিন'); return; }
    if (!editingKitabId) return;
    const cid = document.getElementById('kitab-view-class')?.value;
    if (!canUseClassId(cid)) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    const kitab = API.KitabProgress.getKitabsByClass(cid).find(k => String(k.id) === String(editingKitabId));
    if (!kitab) { showToast('কিতাব পাওয়া যায়নি'); return; }
    if (window.MMSharedAPI && MMSharedAPI.upsertBook && MMSession.getAdminPin()) {
      const res = await MMSharedAPI.upsertBook(settingsActorId(), MMSession.getAdminPin(), {
        id: editingKitabId,
        class_code: classCodeForLocalId(cid),
        name,
        total_pages: pages,
        sort_order: Number(kitab.sort_order) || 0,
      });
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSettingsBooks();
    } else if (IS_MAIN_ADMIN) {
      API.KitabProgress.updateKitab(editingKitabId, { name, total_pages: pages });
    } else {
      showToast('কিতাব সংরক্ষণ করতে আবার লগইন করুন');
      return;
    }
    editingKitabId = null;
    closeModal('kitab-edit');
    showToast('কিতাব আপডেট হয়েছে ✓');
    renderKitabList();
  }
  async function deleteKitab(id) {
    const cid = document.getElementById('kitab-view-class')?.value;
    if (!canUseClassId(cid)) { showToast('এই বিভাগের অনুমতি নেই'); return; }
    const entryCount = API.KitabProgress.countProgressEntries(id);
    let msg = 'এই কিতাবটি মুছে ফেলবেন?';
    if (entryCount > 0) {
      msg = `এই কিতাবে ${entryCount}টি অগ্রগতি রেকর্ড আছে। মুছলে কিতাব ও সংশ্লিষ্ট অগ্রগতি চলে যাবে।\n\nনিশ্চিত?`;
    }
    if (!confirm(msg)) return;
    if (window.MMSharedAPI && MMSharedAPI.deleteBook && MMSession.getAdminPin()) {
      const res = await MMSharedAPI.deleteBook(settingsActorId(), MMSession.getAdminPin(), id);
      if (!res || !res.ok) { showToast(userSaveErrorMessage(res && res.error)); return; }
      await loadSettingsBooks();
    } else {
      showToast('কিতাব মুছতে আবার লগইন করুন');
      return;
    }
    showToast('কিতাব মুছে ফেলা হয়েছে');
    renderKitabList();
  }
  function renderKitabList() {
    const cid   = document.getElementById('kitab-view-class')?.value;
    const kitabs= API.KitabProgress.getKitabsByClass(cid);
    document.getElementById('kitab-list').innerHTML = kitabs.map(k=>{
      const safeId = String(k.id).replace(/'/g, "\\'");
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--cream2);font-size:13px;">
        <span style="font-weight:600;min-width:0;flex:1;">${API.esc(k.name)}</span>
        <span style="color:var(--ink3);white-space:nowrap;">${k.total_pages?k.total_pages+' পৃষ্ঠা':'—'}</span>
        <span style="display:flex;gap:6px;flex-shrink:0;">
          <button type="button" class="small-btn" onclick="openKitabModal('${safeId}')">সম্পাদন</button>
          <button type="button" class="small-btn" onclick="deleteKitab('${safeId}')">মুছুন</button>
        </span>
      </div>`;
    }).join('')||'<div style="color:var(--ink3);font-size:13px;">কোনো কিতাব নেই</div>';
  }

  function openModal(id) { document.getElementById('modal-'+id).classList.add('open'); }
  function closeModal(id) { document.getElementById('modal-'+id).classList.remove('open'); }
  function showToast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

  async function bootSettingsPage() {
    applySettingsAccess();
    const tab = allowedSettingsTabs()[0] || 'teachers';
    ['general','pin','admins','classes','teachers','kitab'].forEach(t=>{
      document.getElementById('tab-'+t).style.display   = t===tab?'block':'none';
      document.getElementById('pill-'+t).classList.toggle('active',t===tab);
    });
    if (tab==='general')  loadGeneral();
    if (tab==='admins')   renderAdmins();
    if (tab==='classes')  renderClasses();
    if (tab==='teachers') renderTeachers();
    if (tab==='kitab')    await initKitab();
  }

  MMLoading.run(bootSettingsPage);
