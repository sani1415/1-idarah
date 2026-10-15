/**
 * Student detail modal — «ওজিফা» (মাসিক ফি) tab (জিম্মাদার ও দফতর)।
 * তথ্য আসে বাইরের ফি-সফটওয়্যার থেকে: MMSharedAPI.studentFeeHistory → Edge Function mdr-student-fee।
 * সার্ভার নিজেই অনুমতি যাচাই করে; এখানে ট্যাব শুধু দেখানো/লুকানো।
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'mm-student-fee-style';
  var CACHE_MS = 5 * 60 * 1000;
  var _cache = {};
  var _seq = 0;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toBn(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; });
  }

  /* ৳১২,৩৪৫ — বাংলাদেশি ধাঁচে কমা */
  function taka(n) {
    var v = Math.round(Number(n) || 0);
    var neg = v < 0;
    var t = String(Math.abs(v));
    var head = t.slice(0, -3), tail = t.slice(-3);
    while (head.length > 2) { tail = head.slice(-2) + ',' + tail; head = head.slice(0, -2); }
    return (neg ? '−' : '') + '৳' + toBn(head ? head + ',' + tail : tail);
  }

  function canSee() {
    var S = global.MMSession;
    if (!S) return false;
    return !!((S.isAdmin && S.isAdmin()) || (S.getRole && S.getRole() === 'daftar'));
  }

  function actor() {
    var S = global.MMSession;
    if (!S || !S.getId || !S.getPin) return null;
    var id = S.getId(), pin = S.getPin();
    return id && pin ? { id: id, pin: pin } : null;
  }

  function nowHijri() {
    try {
      if (global.MMHijri && global.MMHijri.todayHijri) {
        var h = global.MMHijri.todayHijri();
        if (h && h.year && h.monthNo) return { year: h.year, monthNo: h.monthNo };
      }
    } catch (e) {}
    return null;
  }

  /* মাসটা আজকের পরের কিনা (হিজরী বছর-মাস তুলনা) */
  function isFuture(m, now) {
    if (!now || !m.year || !m.month_no) return false;
    return m.year > now.year || (m.year === now.year && m.month_no > now.monthNo);
  }

  function normName(s) {
    return String(s || '').normalize('NFC').replace(/[‌‍]/g, '').replace(/[\s.\-()]+/g, '').toLowerCase();
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.st-fee-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:4px 0 12px;}' +
      '.st-fee-card{background:var(--cream);border:1px solid var(--cream2);border-radius:10px;padding:8px 10px;min-width:0;}' +
      '.st-fee-card-lbl{font-size:10px;color:var(--ink3);font-weight:600;}' +
      '.st-fee-card-val{font-size:15px;font-weight:700;color:var(--ink);margin-top:2px;word-break:break-word;}' +
      '.st-fee-card--due .st-fee-card-val{color:var(--red);}' +
      '.st-fee-card--paid .st-fee-card-val{color:var(--green);}' +
      '.st-fee-list{display:flex;flex-direction:column;}' +
      '.st-fee-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--cream2);font-size:13px;}' +
      '.st-fee-row:last-child{border-bottom:none;}' +
      '.st-fee-row--future{opacity:.55;}' +
      '.st-fee-main{min-width:0;flex:1;}' +
      '.st-fee-month{font-weight:600;color:var(--ink);}' +
      '.st-fee-sub{font-size:11px;color:var(--ink3);margin-top:2px;}' +
      '.st-fee-right{text-align:right;flex-shrink:0;}' +
      '.st-fee-amt{font-weight:700;}' +
      '.st-fee-badge{display:inline-block;margin-top:3px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;}' +
      '.st-fee-badge--paid{background:var(--green-light);color:var(--green);}' +
      '.st-fee-badge--due{background:var(--red-light);color:var(--red);}' +
      '.st-fee-badge--future{background:var(--cream2);color:var(--ink3);}' +
      '.st-fee-warn{background:var(--red-light);color:var(--red);border-radius:10px;padding:8px 10px;font-size:12px;margin-bottom:10px;}' +
      '.st-fee-src{font-size:10px;color:var(--ink3);margin-top:10px;}' +
      '.st-fee-retry{margin-top:8px;font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--cream);cursor:pointer;}';
    document.head.appendChild(style);
  }

  function panelEl() {
    return document.getElementById('st-panel-fee');
  }

  var ERRORS = {
    not_found_in_fee_software: 'ফি-সফটওয়্যারে এই ছাত্রের আইডি পাওয়া যায়নি। ফি-সফটওয়্যারে আইডি বসানো আছে কিনা দেখুন।',
    no_reg_id: 'এই ছাত্রের রেজিস্ট্রেশন আইডি নেই, তাই ফি আনা যায় না।',
    not_allowed: 'ওজিফা শুধু জিম্মাদার ও দফতর দেখতে পারেন।',
    pin_locked: 'ভুল পিনে লক হয়ে আছে — পরে আবার চেষ্টা করুন।',
    fee_api_not_configured: 'ফি-সফটওয়্যারের সংযোগ এখনো চালু হয়নি।',
    fee_api_unreachable: 'ফি-সফটওয়্যার থেকে উত্তর আসেনি — একটু পরে আবার চেষ্টা করুন।',
    fee_api_error: 'ফি-সফটওয়্যার থেকে তথ্য আনা যায়নি — একটু পরে আবার চেষ্টা করুন।',
    network: 'নেট সংযোগ নেই — আবার চেষ্টা করুন।',
  };

  function render(studentId, res) {
    var panel = panelEl();
    if (!panel || panel.dataset.feeFor !== String(studentId)) return;
    if (!res || !res.ok) {
      var code = (res && res.error) || '';
      var msg = ERRORS[code] || 'ওজিফার তথ্য আনা যায়নি — আবার চেষ্টা করুন।';
      var retry = /^(fee_api_|network|bad_response)/.test(code) || !ERRORS[code]
        ? '<br><button type="button" class="st-fee-retry" onclick="MMStudentFee.reload()">আবার চেষ্টা করুন</button>' : '';
      panel.innerHTML = '<div class="st-note" style="padding:8px 0;">' + esc(msg) + '</div>' + retry;
      return;
    }
    var now = nowHijri();
    var months = res.months || [];
    var paid = 0, due = 0, upcoming = 0;
    months.forEach(function (m) {
      if (m.paid) paid += m.amount;
      else if (isFuture(m, now)) upcoming += m.amount;
      else due += m.amount;
    });

    var warn = '';
    var vs = res.vendor_student;
    var API = global.API;
    var s = API && API.Students && API.Students.getById ? API.Students.getById(studentId) : null;
    if (vs && vs.name && s && s.name && normName(vs.name) !== normName(s.name)) {
      warn = '<div class="st-fee-warn"><b>নাম মিলছে না:</b> ফি-সফটওয়্যারে এই আইডিতে «' + esc(vs.name) + '» লেখা। ' +
        'ভুল ছাত্রের সাথে আইডি বসানো হয়ে থাকতে পারে — ফি-সফটওয়্যারে যাচাই করুন।</div>';
    }

    var cards =
      '<div class="st-fee-cards">' +
      '<div class="st-fee-card st-fee-card--paid"><div class="st-fee-card-lbl">পরিশোধিত</div><div class="st-fee-card-val">' + taka(paid) + '</div></div>' +
      '<div class="st-fee-card st-fee-card--due"><div class="st-fee-card-lbl">এখন পর্যন্ত বাকি</div><div class="st-fee-card-val">' + taka(due) + '</div></div>' +
      '<div class="st-fee-card"><div class="st-fee-card-lbl">সামনের মাস</div><div class="st-fee-card-val">' + taka(upcoming) + '</div></div>' +
      '</div>';

    var rows = months.map(function (m) {
      var fut = !m.paid && isFuture(m, now);
      var badge = m.paid ? '<span class="st-fee-badge st-fee-badge--paid">✓ পরিশোধিত</span>'
        : (fut ? '<span class="st-fee-badge st-fee-badge--future">সামনের মাস</span>'
          : '<span class="st-fee-badge st-fee-badge--due">বাকি</span>');
      var sub = [m.reason, m.paid && m.paid_date ? 'পরিশোধ: ' + toBn(m.paid_date) : ''].filter(Boolean).join(' · ');
      return '<div class="st-fee-row' + (fut ? ' st-fee-row--future' : '') + '">' +
        '<div class="st-fee-main"><div class="st-fee-month">' + esc(m.month) + (m.year ? ' ' + toBn(m.year) : '') + '</div>' +
        (sub ? '<div class="st-fee-sub">' + esc(sub) + '</div>' : '') + '</div>' +
        '<div class="st-fee-right"><div class="st-fee-amt">' + taka(m.amount) + '</div>' + badge + '</div></div>';
    }).join('');
    if (!rows) rows = '<div class="st-note" style="padding:8px 0;">ফি-সফটওয়্যারে এই ছাত্রের কোনো মাসের ওজিফার হিসাব নেই।</div>';

    panel.innerHTML = warn + cards + '<div class="st-fee-list">' + rows + '</div>' +
      '<div class="st-fee-src">তথ্যসূত্র: ফি-সফটওয়্যার (আইডি ' + esc(toBn(res.reg_id || '')) + ')। বদল করতে হলে ফি-সফটওয়্যারেই করুন।</div>';
  }

  async function load(studentId, force) {
    var panel = panelEl();
    if (!panel) return;
    ensureStyles();
    panel.dataset.feeFor = String(studentId);
    if (!canSee()) {
      panel.innerHTML = '<div class="st-note" style="padding:8px 0;">' + esc(ERRORS.not_allowed) + '</div>';
      return;
    }
    var hit = _cache[studentId];
    if (!force && hit && Date.now() - hit.at < CACHE_MS) { render(studentId, hit.res); return; }
    var a = actor();
    if (!a || !global.MMSharedAPI || !global.MMSharedAPI.studentFeeHistory) {
      render(studentId, { ok: false, error: 'network' });
      return;
    }
    panel.innerHTML = '<div class="st-note" style="padding:8px 0;">ফি-সফটওয়্যার থেকে আনা হচ্ছে…</div>';
    var my = ++_seq;
    var res = await global.MMSharedAPI.studentFeeHistory(a.id, a.pin, studentId);
    if (my !== _seq) return;
    if (res && res.ok) _cache[studentId] = { at: Date.now(), res: res };
    render(studentId, res);
  }

  var _current = null;

  // ছাত্রের বিবরণের উপরের ঘর: এখন পর্যন্ত বকেয়া কত টাকা, কয় মাস (একই ক্যাশ)
  async function summary(studentId) {
    if (!canSee()) return null;
    var hit = _cache[studentId];
    var res = hit && Date.now() - hit.at < CACHE_MS ? hit.res : null;
    if (!res) {
      var a = actor();
      if (!a || !global.MMSharedAPI || !global.MMSharedAPI.studentFeeHistory) return { ok: false };
      res = await global.MMSharedAPI.studentFeeHistory(a.id, a.pin, studentId);
      if (res && res.ok) _cache[studentId] = { at: Date.now(), res: res };
    }
    if (!res || !res.ok) return { ok: false, error: res && res.error };
    var now = nowHijri(), due = 0, dueMonths = 0;
    (res.months || []).forEach(function (m) {
      if (!m.paid && !isFuture(m, now)) { due += m.amount; dueMonths++; }
    });
    return { ok: true, due: due, dueMonths: dueMonths, text: taka(due) };
  }

  global.MMStudentFee = {
    canSee: canSee,
    summary: summary,
    onTabOpen: function (studentId) { _current = studentId; load(studentId, false); },
    reload: function () { if (_current) load(_current, true); },
    invalidate: function () { _current = null; _seq++; },
  };
})(typeof window !== 'undefined' ? window : this);
