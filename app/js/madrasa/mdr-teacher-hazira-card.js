/**
 * বর্ষ-হোমের «শিক্ষক হাজিরা» কার্ড + বর্ষের ছুটি শীট।
 */
(function (global) {
  'use strict';

  var H = global.MDRHazira;
  var doc = global.document;

  var hooks = {
    getActor: function () { return null; },
    notify: function () {},
  };
  var data = null;
  var clock = new H.ServerClock(null);
  var loading = false;
  var saving = false;

  function $(id) { return doc.getElementById(id); }

  function kioskUrl() { return 'madrasa-teacher-hazira.html'; }

  function barClass(st, sl) {
    if (st === 'done') return Number(sl.session && sl.session.late_min) > 0 ? 'bad' : 'done';
    if (st === 'live') return 'live';
    if (st === 'auto' || st === 'missed') return 'bad';
    return '';
  }

  function nowLine(slots, nowMin, isToday) {
    var live = null;
    var next = null;
    var doneN = 0;
    slots.forEach(function (sl) {
      var st = H.liveStatus(sl, nowMin, isToday);
      if (st === 'live' && !live) live = sl;
      if ((st === 'upcoming' || st === 'ready' || st === 'late') && !next) next = sl;
      if (st === 'done') doneN++;
    });
    var line;
    if (live) {
      line = 'এখন: <b>' + H.esc(live.label) + '</b> — ' + H.esc(live.teacher_name) + ' (চলছে)';
    } else if (next) {
      line = 'পরের দরস: <b>' + H.esc(next.label) + '</b> · ' + H.esc(H.hmPart(next.start_min)) + ' · ' + H.esc(next.teacher_name);
    } else {
      line = 'আজকের সব দরসের সময় শেষ';
    }
    return line + '<br><span class="hz-muted">' + H.toBn(doneN) + '/' + H.toBn(slots.length) + ' দরস শেষ হয়েছে</span>';
  }

  function render() {
    var root = $('hz-home-card');
    if (!root) return;
    if (!data) {
      root.innerHTML = '';
      return;
    }
    var slots = Array.isArray(data.slots) ? data.slots : [];
    var p = clock.dhakaParts();
    var isToday = p.date === String(data.today).slice(0, 10);
    var body;
    if (data.holiday) {
      body = '<div class="hz-t">আজ ছুটি</div><div class="hz-now">' + H.esc(data.holiday) + ' — আজ হাজিরা নেই।</div>';
    } else if (!slots.length) {
      body = '<div class="hz-t">শিক্ষক হাজিরা</div><div class="hz-now">নিজামে কোনো দরসে শিক্ষক বাছাই করা নেই। «নিজাম» ট্যাবে সম্পাদনা করে প্রতিটি দরসে শিক্ষক বাছাই করুন।</div>';
    } else {
      body = '<div class="hz-t">শিক্ষক হাজিরা</div>' +
        '<div class="hz-now">' + nowLine(slots, p.min, isToday) + '</div>' +
        '<div class="hz-bar">' + slots.map(function (sl) {
          return '<i class="' + barClass(H.liveStatus(sl, p.min, isToday), sl) + '"></i>';
        }).join('') + '</div>';
    }
    root.innerHTML =
      '<button type="button" class="hz-card" data-hz="kiosk">' +
        '<div class="hz-k">আজকের দরস · ' + H.esc(H.shortDate(data.today)) + '</div>' +
        body +
        '<span class="hz-go">কিয়স্ক খুলুন</span>' +
      '</button>' +
      '<button type="button" class="hz-link-row" data-hz="off">' +
        '<div><b>এই বর্ষে ছুটি</b><br><span>শুধু এই বর্ষের দরস বন্ধ রাখতে</span></div><span>›</span>' +
      '</button>';
  }

  async function load() {
    var actor = hooks.getActor();
    if (!actor || !actor.id || !actor.pin || !global.MMSharedAPI || loading) return;
    loading = true;
    try {
      var res = await global.MMSharedAPI.darsKioskGet(actor.id, actor.pin);
      if (res && res.ok) {
        data = res;
        clock.sync(res.server_now);
        render();
        if (sheetOpen()) renderSheet();
      }
    } catch (e) {
      console.warn('[hazira-card] load failed', e);
    } finally {
      loading = false;
    }
  }

  // ── বর্ষের ছুটি শীট ─────────────────────────────────────────────────

  function ensureSheet() {
    if ($('hz-off-sheet')) return;
    var el = doc.createElement('div');
    el.className = 'hz-sheet-bg';
    el.id = 'hz-off-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="hz-sheet" id="hz-off-body"></div>';
    doc.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      if (ev.target === el) closeSheet();
      var b = ev.target.closest('[data-off]');
      if (!b) return;
      var act = b.getAttribute('data-off');
      if (act === 'close') closeSheet();
      if (act === 'save') saveOff();
      if (act === 'remove') removeOff(b.getAttribute('data-date'));
    });
  }

  function sheetOpen() {
    var el = $('hz-off-sheet');
    return !!(el && el.classList.contains('is-open'));
  }

  function addDays(iso, n) {
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function renderSheet() {
    var body = $('hz-off-body');
    if (!body || !data) return;
    var today = String(data.today).slice(0, 10);
    var own = Array.isArray(data.class_holidays) ? data.class_holidays : [];
    var global_ = Array.isArray(data.global_holidays) ? data.global_holidays : [];
    var ownHtml = own.length
      ? own.map(function (h) {
          return '<div class="hz-hol-row"><span>' + H.esc(H.shortDate(h.date)) + ' <em>' + H.esc(h.note || '') + '</em></span>' +
            '<button type="button" class="hz-fix soft" data-off="remove" data-date="' + H.esc(String(h.date).slice(0, 10)) + '">বাতিল</button></div>';
        }).join('')
      : '<div class="hz-muted" style="padding:6px 0;">এই বর্ষের কোনো আলাদা ছুটি নেই।</div>';
    var globalHtml = global_.length
      ? global_.map(function (h) {
          return '<div class="hz-hol-row"><span>' + H.esc(H.shortDate(h.date)) + '</span><em>' + H.esc(h.note || 'ছুটি') + '</em></div>';
        }).join('')
      : '';
    body.innerHTML =
      '<h3>এই বর্ষে ছুটি</h3>' +
      '<p>যেদিন ছুটি, সেদিন কিয়স্কে দরস আসবে না, অনুপস্থিতও গোনা হবে না। সব বর্ষের ছুটি ও শুক্রবার জিম্মাদার ঠিক করেন' +
        (data.friday_off ? ' (শুক্রবার এমনিতেই ছুটি)' : '') + '।</p>' +
      '<div class="hz-inline hz-field">' +
        '<div><label for="hz-off-date">তারিখ</label><input class="form-input" type="date" id="hz-off-date" value="' + H.esc(today) + '" min="' + H.esc(today) + '" max="' + H.esc(addDays(today, 60)) + '"></div>' +
        '<div><label for="hz-off-note">কারণ</label><input class="form-input" type="text" id="hz-off-note" maxlength="200" placeholder="যেমন: সফর, পরীক্ষা"></div>' +
      '</div>' +
      '<div class="hz-sheet-actions">' +
        '<button type="button" class="hz-btn-ghost" data-off="close">বন্ধ</button>' +
        '<button type="button" class="hz-btn-main" data-off="save"' + (saving ? ' disabled' : '') + '>ছুটি দিন</button>' +
      '</div>' +
      '<div class="hz-field"><label>এই বর্ষের ছুটি</label>' + ownHtml + '</div>' +
      (globalHtml ? '<div class="hz-field"><label>সব বর্ষের ছুটি (জিম্মাদার)</label>' + globalHtml + '</div>' : '');
  }

  function openSheet() {
    if (!data) return;
    ensureSheet();
    renderSheet();
    $('hz-off-sheet').classList.add('is-open');
  }

  function closeSheet() {
    var el = $('hz-off-sheet');
    if (el) el.classList.remove('is-open');
  }

  async function saveOff() {
    if (saving) return;
    var date = ($('hz-off-date') || {}).value || '';
    var note = String(($('hz-off-note') || {}).value || '').trim();
    if (!date) { hooks.notify('তারিখ দিন'); return; }
    if (!note) { hooks.notify('ছুটির কারণ লিখুন'); return; }
    await setOff(date, true, note, 'ছুটি দেওয়া হয়েছে');
  }

  async function removeOff(date) {
    if (!date || saving) return;
    await setOff(date, false, null, 'ছুটি বাতিল হয়েছে');
  }

  async function setOff(date, off, note, okMsg) {
    var actor = hooks.getActor();
    if (!actor) return;
    saving = true;
    renderSheet();
    try {
      var res = await global.MMSharedAPI.darsClassOffSet(actor.id, actor.pin, date, off, note);
      if (!res || !res.ok) {
        hooks.notify(H.errorText(res && res.error));
      } else {
        hooks.notify(okMsg);
      }
    } catch (e) {
      console.warn('[hazira-card] class off failed', e);
      hooks.notify('সংরক্ষণ হয়নি — আবার চেষ্টা করুন');
    } finally {
      saving = false;
      await load();
      renderSheet();
    }
  }

  function bindRoot() {
    var root = $('hz-home-card');
    if (!root || root.getAttribute('data-bound')) return;
    root.setAttribute('data-bound', '1');
    root.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-hz]');
      if (!b) return;
      var act = b.getAttribute('data-hz');
      if (act === 'kiosk') global.location.href = kioskUrl();
      if (act === 'off') openSheet();
    });
  }

  global.MDRTeacherHaziraCard = {
    init: function (opts) {
      hooks.getActor = (opts && opts.getActor) || hooks.getActor;
      hooks.notify = (opts && opts.notify) || hooks.notify;
      bindRoot();
      load();
      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'visible') load();
      });
      setInterval(function () {
        if (doc.visibilityState === 'visible') render();
      }, 60000);
    },
    refresh: load,
  };
})(window);
