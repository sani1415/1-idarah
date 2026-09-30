  if (MMSession.getRole() !== 'teacher') location.href = '../index.html';

  let teacher = MMSession.hydrateTeacherRecord();
  if (!teacher) { location.href = '../index.html'; }

  function resolvePageClass() {
    teacher = MMSession.hydrateTeacherRecord();
    if (!teacher) return null;
    if (window.MDRSupabaseSync && MDRSupabaseSync.ensureTeacherClassFromProfile) {
      return MDRSupabaseSync.ensureTeacherClassFromProfile(teacher);
    }
    return teacher.class_id ? API.Classes.getById(teacher.class_id) : null;
  }

  let myClass = resolvePageClass();
  let classId = myClass ? myClass.id : null;

  document.getElementById('top-teacher').textContent = teacher.name;

  function refreshTopbarClass() {
    myClass = resolvePageClass();
    classId = myClass ? myClass.id : null;
    document.getElementById('top-class').textContent = myClass ? myClass.name : 'বর্ষ নির্ধারিত নেই';
  }

  refreshTopbarClass();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function teacherActor() {
    return {
      id: MMSession.getStaffUserId && MMSession.getStaffUserId(),
      pin: MMSession.getStaffPin && MMSession.getStaffPin(),
    };
  }
  async function refreshTeacherData() {
    if (window.MDRSupabaseSync && window.MMSharedAPI) {
      try {
        await MDRSupabaseSync.syncTeacherClass();
        return true;
      } catch (e) {
        console.warn('Teacher class Supabase refresh failed', e);
      }
    }
    return false;
  }

  const toBn = n => String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);

  /** লগ প্যানেল: 'class' = বর্ষের সাধারণ লগ, 'student' = ছাত্রভিত্তিক (নামের নিচে গুচ্ছ) */
  let logSubTab = 'class';

  function _attrId(id) { return String(id).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  function _jsQuote(id) { return String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function openLogFromRowBtn(el) {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('student-log')) return;
    const sid = el.getAttribute('data-std-sid');
    if (sid) openLogModal(sid);
  }

  /** ছাত্রলোগ: নামে ক্লিক করলে নিচের লগ প্রসারিত/অ্যাকordion */
  function toggleStdLogGroup(btn) {
    if (!btn) return;
    const block = btn.closest('.log-student-block');
    const body = block && block.querySelector('.log-student-body');
    if (!body || !body.classList.contains('log-student-body')) return;
    const willOpen = body.hasAttribute('hidden');
    if (willOpen) {
      body.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
      if (block) block.classList.add('is-open');
    } else {
      body.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
      if (block) block.classList.remove('is-open');
    }
  }

  function showToast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }
  /* সার্ভারে সংরক্ষণ ব্যর্থ — ফোনে কিছু রাখা হয় না, ব্যবহারকারী আবার চেষ্টা করবেন */
  function saveFailMessage(e) {
    if (String((e && e.message) || e) === 'pin_locked') return 'অনেকবার ভুল পিন — ১৫ মিনিট পরে আবার চেষ্টা করুন';
    return 'সংরক্ষণ হয়নি — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন';
  }
  function openModal(id) {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockModal(id)) return;
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function goClassExams() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockExternalNav('exams')) return;
    location.href = 'madrasa-class-exams.html';
  }
  function goClassChat() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockExternalNav('chat')) return;
    location.href = '../chat.html';
  }

  /* ── TAB ── */
  function switchTabCore(name) {
    ['std','kitab','nizam','log'].forEach(p => {
      document.getElementById('panel-'+p).style.display = p===name ? '' : 'none';
      document.getElementById('nav-'+p).classList.toggle('active', p===name);
    });
    if (name==='std') renderStudents();
    if (name==='kitab') renderKitab();
    if (name==='nizam' && window.MDRClassRoutine) MDRClassRoutine.onShow();
    if (name==='log') renderLog();
    placeHaziraCard();
  }
  // দায়িত্ব গেট চালু থাকলেও শিক্ষক হাজিরা বন্ধ হবে না — কার্ড খোলা ট্যাবে সরে যায়।
  function placeHaziraCard() {
    const card = document.getElementById('hz-home-card');
    if (!card) return;
    const gated = !!(window.MDRClassDutyGate && MDRClassDutyGate.isGateActive());
    let target = 'std';
    if (gated) {
      ['kitab', 'log'].forEach(p => {
        if (document.getElementById('panel-' + p).style.display !== 'none') target = p;
      });
    }
    const host = document.getElementById('panel-' + target);
    if (host && card.parentNode !== host) host.insertBefore(card, host.firstChild);
  }
  function switchTab(name) {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockTab(name)) return;
    switchTabCore(name);
  }

  function setLogSubTab(which) {
    if (which !== 'class' && which !== 'student') return;
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockLogSubTab(which)) return;
    logSubTab = which;
    document.querySelectorAll('#panel-log .log-tab').forEach(function (btn) {
      const on = btn.getAttribute('data-log-tab') === which;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const list = document.getElementById('log-list');
    if (list) list.setAttribute('aria-labelledby', which === 'student' ? 'log-tab-student' : 'log-tab-class');
    renderLog();
  }

  /* ── STATS ── */
  function renderStats() {
    const grid = document.getElementById('stat-grid');
    if (!grid) return;
    if (!classId) { grid.innerHTML = ''; return; }

    const students = API.Students.getByClass(classId);
    const absentRows = getClassAbsentRows();
    const avg = API.Khuluk.getClassAvg(classId);

    const st = API.Settings.get();
    const hy = st && st.hijri_year && String(st.hijri_year) !== '—' ? String(st.hijri_year) : null;
    const leavers = API.Students.getWithdrawalsFromClass(classId, hy);
    const leaveCount = leavers.length;

    const bands = API.Khuluk.getClassKhulukBands(classId);
    const watchCount = students.filter(function (s) { return s.special_watch; }).length;
    const ahCount = students.filter(function (s) { return s.alhamdulillah; }).length;
    const threeLines =
      '<div class="kh-line kh-line--gr"><span class="kh-cat">মুস্তাহিদ</span><span class="kh-n">' + toBn(bands.high) + '</span></div>' +
      '<div class="kh-line kh-line--sky"><span class="kh-cat">মুতাওয়াস্সিত</span><span class="kh-n">' + toBn(bands.mid) + '</span></div>' +
      '<div class="kh-line kh-line--red"><span class="kh-cat">মুজতাহিদ</span><span class="kh-n">' + toBn(bands.low) + '</span></div>';

    grid.innerHTML =
      '<div class="stat-tile"><span class="stat-num">' + toBn(students.length) + '</span><span class="stat-label">মোট ছাত্র</span></div>' +
      '<button type="button" class="stat-tile stat-tile--absent" onclick="openClassAbsentListModal()"><span class="stat-num">' + toBn(absentRows.length) + '</span><span class="stat-label">অনুপস্থিত তালিকা</span></button>' +
      '<div class="stat-tile"><span class="stat-num stat-num--leave">' + toBn(leaveCount) + '</span><span class="stat-label">বিদায়ী</span></div>' +
      '<button type="button" class="stat-tile" onclick="openWatchListModal()"><span class="stat-num" style="color:#7c3aed">' + toBn(watchCount) + '</span><span class="stat-label">পর্যবেক্ষণ</span></button>' +
      '<button type="button" class="stat-tile stat-tile--ah" onclick="openAhListModal()"><span class="stat-num" style="color:#b45309">' + toBn(ahCount) + '</span><span class="stat-label">আলহামদুলিল্লাহ</span></button>' +
      '<div class="stat-tile"><span class="stat-num" style="color:var(--gold)">' + (avg !== null ? toBn(avg) : '—') + '</span><span class="stat-label">গড় হুসনুল খুলুক</span></div>' +
      '<button type="button" class="stat-tile stat-tile--kh" onclick="openKhulukCatModal()">' +
      '<div class="stat-kh-hd">' + '\u09B9\u09C1\u09B8\u09A8\u09C1\u09B2 \u0996\u09C1\u09B2\u09C1\u0995' + '</div>' +
      '<div class="kh-mini">' + threeLines + '</div>' +
      '</button>';
    renderDutyAlerts();
  }

  var dutyKhulukStudents = [];
  var dutyPanelOpen = false;

  function toggleDutyPanel() {
    dutyPanelOpen = !dutyPanelOpen;
    var panel = document.getElementById('duty-panel');
    if (panel) panel.classList.toggle('is-open', dutyPanelOpen);
    var btn = panel && panel.querySelector('.duty-hd');
    if (btn) btn.setAttribute('aria-expanded', dutyPanelOpen ? 'true' : 'false');
  }

  function renderDutyAlerts() {
    var wrap = document.getElementById('duty-panel-wrap');
    if (!wrap) return;
    if (!classId || !window.MDRClassDutyAlerts) {
      wrap.innerHTML = '';
      return;
    }
    var result = MDRClassDutyAlerts.computeClassDutyAlerts(classId);
    dutyKhulukStudents = [];
    if (result.ok) {
      wrap.innerHTML = '';
      dutyPanelOpen = false;
      if (window.MDRClassDutyGate) MDRClassDutyGate.refresh();
      placeHaziraCard();
      return;
    }
    dutyPanelOpen = true;
    var n = toBn(String(result.overdueCount));
    var itemsHtml = result.items.map(function (item) {
      if (item.id === 'khuluk' && item.meta && item.meta.students) {
        dutyKhulukStudents = item.meta.students.slice();
      }
      var icon = item.id === 'kitab' ? '📚' : item.id === 'khuluk' ? '✨' : '📝';
      var btnLabel = item.action === 'kitab' ? 'কিতাব' : item.action === 'khuluk-list' ? 'তালিকা' : 'লগ';
      var actionFn = item.action === 'kitab' ? 'dutyGoKitab()' : item.action === 'khuluk-list' ? 'openDutyKhulukList()' : 'dutyGoClassLog()';
      return '<div class="duty-item">' +
        '<span class="duty-item-icon" aria-hidden="true">' + icon + '</span>' +
        '<div class="duty-item-body"><div class="duty-item-title">' + API.esc(item.title) + '</div>' +
        '<div class="duty-item-detail">' + API.esc(item.detail) + '</div></div>' +
        '<button type="button" class="duty-item-btn" onclick="' + actionFn + '">' + btnLabel + '</button></div>';
    }).join('');
    wrap.innerHTML =
      '<section class="duty-panel duty-panel--warn' + (dutyPanelOpen ? ' is-open' : '') + '" id="duty-panel" aria-label="বর্ষের দায়িত্ব">' +
      '<button type="button" class="duty-hd" onclick="toggleDutyPanel()" aria-expanded="' + (dutyPanelOpen ? 'true' : 'false') + '">' +
      '<span class="duty-hd-left"><span class="duty-title">বর্ষের দায়িত্ব</span><span class="duty-badge duty-badge--warn">' + n + 'টি বাকি</span></span>' +
      '<svg class="duty-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="duty-body"><div class="duty-list">' + itemsHtml + '</div></div></section>';
    if (window.MDRClassDutyGate) MDRClassDutyGate.refresh();
    placeHaziraCard();
  }

  function dutyGoKitab() {
    switchTab('kitab');
  }

  function dutyGoClassLog() {
    switchTab('log');
    setLogSubTab('class');
    openLogModal();
  }

  function openDutyKhulukList() {
    var body = document.getElementById('duty-khuluk-body');
    var sub = document.getElementById('duty-khuluk-sub');
    if (!body) return;
    if (!dutyKhulukStudents.length && classId && window.MDRClassDutyAlerts) {
      var khItem = MDRClassDutyAlerts.computeClassDutyAlerts(classId).items.find(function (i) { return i.id === 'khuluk'; });
      if (khItem && khItem.meta && khItem.meta.students) dutyKhulukStudents = khItem.meta.students.slice();
    }
    var students = dutyKhulukStudents;
    if (sub) sub.textContent = students.length
      ? 'মোট ' + toBn(students.length) + ' জন — গত ৩০ দিনে হুসনুল খুলুক এন্ট্রি নেই'
      : 'কেউ নেই';
    if (!students.length) {
      body.innerHTML = '<div class="log-panel-empty">সব ছাত্রের খুলুক আপ-টু-ডেট।</div>';
    } else {
      body.innerHTML = students.map(function (s, i) {
        var hasR = s.roll != null && String(s.roll).trim() !== '';
        var rollPill = hasR ? API.escBn(String(s.roll)) : '—';
        var latest = API.Khuluk.getLatest(s.id);
        var lastTxt = latest && (latest.date || latest.at)
          ? 'সর্বশেষ: ' + (MDRClassDutyAlerts.formatIsoShort(latest.date || latest.at) || '—')
          : 'কোনো রেকর্ড নেই';
        return '<div class="watch-list-item">' +
          '<span class="std-roll">' + toBn(i + 1) + '</span>' +
          '<div class="absent-list-info">' +
            '<button type="button" class="watch-open-std" onclick="closeModal(\'modal-duty-khuluk\'); openKhuluk(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
            '<div class="absent-list-meta">পরিচিতি ' + rollPill + ' · ' + API.esc(lastTxt) + '</div>' +
          '</div></div>';
      }).join('');
    }
    openModal('modal-duty-khuluk');
  }

  /* ── অনুপস্থিত তালিকা ── */
  function getClassAbsentRows() {
    if (!classId || !API.Attendance) return [];
    const students = API.Students.getByClass(classId);
    return students.map(function (s) {
      const absentDays = API.Attendance.getSessionAbsentDays
        ? API.Attendance.getSessionAbsentDays(s)
        : (API.getSessionAbsentDays ? API.getSessionAbsentDays(s) : 0);
      return { student: s, absentDays: absentDays };
    }).filter(function (x) {
      return x.absentDays > 0;
    }).sort(function (a, b) {
      return (b.absentDays || 0) - (a.absentDays || 0) ||
        String(a.student.roll || '').localeCompare(String(b.student.roll || ''), undefined, { numeric: true }) ||
        String(a.student.name || '').localeCompare(String(b.student.name || ''), 'bn');
    });
  }

  async function openClassAbsentListModal() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('absent')) return;
    if (!classId) return;
    const body = document.getElementById('class-absent-list-body');
    const sub = document.getElementById('class-absent-list-sub');
    if (!body) return;
    if (window.MMSharedAPI && MMSharedAPI.teacherClassAbsentSummary && API.applyTeacherClassAbsentSummary &&
        MMSession.getStaffUserId && MMSession.getStaffPin) {
      try {
        const res = await MMSharedAPI.teacherClassAbsentSummary(
          MMSession.getStaffUserId(),
          MMSession.getStaffPin()
        );
        if (res && res.ok) API.applyTeacherClassAbsentSummary(res.rows || []);
      } catch (e) {
        console.warn('teacherClassAbsentSummary', e);
      }
    }
    const rows = getClassAbsentRows();
    if (sub) sub.textContent = rows.length
      ? 'মোট ' + toBn(rows.length) + ' জন — শিক্ষাবর্ষের শুরু থেকে · বেশি দিন থেকে কম'
      : 'কেউ নেই';
    if (!rows.length) {
      body.innerHTML = '<div class="log-panel-empty">এই বর্ষে কোনো ছাত্রের অনুপস্থিত রেকর্ড নেই।</div>';
    } else {
      body.innerHTML = rows.map(function (x, i) {
        const s = x.student;
        var hasR = s.roll != null && String(s.roll).trim() !== '';
        var rollPill = hasR ? API.escBn(String(s.roll)) : '—';
        return '<div class="watch-list-item">' +
          '<span class="std-roll">' + toBn(i + 1) + '</span>' +
          '<div class="absent-list-info">' +
            '<button type="button" class="watch-open-std" onclick="closeModal(\'modal-class-absent-list\'); MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
            '<div class="absent-list-meta">পরিচিতি ' + rollPill + '</div>' +
          '</div>' +
          '<div class="absent-list-days">' + toBn(x.absentDays) + ' দিন</div>' +
          '</div>';
      }).join('');
    }
    openModal('modal-class-absent-list');
  }

  /* ── হুসনুল খুলুক ক্যাটাগরি মোডাল ── */
  var khulukCatTab = 'high';
  function setKhulukCatTab(cat) {
    if (cat !== 'high' && cat !== 'mid' && cat !== 'low') return;
    khulukCatTab = cat;
    document.getElementById('khcat-tab-high').classList.toggle('active', cat === 'high');
    document.getElementById('khcat-tab-mid').classList.toggle('active', cat === 'mid');
    document.getElementById('khcat-tab-low').classList.toggle('active', cat === 'low');
    document.getElementById('khcat-tab-high').setAttribute('aria-selected', cat === 'high' ? 'true' : 'false');
    document.getElementById('khcat-tab-mid').setAttribute('aria-selected', cat === 'mid' ? 'true' : 'false');
    document.getElementById('khcat-tab-low').setAttribute('aria-selected', cat === 'low' ? 'true' : 'false');
    renderKhulukCatList();
  }
  function openKhulukCatModal() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('khcat')) return;
    if (!classId) return;
    khulukCatTab = 'high';
    setKhulukCatTab('high');
    openModal('modal-khuluk-cat');
  }
  function renderKhulukCatList() {
    var body = document.getElementById('khcat-list-body');
    var sub = document.getElementById('khcat-sub');
    if (!body || !classId) return;
    var students = API.Students.getByClass(classId);
    var filtered = students.filter(function(s) {
      var kh = API.Khuluk.getLatest(s.id);
      var score = kh != null && kh.score != null ? Number(kh.score) : null;
      if (score === null || Number.isNaN(score)) return false;
      if (khulukCatTab === 'high') return score >= 81;
      if (khulukCatTab === 'mid') return score >= 60 && score <= 80;
      return score < 60;
    });
    filtered.sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'bn'); });
    if (sub) sub.textContent = filtered.length ? 'মোট ' + toBn(filtered.length) + ' জন' : 'কেউ নেই';
    if (!filtered.length) {
      body.innerHTML = '<div class="log-panel-empty">এই ক্যাটাগরিতে কোনো ছাত্র নেই।</div>';
    } else {
      body.innerHTML = filtered.map(function(s) {
        var kh = API.Khuluk.getLatest(s.id);
        var sc = kh != null && kh.score != null ? toBn(kh.score) : '—';
        var hasR = s.roll != null && String(s.roll).trim() !== '';
        var rollPill = hasR ? API.escBn(String(s.roll)) : '—';
        return '<div class="watch-list-item">' +
          '<span class="std-roll">' + rollPill + '</span>' +
          '<button type="button" class="watch-open-std" onclick="closeModal(\'modal-khuluk-cat\'); MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
          '<span style="font-size:11px;font-weight:700;color:var(--ink3);flex-shrink:0;">' + sc + '</span>' +
          '</div>';
      }).join('');
    }
  }

  function openWatchListModal() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('watch')) return;
    if (!classId) return;
    const body = document.getElementById('watch-list-body');
    const sub = document.getElementById('watch-list-sub');
    if (!body) return;
    const watched = API.Students.getByClass(classId).filter(function (s) { return s.special_watch; });
    watched.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'bn'); });
    if (sub) sub.textContent = watched.length ? 'মোট ' + toBn(watched.length) + ' জন' : 'কেউ নেই';
    if (!watched.length) {
      body.innerHTML = '<div class="log-panel-empty">পর্যবেক্ষণে কেউ নেই। নিচের ছাত্র তালিকায় «পর্যবেক্ষণ» চেপে যুক্ত করুন।</div>';
    } else {
      body.innerHTML = watched.map(function (s) {
        var hasR = s.roll != null && String(s.roll).trim() !== '';
        var rollPill = hasR ? API.escBn(String(s.roll)) : '—';
        return '<div class="watch-list-item">' +
          '<span class="std-roll">' + rollPill + '</span>' +
          '<button type="button" class="watch-open-std" onclick="closeModal(\'modal-watch-list\'); MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
          '</div>';
      }).join('');
    }
    openModal('modal-watch-list');
  }

  function openAhListModal() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('ah')) return;
    if (!classId) return;
    const body = document.getElementById('ah-list-body');
    const sub = document.getElementById('ah-list-sub');
    if (!body) return;
    const listed = API.Students.getByClass(classId).filter(function (s) { return s.alhamdulillah; });
    listed.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'bn'); });
    if (sub) sub.textContent = listed.length ? 'মোট ' + toBn(listed.length) + ' জন' : 'কেউ নেই';
    if (!listed.length) {
      body.innerHTML = '<div class="log-panel-empty">আলহামদুলিল্লাহতে কেউ নেই। তারকা চিহ্ন চেপে যুক্ত করুন।</div>';
    } else {
      body.innerHTML = listed.map(function (s) {
        var hasR = s.roll != null && String(s.roll).trim() !== '';
        var rollPill = hasR ? API.escBn(String(s.roll)) : '—';
        var reason = String(s.alhamdulillah_reason || '').trim();
        var reasonHtml = reason
          ? '<div class="watch-item-reason">' + API.esc(reason) + '</div>'
          : '<div class="watch-item-reason is-missing">কারণ লেখা নেই — বাদ দিয়ে আবার যুক্ত করলে কারণ যোগ করা যাবে</div>';
        return '<div class="watch-list-item">' +
          '<span class="std-roll">' + rollPill + '</span>' +
          '<div class="watch-item-main">' +
          '<button type="button" class="watch-open-std" onclick="closeModal(\'modal-ah-list\'); MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
          reasonHtml +
          '</div>' +
          '</div>';
      }).join('');
    }
    openModal('modal-ah-list');
  }

  var ROW_SVG = {
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  };

  /* ── STUDENTS ── */
  var stdSearchQ = '';
  function _matchStudentSearch(s) {
    if (!stdSearchQ) return true;
    var q = stdSearchQ.toLowerCase().replace(/[০-৯]/g, function(d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d).toString(); });
    return ((s.name || '').toLowerCase().indexOf(q) >= 0) ||
           ((s.roll || '').toLowerCase().replace(/[০-৯]/g, function(d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d).toString(); }).indexOf(q) >= 0) ||
           ((s.student_id || '').toLowerCase().replace(/[০-৯]/g, function(d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d).toString(); }).indexOf(q) >= 0) ||
           ((s.permanent_id || '').toLowerCase().replace(/[০-৯]/g, function(d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d).toString(); }).indexOf(q) >= 0);
  }
  function renderStudents() {
    if (!classId) { document.getElementById('std-list').innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink3);">বর্ষ নির্ধারিত নেই</div>'; document.getElementById('std-search-strip').style.display='none'; return; }
    document.getElementById('std-search-strip').style.display = '';
    var allStudents = API.Students.getByClass(classId);
    var students = allStudents.filter(function(s) { return _matchStudentSearch(s); });
    const today = API.today();
    const att = API.Attendance.getByClassDate(classId, today) || {};
    const recs = att.records || [];
    document.getElementById('std-list').innerHTML = students.length
      ? students.map(s => {
          const rec = recs.find(r => r.student_id === s.id);
          const status = rec ? rec.status : 'unknown';
          const attLine = status === 'present' ? '🟢 উপস্থিত' : status === 'absent' ? '🔴 অনুপস্থিত' : '';
          const kh = API.Khuluk.getLatest(s.id);
          const khScore = kh != null && kh.score != null ? Number(kh.score) : null;
          const khClass = khScore === null || Number.isNaN(khScore) ? 'kh-none' : khScore >= 81 ? 'kh-high' : khScore >= 60 ? 'kh-mid' : 'kh-low';
          const khText = khScore !== null && !Number.isNaN(khScore) ? toBn(khScore) : '—';
          const hasR = s.roll != null && String(s.roll).trim() !== '';
          const rollPill = hasR ? API.escBn(String(s.roll)) : '—';
          const khTag = '<button type="button" class="std-kh-inline ' + khClass + '" title="হুসনুল খুলুক (সর্বশেষ)" onclick="event.stopPropagation();openKhuluk(\'' + _jsQuote(s.id) + '\')">' + khText + '</button>';
          const watchOn = !!s.special_watch;
          const ahOn = !!s.alhamdulillah;
          const watchBtn = '<button type="button" class="std-icon-btn std-icon-watch' + (watchOn ? ' is-on' : '') + '" data-std-sid="' + _attrId(s.id) + '" onclick="event.stopPropagation(); toggleSpecialWatchFromRowBtn(this)" title="পর্যবেক্ষণ" aria-label="পর্যবেক্ষণ">' + ROW_SVG.eye + '</button>';
          const ahBtn = '<button type="button" class="std-icon-btn std-icon-ah' + (ahOn ? ' is-on' : '') + '" data-std-sid="' + _attrId(s.id) + '" onclick="event.stopPropagation(); toggleAlhamdulillahFromRowBtn(this)" title="আলহামদুলিল্লাহ" aria-label="আলহামদুলিল্লাহ">' + ROW_SVG.star + '</button>';
          const logBtn = '<button type="button" class="std-icon-btn std-icon-log" data-std-sid="' + _attrId(s.id) + '" onclick="event.stopPropagation(); openLogFromRowBtn(this)" title="লগ" aria-label="লগ">' + ROW_SVG.doc + '</button>';
          const rowActions = '<div class="std-row-actions">' + watchBtn + ahBtn + logBtn + '</div>';
          return '<div class="std-row" data-std-sid="' + _attrId(s.id) + '">' +
            '<span class="std-roll">' + rollPill + '</span>' +
            '<div style="flex:1;min-width:0;">' +
            '<div class="std-name-row">' +
            '<div class="std-name-inner"><button type="button" class="s-name-btn std-name" onclick="event.stopPropagation();MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' + khTag + '</div>' +
            '</div>' +
            (attLine ? '<div class="std-meta">' + attLine + '</div>' : '') +
            '</div>' +
            rowActions +
            '</div>';
        }).join('')
      : '<div style="text-align:center;padding:40px;color:var(--ink3);font-size:13px;">এই বর্ষে কোনো ছাত্র নেই</div>';
  }
  async function toggleSpecialWatchFromRowBtn(btn) {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('watch-toggle')) return;
    const sid = btn && btn.getAttribute('data-std-sid');
    const stu = sid ? API.Students.getById(sid) : null;
    if (!stu) { showToast('ছাত্র পাওয়া যায়নি'); return; }
    const next = !stu.special_watch;
    API.Students.update(sid, { special_watch: next });
    renderStudents();
    renderStats();
    const supaSid = String(stu.supabase_id || stu.id || '');
    if (window.MMSharedAPI && MMSession.getStaffUserId && MMSession.getStaffUserId() && UUID_RE.test(supaSid)) {
      try {
        const res = await MMSharedAPI.setSpecialWatch(
          MMSession.getStaffUserId(),
          MMSession.getStaffPin && MMSession.getStaffPin(),
          supaSid,
          next
        );
        if (!res || !res.ok) throw new Error((res && res.error) || 'special_watch_failed');
      } catch (e) {
        console.warn('setSpecialWatch', e);
        API.Students.update(sid, { special_watch: !next });
        renderStudents();
        renderStats();
        showToast(saveFailMessage(e));
        return;
      }
    }
    showToast(next ? 'বিশেষ পর্যবেক্ষণে যুক্ত হয়েছে' : 'বিশেষ পর্যবেক্ষণ থেকে সরানো হয়েছে');
  }

  let ahReasonTargetId = '';
  let ahReasonSaving = false;

  function closeAhReasonModal() {
    ahReasonTargetId = '';
    ahReasonSaving = false;
    const inp = document.getElementById('ah-reason-inp');
    if (inp) inp.value = '';
    closeModal('modal-ah-reason');
  }

  async function applyAlhamdulillah(sid, next, reason) {
    const stu = API.Students.getById(sid);
    if (!stu) { showToast('ছাত্র পাওয়া যায়নি'); return false; }
    const reasonText = next ? String(reason || '').trim() : '';
    if (next && !reasonText) {
      showToast('কারণ লিখতে হবে');
      return false;
    }
    const prev = { alhamdulillah: stu.alhamdulillah, alhamdulillah_reason: stu.alhamdulillah_reason || '' };
    API.Students.update(sid, {
      alhamdulillah: next,
      alhamdulillah_reason: next ? reasonText : '',
    });
    renderStudents();
    renderStats();
    const supaSid = String(stu.supabase_id || stu.id || '');
    if (window.MMSharedAPI && MMSession.getStaffUserId && MMSession.getStaffUserId() && UUID_RE.test(supaSid)) {
      try {
        const res = await MMSharedAPI.setAlhamdulillah(
          MMSession.getStaffUserId(),
          MMSession.getStaffPin && MMSession.getStaffPin(),
          supaSid,
          next,
          next ? reasonText : null
        );
        if (!res || !res.ok) throw new Error((res && res.error) || 'alhamdulillah_failed');
      } catch (e) {
        console.warn('setAlhamdulillah', e);
        API.Students.update(sid, prev);
        renderStudents();
        renderStats();
        showToast(saveFailMessage(e));
        return false;
      }
    }
    showToast(next ? 'আলহামদুলিল্লাহ হিসেবে চিহ্নিত' : 'আলহামদুলিল্লাহ চিহ্ন সরানো হয়েছে');
    return true;
  }

  async function toggleAlhamdulillahFromRowBtn(btn) {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('ah-toggle')) return;
    const sid = btn && btn.getAttribute('data-std-sid');
    const stu = sid ? API.Students.getById(sid) : null;
    if (!stu) { showToast('ছাত্র পাওয়া যায়নি'); return; }
    if (stu.alhamdulillah) {
      await applyAlhamdulillah(sid, false, null);
      return;
    }
    ahReasonTargetId = sid;
    const inp = document.getElementById('ah-reason-inp');
    if (inp) inp.value = '';
    const hint = document.getElementById('ah-reason-hint');
    if (hint) hint.textContent = (stu.name || 'ছাত্র') + ' — ভালো দিক বা কেন চিহ্নিত করছেন, বিস্তারিত লিখুন (বাধ্যতামূলক)।';
    openModal('modal-ah-reason');
    if (inp) setTimeout(function () { inp.focus(); }, 50);
  }

  async function confirmAhReason() {
    if (ahReasonSaving) return;
    const sid = ahReasonTargetId;
    const inp = document.getElementById('ah-reason-inp');
    const reason = inp ? String(inp.value || '').trim() : '';
    if (!sid) { closeAhReasonModal(); return; }
    if (!reason) { showToast('কারণ লিখতে হবে'); if (inp) inp.focus(); return; }
    ahReasonSaving = true;
    try {
      const ok = await applyAlhamdulillah(sid, true, reason);
      if (ok) closeAhReasonModal();
    } finally {
      ahReasonSaving = false;
    }
  }

  /* ── KHULUK: সর্বশেষ সারাংশ + modal tab history ── */
  let khulukTargetId = '';
  let khulukEditId = '';
  let khulukSaving = false;
  function setKhulukModalTab(which) {
    const form = document.getElementById('kh-panel-form');
    if (form) form.hidden = false;
  }
  function fillKhulukHistory(sid) {
    const sumEl = document.getElementById('kh-latest-summary');
    const wrap = document.getElementById('kh-history-wrap');
    const hist = API.Khuluk.getByStudent(sid);
    const total = hist.length;
    const latest = API.Khuluk.getLatest(sid);
    if (sumEl) {
      if (latest && latest.score != null && !Number.isNaN(Number(latest.score))) {
        var rs = (latest.reason && String(latest.reason).length > 100) ? String(latest.reason).slice(0, 100) + '…' : (latest.reason || '');
        sumEl.style.display = 'block';
        sumEl.textContent = 'সর্বশেষ: হুসনুল খুলুক ' + toBn(latest.score) + ' · ' + (latest.date || '') + (rs ? ' — ' + rs : '') + (latest.by ? ' (' + latest.by + ')' : '');
      } else {
        sumEl.style.display = 'block';
        sumEl.textContent = 'এখনো কোনো হুসনুল খুলুক এন্ট্রি নেই — নিচে নতুন মান দিন';
      }
    }
    if (!wrap) return;
    if (total > 0) {
      var sub = total > 50 ? ' (মোট ' + toBn(total) + ' · সর্বোচ্চ ৫০টা দেখা)' : ' (মোট ' + toBn(total) + ')';
      wrap.innerHTML = '<div style="font-size:10px;font-weight:600;color:var(--ink3);margin-bottom:6px;">আগের এন্ট্রি' + sub + '</div>' +
        hist.slice(0, 50).map(function (h, i) {
          return '<div class="kh-hist-line" style="padding:6px 0;' + (i ? 'border-top:1px solid var(--cream3);' : '') + 'font-size:11px;line-height:1.35;">' +
            '<span class="kh-hist-date">' + API.esc(h.date) + (h.by ? ' · ' + API.esc(h.by) : '') + '</span><br>' +
            'হুসনুল খুলুক ' + toBn(h.score) + (h.reason ? ' — ' + API.esc(h.reason) : '') +
            ' <button type="button" class="mini-edit-btn" onclick="editKhulukEntry(\'' + _jsQuote(h.id) + '\')">এডিট</button>' +
            '</div>';
        }).join('');
    } else {
      wrap.innerHTML = '<div class="log-panel-empty">এখনো কোনো পুরনো এন্ট্রি নেই।</div>';
    }
  }
  function openKhuluk(sid) {
    if (!sid || !API.Students.getById(sid)) { showToast('ছাত্র পাওয়া যায়নি'); return; }
    khulukTargetId = sid;
    khulukEditId = '';
    const stu = API.Students.getById(sid);
    document.getElementById('kh-std-name').textContent = stu && stu.name ? stu.name : '—';
    const kh = API.Khuluk.getLatest(sid);
    document.getElementById('kh-score').value = kh != null && kh.score != null ? kh.score : '';
    document.getElementById('kh-reason').value = '';
    fillKhulukHistory(sid);
    setKhulukModalTab('form');
    openModal('modal-khuluk');
  }
  function editKhulukEntry(id) {
    const entry = API.Khuluk.getByStudent(khulukTargetId).find(k => k.id === id);
    if (!entry) { showToast('এন্ট্রি পাওয়া যায়নি'); return; }
    khulukEditId = id;
    document.getElementById('kh-score').value = entry.score;
    document.getElementById('kh-reason').value = entry.reason || '';
    setKhulukModalTab('form');
    showToast('এন্ট্রি এডিট করুন, তারপর সংরক্ষণ চাপুন');
  }
  async function saveKhuluk() {
    if (khulukSaving) return;
    const scoreN = parseInt(String(document.getElementById('kh-score').value).trim(), 10);
    const reason = document.getElementById('kh-reason').value.trim();
    if (Number.isNaN(scoreN) || scoreN < 0 || scoreN > 100) { showToast('হুসনুল খুলুক ০–১০০ এর মধ্যে পূর্ণসংখ্যা হিসেবে দিন'); return; }
    if (!reason) { showToast('কারণ / মন্তব্য লিখুন'); return; }
    if (!khulukTargetId) { showToast('ছাত্র নির্বাচিত নেই'); return; }
    khulukSaving = true;
    const saveBtnEl = document.querySelector('#modal-khuluk .submit-btn');
    if (saveBtnEl) saveBtnEl.disabled = true;
    try {
      const remote = window.MMSharedAPI && UUID_RE.test(khulukTargetId);
      if (remote) {
        /* আগে সার্ভার — ব্যর্থ হলে ফর্মে লেখা থেকে যায়, ব্যবহারকারী আবার চাপবেন */
        try {
          const actor = teacherActor();
          const res = khulukEditId && UUID_RE.test(khulukEditId)
            ? await MMSharedAPI.updateAkhlaq(actor.id, actor.pin, khulukEditId, scoreN, reason)
            : await MMSharedAPI.saveAkhlaq(actor.id, actor.pin, khulukTargetId, scoreN, reason);
          if (!res || !res.ok) throw new Error((res && res.error) || 'akhlaq_failed');
        } catch (e) {
          console.warn('Save akhlaq failed', e);
          showToast(saveFailMessage(e));
          return;
        }
      }
      if (khulukEditId) API.Khuluk.update(khulukEditId, { score: scoreN, reason, edited: true });
      else API.Khuluk.add(khulukTargetId, scoreN, reason, teacher.name);
      if (remote) await refreshTeacherData();
      const latest = API.Khuluk.getLatest(khulukTargetId);
      if (latest) document.getElementById('kh-score').value = latest.score;
      document.getElementById('kh-reason').value = '';
      khulukEditId = '';
      fillKhulukHistory(khulukTargetId);
      renderStudents();
      renderStats();
      showToast('হুসনুল খুলুক সংরক্ষিত');
    } finally {
      khulukSaving = false;
      if (saveBtnEl) saveBtnEl.disabled = false;
    }
  }

  /* ── KITAB ── */
  function setBookProgModalTab(which) {
    const form = document.getElementById('bp-panel-form');
    if (form) form.hidden = false;
  }
  function fillBookProgHistory(book) {
    const wrap = document.getElementById('bp-history-wrap');
    if (!wrap || !book) return;
    const hist = (book.history || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const total = hist.length;
    if (total > 0) {
      var sub = total > 80 ? ' (মোট ' + toBn(total) + ' · সর্বোচ্চ ৮০টা দেখা)' : ' (মোট ' + toBn(total) + ')';
      wrap.innerHTML = '<div style="font-size:10px;font-weight:600;color:var(--ink3);margin-bottom:6px;">অগ্রগতির ইতিহাস' + sub + '</div>' +
        hist.slice(0, 80).map(function (h, i) {
          var note = h.note ? ' — ' + API.esc(h.note) : '';
          var by = h.by ? ' · ' + API.esc(h.by) : '';
          return '<div class="bp-hist-line" style="padding:8px 0;' + (i ? 'border-top:1px solid var(--cream3);' : '') + 'font-size:12px;line-height:1.4;">' +
            '<span style="font-size:10px;color:var(--ink3);">' + API.esc(h.date || '') + by + '</span><br>' +
            '<strong>' + toBn(h.pages_done) + '</strong> পৃষ্ঠা' + note +
            '</div>';
        }).join('');
    } else {
      wrap.innerHTML = '<div class="log-panel-empty">এখনো কোনো অগ্রগতির ইতিহাস নেই।</div>';
    }
  }
  function bookProgressMeta(b) {
    const total = Number(b && b.total_pages) || 0;
    const done = Number(b && b.pages_done) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    return { total, done, pct };
  }

  function fillBookProgSummary(book) {
    var sumEl = document.getElementById('bp-latest-summary');
    if (!sumEl || !book) return;
    sumEl.style.display = 'block';
    var meta = bookProgressMeta(book);
    if (book.last_updated != null && String(book.last_updated) !== '' && meta.done >= 0) {
      var line = 'সর্বশেষ: ' + toBn(meta.done) + ' পৃষ্ঠা পঠিত · ' + book.last_updated;
      if (meta.total > 0) line += ' · ' + toBn(meta.pct) + '%';
      sumEl.textContent = line;
    } else {
      sumEl.textContent = 'এখনো কোনো অগ্রগতি রেকর্ড নেই — পঠিত পৃষ্ঠা লিখে সংরক্ষণ করুন';
    }
  }
  function openBookProgModal(bookId) {
    if (!classId || !bookId) { showToast('কিতাব পাওয়া যায়নি'); return; }
    var books = API.KitabProgress.getByClass(classId);
    var book = books.find(function (b) { return String(b.id) === String(bookId); });
    if (!book) { showToast('কিতাব পাওয়া যায়নি'); return; }
    document.getElementById('bp-book-label').textContent = book.name || '—';
    document.getElementById('bp-book-id').value = book.id;
    var meta = bookProgressMeta(book);
    document.getElementById('bp-total-pages').value = meta.total > 0 ? meta.total : '';
    document.getElementById('bp-pages').value = meta.done > 0 || book.pages_done != null ? meta.done : '';
    var hint = document.getElementById('bp-pages-hint');
    if (hint) {
      if (meta.total > 0) {
        hint.style.display = '';
        hint.textContent = 'মোট ' + toBn(meta.total) + ' পৃষ্ঠা · শতাংশ অ্যাপ নিজে হিসাব করবে';
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }
    document.getElementById('bp-note').value = '';
    fillBookProgSummary(book);
    fillBookProgHistory(book);
    setBookProgModalTab('form');
    openModal('modal-book-prog');
  }
  function renderKitab() {
    if (!classId) return;
    const hintEl = document.getElementById('kitab-list-hint');
    const books = API.KitabProgress.getByClass(classId);
    if (hintEl) hintEl.style.display = books.length ? '' : 'none';
    document.getElementById('kitab-list').innerHTML = books.length
      ? books.map(b => {
          const meta = bookProgressMeta(b);
          const isActive = b.is_active !== false;
          const metaLine = meta.total > 0
            ? 'মোট ' + toBn(meta.total) + ' · পড়া ' + toBn(meta.done) + ' · ' + toBn(meta.pct) + '%'
            : 'পড়া ' + toBn(meta.done) + ' পৃষ্ঠা';
          const dateBit = b.last_updated ? ' · ' + b.last_updated : '';
          return `<div class="book-row-wrap">
            <button type="button" class="book-row book-row--clickable${isActive ? '' : ' book-row--inactive'}" data-book-id="${_attrId(b.id)}" onclick="openBookProgModal('${_jsQuote(b.id)}')" aria-label="কিতাব অগ্রগতি: ${API.esc(b.name)}">
              <div class="book-name">${API.esc(b.name)}${isActive ? '' : '<span class="book-inactive-badge">নিষ্ক্রিয়</span>'}</div>
              <div class="book-meta">${metaLine}${dateBit}</div>
              <div class="prog-wrap">
                <div class="prog-track"><div class="prog-fill" style="width:${meta.pct != null ? meta.pct : 0}%"></div></div>
                <span class="prog-pct">${meta.pct != null ? toBn(meta.pct) + '%' : '—'}</span>
              </div>
            </button>
            <button type="button" class="book-active-toggle${isActive ? ' is-active' : ''}" onclick="toggleBookActive('${_jsQuote(b.id)}', ${isActive ? 'false' : 'true'})">
              ${isActive ? '✓ সক্রিয় — এখন পড়ানো হচ্ছে (নিষ্ক্রিয় করতে চাপুন)' : '○ নিষ্ক্রিয় — এখন পড়ানো হচ্ছে না (সক্রিয় করতে চাপুন)'}
            </button>
          </div>`;
        }).join('')
      : '<div style="text-align:center;padding:36px;color:var(--ink3);font-size:13px;">কোনো কিতাব নেই<br>সেটিংস থেকে কিতাব যোগ করুন</div>';
  }
  async function toggleBookActive(bookId, makeActive) {
    if (API.KitabProgress.updateKitab) API.KitabProgress.updateKitab(bookId, { is_active: makeActive });
    renderKitab();
    if (typeof renderDutyAlerts === 'function') renderDutyAlerts();
    if (window.MMSharedAPI && UUID_RE.test(bookId)) {
      try {
        const actor = teacherActor();
        const res = await MMSharedAPI.setBookActive(actor.id, actor.pin, bookId, makeActive);
        if (!res || !res.ok) throw new Error((res && res.error) || 'set_book_active_failed');
        await refreshTeacherData();
        renderKitab();
        if (typeof renderDutyAlerts === 'function') renderDutyAlerts();
      } catch (e) {
        console.warn('Set book active failed', e);
        if (API.KitabProgress.updateKitab) API.KitabProgress.updateKitab(bookId, { is_active: !makeActive });
        renderKitab();
        if (typeof renderDutyAlerts === 'function') renderDutyAlerts();
        showToast(saveFailMessage(e));
      }
    }
  }
  async function saveBookProg() {
    const book_id = document.getElementById('bp-book-id').value;
    const totalPages = parseInt(document.getElementById('bp-total-pages').value, 10) || 0;
    const pages = parseInt(document.getElementById('bp-pages').value, 10);
    const note = document.getElementById('bp-note').value.trim();
    if (!book_id) { showToast('কিতাব নির্বাচিত নেই'); return; }
    if (isNaN(pages) || pages < 0) { showToast('সঠিক পঠিত পৃষ্ঠা দিন'); return; }
    if (totalPages > 0 && pages > totalPages) { showToast('পঠিত পৃষ্ঠা মোট পৃষ্ঠার বেশি হতে পারে না'); return; }
    if (window.MMSharedAPI && UUID_RE.test(book_id)) {
      try {
        const actor = teacherActor();
        const res = await MMSharedAPI.saveBookProgress(actor.id, actor.pin, book_id, pages, note);
        if (!res || !res.ok) throw new Error((res && res.error) || 'book_progress_failed');
        await refreshTeacherData();
        closeModal('modal-book-prog');
        renderKitab();
        renderStats();
        showToast('অগ্রগতি সংরক্ষিত হয়েছে');
        return;
      } catch (e) {
        console.warn('Save book progress failed', e);
        showToast('ডাটাবেজে সংরক্ষণ হয়নি — আবার চেষ্টা করুন');
        return;
      }
    }
    API.KitabProgress.update(book_id, classId, pages, note);
    closeModal('modal-book-prog');
    renderKitab();
    renderStats();
    showToast('অগ্রগতি আপডেট হয়েছে (লোকাল)');
  }

  /* ── LOG (বর্ষ + নির্দিষ্ট ছাত্র — API.Logs type class | student) ── */
  function populateLogStudentSelect() {
    const sel = document.getElementById('log-student');
    if (!sel || !classId) return;
    const students = API.Students.getByClass(classId);
    sel.innerHTML = '<option value="">সবাই — বর্ষের সাধারণ লগ</option>' +
      students.map(function (s) {
        return '<option value="' + _attrId(s.id) + '">' + API.esc(s.name) + (s.roll != null && String(s.roll) !== '' ? ' · পরিচিতি ' + API.escBn(String(s.roll)) : '') + '</option>';
      }).join('');
  }
  let logEditId = '';
  let logModalFixedStudentId = null;
  function resetLogModalStudentPickerUi() {
    logModalFixedStudentId = null;
    const wrapPick = document.getElementById('log-student-field-wrap');
    if (wrapPick) wrapPick.hidden = false;
    const sel = document.getElementById('log-student');
    if (sel) sel.disabled = false;
    const h = document.getElementById('log-modal-heading');
    if (h) h.textContent = 'নতুন লগ';
  }
  function closeLogModal() {
    resetLogModalStudentPickerUi();
    closeModal('modal-log');
  }
  function setLogModalTab(which) {
    const form = document.getElementById('log-modal-panel-form');
    if (form) form.hidden = false;
  }
  function logStatusHtml(l) {
    var pill = '';
    if (l.reviewRequested) {
      pill = l.reviewedAt
        ? ' <span style="color:var(--green);font-weight:600;">রিভিউড ✓' + (l.reviewedByName ? ' · ' + API.esc(l.reviewedByName) : '') + '</span>'
        : ' <span style="color:var(--gold);font-weight:600;">রিভিউ বাকি</span>';
    }
    var reply = l.adminReply
      ? '<div style="margin-top:4px;font-size:12px;color:var(--ink2);">জিম্মাদারের মন্তব্য: ' + API.esc(l.adminReply) + '</div>'
      : '';
    return { pill: pill, reply: reply };
  }
  function updateLogReviewVisibility() {
    const sel = document.getElementById('log-student');
    const wrap = document.getElementById('log-review-wrap');
    if (!wrap) return;
    const sid = sel && sel.value ? sel.value : '';
    wrap.hidden = !sid || !!logEditId;
    if (wrap.hidden) {
      const cb = document.getElementById('log-review');
      if (cb) cb.checked = false;
    }
  }
  function renderModalLogHistory() {
    const wrap = document.getElementById('log-modal-history-wrap');
    const sel = document.getElementById('log-student');
    if (!wrap || !classId) return;
    const sid = sel && sel.value ? sel.value : '';
    const logs = sid ? API.Logs.getByStudent(sid) : API.Logs.getByClass(classId);
    const title = sid ? 'এই ছাত্রের পুরনো লগ' : 'এই বর্ষের সাধারণ লগ';
    wrap.innerHTML = logs.length
      ? '<div style="font-size:10px;font-weight:600;color:var(--ink3);margin-bottom:6px;">' + title + ' (' + toBn(logs.length) + ')</div>' +
        logs.slice(0, 60).map(function (l, i) {
          const st = logStatusHtml(l);
          return '<div class="log-item" style="' + (i ? 'border-top:1px solid var(--cream3);padding-top:8px;' : '') + '">' +
            '<div class="log-date">' + API.esc(l.date) + ' · ' + API.esc(l.by || '') + ' <button type="button" class="mini-edit-btn" onclick="editLogEntry(\'' + _jsQuote(l.id) + '\')">এডিট</button>' + st.pill + '</div>' +
            '<div class="log-text">' + API.esc(l.text || '') + '</div>' + st.reply + '</div>';
        }).join('')
      : '<div class="log-panel-empty">' + title + ' নেই।</div>';
  }
  function openLogModal(prefStudentId) {
    if (!classId) { showToast('বর্ষ নেই'); return; }
    logEditId = '';
    populateLogStudentSelect();
    const sel = document.getElementById('log-student');
    logModalFixedStudentId = prefStudentId && API.Students.getById(prefStudentId) ? String(prefStudentId) : null;
    const wrapPick = document.getElementById('log-student-field-wrap');
    const headingEl = document.getElementById('log-modal-heading');
    if (logModalFixedStudentId) {
      if (wrapPick) wrapPick.hidden = true;
      const stu = API.Students.getById(logModalFixedStudentId);
      if (headingEl) headingEl.textContent = 'নতুন লগ · ' + (stu && stu.name ? stu.name : '—');
      if (sel) {
        sel.value = logModalFixedStudentId;
        sel.disabled = true;
        sel.onchange = function () { renderModalLogHistory(); updateLogReviewVisibility(); };
      }
    } else {
      if (wrapPick) wrapPick.hidden = false;
      if (headingEl) headingEl.textContent = 'নতুন লগ';
      if (sel) {
        sel.disabled = false;
        sel.value = '';
        sel.onchange = function () { renderModalLogHistory(); updateLogReviewVisibility(); };
      }
    }
    document.getElementById('log-text').value = '';
    renderModalLogHistory();
    updateLogReviewVisibility();
    setLogModalTab('form');
    openModal('modal-log');
  }
  function editLogEntry(id) {
    const log = API.Logs.getAll().find(l => l.id === id);
    if (!log) { showToast('লগ পাওয়া যায়নি'); return; }
    resetLogModalStudentPickerUi();
    logEditId = id;
    populateLogStudentSelect();
    const sel = document.getElementById('log-student');
    if (sel) {
      sel.value = log.type === 'student' ? log.ref_id : '';
      sel.disabled = true;
    }
    updateLogReviewVisibility();
    document.getElementById('log-text').value = log.text || '';
    const headingEl = document.getElementById('log-modal-heading');
    if (headingEl) {
      if (log.type === 'student') {
        const stu = API.Students.getById(log.ref_id);
        headingEl.textContent = 'লগ সংশোধন · ' + (stu && stu.name ? stu.name : '—');
      } else {
        headingEl.textContent = 'লগ সংশোধন · বর্ষের লগ';
      }
    }
    renderModalLogHistory();
    setLogModalTab('form');
    openModal('modal-log');
    showToast('লগ এডিট করুন, তারপর সংরক্ষণ চাপুন');
  }
  function renderLog() {
    if (!classId) return;
    const el = document.getElementById('log-list');
    if (!el) return;

    const classLogs = API.Logs.getByClass(classId);
    const students = API.Students.getByClass(classId);

    if (logSubTab === 'class') {
      el.innerHTML = classLogs.length
        ? classLogs.map(function (l) {
            const st = logStatusHtml(l);
            return '<div class="log-item"><div class="log-date">' + l.date + ' · ' + API.esc(l.by || '') + ' <button type="button" class="mini-edit-btn" onclick="editLogEntry(\'' + _jsQuote(l.id) + '\')">এডিট</button>' + st.pill + '</div><div class="log-text">' + API.esc(l.text) + '</div>' + st.reply + '</div>';
          }).join('')
        : '<div class="log-panel-empty">কোনো <strong>শ্রেণী লগ</strong> নেই।<br><span style="font-size:12px;opacity:.95;">＋ বাটনে বর্ষের সাধারণ নোট যোগ করুন (কোনো ছাত্র বেছে না নিলেই হবে)।</span></div>';
      return;
    }

    /* ছাত্রলোগ: প্রতি ছাত্রের নামের আন্ডারে ঐ ছাত্রের সব এন্ট্রি (একাধিক হলে সব এখানে) */
    const groups = students.map(function (s) {
      return { student: s, logs: API.Logs.getByStudent(s.id) };
    }).filter(function (g) { return g.logs.length > 0; });
    groups.sort(function (a, b) { return b.logs[0].date.localeCompare(a.logs[0].date); });

    if (!groups.length) {
      el.innerHTML = '<div class="log-panel-empty">কোনো <strong>ছাত্র-নির্দিষ্ট লগ</strong> নেই।<br><span style="font-size:12px;opacity:.95;">নতুন লগে নির্দিষ্ট ছাত্র বেছে কিংবা হোম থেকে ছাত্রের সারিতে <strong>লগ</strong> চেপে এন্ট্রি করুন।</span></div>';
      return;
    }

    el.innerHTML = groups.map(function (g) {
      const s = g.student;
      const rollPart = s.roll != null && String(s.roll) !== '' ? ' · পরিচিতি ' + toBn(String(s.roll)) : '';
      const n = toBn(String(g.logs.length));
      const head =
        '<div class="log-student-hd">' +
        '<div class="log-student-hd-text">' +
        '<button type="button" class="s-name-btn" onclick="event.stopPropagation();MMStudentModal.open(\'' + _jsQuote(s.id) + '\')">' + API.esc(s.name) + '</button>' +
        rollPart + '<span class="log-cnt">লগ ' + n + ' টি</span></div>' +
        '<button type="button" class="log-student-expand" aria-expanded="false" aria-label="লগ তালিকা প্রসারিত বা সংকুচিত" onclick="toggleStdLogGroup(this)">' +
        '<svg class="log-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div>';
      const body = '<div class="log-student-body" hidden>' + g.logs.map(function (l) {
        const st = logStatusHtml(l);
        return '<div class="log-item log-item--student"><div class="log-date">' + l.date + ' · ' + API.esc(l.by || '') + ' <button type="button" class="mini-edit-btn" onclick="editLogEntry(\'' + _jsQuote(l.id) + '\')">এডিট</button>' + st.pill + '</div><div class="log-text">' + API.esc(l.text) + '</div>' + st.reply + '</div>';
      }).join('') + '</div>';
      return '<div class="log-student-block">' + head + body + '</div>';
    }).join('');
  }
  async function saveLog() {
    const text = document.getElementById('log-text').value.trim();
    if (!text) { showToast('লগ লিখুন'); return; }
    const sel = document.getElementById('log-student');
    const sid = sel && sel.value ? sel.value : '';
    if (logEditId) {
      const remoteEdit = window.MMSharedAPI && UUID_RE.test(logEditId);
      if (remoteEdit) {
        /* আগে সার্ভার — ব্যর্থ হলে modal খোলা থাকে, লেখা হারায় না */
        try {
          const actor = teacherActor();
          const res = await MMSharedAPI.updateTeacherLog(actor.id, actor.pin, logEditId, text);
          if (!res || !res.ok) throw new Error((res && res.error) || 'log_update_failed');
        } catch (e) {
          console.warn('Update teacher log failed', e);
          showToast(saveFailMessage(e));
          return;
        }
      }
      API.Logs.update(logEditId, { text, edited: true });
      if (remoteEdit) await refreshTeacherData();
      logEditId = '';
      closeLogModal(); renderLog(); renderStats(); showToast('লগ সংশোধন হয়েছে');
      return;
    }
    const reviewCb = document.getElementById('log-review');
    const reviewRequested = !!(sid && reviewCb && reviewCb.checked);
    const logType = sid ? 'student' : 'class';
    if (sid && !API.Students.getById(sid)) { showToast('অকার্যকর ছাত্র'); return; }
    const remote = window.MMSharedAPI && (logType === 'class' || UUID_RE.test(sid));
    if (remote) {
      /* আগে সার্ভার — ব্যর্থ হলে modal খোলা থাকে, লেখা হারায় না */
      try {
        const actor = teacherActor();
        const res = await MMSharedAPI.saveTeacherLog(actor.id, actor.pin, logType, logType === 'student' ? sid : null, text, logType === 'student' ? reviewRequested : true);
        if (!res || !res.ok) throw new Error((res && res.error) || 'log_failed');
      } catch (e) {
        console.warn('Save teacher log failed', e);
        showToast(saveFailMessage(e));
        return;
      }
    }
    if (logType === 'student') API.Logs.add('student', sid, text, teacher.name, 'normal', { reviewRequested });
    else API.Logs.add('class', classId, text, teacher.name, 'normal', { reviewRequested: true });
    if (remote) await refreshTeacherData();
    document.getElementById('log-text').value = '';
    if (reviewCb) reviewCb.checked = false;
    closeLogModal(); renderLog(); renderStats(); showToast('লগ যোগ হয়েছে');
  }

  async function initClassPage() {
    if (window.MDRClassRoutine) {
      MDRClassRoutine.bind({
        getActor: teacherActor,
        notify: showToast,
        escapeHtml: function (s) {
          return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
        toBn: toBn,
        formatDateTime: function (iso) {
          if (!iso) return '';
          try {
            return new Date(iso).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
          } catch (e) {
            return String(iso);
          }
        },
      });
    }
    if (window.MDRClassDutyGate) {
      MDRClassDutyGate.bind({
        getClassId: function () { return classId; },
        notify: showToast,
        forceSwitchTab: switchTabCore,
        openDutyPanel: function () {
          dutyPanelOpen = true;
          var panel = document.getElementById('duty-panel');
          if (!panel) return;
          panel.classList.add('is-open');
          var btn = panel.querySelector('.duty-hd');
          if (btn) btn.setAttribute('aria-expanded', 'true');
        },
      });
    }
    await refreshTeacherData();
    refreshTopbarClass();
    renderStats();
    if (window.MDRTeacherHaziraCard) {
      MDRTeacherHaziraCard.init({ getActor: teacherActor, notify: showToast });
    }
    initTabFromUrl();
    if (window.MDRClassDutyGate) MDRClassDutyGate.refresh();
    placeHaziraCard();
  }

  function initTabFromUrl() {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'kitab') switchTab('kitab');
    else if (q === 'nizam' || q === 'awqat') switchTab('nizam');
    else if (q === 'log') switchTab('log');
    else switchTab('std');
  }

  function openPinChangeModal() {
    if (window.MDRClassDutyGate && MDRClassDutyGate.blockMisc('pin')) return;
    document.getElementById('pc-cur').value='';document.getElementById('pc-new').value='';document.getElementById('pc-conf').value='';document.getElementById('pc-err').textContent='';document.getElementById('modal-pin-change').classList.add('open');
  }
  function closePinChangeModal(){document.getElementById('modal-pin-change').classList.remove('open');}
  async function saveOwnPin(){
    var c=document.getElementById('pc-cur').value,n=document.getElementById('pc-new').value,f=document.getElementById('pc-conf').value,e=document.getElementById('pc-err');
    if(!c||!n||!f){e.textContent='সব ঘর পূরণ করুন';return;}
    if(n!==f){e.textContent='PIN মিলছে না';return;}
    if(n.length!==4||!/^\d+$/.test(n)){e.textContent='PIN ৪ সংখ্যার হতে হবে';return;}
    e.textContent='Saving...';
    var result=await MMSession.changeStaffPin(c,n,function(uid,cur,next){return API.Teachers.changeOwnPin(uid,cur,next);});
    if(!result.ok){e.textContent=(MMSession.pinChangeErrorMessage&&MMSession.pinChangeErrorMessage(result.error))||'PIN change failed';return;}
    closePinChangeModal();
    if(typeof showToast==='function')showToast('PIN সফলভাবে পরিবর্তন হয়েছে');
  }

  MMLoading.run(initClassPage);
