/* ═══════════════════════════════════════════
   জিম্মাদার — সাম্প্রতিক কার্যক্রম ফিড
   ═══════════════════════════════════════════ */
(function (global) {
  'use strict';

  const BN = '০১২৩৪৫৬৭৮৯';
  const MAX_ITEMS = 40;
  const BOOTSTRAP_TIMEOUT_MS = 45000;
  const PROGRAMS_CACHE_KEY = 'mm_programs_sc_v1';
  const programsState = { programs: [], income: {}, expense: {} };
  let lastBootstrapErrors = [];
  let cachedChatMessages = [];
  let fullBootstrapDone = false;

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error(String(label || 'task') + '_timeout'));
        }, ms);
      }),
    ]);
  }

  const CHAT_THREAD_LABELS = {
    daftar: { name: 'দফতর দায়িত্বশীল', icon: '📋' },
    hifz: { name: 'হিফজ দায়িত্বশীল', icon: '📿' },
    library: { name: 'মাকতাবা দায়িত্বশীল', icon: '📚' },
    alumni: { name: 'পুরনো ছাত্র দায়িত্বশীল', icon: '🎓' },
    khedmat: { name: 'খেদমত দায়িত্বশীল', icon: '🤝' },
  };

  function normalizeChatMessages(raw) {
    let rows = raw;
    if (typeof rows === 'string') {
      try { rows = JSON.parse(rows); } catch (e) { rows = []; }
    }
    if (!Array.isArray(rows)) rows = [];
    return rows.map((m) => ({
      id: String(m.id || ''),
      thread_id: m.thread_id || '',
      from_role: m.from_role || '',
      from_name: m.from_name || '',
      text: m.text || m.body || '',
      ts: m.ts || new Date().toISOString(),
      read_admin: !!m.read_admin,
      read_staff: !!m.read_staff,
      request: m.request || null,
    }));
  }

  function chatThreadLabel(threadId) {
    const id = String(threadId || '');
    if (CHAT_THREAD_LABELS[id]) return CHAT_THREAD_LABELS[id].name;
    if (id.startsWith('teacher-')) return 'বর্ষ দায়িত্বশীল';
    if (id.startsWith('dept-')) return 'বিভাগ দায়িত্বশীল';
    return id || 'বার্তা';
  }

  const CATEGORIES = [
    { key: 'all', label: 'সব' },
    { key: 'review', label: 'রিভিউ বাকি' },
    { key: 'madrasa', label: 'মাদ্রাসা' },
    { key: 'dept', label: 'বিভাগ' },
    { key: 'program', label: 'কর্মসূচি' },
    { key: 'khedmat', label: 'খেদমত' },
    { key: 'dars', label: 'দর্স' },
    { key: 'chat', label: 'বার্তা' },
  ];

  const TYPE_LABELS = {
    madrasa: 'মাদ্রাসা',
    dept: 'বিভাগ',
    program: 'কর্মসূচি',
    khedmat: 'খেদমত',
    dars: 'দর্স',
    chat: 'বার্তা',
    request: 'অনুরোধ',
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const bn = (v) => String(v == null ? '' : v).replace(/[0-9]/g, (d) => BN[d]);
  const num = (v) => Number(v || 0);
  const money = (v) => '৳' + bn(Math.round(num(v)).toLocaleString('en-US'));
  const todayIso = () => (global.API && API.today ? API.today() : new Date().toISOString().slice(0, 10));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function sortRecent(rows) {
    return (rows || []).slice().sort((a, b) => {
      const bd = String(b.date || b.txn_date || b.created_at || b.ts || '').slice(0, 19);
      const ad = String(a.date || a.txn_date || a.created_at || a.ts || '').slice(0, 19);
      return bd.localeCompare(ad);
    });
  }

  function isoDate(raw) {
    if (!raw) return '';
    const s = String(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (s.includes('T')) return s.slice(0, 10);
    return s.slice(0, 10);
  }

  function dateLabel(d) {
    const iso = isoDate(d);
    if (!iso) return 'তারিখ নেই';
    const p = iso.split('-');
    return bn(p[2] + '/' + p[1] + '/' + p[0]);
  }

  function dayGroupLabel(iso) {
    const d = isoDate(iso);
    if (!d) return 'তারিখ অজানা';
    const t = todayIso();
    if (d === t) return 'আজ';
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yIso = y.toISOString().slice(0, 10);
    if (d === yIso) return 'গতকাল';
    return dateLabel(d);
  }

  function formatChatLine(m) {
    const lbl = chatThreadLabel(m.thread_id);
    const body = String(m.text || '').trim();
    if (body) {
      const who = m.from_role === 'admin' ? 'জিম্মাদার' : (m.from_name || lbl);
      return `${who}: ${body}`;
    }
    const req = m.request;
    if (req && req.kind === 'student_tag') {
      const status = req.status === 'approved' ? 'সমাধান হয়েছে' : req.status === 'rejected' ? 'বাতিল' : 'অপেক্ষমান';
      return `${lbl} — 🏷️ ছাত্র ট্যাগ: ${req.studentName || ''} (${status})`;
    }
    if (req && req.kind) {
      const status = req.status === 'approved' ? 'অনুমোদিত' : req.status === 'rejected' ? 'রিজেক্ট' : 'অপেক্ষমান';
      const kind = String(req.kind).includes('edit') ? 'সম্পাদনা অনুরোধ' : 'মুছে ফেলার অনুরোধ';
      const reason = req.reason ? ': ' + req.reason : '';
      return `${lbl} — ${kind} (${status})${reason}`;
    }
    return '';
  }

  function canSeeLog(log) {
    if (!global.MMSession || !MMSession.isRestrictedAdmin()) return true;
    if (!global.API) return false;
    const cids = new Set(
      MMSession.getAllowedMadrasaDepts().flatMap((dept) =>
        API.Classes.getByDept(dept).map((c) => c.id)
      )
    );
    if (log.type === 'class') return cids.has(log.ref_id);
    if (log.type === 'student') {
      const s = API.Students.getById(log.ref_id);
      return !!(s && cids.has(s.class_id));
    }
    if (log.type === 'teacher') {
      const t = API.Teachers.getById(log.ref_id);
      return !!(t && t.class_id && cids.has(t.class_id));
    }
    return false;
  }

  function logContext(log) {
    if (!global.API) return '';
    if (log.type === 'student') {
      const s = API.Students.getById(log.ref_id);
      return s ? s.name : '';
    }
    if (log.type === 'teacher') {
      const t = API.Teachers.getById(log.ref_id);
      return t ? t.name : '';
    }
    if (log.type === 'class') {
      const c = API.Classes.getById(log.ref_id);
      return c ? c.name : '';
    }
    return '';
  }

  function latestKitabSnapshots(limit) {
    if (!global.API) return [];
    const cap = limit || 12;
    const rows = [];
    (API.Classes.getAll() || []).forEach(function (c) {
      (API.KitabProgress.getByClass(c.id) || []).forEach(function (k) {
        if (!k.last_updated || !Number(k.pages_done)) return;
        rows.push({
          category: 'dars',
          date: k.last_updated,
          text: c.name + ' — ' + k.name + ': ' + bn(k.pages_done) + ' পৃষ্ঠা সম্পন্ন',
          meta: c.name,
          href: '/madrasa/admin/dars.html',
          color: '#5b4d9a',
        });
      });
    });
    return rows
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); })
      .slice(0, cap);
  }

  function programsCacheActorKey(actorId, pin) {
    return String(actorId || '') + ':' + String(pin || '');
  }

  function hydrateProgramsFromSessionCache(actorId, pin) {
    try {
      var raw = sessionStorage.getItem(PROGRAMS_CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.actor !== programsCacheActorKey(actorId, pin) || !Array.isArray(parsed.programs)) return false;
      programsState.programs = parsed.programs || [];
      programsState.income = parsed.income || {};
      programsState.expense = parsed.expense || {};
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasDeptCache() {
    return !!(global.DeptAPI && DeptAPI.Departments && DeptAPI.Departments.getAll().length &&
      DeptAPI.Transactions && DeptAPI.Transactions.getAll().length);
  }

  function hasKhedmatCache() {
    return !!(global.KhAPI && KhAPI.Beneficiaries && KhAPI.Beneficiaries.getAll().length);
  }

  function hasProgramsCache() {
    return !!(programsState.programs && programsState.programs.length);
  }

  function seedChatFromLocal() {
    var chatApi = global.ChatAPI || globalThis.ChatAPI;
    if (!chatApi || !chatApi.getRecentMessages) return 0;
    var rows = chatApi.getRecentMessages(50);
    if (!rows.length) return 0;
    cachedChatMessages = rows.slice();
    return cachedChatMessages.length;
  }

  function prepareLocalCaches(opts) {
    opts = opts || {};
    hydrateProgramsFromSessionCache(opts.actorId, opts.pin);
    seedChatFromLocal();
  }

  function hasAnyFeedData() {
    if (global.API && API.Logs && API.Logs.getAll().length) return true;
    if (hasDeptCache()) return true;
    if (hasProgramsCache()) return true;
    if (hasKhedmatCache()) return true;
    if (cachedChatMessages.length) return true;
    return false;
  }

  function programFinance() {
    const programs = programsState.programs || [];
    const incomeRows = programs.flatMap((p) =>
      (programsState.income[p.id] || []).map((r) => ({ ...r, programName: p.name }))
    );
    const expenseRows = programs.flatMap((p) =>
      (programsState.expense[p.id] || []).map((r) => ({ ...r, programName: p.name }))
    );
    return { incomeRows, expenseRows };
  }

  async function tryTask(label, fn, errors, timeoutMs) {
    try {
      await withTimeout(fn(), timeoutMs || BOOTSTRAP_TIMEOUT_MS, label);
    } catch (e) {
      console.warn('[Recent]', label, e);
      errors.push({ label: label, message: (e && e.message) || String(e) });
    }
  }

  async function syncChatForFeed(opts) {
    return withTimeout(syncChatForFeedInner(opts), 30000, 'chat');
  }

  async function syncChatForFeedInner(opts) {
    const chatPin = opts.chatPin || opts.pin || '';
    const chatActorId = opts.chatActorId != null ? opts.chatActorId : opts.actorId;
    if (!chatPin) throw new Error('chat_pin_missing');

    const chatApi = global.ChatAPI || globalThis.ChatAPI;
    if (chatApi && chatApi.syncRemote) {
      const syncRes = await chatApi.syncRemote(chatActorId, chatPin, true);
      if (!syncRes || syncRes.ok !== true) {
        throw new Error((syncRes && syncRes.error) || 'chat_sync_failed');
      }
      cachedChatMessages = chatApi.getRecentMessages
        ? chatApi.getRecentMessages(50)
        : [];
      return { count: cachedChatMessages.length };
    }

    if (!global.MMSharedAPI || !MMSharedAPI.chatBootstrap) {
      throw new Error('chat_not_configured');
    }
    const res = await MMSharedAPI.chatBootstrap(chatActorId || null, chatPin, true);
    if (!res || res.ok !== true) {
      throw new Error((res && res.error) || 'chat_sync_failed');
    }
    cachedChatMessages = normalizeChatMessages(res.messages)
      .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    return { count: cachedChatMessages.length };
  }

  function getCachedChatCount() {
    return cachedChatMessages.length;
  }

  async function bootstrapAll(options) {
    const opts = options || {};
    const pin = opts.pin || '';
    const actorId = opts.actorId || null;
    const restricted = !!opts.restricted;
    const force = !!opts.force;
    const scope = opts.scope || 'full';
    const skipMadrasa = !!opts.skipMadrasa;
    const errors = [];

    hydrateProgramsFromSessionCache(actorId, pin);
    seedChatFromLocal();

    if (scope === 'full' && fullBootstrapDone && !force) {
      return { errors: lastBootstrapErrors.slice(), programs: programsState };
    }

    const tasks = [];

    if ((scope === 'minimal' || (scope === 'full' && !skipMadrasa))) {
      tasks.push(['madrasa', async function () {
        if (!global.MDRSupabaseSync || !pin) return;
        if (!force && global.API && API.isSessionCacheWarm && API.isSessionCacheWarm()) return;
        if (global.MDRSupabaseSync.ensureAdminBootstrap) {
          await MDRSupabaseSync.ensureAdminBootstrap({ force: force });
          return;
        }
        await MDRSupabaseSync.syncAdminUsers(force ? { force: true } : undefined);
        await MDRSupabaseSync.syncAdminStudents(force ? { force: true } : undefined);
        if (!restricted) await MDRSupabaseSync.syncAdminDars(force ? { force: true } : undefined);
      }]);
    }

    if (scope === 'full' && !restricted) {
      tasks.push(['dept', async function () {
        if (!global.DeptSync) return;
        if (!force && hasDeptCache()) return;
        await DeptSync.bootstrapAllData(null, pin);
      }]);
      tasks.push(['programs', async function () {
        if (!force && hasProgramsCache()) return;
        if (!global.MMSharedAPI || !MMSharedAPI.programsBootstrap) return;
        const res = await MMSharedAPI.programsBootstrap(actorId, pin);
        if (!res || res.ok !== true) throw new Error((res && res.error) || 'program_bootstrap_failed');
        programsState.programs = res.programs || [];
        programsState.income = res.income || {};
        programsState.expense = res.expense || {};
      }]);
      tasks.push(['khedmat', async function () {
        if (!global.KhAPI) return;
        if (!force && hasKhedmatCache()) return;
        await KhAPI.bootstrapRemote(actorId, pin);
      }]);
    }

    if (tasks.length) {
      await Promise.all(tasks.map(function (pair) {
        return tryTask(pair[0], pair[1], errors);
      }));
    }

    if (scope === 'full' && !restricted) {
      await tryTask('chat', function () { return syncChatForFeedInner(opts); }, errors, 30000);
      fullBootstrapDone = true;
    }

    lastBootstrapErrors = errors;
    return { errors: errors, programs: programsState };
  }

  function buildFeed(options) {
    const opts = options || {};
    const restricted = !!opts.restricted;
    const filter = opts.filter || 'all';
    const limit = opts.limit == null ? MAX_ITEMS : opts.limit;
    const items = [];
    const needMadrasa = filter === 'all' || filter === 'madrasa';
    const needDept = !restricted && (filter === 'all' || filter === 'dept');
    const needProgram = !restricted && (filter === 'all' || filter === 'program');
    const needKhedmat = !restricted && (filter === 'all' || filter === 'khedmat');
    const needDars = !restricted && (filter === 'all' || filter === 'dars');
    const needChat = !restricted && (filter === 'all' || filter === 'chat');

    if (needMadrasa && global.API) {
      API.Logs.getAll()
        .filter(canSeeLog)
        .slice(0, restricted ? 25 : 15)
        .forEach((l) => {
          const ctx = logContext(l);
          const prefix = [l.by, ctx].filter(Boolean).join(' · ');
          items.push({
            id: 'log_' + (l.id || uid()),
            category: 'madrasa',
            date: isoDate(l.date),
            text: (prefix ? prefix + ' — ' : '') + (l.text || ''),
            meta: l.type === 'student' ? 'ছাত্র নোট' : l.type === 'teacher' ? 'শিক্ষক' : l.type === 'class' ? 'বর্ষ' : 'নোট',
            href: '/admin/madrasa.html',
            color: 'var(--blue)',
          });
        });
    }

    if (needDept && global.DeptAPI) {
      sortRecent(DeptAPI.Transactions.getAll())
        .slice(0, 20)
        .forEach((t) => {
          const dept = DeptAPI.Departments.getById(t.dept_id);
          const isIncome = t.type === 'income';
          items.push({
            id: 'txn_' + (t.id || uid()),
            category: 'dept',
            date: isoDate(t.date || t.txn_date),
            text: `${dept ? dept.name : 'বিভাগ'} — ${t.description || t.category || 'লেনদেন'} ${money(t.amount)}`,
            meta: isIncome ? 'আয়' : 'ব্যয়',
            href: '/admin/dept.html',
            color: isIncome ? 'var(--green)' : 'var(--red)',
          });
        });

      sortRecent(DeptAPI.EditRequests.getPending())
        .slice(0, 10)
        .forEach((r) => {
          const dept = DeptAPI.Departments.getById(r.dept_id);
          items.push({
            id: 'req_' + (r.id || uid()),
            category: 'request',
            date: isoDate(r.created_at),
            text: `${dept ? dept.name : 'বিভাগ'} — সম্পাদনা অনুরোধ: ${r.reason || 'কারণ উল্লেখ নেই'}`,
            meta: 'অনুমোদন বাকি',
            href: '/admin/dept.html',
            color: 'var(--gold)',
          });
        });
    }

    if (needProgram && !restricted) {
      const { incomeRows, expenseRows } = programFinance();
      sortRecent(
        incomeRows.map((r) => ({ ...r, _progKind: 'income' }))
          .concat(expenseRows.map((r) => ({ ...r, _progKind: 'expense' })))
      )
        .slice(0, 15)
        .forEach((r) => {
          const isIncome = r._progKind === 'income';
          items.push({
            id: 'prog_' + (r.id || uid()),
            category: 'program',
            date: isoDate(r.date),
            text: `${r.programName || 'কর্মসূচি'} — ${r.note || r.description || r.type || 'এন্ট্রি'} ${money(r.amount)}`,
            meta: isIncome ? 'আয়' : 'ব্যয়',
            href: '/madrasa/admin/accounts.html?view=prog',
            color: 'var(--gold)',
          });
        });
    }

    if (needKhedmat && global.KhAPI) {
      KhAPI.DailyLogs.getAll()
        .slice(0, 5)
        .forEach((log) => {
          items.push({
            id: 'khlog_' + (log.id || log.date || uid()),
            category: 'khedmat',
            date: isoDate(log.date),
            text: 'দৈনিক লগ: ' + (log.content || ''),
            meta: log.by || 'খেদমত',
            href: '/admin/khedmat.html',
            color: 'var(--gold)',
          });
        });

      KhAPI.Activities.getAll()
        .slice(0, 12)
        .forEach((a) => {
          const ben = KhAPI.Beneficiaries.getById(a.beneficiary_id);
          items.push({
            id: 'khact_' + (a.id || uid()),
            category: 'khedmat',
            date: isoDate(a.date),
            text: `${ben ? ben.name : '—'} — ${a.title || 'সেবা'}${a.amount ? ' ' + money(a.amount) : ''}`,
            meta: a.description || 'সেবা কার্যক্রম',
            href: '/admin/khedmat.html',
            color: 'var(--teal)',
          });
        });

      KhAPI.Finance.getAll()
        .slice(0, 10)
        .forEach((f) => {
          items.push({
            id: 'khfn_' + (f.id || uid()),
            category: 'khedmat',
            date: isoDate(f.date),
            text: `${f.type === 'income' ? 'আয়' : 'ব্যয়'} — ${f.note || f.source || 'হিসাব'} ${money(f.amount)}`,
            meta: 'খেদমত হিসাব',
            href: '/admin/khedmat.html',
            color: f.type === 'income' ? 'var(--green)' : 'var(--red)',
          });
        });
    }

    if (needDars) {
      latestKitabSnapshots(12).forEach((row) => {
        items.push({
          id: 'dars_' + uid(),
          category: row.category,
          date: isoDate(row.date),
          text: row.text,
          meta: row.meta,
          href: row.href,
          color: row.color,
        });
      });
    }

    if (needChat && cachedChatMessages.length) {
      const chatLimit = filter === 'chat' ? 30 : 20;
      cachedChatMessages.slice(0, chatLimit).forEach((m) => {
        const line = formatChatLine(m);
        if (!line) return;
        const lbl = chatThreadLabel(m.thread_id);
        const unreadNote = m.from_role !== 'admin' && !m.read_admin ? ' · অপঠিত' : '';
        items.push({
          id: 'chat_' + (m.id || m.thread_id),
          category: 'chat',
          date: isoDate(m.ts),
          text: line,
          meta: lbl + unreadNote,
          href: '/chat.html?thread=' + encodeURIComponent(m.thread_id || ''),
          color: 'var(--ink2)',
        });
      });
    }

    const filtered = items
      .filter((it) => it.text && String(it.text).trim())
      .filter((it) => {
        if (filter === 'all') return true;
        if (filter === 'dept') return it.category === 'dept' || it.category === 'request';
        return it.category === filter;
      });

    const cap = filter === 'chat' ? Math.max(limit, 30) : limit;
    return sortRecent(filtered)
      .slice(0, cap)
      .map((it) => ({
        ...it,
        typeLabel: TYPE_LABELS[it.category] || it.category,
        dateDisplay: dateLabel(it.date),
        dayGroup: dayGroupLabel(it.date),
      }));
  }

  function getCategories() {
    return CATEGORIES.slice();
  }

  function getLastErrors() {
    return lastBootstrapErrors.slice();
  }

  global.AdminRecentFeed = {
    bootstrapAll,
    syncChatForFeed,
    getCachedChatCount,
    buildFeed,
    getCategories,
    getLastErrors,
    prepareLocalCaches,
    hasAnyFeedData,
    esc,
    bn,
    money,
    dateLabel,
    dayGroupLabel,
    MAX_ITEMS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
