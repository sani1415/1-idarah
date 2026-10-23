/**
 * হিজরী (Umm al-Qura) + বাংলা গ্রিগরিয়ান — পুরো অ্যাপে পুনঃব্যবহারযোগ্য।
 * ব্রাউজারে Intl islamic-umalqura সাপোর্ট না থাকলে গ্রিগরিয়ান বাংলায় ফলব্যাক।
 */
(function (global) {
  const BN_DIG = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  const GR_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const BN_DOW = ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
  const OFFSET_KEY = 'mm_hijri_offset_days';

  function toBn(n) { return String(n).replace(/[0-9]/g, d => BN_DIG[d]); }
  function num(v) { return Number(v) || 0; }
  function clampOffset(days) { return Math.max(-3, Math.min(3, num(days))); }
  function getLocalOffset() {
    try {
      const oldAccountsOffset = global.localStorage && global.localStorage.getItem('mdr_acc_hijri_offset_days');
      const sharedOffset = global.localStorage && global.localStorage.getItem(OFFSET_KEY);
      return clampOffset(sharedOffset != null ? sharedOffset : oldAccountsOffset);
    } catch (e) {
      return 0;
    }
  }
  function getOffsetDays() {
    try {
      const s = global.API && global.API.Settings && global.API.Settings.get ? global.API.Settings.get() : null;
      if (s && s.hijri_offset_days != null && String(s.hijri_offset_days).trim() !== '') {
        return clampOffset(s.hijri_offset_days);
      }
    } catch (e) {}
    return getLocalOffset();
  }
  function setOffsetDays(days) {
    const next = clampOffset(days);
    try {
      if (global.localStorage) global.localStorage.setItem(OFFSET_KEY, String(next));
      if (global.API && global.API.Settings && global.API.Settings.get && global.API.Settings.save) {
        const s = global.API.Settings.get();
        global.API.Settings.save({ ...s, hijri_offset_days: next });
      }
    } catch (e) {}
    return next;
  }
  function isoFromDate(d) {
    return d.toISOString().split('T')[0];
  }
  function applyOffset(iso, offsetDays) {
    if (!iso) return iso;
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + (offsetDays == null ? getOffsetDays() : clampOffset(offsetDays)));
    return isoFromDate(d);
  }
  function gregorianLongBn(iso) {
    const d = new Date(iso + 'T12:00:00');
    return toBn(d.getDate()) + ' ' + GR_MONTHS[d.getMonth()] + ' ' + toBn(d.getFullYear());
  }
  function weekdayBn(iso) { return BN_DOW[new Date(iso + 'T12:00:00').getDay()]; }

  function fmtPartsNoEra(fmt, d) {
    return fmt.formatToParts(d).filter(p => p.type !== 'era').map(p => p.value).join('').trim();
  }

  /** প্রধান: হিজরী (বাংলা সংখ্যা) — Umm al-Qura */
  function hijriUmmalquraLongBn(iso, opts) {
    if (!iso) return null;
    try {
      const effectiveIso = opts && opts.skipOffset ? iso : applyOffset(iso, opts && opts.offsetDays);
      const d = new Date(effectiveIso + 'T12:00:00');
      if (isNaN(d.getTime())) return null;
      const fmt = new Intl.DateTimeFormat('bn-BD', {
        calendar: 'islamic-umalqura',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        numberingSystem: 'beng',
      });
      return fmtPartsNoEra(fmt, d) || null;
    } catch (e) {
      return null;
    }
  }

  function hijriOrFallback(iso, opts) {
    const h = hijriUmmalquraLongBn(iso, opts);
    if (h) return h;
    try {
      const effectiveIso = opts && opts.skipOffset ? iso : applyOffset(iso, opts && opts.offsetDays);
      const d = new Date(effectiveIso + 'T12:00:00');
      const fmt = new Intl.DateTimeFormat('bn-BD', {
        calendar: 'islamic',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        numberingSystem: 'beng',
      });
      return fmtPartsNoEra(fmt, d) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * @returns {{ primary: string, secondary: string, hijriOk: boolean, weekday: string }}
   * primary  = হিজরী (বা ফলব্যাকে বাংলা গ্রিগরিয়ান)
   * secondary= ছোট লাইন: গ্রিগরিয়ান (বাংলা) — “গ্রিগরিয়ান: …”
   */
  function dualLine(iso, opts) {
    const weekday = weekdayBn(iso);
    const h = hijriOrFallback(iso, opts);
    const g = gregorianLongBn(iso);
    if (h) {
      return { primary: h, secondary: 'গ্রিগরিয়ান: ' + g, hijriOk: true, weekday };
    }
    return { primary: g, secondary: '', hijriOk: false, weekday };
  }
  function formatIsoDualBn(iso, opts) {
    const d = dualLine(iso, opts);
    return d.secondary ? d.primary + ' · ' + d.secondary : d.primary;
  }
  function shortHijriBn(iso, opts) {
    try {
      const effectiveIso = opts && opts.skipOffset ? iso : applyOffset(iso, opts && opts.offsetDays);
      const d = new Date(effectiveIso + 'T12:00:00');
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day:'numeric', month:'numeric', year:'numeric' }).formatToParts(d);
      const get = t => parts.find(p => p.type === t)?.value || '';
      const hd = parseInt(get('day'), 10);
      const hm = parseInt(get('month'), 10);
      const hy = parseInt(get('year'), 10);
      if (isNaN(hd) || isNaN(hm) || isNaN(hy)) return '';
      return toBn(hd) + '/' + toBn(hm) + '/' + toBn(hy % 100);
    } catch (e) {
      return '';
    }
  }
  /** খ্রিস্টীয় ISO তারিখ → হিজরী সংখ্যা { year, monthNo, day } — «হিজরী তারিখ সমন্বয়» ধরে
      (opts.skipOffset / opts.offsetDays দিয়ে বদলানো যায়)। Intl না থাকলে null। */
  function hijriOf(iso, opts) {
    if (!iso) return null;
    try {
      const eff = opts && opts.skipOffset ? iso : applyOffset(iso, opts && opts.offsetDays);
      const d = new Date(eff + 'T12:00:00');
      if (isNaN(d.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year:'numeric', month:'numeric', day:'numeric' }).formatToParts(d);
      const pick = (t) => { const p = parts.find(x => x.type === t); return p ? parseInt(p.value, 10) : NaN; };
      const year = pick('year'), monthNo = pick('month'), day = pick('day');
      return (year && monthNo && day) ? { year, monthNo, day } : null;
    } catch (e) {
      return null;
    }
  }
  function todayHijri() {
    const h = hijriOf(isoFromDate(new Date()));
    if (h) return h;
    const y = new Date().getFullYear();
    return { year: Math.max(1440, y - 579), monthNo: 10, day: 1 };
  }

  global.MMHijri = {
    toBn,
    gregorianLongBn,
    weekdayBn,
    getOffsetDays,
    setOffsetDays,
    applyOffset,
    todayHijri,
    hijriOf,
    hijriUmmalquraLongBn,
    dualLine,
    hijriOrFallback,
    formatIsoDualBn,
    shortHijriBn,
  };
})(typeof window !== 'undefined' ? window : this);
