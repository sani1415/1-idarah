/* ════════════════════════════════════════════
   কর্মসূচি হিসাব — madrasa-kormosuchi.js
   দফতর দায়িত্বশীলের বিশেষ কর্মসূচি আয়-ব্যয় ব্যবস্থাপনা
   ════════════════════════════════════════════ */

/* ── HELPERS ── */
const todayISO = () => new Date().toISOString().split('T')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RECEIPT_BUCKET = 'mdr-program-receipts';
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const RECEIPT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const bn = x => String(x ?? 0).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
const money = x => '৳' + bn(Number(x || 0).toLocaleString('en-US'));
const jsq = x => String(x ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const fmtDate = d => {
  if (!d) return '';
  if (window.MMHijri && MMHijri.shortHijriBn) {
    const h = MMHijri.shortHijriBn(d);
    if (h) return h;
  }
  const [y, m, dd] = d.split('-');
  return bn(dd) + '/' + bn(m) + '/' + bn(y.slice(2));
};

/* ── TYPE PRESETS ── */
const DEFAULTS = () => ({
  presets: {
    qurbani: {
      label: 'কোরবানি',
      note: 'হিস্যা ও আংশিক টাকার হিসাব।',
      incomeTypes: ['হিস্যা', 'আংশিক টাকা'],
      expenseTypes: ['গরু ক্রয়', 'পরিবহন', 'খাদ্য', 'কসাই / জবাই', 'অন্যান্য'],
    },
    mahfil: {
      label: 'মাহফিল',
      note: 'মাহফিলের অনুদান ও ব্যয়।',
      incomeTypes: ['অনুদান', 'কালেকশন', 'স্পন্সর'],
      expenseTypes: ['মাইক / সাউন্ড', 'খাবার', 'মেহমানদারি', 'স্টেজ', 'অন্যান্য'],
    },
    construction: {
      label: 'নির্মাণ',
      note: 'নির্মাণ ও মেরামতের আয়-ব্যয়।',
      incomeTypes: ['অনুদান', 'প্রতিশ্রুতি আদায়', 'বিশেষ ফান্ড'],
      expenseTypes: ['সিমেন্ট', 'বালু', 'ইট', 'রড', 'মিস্ত্রি / শ্রমিক', 'অন্যান্য'],
    },
    trip: {
      label: 'সফর',
      note: 'সফরের ফি ও ব্যয়।',
      incomeTypes: ['অংশগ্রহণ ফি', 'অনুদান'],
      expenseTypes: ['গাড়ি', 'খাবার', 'টিকিট', 'থাকা', 'অন্যান্য'],
    },
    custom: {
      label: 'কাস্টম',
      note: 'সাধারণ কর্মসূচির হিসাব।',
      incomeTypes: ['আয়', 'অনুদান', 'অন্যান্য'],
      expenseTypes: ['ব্যয়', 'অন্যান্য'],
    },
  },
  programs: [],
  income: {},
  expense: {},
});

/* ── STATE ── */
let db = { programs: [], income: {}, expense: {}, attachments: {} };
let active;
let activeTab = 'income';
let rptRange  = 'all';
let _confirmCb = null;
let dbReady = false;
let readOnly = false;
let loadError = '';

/* ── DB ── */
function uniqList(list, fallback) {
  const seen = new Set();
  const out = (Array.isArray(list) ? list : []).map(x => String(x || '').trim()).filter(Boolean).filter(x => {
    if (seen.has(x)) return false;
    seen.add(x); return true;
  });
  return out.length ? out : fallback.slice();
}

function linesToTypes(value, fallback) {
  return uniqList(String(value || '').split(/\r?\n|,/), fallback);
}

function typesToLines(list) {
  return (Array.isArray(list) ? list : []).join('\n');
}

function defaultTypesForProgram(p) {
  const d = DEFAULTS();
  const key = p && p.template;
  return (key && d.presets[key]) || d.presets.custom;
}

function programHasShares(p) {
  return p && (p.shareEnabled === true || p.shareEnabled === 'true');
}

function programRequiresDonorName(p) {
  return !(p && (p.donorNameRequired === false || p.donorNameRequired === 'false'));
}

function ensureProgramShape(p) {
  const src = defaultTypesForProgram(p);
  p.incomeTypes = uniqList(p.incomeTypes || src.incomeTypes, src.incomeTypes);
  p.expenseTypes = uniqList(p.expenseTypes || src.expenseTypes, src.expenseTypes);
  p.shareEnabled = programHasShares(p);
  p.donorNameRequired = programRequiresDonorName(p);
  delete p.template;
  return p;
}

function emptyDb() { return { programs: [], income: {}, expense: {}, attachments: {} }; }

function currentActor() {
  if (!window.MMSession) return null;
  if (MMSession.isAdmin && MMSession.isAdmin()) {
    return {
      id: MMSession.getAdminUserId && MMSession.getAdminUserId(),
      pin: MMSession.getAdminPin && MMSession.getAdminPin(),
    };
  }
  return {
    id: MMSession.getStaffUserId && MMSession.getStaffUserId(),
    pin: MMSession.getStaffPin && MMSession.getStaffPin(),
  };
}

function remoteReady() {
  const a = currentActor();
  return !!(window.MMSharedAPI && MMSharedAPI.supabaseClient && a && a.pin);
}

function remoteActor() {
  const a = currentActor() || {};
  return { id: a.id || null, pin: a.pin || '' };
}

function normalizeBucket(bucket) {
  const out = {};
  if (!bucket || typeof bucket !== 'object') return out;
  Object.keys(bucket).forEach(k => {
    out[k] = Array.isArray(bucket[k]) ? bucket[k] : [];
  });
  return out;
}

const PROGRAMS_CACHE_KEY = 'mm_programs_sc_v1';

function programsCacheActorKey() {
  const a = currentActor();
  return a && a.pin ? String(a.id || '') + ':' + String(a.pin) : '';
}

function hydrateProgramsCache() {
  try {
    const raw = sessionStorage.getItem(PROGRAMS_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const key = programsCacheActorKey();
    if (!parsed || parsed.actor !== key || !Array.isArray(parsed.programs)) return false;
    db = {
      programs: parsed.programs.map(p => ensureProgramShape({ ...p })),
      income: normalizeBucket(parsed.income),
      expense: normalizeBucket(parsed.expense),
      attachments: normalizeBucket(parsed.attachments),
    };
    readOnly = !!parsed.read_only;
    active = db.programs.find(p => p.id === active) ? active : (db.programs[0] && db.programs[0].id);
    dbReady = true;
    loadError = '';
    return true;
  } catch (e) {
    return false;
  }
}

function saveProgramsCache() {
  try {
    const key = programsCacheActorKey();
    if (!key || !dbReady) return;
    sessionStorage.setItem(PROGRAMS_CACHE_KEY, JSON.stringify({
      actor: key,
      programs: db.programs,
      income: db.income,
      expense: db.expense,
      attachments: db.attachments,
      read_only: readOnly,
    }));
  } catch (e) {
    console.warn('[kormosuchi] programs cache write failed', e);
  }
}

async function dbLoad(options) {
  if (!options || !options.force) {
    if (hydrateProgramsCache()) return;
  }
  if (!remoteReady()) throw new Error('database_not_configured');
  const a = remoteActor();
  const res = await MMSharedAPI.programsBootstrap(a.id, a.pin);
  if (!res || res.ok !== true) throw new Error((res && res.error) || 'programs_bootstrap_failed');

  db = {
    programs: Array.isArray(res.programs) ? res.programs.map(p => ensureProgramShape({ ...p })) : [],
    income: normalizeBucket(res.income),
    expense: normalizeBucket(res.expense),
    attachments: normalizeBucket(res.attachments),
  };
  db.programs.forEach(p => {
    if (!db.income[p.id]) db.income[p.id] = [];
    if (!db.expense[p.id]) db.expense[p.id] = [];
  });
  readOnly = !!res.read_only;
  active = db.programs.find(p => p.id === active) ? active : (db.programs[0] && db.programs[0].id);
  dbReady = true;
  loadError = '';
  saveProgramsCache();
}

async function refreshPage() {
  await dbLoad({ force: true });
  renderPage();
}

function writeBlocked() {
  if (!dbReady) { showToast('ডাটাবেজ সংযোগ নেই'); return true; }
  if (readOnly) { showToast('এডমিন শুধু দেখতে পারবেন, পরিবর্তন করতে পারবেন না'); return true; }
  return false;
}

async function saveRemote(work, successMsg, opts = {}) {
  if (writeBlocked()) return null;
  try {
    const a = remoteActor();
    const res = await work(a);
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'save_failed');
    if (opts.activeFromResult && res.id) active = res.id;
    await refreshPage();
    if (successMsg) showToast(successMsg);
    return res;
  } catch (err) {
    console.error('[kormosuchi] database save failed', err);
    showToast('ডাটাবেজে সংরক্ষণ হয়নি');
    return null;
  }
}

/* ── ACCESSORS ── */
function program()  { return (db.programs || []).find(p => p.id === active) || (db.programs || [])[0] || null; }
function incomes()  { return active && db.income && Array.isArray(db.income[active]) ? db.income[active] : []; }
function expenses() { return active && db.expense && Array.isArray(db.expense[active]) ? db.expense[active] : []; }
function expenseAttachments(expenseId) {
  return expenseId && db.attachments && Array.isArray(db.attachments[expenseId]) ? db.attachments[expenseId] : [];
}

function activeStudents() {
  if (!window.API || !API.Students) return [];
  return API.Students.getAll().filter(s => s && s.active !== false).sort((a, b) => {
    const ac = API.Classes.getName(a.class_id) || '';
    const bc = API.Classes.getName(b.class_id) || '';
    return ac.localeCompare(bc, 'bn') || String(a.roll || '').localeCompare(String(b.roll || ''), 'bn', { numeric: true }) || String(a.name || '').localeCompare(String(b.name || ''), 'bn');
  });
}

function studentByIncome(row) {
  if (!row || !row.studentId || !window.API || !API.Students) return null;
  return API.Students.getById(row.studentId) || API.Students.getAll().find(s => s.supabase_id === row.studentId || s.permanent_id === row.studentId) || null;
}

function studentLabel(s) {
  if (!s) return '';
  const cls = API.Classes.getName(s.class_id);
  return [s.name, s.permanent_id ? 'দাখেলা ' + s.permanent_id : '', cls || '', s.roll ? 'পরিচিতি ' + s.roll : ''].filter(Boolean).join(' · ');
}

function incomeStudentPermanentId(row, student) {
  return (student && student.permanent_id) || (row && row.studentPermanentId) || '';
}

function renderIncomeName(row) {
  const s = studentByIncome(row);
  const permanentId = incomeStudentPermanentId(row, s);
  const nameHtml = s
    ? `<button type="button" class="s-name-btn" style="font-size:13px;font-weight:800" onclick="MMStudentModal.open('${jsq(s.id)}')">${API.esc(s.name)}</button>`
    : `<b>${API.esc(row.name || '—')}</b>`;
  const idHtml = permanentId
    ? `<div style="font-size:11px;color:var(--ink3);margin-top:2px">দাখেলা ${API.escBn(permanentId)}</div>`
    : '';
  return nameHtml + idHtml;
}

function expenseTypeLabel(type) {
  return String(type || '').trim() || 'সাধারণ';
}

function programNameById(id) {
  const p = (db.programs || []).find(x => x.id === id);
  return p ? p.name : '';
}

function incomeHistoryEntry(row) {
  const p = program();
  return {
    id: row.id,
    program_id: active,
    program_name: p ? p.name : '',
    date: row.date || todayISO(),
    type: row.type || '',
    amount: Number(row.amount || 0),
    share: Number(row.share || 0),
    ref: row.ref || '',
  };
}

function syncStudentProgramHistory(row, prevRow) {
  if (!window.API || !API.Students || !row) return;
  const prevSid = prevRow && prevRow.studentId;
  const nextSid = row.studentId;
  if (prevSid && prevSid !== nextSid) removeStudentProgramHistory(prevSid, row.id);
  if (!nextSid) return;
  const s = API.Students.getById(nextSid);
  if (!s) return;
  const history = Array.isArray(s.program_history) ? s.program_history.slice() : [];
  const entry = incomeHistoryEntry(row);
  const idx = history.findIndex(x => x && x.id === row.id);
  if (idx >= 0) history[idx] = entry;
  else history.push(entry);
  API.Students.update(nextSid, { program_history: history });
  addStudentProgramLog(nextSid, entry);
}

function removeStudentProgramHistory(studentId, incomeId) {
  const s = window.API && API.Students ? API.Students.getById(studentId) : null;
  if (s && Array.isArray(s.program_history)) {
    API.Students.update(studentId, { program_history: s.program_history.filter(x => x && x.id !== incomeId) });
  }
  removeStudentProgramLog(studentId, incomeId);
}

function addStudentProgramLog(studentId, entry) {
  if (!window.API || !API.Logs || !studentId || !entry) return;
  const marker = 'কর্মসূচি: ' + (entry.program_name || '—') + ' — ' + money(entry.amount) + ' (' + (entry.type || 'আয়') + ')';
  const existing = API.Logs.getByStudent(studentId).find(l => l.tag === 'program_income' && l.source_id === entry.id);
  if (existing) API.Logs.update(existing.id, { text: marker, date: entry.date || todayISO(), by: 'কর্মসূচি হিসাব' });
  else {
    const log = API.Logs.add('student', studentId, marker, 'কর্মসূচি হিসাব', 'program_income');
    API.Logs.update(log.id, { source_id: entry.id, date: entry.date || todayISO() });
  }
}

function removeStudentProgramLog(studentId, incomeId) {
  if (!window.API || !API.Logs || !API.Logs.remove || !studentId || !incomeId) return;
  API.Logs.getByStudent(studentId)
    .filter(l => l.tag === 'program_income' && l.source_id === incomeId)
    .forEach(l => API.Logs.remove(l.id));
}

function renderProgramHistoryForStudent(sid) {
  const student = window.API && API.Students ? API.Students.getById(sid) : null;
  const localIds = new Set(Array.isArray(student && student.program_history) ? student.program_history.map(x => x && x.id).filter(Boolean) : []);
  const rows = [];
  (db.programs || []).forEach(p => {
    (db.income[p.id] || []).forEach(x => {
      if (x.studentId === sid && !localIds.has(x.id)) rows.push({ ...x, programId: p.id, programName: p.name });
    });
  });
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!rows.length) return '';
  return '<div class="st-block"><h4>কর্মসূচিতে অংশগ্রহণ / অবদান</h4>' + rows.map(x => (
    '<div class="st-logline"><strong>' + API.esc(x.programName || programNameById(x.programId) || 'কর্মসূচি') + '</strong> · ' +
    API.esc(x.type || 'আয়') + ' · ' + money(x.amount) +
    (Number(x.share || 0) > 0 ? ' · হিস্যা ' + bn(x.share) : '') +
    '<small>' + API.esc(x.date || '') + (x.ref ? ' · ' + API.esc(x.ref) : '') + '</small></div>'
  )).join('') + '</div>';
}

