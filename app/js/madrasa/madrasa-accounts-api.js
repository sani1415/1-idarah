'use strict';
/* global localStorage, window */

const MdrAccAPI = (() => {
  const SV_KEY  = 'mdr_acc_sv';
  const INC_KEY = 'mdr_acc_inc';
  const EXP_KEY = 'mdr_acc_exp';
  const DUE_KEY = 'mdr_acc_due';
  const DUE_PAY_KEY = 'mdr_acc_due_pay';
  const CAT_KEY = 'mdr_acc_cats';
  const CACHE_VERSION = 'accounts-db-v2-20260614';

  /* MONTHS in academic-year order (Ramadan = start) */
  const MONTHS = ['রমজান','শাওয়াল','জিলকদ','জিলহজ','মুহাররম','সফর',
    'রবিউল আউয়াল','রবিউস সানি','জুমাদাল উলা','জুমাদাল উখরা','রজব','শাবান'];
  const HIJRI_MONTHS = ['মুহাররম','সফর','রবিউল আউয়াল','রবিউস সানি','জুমাদাল উলা','জুমাদাল উখরা','রজব','শাবান','রমজান','শাওয়াল','জিলকদ','জিলহজ'];
  const MONTH_ALIAS = {
    'রামাযান':'রমজান',
    'রমাযান':'রমজান',
    'শাওয়াল':'শাওয়াল',
    'যিলকদ':'জিলকদ',
    'যিলক্বদ':'জিলকদ',
    'যুলকদ':'জিলকদ',
    'জিলকাদ':'জিলকদ',
    'জিলক্বদ':'জিলকদ',
    'জুলকদ':'জিলকদ',
    'যিলহাজ':'জিলহজ',
    'যিলহজ':'জিলহজ',
    'যুলহজ':'জিলহজ',
    'জিলহাজ':'জিলহজ',
    'জুলহজ':'জিলহজ',
    'মুহার্রম':'মুহাররম',
    'রবিউল আঃ':'রবিউল আউয়াল',
    'রবিউল আওয়াল':'রবিউল আউয়াল',
    'রবিউস সানিঃ':'রবিউস সানি',
    'জুমাদাল আখেরা':'জুমাদাল উখরা',
    'জুমাদাল উখরা':'জুমাদাল উখরা',
    'জমাদাল উলা':'জুমাদাল উলা',
    'জমাদাল উখরা':'জুমাদাল উখরা',
    'জমাদিউল আউয়াল':'জুমাদাল উলা',
    'জমাদিউস সানি':'জুমাদাল উখরা',
  };

  /* Islamic calendar month index: Intl month 1–12 → MONTHS index
     Intl 9=Ramadan → idx 0; formula: (intlMonth + 3) % 12 */
  const ACCOUNT_LABELS = {
    matbakh:'মাতবাখ', madrasa:'মাদরাসা', tamirat:'তামিরাত', general:'সাধারণ',
    qard:'করজে হাসানা',
    qard_return:'করজে হাসানা আদায়',
  };

  const DEFAULT_CATS = [
    'বড় বাজার','কাঁচা বাজার','দস্তরখান ভবন','রান্নাঘর সরবরাহ',
    'বিদ্যুৎ','গ্যাস/জ্বালানি','শিক্ষা উপকরণ','বেতন',
    'রক্ষণাবেক্ষণ','পরিবহন','চিকিৎসা','অন্যান্য',
  ];

  const uid   = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  const num   = (v) => Number(v) || 0;
  const load  = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const store = (k,a) => localStorage.setItem(k, JSON.stringify(a));
  const CP1252_BYTES = {
    0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85, 0x2020:0x86, 0x2021:0x87,
    0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E,
    0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97,
    0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F,
  };
  /** UTF-8 বাইটকে Latin-1/CP1252 হিসেবে ভুল পড়লে মোজিবাক; একাধিকবার এনকোড হলেও ধরা। */
  function repairUtf8Mojibake(str) {
    if (str == null || str === '') return str;
    let s = String(str);
    if (!/[ÃÂà]/.test(s)) return s;
    const bnCount = function (t) { return ((t || '').match(/[\u0980-\u09FF]/g) || []).length; };
    for (let pass = 0; pass < 8; pass++) {
      try {
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) {
          const code = s.charCodeAt(i);
          const byte = code <= 255 ? code : CP1252_BYTES[code];
          if (byte == null) return s;
          bytes[i] = byte;
        }
        const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (dec === s) break;
        s = dec;
      } catch {
        try {
          const bytes = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) {
            const code = s.charCodeAt(i);
            const byte = code <= 255 ? code : CP1252_BYTES[code];
            if (byte == null) return s;
            bytes[i] = byte;
          }
          const loose = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          if (bnCount(loose) > bnCount(s) || (bnCount(loose) > 0 && bnCount(s) === 0 && /[àâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ¿]|[\u00c0-\u00ff]{2,}/i.test(s))) {
            s = loose;
            continue;
          }
        } catch (e2) { /* ignore */ }
        break;
      }
    }
    return s;
  }
  const normText = (v) => {
    const s = repairUtf8Mojibake(String(v || ''));
    return (s.normalize ? s.normalize('NFC') : s)
      .replace(/[\u200c\u200d]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  let _monthAliasNorm = null;
  const monthAliasNorm = () => {
    if (_monthAliasNorm) return _monthAliasNorm;
    _monthAliasNorm = {};
    Object.keys(MONTH_ALIAS).forEach(k => { _monthAliasNorm[normText(k)] = MONTH_ALIAS[k]; });
    return _monthAliasNorm;
  };
  const monthKey = (m) => {
    const raw = normText(m);
    const aliased = MONTH_ALIAS[String(m || '').trim()] || monthAliasNorm()[raw] || raw;
    const canonical = normText(aliased);
    const idx = HIJRI_MONTHS.findIndex(x => normText(x) === canonical);
    return idx >= 0 ? HIJRI_MONTHS[idx] : aliased;
  };
  const monthNo = (m) => {
    const idx = HIJRI_MONTHS.indexOf(monthKey(m));
    return idx >= 0 ? idx + 1 : 0;
  };
  const monthFromNo = (m) => HIJRI_MONTHS[Math.max(1, Math.min(12, num(m))) - 1] || '';
  const systemHijriYear = () => {
    try {
      const settings = window.API && window.API.Settings && window.API.Settings.get ? window.API.Settings.get() : null;
      const y = num(en(settings && settings.hijri_year));
      if (y) return y;
    } catch (e) {}
    return todayHijri().year;
  };
  const dateYear = (year, month) => year ? num(en(year)) : (monthNo(month) <= 8 ? systemHijriYear() + 1 : systemHijriYear());
  const dateKey = (year, month, day) => String(dateYear(year, month)).padStart(4,'0') + '-' + String(monthNo(month)).padStart(2,'0') + '-' + String(num(day)).padStart(2,'0');
  /** `tools/generate_accounts_import.py` এর `GREG_HIJRI_RANGES` এর সাথে মিল রেখে: [sy,sm,sd, ey,em,ed, hijri_month, hijri_year] */
  const GREG_HIJRI_RANGES = [
    [2025, 7, 7, 2025, 8, 5, 'মুহাররম', 1447],
    [2025, 8, 6, 2025, 9, 3, 'সফর', 1447],
    [2025, 9, 4, 2025, 10, 3, 'রবিউল আউয়াল', 1447],
    [2025, 10, 4, 2025, 11, 1, 'রবিউস সানি', 1447],
    [2025, 11, 2, 2025, 11, 30, 'জুমাদাল উলা', 1447],
    [2025, 12, 1, 2025, 12, 29, 'জুমাদাল উখরা', 1447],
    [2025, 12, 30, 2026, 1, 27, 'রজব', 1447],
    [2026, 1, 28, 2026, 2, 25, 'শাবান', 1447],
    [2026, 2, 26, 2026, 3, 28, 'রমজান', 1447],
    [2026, 3, 29, 2026, 4, 26, 'শাওয়াল', 1447],
    [2026, 4, 27, 2026, 5, 25, 'জিলকদ', 1447],
    [2026, 5, 26, 2026, 6, 24, 'জিলহজ', 1447],
    [2026, 6, 25, 2026, 7, 23, 'মুহাররম', 1448],
    [2026, 7, 24, 2026, 8, 21, 'সফর', 1448],
  ];
  const _utcMidnight = (y, mo, d) => Date.UTC(y, mo - 1, d);
  /** ISO `YYYY-MM-DD` → হিজরী মাস/বছর/দিন (রেঞ্জের বাইরে হলে null) */
  const gregorianISOToHijri = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = _utcMidnight(y, mo, d);
    for (let i = 0; i < GREG_HIJRI_RANGES.length; i++) {
      const row = GREG_HIJRI_RANGES[i];
      const t0 = _utcMidnight(row[0], row[1], row[2]);
      const t1 = _utcMidnight(row[3], row[4], row[5]);
      if (t >= t0 && t <= t1) {
        const dayH = Math.min(30, Math.max(1, Math.round((t - t0) / 86400000) + 1));
        return { month: row[6], hijriYear: row[7], day: dayH };
      }
    }
    return null;
  };
  const extractGregorianISO = (x) => {
    const gRaw = x.date != null ? x.date : (x.gregorianDate != null ? x.gregorianDate : x.gregorian_date);
    if (typeof gRaw === 'string') {
      const s = gRaw.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    }
    if (gRaw && typeof gRaw.toISOString === 'function') return gRaw.toISOString().slice(0, 10);
    return '';
  };
  /** হিজরী দিন: বাংলা/আরবি/ইংরেজি সংখ্যা স্ট্রিং থেকে ১–৩০ */
  const parseHijriDay = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = num(en(String(raw).trim()));
    return (n >= 1 && n <= 30) ? n : null;
  };
  const NORM_STR_KEYS = ['description', 'category', 'supplier', 'note', 'project', 'unit', 'paymentMethod', 'receiptNo', 'rawDate', 'sourceFile', 'sourceSheet'];
  const norm = (r) => {
    const x = { ...r };
    NORM_STR_KEYS.forEach((k) => {
      if (typeof x[k] === 'string') x[k] = normText(x[k]);
    });
    let monthK = monthKey(x.month);
    let yearFor = x.hijriYear || x.year;
    let dayParsed = parseHijriDay(x.day);
    const gIso = extractGregorianISO(x);
    const mapped = gIso ? gregorianISOToHijri(gIso) : null;
    if (mapped) {
      monthK = monthKey(mapped.month);
      yearFor = mapped.hijriYear;
      dayParsed = mapped.day;
    }
    const dayForKey = dayParsed != null ? dayParsed : 0;
    const dk = dateKey(yearFor, monthK, dayForKey);
    return {
      ...x,
      month: monthK,
      hijriYear: String(dateYear(yearFor, monthK)),
      ...(dayParsed != null ? { day: dayParsed } : {}),
      dateKey: dk,
    };
  };
  const bn = (s) => String(s || '').replace(/\d/g, (d) => String.fromCharCode(0x09e6 + (+d)));
  const en = (s) => String(s || '').replace(/[০-৯٠-٩۰-۹]/g, d => {
    const b = '০১২৩৪৫৬৭৮৯'.indexOf(d); if (b >= 0) return b;
    const a = '٠١٢٣٤٥٦٧٨٩'.indexOf(d); if (a >= 0) return a;
    return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d);
  });
  const dateLabel = (r) => {
    const x = norm(r && typeof r === 'object' ? { ...r } : {});
    const dk = String(x.dateKey || dateKey(x.hijriYear, x.month, x.day));
    const fromField = parseHijriDay(x.day);
    let fromKey = null;
    const parts = dk.split('-');
    if (parts.length >= 3) fromKey = parseHijriDay(parts[2]);
    const hasDay = fromField != null || (fromKey != null && fromKey > 0);
    if (hasDay) return bn(dk);
    if (parts.length >= 2) return bn(parts[0] + '-' + parts[1]);
    return bn(dk);
  };
  const parseDateInput = (v) => { const p = en(v).trim().split(/[-/\\.]/).map(num); return p.length === 3 ? { year:p[0], month:monthFromNo(p[1]), day:p[2] } : null; };
  const toDateKey = (v) => {
    if (!v || v === 'all') return 'all';
    const p = parseDateInput(v);
    return p ? dateKey(p.year, p.month, p.day) : 'all';
  };
  const inRange = (r, from, to) => {
    from = toDateKey(from); to = toDateKey(to);
    if (from !== 'all' && to !== 'all' && from > to) { const x = from; from = to; to = x; }
    return (from === 'all' || r.dateKey >= from) && (to === 'all' || r.dateKey <= to);
  };

  function actor() {
    if (!window.MMSession) return null;
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      return { id: MMSession.getAdminUserId && MMSession.getAdminUserId(), pin: MMSession.getAdminPin && MMSession.getAdminPin() };
    }
    return { id: MMSession.getStaffUserId && MMSession.getStaffUserId(), pin: MMSession.getStaffPin && MMSession.getStaffPin() };
  }

  function remoteReady() {
    const a = actor();
    return !!(window.MMSharedAPI && MMSharedAPI.supabaseClient && a && a.pin);
  }

  function remoteActor() {
    const a = actor() || {};
    return { id: a.id || null, pin: a.pin || '' };
  }

  function cacheBootstrap(res) {
    store(INC_KEY, Array.isArray(res.incomes) ? res.incomes : []);
    store(EXP_KEY, Array.isArray(res.expenses) ? res.expenses : []);
    store(DUE_KEY, Array.isArray(res.dues) ? res.dues.map((d) => ({
      ...d,
      supplier: typeof d.supplier === 'string' ? normText(d.supplier) : d.supplier,
    })) : []);
    store(DUE_PAY_KEY, Array.isArray(res.duePayments) ? res.duePayments.map((p) => ({
      ...p,
      supplier: typeof p.supplier === 'string' ? normText(p.supplier) : p.supplier,
    })) : []);
    store(CAT_KEY, Array.isArray(res.categories) ? res.categories.map((c) => normText(String(c))) : []);
    localStorage.setItem(SV_KEY, CACHE_VERSION + '-' + Date.now());
  }

  function isLocalCacheWarm() {
    try {
      return String(localStorage.getItem(SV_KEY) || '').indexOf(CACHE_VERSION + '-') === 0;
    } catch (e) {
      return false;
    }
  }

  function clearLocalCache() {
    [SV_KEY, INC_KEY, EXP_KEY, DUE_KEY, DUE_PAY_KEY, CAT_KEY].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  async function bootstrapRemote(options) {
    if (!options || !options.force) {
      if (isLocalCacheWarm() && remoteReady()) return true;
    }
    if (!remoteReady()) return false;
    const a = remoteActor();
    const res = await MMSharedAPI.accountsBootstrap(a.id, a.pin);
    if (!res || !res.ok) throw new Error((res && res.error) || 'accounts_bootstrap_failed');
    cacheBootstrap(res);
    return true;
  }

  async function remoteRefreshAfter(res) {
    if (!res || !res.ok) throw new Error((res && res.error) || 'accounts_save_failed');
    await bootstrapRemote({ force: true });
    return res;
  }

  async function remoteCall(fn) {
    if (!remoteReady()) return null;
    return remoteRefreshAfter(await fn(remoteActor()));
  }

  /** ধারাবাহিক বাল্ক-যোগ (Excel import): প্রতি সারিতে আলাদা bootstrap-refresh না করে সব
      আপলোডের শেষে একবার refresh হয়। মাঝপথে ব্যর্থ হলে err.uploadedCount-এ কতটি সারি
      সার্ভারে পৌঁছেছে তা থাকে, আর finally-র bootstrap লোকাল ক্যাশ সার্ভারের সাথে মিলিয়ে
      দেয় — ফলে ব্যর্থ সারিগুলো লোকাল ক্যাশেও থেকে যায় না। */
  async function bulkAddRows(storeKey, prefix, upsert, list, onProgress) {
    const entries = (list || []).map((d, i) => norm({ id: uid(prefix) + i.toString(36), ...d, _at: Date.now() }));
    if (!entries.length) return entries;
    const a = load(storeKey);
    entries.forEach((e) => a.push(e));
    store(storeKey, a);
    if (!remoteReady()) return entries;
    const ra = remoteActor();
    let done = 0;
    try {
      for (const e of entries) {
        const res = await upsert(ra, e);
        if (!res || !res.ok) {
          const err = new Error((res && res.error) || 'accounts_save_failed');
          err.uploadedCount = done;
          throw err;
        }
        done++;
        if (onProgress) { try { onProgress(done, entries.length); } catch (e2) {} }
      }
    } finally {
      try { await bootstrapRemote({ force: true }); } catch (e3) {}
    }
    return entries;
  }

  /** One server transaction: no local state changes before every imported row,
      supplier due, payment and category has been committed. */
  async function importBatch(payload) {
    if (!remoteReady()) throw new Error('server_connection_required');
    const ra = remoteActor();
    const res = await MMSharedAPI.importAccountsBatch(ra.id, ra.pin, payload || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'accounts_import_failed');
    await bootstrapRemote({ force: true });
    return res;
  }

  /* Database is the source of truth; this no-op keeps older render calls compatible. */
  function ensureSeed() {
    return false;
  }

  /* ── Categories ── */
  const Categories = {
    getAll()        { const c = load(CAT_KEY).map((x) => normText(String(x))); return [...DEFAULT_CATS, ...c.filter(x => !DEFAULT_CATS.includes(x))]; },
    async add(name) {
      const a = load(CAT_KEY);
      if (!a.includes(name) && !DEFAULT_CATS.includes(name)) { a.push(name); store(CAT_KEY, a); }
      await remoteCall((ra) => MMSharedAPI.addAccountCategory(ra.id, ra.pin, name));
    },
    async del(name) {
      store(CAT_KEY, load(CAT_KEY).filter(c => c !== name));
      await remoteCall((ra) => MMSharedAPI.deleteAccountCategory(ra.id, ra.pin, name));
    },
    isDefault(name) { return DEFAULT_CATS.includes(name); },
  };

  /* ── Income ── */
  const Income = {
    getAll()      { return load(INC_KEY).map(norm); },
    getById(id)   { const r = load(INC_KEY).find(x => x.id === id); return r ? norm(r) : null; },
    getByMonth(m) { const mm = monthKey(m); return load(INC_KEY).filter(x => monthKey(x.month) === mm).map(norm); },
    total()           { return Income.getAll().reduce((s,x) => s + num(x.amount), 0); },
    async add(data) {
      const a = load(INC_KEY);
      const e = norm({ id: uid('inc-'), ...data, _at: Date.now() });
      a.push(e); store(INC_KEY, a);
      await remoteCall((ra) => MMSharedAPI.upsertAccountIncome(ra.id, ra.pin, e));
      return e;
    },
    bulkAdd(list, onProgress) {
      return bulkAddRows(INC_KEY, 'inc-', (ra, e) => MMSharedAPI.upsertAccountIncome(ra.id, ra.pin, e), list, onProgress);
    },
    async update(id, patch) {
      const a = load(INC_KEY);
      const idx = a.findIndex(x => x.id === id);
      if (idx < 0) return null;
      const e = norm({ ...a[idx], ...(patch || {}), id, _updatedAt: Date.now() });
      a[idx] = e; store(INC_KEY, a);
      await remoteCall((ra) => MMSharedAPI.upsertAccountIncome(ra.id, ra.pin, e));
      return e;
    },
    async del(id)     { store(INC_KEY, load(INC_KEY).filter(x => x.id !== id)); await remoteCall((ra) => MMSharedAPI.deleteAccountEntry(ra.id, ra.pin, 'income', id)); },
    months()          { return [...new Set(load(INC_KEY).map(x => monthKey(x.month)).filter(Boolean))]; },
  };

  /* ── Expense ── */
  const Expense = {
    getAll()            { return load(EXP_KEY).map(norm); },
    getById(id)         { const r = load(EXP_KEY).find(x => x.id === id); return r ? norm(r) : null; },
    getByAccount(acc)   { return load(EXP_KEY).filter(x => x.account === acc).map(norm); },
    getByMonth(m)       { const mm = monthKey(m); return load(EXP_KEY).filter(x => monthKey(x.month) === mm).map(norm); },
    getByItem(desc)     { return load(EXP_KEY).filter(x => x.description === desc).map(norm); },
    total()             { return Expense.getAll().reduce((s,x) => s + num(x.amount), 0); },
    totalByAccount(acc) { return Expense.getByAccount(acc).reduce((s,x) => s + num(x.amount), 0); },
    async add(data) {
      const a = load(EXP_KEY);
      const e = norm({ id: uid('exp-'), ...data, _at: Date.now() });
      a.push(e); store(EXP_KEY, a);
      await remoteCall((ra) => MMSharedAPI.upsertAccountExpense(ra.id, ra.pin, e));
      return e;
    },
    bulkAdd(list, onProgress) {
      return bulkAddRows(EXP_KEY, 'exp-', (ra, e) => MMSharedAPI.upsertAccountExpense(ra.id, ra.pin, e), list, onProgress);
    },
    async update(id, patch) {
      const a = load(EXP_KEY);
      const idx = a.findIndex(x => x.id === id);
      if (idx < 0) return null;
      const e = norm({ ...a[idx], ...(patch || {}), id, _updatedAt: Date.now() });
      a[idx] = e; store(EXP_KEY, a);
      await remoteCall((ra) => MMSharedAPI.upsertAccountExpense(ra.id, ra.pin, e));
      return e;
    },
    async del(id)       { store(EXP_KEY, load(EXP_KEY).filter(x => x.id !== id)); await remoteCall((ra) => MMSharedAPI.deleteAccountEntry(ra.id, ra.pin, 'expense', id)); },
    itemNames()         { const nm = new Set(); load(EXP_KEY).forEach(x => { if (x.description && num(x.quantity) > 0) nm.add(normText(x.description)); }); return [...nm].sort((a,b) => a.localeCompare(b,'bn')); },
    months()            { return [...new Set(load(EXP_KEY).map(x => monthKey(x.month)).filter(Boolean))]; },
    categories()        { return [...new Set(load(EXP_KEY).map(x => normText(x.category)).filter(Boolean))]; },
    suppliers()         { return [...new Set(load(EXP_KEY).map(x => normText(x.supplier)).filter(Boolean))]; },
  };

  /* ── Supplier Dues ── */
  const Dues = {
    getAll()   { return load(DUE_KEY).map((d) => (typeof d.supplier === 'string' ? { ...d, supplier: normText(d.supplier) } : { ...d })); },
    withDue()  { return load(DUE_KEY).filter(x => num(x.due) !== 0); },
    totalDue() { return load(DUE_KEY).reduce((s,x) => s + Math.max(0, num(x.due)), 0); },
    async recordPayment(id, amt) {
      const arr = load(DUE_KEY);
      const d = arr.find(x => x.id === id);
      if (!d) return;
      d.paid = num(d.paid) + amt;
      d.due  = num(d.total) - num(d.paid);
      store(DUE_KEY, arr);
      await remoteCall((ra) => MMSharedAPI.recordAccountDuePayment(ra.id, ra.pin, id, amt));
    },
    async addOrUpdate(supplier, account, purchaseAmt) {
      const arr = load(DUE_KEY);
      let d = arr.find(x => x.supplier === supplier && x.account === account);
      if (!d) { d = { id: uid('due-'), supplier, account, total: 0, paid: 0, due: 0 }; arr.push(d); }
      d.total = num(d.total) + purchaseAmt;
      d.due   = num(d.total) - num(d.paid);
      store(DUE_KEY, arr);
      await remoteCall((ra) => MMSharedAPI.adjustAccountDuePurchase(ra.id, ra.pin, supplier, account, purchaseAmt));
    },
    async cancelPurchase(supplier, account, purchaseAmt) {
      const arr = load(DUE_KEY);
      const d = arr.find(x => x.supplier === supplier && x.account === account);
      if (!d) return;
      d.total = Math.max(0, num(d.total) - purchaseAmt);
      d.due   = Math.max(0, num(d.due)   - purchaseAmt);
      store(DUE_KEY, arr);
      await remoteCall((ra) => MMSharedAPI.adjustAccountDuePurchase(ra.id, ra.pin, supplier, account, -Math.abs(purchaseAmt)));
    },
  };

  /* ── Hijri date settings ── */
  const Settings = {
    getHijriOffsetDays() {
      if (window.MMHijri && window.MMHijri.getOffsetDays) return window.MMHijri.getOffsetDays();
      try { return num(localStorage.getItem('mdr_acc_hijri_offset_days')); } catch (e) { return 0; }
    },
    setHijriOffsetDays(days) {
      if (window.MMHijri && window.MMHijri.setOffsetDays) return window.MMHijri.setOffsetDays(days);
      try { localStorage.setItem('mdr_acc_hijri_offset_days', String(Math.max(-3, Math.min(3, num(days))))); } catch (e) {}
      return Math.max(-3, Math.min(3, num(days)));
    },
  };

  /* ── Summary ── */
  const Summary = {
    fromRows(incomes, expenses, dues) {
      const allInc = Array.isArray(incomes) ? incomes : [];
      const allExp = Array.isArray(expenses) ? expenses : [];
      const allDues = Array.isArray(dues) ? dues : [];
      const regularIncomeRows = allInc.filter(x => x.account !== 'qard_return');
      const regularExpenseRows = allExp.filter(x => x.account !== 'qard');
      const regularIncome = regularIncomeRows.reduce((s, x) => s + num(x.amount), 0);
      const regularExpense = regularExpenseRows.reduce((s, x) => s + num(x.amount), 0);
      const qardGiven = allExp.filter(x => x.account === 'qard').reduce((s, x) => s + num(x.amount), 0);
      const qardReturned = allInc.filter(x => x.account === 'qard_return').reduce((s, x) => s + num(x.amount), 0);
      const supplierDue = allDues.reduce((s, x) => s + Math.max(0, num(x.due)), 0);
      const operatingBalance = regularIncome - regularExpense;
      const qardRemaining = Math.max(0, qardGiven - qardReturned);
      const qardOverpaid = Math.max(0, qardReturned - qardGiven);
      const cashIn = regularIncome + qardReturned;
      const cashOut = regularExpense + qardGiven;
      const cashFlow = cashIn - cashOut;
      const byAcc = {};

      Object.keys(ACCOUNT_LABELS).forEach(a => {
        const inc = regularIncomeRows.filter(x => x.account === a).reduce((s, x) => s + num(x.amount), 0);
        const exp = regularExpenseRows.filter(x => x.account === a).reduce((s, x) => s + num(x.amount), 0);
        byAcc[a] = { inc, exp, bal: inc - exp };
      });

      return {
        regularIncome,
        regularExpense,
        operatingBalance,
        supplierDue,
        qardGiven,
        qardReturned,
        qardRemaining,
        qardOverpaid,
        cashIn,
        cashOut,
        cashFlow,
        byAcc,
        /* Backward-compatible names now always mean regular operations. */
        ti: regularIncome,
        te: regularExpense,
        bal: operatingBalance,
        td: supplierDue,
      };
    },
    get(filterMonth) {
      const allInc = filterMonth ? Income.getByMonth(filterMonth) : Income.getAll();
      const allExp = filterMonth ? Expense.getByMonth(filterMonth) : Expense.getAll();
      return Summary.fromRows(allInc, allExp, Dues.getAll());
    },
  };

  /* ── Public format helpers ── */
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; }
  function fa(n)  { return bn(String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')); }
  function pct(n) { return bn(num(n)) + '%'; }
  function count(n, label) { return bn(num(n)) + (label ? ' ' + label : ''); }
  function clean(s, fallback) {
    const v = String(s || '').trim();
    return /�|\?{2,}/.test(v) ? (fallback || '') : v;
  }

  /* Today's hijri month name and day number */
  function todayHijri() {
    if (window.MMHijri && window.MMHijri.todayHijri) {
      const h = window.MMHijri.todayHijri();
      return { year: h.year, month: monthFromNo(h.monthNo), monthNo: h.monthNo, day: h.day };
    }
    try {
      const d = new Date();
      d.setDate(d.getDate() + Settings.getHijriOffsetDays());
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year:'numeric', month:'numeric', day:'numeric' }).formatToParts(d);
      const year = parseInt(parts.find(p=>p.type==='year').value);
      const m   = parseInt(parts.find(p=>p.type==='month').value);
      const day = parseInt(parts.find(p=>p.type==='day').value);
      return { year, month: monthFromNo(m), monthNo: m, day };
    } catch {
      const y = new Date().getFullYear();
      return { year: Math.max(1440, y - 579), month: monthFromNo(10), monthNo: 10, day: 1 };
    }
  }

  return { ensureSeed, bootstrapRemote, isLocalCacheWarm, clearLocalCache, remoteReady, importBatch, Income, Expense, Dues, Summary, Categories, Settings, MONTHS, HIJRI_MONTHS, ACCOUNT_LABELS, esc, bn, fa, pct, count, clean, monthKey, monthFromNo, monthNo, dateKey, dateLabel, parseDateInput, toDateKey, inRange, num, todayHijri, gregorianISOToHijri };
})();

if (typeof window !== 'undefined') {
  window.MdrAccAPI = MdrAccAPI;
}
