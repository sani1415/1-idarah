/**
 * বর্ষ দায়িত্বশীল — রোলিং সতর্কতা (কিতাব ৭ দিন, খুলুক ৩০ দিন, বর্ষের লog ১৫ দিন)
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    kitabDays: 7,
    khulukDays: 30,
    classLogDays: 15,
  };

  function parseIsoDay(iso) {
    if (!iso) return null;
    var s = String(iso).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  function addDays(iso, n) {
    var d = new Date(parseIsoDay(iso) + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  /** refDay সহ পিছনের count দিন (রোলিং উইন্ডো) */
  function recentDateWindow(refDay, count) {
    var out = [];
    var i;
    for (i = count - 1; i >= 0; i--) out.push(addDays(refDay, -i));
    return out;
  }

  function khulukEntryDay(k) {
    if (!k) return null;
    return parseIsoDay(k.date || k.at || k.evaluated_at || k.created_at);
  }

  function formatIsoShort(iso) {
    var d = parseIsoDay(iso);
    if (!d) return '—';
    var p = d.split('-');
    return p[2] + '/' + p[1];
  }

  function isTeacherKitabProgressEntry(entry) {
    if (!entry) return false;
    var id = String(entry.id || '');
    /* Supabase sync-এর বই স্ন্যাপশট — শিক্ষকের সাপ্তাহিক আপডেট নয় */
    if (id.slice(-8) === '_current') return false;
    return !!parseIsoDay(entry.date);
  }

  function getClassKitabBooks(classId) {
    // নিষ্ক্রিয় (এখনো শুরু হয়নি এমন) বই ডিউটি-চেক থেকে বাদ — শুধু সক্রিয় বইয়ের
    // আপডেট থাকলেই কিতাব-ডিউটি সন্তুষ্ট ধরা হবে।
    return global.API.KitabProgress.getByClass(classId).filter(function (b) { return b.is_active !== false; });
  }

  function getClassKitabLastUpdate(classId) {
    var books = getClassKitabBooks(classId);
    var max = null;
    books.forEach(function (b) {
      (b.history || []).forEach(function (h) {
        if (!isTeacherKitabProgressEntry(h)) return;
        var day = parseIsoDay(h.date);
        if (day && (!max || day > max)) max = day;
      });
    });
    return max;
  }

  function hasKitabUpdateInWindow(classId, windowSet) {
    var books = getClassKitabBooks(classId);
    var i;
    for (i = 0; i < books.length; i++) {
      var hist = books[i].history || [];
      var j;
      for (j = 0; j < hist.length; j++) {
        if (!isTeacherKitabProgressEntry(hist[j])) continue;
        var day = parseIsoDay(hist[j].date);
        if (day && windowSet[day]) return true;
      }
    }
    return false;
  }

  function windowSetFromDates(dates) {
    var set = Object.create(null);
    dates.forEach(function (d) { set[d] = true; });
    return set;
  }

  function getKhulukOverdueStudents(classId, windowSet) {
    var students = global.API.Students.getByClass(classId);
    return students.filter(function (s) {
      var rows = global.API.Khuluk.getByStudent(s.id);
      var i;
      for (i = 0; i < rows.length; i++) {
        var day = khulukEntryDay(rows[i]);
        if (day && windowSet[day]) return false;
      }
      return true;
    });
  }

  function getLatestClassLogDate(classId) {
    var logs = global.API.Logs.getByClass(classId);
    if (!logs.length) return null;
    return parseIsoDay(logs[0].date);
  }

  function computeClassDutyAlerts(classId, opts) {
    opts = opts || {};
    if (!classId || !global.API) {
      return { ok: true, today: null, items: [], overdueCount: 0 };
    }

    var today = parseIsoDay(opts.today) || (global.API.today && global.API.today()) || null;
    var kitabDays = opts.kitabDays != null ? opts.kitabDays : DEFAULTS.kitabDays;
    var khulukDays = opts.khulukDays != null ? opts.khulukDays : DEFAULTS.khulukDays;
    var classLogDays = opts.classLogDays != null ? opts.classLogDays : DEFAULTS.classLogDays;

    var items = [];
    var overdueCount = 0;

    var kitabBooks = getClassKitabBooks(classId);
    var kitabWindow = recentDateWindow(today, kitabDays);
    var kitabSet = windowSetFromDates(kitabWindow);
    var kitabLast = getClassKitabLastUpdate(classId);
    var kitabOk = !kitabBooks.length ? true : hasKitabUpdateInWindow(classId, kitabSet);

    if (kitabBooks.length && !kitabOk) {
      overdueCount++;
      items.push({
        id: 'kitab',
        severity: 'warn',
        title: 'কিতাব অগ্রগতি',
        detail: 'গত ' + kitabDays + ' দিনে (' + formatIsoShort(kitabWindow[0]) + '–' + formatIsoShort(kitabWindow[kitabWindow.length - 1]) + ') কোনো বই আপডেট হয়নি'
          + (kitabLast ? ' · সর্বশেষ ' + formatIsoShort(kitabLast) : ''),
        action: 'kitab',
        meta: {
          windowStart: kitabWindow[0],
          windowEnd: kitabWindow[kitabWindow.length - 1],
          lastDate: kitabLast,
        },
      });
    }

    var khWindow = recentDateWindow(today, khulukDays);
    var khSet = windowSetFromDates(khWindow);
    var khOverdue = getKhulukOverdueStudents(classId, khSet);

    if (khOverdue.length) {
      overdueCount++;
      items.push({
        id: 'khuluk',
        severity: 'warn',
        title: 'হুসনুল খুলুক',
        detail: 'গত ' + khulukDays + ' দিনে ' + khOverdue.length + ' জনের আপডেট হয়নি',
        action: 'khuluk-list',
        meta: {
          windowStart: khWindow[0],
          windowEnd: khWindow[khWindow.length - 1],
          students: khOverdue,
          overdueCount: khOverdue.length,
        },
      });
    }

    var logWindow = recentDateWindow(today, classLogDays);
    var logSet = windowSetFromDates(logWindow);
    var lastLog = getLatestClassLogDate(classId);
    var logOk = lastLog && logSet[lastLog];

    if (!logOk) {
      overdueCount++;
      items.push({
        id: 'class-log',
        severity: 'warn',
        title: 'বর্ষের লগ',
        detail: 'গত ' + classLogDays + ' দিনে বর্ষের সাধারণ লগ দেওয়া হয়নি'
          + (lastLog ? ' · সর্বশেষ ' + formatIsoShort(lastLog) : ''),
        action: 'log',
        meta: {
          windowStart: logWindow[0],
          windowEnd: logWindow[logWindow.length - 1],
          lastDate: lastLog,
        },
      });
    }

    return {
      ok: overdueCount === 0,
      today: today,
      items: items,
      overdueCount: overdueCount,
    };
  }

  global.MDRClassDutyAlerts = {
    DEFAULTS: DEFAULTS,
    computeClassDutyAlerts: computeClassDutyAlerts,
    formatIsoShort: formatIsoShort,
    recentDateWindow: recentDateWindow,
  };
})(typeof window !== 'undefined' ? window : global);