function findAttachment(id) {
  const buckets = db.attachments || {};
  for (const expenseId of Object.keys(buckets)) {
    const row = (buckets[expenseId] || []).find(x => x.id === id);
    if (row) return row;
  }
  return null;
}

function newestFirstRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const ad = String(a && a.date || '');
    const bd = String(b && b.date || '');
    const byDate = bd.localeCompare(ad);
    if (byDate !== 0) return byDate;
    const at = Number(a && (a._updatedAt || a._at || 0)) || 0;
    const bt = Number(b && (b._updatedAt || b._at || 0)) || 0;
    if (bt !== at) return bt - at;
    return String(b && b.id || '').localeCompare(String(a && a.id || ''));
  });
}

function stats() {
  const inc = incomes(), exp = expenses();
  const income = inc.reduce((s, x) => s + Number(x.amount || 0), 0);
  const cost   = exp.reduce((s, x) => s + Number(x.amount || 0), 0);
  const shares = inc.reduce((s, x) => s + Number(x.share  || 0), 0);
  return { income, cost, balance: income - cost, shares, incCount: inc.length };
}

/* ══════════════════════════════════════════
   RENDER
══════════════════════════════════════════ */
function renderPage() {
  const p = program(), s = stats();
  const sel = document.getElementById('prog-select');
  sel.innerHTML = db.programs.map(x =>
    `<option value="${x.id}"${x.id === active ? ' selected' : ''}>${API.esc(x.name)}</option>`
  ).join('');
  sel.disabled = !dbReady || !db.programs.length;

  document.querySelectorAll('.prog-new-btn,.t4-btn').forEach(btn => {
    btn.disabled = !dbReady || readOnly || (!db.programs.length && !btn.classList.contains('prog-new-btn'));
  });

  if (!p) {
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setTxt('prog-title', dbReady ? 'কোনো কর্মসূচি নেই' : 'ডাটাবেজ সংযোগ নেই');
    setTxt('prog-note', dbReady ? 'নতুন কর্মসূচি তৈরি করলে এখানে হিসাব দেখা যাবে।' : (loadError || 'Supabase সংযোগ বা সেশন পাওয়া যায়নি।'));
    setTxt('prog-tag', dbReady ? (readOnly ? 'শুধু দেখা যাবে' : 'প্রস্তুত') : 'অফলাইন নয়');
    document.getElementById('kpi-grid').innerHTML = [
      ['মোট আয়', money(0), 'g'],
      ['মোট ব্যয়', money(0), 'r'],
      ['অবশিষ্ট', money(0), 'g'],
      ['আয় এন্ট্রি', bn(0) + 'টি', 'o'],
    ].map(([lbl, val, cls]) =>
      `<div class="kpi-card"><span>${lbl}</span><b class="${cls}">${API.esc(val)}</b></div>`
    ).join('');
    renderRoot();
    return;
  }

  const setTxt2 = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt2('prog-title', p.name);
  setTxt2('prog-note', p.note || '');
  setTxt2('prog-tag', p.status + (p.date ? ' · ' + p.date : ''));

  const hasShares = programHasShares(p);
  document.getElementById('kpi-grid').innerHTML = [
    ['মোট আয়',   money(s.income),  'g'],
    ['মোট ব্যয়', money(s.cost),    'r'],
    ['অবশিষ্ট',  money(s.balance), s.balance >= 0 ? 'g' : 'r'],
    [hasShares ? 'হিস্যা' : 'আয় এন্ট্রি', hasShares ? bn(s.shares) + ' হিস্যা' : bn(s.incCount) + 'টি', 'o'],
  ].map(([lbl, val, cls]) =>
    `<div class="kpi-card"><span>${lbl}</span><b class="${cls}">${API.esc(val)}</b></div>`
  ).join('');

  renderRoot();
}

