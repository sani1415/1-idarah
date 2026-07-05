/**
 * Shared student profile modal (tabs: info, attendance, wajifa, assessment).
 * Depends on global API, optional MMHijri, optional window.toBn / window.showToast.
 * Optional: window.mmStudentModalExtraInfo(sid, student) => HTML string for first tab.
 */
(function (global) {
  'use strict';

  var MODAL_ID = 'modal-student-detail';

  function getApi() {
    var w = typeof globalThis !== 'undefined' ? globalThis : global;
    if (w && w.API && w.API.Students) return w.API;
    w = global;
    if (w && w.API && w.API.Students) return w.API;
    if (typeof window !== 'undefined' && window.API && window.API.Students) return window.API;
    // api.js: const API ব্রাউজারে globalThis এ স্বয়ংক্রিয়ভাবে সেট হয় না
    if (typeof API !== 'undefined' && API && API.Students) return API;
    return null;
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function toBn(n) {
    if (typeof global.toBn === 'function') return global.toBn(n);
    return String(n).replace(/[0-9]/g, function (d) {
      return '০১২৩৪৫৬৭৮৯'[d];
    });
  }

  function stFmtAttDateLine(iso) {
    if (global.MMHijri && global.MMHijri.dualLine) {
      var du2 = global.MMHijri.dualLine(iso);
      if (du2 && du2.hijriOk) {
        return du2.primary + ' <span class="st-subdate">(' + (global.MMHijri.gregorianLongBn(iso) || '') + ')</span>';
      }
      if (global.MMHijri.gregorianLongBn) return global.MMHijri.gregorianLongBn(iso) || getApi().esc(iso);
    }
    return getApi().esc(iso);
  }

  function attStatusMeta(API, row) {
    if (row && row._missingAttendance) return { key: 'm', label: 'চিহ্নিত নয়' };
    var st = API.Attendance.statusOf(row);
    if (st === 'absent') return { key: 'a', label: 'অনুপস্থিত' };
    if (st === 'holiday') return { key: 'h', label: 'ছুটি' };
    return { key: 'p', label: 'উপস্থিত' };
  }

  function monthLabel(ym) {
    var months = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    var parts = String(ym || '').split('-');
    var y = Number(parts[0]) || 0;
    var m = Number(parts[1]) || 1;
    return (months[m - 1] || ym) + ' ' + toBn(y);
  }

  function attendanceDateKey(row) {
    return String(row && row.date || '').slice(0, 10);
  }

  function latestRowsByDate(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var date = attendanceDateKey(r);
      if (!date || out[date]) return;
      out[date] = r;
    });
    return out;
  }

  function studentIdSetForClass(API, classId) {
    var out = {};
    if (!classId || !API.Students || !API.Students.getByClass) return out;
    API.Students.getByClass(classId).forEach(function (s) {
      if (!s) return;
      if (s.id) out[String(s.id)] = true;
      if (s.supabase_id) out[String(s.supabase_id)] = true;
    });
    return out;
  }

  function buildAttendanceTimeline(API, sid, studentRows) {
    var rowByDate = latestRowsByDate(studentRows);
    var dates = {};
    Object.keys(rowByDate).forEach(function (date) { dates[date] = true; });

    var s = API.Students && API.Students.getById ? API.Students.getById(sid) : null;
    var classStudentIds = s ? studentIdSetForClass(API, s.class_id) : {};
    var allAttendance = API.Attendance.getAll ? API.Attendance.getAll() : studentRows;
    allAttendance.forEach(function (r) {
      var date = attendanceDateKey(r);
      if (!date) return;
      if (classStudentIds[String(r.student_id || '')]) dates[date] = true;
    });

    return Object.keys(dates).sort().reverse().map(function (date) {
      return rowByDate[date] || { date: date, student_id: sid, _missingAttendance: true };
    });
  }

  function buildAttendancePanel(API, sid) {
    var studentRows = API.Attendance.getByStudent(sid);
    var allRows = buildAttendanceTimeline(API, sid, studentRows);
    if (!allRows.length) {
      return '<div class="st-empty">কোনো হাজিরা রেকর্ড পাওয়া যায়নি।</div>';
    }

    var counts = { p: 0, a: 0, h: 0, m: 0 };
    allRows.forEach(function (r) {
      counts[attStatusMeta(API, r).key] += 1;
    });
    var counted = counts.p + counts.a + counts.m;
    var pct = counted ? Math.round((counts.p / counted) * 100) : 0;

    var recentMonth = String(allRows[0].date || '').slice(0, 7);
    var monthRows = allRows.filter(function (r) { return String(r.date || '').slice(0, 7) === recentMonth; });
    var byDate = {};
    monthRows.forEach(function (r) { byDate[String(r.date || '').slice(0, 10)] = r; });
    var y = Number(recentMonth.slice(0, 4));
    var m = Number(recentMonth.slice(5, 7));
    var daysInMonth = new Date(y, m, 0).getDate();
    var monthCells = '';
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = recentMonth + '-' + String(d).padStart(2, '0');
      var row = byDate[iso];
      var meta = row ? attStatusMeta(API, row) : { key: 'x', label: '' };
      monthCells += '<span class="st-att-day st-att-day--' + meta.key + '" title="' + API.esc(iso + (meta.label ? ' · ' + meta.label : '')) + '">' + toBn(d) + '</span>';
    }

    var byMonth = {};
    allRows.forEach(function (r) {
      var ym = String(r.date || '').slice(0, 7);
      if (!ym) return;
      if (!byMonth[ym]) byMonth[ym] = { p: 0, a: 0, h: 0, m: 0 };
      byMonth[ym][attStatusMeta(API, r).key] += 1;
    });
    var monthSummary = Object.keys(byMonth).sort().reverse().slice(0, 4).map(function (ym) {
      var x = byMonth[ym];
      var denom = x.p + x.a + x.m;
      var rate = denom ? Math.round((x.p / denom) * 100) : 0;
      var holiday = x.h ? '<span>ছুটি ' + toBn(x.h) + '</span>' : '';
      var missing = x.m ? '<span>চিহ্নিত নয় ' + toBn(x.m) + '</span>' : '';
      return '<div class="st-att-month-row"><strong>' + API.esc(monthLabel(ym)) + '</strong><span>উপস্থিত ' + toBn(x.p) + '</span><span>অনুপস্থিত ' + toBn(x.a) + '</span>' + holiday + missing + '<span>' + toBn(rate) + '%</span></div>';
    }).join('');

    var absentRows = allRows.filter(function (r) { return attStatusMeta(API, r).key === 'a'; }).slice(0, 8);
    var absentHtml = absentRows.length
      ? absentRows.map(function (r) {
          return '<div class="st-att-abs-row"><strong>' + stFmtAttDateLine(r.date) + '</strong><span>' + API.esc(r.absent_reason || 'কারণ সংরক্ষিত নেই') + '</span></div>';
        }).join('')
      : '<div class="st-empty st-empty--sm">অনুপস্থিতির রেকর্ড নেই।</div>';

    var recentHtml = allRows.slice(0, 10).map(function (r) {
      var meta = attStatusMeta(API, r);
      var reason = meta.key === 'a' && r.absent_reason ? '<div class="st-note">' + API.esc(r.absent_reason) + '</div>' : '';
      return (
        '<div class="st-hist-item"><div class="st-hist-date">' +
        stFmtAttDateLine(r.date) +
        reason +
        '</div><div class="st-hist-meta"><span class="st-badg st-badg--' +
        meta.key +
        '">' +
        meta.label +
        '</span></div></div>'
      );
    }).join('');
    var coverageNote = counts.m
      ? '<div class="st-att-note">এই ছাত্রের জন্য ' + toBn(counts.m) + ' দিনে আলাদা হাজিরা row নেই। তাই এগুলো “চিহ্নিত নয়” ধরা হয়েছে; ঐ দিনগুলোর হাজিরা আবার সেভ করলে হিসাব পূর্ণ হবে।</div>'
      : '';

    return (
      '<div class="st-att-overview">' +
      '<div class="st-att-cards">' +
      '<div class="st-att-card"><span>হাজিরা নেওয়া দিন</span><strong>' + toBn(allRows.length) + '</strong></div>' +
      '<div class="st-att-card st-att-card--p"><span>উপস্থিত</span><strong>' + toBn(counts.p) + '</strong></div>' +
      '<div class="st-att-card st-att-card--a"><span>অনুপস্থিত</span><strong>' + toBn(counts.a) + '</strong></div>' +
      (counts.h ? '<div class="st-att-card st-att-card--h"><span>ছুটি</span><strong>' + toBn(counts.h) + '</strong></div>' : '') +
      '<div class="st-att-card st-att-card--m"><span>চিহ্নিত নয়</span><strong>' + toBn(counts.m) + '</strong></div>' +
      '<div class="st-att-card"><span>হার</span><strong>' + toBn(pct) + '%</strong></div>' +
      '</div>' +
      coverageNote +
      '<div class="st-att-month"><div class="st-att-section-hd"><strong>' + API.esc(monthLabel(recentMonth)) + '</strong><span>সাম্প্রতিক মাস</span></div><div class="st-att-grid">' + monthCells + '</div></div>' +
      '<div class="st-att-section"><div class="st-att-section-hd"><strong>মাসভিত্তিক সারাংশ</strong></div>' + monthSummary + '</div>' +
      '<div class="st-att-section"><div class="st-att-section-hd"><strong>অনুপস্থিতির কারণ</strong></div>' + absentHtml + '</div>' +
      '<div class="st-att-section"><div class="st-att-section-hd"><strong>শেষ ১০ দিন</strong></div>' + recentHtml + '</div>' +
      '</div>'
    );
  }

  function initialChar(name) {
    if (!name || !String(name).trim()) return '?';
    var t = String(name).trim();
    var ch = typeof Array.from === 'function' ? Array.from(t)[0] : t[0];
    return ch || '?';
  }

  var PHOTO_STORAGE_URL = 'https://bbdtoucanihtrymzpynq.supabase.co/storage/v1/object/public/student-photos/';

  function photoBase() {
    if (global.MMPhotoBase) return global.MMPhotoBase;
    var path = (global.location && global.location.pathname) || '';
    var parts = path.replace(/\\/g, '/').split('/');
    var dir = parts[parts.length - 2] || '';
    return ['madrasa', 'dept', 'khedmat'].indexOf(dir) >= 0 ? '../photos/' : 'photos/';
  }

  function photoUrl(s) {
    var p = s.photo || s.photo_url;
    if (p && typeof p === 'string' && p.trim()) return p.trim();
    if (s.permanent_id && String(s.permanent_id).trim()) {
      var pid = String(s.permanent_id).trim();
      return PHOTO_STORAGE_URL + pid + '.jpg';
    }
    return null;
  }

  function setAvatar(s) {
    var root = document.getElementById('st-modal-avatar');
    var img = document.getElementById('st-modal-avatar-img');
    var ph = document.getElementById('st-modal-avatar-ph');
    if (!root || !img || !ph) return;
    var url = photoUrl(s);
    root.dataset.photoUrl = '';
    root.classList.remove('st-avatar--clickable');
    img.removeAttribute('src');
    img.alt = '';
    img.onload = null;
    img.onerror = null;
    if (url) {
      img.style.display = '';
      ph.style.display = 'none';
      img.alt = s.name || '';
      img.onload = function () {
        img.style.display = '';
        ph.style.display = 'none';
        root.classList.remove('st-avatar--empty');
        root.classList.add('st-avatar--clickable');
        root.dataset.photoUrl = url;
      };
      img.onerror = function () {
        img.style.display = 'none';
        ph.style.display = '';
        ph.textContent = initialChar(s.name);
        root.classList.add('st-avatar--empty');
        root.classList.remove('st-avatar--clickable');
        root.dataset.photoUrl = '';
      };
      img.src = url;
    } else {
      img.style.display = 'none';
      ph.style.display = '';
      ph.textContent = initialChar(s.name);
      root.dataset.photoUrl = '';
    }
    root.classList.toggle('st-avatar--empty', !url);
  }

  function ensurePhotoPreview() {
    if (document.getElementById('modal-student-photo-preview')) return;
    var wrap = document.createElement('div');
    wrap.id = 'modal-student-photo-preview';
    wrap.className = 'modal-bg st-photo-preview-bg';
    wrap.innerHTML =
      '<div class="st-photo-preview" id="st-photo-preview-inner">' +
      '<button type="button" class="st-photo-close" id="st-photo-close" aria-label="বন্ধ">×</button>' +
      '<img id="st-photo-preview-img" class="st-photo-preview-img" alt="" />' +
      '</div>';

    wrap.addEventListener('click', function (e) {
      if (e.target.id === 'modal-student-photo-preview') closePhotoPreview();
    });
    var inner = wrap.querySelector('#st-photo-preview-inner');
    if (inner) inner.addEventListener('click', function (e) { e.stopPropagation(); });
    var btn = wrap.querySelector('#st-photo-close');
    if (btn) btn.addEventListener('click', closePhotoPreview);
    document.body.appendChild(wrap);
  }

  function openPhotoPreview() {
    var root = document.getElementById('st-modal-avatar');
    var img = document.getElementById('st-modal-avatar-img');
    var url = root && root.dataset ? root.dataset.photoUrl : '';
    if (!url && img && img.style.display !== 'none') url = img.currentSrc || img.src || '';
    if (!url) return;
    ensurePhotoPreview();
    var preview = document.getElementById('modal-student-photo-preview');
    var previewImg = document.getElementById('st-photo-preview-img');
    if (previewImg) {
      previewImg.src = url;
      previewImg.alt = img && img.alt ? img.alt : '';
    }
    if (preview) preview.classList.add('open');
  }

  function closePhotoPreview() {
    var preview = document.getElementById('modal-student-photo-preview');
    var previewImg = document.getElementById('st-photo-preview-img');
    if (preview) preview.classList.remove('open');
    if (previewImg) previewImg.removeAttribute('src');
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'modal-bg';
    wrap.innerHTML =
      '<div class="modal modal--student" id="st-modal-inner">' +
      '<div class="st-modal-hd">' +
      '<div class="st-modal-hd-main">' +
      '<div class="st-avatar st-avatar--empty" id="st-modal-avatar" role="button" tabindex="0" aria-label="ছবি বড় করে দেখুন">' +
      '<img class="st-avatar-img" id="st-modal-avatar-img" alt="" />' +
      '<span class="st-avatar-ph" id="st-modal-avatar-ph">?</span>' +
      '</div>' +
      '<div class="st-modal-texts">' +
      '<h2 id="st-modal-title">ছাত্র</h2>' +
      '<p class="st-modal-sub" id="st-modal-sub"></p>' +
      '</div></div>' +
      '<button type="button" class="modal-close" id="st-modal-close" aria-label="বন্ধ">✕</button>' +
      '</div><div id="st-tabs-wrap"></div></div>';

    wrap.addEventListener('click', function (e) {
      if (e.target.id === MODAL_ID) close();
    });
    var inner = wrap.querySelector('#st-modal-inner');
    if (inner) inner.addEventListener('click', function (e) { e.stopPropagation(); });
    var btn = wrap.querySelector('#st-modal-close');
    if (btn) btn.addEventListener('click', function () { close(); });
    var avatar = wrap.querySelector('#st-modal-avatar');
    if (avatar) {
      avatar.addEventListener('click', openPhotoPreview);
      avatar.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPhotoPreview();
        }
      });
    }

    document.body.appendChild(wrap);
  }

  var _openSid = null;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function logAuthorName() {
    if (typeof global.MMSession === 'undefined' || !global.MMSession) return '—';
    var APIg = getApi();
    if (global.MMSession.getRole() === 'teacher') {
      var t = global.MMSession.hydrateTeacherRecord
        ? global.MMSession.hydrateTeacherRecord()
        : (APIg && APIg.Teachers ? APIg.Teachers.getById(global.MMSession.getTeacherId()) : null);
      if (t && t.name) return t.name;
    }
    var n = global.MMSession.getName && global.MMSession.getName();
    return n && String(n).trim() ? n : 'অ্যাডমিন';
  }

  async function submitStudentLog() {
    var API = getApi();
    var ta = document.getElementById('st-teacher-log-ta');
    var reviewCb = document.getElementById('st-teacher-log-review');
    if (!API || !API.Logs || !_openSid || !ta) return;
    var text = (ta.value || '').trim();
    if (!text) {
      toast('লগের বিষয়বস্তু লিখুন');
      return;
    }
    var reviewRequested = !!(reviewCb && reviewCb.checked);
    API.Logs.add('student', _openSid, text, logAuthorName(), 'normal', { reviewRequested: reviewRequested });
    ta.value = '';
    if (reviewCb) reviewCb.checked = false;
    toast('ছাত্রের লগ সংরক্ষিত');
    open(_openSid);

    if (global.MMSharedAPI && global.MMSession && UUID_RE.test(_openSid)) {
      try {
        var isAdminActor = global.MMSession.isAdmin && global.MMSession.isAdmin();
        var actorId = isAdminActor ? global.MMSession.getAdminUserId() : global.MMSession.getStaffUserId();
        var pin = isAdminActor ? global.MMSession.getAdminPin() : global.MMSession.getStaffPin();
        var res = await global.MMSharedAPI.saveTeacherLog(actorId, pin, 'student', _openSid, text, reviewRequested);
        if (!res || !res.ok) throw new Error((res && res.error) || 'log_failed');
        if (global.MDRSupabaseSync) {
          if (isAdminActor && global.MDRSupabaseSync.syncAdminStudents) {
            await global.MDRSupabaseSync.syncAdminStudents({ force: true });
          } else if (!isAdminActor && global.MDRSupabaseSync.syncTeacherClass) {
            await global.MDRSupabaseSync.syncTeacherClass();
          }
        }
        open(_openSid);
      } catch (e) {
        console.warn('Save teacher log failed', e);
        toast('লোকালি সংরক্ষিত, ডাটাবেজে হয়নি');
      }
    }
  }

  function canChangeStatus() {
    try {
      if (!global.MMSession) return false;
      var role = global.MMSession.getRole && global.MMSession.getRole();
      return role === 'admin' || role === 'daftar';
    } catch (e) {
      return false;
    }
  }

  function statusActor() {
    if (!global.MMSession) return null;
    if (global.MMSession.getRole && global.MMSession.getRole() === 'admin') {
      return {
        id: global.MMSession.getAdminUserId && global.MMSession.getAdminUserId(),
        pin: global.MMSession.getAdminPin && global.MMSession.getAdminPin(),
      };
    }
    return {
      id: global.MMSession.getStaffUserId && global.MMSession.getStaffUserId(),
      pin: global.MMSession.getStaffPin && global.MMSession.getStaffPin(),
    };
  }

  async function submitStatusChange() {
    var API = getApi();
    var reasonEl = document.getElementById('st-status-reason');
    if (!API || !_openSid || !reasonEl) return;
    var s = API.Students.getById(_openSid);
    if (!s) {
      toast('ছাত্র পাওয়া যায়নি');
      return;
    }
    var reason = String(reasonEl.value || '').trim();
    if (!reason) {
      toast('বিদায়ের কারণ লিখুন');
      return;
    }
    if (!confirm('এই ছাত্রকে সক্রিয় তালিকা থেকে সরিয়ে বিদায়/ইনঅ্যাকটিভ করবেন?')) return;

    var previous = { active: s.active, status: s.status, left_date: s.left_date, left_reason: s.left_reason };
    API.Students.markInactive(_openSid, reason, API.today());
    if (global.MMSharedAPI) {
      try {
        var a = statusActor();
        if (a && a.id && a.pin) {
          var res = await global.MMSharedAPI.setStudentStatus(a.id, a.pin, s.supabase_id || s.id, 'dropped', reason);
          if (!res || !res.ok) throw new Error((res && res.error) || 'status_failed');
        }
      } catch (e) {
        API.Students.update(_openSid, previous);
        toast('ডাটাবেজে স্ট্যাটাস সংরক্ষণ হয়নি');
        open(_openSid);
        return;
      }
    }
    toast('ছাত্র ইনঅ্যাকটিভ/বিদায় করা হয়েছে');
    try { global.dispatchEvent(new CustomEvent('mm:student-status-changed', { detail: { student_id: _openSid } })); } catch (e2) {}
    open(_openSid);
  }

  function close() {
    _openSid = null;
    if (global.MMStudentDocuments && global.MMStudentDocuments.invalidate) {
      global.MMStudentDocuments.invalidate();
    }
    closePhotoPreview();
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove('open');
    if (typeof global.closeModal === 'function') {
      try { global.closeModal('student-detail'); } catch (e) { /* ignore */ }
    }
  }

  function switchTab(key) {
    var root = document.getElementById('st-tabs-wrap');
    if (!root) return;
    root.querySelectorAll('.st-tab').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === key;
      btn.classList.toggle('st-tab--on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    root.querySelectorAll('.st-tab-panel').forEach(function (p) {
      p.classList.toggle('st-tab-panel--on', p.getAttribute('data-panel') === key);
    });
    if (key === 'docs' && _openSid) {
      ensureDocumentsModule(function () {
        if (global.MMStudentDocuments && global.MMStudentDocuments.onTabOpen) {
          global.MMStudentDocuments.onTabOpen(_openSid);
        }
      });
    }
  }

  function ensureDocumentsModule(done) {
    if (global.MMStudentDocuments) {
      if (typeof done === 'function') done();
      return;
    }
    if (ensureDocumentsModule._loading) {
      ensureDocumentsModule._queue = ensureDocumentsModule._queue || [];
      if (typeof done === 'function') ensureDocumentsModule._queue.push(done);
      return;
    }
    ensureDocumentsModule._loading = true;
    ensureDocumentsModule._queue = typeof done === 'function' ? [done] : [];
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('mm-student-modal') < 0) continue;
      var base = src.replace(/mm-student-modal\.js(?:\?.*)?$/, '');
      var el = document.createElement('script');
      el.src = base + 'mm-student-documents.js?v=20260705';
      el.async = false;
      el.onload = function () {
        ensureDocumentsModule._loading = false;
        var q = ensureDocumentsModule._queue || [];
        ensureDocumentsModule._queue = [];
        q.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
      };
      el.onerror = function () {
        ensureDocumentsModule._loading = false;
        ensureDocumentsModule._queue = [];
        console.warn('mm-student-documents.js load failed');
      };
      document.head.appendChild(el);
      break;
    }
  }

  function open(sid) {
    var API = getApi();
    if (!API || !API.Students) {
      toast('ডেটা লোড হয়নি');
      return;
    }
    var s = API.Students.getById(sid);
    if (!s) {
      toast('ছাত্র পাওয়া যায়নি');
      return;
    }
    if (API.MMNameLock && !API.MMNameLock.ensure(s)) {
      return;
    }
    _openSid = sid;

    ensureModal();
    ensureDocumentsModule();

    var cls = API.Classes.getById(s.class_id);
    var clsName = cls ? cls.name : '—';
    var deptLbl =
      cls && cls.dept === 'maktab' ? 'মক্তব বিভাগ' : cls && cls.dept === 'kitab' ? 'কিতাব বিভাগ' : '—';
    var stSub = [clsName, s.permanent_id ? 'দাখেলা ' + s.permanent_id : '', s.roll ? 'রোল ' + s.roll : '']
      .filter(Boolean)
      .join(' · ');

    function kv(lbl, val) {
      return (
        '<div class="st-kv-item"><div class="st-kv-lbl">' +
        lbl +
        '</div><div class="st-kv-val">' +
        val +
        '</div></div>'
      );
    }
    var actBg = s.active ? 'var(--green-light);color:var(--green)' : 'var(--cream2);color:var(--ink3)';
    var hasZillaUpazila =
      (s.district != null && String(s.district).trim() !== '') || (s.upazila != null && String(s.upazila).trim() !== '');
    var addressRows = hasZillaUpazila
      ? kv('জেলা', API.esc(s.district || '—')) + kv('উপজেলা', API.esc(s.upazila || '—'))
      : kv('ঠিকানা', API.esc(s.address || '—'));
    var infoBlock =
      '<div class="st-kv-grid">' +
      kv('স্থায়ী দাখেলা', API.escBn(s.permanent_id || '—')) +
      kv('রোল', API.escBn(s.roll || '—')) +
      kv('বর্তমান বর্ষ', API.esc(clsName)) +
      kv('বিভাগ', API.esc(deptLbl)) +
      kv(
        'অবস্থা',
        '<span class="st-kv-val--tag" style="background:' +
          actBg +
          '">' +
          (s.active ? 'সক্রিয়' : 'নিষ্ক্রিয়') +
          '</span>'
      ) +
      kv('অভিভাবক', API.esc(s.guardian || '—')) +
      kv('অভিভাবকের পেশা', API.esc(s.guardian_job || '—')) +
      kv('যোগাযোগ (ফোন)', API.esc(s.phone || '—')) +
      addressRows +
      (s.dept && (s.dept === 'kitab' || s.dept === 'maktab')
        ? kv('রেকর্ড অনুযায়ী বিভাগ', s.dept === 'kitab' ? 'কিতাব' : 'মক্তব')
        : '') +
      '</div>';

    if (s.class_history && s.class_history.length) {
      infoBlock +=
        '<div class="st-block"><h4>বর্ষ পরিবর্তনের ইতিহাস</h4>' +
        s.class_history
          .map(function (h) {
            var fromN = API.Classes.getName(h.from) || h.from;
            var toN = API.Classes.getName(h.to) || h.to;
            return (
              '<div class="st-logline">' +
              API.esc(fromN) +
              ' → ' +
              API.esc(toN) +
              '<small>' +
              API.esc(h.date || '') +
              '</small></div>'
            );
          })
          .join('') +
        '</div>';
    }

    if (Array.isArray(s.program_history) && s.program_history.length) {
      var progHist = s.program_history.slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
      infoBlock +=
        '<div class="st-block"><h4>কর্মসূচিতে অংশগ্রহণ / অবদান</h4>' +
        progHist
          .map(function (h) {
            return (
              '<div class="st-logline"><strong>' +
              API.esc(h.program_name || 'কর্মসূচি') +
              '</strong> · ' +
              API.esc(h.type || 'আয়') +
              ' · ৳' +
              toBn(Number(h.amount || 0).toLocaleString('en-US')) +
              (Number(h.share || 0) > 0 ? ' · হিস্যা ' + toBn(h.share) : '') +
              '<small>' +
              API.esc(h.date || '') +
              (h.ref ? ' · ' + API.esc(h.ref) : '') +
              '</small></div>'
            );
          })
          .join('') +
        '</div>';
    }

    if (typeof global.mmStudentModalExtraInfo === 'function') {
      try {
        var extra = global.mmStudentModalExtraInfo(sid, s);
        if (extra) infoBlock += extra;
      } catch (err) {
        console.warn('mmStudentModalExtraInfo', err);
      }
    }

    if (canChangeStatus() && s.active) {
      infoBlock +=
        '<div class="st-block">' +
        '<h4>স্ট্যাটাস পরিবর্তন</h4>' +
        '<p class="st-note" style="margin:0 0 8px">ছাত্র মাদ্রাসায় আর সক্রিয় না থাকলে এখানে কারণ লিখে ইনঅ্যাকটিভ করুন। এতে হাজিরা/শিক্ষক তালিকা থেকে বাদ যাবে এবং পুরনো ছাত্র তালিকায় যুক্ত হবে।</p>' +
        '<textarea class="form-input" id="st-status-reason" rows="3" placeholder="বিদায়ের কারণ লিখুন..." style="width:100%;box-sizing:border-box;font-size:13px;resize:vertical"></textarea>' +
        '<button type="button" class="submit-btn" style="margin-top:10px;padding:11px 16px;font-size:13px;width:100%;background:var(--red,#c1440e);color:#fff" onclick="MMStudentModal.submitStatusChange()">ইনঅ্যাকটিভ / বিদায় করুন</button>' +
        '</div>';
    } else if (!s.active) {
      infoBlock +=
        '<div class="st-block">' +
        '<h4>বিদায় তথ্য</h4>' +
        '<div class="st-logline">' + API.esc(s.left_reason || 'কারণ সংরক্ষিত নেই') +
        '<small>' + API.esc(s.left_date || '') + '</small></div>' +
        '</div>';
    }

    var attPanel = buildAttendancePanel(API, sid);

    var feeRows = API.Fees.getByClass(s.class_id);
    var wajPanel;
    if (!feeRows || !feeRows.length) {
      wajPanel =
        '<div class="st-empty">এই বর্ষের জন্য কোনো ওয়াযিফা সারসংক্ষেপ পাওয়া যায়নি।<br><span class="st-note" style="display:inline-block;margin-top:6px">সারসংক্ষেপ বর্ষভিত্তিক; এটি দেখাতে বর্ষে অন্তত এক মাসের এন্টি থাকতে হবে।</span></div>';
    } else {
      wajPanel = feeRows
        .map(function (f) {
          var unpaid = f.unpaid != null ? f.unpaid : f.total - f.paid;
          return (
            '<div class="st-fee-line"><div class="st-fee-mo">' +
            API.esc(f.month) +
            '</div>' +
            '<div>মোট <strong>' +
            toBn(f.total) +
            '</strong> · আদায় <strong style="color:var(--green)">' +
            toBn(f.paid) +
            '</strong> · বাকি <strong style="color:var(--red)">' +
            toBn(unpaid) +
            '</strong>' +
            (f.arrear ? ' · বকেয়া ৳' + toBn(f.arrear) : '') +
            '</div>' +
            (f.note ? '<div class="st-note">' + API.esc(f.note) + '</div>' : '') +
            '</div>'
          );
        })
        .join('');
    }

    var khList = API.Khuluk.getByStudent(sid);
    var examMap = new Map(API.Exams.getAll().map(function (e) { return [e.id, e]; }));
    var resList = API.Exams.getStudentResults(sid);
    var logList = API.Logs.getByStudent(sid).slice(0, 12);
    var fetchingFreshAkhlaq = false;
    var UUID_RE_MODAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (UUID_RE_MODAL.test(sid) && global.MMSharedAPI && global.MMSharedAPI.getStudentAkhlaq && global.MMSession) {
      var _actorId = global.MMSession.getId && global.MMSession.getId();
      var _pin = global.MMSession.getPin && global.MMSession.getPin();
      if (_actorId && _pin) fetchingFreshAkhlaq = true;
    }

    var canAddStudentLog = false;
    try {
      if (typeof global.MMSession !== 'undefined' && global.MMSession && API.Teachers) {
        var role = global.MMSession.getRole();
        if (role === 'admin') canAddStudentLog = true;
        else if (role === 'teacher') {
          var mteach = global.MMSession.hydrateTeacherRecord
            ? global.MMSession.hydrateTeacherRecord()
            : API.Teachers.getById(global.MMSession.getTeacherId());
          canAddStudentLog = !!(mteach && mteach.class_id === s.class_id);
        }
      }
    } catch (e2) { /* ignore */ }

    var more = '';
    if (canAddStudentLog) {
      var isAdminRole = false;
      try { isAdminRole = !!(global.MMSession && global.MMSession.isAdmin && global.MMSession.isAdmin()); } catch (e3) { isAdminRole = false; }
      more +=
        '<div class="st-block st-teacher-log-add">' +
        '<h4>ছাত্রের জন্য নতুন লগ</h4>' +
        '<p class="st-note" style="margin:0 0 8px">বর্ষের সাধারণ লগ বর্ষ ট্যাব থেকে; এটি শুধু এই ছাত্রের নোট (পুরনো অ্যাপের মতো)।</p>' +
        '<textarea class="form-input" id="st-teacher-log-ta" rows="3" placeholder="পর্যবেক্ষণ, আচরণ, বিশেষ ঘটনা…" style="width:100%;box-sizing:border-box;font-size:13px;resize:vertical"></textarea>' +
        (isAdminRole ? '' :
          '<label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--ink2);">' +
          '<input type="checkbox" id="st-teacher-log-review"> রিভিউর জন্য পাঠান (জিম্মাদারের নজরে আনুন)</label>') +
        '<button type="button" class="submit-btn" style="margin-top:10px;padding:11px 16px;font-size:13px;width:100%" onclick="MMStudentModal.submitStudentLog()">লগ সংরক্ষণ</button>' +
        '</div>';
    }
    more += '<div id="st-khuluk-section">';
    if (khList.length) {
      more +=
        '<h4>হুসনুল খুলুক</h4>' +
        khList
          .map(function (k) {
            return (
              '<div class="st-logline"><strong>' +
              toBn(k.score) +
              '</strong> — ' +
              API.esc(k.reason || '') +
              '<small>' +
              API.esc(k.date) +
              (k.by ? ' · ' + API.esc(k.by) : '') +
              '</small></div>'
            );
          })
          .join('');
    } else if (fetchingFreshAkhlaq) {
      more += '<div class="st-note" style="color:var(--ink3);font-size:12px;padding:4px 0;">হুসনুল খুলুক লোড হচ্ছে…</div>';
    }
    more += '</div>';
    if (resList.length) {
      more +=
        '<div class="st-block" style="margin-top:0;border-top:none;padding-top:0"><h4>পরীক্ষার ফল</h4>' +
        resList
          .map(function (r) {
            var ex = examMap.get(r.exam_id);
            var en = ex && ex.name ? ex.name : 'পরীক্ষা';
            return (
              '<div class="st-logline"><strong>' +
              API.esc(en) +
              '</strong> · মোট ' +
              toBn(r.total) +
              ' / ' +
              toBn(r.max_total) +
              ' (' +
              (r.percentage != null ? r.percentage + '%' : '—') +
              ')' +
              (r.grade ? ' · ' + API.esc(r.grade) : '') +
              '<small>' +
              API.esc(r.date || '') +
              '</small></div>'
            );
          })
          .join('') +
        '</div>';
    }
    if (logList.length) {
      more +=
        '<div class="st-block"><h4>লগ ও নোট</h4>' +
        logList
          .map(function (L) {
            var statusPill = '';
            if (L.reviewRequested) {
              statusPill = L.reviewedAt
                ? ' <span class="st-log-reviewed" style="color:var(--green);font-weight:600;">রিভিউড ✓' + (L.reviewedByName ? ' · ' + API.esc(L.reviewedByName) : '') + '</span>'
                : ' <span class="st-log-pending" style="color:var(--gold);font-weight:600;">রিভিউ বাকি</span>';
            }
            var replyLine = L.adminReply
              ? '<div class="st-log-reply" style="margin-top:4px;font-size:12px;color:var(--ink2);">জিম্মাদারের মন্তব্য: ' + API.esc(L.adminReply) + '</div>'
              : '';
            return (
              '<div class="st-logline">' +
              API.esc(L.text) +
              '<small>' +
              API.esc(L.date) +
              (L.by ? ' · ' + API.esc(L.by) : '') +
              statusPill +
              '</small>' +
              replyLine +
              '</div>'
            );
          })
          .join('') +
        '</div>';
    }
    if (!more) {
      more = '<div class="st-empty">হুসনুল খুলুক রেকর্ড, পরীক্ষার ফল বা পৃথক লগ পাওয়া যায়নি।</div>';
    }

    var titleEl = document.getElementById('st-modal-title');
    var subEl = document.getElementById('st-modal-sub');
    if (titleEl) titleEl.textContent = s.name || 'ছাত্র';
    if (subEl) subEl.textContent = stSub || '—';
    setAvatar(s);

    var escTab = "switchStudentTab";
    if (global.MMStudentModal && global.MMStudentModal.switchTab) {
      escTab = 'MMStudentModal.switchTab';
    }
    var tabs = document.getElementById('st-tabs-wrap');
    if (tabs) {
      tabs.innerHTML =
        '<div class="st-tabs" role="tablist">' +
        '<button type="button" class="st-tab st-tab--on" data-tab="info" role="tab" aria-selected="true" onclick="' +
        escTab +
        '(\'info\')">সম্পূর্ণ তথ্য</button>' +
        '<button type="button" class="st-tab" data-tab="att" role="tab" aria-selected="false" onclick="' +
        escTab +
        '(\'att\')">হাজিরা</button>' +
        '<button type="button" class="st-tab" data-tab="waj" role="tab" aria-selected="false" onclick="' +
        escTab +
        '(\'waj\')">ওয়াযিফা</button>' +
        '<button type="button" class="st-tab" data-tab="docs" role="tab" aria-selected="false" onclick="' +
        escTab +
        '(\'docs\')">ডকুমেন্ট</button>' +
        '<button type="button" class="st-tab" data-tab="more" role="tab" aria-selected="false" onclick="' +
        escTab +
        '(\'more\')">মূল্যায়ন</button>' +
        '</div><div class="st-tab-panels">' +
        '<div class="st-tab-panel st-tab-panel--on" data-panel="info" id="st-panel-info">' +
        infoBlock +
        '</div>' +
        '<div class="st-tab-panel" data-panel="att" id="st-panel-att">' +
        attPanel +
        '</div>' +
        '<div class="st-tab-panel" data-panel="waj" id="st-panel-waj">' +
        wajPanel +
        '</div>' +
        '<div class="st-tab-panel" data-panel="docs" id="st-panel-docs">' +
        '<div class="st-note" style="padding:8px 0;">ডকুমেন্ট ট্যাব খুললে তালিকা লোড হবে।</div>' +
        '</div>' +
        '<div class="st-tab-panel" data-panel="more" id="st-panel-more">' +
        more +
        '</div></div>';
    }

    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('open');

    // Fetch fresh akhlaq from DB and update the section — bypasses localStorage cache.
    if (fetchingFreshAkhlaq) {
      var _freshActorId = global.MMSession.getId();
      var _freshPin = global.MMSession.getPin();
      global.MMSharedAPI.getStudentAkhlaq(_freshActorId, _freshPin, sid).then(function (res) {
        if (!res || !res.ok) return;
        var section = document.getElementById('st-khuluk-section');
        if (!section) return;
        var list = res.akhlaq || [];
        if (!list.length) { section.innerHTML = ''; return; }
        section.innerHTML =
          '<h4>হুসনুল খুলুক</h4>' +
          list.map(function (k) {
            return (
              '<div class="st-logline"><strong>' +
              toBn(Number(k.score)) +
              '</strong> — ' +
              API.esc(k.reason || '') +
              '<small>' +
              API.esc(String(k.date || '')) +
              (k.by ? ' · ' + API.esc(k.by) : '') +
              '</small></div>'
            );
          }).join('');

        // In-memory cache update — page session-এ পরের open দ্রুত হয়।
        try {
          if (API.persistSaveArr) {
            var cached = (API.persistLoadArr ? API.persistLoadArr('mm_khuluk') : []).filter(function (x) {
              return String(x.student_id) !== String(sid);
            });
            var fresh = list.map(function (k) {
              return {
                id: String(k.id),
                student_id: String(sid),
                score: Number(k.score),
                reason: k.reason || '',
                date: String(k.date || ''),
                at: String(k.at || k.evaluated_at || k.created_at || k.date || ''),
                by: k.by || ''
              };
            });
            API.persistSaveArr('mm_khuluk', cached.concat(fresh));
          }
        } catch (e2) { /* ignore cache update failures */ }
      }).catch(function () {});
    }
  }

  global.MMStudentModal = { open: open, close: close, switchTab: switchTab, submitStudentLog: submitStudentLog, submitStatusChange: submitStatusChange, openPhotoPreview: openPhotoPreview };
  global.switchStudentTab = switchTab;
  global.openStudentDetail = function (sid) {
    return open(sid);
  };
})(typeof window !== 'undefined' ? window : this);
