  var adminAuthFallback = (function () {
    try { return /^admin\./i.test(location.hostname) ? '../admin/index.html' : '../index.html'; }
    catch (e) { return '../index.html'; }
  })();
  if (!MMSession.requireAdminPerm('dashboard', adminAuthFallback)) { throw new Error('admin permission denied'); }
  if (MMSession.isRestrictedAdmin()) {
    var aiLaunch = document.getElementById('admin-ai-launch');
    if (aiLaunch) aiLaunch.remove();
  }

  const toBn = n => String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const MADRASA_DEPT_KEY = 'mm_madrasa_jimmadar_dept';
  let pendingDeptRoute = '';

  function mdrHref(path) {
    const routeDept = currentDept === 'all' ? 'all' : currentDept;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'dept=' + encodeURIComponent(routeDept);
  }

  function deptHref(path, dept) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'dept=' + encodeURIComponent(dept);
  }

  async function syncMadrasaSettings() {
    if (!window.MMMadrasaAPI || !MMSession.getAdminPin()) return;
    try {
      const res = await MMMadrasaAPI.getSettings(MMSession.getAdminPin());
      const db = res.settings || {};
      if (!db || (!db.institution && !db.hijri_year && !db.session_start_date && db.hijri_offset_days == null)) return;
      const local = API.Settings.get();
      const next = {
        ...local,
        institution: db.institution || local.institution,
        hijri_year: db.hijri_year || local.hijri_year,
        session_start_date: db.session_start_date || local.session_start_date,
        hijri_offset_days: db.hijri_offset_days != null ? Number(db.hijri_offset_days) || 0 : Number(local.hijri_offset_days) || 0,
      };
      API.Settings.save(next);
      if (window.MMHijri) MMHijri.setOffsetDays(next.hijri_offset_days);
      if (next.session_start_date) {
        if (API.Sessions.getCurrent()) API.Sessions.setCurrentStartDate(next.session_start_date);
        else API.Sessions.ensureInitialized();
      }
    } catch (err) {
      console.warn('madrasa settings sync skipped', err);
    }
  }

  function getScopeDepts() {
    const allowed = MMSession.getAllowedMadrasaDepts();
    if (currentDept === 'kitab' || currentDept === 'maktab') return allowed.includes(currentDept) ? [currentDept] : [];
    return allowed.filter(d => d === 'kitab' || d === 'maktab');
  }

  function openDeptRoute(path) {
    const allowed = MMSession.getAllowedMadrasaDepts();
    if (currentDept === 'kitab' || currentDept === 'maktab') {
      location.href = deptHref(path, currentDept);
      return;
    }
    location.href = deptHref(path, allowed.length > 1 ? 'all' : (allowed[0] || 'kitab'));
  }

  function chooseDeptRoute(dept) {
    if (!pendingDeptRoute || !MMSession.canUseMadrasaDept(dept)) return;
    location.href = deptHref(pendingDeptRoute, dept);
  }

  function closeDeptChoice() {
    pendingDeptRoute = '';
    document.getElementById('dept-choice-modal').classList.remove('is-open');
  }

  function readInitialDept() {
    const allowed = MMSession.getAllowedMadrasaDepts();
    try {
      const u = new URLSearchParams(location.search).get('dept');
      if (u === 'all' && allowed.length > 1) return 'all';
      if ((u === 'kitab' || u === 'maktab') && allowed.includes(u)) return u;
    } catch (e) {}
    if (allowed.length > 1) return 'all';
    try {
      const s = localStorage.getItem(MADRASA_DEPT_KEY);
      if ((s === 'kitab' || s === 'maktab') && allowed.includes(s)) return s;
    } catch (e) {}
    return allowed[0] || 'kitab';
  }

  let currentDept = readInitialDept();

  function syncDeptTabUI() {
    const a = document.getElementById('dtab-all');
    const k = document.getElementById('dtab-kitab');
    const m = document.getElementById('dtab-maktab');
    const allowed = MMSession.getAllowedMadrasaDepts();
    if (a) {
      a.setAttribute('aria-selected', currentDept === 'all' ? 'true' : 'false');
      a.style.display = allowed.length > 1 ? '' : 'none';
    }
    if (k) {
      k.setAttribute('aria-selected', currentDept === 'kitab' ? 'true' : 'false');
      k.style.display = allowed.includes('kitab') ? '' : 'none';
    }
    if (m) {
      m.setAttribute('aria-selected', currentDept === 'maktab' ? 'true' : 'false');
      m.style.display = allowed.includes('maktab') ? '' : 'none';
    }
  }

  function applyAdminPermissions() {
    document.querySelectorAll('[data-admin-perm]').forEach(el => {
      el.style.display = MMSession.canAdmin(el.dataset.adminPerm) ? '' : 'none';
    });
    const settingsBtn = document.getElementById('btn-madrasa-settings');
    if (settingsBtn && MMSession.isRestrictedAdmin()) {
      settingsBtn.style.display = (MMSession.canAdmin('settings_teachers') || MMSession.canAdmin('settings_kitab')) ? '' : 'none';
    }
  }

  function withdrawalDeptOf(w) {
    if (!w) return '';
    var div = String(w.division_code || '').trim();
    if (div === 'kitab' || div === 'maktab') return div;
    var last = String(w.last_class_id || '');
    if (last.indexOf('cls_k') === 0 || last.indexOf('kitab') === 0) return 'kitab';
    if (last.indexOf('cls_m') === 0 || last.indexOf('maktab') === 0) return 'maktab';
    if (last) {
      var cls = API.Classes.getById(last);
      if (cls && (cls.dept === 'kitab' || cls.dept === 'maktab')) return cls.dept;
    }
    var s = API.Students.getById(w.student_id);
    if (s && s.class_id) {
      var sc = API.Classes.getById(s.class_id);
      if (sc && (sc.dept === 'kitab' || sc.dept === 'maktab')) return sc.dept;
    }
    return '';
  }

  function countWithdrawalsByDept(dept) {
    const list = API.persistLoadArr('mm_withdrawals') || [];
    if (dept === 'all') return list.length;
    if (dept !== 'kitab' && dept !== 'maktab') return 0;
    const cids = new Set(API.Classes.getByDept(dept).map(c => c.id));
    return list.filter(w => {
      const d = withdrawalDeptOf(w);
      if (d === dept) return true;
      if (w.last_class_id && cids.has(w.last_class_id)) return true;
      const s = API.Students.getById(w.student_id);
      return !!(s && cids.has(s.class_id));
    }).length;
  }

  function ccIcon(name) {
    const icons = {
      attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3M16 3v3M4 9h16"/><rect x="4" y="5" width="16" height="16" rx="2"/><path d="m8 14 2.2 2.2L16 11"/></svg>',
      absent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
      watch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>',
      khuluk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11Z"/></svg>',
      class: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M8 7h8M8 11h6"/></svg>',
      ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    };
    return icons[name] || icons.watch;
  }

  function currentScopeLabel() {
    if (currentDept === 'kitab') return 'কিতাব বিভাগ';
    if (currentDept === 'maktab') return 'মক্তব বিভাগ';
    return 'সামগ্রিক';
  }

  function getTodayCommandStats() {
    const iso = API.today();
    const depts = getScopeDepts();
    const classes = getClassesForScope(currentDept);
    const att = depts.reduce((sum, dept) => {
      const part = API.Attendance.getDateSummaryForDept(iso, dept);
      return { present: sum.present + part.present, absent: sum.absent + part.absent };
    }, { present: 0, absent: 0 });
    const total = depts.reduce((sum, dept) => sum + API.Students.countActiveByDept(dept), 0);
    const missingClasses = classes.filter(cls => {
      const activeStudents = API.Students.getByClass(cls.id).filter(s => s.active !== false);
      const recs = API.Attendance.getByClassDate(cls.id, iso);
      return activeStudents.length > 0 && recs.length === 0;
    });
    const bands = getKhulukBandsByDept(currentDept);
    const khAvg = getKhulukAvgByDept(currentDept);
    const special = depts.reduce((sum, dept) => sum + API.Students.countSpecialWatchByDept(dept), 0);
    const anyAbsent = depts.reduce((sum, dept) => sum + API.Attendance.countStudentsWithAnyAbsentByDept(dept), 0);
    const alham = depts.reduce((sum, dept) => sum + API.Students.countAlhamdulillahByDept(dept), 0);
    const attendancePct = total > 0 ? Math.round(att.present / total * 100) : 0;
    const watchLoad = att.absent + special + bands.low.length;
    return { iso, depts, classes, total, att, missingClasses, bands, khAvg, special, anyAbsent, alham, attendancePct, watchLoad };
  }

  function ccCard(label, value, meta, state, action) {
    return `<button type="button" class="cc-health-card ${state || ''}" onclick="${action || ''}">
      <span class="cc-health-val">${value}</span>
      <span class="cc-health-label">${API.esc(label)}</span>
      <span class="cc-health-meta">${API.esc(meta || '')}</span>
    </button>`;
  }

  function ccAlert(icon, title, meta, count, state, action) {
    return `<button type="button" class="cc-alert-row ${state || ''}" onclick="${action || ''}">
      <span class="cc-alert-ico" aria-hidden="true">${ccIcon(icon)}</span>
      <span class="cc-alert-main">
        <span class="cc-alert-title">${API.esc(title)}</span>
        <span class="cc-alert-meta">${API.esc(meta || '')}</span>
      </span>
      <span class="cc-alert-count">${count}</span>
    </button>`;
  }

  let commandSlideIndex = 0;

  function ccSetGrid(id, cards) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = cards.join('');
  }

  function ccSetAlerts(listId, metaId, alerts, emptyText) {
    const listEl = document.getElementById(listId);
    if (listEl) {
      listEl.innerHTML = alerts.length ? alerts.join('') : `<div class="cc-empty">${API.esc(emptyText)}</div>`;
    }
    const metaEl = document.getElementById(metaId);
    if (metaEl) metaEl.textContent = alerts.length ? toBn(alerts.length) + 'টি বিষয়' : 'সব ঠিক আছে';
  }

  function ccMoney(value) {
    const n = Number(value || 0);
    if (window.MdrAccAPI && MdrAccAPI.fa) return '৳' + MdrAccAPI.fa(n);
    return '৳' + toBn(Math.round(n).toLocaleString('en-US'));
  }

  function renderAccountsSlide() {
    const ready = !!(window.MdrAccAPI && MdrAccAPI.Summary);
    const summary = ready ? MdrAccAPI.Summary.get(null) : null;
    const dueRows = ready && MdrAccAPI.Dues ? MdrAccAPI.Dues.withDue() : [];
    const cashFlow = Number(summary && summary.cashFlow || 0);
    const operatingBalance = Number(summary && summary.operatingBalance || 0);
    const dueTotal = Number(summary && summary.supplierDue || 0);
    const qardGiven = Number(summary && summary.qardGiven || 0);
    const qardReturned = Number(summary && summary.qardReturned || 0);
    const qardRemaining = Number(summary && summary.qardRemaining || 0);
    const cards = [
      ccCard('নিয়মিত আয়', summary ? ccMoney(summary.regularIncome) : '—', 'করজ বাদে', summary && summary.regularIncome ? 'is-good' : '', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('নিয়মিত ব্যয়', summary ? ccMoney(summary.regularExpense) : '—', 'করজ বাদে', summary && summary.regularExpense ? 'is-danger' : '', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('আয়-ব্যয় ব্যালেন্স', summary ? (operatingBalance < 0 ? '−' : '+') + ccMoney(Math.abs(operatingBalance)) : '—', 'নিয়মিত হিসাব', operatingBalance < 0 ? 'is-danger' : 'is-good', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('বর্তমান বকেয়া', summary ? ccMoney(dueTotal) : '—', 'সরবরাহকারী', dueTotal ? 'is-warn' : 'is-good', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('করজ দেওয়া', summary ? ccMoney(qardGiven) : '—', 'আলাদা হিসাব', qardGiven ? 'is-warn' : '', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('করজ আদায়', summary ? ccMoney(qardReturned) : '—', 'আলাদা হিসাব', qardReturned ? 'is-good' : '', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('করজ বাকি', summary ? ccMoney(qardRemaining) : '—', 'ফেরত বাকি', qardRemaining ? 'is-warn' : 'is-good', "location.href='/madrasa/admin/accounts.html'"),
      ccCard('নেট নগদ প্রবাহ', summary ? (cashFlow < 0 ? '−' : '+') + ccMoney(Math.abs(cashFlow)) : '—', 'আসা-যাওয়া', cashFlow < 0 ? 'is-danger' : 'is-good', "location.href='/madrasa/admin/accounts.html'"),
    ];
    ccSetGrid('cc-accounts-grid', cards);

    const alerts = [];
    if (!ready) {
      alerts.push(ccAlert('watch', 'হিসাব cache পাওয়া যায়নি', 'হিসাব পেজ খুললে data refresh হবে', '—', 'is-warn', "location.href='/madrasa/admin/accounts.html'"));
    } else {
      if (operatingBalance < 0) alerts.push(ccAlert('absent', 'মাসিক ঘাটতি', 'চলতি মাসে ব্যয় বেশি', ccMoney(Math.abs(operatingBalance)), 'is-danger', "location.href='/madrasa/admin/accounts.html'"));
      if (dueTotal > 0) alerts.push(ccAlert('watch', 'বকেয়া নজর দরকার', toBn(dueRows.length) + 'টি বকেয়া হিসাব', ccMoney(dueTotal), 'is-warn', "location.href='/madrasa/admin/accounts.html'"));
      if (qardRemaining > 0) alerts.push(ccAlert('class', 'করজ বাকি', 'ফেরত/সমন্বয় বাকি', ccMoney(qardRemaining), 'is-warn', "location.href='/madrasa/admin/accounts.html'"));
    }
    ccSetAlerts('cc-accounts-list', 'cc-accounts-meta', alerts, 'হিসাবের বড় কোনো সতর্কতা নেই।');
  }

  function deptDisplayName(name) {
    return DeptAPI.displayName ? DeptAPI.displayName(name) : String(name || '');
  }

  function renderDepartmentSlide() {
    const ready = !!(window.DeptAPI && DeptAPI.Departments && DeptAPI.Transactions);
    const depts = ready ? DeptAPI.Departments.getAll() : [];
    const rows = ready ? depts.map(d => {
      const s = DeptAPI.Transactions.getSummary(d.id);
      return { dept: d, income: Number(s.income || 0), expense: Number(s.expense || 0), net: Number(s.net || 0) };
    }) : [];
    const totalIncome = rows.reduce((sum, r) => sum + r.income, 0);
    const totalExpense = rows.reduce((sum, r) => sum + r.expense, 0);
    const totalNet = totalIncome - totalExpense;
    const pending = ready && DeptAPI.EditRequests ? DeptAPI.EditRequests.getPending() : [];
    const txns = ready ? DeptAPI.Transactions.getAll() : [];
    const products = ready && DeptAPI.Products ? DeptAPI.Products.getAll().filter(p => p.is_active !== false) : [];
    const inventory = ready && DeptAPI.Inventory ? depts.reduce((sum, d) => sum + DeptAPI.Inventory.getByDept(d.id).length, 0) : 0;
    const best = rows.slice().sort((a, b) => b.net - a.net)[0];
    const lossCount = rows.filter(r => r.net < 0).length;
    const cards = [
      ccCard('সক্রিয় বিভাগ', toBn(depts.length), 'বিভাগ মেনু', '', "location.href='/admin/dept.html'"),
      ccCard('বিভাগ আয়', ccMoney(totalIncome), 'সব সময়ের মোট', totalIncome ? 'is-good' : '', "location.href='/admin/dept.html'"),
      ccCard('বিভাগ ব্যয়', ccMoney(totalExpense), 'সব সময়ের মোট', totalExpense ? 'is-danger' : '', "location.href='/admin/dept.html'"),
      ccCard('নেট লাভ', ccMoney(totalNet), 'আয় - ব্যয়', totalNet < 0 ? 'is-danger' : 'is-good', "location.href='/admin/dept.html'"),
      ccCard('লেনদেন', toBn(txns.length), 'মোট লেনদেন', txns.length ? '' : 'is-warn', "location.href='/admin/dept.html?tab=all-txn'"),
      ccCard('পণ্য', toBn(products.length), 'সক্রিয় পণ্য', products.length ? 'is-good' : '', "location.href='/admin/dept.html'"),
      ccCard('স্টক সারি', toBn(inventory), 'ইনভেন্টরি', inventory ? '' : 'is-warn', "location.href='/admin/dept.html'"),
      ccCard('সংশোধন অনুরোধ', toBn(pending.length), 'অনুমোদন বাকি', pending.length ? 'is-warn' : 'is-good', "location.href='/admin/dept.html?tab=requests'"),
    ];
    ccSetGrid('cc-dept-grid', cards);

    const alerts = [];
    if (!ready) {
      alerts.push(ccAlert('watch', 'বিভাগ cache পাওয়া যায়নি', 'বিভাগ পেজ খুললে data refresh হবে', '—', 'is-warn', "location.href='/admin/dept.html'"));
    } else {
      if (pending.length) alerts.push(ccAlert('watch', 'সংশোধন অনুরোধ', 'অনুমোদনের অপেক্ষায়', toBn(pending.length), 'is-warn', "location.href='/admin/dept.html?tab=requests'"));
      if (lossCount) alerts.push(ccAlert('absent', 'লোকসানে থাকা বিভাগ', 'সব সময়ের হিসাব', toBn(lossCount), 'is-danger', "location.href='/admin/dept.html'"));
      if (best && best.net > 0) alerts.push(ccAlert('ok', 'সেরা বিভাগ', deptDisplayName(best.dept.name), ccMoney(best.net), 'is-good', "location.href='/admin/dept.html'"));
    }
    ccSetAlerts('cc-dept-list', 'cc-dept-meta', alerts, 'বিভাগের বড় কোনো সতর্কতা নেই।');
  }

  function clearCommandDeckDragStyles() {
    document.querySelectorAll('.cc-slide').forEach((slide) => {
      slide.style.transform = '';
      slide.style.opacity = '';
      slide.style.zIndex = '';
      slide.style.transition = '';
    });
  }

  function syncCommandDeckHeight() {
    const deck = document.getElementById('cc-deck');
    const slides = Array.from(document.querySelectorAll('.cc-slide'));
    if (!deck || !slides.length) return;
    const height = Math.max(300, ...slides.map(slide => slide.scrollHeight));
    deck.style.setProperty('--cc-deck-height', Math.ceil(height) + 'px');
  }

  function updateCommandDeckState(index) {
    const deck = document.getElementById('cc-deck');
    const slides = Array.from(document.querySelectorAll('.cc-slide'));
    if (!slides.length) return;
    const len = slides.length;
    commandSlideIndex = ((Number(index) || 0) % len + len) % len;
    const prev = (commandSlideIndex - 1 + len) % len;
    const next = (commandSlideIndex + 1) % len;
    if (deck && !deck.classList.contains('is-dragging') && !deck.classList.contains('is-snapping')) clearCommandDeckDragStyles();
    slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === commandSlideIndex);
      slide.classList.toggle('is-prev', i === prev);
      slide.classList.toggle('is-next', i === next);
      slide.setAttribute('aria-hidden', i === commandSlideIndex ? 'false' : 'true');
    });
    document.querySelectorAll('.cc-deck-dot').forEach((dot, i) => {
      dot.classList.toggle('is-active', i === commandSlideIndex);
    });
    requestAnimationFrame(syncCommandDeckHeight);
  }

  function goCommandSlide(index) {
    updateCommandDeckState(index);
  }

  function initCommandDeck() {
    const wrap = document.getElementById('cc-deck-wrap');
    const deck = document.getElementById('cc-deck');
    const slides = Array.from(document.querySelectorAll('.cc-slide'));
    if (!wrap || !deck || !slides.length) return;

    slides.forEach((slide, i) => {
      if (slide.dataset.ccBound === '1') return;
      slide.dataset.ccBound = '1';
      slide.addEventListener('click', (event) => {
        if (wrap.dataset.ccSuppressClick === '1') {
          event.preventDefault();
          return;
        }
        if (i === commandSlideIndex) return;
        event.preventDefault();
        goCommandSlide(i);
      });
    });

    if (wrap.dataset.ccBound !== '1') {
      wrap.dataset.ccBound = '1';
      const SNAP_MS = 380;
      const SNAP_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let lastMoveX = 0;
      let lastMoveT = 0;
      let velX = 0;
      let dragX = 0;
      let dragLocked = false;
      let isDragging = false;

      const deckWidth = () => Math.max(wrap.offsetWidth || 0, 280);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

      const applyDragFrame = (dx) => {
        const width = deckWidth();
        const len = slides.length;
        const prev = (commandSlideIndex - 1 + len) % len;
        const next = (commandSlideIndex + 1) % len;
        const progress = clamp(dx / width, -1.12, 1.12);
        const absP = Math.min(Math.abs(progress), 1);
        const activeScale = 1 - absP * 0.035;

        slides.forEach((slide, i) => {
          if (i === commandSlideIndex) {
            slide.style.transform = `translate3d(${dx}px,0,0) scale(${activeScale})`;
            slide.style.opacity = String(1 - absP * 0.1);
            slide.style.zIndex = '3';
          } else if (i === next && dx < 0) {
            const x = dx + width;
            const p = clamp(-progress, 0, 1);
            slide.style.transform = `translate3d(${x}px,0,0) scale(${0.965 + p * 0.035})`;
            slide.style.opacity = String(0.46 + p * 0.54);
            slide.style.zIndex = '2';
          } else if (i === prev && dx > 0) {
            const x = dx - width;
            const p = clamp(progress, 0, 1);
            slide.style.transform = `translate3d(${x}px,0,0) scale(${0.965 + p * 0.035})`;
            slide.style.opacity = String(0.46 + p * 0.54);
            slide.style.zIndex = '2';
          } else {
            slide.style.opacity = '0';
            slide.style.transform = 'translate3d(0,10px,0) scale(0.93)';
            slide.style.zIndex = '0';
          }
        });
      };

      const resolveDragTarget = () => {
        const width = deckWidth();
        const threshold = width * 0.22;
        let target = commandSlideIndex;
        if (dragX < -threshold || (dragX < -48 && velX < -0.35)) target = commandSlideIndex + 1;
        else if (dragX > threshold || (dragX > 48 && velX > 0.35)) target = commandSlideIndex - 1;
        const len = slides.length;
        return ((target % len) + len) % len;
      };

      const finishDrag = () => {
        const width = deckWidth();
        const target = resolveDragTarget();
        const len = slides.length;
        const prevIdx = (commandSlideIndex - 1 + len) % len;
        const nextIdx = (commandSlideIndex + 1) % len;
        const goingNext = target === nextIdx;
        const goingPrev = target === prevIdx;
        const snapBack = !goingNext && !goingPrev;

        if (Math.abs(dragX) > 10) wrap.dataset.ccSuppressClick = '1';

        deck.classList.remove('is-dragging');
        wrap.classList.remove('is-drag-active');
        isDragging = false;
        dragLocked = false;
        pointerId = null;

        if (reduceMotion) {
          clearCommandDeckDragStyles();
          updateCommandDeckState(target);
          setTimeout(() => { delete wrap.dataset.ccSuppressClick; }, 0);
          dragX = 0;
          velX = 0;
          return;
        }

        slides.forEach((slide) => {
          slide.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}, opacity ${Math.round(SNAP_MS * 0.85)}ms ease`;
        });
        deck.classList.add('is-snapping');

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (snapBack) {
              slides.forEach((slide, i) => {
                if (i === commandSlideIndex) {
                  slide.style.transform = 'translate3d(0,0,0) scale(1)';
                  slide.style.opacity = '1';
                  slide.style.zIndex = '3';
                } else if (i === nextIdx && dragX < 0) {
                  slide.style.transform = `translate3d(${width}px,0,0) scale(0.965)`;
                  slide.style.opacity = '0';
                  slide.style.zIndex = '1';
                } else if (i === prevIdx && dragX > 0) {
                  slide.style.transform = `translate3d(-${width}px,0,0) scale(0.965)`;
                  slide.style.opacity = '0';
                  slide.style.zIndex = '1';
                } else {
                  slide.style.opacity = '0';
                  slide.style.transform = 'translate3d(0,10px,0) scale(0.93)';
                  slide.style.zIndex = '0';
                }
              });
            } else {
              applyDragFrame(goingNext ? -width : width);
            }
          });
        });

        let ended = false;
        const onEnd = () => {
          if (ended) return;
          ended = true;
          deck.classList.remove('is-snapping');
          clearCommandDeckDragStyles();
          updateCommandDeckState(target);
          dragX = 0;
          velX = 0;
          setTimeout(() => { delete wrap.dataset.ccSuppressClick; }, 0);
        };

        const watchSlides = snapBack
          ? [slides[commandSlideIndex], dragX < 0 ? slides[nextIdx] : dragX > 0 ? slides[prevIdx] : null].filter(Boolean)
          : [slides[commandSlideIndex], slides[target]];
        let pendingEnds = watchSlides.length;
        const onSlideEnd = (event) => {
          if (event.propertyName !== 'transform') return;
          pendingEnds -= 1;
          if (pendingEnds <= 0) onEnd();
        };
        watchSlides.forEach((slide) => slide.addEventListener('transitionend', onSlideEnd));
        setTimeout(onEnd, SNAP_MS + 90);
      };

      wrap.addEventListener('click', (event) => {
        if (wrap.dataset.ccSuppressClick === '1') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);

      wrap.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest('input, select, textarea')) return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        lastMoveX = event.clientX;
        lastMoveT = performance.now();
        dragX = 0;
        velX = 0;
        dragLocked = false;
        isDragging = false;
      }, { passive: true });

      wrap.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const now = performance.now();
        const dt = now - lastMoveT;
        if (dt > 0) velX = (event.clientX - lastMoveX) / dt;
        lastMoveX = event.clientX;
        lastMoveT = now;

        if (!dragLocked) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          if (Math.abs(dy) > Math.abs(dx) * 1.05) {
            pointerId = null;
            try { wrap.releasePointerCapture(event.pointerId); } catch (_) {}
            return;
          }
          dragLocked = true;
          isDragging = true;
          wrap.dataset.ccSuppressClick = '1';
          deck.classList.add('is-dragging');
          wrap.classList.add('is-drag-active');
          try { wrap.setPointerCapture(event.pointerId); } catch (_) {}
        }

        dragX = dx;
        applyDragFrame(dx);
      }, { passive: true });

      const endPointer = (event) => {
        if (event.pointerId !== pointerId) return;
        try { wrap.releasePointerCapture(event.pointerId); } catch (_) {}
        if (isDragging) finishDrag();
        else pointerId = null;
      };

      wrap.addEventListener('pointerup', endPointer, { passive: true });
      wrap.addEventListener('pointercancel', endPointer, { passive: true });
      window.addEventListener('resize', syncCommandDeckHeight, { passive: true });
    }

    updateCommandDeckState(commandSlideIndex);
  }

  function renderCommandCenter() {
    const data = getTodayCommandStats();
    const scope = currentScopeLabel();
    const healthEl = document.getElementById('cc-health-grid');
    if (healthEl) {
      const attendanceState = data.attendancePct >= 85 ? 'is-good' : data.attendancePct >= 70 ? 'is-warn' : 'is-danger';
      const khState = data.khAvg == null ? 'is-warn' : data.khAvg >= 80 ? 'is-good' : data.khAvg >= 60 ? 'is-warn' : 'is-danger';
      const cards = [
        ccCard('আজ উপস্থিতি', toBn(data.attendancePct) + '%', toBn(data.att.present) + '/' + toBn(data.total) + ' উপস্থিত', attendanceState, ''),
        ccCard('অনুপস্থিত তালিকা', toBn(data.anyAbsent), data.anyAbsent ? 'তালিকা দেখুন' : 'কোনো রেকর্ড নেই', data.anyAbsent ? 'is-danger' : 'is-good', 'goAbsentList()'),
        ccCard('নজর দরকার', toBn(data.watchLoad), 'অনুপস্থিত + পর্যবেক্ষণ + কম খুলুক', data.watchLoad ? 'is-warn' : 'is-good', "openWatchPanel('absent')"),
        ccCard('খুলুক গড়', data.khAvg !== null ? toBn(data.khAvg) : '—', toBn(data.bands.none.length) + ' জনের রেকর্ড নেই', khState, 'openKhulukPanel()'),
        ccCard('মোট ছাত্র', toBn(data.total), scope, '', "openDeptRoute('/madrasa/admin/students.html')"),
      ];
      if (MMSession.canAdmin('withdrawn')) {
        cards.push(ccCard('বিদায় ছাত্র', toBn(countWithdrawalsByDept(currentDept)), 'বিদায় তালিকা', 'is-warn', "openDeptRoute('/madrasa/admin/withdrawn.html')"));
      }
      cards.push(
        ccCard('বিশেষ পর্যবেক্ষণ', toBn(data.special), data.special ? 'ফলোআপ দরকার' : 'কেউ নেই', data.special ? 'is-warn' : 'is-good', "openWatchPanel('special')"),
        ccCard('আলহামদুলিল্লাহ', toBn(data.alham), data.alham ? 'চিহ্নিত ছাত্র' : 'কেউ নেই', data.alham ? 'is-good' : '', 'goAlhamdulillah()')
      );
      healthEl.innerHTML = cards.join('');
    }

    const alerts = [];
    if (data.missingClasses.length) {
      const names = data.missingClasses.slice(0, 3).map(c => c.name).join(', ');
      alerts.push(ccAlert('class', 'আজ উপস্থিতি নেয়া হয়নি', names, toBn(data.missingClasses.length), 'is-danger', `openClassOverlay('${String(data.missingClasses[0].id).replace(/'/g, "\\'")}')`));
    }
    if (data.att.absent) {
      alerts.push(ccAlert('absent', 'আজ অনুপস্থিত ছাত্র', 'উপস্থিতি তালিকা যাচাই করুন', toBn(data.att.absent), 'is-danger', 'goAbsentList()'));
    }
    if (data.special) {
      alerts.push(ccAlert('watch', 'বিশেষ পর্যবেক্ষণ', 'নিয়মিত ফলোআপ দরকার', toBn(data.special), 'is-warn', "openWatchPanel('special')"));
    }
    if (data.bands.low.length) {
      alerts.push(ccAlert('khuluk', 'কম খুলুক', '৬০-এর নিচে থাকা ছাত্র', toBn(data.bands.low.length), 'is-warn', "openWatchPanel('khuluk')"));
    }
    if (data.bands.none.length) {
      alerts.push(ccAlert('class', 'খুলুক রেকর্ড বাকি', 'এখনও মূল্যায়ন হয়নি', toBn(data.bands.none.length), 'is-warn', 'openKhulukPanel()'));
    }
    if (!alerts.length) {
      alerts.push(`<div class="cc-empty">${API.esc(scope)}-এ এখন বড় কোনো সতর্কতা নেই।</div>`);
    }
    const listEl = document.getElementById('cc-attention-list');
    if (listEl) listEl.innerHTML = alerts.join('');
    const metaEl = document.getElementById('cc-attention-meta');
    if (metaEl) metaEl.textContent = alerts.length && !alerts[0].includes('cc-empty') ? toBn(alerts.length) + 'টি বিষয়' : 'সব ঠিক আছে';
    renderAccountsSlide();
    renderDepartmentSlide();
    initCommandDeck();
  }

  function switchDept(dept) {
    const allowed = MMSession.getAllowedMadrasaDepts();
    if (dept !== 'all' && dept !== 'kitab' && dept !== 'maktab') return;
    if (dept === 'all' && allowed.length <= 1) return;
    if (dept !== 'all' && !MMSession.canUseMadrasaDept(dept)) return;
    currentDept = dept;
    try {
      if (dept === 'all') localStorage.removeItem(MADRASA_DEPT_KEY);
      else localStorage.setItem(MADRASA_DEPT_KEY, dept);
    } catch (e) {}
    syncDeptTabUI();
    renderCommandCenter();
    renderStats();
    renderClassList();
    updateWatchCounts();
  }

  function renderStats() {
    const iso = API.today();
    const depts = getScopeDepts();
    const att = depts.reduce((sum, dept) => {
      const part = API.Attendance.getDateSummaryForDept(iso, dept);
      return { present: sum.present + part.present, absent: sum.absent + part.absent };
    }, { present: 0, absent: 0 });
    const total = depts.reduce((sum, dept) => sum + API.Students.countActiveByDept(dept), 0);
    const totalEl = document.getElementById('s-total');
    if (totalEl) totalEl.textContent = toBn(total);
    const presentEl = document.getElementById('s-present');
    if (presentEl) presentEl.textContent = toBn(att.present);
    const absentEl = document.getElementById('s-absent');
    if (absentEl) absentEl.textContent = toBn(att.absent);
    const withdrawnEl = document.getElementById('s-withdrawn');
    if (withdrawnEl) withdrawnEl.textContent = toBn(countWithdrawalsByDept(currentDept));
  }

  function updateWatchCounts() {
    const depts = getScopeDepts();
    const wAbsent = document.getElementById('w-absent');
    if (wAbsent) wAbsent.textContent = toBn(depts.reduce((sum, dept) => sum + API.Attendance.countStudentsWithAnyAbsentByDept(dept), 0));
    const wSpecial = document.getElementById('w-special');
    if (wSpecial) wSpecial.textContent = toBn(depts.reduce((sum, dept) => sum + API.Students.countSpecialWatchByDept(dept), 0));
    const wAlham = document.getElementById('w-alham');
    if (wAlham) wAlham.textContent = toBn(depts.reduce((sum, dept) => sum + API.Students.countAlhamdulillahByDept(dept), 0));
    const avg = getKhulukAvgByDept(currentDept);
    const wKhulukAvg = document.getElementById('w-khuluk-avg');
    if (wKhulukAvg) wKhulukAvg.textContent = avg !== null ? toBn(avg) : '—';
  }

  function getKhulukAvgByDept(dept) {
    const classes = getClassesForScope(dept);
    const scores = [];
    classes.forEach(cls => {
      API.Students.getByClass(cls.id).forEach(s => {
        const k = API.Khuluk.getLatest(s.id);
        if (k) scores.push(k.score);
      });
    });
    return scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : null;
  }

  function getKhulukBandsByDept(dept) {
    const classes = getClassesForScope(dept);
    const classMap = {};
    classes.forEach(c => { classMap[c.id] = dept === 'all' ? deptLabel(c.dept) + ' — ' + c.name : c.name; });
    const bands = { high: [], mid: [], low: [], none: [] };
    classes.forEach(cls => {
      API.Students.getByClass(cls.id).forEach(s => {
        const k = API.Khuluk.getLatest(s.id);
        const entry = { id: s.id, name: s.name, score: k ? k.score : null, className: classMap[cls.id] || '' };
        if (!k) { bands.none.push(entry); return; }
        const sc = Number(k.score);
        if (Number.isNaN(sc)) { bands.none.push(entry); return; }
        if (sc >= 81) bands.high.push(entry);
        else if (sc >= 60) bands.mid.push(entry);
        else bands.low.push(entry);
      });
    });
    return bands;
  }

  function openKhulukPanel() {
    const bands = getKhulukBandsByDept(currentDept);
    const avg = getKhulukAvgByDept(currentDept);
    const total = bands.high.length + bands.mid.length + bands.low.length + bands.none.length;
    const subEl = document.getElementById('kh-ov-sub');
    if (subEl) subEl.textContent = (currentDept === 'all' ? 'সামগ্রিক' : (currentDept === 'maktab' ? 'মক্তব বিভাগ' : 'কিতাব বিভাগ')) + ' — নির্বাচিত বর্ষের সারসংক্ষেপ';
    const renderList = (arr, colorClass) => arr.length ? arr.map(s =>
      `<div class="kh-tier-student" onclick="event.stopPropagation()">
        <button type="button" class="s-name-btn kh-ts-name" onclick="event.stopPropagation();MMStudentModal.open('${String(s.id).replace(/'/g, "\\'")}')">${API.esc(s.name)}</button>
        <div class="kh-ts-class">${API.esc(s.className)}</div>
        ${s.score !== null ? `<div class="kh-ts-score ${colorClass}">${toBn(s.score)}</div>` : ''}
      </div>`).join('') : `<div style="color:var(--ink3);font-size:12px;padding:8px 0;">কেউ নেই</div>`;

    const deptBn = currentDept === 'all' ? 'সামগ্রিক' : (currentDept === 'maktab' ? 'মক্তব' : 'কিতাব');
    document.getElementById('kh-ov-body').innerHTML = `
      <div class="kh-avg-banner">
        <div class="kh-avg-num">${avg !== null ? toBn(avg) : '—'}</div>
        <div class="kh-avg-info">
          <div class="kh-avg-label">${deptBn} বিভাগের গড় হুসনুল খুলুক</div>
          <div class="kh-avg-note">${toBn(total)} জন ছাত্রের মধ্যে ${toBn(bands.none.length)} জনের রেকর্ড নেই</div>
        </div>
      </div>
      <div class="kh-tier-card kh-tier-card--high" onclick="toggleKhTier(this)">
        <div class="kh-tier-header">
          <div class="kh-tier-name">মুস্তাহিদ (৮১+)</div>
          <div class="kh-tier-count kh-tier-count--high">${toBn(bands.high.length)}</div>
        </div>
        <div class="kh-tier-desc">সর্বোচ্চ আচরণগত স্তর — হুসনুল খুলুক ৮১ বা তার বেশি</div>
        <div class="kh-tier-list">${renderList(bands.high,'kh-ts-score')}</div>
      </div>
      <div class="kh-tier-card kh-tier-card--mid" onclick="toggleKhTier(this)">
        <div class="kh-tier-header">
          <div class="kh-tier-name">মুতাওয়াস্সিত (৬০–৮০)</div>
          <div class="kh-tier-count kh-tier-count--mid">${toBn(bands.mid.length)}</div>
        </div>
        <div class="kh-tier-desc">মধ্যম আচরণগত স্তর — হুসনুল খুলুক ৬০ থেকে ৮০</div>
        <div class="kh-tier-list">${renderList(bands.mid,'kh-ts-score')}</div>
      </div>
      <div class="kh-tier-card kh-tier-card--low" onclick="toggleKhTier(this)">
        <div class="kh-tier-header">
          <div class="kh-tier-name">মুজতাহিদ (৬০-এর নিচে)</div>
          <div class="kh-tier-count kh-tier-count--low">${toBn(bands.low.length)}</div>
        </div>
        <div class="kh-tier-desc">উন্নতি প্রয়োজন — হুসনুল খুলুক ৬০-এর নিচে</div>
        <div class="kh-tier-list">${renderList(bands.low,'kh-ts-score')}</div>
      </div>`;
    /* cls-overlay যদি open থাকে বন্ধ করো */
    const clsOv = document.getElementById('cls-overlay');
    if (clsOv) { clsOv.classList.remove('is-open'); }

    const khOverlay = document.getElementById('kh-overlay');
    khOverlay.style.willChange = 'transform';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        khOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      });
    });
  }

  function closeKhulukPanel() {
    const khOverlay = document.getElementById('kh-overlay');
    khOverlay.classList.remove('is-open');
    khOverlay.style.willChange = '';
    document.body.style.overflow = '';
  }

  function toggleKhTier(card) {
    const list = card.querySelector('.kh-tier-list');
    list.classList.toggle('open');
  }

  let watchPanelTab = 'absent';

  function getWatchPanelRows() {
    const data = getTodayCommandStats();
    const absent = [];
    const seenAbsent = new Set();
    data.classes.forEach(cls => {
      API.Attendance.getByClassDate(cls.id, data.iso).forEach(rec => {
        if (API.Attendance.statusOf(rec) !== 'absent') return;
        const sid = String(rec.student_id || '');
        const student = API.Students.getByClass(cls.id).find(s =>
          String(s.id) === sid || String(s.supabase_id || '') === sid
        );
        if (!student || seenAbsent.has(String(student.id))) return;
        seenAbsent.add(String(student.id));
        absent.push({
          id: student.id,
          name: student.name,
          className: cls.name,
          value: rec.absent_reason || 'কারণ লেখা নেই',
        });
      });
    });

    const special = data.depts.flatMap(dept =>
      API.Students.getSpecialWatchByDeptSorted(dept).map(student => {
        const cls = API.Classes.getById(student.class_id);
        return { id: student.id, name: student.name, className: cls ? cls.name : '—', value: 'পর্যবেক্ষণ' };
      })
    );
    const khuluk = data.bands.low.map(student => ({
      id: student.id,
      name: student.name,
      className: student.className,
      value: 'খুলুক ' + toBn(student.score),
    }));
    return { absent, special, khuluk };
  }

  function renderWatchPanel() {
    const rows = getWatchPanelRows();
    const tabs = [
      { key:'absent', label:'আজ অনুপস্থিত', count:rows.absent.length },
      { key:'special', label:'পর্যবেক্ষণ', count:rows.special.length },
      { key:'khuluk', label:'কম খুলুক', count:rows.khuluk.length },
    ];
    document.getElementById('watch-tabs').innerHTML = tabs.map(tab =>
      `<button type="button" class="watch-tab${watchPanelTab === tab.key ? ' is-active' : ''}" onclick="setWatchPanelTab('${tab.key}')">${tab.label} (${toBn(tab.count)})</button>`
    ).join('');
    const activeRows = rows[watchPanelTab] || [];
    document.getElementById('watch-list').innerHTML = activeRows.length ? activeRows.map((row, index) =>
      `<button type="button" class="watch-row" onclick="MMStudentModal.open('${String(row.id).replace(/'/g, "\\'")}')">
        <span class="watch-rank">${toBn(index + 1)}</span>
        <span class="watch-info">
          <span class="watch-head">
            <span class="watch-name">${API.esc(row.name)}</span>
            <span class="watch-meta">${API.esc(row.className)}</span>
          </span>
          <span class="watch-value">${API.esc(row.value)}</span>
        </span>
      </button>`
    ).join('') : '<div class="watch-empty">এই বিভাগে এই শ্রেণির কোনো বিষয় নেই।</div>';
  }

  function setWatchPanelTab(tab) {
    if (!['absent', 'special', 'khuluk'].includes(tab)) return;
    watchPanelTab = tab;
    renderWatchPanel();
  }

  function openWatchPanel(tab) {
    watchPanelTab = ['absent', 'special', 'khuluk'].includes(tab) ? tab : 'absent';
    const scope = currentDept === 'all' ? 'সামগ্রিক' : (currentDept === 'maktab' ? 'মক্তব বিভাগ' : 'কিতাব বিভাগ');
    document.getElementById('watch-ov-sub').textContent = scope + ' — তিন ধরনের প্রয়োজনীয় ফলোআপ';
    renderWatchPanel();
    document.getElementById('watch-overlay').classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeWatchPanel() {
    document.getElementById('watch-overlay').classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function goAbsentList() {
    if (window.MDRHomePanels && MDRHomePanels.openAbsent) {
      MDRHomePanels.openAbsent({ depts: getScopeDepts() });
      return;
    }
    openDeptRoute('../madrasa/madrasa-absent-students.html');
  }
  function goSpecialWatch() {
    openWatchPanel('special');
  }
  function goAlhamdulillah() {
    openDeptRoute('../madrasa/madrasa-alhamdulillah.html');
  }

  function deptLabel(dept) {
    return dept === 'maktab' ? 'মক্তব বিভাগ' : 'কিতাব বিভাগ';
  }

  function getClassesForScope(dept) {
    if (dept === 'all') return getScopeDepts().flatMap(d => API.Classes.getByDept(d).map(c => ({ ...c, dept: d })));
    return API.Classes.getByDept(dept).map(c => ({ ...c, dept }));
  }

  function getSessionStartIso() {
    const s = API.Settings.get();
    const sd = s && s.session_start_date != null ? String(s.session_start_date).trim().slice(0, 10) : '';
    return sd || null;
  }

  function getCurrentHijriYear() {
    return (API.Settings.get().hijri_year || '').trim() || null;
  }

  function studentIdSetForClass(classId) {
    const set = new Set();
    API.Students.getByClass(classId).forEach((s) => {
      set.add(String(s.id || ''));
      if (s.supabase_id) set.add(String(s.supabase_id));
    });
    return set;
  }

  function classYearAttendancePct(classId, startIso, endIso) {
    const sidSet = studentIdSetForClass(classId);
    if (!sidSet.size) return null;
    const all = API.Attendance.getAll ? API.Attendance.getAll() : [];
    let present = 0;
    let absent = 0;
    all.forEach((a) => {
      const d = String(a.date || '').slice(0, 10);
      if (!sidSet.has(String(a.student_id || ''))) return;
      if (startIso && d < startIso) return;
      if (endIso && d > endIso) return;
      const st = API.Attendance.statusOf(a);
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
    });
    const total = present + absent;
    return total ? Math.round(present / total * 100) : null;
  }

  function classLatestAbsentCount(classId) {
    const sidSet = studentIdSetForClass(classId);
    if (!sidSet.size) return null;
    const all = (API.Attendance.getAll ? API.Attendance.getAll() : []).filter((a) =>
      sidSet.has(String(a.student_id || ''))
    );
    if (!all.length) return null;
    let latest = '';
    all.forEach((a) => {
      const d = String(a.date || '').slice(0, 10);
      if (d > latest) latest = d;
    });
    if (!latest) return null;
    return all.filter((a) =>
      String(a.date || '').slice(0, 10) === latest && API.Attendance.statusOf(a) === 'absent'
    ).length;
  }

  function renderClassList() {
    const iso = API.today();
    const sessionStart = getSessionStartIso();
    const classes = getClassesForScope(currentDept);

    let lastDept = '';
    const rows = classes.map(cls => {
      const students = API.Students.getByClass(cls.id);
      const attPct = classYearAttendancePct(cls.id, sessionStart, iso);
      const latestAbsent = classLatestAbsentCount(cls.id);
      const shokr = students.filter(s => s.alhamdulillah).length;
      const nazor = students.filter(s => s.special_watch).length;
      const bidayi = API.Students.getWithdrawalsFromClass(cls.id).length;
      const khAvg   = API.Khuluk.getClassAvg(cls.id);
      const section = currentDept === 'all' && cls.dept !== lastDept
        ? `<tr class="dept-section-row"><td colspan="8">${deptLabel(cls.dept)}</td></tr>`
        : '';
      lastDept = cls.dept;
      return section + `<tr class="class-row" onclick="openClassOverlay('${cls.id}')">
        <td class="td-name">${API.esc(cls.name)}</td>
        <td class="td-num n-in">${toBn(students.length)}</td>
        <td class="td-num n-pr">${attPct !== null ? toBn(attPct) + '%' : '—'}</td>
        <td class="td-num n-ab">${latestAbsent !== null ? toBn(latestAbsent) : '—'}</td>
        <td class="td-num n-shokr">${toBn(shokr)}</td>
        <td class="td-num n-watch">${toBn(nazor)}</td>
        <td class="td-num n-wd">${toBn(bidayi)}</td>
        <td class="td-num n-kh">${khAvg !== null ? toBn(khAvg) : '—'}</td>
      </tr>`;
    }).join('');

    document.getElementById('class-list-body').innerHTML = rows ||
      `<tr><td colspan="8" style="text-align:center;color:var(--ink3);padding:24px;">কোনো বর্ষ নেই</td></tr>`;
  }

  async function hydrateCommandDeckSources() {
    const pin = MMSession.getAdminPin && MMSession.getAdminPin();
    try {
      if (window.MdrAccAPI && MdrAccAPI.bootstrapRemote) {
        await MdrAccAPI.bootstrapRemote();
      }
    } catch (e) {
      console.warn('accounts dashboard cache failed', e);
    }
    try {
      if (pin && window.DeptSync && DeptSync.bootstrapAllData && window.DeptAPI) {
        const hasDeptData = DeptAPI.Departments.getAll().length && DeptAPI.Transactions.getAll().length;
        if (!hasDeptData) await DeptSync.bootstrapAllData(null, pin);
      }
    } catch (e) {
      console.warn('department dashboard cache failed', e);
    }
  }

  async function initDashboard() {
    try {
      applyAdminPermissions();
      const warm = window.MDRSupabaseSync && MDRSupabaseSync.isAdminMadrasaExtrasWarm &&
        MDRSupabaseSync.isAdminMadrasaExtrasWarm();
      if (!warm) {
        await syncMadrasaSettings();
        await MDRSupabaseSync.ensureAdminBootstrap({ force: true });
      }
      await hydrateCommandDeckSources();
      syncDeptTabUI();
      renderCommandCenter();
      renderStats();
      updateWatchCounts();
      renderClassList();
      if (window.MDRHomePanels) MDRHomePanels.init({ toBn });
    } catch (e) {
      console.warn('dashboard init failed', e);
      syncDeptTabUI();
      renderCommandCenter();
      renderStats();
      updateWatchCounts();
      renderClassList();
    }
  }
  MMLoading.run(initDashboard);

  (async function loadHaziraBadge() {
    const el = document.getElementById('hz-hub-badge');
    if (!el || !MMSession.canAdmin('teacher_hazira') || !window.MMSharedAPI || !MMSharedAPI.darsAdminBoard) return;
    try {
      const res = await MMSharedAPI.darsAdminBoard(MMSession.getAdminUserId(), MMSession.getAdminPin(), null);
      if (!res || !res.ok) return;
      let n = 0;
      (res.classes || []).forEach(c => (c.slots || []).forEach(s => {
        if (s.status === 'auto' || s.status === 'missed' || s.status === 'late') n++;
      }));
      if (n > 0) {
        el.textContent = String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
        el.style.display = 'inline-block';
        el.title = 'আজ যাচাই বাকি';
      }
    } catch (e) {
      console.warn('hazira badge failed', e);
    }
  })();
