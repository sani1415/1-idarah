/**
 * জিম্মাদার — শিক্ষক হাজিরা: আজকের বোর্ড, মাসিক রিপোর্ট, দরস শিক্ষক, ছুটি।
 */
(function (global) {
  'use strict';

  var H = global.MDRHazira;
  var S = global.MMSession;
  var API = global.MMSharedAPI;
  var doc = global.document;
  var esc = H.esc;
  var toBn = H.toBn;

  var state = {
    boot: null,
    tab: 'today',
    dept: 'all',
    board: null,
    boardDate: '',
    boardLoading: false,
    report: null,
    reportMonth: '',
    reportClass: '',
    reportMode: 'class',
    reportLoading: false,
    sheet: null,
    saving: false,
  };
  var clock = new H.ServerClock(null);
  var toastTimer = null;

  function $(id) { return doc.getElementById(id); }

  function actor() {
    return { id: S.getAdminUserId && S.getAdminUserId(), pin: S.getAdminPin && S.getAdminPin() };
  }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function minToTime(min) {
    if (min == null || isNaN(min)) return '';
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }
  function timeToMin(v) {
    var m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function today() { return state.boot ? String(state.boot.today).slice(0, 10) : clock.dhakaParts().date; }
  function monthRange(ym) {
    var p = String(ym).split('-');
    var y = parseInt(p[0], 10);
    var mo = parseInt(p[1], 10);
    var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { from: ym + '-01', to: ym + '-' + pad2(last) };
  }

  // ── বিভাগ ও বর্ষ ────────────────────────────────────────────────────

  function allowedDepts() {
    var fromServer = state.boot && Array.isArray(state.boot.depts) ? state.boot.depts : null;
    return fromServer || S.getAllowedMadrasaDepts();
  }

  function deptLabel(d) { return d === 'maktab' ? 'মক্তব' : 'কিতাব'; }

  function classes() {
    var list = (state.boot && state.boot.classes) || [];
    if (state.dept === 'all') return list;
    return list.filter(function (c) { return c.division_code === state.dept; });
  }

  function classById(id) {
    var list = (state.boot && state.boot.classes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function inDept(divisionCode) {
    return state.dept === 'all' || divisionCode === state.dept;
  }

  function renderDeptFilters() {
    var el = $('hz-dept-filters');
    var depts = allowedDepts();
    if (!el) return;
    if (state.tab === 'holidays' || depts.length <= 1) {
      el.innerHTML = '';
      el.style.display = 'none';
      if (depts.length === 1) state.dept = depts[0];
      return;
    }
    el.style.display = '';
    var opts = [{ k: 'all', t: 'সব বিভাগ' }].concat(depts.map(function (d) { return { k: d, t: deptLabel(d) + ' বিভাগ' }; }));
    el.innerHTML = opts.map(function (o) {
      return '<button type="button" class="hz-filter' + (state.dept === o.k ? ' is-on' : '') + '" data-dept="' + o.k + '">' + esc(o.t) + '</button>';
    }).join('');
  }

  // ── অবস্থা লেবেল ────────────────────────────────────────────────────

  function statusInfo(sl, st) {
    var s = sl.session || {};
    var late = Number(s.late_min) || 0;
    var fixed = s.corrected ? ' · সংশোধিত' : '';
    switch (st) {
      case 'done':
        return {
          dot: late ? 'late' : 'done',
          label: late ? H.mins(late) + ' দেরি' : 'সময়মতো',
          cls: late ? 'hz-warn' : 'hz-ok',
          info: H.hm(s.started_min) + '–' + H.hm(s.ended_min) + ' · ' + H.mins(H.durationMin(sl)) +
            (s.end_kind === 'next' ? ' · পরের দরসে বন্ধ' : '') + fixed,
        };
      case 'live':
        return {
          dot: 'live', label: 'চলছে', cls: 'hz-warn',
          info: 'শুরু ' + H.hm(s.started_min) + (late ? ' · ' + H.mins(late) + ' দেরিতে' : '') + fixed,
        };
      case 'auto':
        return { dot: 'bad', label: 'অটো-বন্ধ', cls: 'hz-bad', info: 'শুরু ' + H.hm(s.started_min) + ' · শেষ চাপা হয়নি' + fixed };
      case 'missed':
        return { dot: 'bad', label: 'অনুপস্থিত', cls: 'hz-bad', info: 'নিজাম ' + H.hm(sl.start_min) + ' · শুরু হয়নি' };
      case 'late':
        return { dot: 'late', label: 'দেরি হচ্ছে', cls: 'hz-warn', info: 'নিজাম ' + H.hm(sl.start_min) + ' · এখনো শুরু হয়নি' };
      case 'ready':
        return { dot: '', label: 'সময় হয়েছে', cls: '', info: 'নিজাম ' + H.hm(sl.start_min) };
      case 'upcoming':
        return { dot: '', label: 'আসন্ন', cls: 'hz-muted', info: 'নিজাম ' + H.hm(sl.start_min) };
      case 'holiday':
        return { dot: '', label: 'ছুটি', cls: 'hz-muted', info: '' };
      default:
        return { dot: '', label: '—', cls: 'hz-muted', info: '' };
    }
  }

  function canFix(st) { return st === 'done' || st === 'auto' || st === 'missed'; }

  // ── আজকের বোর্ড ─────────────────────────────────────────────────────

  async function loadBoard() {
    if (state.boardLoading) return;
    state.boardLoading = true;
    try {
      var a = actor();
      var res = await API.darsAdminBoard(a.id, a.pin, state.boardDate || null);
      if (!res || !res.ok) throw new Error((res && res.error) || 'board_failed');
      state.board = res;
      clock.sync(res.server_now);
    } catch (e) {
      console.warn('[hazira-admin] board failed', e);
      if (!state.board) toast(H.errorText(e && e.message));
    } finally {
      state.boardLoading = false;
      if (state.tab === 'today') renderPanel();
    }
  }

  function boardNow() {
    var b = state.board;
    var p = clock.dhakaParts();
    var isToday = !!b && String(b.date).slice(0, 10) === p.date;
    return { min: p.min, isToday: isToday };
  }

  function slotRow(c, sl, st, withClass) {
    var info = statusInfo(sl, st);
    var fixBtn = canFix(st)
      ? '<button type="button" class="hz-fix' + (st === 'done' ? ' soft' : '') + '" data-fix="' + esc(c.id) + '|' + esc(String(sl.start_min)) + '">' +
          (st === 'done' ? 'সংশোধন' : 'যাচাই') + '</button>'
      : '';
    return (
      '<div class="hz-row">' +
        '<span class="hz-dot ' + info.dot + '"></span>' +
        '<div class="hz-row-main"><b>' + (withClass ? esc(c.name) + ' · ' : '') + esc(sl.label) + '</b>' +
          '<span>' + esc(sl.teacher_name || '—') + (info.info ? ' · ' + esc(info.info) : '') +
          (sl.session && sl.session.fix_reason ? ' · কারণ: ' + esc(sl.session.fix_reason) : '') + '</span></div>' +
        '<span class="hz-row-st ' + info.cls + '">' + esc(info.label) + '</span>' +
        fixBtn +
      '</div>'
    );
  }

  function renderToday() {
    var html = '<div class="hz-toolbar">' +
      '<div><label for="hz-board-date">তারিখ</label><input class="form-input" type="date" id="hz-board-date" max="' + esc(today()) + '" value="' + esc(state.boardDate || today()) + '"></div>' +
      '<button type="button" class="hz-fix soft hz-print-btn" data-act="refresh-board">রিফ্রেশ</button>' +
    '</div>';
    var b = state.board;
    if (!b) return html + '<div class="hz-empty">' + (state.boardLoading ? 'লোড হচ্ছে…' : 'বোর্ড লোড হয়নি') + '</div>';

    var n = boardNow();
    var list = (b.classes || []).filter(function (c) { return inDept(c.division_code); });
    var m = { live: 0, ok: 0, late: 0, pending: 0 };
    var pending = [];
    var classHtml = '';
    list.forEach(function (c) {
      var slots = Array.isArray(c.slots) ? c.slots : [];
      var rows = '';
      slots.forEach(function (sl) {
        var st = H.liveStatus(sl, n.min, n.isToday);
        if (st === 'live') m.live++;
        if (st === 'done' && !(Number(sl.session && sl.session.late_min) > 0)) m.ok++;
        if (st === 'late' || (sl.session && Number(sl.session.late_min) > 0)) m.late++;
        if (st === 'auto' || st === 'missed') { m.pending++; pending.push({ c: c, sl: sl, st: st }); }
        rows += slotRow(c, sl, st, false);
      });
      var sub = esc(c.lead_name || 'দায়িত্বশীল নেই') + (state.dept === 'all' && allowedDepts().length > 1 ? ' · ' + deptLabel(c.division_code) : '');
      classHtml += '<div class="hz-class-h">' + esc(c.name) + '<span>' + sub + '</span></div>';
      if (c.holiday) classHtml += '<div class="hz-empty">ছুটি — ' + esc(c.holiday) + '</div>';
      else if (!slots.length) classHtml += '<div class="hz-empty">নিজামে কোনো দরসে শিক্ষক বাছাই করা নেই</div>';
      else classHtml += rows;
    });

    html += '<div class="hz-metrics">' +
      '<div class="hz-metric"><b>' + toBn(m.live) + '</b><span>এখন চলছে</span></div>' +
      '<div class="hz-metric"><b class="hz-ok">' + toBn(m.ok) + '</b><span>সময়মতো শেষ</span></div>' +
      '<div class="hz-metric"><b class="hz-warn">' + toBn(m.late) + '</b><span>দেরি</span></div>' +
      '<div class="hz-metric"><b class="hz-bad">' + toBn(m.pending) + '</b><span>যাচাই বাকি</span></div>' +
    '</div>';

    if (pending.length) {
      html += '<div class="hz-sec-h"><h3>যাচাই বাকি</h3><span>অটো-বন্ধ বা শুরু হয়নি — সময় ঠিক করে কারণ লিখুন</span></div>';
      html += pending.map(function (p) { return slotRow(p.c, p.sl, p.st, true); }).join('');
    }
    html += '<div class="hz-sec-h"><h3>বর্ষভিত্তিক</h3><span>' + esc(H.dateLabel(b.date)) + '</span></div>';
    html += classHtml || '<div class="hz-empty">এ বিভাগে কোনো বর্ষ নেই।</div>';
    return html;
  }

  function findBoardSlot(classId, startMin) {
    var c = ((state.board && state.board.classes) || []).find(function (x) { return x.id === classId; });
    if (!c) return null;
    var sl = (c.slots || []).find(function (x) { return Number(x.start_min) === Number(startMin); });
    return sl ? { c: c, sl: sl } : null;
  }

  function openFix(classId, startMin) {
    var hit = findBoardSlot(classId, startMin);
    if (!hit) return;
    var sl = hit.sl;
    var s = sl.session || {};
    var startV = s.started_min != null ? s.started_min : sl.start_min;
    var endV = s.ended_min != null ? s.ended_min : sl.end_min;
    state.sheet = { kind: 'fix', classId: classId, date: String(state.board.date).slice(0, 10), startMin: sl.start_min };
    openSheet(
      '<h3>সময় সংশোধন</h3>' +
      '<p>' + esc(hit.c.name) + ' · ' + esc(sl.label) + ' · ' + esc(sl.teacher_name || '') +
        '<br>নিজাম ' + esc(H.hm(sl.start_min)) + '–' + esc(H.hm(sl.end_min)) + ' · ' + esc(H.shortDate(state.sheet.date)) + '</p>' +
      '<div class="hz-inline hz-field">' +
        '<div><label for="hz-fix-start">শুরু</label><input class="form-input" type="time" id="hz-fix-start" value="' + esc(minToTime(startV)) + '"></div>' +
        '<div><label for="hz-fix-end">শেষ</label><input class="form-input" type="time" id="hz-fix-end" value="' + esc(minToTime(endV)) + '"></div>' +
      '</div>' +
      '<div class="hz-field"><label for="hz-fix-reason">কারণ (অবশ্যই)</label>' +
        '<input class="form-input" type="text" id="hz-fix-reason" maxlength="300" placeholder="যেমন: শিক্ষক শেষ চাপতে ভুলে গেছেন, নিজে জানিয়েছেন"></div>' +
      '<p>সংশোধন রেকর্ডে থাকবে — রিপোর্টে «সংশোধিত» দেখাবে।</p>' +
      '<div class="hz-sheet-actions">' +
        '<button type="button" class="hz-btn-ghost" data-s="close">বাতিল</button>' +
        '<button type="button" class="hz-btn-main" data-s="save-fix">সংরক্ষণ</button>' +
      '</div>'
    );
  }

  async function saveFix() {
    var ctx = state.sheet;
    var st = timeToMin(($('hz-fix-start') || {}).value);
    var en = timeToMin(($('hz-fix-end') || {}).value);
    var reason = String(($('hz-fix-reason') || {}).value || '').trim();
    if (st == null || en == null) { toast('শুরু ও শেষের সময় দিন'); return; }
    if (en <= st) { toast('শেষের সময় শুরুর পরে হতে হবে'); return; }
    if (!reason) { toast('সংশোধনের কারণ লিখুন'); return; }
    await withSaving(async function () {
      var a = actor();
      var res = await API.darsAdminFix(a.id, a.pin, ctx.classId, ctx.date, ctx.startMin, st, en, reason);
      if (!res || !res.ok) { toast(H.errorText(res && res.error)); return; }
      closeSheet();
      toast('সংশোধন সংরক্ষিত');
      await loadBoard();
    });
  }

  // ── রিপোর্ট ────────────────────────────────────────────────────────

  async function loadReport() {
    if (state.reportLoading) return;
    state.reportLoading = true;
    renderPanel();
    try {
      var r = monthRange(state.reportMonth);
      var a = actor();
      var res = await API.darsAdminReport(a.id, a.pin, state.reportClass || null, r.from, r.to);
      if (!res || !res.ok) throw new Error((res && res.error) || 'report_failed');
      state.report = res;
    } catch (e) {
      console.warn('[hazira-admin] report failed', e);
      state.report = null;
      toast(H.errorText(e && e.message));
    } finally {
      state.reportLoading = false;
      if (state.tab === 'report') renderPanel();
    }
  }

  function reportStatus(sl, dayIso, rep) {
    var isToday = dayIso === String(rep.today).slice(0, 10);
    return H.liveStatus(sl, clock.dhakaParts().min, isToday);
  }

  function counted(st) { return st === 'done' || st === 'live' || st === 'auto' || st === 'missed'; }

  function reportRows(rep) {
    var rows = [];
    (rep.days || []).forEach(function (d) {
      var dayIso = String(d.date).slice(0, 10);
      (d.classes || []).forEach(function (c) {
        if (!inDept(c.division_code)) return;
        if (c.holiday) { rows.push({ day: dayIso, c: c, holiday: c.holiday }); return; }
        (c.slots || []).forEach(function (sl) {
          var st = reportStatus(sl, dayIso, rep);
          if (st === 'untracked') return;
          rows.push({ day: dayIso, c: c, sl: sl, st: st });
        });
      });
    });
    return rows;
  }

  function summarize(rows) {
    var t = { planned: 0, ok: 0, late: 0, missed: 0, auto: 0, minutes: 0 };
    rows.forEach(function (r) {
      if (!r.sl || !counted(r.st)) return;
      var late = Number(r.sl.session && r.sl.session.late_min) || 0;
      t.planned++;
      if (r.st === 'done' && !late) t.ok++;
      if (r.sl.session && late) t.late++;
      if (r.st === 'missed') t.missed++;
      if (r.st === 'auto') t.auto++;
      if (r.st === 'done') t.minutes += H.durationMin(r.sl);
    });
    return t;
  }

  function renderReport() {
    if (!state.reportMonth) state.reportMonth = today().slice(0, 7);
    var clsOpts = '<option value="">সব বর্ষ</option>' + classes().map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (state.reportClass === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    var html = '<div class="hz-toolbar hz-no-print">' +
      '<div><label for="hz-rep-month">মাস</label><input class="form-input" type="month" id="hz-rep-month" max="' + esc(today().slice(0, 7)) + '" value="' + esc(state.reportMonth) + '"></div>' +
      '<div><label for="hz-rep-class">বর্ষ</label><select class="form-input form-select" id="hz-rep-class">' + clsOpts + '</select></div>' +
      '<button type="button" class="hz-fix soft hz-print-btn" data-act="print">প্রিন্ট</button>' +
    '</div>' +
    '<div class="hz-filters hz-no-print">' +
      '<button type="button" class="hz-filter' + (state.reportMode === 'class' ? ' is-on' : '') + '" data-mode="class">বর্ষভিত্তিক</button>' +
      '<button type="button" class="hz-filter' + (state.reportMode === 'teacher' ? ' is-on' : '') + '" data-mode="teacher">শিক্ষকভিত্তিক</button>' +
    '</div>';

    if (state.reportLoading) return html + '<div class="hz-empty">রিপোর্ট তৈরি হচ্ছে…</div>';
    var rep = state.report;
    if (!rep) return html + '<div class="hz-empty">রিপোর্ট লোড হয়নি।</div>';

    var rows = reportRows(rep);
    var sum = summarize(rows);
    html += '<div class="hz-sec-h"><h3>' + esc(H.shortDate(rep.from)) + ' – ' + esc(H.shortDate(rep.to)) + '</h3>' +
      '<span>' + (state.reportClass ? esc((classById(state.reportClass) || {}).name || '') : 'সব বর্ষ') + '</span></div>';
    html += '<div class="hz-metrics">' +
      '<div class="hz-metric"><b>' + toBn(sum.planned) + '</b><span>নির্ধারিত দরস</span></div>' +
      '<div class="hz-metric"><b class="hz-ok">' + toBn(sum.ok) + '</b><span>সময়মতো</span></div>' +
      '<div class="hz-metric"><b class="hz-warn">' + toBn(sum.late) + '</b><span>দেরি</span></div>' +
      '<div class="hz-metric"><b class="hz-bad">' + toBn(sum.missed + sum.auto) + '</b><span>অনুপস্থিত / অটো</span></div>' +
    '</div>';

    if (!rows.length) {
      return html + '<div class="hz-empty">এই সময়ে কোনো হাজিরার রেকর্ড নেই। (কিয়স্ক প্রথম ব্যবহারের দিন থেকে হিসাব শুরু হয়।)</div>';
    }
    return html + (state.reportMode === 'teacher' ? teacherTable(rows) : classTable(rows));
  }

  function classTable(rows) {
    var multi = !state.reportClass;
    var body = '';
    var lastDay = '';
    rows.forEach(function (r) {
      if (r.day !== lastDay) {
        lastDay = r.day;
        body += '<tr class="day-h"><td colspan="4">' + esc(H.dateLabel(r.day)) + '</td></tr>';
      }
      if (r.holiday) {
        body += '<tr><td colspan="4">' + (multi ? esc(r.c.name) + ' · ' : '') + '<span class="hz-muted">ছুটি — ' + esc(r.holiday) + '</span></td></tr>';
        return;
      }
      var info = statusInfo(r.sl, r.st);
      var s = r.sl.session || {};
      body += '<tr>' +
        '<td>' + esc(r.sl.label) + '<small>' + (multi ? esc(r.c.name) + ' · ' : '') + esc(r.sl.teacher_name || '') + '</small></td>' +
        '<td>' + esc(H.hm(r.sl.start_min)) + '–' + esc(H.hm(r.sl.end_min)) + '</td>' +
        '<td>' + (s.started_min != null ? esc(H.hm(s.started_min)) : '—') + '–' + (s.ended_min != null ? esc(H.hm(s.ended_min)) : '—') +
          (s.corrected ? '<small>সংশোধিত' + (s.fix_reason ? ': ' + esc(s.fix_reason) : '') + '</small>' : '') + '</td>' +
        '<td class="' + info.cls + '">' + esc(info.label) + '</td>' +
      '</tr>';
    });
    return '<div class="hz-tbl-wrap"><table class="hz-tbl"><thead><tr><th>দরস</th><th>নিজাম</th><th>শুরু–শেষ</th><th>অবস্থা</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function teacherTable(rows) {
    var map = {};
    var order = [];
    rows.forEach(function (r) {
      if (!r.sl || !counted(r.st)) return;
      var key = (r.sl.teacher_kind || 'x') + ':' + (r.sl.teacher_id || r.sl.teacher_name || '');
      if (!map[key]) {
        map[key] = { name: r.sl.teacher_name || '—', classes: {}, rows: [] };
        order.push(key);
      }
      map[key].classes[r.c.name] = true;
      map[key].rows.push(r);
    });
    var body = order.map(function (k) {
      var t = map[k];
      var s = summarize(t.rows);
      return '<tr>' +
        '<td>' + esc(t.name) + '<small>' + esc(Object.keys(t.classes).join(', ')) + '</small></td>' +
        '<td>' + toBn(s.planned) + '</td>' +
        '<td class="hz-ok">' + toBn(s.ok) + '</td>' +
        '<td class="hz-warn">' + toBn(s.late) + '</td>' +
        '<td class="hz-bad">' + toBn(s.missed) + '</td>' +
        '<td class="hz-bad">' + toBn(s.auto) + '</td>' +
        '<td>' + esc(H.mins(s.minutes)) + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="hz-tbl-wrap"><table class="hz-tbl"><thead><tr><th>শিক্ষক</th><th>নির্ধারিত</th><th>সময়মতো</th><th>দেরি</th><th>অনুপস্থিত</th><th>অটো-বন্ধ</th><th>মোট সময়</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="hz-muted">কোনো রেকর্ড নেই</td></tr>') + '</tbody></table></div>';
  }

  // ── দরস শিক্ষক ─────────────────────────────────────────────────────

  function teacherVisible(t) {
    var ids = Array.isArray(t.class_ids) ? t.class_ids : [];
    if (!ids.length) return true;
    return ids.some(function (id) {
      var c = classById(id);
      return c && inDept(c.division_code);
    });
  }

  function renderTeachers() {
    var boot = state.boot;
    var list = ((boot && boot.teachers) || []).filter(teacherVisible);
    var html = '<div class="hz-panel">' +
      '<div class="hz-panel-h">দরস শিক্ষক<button type="button" class="hz-fix soft" data-act="new-teacher">+ নতুন শিক্ষক</button></div>' +
      '<p class="hz-muted">যেসব বর্ষে একাধিক শিক্ষক দরস দেন, অন্য শিক্ষকদের এখানে যোগ করুন। তাঁদের কোনো লগইন নেই — শুধু ৪ অঙ্কের হাজিরা পিন। এরপর বর্ষ দায়িত্বশীল নিজামে প্রতিটি দরসে শিক্ষক বাছাই করবেন।</p>';
    if (!list.length) {
      html += '<div class="hz-muted" style="padding:10px 0;">এখনো কোনো দরস শিক্ষক যোগ করা হয়নি।</div>';
    } else {
      html += list.map(function (t) {
        var names = (t.class_ids || []).map(function (id) { var c = classById(id); return c ? c.name : ''; }).filter(Boolean);
        return '<div class="hz-t-row">' +
          '<div class="hz-t-av">' + esc(H.initials(t.name)) + '</div>' +
          '<div class="hz-t-main"><div class="hz-t-name">' + esc(t.name) + (t.is_active ? '' : ' <span class="hz-muted">(নিষ্ক্রিয়)</span>') + '</div>' +
            '<div class="hz-t-meta">' + esc(names.join(', ') || 'কোনো বর্ষে যুক্ত নেই') + '</div></div>' +
          '<button type="button" class="hz-fix soft" data-edit-teacher="' + esc(t.id) + '">সম্পাদনা</button>' +
        '</div>';
      }).join('');
    }
    html += '</div>';

    html += '<div class="hz-panel"><div class="hz-panel-h">বর্ষ দায়িত্বশীল</div>' +
      '<p class="hz-muted">দায়িত্বশীলের হাজিরা পিন তাঁর লগইন পিনই। দায়িত্বশীল বদলাতে «শিক্ষক» সেটিং ব্যবহার করুন।</p>' +
      classes().map(function (c) {
        return '<div class="hz-hol-row"><span>' + esc(c.name) + '</span><em>' + esc(c.lead_name || 'নির্ধারিত নেই') + '</em></div>';
      }).join('') +
    '</div>';
    return html;
  }

  function openTeacher(id) {
    var t = null;
    if (id) t = ((state.boot && state.boot.teachers) || []).find(function (x) { return x.id === id; }) || null;
    state.sheet = { kind: 'teacher', id: t ? t.id : null };
    var owned = t ? (t.class_ids || []) : [];
    var checks = ((state.boot && state.boot.classes) || []).map(function (c) {
      return '<label><input type="checkbox" class="hz-t-class" value="' + esc(c.id) + '"' + (owned.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
    }).join('');
    openSheet(
      '<h3>' + (t ? 'শিক্ষক সম্পাদনা' : 'নতুন দরস শিক্ষক') + '</h3>' +
      '<div class="hz-field"><label for="hz-t-name">নাম</label><input class="form-input" type="text" id="hz-t-name" maxlength="120" value="' + esc(t ? t.name : '') + '" placeholder="যেমন: মাওলানা আব্দুল্লাহ"></div>' +
      '<div class="hz-field"><label for="hz-t-pin">হাজিরা পিন (৪ অঙ্ক)' + (t ? ' — খালি রাখলে আগেরটাই থাকবে' : '') + '</label>' +
        '<input class="form-input" type="password" id="hz-t-pin" inputmode="numeric" autocomplete="new-password" maxlength="4" placeholder="••••"></div>' +
      '<div class="hz-field"><label>কোন বর্ষে দরস দেন</label><div class="hz-check-grid">' + checks + '</div></div>' +
      (t ? '<div class="hz-field"><label><input type="checkbox" id="hz-t-active"' + (t.is_active ? ' checked' : '') + '> সক্রিয়</label></div>' : '') +
      '<div class="hz-sheet-actions">' +
        '<button type="button" class="hz-btn-ghost" data-s="close">বাতিল</button>' +
        '<button type="button" class="hz-btn-main" data-s="save-teacher">সংরক্ষণ</button>' +
      '</div>'
    );
  }

  async function saveTeacher() {
    var ctx = state.sheet;
    var name = String(($('hz-t-name') || {}).value || '').trim();
    var pin = String(($('hz-t-pin') || {}).value || '').trim();
    var ids = Array.prototype.map.call(doc.querySelectorAll('.hz-t-class:checked'), function (el) { return el.value; });
    var activeEl = $('hz-t-active');
    if (!name) { toast('নাম লিখুন'); return; }
    if (!ctx.id && !/^[0-9]{4}$/.test(pin)) { toast('৪ অঙ্কের পিন দিন'); return; }
    if (pin && !/^[0-9]{4}$/.test(pin)) { toast('পিন ৪ অঙ্কের হবে'); return; }
    if (!ids.length) { toast('অন্তত একটি বর্ষ বাছাই করুন'); return; }
    await withSaving(async function () {
      var a = actor();
      var res = await API.darsAdminTeacherSave(a.id, a.pin, {
        id: ctx.id,
        name: name,
        pin: pin || null,
        class_ids: ids,
        is_active: activeEl ? activeEl.checked : true,
      });
      if (!res || !res.ok) { toast(H.errorText(res && res.error)); return; }
      closeSheet();
      toast('শিক্ষক সংরক্ষিত');
      await loadBoot();
    });
  }

  // ── ছুটি ───────────────────────────────────────────────────────────

  function renderHolidays() {
    var boot = state.boot;
    if (!boot) return '<div class="hz-empty">লোড হচ্ছে…</div>';
    var canGlobal = !!boot.can_global;
    var scopeOpts = (canGlobal ? '<option value="">সব বর্ষ</option>' : '') + (boot.classes || []).map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
    var html = '<div class="hz-panel"><div class="hz-set-row"><div><b>শুক্রবার ছুটি</b>' +
      '<span>চালু থাকলে প্রতি শুক্রবার কোনো দরসের হাজিরা থাকবে না।' + (canGlobal ? '' : ' (শুধু পূর্ণ অনুমতির জিম্মাদার বদলাতে পারেন)') + '</span></div>' +
      '<button type="button" class="hz-toggle' + (boot.friday_off ? ' is-on' : '') + '" data-act="friday"' + (canGlobal ? '' : ' disabled') + ' aria-label="শুক্রবার ছুটি"></button>' +
    '</div></div>';

    html += '<div class="hz-panel"><div class="hz-panel-h">ছুটি যোগ করুন</div>' +
      '<div class="hz-inline">' +
        '<div><label class="hz-muted" for="hz-h-date">তারিখ</label><input class="form-input" type="date" id="hz-h-date" value="' + esc(today()) + '"></div>' +
        '<div><label class="hz-muted" for="hz-h-scope">কাদের জন্য</label><select class="form-input form-select" id="hz-h-scope">' + scopeOpts + '</select></div>' +
      '</div>' +
      '<div class="hz-field"><label for="hz-h-note">কারণ / নাম</label><input class="form-input" type="text" id="hz-h-note" maxlength="200" placeholder="যেমন: ঈদুল আজহার ছুটি"></div>' +
      '<button type="button" class="submit-btn" style="margin-top:10px;" data-act="add-holiday">ছুটি যোগ করুন</button>' +
    '</div>';

    var hols = (boot.holidays || []).filter(function (h) {
      if (!h.class_id) return true;
      var c = classById(h.class_id);
      return !!c;
    });
    html += '<div class="hz-panel"><div class="hz-panel-h">আসন্ন ছুটি</div>';
    html += hols.length ? hols.map(function (h) {
      var who = h.class_id ? ((classById(h.class_id) || {}).name || 'বর্ষ') : 'সব বর্ষ';
      var d = String(h.date).slice(0, 10);
      return '<div class="hz-hol-row"><span>' + esc(H.shortDate(d)) + ' · <b>' + esc(who) + '</b> <em>' + esc(h.note || '') + '</em></span>' +
        '<button type="button" class="hz-fix soft" data-del-holiday="' + esc(d) + '|' + esc(h.class_id || '') + '">বাতিল</button></div>';
    }).join('') : '<div class="hz-muted" style="padding:6px 0;">কোনো ছুটি নির্ধারিত নেই।</div>';
    html += '</div>';
    return html;
  }

  async function addHoliday() {
    var date = ($('hz-h-date') || {}).value || '';
    var cls = ($('hz-h-scope') || {}).value || '';
    var note = String(($('hz-h-note') || {}).value || '').trim();
    if (!date) { toast('তারিখ দিন'); return; }
    await withSaving(async function () {
      var a = actor();
      var res = await API.darsAdminHolidaySet(a.id, a.pin, date, cls || null, true, note);
      if (!res || !res.ok) { toast(H.errorText(res && res.error)); return; }
      toast('ছুটি যোগ হয়েছে');
      await loadBoot();
    });
  }

  async function removeHoliday(key) {
    var p = String(key).split('|');
    if (!global.confirm('এই ছুটি বাতিল করবেন?')) return;
    await withSaving(async function () {
      var a = actor();
      var res = await API.darsAdminHolidaySet(a.id, a.pin, p[0], p[1] || null, false, null);
      if (!res || !res.ok) { toast(H.errorText(res && res.error)); return; }
      toast('ছুটি বাতিল হয়েছে');
      await loadBoot();
    });
  }

  async function toggleFriday() {
    var next = !(state.boot && state.boot.friday_off);
    await withSaving(async function () {
      var a = actor();
      var res = await API.darsAdminSettingsSave(a.id, a.pin, next);
      if (!res || !res.ok) { toast(H.errorText(res && res.error)); return; }
      toast(next ? 'শুক্রবার ছুটি চালু' : 'শুক্রবার ছুটি বন্ধ');
      await loadBoot();
    });
  }

  // ── শীট ও সাধারণ ───────────────────────────────────────────────────

  function openSheet(html) {
    $('hz-sheet-body').innerHTML = html;
    $('hz-sheet').classList.add('is-open');
  }

  function closeSheet() {
    state.sheet = null;
    $('hz-sheet').classList.remove('is-open');
  }

  async function withSaving(fn) {
    if (state.saving) return;
    state.saving = true;
    doc.querySelectorAll('[data-s^="save"], [data-act="add-holiday"], [data-act="friday"]').forEach(function (b) { b.disabled = true; });
    try {
      await fn();
    } catch (e) {
      console.warn('[hazira-admin] save failed', e);
      toast('সংরক্ষণ হয়নি — আবার চেষ্টা করুন');
    } finally {
      state.saving = false;
      doc.querySelectorAll('[data-s^="save"], [data-act="add-holiday"]').forEach(function (b) { b.disabled = false; });
      if (state.tab === 'holidays') renderPanel();
    }
  }

  async function loadBoot() {
    var a = actor();
    var res = await API.darsAdminBootstrap(a.id, a.pin);
    if (!res || !res.ok) throw new Error((res && res.error) || 'bootstrap_failed');
    state.boot = res;
    clock.sync(res.server_now);
    if (!state.boardDate) state.boardDate = String(res.today).slice(0, 10);
    renderPanel();
  }

  function renderPanel() {
    doc.querySelectorAll('.hz-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab);
    });
    renderDeptFilters();
    var el = $('hz-panel');
    if (!el) return;
    if (!state.boot) { el.innerHTML = '<div class="hz-empty">লোড হচ্ছে…</div>'; return; }
    if (state.tab === 'today') el.innerHTML = renderToday();
    else if (state.tab === 'report') el.innerHTML = renderReport();
    else if (state.tab === 'teachers') el.innerHTML = renderTeachers();
    else el.innerHTML = renderHolidays();
  }

  function setTab(tab) {
    state.tab = tab;
    renderPanel();
    if (tab === 'today' && !state.board) loadBoard();
    if (tab === 'report' && !state.report) {
      if (!state.reportMonth) state.reportMonth = today().slice(0, 7);
      loadReport();
    }
    try { global.history.replaceState(null, '', '?tab=' + tab); } catch (e) {}
  }

  function bind() {
    doc.querySelector('.hz-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tab]');
      if (b) setTab(b.getAttribute('data-tab'));
    });
    $('hz-dept-filters').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dept]');
      if (!b) return;
      state.dept = b.getAttribute('data-dept');
      if (state.reportClass) {
        var c = classById(state.reportClass);
        if (c && !inDept(c.division_code)) { state.reportClass = ''; state.report = null; }
      }
      renderPanel();
      if (state.tab === 'report' && !state.report) loadReport();
    });

    var panel = $('hz-panel');
    panel.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'refresh-board') { loadBoard(); return; }
      if (act === 'print') { global.print(); return; }
      if (act === 'new-teacher') { openTeacher(null); return; }
      if (act === 'add-holiday') { addHoliday(); return; }
      if (act === 'friday') { toggleFriday(); return; }
      if (b.hasAttribute('data-fix')) {
        var p = b.getAttribute('data-fix').split('|');
        openFix(p[0], Number(p[1]));
        return;
      }
      if (b.hasAttribute('data-edit-teacher')) { openTeacher(b.getAttribute('data-edit-teacher')); return; }
      if (b.hasAttribute('data-del-holiday')) { removeHoliday(b.getAttribute('data-del-holiday')); return; }
      if (b.hasAttribute('data-mode')) { state.reportMode = b.getAttribute('data-mode'); renderPanel(); }
    });
    panel.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'hz-board-date') {
        state.boardDate = t.value || today();
        state.board = null;
        renderPanel();
        loadBoard();
      }
      if (t.id === 'hz-rep-month' && t.value) { state.reportMonth = t.value; loadReport(); }
      if (t.id === 'hz-rep-class') { state.reportClass = t.value; loadReport(); }
    });

    var sheet = $('hz-sheet');
    sheet.addEventListener('click', function (ev) {
      if (ev.target === sheet) { closeSheet(); return; }
      var b = ev.target.closest('[data-s]');
      if (!b) return;
      var s = b.getAttribute('data-s');
      if (s === 'close') closeSheet();
      if (s === 'save-fix') saveFix();
      if (s === 'save-teacher') saveTeacher();
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && state.sheet) closeSheet();
    });

    setInterval(function () {
      if (state.tab !== 'today' || state.sheet || doc.visibilityState !== 'visible') return;
      if (state.boardDate && state.boardDate !== clock.dhakaParts().date) return;
      loadBoard();
    }, 60000);
  }

  async function init() {
    var depts = S.getAllowedMadrasaDepts();
    if (depts.length === 1) state.dept = depts[0];
    try {
      var qs = new URLSearchParams(global.location.search);
      var q = qs.get('tab');
      if (q === 'report' || q === 'teachers' || q === 'holidays') state.tab = q;
      var d = qs.get('dept');
      if ((d === 'kitab' || d === 'maktab') && S.canUseMadrasaDept(d)) state.dept = d;
    } catch (e) {}
    bind();
    renderPanel();
    try {
      await loadBoot();
    } catch (e) {
      console.warn('[hazira-admin] bootstrap failed', e);
      $('hz-panel').innerHTML = '<div class="hz-empty">' + esc(H.errorText(e && e.message)) + '</div>';
      return;
    }
    setTab(state.tab);
  }

  if (global.MMLoading && typeof global.MMLoading.run === 'function') global.MMLoading.run(init);
  else init();
})(window);
