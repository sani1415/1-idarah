/**
 * শিক্ষক হাজিরা — কিয়স্ক, বর্ষ-হোম কার্ড ও অ্যাডমিনের যৌথ helper।
 * অবস্থার নিয়ম সার্ভারের private.mdr_dars_day_slots-এর সাথে মিলিয়ে রাখা।
 */
(function (global) {
  'use strict';

  var RULES = { early: 15, grace: 5, auto_after: 60 };

  var CHIP = {
    upcoming: 'আসন্ন',
    ready: 'শুরু করা যাবে',
    late: 'দেরি হচ্ছে',
    live: 'চলছে',
    done: 'শেষ',
    auto: 'অটো-বন্ধ',
    missed: 'অনুপস্থিত',
    holiday: 'ছুটি',
    untracked: '—',
  };

  function toBn(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function partOfDay(min) {
    var h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
    if (h >= 4 && h < 6) return 'ভোর';
    if (h >= 6 && h < 12) return 'সকাল';
    if (h >= 12 && h < 15) return 'দুপুর';
    if (h >= 15 && h < 18) return 'বিকাল';
    if (h >= 18 && h < 20) return 'সন্ধ্যা';
    return 'রাত';
  }

  function hm(min) {
    if (min == null || isNaN(min)) return '—';
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var h12 = h % 12 || 12;
    return toBn(h12) + ':' + toBn(pad2(m % 60));
  }

  function hmPart(min) {
    if (min == null || isNaN(min)) return '—';
    return partOfDay(min) + ' ' + hm(min);
  }

  function mins(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n < 60) return toBn(n) + ' মিনিট';
    var h = Math.floor(n / 60);
    var r = n % 60;
    return toBn(h) + ' ঘণ্টা' + (r ? ' ' + toBn(r) + ' মিনিট' : '');
  }

  function initials(name) {
    var s = String(name || '').replace(/^(মাওলানা|মুফতি|হাফেজ|হাফিজ|কারী|ক্বারী|মুহাম্মাদ|মোঃ|মো\.)\s*/g, '').trim();
    return s ? s.charAt(0) : '?';
  }

  function dateLabel(iso) {
    if (!iso) return '';
    try {
      return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('bn-BD', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch (e) {
      return String(iso);
    }
  }

  function shortDate(iso) {
    if (!iso) return '';
    try {
      return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('bn-BD', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
    } catch (e) {
      return String(iso);
    }
  }

  /** সার্ভারের দেওয়া অবস্থা থেকে এই মুহূর্তের অবস্থা (রিফ্রেশের মাঝের সময়টুকুর জন্য)। */
  function liveStatus(slot, nowMin, isToday) {
    var s = slot.status;
    if (!isToday) return s;
    if (s === 'holiday' || s === 'untracked' || s === 'done') return s;
    if (slot.session) {
      if (s === 'auto' || nowMin >= slot.end_min + RULES.auto_after) return 'auto';
      return 'live';
    }
    if (nowMin < slot.start_min - RULES.early) return 'upcoming';
    if (nowMin >= slot.end_min + RULES.auto_after) return 'missed';
    if (nowMin <= slot.start_min + RULES.grace) return 'ready';
    return 'late';
  }

  function isProblem(slot, st) {
    if (st === 'auto' || st === 'missed' || st === 'late') return true;
    return st === 'done' && slot.session && Number(slot.session.late_min) > 0;
  }

  function durationMin(slot) {
    var s = slot.session;
    if (!s || s.started_min == null || s.ended_min == null) return 0;
    return Math.max(0, s.ended_min - s.started_min);
  }

  /** সার্ভার-ঘড়ি: অফসেট ধরে এখনকার মিনিট ও তারিখ। */
  function ServerClock(serverNowIso) {
    this.offset = 0;
    this.sync(serverNowIso);
  }
  ServerClock.prototype.sync = function (serverNowIso) {
    var t = Date.parse(serverNowIso || '');
    if (!isNaN(t)) this.offset = t - Date.now();
  };
  ServerClock.prototype.now = function () {
    return new Date(Date.now() + this.offset);
  };
  ServerClock.prototype.dhakaParts = function () {
    var d = new Date(this.now().getTime() + 6 * 3600 * 1000);
    return {
      date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
      min: d.getUTCHours() * 60 + d.getUTCMinutes(),
      sec: d.getUTCSeconds(),
    };
  };

  var ERRORS = {
    invalid_actor: 'লগইন মেয়াদ শেষ — আবার লগইন করুন',
    pin_locked: 'অনেকবার ভুল পিন — ১৫ মিনিট পরে আবার চেষ্টা করুন',
    permission_denied: 'এই অংশে অনুমতি নেই',
    holiday: 'আজ ছুটি — হাজিরা বন্ধ',
    slot_not_found: 'নিজামে এই দরস পাওয়া যায়নি — পাতা রিফ্রেশ করুন',
    too_early: 'এখনো শুরুর সময় হয়নি',
    too_late: 'সময় পার হয়ে গেছে — জিম্মাদারকে জানান',
    already_started: 'এই দরস আগেই শুরু হয়েছে',
    not_started: 'এই দরস এখনো শুরু হয়নি',
    already_ended: 'এই দরস আগেই শেষ হয়েছে',
    auto_closed: 'অটো-বন্ধ হয়ে গেছে — জিম্মাদার সংশোধন করবেন',
    invalid_date: 'তারিখ সঠিক নয়',
    note_required: 'কারণ লিখুন',
    has_sessions: 'আজ দরস শুরু হয়ে গেছে — এখন ছুটি দেওয়া যাবে না',
    class_not_allowed: 'এই বর্ষে অনুমতি নেই',
    reason_required: 'সংশোধনের কারণ লিখুন',
    invalid_time: 'সময় সঠিক নয় — শেষ অবশ্যই শুরুর পরে',
    end_in_future: 'শেষের সময় এখনো আসেনি',
    name_required: 'নাম লিখুন',
    invalid_pin: 'পিন ৪ অঙ্কের হবে',
    pin_required: 'নতুন শিক্ষকের পিন দিন',
    class_required: 'অন্তত একটি বর্ষ বাছাই করুন',
    teacher_not_found: 'শিক্ষক পাওয়া যায়নি',
    teacher_not_allowed: 'এই শিক্ষক আপনার বিভাগের নন',
    global_not_allowed: 'সব বর্ষের ছুটি শুধু পূর্ণ অনুমতির জিম্মাদার দিতে পারেন',
    invalid_range: 'তারিখের সীমা সঠিক নয়',
    future_date: 'সামনের তারিখ দেখা যাবে না',
  };

  function errorText(code) {
    return ERRORS[code] || 'কাজটি হয়নি — আবার চেষ্টা করুন';
  }

  global.MDRHazira = {
    RULES: RULES,
    CHIP: CHIP,
    toBn: toBn,
    esc: esc,
    hm: hm,
    hmPart: hmPart,
    partOfDay: partOfDay,
    mins: mins,
    initials: initials,
    dateLabel: dateLabel,
    shortDate: shortDate,
    liveStatus: liveStatus,
    isProblem: isProblem,
    durationMin: durationMin,
    ServerClock: ServerClock,
    errorText: errorText,
  };
})(window);
