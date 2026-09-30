/**
 * শিক্ষক হাজিরা কিয়স্ক — বর্ষ দায়িত্বশীলের লগইনে খোলা থাকে; প্রত্যেক শিক্ষক নিজের দরসে নিজের পিন দেন।
 */
(function (global) {
  'use strict';

  var H = global.MDRHazira;
  var S = global.MMSession;
  var doc = global.document;

  if (!S || S.getRole() !== 'teacher') {
    global.location.href = '../index.html';
    return;
  }

  var actor = {
    id: S.getStaffUserId && S.getStaffUserId(),
    pin: S.getStaffPin && S.getStaffPin(),
  };

  var data = null;
  var clock = new H.ServerClock(null);
  var pinCtx = null;
  var pinBuf = '';
  var pinBusy = false;
  var confirmCtx = null;
  var allowLeave = false;
  var wakeLock = null;
  var toastTimer = null;
  var loading = false;

  function $(id) { return doc.getElementById(id); }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function nowInfo() {
    var p = clock.dhakaParts();
    return { min: p.min, isToday: !!data && p.date === String(data.today).slice(0, 10), date: p.date };
  }

  // ── লোড ────────────────────────────────────────────────────────────

  async function load(silent) {
    if (loading) return;
    if (!actor.id || !actor.pin || !global.MMSharedAPI) {
      renderError('লগইন তথ্য পাওয়া যায়নি — আবার লগইন করুন', true);
      return;
    }
    loading = true;
    try {
      var res = await global.MMSharedAPI.darsKioskGet(actor.id, actor.pin);
      if (!res || !res.ok) {
        var code = (res && res.error) || 'load_failed';
        if (code === 'invalid_actor') {
          renderError(H.errorText(code), true);
          return;
        }
        throw new Error(code);
      }
      data = res;
      clock.sync(res.server_now);
      render();
    } catch (e) {
      console.warn('[hazira-kiosk] load failed', e);
      if (!silent || !data) renderError('তালিকা লোড হয়নি — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন', false);
    } finally {
      loading = false;
    }
  }

  function renderError(msg, relogin) {
    var root = $('hz-root');
    if (!root) return;
    root.innerHTML =
      '<div class="hz-ki-off"><h3>সমস্যা</h3><p>' + H.esc(msg) + '</p>' +
      '<div class="hz-sheet-actions" style="max-width:260px;margin:14px auto 0;">' +
        (relogin
          ? '<button type="button" class="hz-btn-main" data-act="relogin">লগইন পাতায় যান</button>'
          : '<button type="button" class="hz-btn-main" data-act="retry">আবার চেষ্টা</button>') +
      '</div></div>';
  }

  // ── রেন্ডার ─────────────────────────────────────────────────────────

  function renderClock() {
    var p = clock.dhakaParts();
    var t = $('hz-time');
    var part = $('hz-part');
    var d = $('hz-date');
    if (t) t.textContent = H.hm(p.min) + ':' + H.toBn(String(p.sec).padStart(2, '0'));
    if (part) part.textContent = H.partOfDay(p.min);
    if (d) d.textContent = H.dateLabel(p.date);
  }

  function slotMeta(sl, st, nowMin) {
    var s = sl.session || {};
    var late = Number(s.late_min) || 0;
    var lateTxt = late ? ' · <span class="hz-warn">' + H.esc(H.mins(late)) + ' দেরিতে শুরু</span>' : '';
    switch (st) {
      case 'upcoming':
        return 'শুরু করা যাবে ' + H.esc(H.hm(sl.start_min - H.RULES.early)) + ' থেকে';
      case 'ready':
        return 'নিজামের সময় ' + H.esc(H.hm(sl.start_min));
      case 'late':
        return 'নিজাম ' + H.esc(H.hm(sl.start_min)) + ' · <span class="hz-warn">' + H.esc(H.mins(nowMin - sl.start_min)) + ' পার হয়েছে</span>';
      case 'live':
        return 'শুরু ' + H.esc(H.hm(s.started_min)) + ' · চলছে ' + H.esc(H.mins(nowMin - s.started_min)) + lateTxt;
      case 'done':
        return 'শুরু ' + H.esc(H.hm(s.started_min)) + ' · শেষ ' + H.esc(H.hm(s.ended_min)) +
          ' · ' + H.esc(H.mins(H.durationMin(sl))) + lateTxt +
          (s.end_kind === 'next' ? ' · পরের দরস শুরু হওয়ায় বন্ধ' : '') +
          (s.corrected ? ' · <span class="hz-muted">সংশোধিত</span>' : '');
      case 'auto':
        return 'শুরু ' + H.esc(H.hm(s.started_min)) + ' · শেষ চাপা হয়নি — <span class="hz-bad">অটো-বন্ধ, যাচাই বাকি</span>';
      case 'missed':
        return '<span class="hz-bad">এই দরস শুরু করা হয়নি</span>';
      default:
        return '';
    }
  }

  function slotButton(sl, st) {
    var key = ' data-start="' + H.esc(String(sl.start_min)) + '"';
    if (st === 'ready' || st === 'late') {
      return '<button type="button" class="hz-slot-btn" data-act="start"' + key + '>দরস শুরু করুন</button>';
    }
    if (st === 'live') {
      return '<button type="button" class="hz-slot-btn end" data-act="end"' + key + '>দরস শেষ করুন</button>';
    }
    if (st === 'upcoming') {
      return '<button type="button" class="hz-slot-btn" disabled>এখনো সময় হয়নি</button>';
    }
    return '';
  }

  function renderSlot(sl, nowMin, isToday) {
    var st = H.liveStatus(sl, nowMin, isToday);
    var isLead = sl.teacher_kind === 'lead';
    return (
      '<div class="hz-slot st-' + st + '">' +
        '<div class="hz-slot-h">' +
          '<span class="hz-slot-time">' + H.esc(H.hmPart(sl.start_min)) + ' – ' + H.esc(H.hm(sl.end_min)) + '</span>' +
          '<span class="hz-chip">' + H.esc(H.CHIP[st] || '') + '</span>' +
        '</div>' +
        '<div class="hz-slot-t">' + H.esc(sl.label) + '</div>' +
        '<div class="hz-slot-who"><span class="hz-av">' + H.esc(H.initials(sl.teacher_name)) + '</span>' +
          H.esc(sl.teacher_name || 'শিক্ষক') + (isLead ? ' <span class="hz-muted">· দায়িত্বশীল</span>' : '') +
        '</div>' +
        '<div class="hz-slot-meta">' + slotMeta(sl, st, nowMin) + '</div>' +
        slotButton(sl, st) +
      '</div>'
    );
  }

  function render() {
    var root = $('hz-root');
    if (!root || !data) return;
    var cn = $('hz-class-name');
    if (cn) cn.textContent = (data.class && data.class.name) || 'বর্ষ';
    renderClock();

    if (data.holiday) {
      root.innerHTML = '<div class="hz-ki-off"><h3>আজ ছুটি</h3><p>' + H.esc(data.holiday) +
        '<br>আজ কোনো দরসের হাজিরা নেই।</p></div>';
      return;
    }
    if (!data.has_routine) {
      root.innerHTML = '<div class="hz-ki-off"><h3>নিজাম নেই</h3><p>এখনো বর্ষের নিজাম তৈরি হয়নি। বর্ষের পাতায় «নিজাম» ট্যাবে গিয়ে নিজাম তৈরি করুন।</p></div>';
      return;
    }
    var slots = Array.isArray(data.slots) ? data.slots : [];
    if (!slots.length) {
      root.innerHTML = '<div class="hz-ki-off"><h3>কোনো দরস বাছাই করা নেই</h3><p>নিজাম → সম্পাদনা → প্রতিটি দরসের নিচে «শিক্ষক হাজিরা» থেকে শিক্ষক বাছাই করে সংরক্ষণ করুন। তখন দরসগুলো এখানে আসবে।</p></div>';
      return;
    }
    var n = nowInfo();
    root.innerHTML = '<div class="hz-slots">' + slots.map(function (sl) {
      return renderSlot(sl, n.min, n.isToday);
    }).join('') + '</div>';
  }

  function findSlot(startMin) {
    var list = (data && data.slots) || [];
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].start_min) === Number(startMin)) return list[i];
    }
    return null;
  }

  // ── পিন শীট ────────────────────────────────────────────────────────

  function buildNumpad() {
    var pad = $('hz-numpad');
    if (!pad) return;
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    pad.innerHTML = keys.map(function (k) {
      if (!k) return '<button type="button" class="num-btn empty" tabindex="-1" aria-hidden="true"></button>';
      if (k === 'del') return '<button type="button" class="num-btn del" data-key="del" aria-label="মুছুন">⌫</button>';
      return '<button type="button" class="num-btn" data-key="' + k + '">' + H.toBn(k) + '</button>';
    }).join('');
    pad.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-key]');
      if (!b) return;
      pressKey(b.getAttribute('data-key'));
    });
  }

  function paintDots() {
    var dots = doc.querySelectorAll('#hz-pin-sheet .pin-dot');
    dots.forEach(function (d, i) { d.classList.toggle('filled', i < pinBuf.length); });
  }

  function openPin(ctx) {
    pinCtx = ctx;
    pinBuf = '';
    pinBusy = false;
    $('hz-pin-title').textContent = ctx.title;
    $('hz-pin-sub').textContent = ctx.sub || '';
    $('hz-pin-err').textContent = '';
    paintDots();
    $('hz-pin-sheet').classList.add('is-open');
  }

  function closePin() {
    pinCtx = null;
    pinBuf = '';
    $('hz-pin-sheet').classList.remove('is-open');
  }

  function pressKey(k) {
    if (!pinCtx || pinBusy) return;
    if (k === 'del') {
      pinBuf = pinBuf.slice(0, -1);
    } else if (/^[0-9]$/.test(k) && pinBuf.length < 4) {
      pinBuf += k;
    }
    $('hz-pin-err').textContent = '';
    paintDots();
    if (pinBuf.length === 4) submitPin();
  }

  async function submitPin() {
    var ctx = pinCtx;
    var pin = pinBuf;
    pinBusy = true;
    try {
      var err = await ctx.onPin(pin);
      if (err && pinCtx === ctx) {
        $('hz-pin-err').textContent = err;
        pinBuf = '';
        paintDots();
      }
    } catch (e) {
      console.warn('[hazira-kiosk] pin action failed', e);
      if (pinCtx === ctx) {
        $('hz-pin-err').textContent = 'সংযোগ সমস্যা — আবার চেষ্টা করুন';
        pinBuf = '';
        paintDots();
      }
    } finally {
      pinBusy = false;
    }
  }

  function wrongPinText(name) {
    return 'এটা ' + (name || 'এই শিক্ষক') + '-এর পিন নয়। প্রত্যেকে শুধু নিজের দরসে নিজের পিন দেবেন।';
  }

  // ── কাজ ────────────────────────────────────────────────────────────

  function startFlow(sl) {
    openPin({
      title: (sl.teacher_name || 'শিক্ষক') + ' — পিন দিন',
      sub: '«' + sl.label + '» শুরু করতে নিজের পিন দিন।',
      onPin: function (pin) { return doStart(sl, pin, false); },
    });
  }

  async function doStart(sl, pin, closePrev) {
    var res = await global.MMSharedAPI.darsStart(actor.id, actor.pin, sl.start_min, pin, closePrev);
    if (res && res.ok) {
      closePin();
      closeConfirm();
      var late = Number(res.late_min) || 0;
      toast('«' + sl.label + '» শুরু হয়েছে' + (late ? ' · ' + H.mins(late) + ' দেরি' : ''));
      await load(true);
      return null;
    }
    var code = (res && res.error) || '';
    if (code === 'wrong_pin') return wrongPinText(res.teacher_name || sl.teacher_name);
    if (code === 'other_live') {
      closePin();
      openConfirm(sl, pin, res.live_label, res.live_teacher);
      return null;
    }
    if (code === 'too_early' && res.opens_min != null) {
      return 'শুরু করা যাবে ' + H.hm(res.opens_min) + ' থেকে';
    }
    closePin();
    toast(H.errorText(code));
    await load(true);
    return null;
  }

  function endFlow(sl) {
    openPin({
      title: (sl.teacher_name || 'শিক্ষক') + ' — পিন দিন',
      sub: '«' + sl.label + '» শেষ করতে নিজের পিন দিন।',
      onPin: async function (pin) {
        var res = await global.MMSharedAPI.darsEnd(actor.id, actor.pin, sl.start_min, pin);
        if (res && res.ok) {
          closePin();
          toast('«' + sl.label + '» শেষ হয়েছে');
          await load(true);
          return null;
        }
        var code = (res && res.error) || '';
        if (code === 'wrong_pin') return wrongPinText(res.teacher_name || sl.teacher_name);
        closePin();
        toast(H.errorText(code));
        await load(true);
        return null;
      },
    });
  }

  function openConfirm(sl, pin, liveLabel, liveTeacher) {
    confirmCtx = { sl: sl, pin: pin };
    $('hz-confirm-sub').textContent =
      '«' + (liveLabel || 'আগের দরস') + '»' + (liveTeacher ? ' (' + liveTeacher + ')' : '') +
      ' এখনো চলছে। সেটি এখনই বন্ধ করে «' + sl.label + '» শুরু করবেন?';
    $('hz-confirm-sheet').classList.add('is-open');
  }

  function closeConfirm() {
    confirmCtx = null;
    $('hz-confirm-sheet').classList.remove('is-open');
  }

  async function confirmYes() {
    if (!confirmCtx) return;
    var ctx = confirmCtx;
    var btn = $('hz-confirm-yes');
    btn.disabled = true;
    try {
      var err = await doStart(ctx.sl, ctx.pin, true);
      if (err) {
        closeConfirm();
        toast(err);
      }
    } catch (e) {
      toast('সংযোগ সমস্যা — আবার চেষ্টা করুন');
    } finally {
      btn.disabled = false;
    }
  }

  function openExit() {
    openPin({
      title: 'কিয়স্ক থেকে বের হবেন?',
      sub: 'বর্ষ দায়িত্বশীলের পিন দিন।',
      onPin: function (pin) {
        if (pin !== actor.pin) return 'পিন সঠিক নয়';
        allowLeave = true;
        closePin();
        global.location.href = 'madrasa-class.html';
        return null;
      },
    });
  }

  // ── স্ক্রিন জাগিয়ে রাখা ─────────────────────────────────────────────

  async function keepAwake() {
    try {
      if ('wakeLock' in global.navigator && (!wakeLock || wakeLock.released)) {
        wakeLock = await global.navigator.wakeLock.request('screen');
      }
    } catch (e) {
      wakeLock = null;
    }
  }

  // ── ইভেন্ট ─────────────────────────────────────────────────────────

  function bind() {
    buildNumpad();
    $('hz-exit-btn').addEventListener('click', openExit);
    $('hz-pin-cancel').addEventListener('click', closePin);
    $('hz-confirm-no').addEventListener('click', closeConfirm);
    $('hz-confirm-yes').addEventListener('click', confirmYes);

    $('hz-root').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'retry') { load(false); return; }
      if (act === 'relogin') { S.logoutToIndex('../index.html'); return; }
      var sl = findSlot(b.getAttribute('data-start'));
      if (!sl) return;
      if (act === 'start') startFlow(sl);
      if (act === 'end') endFlow(sl);
    });

    doc.addEventListener('keydown', function (ev) {
      if (!pinCtx) return;
      if (/^[0-9]$/.test(ev.key)) { pressKey(ev.key); ev.preventDefault(); }
      else if (ev.key === 'Backspace') { pressKey('del'); ev.preventDefault(); }
      else if (ev.key === 'Escape') closePin();
    });

    global.history.pushState({ hzKiosk: 1 }, '');
    global.addEventListener('popstate', function () {
      if (allowLeave) return;
      global.history.pushState({ hzKiosk: 1 }, '');
      openExit();
    });

    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible') {
        keepAwake();
        load(true);
      }
    });

    var lastMin = -1;
    setInterval(function () {
      renderClock();
      var n = nowInfo();
      if (data && !n.isToday) { load(true); return; }
      if (n.min !== lastMin) {
        lastMin = n.min;
        render();
      }
    }, 1000);
    setInterval(function () { load(true); }, 60000);
  }

  bind();
  keepAwake();
  load(false);
})(window);