function renderRoot() {
  const el = document.getElementById('root');
  if (!dbReady) {
    el.innerHTML = '<div class="empty-state"><div class="empty-text">ডাটাবেজ সংযোগ হলে কর্মসূচির হিসাব দেখা যাবে</div></div>';
    return;
  }
  if (!program()) {
    el.innerHTML = readOnly
      ? '<div class="empty-state"><div class="empty-text">এখনো কোনো কর্মসূচি নেই</div></div>'
      : '<div class="empty-state"><div class="empty-text">নতুন কর্মসূচি তৈরি করুন</div></div>';
    return;
  }
  if      (activeTab === 'income')  el.innerHTML = renderIncomeTab();
  else if (activeTab === 'expense') el.innerHTML = renderExpenseTab();
  else                               el.innerHTML = renderReport();
}

/* ── INCOME TAB ── */
function renderIncomeTab() {
  const rows = newestFirstRows(incomes());
  if (!rows.length) return '<div class="empty-state"><span class="empty-icon">💰</span><div class="empty-text">এখনো কোনো আয় নেই</div></div>';
  return `<div class="tbl-wrap"><table class="tbl tbl-inc">
    <thead><tr>
      <th>তারিখ</th><th>ধরন</th><th>ব্যক্তি</th><th>নাম</th><th>হিস্যা</th><th>টাকা</th><th></th>
    </tr></thead>
    <tbody>${rows.map(x => `<tr>
      <td style="color:var(--ink3)">${fmtDate(x.date)}</td>
      <td>${API.esc(x.type)}</td>
      <td style="color:var(--ink3)">${API.esc(x.personType || '')}</td>
      <td>${renderIncomeName(x)}</td>
      <td style="text-align:center">${x.share ? bn(x.share) : '—'}</td>
      <td style="color:var(--green);font-weight:700">${money(x.amount)}</td>
      <td>${readOnly ? '' : `<div class="act-btns">
        <button class="tbl-act" onclick="openIncome('${x.id}')">এডিট</button>
        <button class="tbl-del" onclick="askDel('income','${x.id}')">✕</button>
      </div>`}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ── EXPENSE TAB ── */
function renderExpenseTab() {
  const rows = newestFirstRows(expenses());
  if (!rows.length) return '<div class="empty-state"><span class="empty-icon">💸</span><div class="empty-text">এখনো কোনো ব্যয় নেই</div></div>';
  return `<div class="tbl-wrap"><table class="tbl tbl-exp">
    <thead><tr>
      <th>তারিখ</th><th>খাত</th><th>বিবরণ</th><th>রশিদ</th><th>টাকা</th><th></th>
    </tr></thead>
    <tbody>${rows.map(x => `<tr>
      <td style="color:var(--ink3)">${fmtDate(x.date)}</td>
      <td>${API.esc(expenseTypeLabel(x.type))}</td>
      <td style="color:var(--ink3)">${API.esc(x.note || '')}</td>
      <td>${renderReceiptCell(x.id)}</td>
      <td style="color:var(--red);font-weight:700">${money(x.amount)}</td>
      <td>${readOnly ? '' : `<div class="act-btns">
        <button class="tbl-act" onclick="openExpense('${x.id}')">এডিট</button>
        <button class="tbl-del" onclick="askDel('expense','${x.id}')">✕</button>
      </div>`}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderReceiptCell(expenseId) {
  const list = expenseAttachments(expenseId);
  if (!list.length) return '<span style="color:var(--ink3)">—</span>';
  const first = list[0];
  return `<button class="receipt-pill" onclick="openReceipt('${first.id}')">রশিদ ${bn(list.length)}</button>`;
}

/* ── REPORT TAB ── */
function getReportWindow() {
  if (rptRange === 'month') {
    const d = new Date(), y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
    return { from: y + '-' + m + '-01', to: todayISO() };
  }
  if (rptRange === 'custom') {
    const from = document.getElementById('rpt-from') ? document.getElementById('rpt-from').value : '';
    const to   = document.getElementById('rpt-to')   ? document.getElementById('rpt-to').value   : todayISO();
    return { from: from || todayISO().slice(0, 7) + '-01', to: to || todayISO() };
  }
  return null;
}

function renderReport() {
  const win = getReportWindow();
  let fInc = incomes().slice(), fExp = expenses().slice();
  if (win) {
    fInc = fInc.filter(x => x.date >= win.from && x.date <= win.to);
    fExp = fExp.filter(x => x.date >= win.from && x.date <= win.to);
  }
  const incTotal = fInc.reduce((s, x) => s + Number(x.amount || 0), 0);
  const expTotal = fExp.reduce((s, x) => s + Number(x.amount || 0), 0);
  const bal = incTotal - expTotal;

  const byInc = {}, byExp = {};
  fInc.forEach(x => { byInc[x.type] = (byInc[x.type] || 0) + Number(x.amount || 0); });
  fExp.forEach(x => {
    const key = expenseTypeLabel(x.type);
    byExp[key] = (byExp[key] || 0) + Number(x.amount || 0);
  });

  const customRow = rptRange === 'custom' ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="form-group"><label class="form-label">শুরু</label><input class="form-input" type="date" id="rpt-from" onchange="renderRoot()"></div>
      <div class="form-group"><label class="form-label">শেষ</label><input class="form-input" type="date" id="rpt-to" onchange="renderRoot()"></div>
    </div>` : '';

  const barBtns = ['all', 'month', 'custom'].map(r =>
    `<button class="${r === rptRange ? 'active' : ''}" onclick="setRptRange('${r}')">${r === 'all' ? 'সব' : r === 'month' ? 'এই মাস' : 'কাস্টম'}</button>`
  ).join('');

  const incRows = Object.entries(byInc).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="mini-row"><span style="font-size:13px">${API.esc(k)}</span><b style="font-family:'Tiro Bangla',serif;color:var(--green);font-weight:800">${money(v)}</b></div>`
  ).join('') || '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:8px">এই সময়ে কোনো আয় নেই</div>';

  const expRows = Object.entries(byExp).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="mini-row"><span style="font-size:13px">${API.esc(k)}</span><b style="font-family:'Tiro Bangla',serif;color:var(--red);font-weight:800">${money(v)}</b></div>`
  ).join('') || '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:8px">এই সময়ে কোনো ব্যয় নেই</div>';

  return `
    <div class="rpt-bar">${barBtns}</div>
    ${customRow}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
      <div class="kpi-card"><span>আয়</span><b class="g">${money(incTotal)}</b></div>
      <div class="kpi-card"><span>ব্যয়</span><b class="r">${money(expTotal)}</b></div>
      <div class="kpi-card"><span>অবশিষ্ট</span><b class="${bal >= 0 ? 'g' : 'r'}">${money(bal)}</b></div>
    </div>
    <div class="stt-card" style="margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:8px">আয়ের ধরনভিত্তিক</div>
      ${incRows}
    </div>
    <div class="stt-card">
      <div style="font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:8px">ব্যয়ের খাতভিত্তিক</div>
      ${expRows}
    </div>`;
}

/* ══════════════════════════════════════════
   PROGRAM MODAL
══════════════════════════════════════════ */
function newProgram() {
  if (writeBlocked()) return;
  document.getElementById('prog-modal-title').textContent = 'নতুন কর্মসূচি';
  document.getElementById('prog-edit-id').value   = '';
  document.getElementById('prog-name').value      = '';
  document.getElementById('prog-status').value    = 'চলমান';
  document.getElementById('prog-date').value      = '';
  document.getElementById('prog-note-inp').value  = '';
  document.getElementById('prog-share-enabled').checked = false;
  document.getElementById('prog-donor-required').checked = true;
  document.getElementById('prog-income-types').value = typesToLines(DEFAULTS().presets.custom.incomeTypes);
  document.getElementById('prog-expense-types').value = typesToLines(DEFAULTS().presets.custom.expenseTypes);
  document.getElementById('prog-del-btn').style.display = 'none';
  openModal('program');
}

function editProgram() {
  if (writeBlocked()) return;
  const p = program();
  if (!p) return;
  document.getElementById('prog-modal-title').textContent = 'কর্মসূচি এডিট';
  document.getElementById('prog-edit-id').value   = p.id;
  document.getElementById('prog-name').value      = p.name;
  document.getElementById('prog-status').value    = p.status;
  document.getElementById('prog-date').value      = p.date || '';
  document.getElementById('prog-note-inp').value  = p.note || '';
  document.getElementById('prog-share-enabled').checked = programHasShares(p);
  document.getElementById('prog-donor-required').checked = programRequiresDonorName(p);
  document.getElementById('prog-income-types').value = typesToLines(p.incomeTypes);
  document.getElementById('prog-expense-types').value = typesToLines(p.expenseTypes);
  document.getElementById('prog-del-btn').style.display = '';
  openModal('program');
}

async function saveProgram() {
  if (writeBlocked()) return;
  const name = document.getElementById('prog-name').value.trim();
  if (!name) { showToast('কর্মসূচির নাম দিন'); return; }
  const incomeTypes = linesToTypes(document.getElementById('prog-income-types').value, DEFAULTS().presets.custom.incomeTypes);
  const expenseTypes = linesToTypes(document.getElementById('prog-expense-types').value, DEFAULTS().presets.custom.expenseTypes);
  const id   = document.getElementById('prog-edit-id').value;
  const data = {
    name,
    status:   document.getElementById('prog-status').value,
    date:     document.getElementById('prog-date').value,
    note:     document.getElementById('prog-note-inp').value,
    shareEnabled: document.getElementById('prog-share-enabled').checked,
    donorNameRequired: document.getElementById('prog-donor-required').checked,
    incomeTypes,
    expenseTypes,
  };
  ensureProgramShape(data);
  const res = await saveRemote(a => MMSharedAPI.upsertProgram(a.id, a.pin, { id: id || '', ...data }), 'কর্মসূচি সংরক্ষিত হয়েছে ✓', { activeFromResult: true });
  if (res) closeModal('program');
}

function deleteProgram() {
  if (writeBlocked()) return;
  const id = document.getElementById('prog-edit-id').value;
  showConfirm('এই কর্মসূচি ও এর সব আয়-ব্যয় মুছে যাবে।', () => {
    return saveRemote(a => MMSharedAPI.deleteProgram(a.id, a.pin, id), 'কর্মসূচি মুছে গেছে')
      .then(res => { if (res) closeModal('program'); });
  });
}

/* ══════════════════════════════════════════
   INCOME MODAL
══════════════════════════════════════════ */
function openIncome(editId = '') {
  if (writeBlocked()) return;
  const p = program();
  if (!p) return;
  const types = uniqList(p.incomeTypes, DEFAULTS().presets.custom.incomeTypes);
  document.getElementById('inc-type').innerHTML = types.map(x =>
    `<option>${API.esc(x)}</option>`).join('');
  document.getElementById('inc-modal-title').textContent = editId ? 'আয় এডিট' : 'আয় যোগ';
  document.getElementById('inc-edit-id').value = editId;
  const r = editId ? incomes().find(x => x.id === editId) : null;
  document.getElementById('inc-date').value         = r ? (r.date || todayISO()) : todayISO();
  document.getElementById('inc-type').value         = r ? (r.type || types[0]) : types[0];
  document.getElementById('inc-person-type').value  = r ? (r.personType || 'সাধারণ মানুষ') : 'সাধারণ মানুষ';
  document.getElementById('inc-name').value         = r ? (r.name || '') : '';
  populateIncomeStudentSelect(r ? r.studentId : '');
  document.getElementById('inc-share').value        = r ? (r.share || 1) : 1;
  document.getElementById('inc-is-share').checked   = !!(r && Number(r.share || 0) > 0);
  document.getElementById('inc-amount').value       = r ? (r.amount || '') : '';
  document.getElementById('inc-ref').value          = r ? (r.ref || '') : '';
  syncIncomeStudentField();
  syncIncShareField();
  syncDonorRequirement();
  openModal('income');
}

function onIncTypeChange() { syncIncShareField(); }

function isStudentIncomeType() {
  return document.getElementById('inc-person-type') && document.getElementById('inc-person-type').value === 'ছাত্র';
}

function syncDonorRequirement() {
  const mark = document.getElementById('inc-name-required-mark');
  const name = document.getElementById('inc-name');
  const required = isStudentIncomeType() || programRequiresDonorName(program());
  if (mark) mark.style.display = required ? '' : 'none';
  if (name) name.required = required;
}

function populateIncomeStudentSelect(selectedId) {
  const input = document.getElementById('inc-student');
  const hidden = document.getElementById('inc-student-id');
  const list = document.getElementById('inc-student-list');
  if (!input || !list) return;
  const students = activeStudents();
  list.innerHTML = students.map(s =>
    `<option value="${API.esc(studentLabel(s))}"></option>`
  ).join('');
  const selected = selectedId ? findIncomeStudentById(selectedId, students) : null;
  input.value = selected ? studentLabel(selected) : '';
  if (hidden) hidden.value = selected ? selected.id : '';
}

function findIncomeStudentById(id, list) {
  const students = list || activeStudents();
  return students.find(s =>
    String(s.id) === String(id) ||
    String(s.supabase_id || '') === String(id) ||
    String(s.permanent_id || '') === String(id)
  ) || null;
}

function findIncomeStudentByPickerValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const students = activeStudents();
  const lowered = raw.toLowerCase();
  return findIncomeStudentById(raw, students) ||
    students.find(s => studentLabel(s) === raw) ||
    students.find(s => studentLabel(s).toLowerCase() === lowered) ||
    students.find(s => String(s.name || '').trim().toLowerCase() === lowered) ||
    null;
}

function selectedIncomeStudentId() {
  const hidden = document.getElementById('inc-student-id');
  if (hidden && hidden.value) return hidden.value;
  const input = document.getElementById('inc-student');
  const s = input ? findIncomeStudentByPickerValue(input.value) : null;
  return s ? s.id : '';
}

function syncIncomeStudentField() {
  const wrap = document.getElementById('inc-student-wrap');
  const name = document.getElementById('inc-name');
  const on = isStudentIncomeType();
  if (wrap) wrap.style.display = on ? 'block' : 'none';
  if (name) {
    name.readOnly = on;
    name.placeholder = on ? 'ছাত্র নির্বাচন করলে নাম বসবে' : 'দাতার নাম';
  }
  if (on) onIncomeStudentChange();
  syncDonorRequirement();
}

function onIncomeStudentChange() {
  const input = document.getElementById('inc-student');
  const hidden = document.getElementById('inc-student-id');
  const name = document.getElementById('inc-name');
  if (!input || !name || !isStudentIncomeType()) return;
  const s = findIncomeStudentByPickerValue(input.value);
  if (hidden) hidden.value = s ? s.id : '';
  name.value = s ? s.name : '';
}

function syncIncShareField() {
  const enabled = programHasShares(program());
  const opt = document.getElementById('inc-share-option');
  const chk = document.getElementById('inc-is-share');
  const wrap = document.getElementById('inc-share-wrap');
  if (opt) opt.style.display = enabled ? '' : 'none';
  if (!enabled && chk) chk.checked = false;
  if (wrap) wrap.style.display = enabled && chk && chk.checked ? '' : 'none';
}

async function saveIncome() {
  if (writeBlocked()) return;
  const studentId = isStudentIncomeType() ? selectedIncomeStudentId() : '';
  if (isStudentIncomeType() && !studentId) { showToast('তালিকা থেকে ছাত্র নির্বাচন করুন'); return; }
  if (studentId) onIncomeStudentChange();
  const name   = document.getElementById('inc-name').value.trim();
  const amount = parseFloat(document.getElementById('inc-amount').value);
  if (!name && programRequiresDonorName(program())) { showToast('দাতার নাম দিন'); return; }
  if (!(amount > 0)) { showToast('সঠিক টাকার পরিমাণ দিন'); return; }
  const isShare = programHasShares(program()) && document.getElementById('inc-is-share').checked;
  const editId = document.getElementById('inc-edit-id').value;
  const prevRow = editId ? incomes().find(x => x.id === editId) : null;
  const student = studentId ? API.Students.getById(studentId) : null;
  const row = {
    id:         editId || uid(),
    date:       document.getElementById('inc-date').value || todayISO(),
    type:       document.getElementById('inc-type').value,
    personType: document.getElementById('inc-person-type').value,
    name,
    studentId:  student ? student.id : '',
    studentPermanentId: student ? (student.permanent_id || '') : '',
    studentClassId: student ? (student.class_id || '') : '',
    share:  isShare ? (parseFloat(document.getElementById('inc-share').value) || 1) : 0,
    amount,
    ref:    document.getElementById('inc-ref').value.trim(),
  };
  const res = await saveRemote(a => MMSharedAPI.upsertProgramIncome(a.id, a.pin, { ...row, programId: active }), 'আয় সংরক্ষিত হয়েছে ✓');
  if (res) {
    syncStudentProgramHistory(row, prevRow);
    closeModal('income');
    setTab('income');
  }
}

/* ══════════════════════════════════════════
   EXPENSE MODAL
══════════════════════════════════════════ */
function openExpense(editId = '') {
  if (writeBlocked()) return;
  const p = program();
  if (!p) return;
  const types = uniqList(p.expenseTypes, DEFAULTS().presets.custom.expenseTypes);
  document.getElementById('exp-type').innerHTML = '<option value="">সাধারণ</option>' + types.map(x =>
    `<option>${API.esc(x)}</option>`).join('');
  document.getElementById('exp-modal-title').textContent = editId ? 'ব্যয় এডিট' : 'ব্যয় যোগ';
  document.getElementById('exp-edit-id').value = editId;
  const r = editId ? expenses().find(x => x.id === editId) : null;
  document.getElementById('exp-date').value   = r ? (r.date || todayISO()) : todayISO();
  document.getElementById('exp-type').value   = r ? (r.type || '') : '';
  document.getElementById('exp-amount').value = r ? (r.amount || '') : '';
  document.getElementById('exp-note').value   = r ? (r.note || '') : '';
  const fileInput = document.getElementById('exp-files');
  if (fileInput) fileInput.value = '';
  renderExpenseFiles(editId);
  openModal('expense');
}

async function saveExpense() {
  if (writeBlocked()) return;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if (!(amount > 0)) { showToast('সঠিক টাকার পরিমাণ দিন'); return; }
  const row = {
    id:     document.getElementById('exp-edit-id').value || uid(),
    date:   document.getElementById('exp-date').value || todayISO(),
    type:   expenseTypeLabel(document.getElementById('exp-type').value),
    amount,
    note:   document.getElementById('exp-note').value.trim(),
  };
  const files = getExpenseFiles();
  if (!validateReceiptFiles(files)) return;
  const res = await saveRemote(a => MMSharedAPI.upsertProgramExpense(a.id, a.pin, { ...row, programId: active }), '');
  if (!res) return;
  if (files.length) {
    const ok = await uploadExpenseFiles(row.id, files);
    if (!ok) return;
    await refreshPage();
  }
  closeModal('expense');
  setTab('expense');
  showToast(files.length ? 'ব্যয় ও রশিদ সংরক্ষিত হয়েছে ✓' : 'ব্যয় সংরক্ষিত হয়েছে ✓');
}

/* ── DELETE (confirm modal) ── */
function askDel(kind, id) {
  if (writeBlocked()) return;
  const prevIncome = kind === 'income' ? incomes().find(x => x.id === id) : null;
  showConfirm('এই এন্ট্রি মুছে ফেলবেন?', () => {
    return saveRemote(a => MMSharedAPI.deleteProgramEntry(a.id, a.pin, kind, id), 'মুছে গেছে')
      .then(res => {
        if (res && prevIncome && prevIncome.studentId) removeStudentProgramHistory(prevIncome.studentId, prevIncome.id);
        return res;
      });
  });
}

function getExpenseFiles() {
  const input = document.getElementById('exp-files');
  return input && input.files ? Array.from(input.files) : [];
}

function validateReceiptFiles(files) {
  for (const file of files) {
    if (file.size > MAX_RECEIPT_SIZE) {
      showToast('প্রতি ফাইল সর্বোচ্চ ১০MB হতে পারবে');
      return false;
    }
    if (file.type && !RECEIPT_MIMES.includes(file.type)) {
      showToast('শুধু ছবি, PDF বা Word ডকুমেন্ট দিন');
      return false;
    }
  }
  return true;
}

function safeFileName(name) {
  const clean = String(name || 'receipt')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '-')
    .replace(/\s+/g, '-')
    .slice(-90);
  return clean || 'receipt';
}

function receiptPath(programId, expenseId, file) {
  return `${programId}/${expenseId}/${Date.now()}-${uid()}-${safeFileName(file.name)}`;
}

async function uploadExpenseFiles(expenseId, files) {
  const client = window.MMSharedAPI && MMSharedAPI.supabaseClient;
  if (!client || !files.length) return true;
  const a = remoteActor();
  for (const file of files) {
    const path = receiptPath(active, expenseId, file);
    const { error } = await client.storage.from(RECEIPT_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) {
      console.error('[kormosuchi] receipt upload failed', error);
      showToast('রশিদ আপলোড হয়নি');
      return false;
    }
    const res = await MMSharedAPI.addProgramExpenseAttachment(a.id, a.pin, {
      expenseId,
      bucketId: RECEIPT_BUCKET,
      storagePath: path,
      fileName: file.name || 'receipt',
      mimeType: file.type || '',
      fileSize: file.size || 0,
    });
    if (!res || res.ok !== true) {
      console.error('[kormosuchi] receipt metadata failed', res);
      showToast('রশিদের তথ্য সংরক্ষণ হয়নি');
      return false;
    }
  }
  return true;
}

function renderExpenseFiles(expenseId) {
  const el = document.getElementById('exp-file-list');
  if (!el) return;
  const existing = expenseAttachments(expenseId).map(att => `
    <div class="receipt-row">
      <span>${API.esc(att.fileName || 'রশিদ')}</span>
      <div class="receipt-actions">
        <button type="button" onclick="openReceipt('${att.id}')">দেখুন</button>
        ${readOnly ? '' : `<button type="button" class="danger" onclick="deleteReceipt('${att.id}')">মুছুন</button>`}
      </div>
    </div>`).join('');
  const pending = getExpenseFiles().map(file => `
    <div class="receipt-row pending"><span>${API.esc(file.name)}</span><small>${bn(Math.ceil(file.size / 1024))} KB</small></div>
  `).join('');
  el.innerHTML = existing + pending || '<div class="receipt-empty">রশিদ/মেমো থাকলে এখানে যুক্ত করুন</div>';
}

function onExpenseFilesChange() {
  const expenseId = document.getElementById('exp-edit-id').value;
  renderExpenseFiles(expenseId);
}

async function openReceipt(id) {
  const att = findAttachment(id);
  if (!att || !att.storagePath) { showToast('রশিদ পাওয়া যায়নি'); return; }
  try {
    const { data, error } = await MMSharedAPI.supabaseClient.storage
      .from(att.bucketId || RECEIPT_BUCKET)
      .createSignedUrl(att.storagePath, 300);
    if (error) throw error;
    const url = data && (data.signedUrl || data.signedURL);
    if (!url) throw new Error('signed_url_missing');
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    console.error('[kormosuchi] receipt open failed', err);
    showToast('রশিদ খোলা যায়নি');
  }
}

async function deleteReceipt(id) {
  if (writeBlocked()) return;
  const att = findAttachment(id);
  if (!att) return;
  const a = remoteActor();
  try {
    const res = await MMSharedAPI.deleteProgramExpenseAttachment(a.id, a.pin, id);
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'delete_failed');
    const path = res.storagePath || att.storagePath;
    if (path && MMSharedAPI.supabaseClient) {
      await MMSharedAPI.supabaseClient.storage.from(att.bucketId || RECEIPT_BUCKET).remove([path]);
    }
    await refreshPage();
    renderExpenseFiles(att.expenseId);
    showToast('রশিদ মুছে গেছে');
  } catch (err) {
    console.error('[kormosuchi] receipt delete failed', err);
    showToast('রশিদ মুছা যায়নি');
  }
}

/* ══════════════════════════════════════════
   SETTINGS MODAL
══════════════════════════════════════════ */
function openSettings() {
  if (!dbReady) { showToast('ডাটাবেজ সংযোগ নেই'); return; }
  populateSettingsProgramSelect(active);
  loadSettingsProgram(active);
  openModal('settings');
}

function populateSettingsProgramSelect(selected) {
  const sel = document.getElementById('set-prog-select');
  if (!sel) return;
  const current = selected || sel.value || active;
  sel.innerHTML = db.programs.map(p =>
    `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${API.esc(p.name)}</option>`
  ).join('');
}

function loadSettingsProgram(id) {
  const p = db.programs.find(x => x.id === id) || program();
  const disabled = readOnly || !p;
  document.querySelectorAll('#modal-settings input,#modal-settings textarea,#modal-settings select').forEach(el => {
    if (el.id !== 'set-prog-select') el.disabled = disabled;
  });
  document.querySelectorAll('#modal-settings .submit-btn,#modal-settings .settings-danger-btn').forEach(el => {
    el.disabled = disabled;
  });
  if (!p) return;
  document.getElementById('set-prog-select').value = p.id;
  document.getElementById('set-prog-name').value = p.name || '';
  document.getElementById('set-prog-status').value = p.status || 'চলমান';
  document.getElementById('set-prog-date').value = p.date || '';
  document.getElementById('set-prog-note').value = p.note || '';
  document.getElementById('set-prog-share-enabled').checked = programHasShares(p);
  document.getElementById('set-prog-donor-required').checked = programRequiresDonorName(p);
  document.getElementById('set-prog-income-types').value = typesToLines(p.incomeTypes);
  document.getElementById('set-prog-expense-types').value = typesToLines(p.expenseTypes);
}

async function saveSettingsProgram() {
  if (writeBlocked()) return;
  const id = document.getElementById('set-prog-select').value;
  const p = db.programs.find(x => x.id === id);
  if (!p) return;
  const name = document.getElementById('set-prog-name').value.trim();
  if (!name) { showToast('কর্মসূচির নাম দিন'); return; }
  const data = {
    name,
    status: document.getElementById('set-prog-status').value,
    date: document.getElementById('set-prog-date').value,
    note: document.getElementById('set-prog-note').value,
    shareEnabled: document.getElementById('set-prog-share-enabled').checked,
    donorNameRequired: document.getElementById('set-prog-donor-required').checked,
    incomeTypes: linesToTypes(document.getElementById('set-prog-income-types').value, DEFAULTS().presets.custom.incomeTypes),
    expenseTypes: linesToTypes(document.getElementById('set-prog-expense-types').value, DEFAULTS().presets.custom.expenseTypes),
  };
  ensureProgramShape(data);
  active = id;
  const res = await saveRemote(a => MMSharedAPI.upsertProgram(a.id, a.pin, { id, ...data }), 'কর্মসূচি সংরক্ষিত হয়েছে ✓', { activeFromResult: true });
  if (res) {
    populateSettingsProgramSelect(id);
    loadSettingsProgram(id);
  }
}

function deleteSettingsProgram() {
  if (writeBlocked()) return;
  const id = document.getElementById('set-prog-select').value;
  showConfirm('এই কর্মসূচি ও এর সব আয়-ব্যয় মুছে যাবে।', () => {
    return saveRemote(a => MMSharedAPI.deleteProgram(a.id, a.pin, id), 'কর্মসূচি মুছে গেছে')
      .then(res => {
        if (!res) return;
        populateSettingsProgramSelect(active);
        loadSettingsProgram(active);
      });
  });
}

function resetDemo() {
  showToast('এখন ডাটাবেজই মূল উৎস, লোকাল রিসেট নেই');
}

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
function changeProgram(id) {
  active = id; activeTab = 'income';
  setTab('income'); renderPage();
}

function setTab(x) {
  activeTab = x;
  document.querySelectorAll('.k-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === x));
  renderRoot();
}

function setRptRange(r) { rptRange = r; renderRoot(); }

function openModal(x)  { document.getElementById('modal-' + x).classList.add('open'); }
function closeModal(x) { document.getElementById('modal-' + x).classList.remove('open'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  _confirmCb = cb;
  openModal('confirm');
}

function confirmYes() {
  closeModal('confirm');
  if (!_confirmCb) return;
  const cb = _confirmCb;
  _confirmCb = null;
  try {
    const ret = cb();
    if (ret && typeof ret.catch === 'function') {
      ret.catch(err => {
        console.error('[kormosuchi] confirm action failed', err);
        showToast('কাজটি সম্পন্ন হয়নি');
      });
    }
  } catch (err) {
    console.error('[kormosuchi] confirm action failed', err);
    showToast('কাজটি সম্পন্ন হয়নি');
  }
}

/* ── INIT ── */
async function initKormosuchiPage() {
  var dataWarm = window.MMSession && MMSession.isAppDataWarm && MMSession.isAppDataWarm();
  if (window.MMSession && MMSession.ensureDaftarDataReady) {
    try { await MMSession.ensureDaftarDataReady({ silent: dataWarm }); } catch (err) { console.warn('[kormosuchi] daftar bootstrap failed', err); }
  }
  try {
    await dbLoad();
  } catch (err) {
    console.error('[kormosuchi] database load failed', err);
    db = emptyDb();
    dbReady = false;
    readOnly = true;
    loadError = err && err.message ? err.message : 'database_failed';
  }
  renderPage();
}

const previousStudentExtraInfo = window.mmStudentModalExtraInfo;
window.mmStudentModalExtraInfo = function (sid, student) {
  let html = '';
  if (typeof previousStudentExtraInfo === 'function') {
    try { html += previousStudentExtraInfo(sid, student) || ''; } catch (err) { console.warn('previous student extra info failed', err); }
  }
  html += renderProgramHistoryForStudent(sid);
  return html;
};

async function preloadKormosuchiData() {
  await dbLoad();
}

window.initKormosuchiPage = initKormosuchiPage;
window.MMKormosuchi = { init: initKormosuchiPage, preload: preloadKormosuchiData };

function kormosuchiHostIsEmbedded() {
  return !!document.getElementById('acc-panel-kormosuchi');
}

function isStandaloneKormosuchiPage() {
  try {
    return /(?:(?:^|\/)madrasa-kormosuchi|\/admin\/kormosuchi)\.html$/i.test(
      String(window.location.pathname || '').replace(/\\/g, '/')
    );
  } catch (e) {
    return false;
  }
}

if (!kormosuchiHostIsEmbedded() && isStandaloneKormosuchiPage()) {
  if (window.MMLoading && MMLoading.runDaftarPage) MMLoading.runDaftarPage(initKormosuchiPage);
  else if (window.MMLoading && MMLoading.run) MMLoading.run(initKormosuchiPage);
  else initKormosuchiPage();
}
