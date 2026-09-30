  if (!MMSession.requireStaffRoleOrAdminPerm('daftar', 'daftar', '/admin/madrasa.html')) { throw new Error('daftar permission denied'); }
  document.getElementById('top-name').textContent = MMSession.getName() || 'দফতর';
  mmInsertMonitorBanner();
  MMSession.configureTopbarHubAndLockout();

  /* ── STATE ── */
  let daftarAttDate   = API.today();
  let attState        = {};
  let attReasonState  = {};
  let attClassFilter  = 'all';
  let attSearchText   = '';
  let qFilter         = 'all';
  let feeHistoryClassId = null;
  let absentModalMode = null;
  /** ক্যালেন্ডারে দেখা মাস (গ্রিড); দিনে ক্লিক বা “দ্রুত তারিখ” দিয়ে `daftarAttDate` বদলায় */
  let auditView = { y: new Date().getFullYear(), m: new Date().getMonth() };

  /* ── PENDING CHANGES (তারিখ কনফার্ম) ── */
  function hasPendingEdits() {
    return Object.keys(attState).length > 0 || Object.keys(attReasonState).length > 0;
  }

  /* ── হাজিরা অডিট: সেশন শুরু → আজ ── */
  function getSessionStartISO() {
    try {
      const s = API.Settings && API.Settings.get ? API.Settings.get() : null;
      const fromSet = s && s.session_start_date != null && String(s.session_start_date).trim() !== '' ? String(s.session_start_date).trim() : '';
      if (fromSet) return fromSet;
    } catch (e) {}
    try {
      if (API.Sessions && API.Sessions.getCurrent) {
        const cur = API.Sessions.getCurrent();
        if (cur && cur.start_date) return String(cur.start_date);
      }
    } catch (e) {}
    return null;
  }

  function isoAddDays(iso, delta) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().split('T')[0];
  }

  function ddmmyyBn(iso) {
    const d = new Date(iso + 'T12:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return toBn(dd) + '/' + toBn(mm) + '/' + toBn(yy);
  }

  let auditExpanded = false;
  function ymcmp(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    return a.m - b.m;
  }
  function getAuditMinYM() {
    const s = getSessionStartISO();
    if (!s) return null;
    const d = new Date(s + 'T12:00:00');
    return { y: d.getFullYear(), m: d.getMonth() };
  }
  function getAuditMaxYM() {
    const t = new Date(API.today() + 'T12:00:00');
    return { y: t.getFullYear(), m: t.getMonth() };
  }
  function syncAuditViewFromDaftar() {
    const d = new Date(daftarAttDate + 'T12:00:00');
    auditView = { y: d.getFullYear(), m: d.getMonth() };
  }
  function setAuditMonthNavDisabled() {
    const minA = getAuditMinYM();
    const maxA = getAuditMaxYM();
    const prevB = document.getElementById('audit-m-prev');
    const nextB = document.getElementById('audit-m-next');
    if (prevB) prevB.disabled = !!(minA && ymcmp(auditView, minA) <= 0);
    if (nextB) nextB.disabled = !!(maxA && ymcmp(auditView, maxA) >= 0);
  }
  function onHeroDateBarClick(ev) {
    ev.stopPropagation();
    if (ev.target && ev.target.closest && ev.target.closest('button.hd-nav')) return;
    setAuditExpanded(!auditExpanded);
  }
  function onHeroDateBarKeydown(ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setAuditExpanded(!auditExpanded); }
  }
  function setAuditExpanded(next) {
    auditExpanded = !!next;
    const bar  = document.getElementById('hero-date-bar');
    const body = document.getElementById('audit-body');
    if (bar) {
      bar.classList.toggle('is-cal-open', auditExpanded);
      bar.setAttribute('aria-expanded', auditExpanded ? 'true' : 'false');
    }
    if (body) {
      body.hidden = !auditExpanded;
      body.setAttribute('aria-hidden', auditExpanded ? 'false' : 'true');
    }
    if (auditExpanded) {
      syncAuditViewFromDaftar();
      renderAttendanceAudit(true);
    }
  }
  function auditShiftMonth(delta) {
    const d = new Date(auditView.y, auditView.m + delta, 1, 12, 0, 0);
    auditView = { y: d.getFullYear(), m: d.getMonth() };
    const minA = getAuditMinYM();
    const maxA = getAuditMaxYM();
    if (minA && ymcmp(auditView, minA) < 0) auditView = { y: minA.y, m: minA.m };
    if (maxA && ymcmp(auditView, maxA) > 0) auditView = { y: maxA.y, m: maxA.m };
    renderAttendanceAudit(true);
  }

  function renderAttendanceAudit(forceGrid) {
    const startISO = getSessionStartISO();
    const todayISO = API.today();
    const summary = document.getElementById('hero-audit-summary');
    const panel  = document.getElementById('audit-body');
    if (!summary || !startISO || startISO > todayISO) {
      if (summary) summary.style.display = 'none';
      if (panel) { panel.hidden = true; }
      return;
    }

    // ১) শুরু→আজ পর্যন্ত "কোনো হাজিরা নেই" এমন দিনগুলো
    const missingDays = [];
    for (let cur = startISO; cur <= todayISO; cur = isoAddDays(cur, 1)) {
      const any = API.Attendance.hasAnyForDate(cur);
      if (!any) missingDays.push(cur);
    }

    const lineEl = document.getElementById('audit-line');
    if (lineEl) {
      if (!missingDays.length) {
        lineEl.innerHTML = 'শিক্ষাবর্ষ শুরু থেকে আজ পর্যন্ত <strong>সব দিনেই</strong> হাজিরা আছে';
      } else {
        lineEl.innerHTML = 'শিক্ষাবর্ষ শুরু থেকে আজ পর্যন্ত বাকি <strong>' + toBn(missingDays.length) + '</strong> দিনের হাজিরা নেই';
      }
    }
    summary.style.display = 'block';

    if (!forceGrid && !auditExpanded) return;

    const y = auditView.y;
    const m = auditView.m;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstDow = new Date(y, m, 1).getDay();
    const grid = document.getElementById('audit-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const monthEl = document.getElementById('audit-month');
    if (monthEl) {
      const MON_BN = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগ', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];
      monthEl.textContent = MON_BN[m] + ' ' + toBn(y);
    }
    const dowEl = document.getElementById('audit-dow');
    if (dowEl) {
      const DOW = ['রবি','সোম','মঙ্গল','বুধ','বৃহ','শুক্র','শনি'];
      dowEl.innerHTML = DOW.map(d0 => '<div class="ad-dow">' + d0 + '</div>').join('');
    }

    for (let i = 0; i < firstDow; i++) {
      const pad = document.createElement('div');
      pad.className = 'ad-pad';
      grid.appendChild(pad);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, '0');
      const mm = String(m + 1).padStart(2, '0');
      const iso = y + '-' + mm + '-' + dd;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ad-day';
      btn.textContent = toBn(day);

      const outOfSession = iso < startISO;
      const future = iso > todayISO;
      if (outOfSession) btn.classList.add('ad-out');

      if (iso === daftarAttDate) btn.classList.add('ad-sel');

      if (outOfSession || future) {
        btn.disabled = true;
      } else {
        const taken = API.Attendance.hasAnyForDate(iso);
        btn.classList.add(taken ? 'ad-taken' : 'ad-miss');
        btn.addEventListener('click', () => trySetDaftarAttDate(iso));
      }

      grid.appendChild(btn);
    }
    setAuditMonthNavDisabled();
  }

  /* ── DATE + হিজরী (compact একলাইন) ── */
  function updateHero() {
    const isToday = daftarAttDate === API.today();
    const d0 = new Date(daftarAttDate + 'T12:00:00');
    const BN_D_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
    const weekday = BN_D_SHORT[d0.getDay()];

    // গ্রিগরিয়ান DD/MM/YY বাংলায়
    const gd = String(d0.getDate()).padStart(2,'0');
    const gm = String(d0.getMonth()+1).padStart(2,'0');
    const gy = String(d0.getFullYear()).slice(-2);
    const gregShort = toBn(gd) + '/' + toBn(gm) + '/' + toBn(gy);

    const hijriShort = window.MMHijri && MMHijri.shortHijriBn ? MMHijri.shortHijriBn(daftarAttDate) : '';

    const lineParts = [weekday];
    if (hijriShort) lineParts.push('হি: ' + hijriShort);
    lineParts.push('খ্রি: ' + gregShort);
    document.getElementById('hd-compact-text').textContent = lineParts.join(' · ');
    document.getElementById('hd-dot').style.display = isToday ? 'inline-block' : 'none';
    const inp = document.getElementById('daftar-att-date');
    if (inp) {
      inp.value = daftarAttDate;
      inp.max = API.today();
      const sMin = getSessionStartISO();
      if (sMin) { inp.min = sMin; } else { inp.removeAttribute('min'); }
    }

    const existing = API.Attendance.getByDate(daftarAttDate);
    const active   = getAttendanceStudents();
    let p = 0, a = 0, h = 0;
    active.forEach(s => {
      const st = currentAttStatus(s.id, existing);
      if (st === 'absent') a++;
      else if (st === 'holiday') h++;
      else if (st === 'present') p++;
    });
    document.getElementById('st-present').textContent = toBn(p);
    document.getElementById('st-absent').textContent  = toBn(a);
    document.getElementById('st-total').textContent   = toBn(active.length);
    const schoolTotal = p + a;
    const pct = schoolTotal ? Math.round(p / schoolTotal * 100) : 0;
    document.getElementById('bar-present').style.width = pct + '%';
    document.getElementById('bar-absent').style.width  = (100 - pct) + '%';

    const todayRecs = isToday ? existing : API.Attendance.getByDate(API.today());
    const saved     = new Set(todayRecs.map(r => r.student_id));
    const missing   = active.filter(s => !saved.has(s.id));
    const nb = document.getElementById('notice-body');
    if (missing.length === 0) {
      nb.innerHTML = '<span class="notice-ok">✓ আজ সকল সক্রিয় ছাত্রের উপস্থিতি সেভ হয়েছে</span> · <strong>' + toBn(active.length) + '</strong> জন';
    } else {
      const byClass = {};
      missing.forEach(s => { const cn = API.Classes.getName(s.class_id) || '—'; byClass[cn] = (byClass[cn] || 0) + 1; });
      const parts = Object.keys(byClass).sort((a, b) => a.localeCompare(b, 'bn'))
        .map(cn => API.esc(cn) + ' <strong>' + toBn(byClass[cn]) + '</strong> জন');
      nb.innerHTML = 'আজ <strong>' + toBn(missing.length) + '</strong> জনের হাজিরা সেভ বাকি · ' + parts.join(' · ');
    }

    const unsaved  = hasPendingEdits();
    const allSaved = active.length > 0 && missing.length === 0 && !unsaved;
    document.getElementById('save-btn').classList.toggle('all-saved', allSaved && isToday);
    document.getElementById('save-count').textContent =
      unsaved ? '● সেভ বাকি' : (allSaved && isToday ? '✓ সম্পন্ন' : '');
    const sf = document.querySelector('.save-footer');
    if (sf) sf.style.display = unsaved ? 'block' : 'none';
    if (auditExpanded) renderAttendanceAudit(true);
    else renderAttendanceAudit(false);
    updateHeroFilterClasses();
  }

  function updateHeroFilterClasses() {
    const p = document.getElementById('hs-filter-present');
    const a = document.getElementById('hs-filter-absent');
    const t = document.getElementById('hs-filter-total');
    if (!p || !a || !t) return;
    p.classList.toggle('hs-on', qFilter === 'present');
    a.classList.toggle('hs-on', qFilter === 'absent');
    t.classList.toggle('hs-on', qFilter === 'all');
    p.setAttribute('aria-pressed', qFilter === 'present' ? 'true' : 'false');
    a.setAttribute('aria-pressed', qFilter === 'absent' ? 'true' : 'false');
    t.setAttribute('aria-pressed', qFilter === 'all' ? 'true' : 'false');
  }

  function trySetDaftarAttDate(iso) {
    if (iso === daftarAttDate) return;
    if (hasPendingEdits() && !confirm('সংরক্ষণ না করেই তারিখ বদলাতে চান? এখনকার হাজিরা বদল মুছে যাবে।')) {
      const inp = document.getElementById('daftar-att-date');
      if (inp) inp.value = daftarAttDate;
      return;
    }
    daftarAttDate = iso;
    attState = {};
    attReasonState = {};
    if (auditExpanded) syncAuditViewFromDaftar();
    updateHero();
    renderAttendance();
  }

  function daftarPrevDay() {
    const d = new Date(daftarAttDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    trySetDaftarAttDate(d.toISOString().split('T')[0]);
  }
  function daftarNextDay() {
    if (daftarAttDate >= API.today()) { showToast('ভবিষ্যতের তারিখ নির্বাচন যাবে না'); return; }
    const d = new Date(daftarAttDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().split('T')[0];
    if (next > API.today()) { showToast('ভবিষ্যতের তারিখ নির্বাচন যাবে না'); return; }
    trySetDaftarAttDate(next);
  }
  function onDaftarDateInput() {
    const v = document.getElementById('daftar-att-date').value;
    if (!v) return;
    if (v > API.today()) {
      showToast('ভবিষ্যতের তারিখ নির্বাচন যাবে না');
      document.getElementById('daftar-att-date').value = daftarAttDate;
      return;
    }
    trySetDaftarAttDate(v);
  }

  function findLastAttendedDayBefore(iso) {
    const start = getSessionStartISO();
    if (!iso) return null;
    for (let cur = isoAddDays(iso, -1); !start || cur >= start; cur = isoAddDays(cur, -1)) {
      if (API.Attendance.hasAnyForDate(cur)) return cur;
    }
    return null;
  }

  function attRecForStudent(recs, student) {
    const sid = String(student.id || '');
    const supa = String(student.supabase_id || student.id || '');
    return recs.find(r => String(r.student_id || '') === sid || String(r.student_id || '') === supa) || null;
  }

  async function copyFromPreviousDay() {
    if (mmMutationBlocked(showToast)) return;
    const sourceIso = findLastAttendedDayBefore(daftarAttDate);
    if (!sourceIso) {
      showToast('আগের কোনো দিনে হাজিরা রেকর্ড নেই');
      return;
    }
    let recs = API.Attendance.getByDate(sourceIso);
    if (!recs.length && window.MDRDaftarSupabase && MDRDaftarSupabase.ensureDateInCache) {
      try {
        showToast('আগের দিনের হাজিরা লোড হচ্ছে…');
        recs = await MDRDaftarSupabase.ensureDateInCache(sourceIso);
      } catch (e) {
        console.warn('[Daftar] ensureDateInCache failed:', e);
        recs = [];
      }
    }
    if (!recs.length) {
      showToast('আগের দিনের হাজিরা লোড হয়নি — আবার চেষ্টা করুন');
      return;
    }
    const active = getAttendanceStudents();
    let copied = 0;
    active.forEach(s => {
      const r = attRecForStudent(recs, s);
      if (!r) return;
      copied++;
      const st = API.Attendance.statusOf(r);
      if (st === 'absent') {
        attState[s.id] = 'absent';
        attReasonState[s.id] = (r.absent_reason || '').trim() || 'আগের দিন থেকে (কারণ সেভ হয়নি)';
      } else if (st === 'holiday') {
        attState[s.id] = 'holiday';
        delete attReasonState[s.id];
      } else {
        attState[s.id] = 'present';
        delete attReasonState[s.id];
      }
    });
    if (!copied) {
      showToast('আগের দিনের হাজিরা পাওয়া গেল কিন্তু ছাত্র মিলেনি');
      return;
    }
    showToast('আগের দিনের মতো এডিট করা হয়েছে — «সংরক্ষণ» করুন');
    updateHero();
    renderAttendance();
  }

  /* ── FILTER HELPERS ── */
  function setAttClassFilter(v) {
    attClassFilter = v || 'all';
    renderAttendance();
  }
  function setAttSearch(v) {
    attSearchText = v || '';
    renderAttendance();
  }
  function setQFilter(type) {
    if (type === 'all') {
      qFilter = 'all';
    } else if (qFilter === type) {
      qFilter = 'all';
    } else {
      qFilter = type;
    }
    updateHeroFilterClasses();
    renderAttendance();
  }

  function getStudentsInScope() {
    const students = getAttendanceStudents();
    if (attClassFilter === 'all') return students;
    return students.filter(s => s.class_id === attClassFilter);
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  function getAttendanceStudents() {
    const classIds = new Set(API.Classes.getAll().map(c => c.id));
    const requireRemoteId = !!(window.MDRDaftarSupabase && window.MMSharedAPI);
    return API.Students.getAll().filter(s => {
      if (!s.active || !classIds.has(s.class_id)) return false;
      return !requireRemoteId || isUuid(s.supabase_id || s.id);
    });
  }

  function currentAttStatus(sid, existing) {
    if (attState[sid] !== undefined) {
      const s = attState[sid];
      return (s === 'absent' || s === 'holiday') ? s : 'present';
    }
    const rec = existing.find ? existing.find(a => a.student_id === sid) : null;
    return rec ? API.Attendance.statusOf(rec) : 'not_marked';
  }

  function getAbsentReason(sid, existing) {
    if (attReasonState[sid] !== undefined) return String(attReasonState[sid] || '').trim();
    const rec = existing.find(a => a.student_id === sid);
    if (rec && API.Attendance.statusOf(rec) === 'absent') return String(rec.absent_reason || '').trim();
    return '';
  }

  function getFiltered(students, existing) {
    const q = (attSearchText || '').trim().toLowerCase();
    return students.filter(s => {
      const st = currentAttStatus(s.id, existing);
      if (qFilter === 'present' && st !== 'present') return false;
      if (qFilter === 'absent'  && st !== 'absent')  return false;
      if (q) {
        const hay = (String(s.name||'') + ' ' + String(s.permanent_id||'') + ' ' + String(s.roll||'')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }


  /* ── RENDER ATTENDANCE ── */
  function renderAttendance() {
    const existing  = API.Attendance.getByDate(daftarAttDate);
    const allActive = getAttendanceStudents();
    const el        = document.getElementById('att-list');

    if (!allActive.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">👥</span><div class="empty-text">কোনো সক্রিয় ছাত্র নেই</div></div>';
      return;
    }

    const classes = API.Classes.getAll();
    if (attClassFilter !== 'all' && !classes.some(c => c.id === attClassFilter)) attClassFilter = 'all';

    const inScope  = getStudentsInScope();
    const filtered = getFiltered(inScope, existing);

    if (!filtered.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">🔎</span><div class="empty-text">এই ফিল্টারে কোনো ছাত্র নেই</div></div>';
      updateHero();
      return;
    }

    /* group by class */
    const groupMap = new Map();
    filtered.forEach(s => {
      if (!groupMap.has(s.class_id)) groupMap.set(s.class_id, []);
      groupMap.get(s.class_id).push(s);
    });

    let html = '';
    classes.forEach(cls => {
      if (!groupMap.has(cls.id)) return;
      const arr  = groupMap.get(cls.id);
      const pres = arr.filter(s => currentAttStatus(s.id, existing) === 'present').length;
      const marked = arr.filter(s => currentAttStatus(s.id, existing) !== 'not_marked').length;
      html += `<div class="class-sep">
        <span class="cs-name">${API.esc(cls.name)}</span>
        <span class="cs-badge">${toBn(arr.length)} জন</span>
        <span class="cs-pct">${toBn(pres)} উপস্থিত · ${toBn(marked)} চিহ্নিত</span>
      </div>`;
      arr.forEach(s => {
        const st = currentAttStatus(s.id, existing);
        const rsn = st === 'absent' ? getAbsentReason(s.id, existing) : '';
        const idPart = s.permanent_id
          ? '<span class="s-id-inline">' + API.escBn(s.permanent_id) + '</span>'
          : '';
        const reasonBlock = (st === 'absent' && rsn)
          ? '<span class="s-abs-reason">' + API.esc(rsn) + '</span>'
          : (st === 'absent' && !rsn
            ? '<span class="s-abs-reason s-abs-missing" title="সংরক্ষণের আগে কারণ লিখতে হবে">কারণ সেভের আগে</span>'
            : '');
        const rowCls = st === 'absent' ? ' is-absent' : st === 'holiday' ? ' is-holiday' : '';
        const SVG_P = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        const SVG_A = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        const SVG_H = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
        const toggleBlock = `<div class="s-toggle">
          <button type="button" class="tog${st === 'present' ? ' is-p' : ''}" onclick="markAtt('${s.id}','present')" title="উপস্থিত">${SVG_P}</button>
          <button type="button" class="tog${st === 'absent'  ? ' is-a' : ''}" onclick="markAtt('${s.id}','absent')"  title="অনুপস্থিত">${SVG_A}</button>
          <button type="button" class="tog${st === 'holiday' ? ' is-h' : ''}" onclick="markAtt('${s.id}','holiday')" title="বিরতি">${SVG_H}</button>
        </div>`;
        html += `<div class="s-row${rowCls}" id="att-${s.id}">
          <span class="s-roll">${API.escBn(s.roll || '')}</span>
          <div class="s-name-col">
            <div class="s-line1">
              <button type="button" class="s-name-btn" onclick="MMStudentModal.open('${s.id}')">${API.esc(s.name)}</button>
              ${idPart}
              ${reasonBlock}
            </div>
          </div>
          ${toggleBlock}
        </div>`;
      });
    });
    el.innerHTML = html;
    updateHero();
  }

  function markAtt(sid, status) {
    if (mmMutationBlocked(showToast)) return;
    if (status === 'present') {
      attState[sid] = 'present';
      delete attReasonState[sid];
      renderAttendance();
      return;
    }
    if (status === 'holiday') {
      attState[sid] = 'holiday';
      delete attReasonState[sid];
      renderAttendance();
      return;
    }
    const existing = API.Attendance.getByDate(daftarAttDate);
    const prev = (attReasonState[sid] !== undefined)
      ? attReasonState[sid]
      : (() => { const r = existing.find(a => a.student_id === sid); return (r && r.absent_reason) || ''; })();
    absentModalMode = { type: 'single', sid: sid };
    document.getElementById('abs-reason-inp').value = prev;
    openModal('absent-reason');
  }

  function confirmAbsentReason() {
    if (mmMutationBlocked(showToast)) return;
    const t = document.getElementById('abs-reason-inp').value.trim();
    if (!t) { showToast('অনুপস্থিতির কারণ লিখতে হবে'); return; }
    if (absentModalMode && absentModalMode.type === 'single') {
      attState[absentModalMode.sid] = 'absent';
      attReasonState[absentModalMode.sid] = t;
    } else if (absentModalMode && absentModalMode.type === 'bulk') {
      const ex = API.Attendance.getByDate(daftarAttDate);
      getFiltered(getStudentsInScope(), ex).forEach(s => { attState[s.id] = 'absent'; attReasonState[s.id] = t; });
    }
    closeModal('absent-reason');
    absentModalMode = null;
    renderAttendance();
  }

  function bulkMark(status) {
    if (mmMutationBlocked(showToast)) return;
    const ex = API.Attendance.getByDate(daftarAttDate);
    const filtered = getFiltered(getStudentsInScope(), ex);
    if (!filtered.length) { showToast('কোনো ছাত্র নেই'); return; }
    if (status === 'absent') {
      absentModalMode = { type: 'bulk' };
      document.getElementById('abs-reason-inp').value = '';
      openModal('absent-reason');
      return;
    }
    if (status === 'holiday') {
      filtered.forEach(s => { attState[s.id] = 'holiday'; delete attReasonState[s.id]; });
      renderAttendance();
      return;
    }
    filtered.forEach(s => { attState[s.id] = 'present'; delete attReasonState[s.id]; });
    renderAttendance();
  }

  async function saveAllAttendance() {
    if (mmMutationBlocked(showToast)) return;
    const students = getAttendanceStudents();
    const existing = API.Attendance.getByDate(daftarAttDate);
    const notMarked = students.filter(s => currentAttStatus(s.id, existing) === 'not_marked');
    if (notMarked.length) {
      showToast('হাজিরা বাকি: ' + notMarked.slice(0, 2).map(s => s.name).join('، ') + (notMarked.length > 2 ? '…' : ''));
      return;
    }
    const needReason = students.filter(s => {
      const st = currentAttStatus(s.id, existing);
      return st === 'absent' && !getAbsentReason(s.id, existing);
    });
    if (needReason.length) {
      showToast('অনুপস্থিত কিন্তু কারণ বাকি: ' + needReason.slice(0, 2).map(s => s.name).join('، ') + (needReason.length > 2 ? '…' : ''));
      return;
    }
    const rows = students.map(s => {
      const st = currentAttStatus(s.id, existing);
      return {
        student_id: s.supabase_id || s.id,
        status: st === 'absent' || st === 'holiday' ? st : 'present',
        absent_reason: st === 'absent' ? getAbsentReason(s.id, existing) : null,
      };
    });
    if (window.MDRDaftarSupabase && window.MMSharedAPI) {
      try {
        const settings = API.Settings.get ? API.Settings.get() : {};
        const saved = await MDRDaftarSupabase.saveDay(daftarAttDate, rows, settings.hijri_year || null);
        if (saved !== true) throw new Error('attendance_save_not_confirmed');
      } catch (e) {
        console.warn('[Daftar] attendance save failed:', e);
        if (e && e.message === 'missing_remote_session') {
          showToast('সেশন পুরনো হয়েছে — লগআউট করে আবার দফতর পিন দিয়ে লগইন করুন');
        } else if (e && e.message === 'empty_attendance_payload') {
          showToast('সেভ করার মতো কোনো ছাত্র পাওয়া যায়নি');
        } else if (e && e.message === 'attendance_readback_mismatch') {
          showToast('ডাটাবেসে সব হাজিরা পাওয়া যায়নি — আবার সেভ করুন');
        } else {
          showToast('হাজিরা সেভ হয়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন');
        }
        return;
      }
    } else {
      students.forEach(s => {
        const st = currentAttStatus(s.id, existing);
        if (st === 'absent') API.Attendance.save(s.id, daftarAttDate, 'absent', getAbsentReason(s.id, existing));
        else if (st === 'holiday') API.Attendance.save(s.id, daftarAttDate, 'holiday');
        else API.Attendance.save(s.id, daftarAttDate, 'present');
      });
    }
    showToast('সকল বর্ষের উপস্থিতি সংরক্ষিত হয়েছে ✓');
    attState = {};
    attReasonState = {};
    if (API.Attendance && API.Attendance.noteDateSaved) API.Attendance.noteDateSaved(daftarAttDate);
    renderAttendance();
    if (window.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.isGateActive()) {
      var nextDay = MDRDaftarAttendanceGate.firstMissingDay && MDRDaftarAttendanceGate.firstMissingDay();
      if (nextDay && !hasPendingEdits()) {
        daftarAttDate = nextDay;
        updateHero();
        renderAttendance();
      }
    }
    if (window.MDRDaftarAttendanceGate) MDRDaftarAttendanceGate.refresh();
  }

  /* ── FEES ── */
  function renderFees() {
    const classes = API.Classes.getAll();
    const sel     = document.getElementById('fee-history-class');
    const prev    = feeHistoryClassId || sel.value;
    sel.innerHTML = classes.map(c => `<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
    if (prev && classes.some(c => c.id === prev)) sel.value = prev;
    else { const p = classes.find(c => API.Students.getByClass(c.id).length) || classes[0]; if (p) sel.value = p.id; }
    feeHistoryClassId = sel.value;
    renderFeeHistory();
    document.getElementById('fee-class').innerHTML = classes.map(c => `<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
  }

  function renderFeeHistory() {
    const cid  = document.getElementById('fee-history-class').value;
    feeHistoryClassId = cid;
    const rows = API.Fees.getByClass(cid);
    const el   = document.getElementById('fee-history-list');
    if (!rows.length) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">💰</span><div class="empty-text">এই বর্ষে কোনো ওয়াযিফা সারসংক্ষেপ নেই</div></div>';
      return;
    }
    el.innerHTML = rows.map(f => {
      const unpaid = f.unpaid != null ? f.unpaid : (f.total - f.paid);
      return `<div class="card-static" style="margin-bottom:6px;">
        <div style="font-family:'Tiro Bangla',serif;font-size:14px;font-weight:700;margin-bottom:6px;">${API.esc(f.month)}</div>
        <div style="display:flex;gap:12px;font-size:13px;flex-wrap:wrap;">
          <span>মোট: <strong>${toBn(f.total)}</strong></span>
          <span style="color:var(--green)">আদায়: <strong>${toBn(f.paid)}</strong></span>
          <span style="color:var(--red)">বাকি: <strong>${toBn(unpaid)}</strong></span>
          ${f.arrear ? `<span style="color:var(--red)">বকেয়া: ৳ ${toBn(f.arrear)}</span>` : ''}
        </div>
        ${f.note ? `<div style="font-size:12px;color:var(--ink3);margin-top:5px;">${API.esc(f.note)}</div>` : ''}
      </div>`;
    }).join('');
  }

  function saveFees() {
    if (mmMutationBlocked(showToast)) return;
    const class_id = document.getElementById('fee-class').value;
    const month    = document.getElementById('fee-month').value;
    const total    = parseInt(document.getElementById('fee-total').value) || 0;
    const paid     = parseInt(document.getElementById('fee-paid').value) || 0;
    const arrear   = parseInt(document.getElementById('fee-arrear').value) || 0;
    const note     = document.getElementById('fee-note').value;
    if (!month) { showToast('মাস আবশ্যক'); return; }
    API.Fees.add({ month, class_id, total, paid, unpaid: total - paid, arrear, note });
    closeModal('add-fees');
    showToast('সংরক্ষিত হয়েছে ✓');
    feeHistoryClassId = class_id;
    renderAccounts();
  }

  /* ── PANEL ── */
  function switchPanel(name) {
    document.documentElement.classList.remove('route-accounts');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const madrasaNames = ['home'];
    const isMadrasaPanel = madrasaNames.includes(name);
    document.getElementById(isMadrasaPanel ? 'nav-madrasa' : 'nav-' + name)?.classList.add('active');
    document.getElementById('madrasa-tabs')?.classList.toggle('hidden', !isMadrasaPanel);
    madrasaNames.forEach(t => document.getElementById('mtab-' + t)?.classList.toggle('active', t === name));
    if (name === 'summary') renderClassSummary();
    if (name === 'students') renderStudentList();
    window.scrollTo(0, 0);
  }
  function switchMadrasaTab(name) {
    if (window.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.blockTab(name)) return;
    switchPanel(name || 'home');
    if (!name || name === 'home') {
      updateHero();
      renderAttendance();
    }
  }

  function setDaftarHash(hash) {
    if (!window.history || !history.replaceState) return;
    history.replaceState(null, '', location.pathname + location.search + (hash || ''));
  }

  async function goDaftarAccounts() {
    if (window.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.blockAccounts()) return;
    setDaftarHash('#accounts');
    switchPanel('fees');
    if (MMSession.ensureDaftarDataReady) {
      try {
        await MMSession.ensureDaftarDataReady({ silent: MMSession.isAppDataWarm() });
      } catch (e) {
        showToast('হিসাব ডেটা লোড হয়নি');
      }
    }
    try {
      if (window.MdrAccAPI && MdrAccAPI.bootstrapRemote) {
        await MdrAccAPI.bootstrapRemote({ force: true });
      }
    } catch (e) {
      showToast('সর্বশেষ হিসাব ডেটা লোড হয়নি');
    }
    renderAccounts();
  }

  function goAccProgram() {
    setDaftarHash('#accounts');
    if (window.MMDaftarBottomNav && MMDaftarBottomNav.go) MMDaftarBottomNav.go('madrasa-kormosuchi.html');
    else location.href = 'madrasa-kormosuchi.html';
  }

  /* হিসাব সাব-ট্যাব: নিয়মিত হিসাব বাটন */
  function showAccRegular() {
    document.getElementById('subtab-regular').classList.add('active');
    document.getElementById('subtab-program').classList.remove('active');
    /* ইতিমধ্যে এখানে আছি, কিছু করতে হবে না */
  }

  /* ── UTILS ── */
  function openModal(id)  { if (mmMutationBlocked(showToast)) return; document.getElementById('modal-' + id).classList.add('open'); }
  function closeModal(id) { document.getElementById('modal-' + id).classList.remove('open'); }
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }
  function toBn(n) { return String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]); }

  /* ── CLASS SUMMARY + STUDENT TOOLS ── */
  function dateLabel(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('bn-BD', { day:'numeric', month:'long' });
  }
  function teachersByClassId() {
    if (window.MDRDaftarSupabase && typeof MDRDaftarSupabase.classTeachersMergedMap === 'function') {
      return MDRDaftarSupabase.classTeachersMergedMap();
    }
    const m = {};
    API.Teachers.getAll().forEach(t => {
      if (t.class_id && t.is_active !== false) m[t.class_id] = t.name;
    });
    return m;
  }
  function renderClassSummary() {
    const iso = daftarAttDate || API.today();
    const dateEl = document.getElementById('class-summary-date');
    if (dateEl) dateEl.textContent = dateLabel(iso);
    const allStudents = API.Students.getAll().filter(s => s.active);
    const allClasses = API.Classes.getAll();
    const teachers = teachersByClassId();
    let totalPresent = 0;
    let totalAbsent = 0;
    const rows = allClasses.map(cls => {
      const students = API.Students.getByClass(cls.id);
      const attRecs = API.Attendance.getByClassDate(cls.id, iso);
      const present = attRecs.filter(a => API.Attendance.statusOf(a) === 'present').length;
      const absent = attRecs.filter(a => API.Attendance.statusOf(a) === 'absent').length;
      totalPresent += present;
      totalAbsent += absent;
      return `<tr onclick="filterClassFromSummary('${cls.id}')" title="এই বর্ষের ছাত্র দেখুন">
        <td class="td-class">${API.esc(cls.name)}</td>
        <td class="td-teacher">${API.esc(teachers[cls.id] || '—')}</td>
        <td class="td-num">${toBn(students.length)}</td>
        <td class="td-num n-present">${toBn(present)}</td>
        <td class="td-num n-absent">${toBn(absent)}</td>
      </tr>`;
    }).join('');
    document.getElementById('class-summary-body').innerHTML = rows ||
      '<tr><td colspan="5" class="class-summary-empty">কোনো বর্ষ নেই</td></tr>';
    document.getElementById('hm-total').textContent = toBn(allStudents.length);
    document.getElementById('hm-present').textContent = toBn(totalPresent);
    document.getElementById('hm-absent').textContent = toBn(totalAbsent);
    document.getElementById('hm-classes').textContent = toBn(allClasses.length);
  }
  function filterClassFromSummary(classId) {
    switchPanel('students');
    switchStudentToolTab('list', true);
    const sel = document.getElementById('list-class-sel');
    if (sel) {
      sel.value = classId;
      renderStudentList();
    }
  }
  function populateStudentListFilter() {
    const sel = document.getElementById('list-class-sel');
    if (!sel || sel.dataset.ready === '1') return;
    API.Classes.getAll().forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    sel.dataset.ready = '1';
  }
  function switchStudentToolTab(name, skipScroll) {
    ['list','add','csv'].forEach(t => {
      document.getElementById('ttab-' + t)?.classList.toggle('active', t === name);
      document.getElementById('panel-' + t)?.classList.toggle('active', t === name);
    });
    if (name === 'list') renderStudentList();
    if (name === 'add') populateAddForm();
    if (!skipScroll) window.scrollTo(0,0);
  }
  function renderStudentList() {
    populateStudentListFilter();
    const sel = document.getElementById('list-class-sel');
    if (!sel) return;
    const cid = sel.value;
    const all = API.Students.getAll().filter(s => s.active);
    const filtered = cid === 'all' ? all : all.filter(s => s.class_id === cid);
    document.getElementById('stu-count').textContent = 'মোট ' + toBn(filtered.length) + ' জন সক্রিয় ছাত্র';
    if (!filtered.length) {
      document.getElementById('stu-list').innerHTML = '<div class="empty-state"><span class="empty-icon">👥</span><div class="empty-text">কোনো ছাত্র নেই</div></div>';
      return;
    }
    const clsMap = Object.fromEntries(API.Classes.getAll().map(c => [c.id, c.name]));
    let html = '', lastCls = '';
    filtered.sort((a,b)=>(a.class_id===b.class_id?(a.roll||'').localeCompare(b.roll||'','bn'):0));
    filtered.forEach(s => {
      if (cid === 'all' && clsMap[s.class_id] !== lastCls) {
        lastCls = clsMap[s.class_id] || '—';
        html += `<div class="cls-label">${API.esc(lastCls)}</div>`;
      }
      html += `<div class="stu-row">
        <div class="stu-roll">${API.escBn(s.roll||'—')}</div>
        <div class="stu-info">
          <div class="stu-name"><button type="button" class="s-name-btn" onclick="MMStudentModal.open('${s.id}')">${API.esc(s.name)}</button></div>
          <div class="stu-meta">${API.escBn(s.permanent_id||'—')} · ${API.esc(s.guardian||'—')} · ${API.esc(s.phone||'—')}</div>
        </div>
      </div>`;
    });
    document.getElementById('stu-list').innerHTML = html;
  }
  function populateAddForm() { onDeptChange(); }
  function onDeptChange() {
    const dept = document.getElementById('add-dept').value;
    const sel = document.getElementById('add-class');
    sel.innerHTML = API.Classes.getAll().filter(c=>c.dept===dept).map(c=>`<option value="${c.id}">${API.esc(c.name)}</option>`).join('');
    const pidInp = document.getElementById('add-pid');
    const hy = (API.Settings.get().hijri_year || '১৪৪৭').trim();
    if (dept === 'maktab') {
      pidInp.placeholder = 'যেমন: 047101 (শুরুতে 0 থাকবে)';
      if (!String(pidInp.value || '').trim()) pidInp.value = API.Students.getNextPermanentId('maktab', hy);
    } else {
      pidInp.placeholder = 'যেমন: ৪৭০১২';
    }
  }
  function addStudent() {
    const name = document.getElementById('add-name').value.trim();
    const roll = document.getElementById('add-roll').value.trim();
    const classId = document.getElementById('add-class').value;
    if (!name) { showToast('নাম আবশ্যক'); return; }
    if (!roll) { showToast('পরিচিতি নম্বর আবশ্যক'); return; }
    if (!classId) { showToast('বর্ষ নির্বাচন করুন'); return; }
    const pid = document.getElementById('add-pid').value.trim();
    if (!pid) { showToast('স্থায়ী দাখেলা আবশ্যক'); return; }
    if (API.Students.isPermanentIdTaken(pid)) { showToast('এই স্থায়ী দাখেলা ইতিমধ্যে কারো আছে'); return; }
    API.Students.add({
      name, roll, class_id: classId, permanent_id: pid,
      guardian: document.getElementById('add-guardian').value.trim(),
      guardian_job: document.getElementById('add-job').value.trim(),
      phone: document.getElementById('add-phone').value.trim(),
      district: document.getElementById('add-district').value.trim(),
      upazila: document.getElementById('add-upazila').value.trim(),
      dept: document.getElementById('add-dept').value,
      hifz: document.getElementById('add-hifz').checked,
    });
    showToast(name + ' — ভর্তি সম্পন্ন ✓');
    ['add-name','add-roll','add-pid','add-guardian','add-job','add-phone','add-district','add-upazila'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('add-hifz').checked = false;
    renderClassSummary();
    renderStudentList();
  }
  let csvRows = [];
  function downloadTemplate() {
    const clsNames = API.Classes.getAll().map(c=>c.name).join(', ');
    const header = 'নাম,বর্ষ,পরিচিতি,অভিভাবক,পেশা,ফোন,জেলা,উপজেলা,স্থায়ী_দাখেলা';
    const sample = 'মুহাম্মাদ আব্দুল্লাহ,১ম বর্ষ,১০১,আব্দুর রহীম,চাষাবাদ,০১৭০০-০০০০০০,ঢাকা,দোহার,৪৭০১২';
    const blob = new Blob(['\uFEFF# বর্ষের নাম: ' + clsNames + '\n' + header + '\n' + sample], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'ছাত্র_নমুনা.csv'; a.click();
  }
  function onDragOver(e) { e.preventDefault(); document.getElementById('csv-drop').classList.add('drag-over'); }
  function onDragLeave() { document.getElementById('csv-drop').classList.remove('drag-over'); }
  function onDrop(e) { e.preventDefault(); onDragLeave(); parseFile(e.dataTransfer.files[0]); }
  function onFileChange(e) { parseFile(e.target.files[0]); }
  function clearCsv() {
    csvRows = [];
    document.getElementById('csv-preview-wrap').style.display = 'none';
    document.getElementById('csv-file').value = '';
  }
  function applyCsvPermanentIds() {
    const inBatch = new Set();
    csvRows.forEach((r) => {
      r.resolved_pid = '';
      r.err = (r._baseErr || '').trim() ? r._baseErr : '';
      if (String(r._baseErr || '').trim() || !r.cls) return;
      const manual = (r.manual_pid || '').trim();
      if (!manual) { r.err = 'স্থায়ী দাখেলা বাধ্যতামূলক'; return; }
      if (inBatch.has(manual) || API.Students.isPermanentIdTaken(manual)) {
        r.err = 'স্থায়ী দাখেলা ডুপ্লিকেট/ব্যবহৃত';
      } else {
        inBatch.add(manual);
        r.resolved_pid = manual;
      }
    });
  }
  function renderCsvPreview() {
    if (!csvRows || !csvRows.length) return;
    applyCsvPermanentIds();
    const validN = csvRows.filter((r) => !r.err).length, errN = csvRows.length - validN;
    document.getElementById('csv-count-lbl').textContent = toBn(validN) + ' টি সঠিক, ' + toBn(errN) + ' টিতে সমস্যা';
    const thead = '<thead><tr><th>#</th><th>নাম</th><th>বর্ষ</th><th>পরিচিতি</th><th>জেলা</th><th>উপজেলা</th><th>স্থায়ী দাখেলা</th><th>অভিভাবক</th><th>ফোন</th><th>অবস্থা</th></tr></thead>';
    const tbody = '<tbody>' + csvRows.map((r) => {
      const st = r.err ? ('<span class="err-tag">' + API.esc(r.err) + '</span>') : '✓';
      const idCell = r.err ? '—' : API.esc(r.resolved_pid || '—');
      return `<tr class="${r.err ? 'row-err' : ''}"><td>${toBn(r.idx)}</td><td>${API.esc(r.name)}</td><td>${API.esc(r.clsName)}</td><td>${API.escBn(r.roll)}</td><td>${API.esc(r.district || '—')}</td><td>${API.esc(r.upazila || '—')}</td><td>${idCell}</td><td>${API.esc(r.guardian)}</td><td>${API.esc(r.phone)}</td><td>${st}</td></tr>`;
    }).join('') + '</tbody>';
    document.getElementById('csv-table').innerHTML = thead + tbody;
    document.getElementById('csv-confirm-btn').textContent = toBn(validN) + ' জন ছাত্র ভর্তি করুন';
    document.getElementById('csv-confirm-btn').disabled = validN === 0;
  }
  function parseFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#'));
      if (lines.length < 2) { showToast('CSV ফাইলে ডেটা নেই'); return; }
      const clsMap = Object.fromEntries(API.Classes.getAll().map(c=>[c.name.trim(),c]));
      csvRows = lines.slice(1).filter(l=>l.trim()).map((line,i) => {
        const cols = line.split(',').map(s=>s.trim());
        const [name, clsName, roll, guardian, job, phone, district, upazila, manualPid] = cols;
        const cls = clsMap[clsName];
        let baseErr = (!name ? 'নাম নেই ' : '') + ((!cls && clsName) ? 'বর্ষ খুঁজে পাওয়া যায়নি ' : '') + (!roll ? 'পরিচিতি নেই ' : '') + (!manualPid ? 'স্থায়ী দাখেলা আবশ্যক' : '');
        if (cols.length < 8) baseErr += (baseErr.trim() ? ' ' : '') + 'কমপক্ষে ৮ কলাম লাগবে।';
        return { idx:i+1, name:name||'', clsName:clsName||'', cls, roll:roll||'', guardian:guardian||'', job:job||'', phone:phone||'', district:district||'', upazila:upazila||'', manual_pid:(manualPid||'').trim(), _baseErr:baseErr, err:baseErr, resolved_pid:'' };
      });
      renderCsvPreview();
      document.getElementById('csv-preview-wrap').style.display = 'block';
    };
    reader.readAsText(file, 'utf-8');
  }
  function confirmCsvImport() {
    applyCsvPermanentIds();
    const ok = csvRows.filter((r) => !r.err && r.cls);
    if (!ok.length) { showToast('কোনো সঠিক সারি নেই'); return; }
    ok.forEach((r) => API.Students.add({ name:r.name, roll:r.roll, class_id:r.cls.id, permanent_id:r.resolved_pid, guardian:r.guardian, guardian_job:r.job, phone:r.phone, district:(r.district||'').trim(), upazila:(r.upazila||'').trim(), dept:r.cls.dept }));
    showToast(toBn(ok.length) + ' জন ছাত্র ভর্তি সম্পন্ন ✓');
    clearCsv();
    switchStudentToolTab('list');
    renderClassSummary();
  }

  window.addEventListener('mm:student-status-changed', function () {
    renderClassSummary();
    renderStudentList();
  });

  function ensureDaftarSampleData() {
    return false;
  }

  /* POPULATE CLASS FILTER ── */
  function populateClassFilter() {
    const sel = document.getElementById('class-filter-sel');
    API.Classes.getAll().forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
  }

  /* ── INIT ── */
  async function initDaftarPage() {
    var initialHash = location.hash || '';
    var wantsReports = initialHash === '#reports';
    var wantsAccounts = initialHash === '#fees' || initialHash === '#accounts' || wantsReports;
    var wasWarm = MMSession.isAppDataWarm && MMSession.isAppDataWarm();
    if (MMSession.ensureDaftarDataReady) {
      try {
        await MMSession.ensureDaftarDataReady({ silent: wasWarm });
        if (!MMSession.isAppDataWarm()) showToast('দফতর সেশন পুরনো — লগআউট করে আবার লগইন করুন');
      } catch (e) {
        showToast('দফতরের তথ্য লোড হয়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন');
      }
    }
    if (window.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.isGateActive && MDRDaftarAttendanceGate.isGateActive()) {
      wantsAccounts = false;
    }
    var navRoot = document.getElementById('daftar-nav-root');
    if (window.MMDaftarBottomNav && navRoot) {
      var acc0 = wantsAccounts ? 'accounts' : 'daftar';
      MMDaftarBottomNav.mount(navRoot, { active: acc0, spaDaftar: true, pathPrefix: '' });
    }
    if (window.MDRDaftarAttendanceGate) MDRDaftarAttendanceGate.refresh();
    if (wantsAccounts) switchPanel('fees');
    if (wantsAccounts) {
      try {
        if (window.MdrAccAPI && MdrAccAPI.bootstrapRemote) {
          await MdrAccAPI.bootstrapRemote({ force: true });
        }
      } catch (e) {
        showToast('সর্বশেষ হিসাব ডেটা লোড হয়নি');
      }
    }
    ensureDaftarSampleData();
    populateClassFilter();
    populateStudentListFilter();
    populateAddForm();
    const navType = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] && performance.getEntriesByType('navigation')[0].type) || '';
    if (wantsAccounts) {
      renderAccounts();
      if (wantsReports && window.openAccReportsPanel) openAccReportsPanel();
    } else if (navType === 'reload') {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      switchPanel('home');
    } else if (location.hash === '#students') {
      location.replace('madrasa-home.html#students');
    }
    if (window.MDRDaftarAttendanceGate && MDRDaftarAttendanceGate.isGateActive()) {
      var firstDay = MDRDaftarAttendanceGate.firstMissingDay && MDRDaftarAttendanceGate.firstMissingDay();
      if (firstDay && !hasPendingEdits()) daftarAttDate = firstDay;
    }
    updateHero();
    renderAttendance();
    if (window.MDRDaftarAttendanceGate) MDRDaftarAttendanceGate.refresh();
  }
  async function saveOwnPin(){
    var c=document.getElementById('pc-cur').value,n=document.getElementById('pc-new').value,f=document.getElementById('pc-conf').value,e=document.getElementById('pc-err');
    if(!c||!n||!f){e.textContent='সব ঘর পূরণ করুন';return;}
    if(n!==f){e.textContent='PIN মিলছে না';return;}
    if(n.length!==4||!/^\d+$/.test(n)){e.textContent='PIN ৪ সংখ্যার হতে হবে';return;}
    e.textContent='Saving...';
    var result=await MMSession.changeStaffPin(c,n,function(uid,cur,next){return API.Teachers.changeOwnPin(uid,cur,next);});
    if(!result.ok){e.textContent=(MMSession.pinChangeErrorMessage&&MMSession.pinChangeErrorMessage(result.error))||'PIN change failed';return;}
    closeAccountDetailsModal();
    if(typeof showToast==='function')showToast('PIN সফলভাবে পরিবর্তন হয়েছে');
  }

  MMLoading.runDaftarPage(initDaftarPage);
