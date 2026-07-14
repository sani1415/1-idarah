(function (global) {
  'use strict';

  const KHADIMIN_KEY = 'mm_khadimin';
  const LEAVES_KEY = 'mm_khadimin_leaves';
  const KHD_MODAL_ID = 'modal-khadim-detail';
  function digitsToBn(v) {
    return String(v == null ? '' : v).replace(/\d/g, (ch) => String.fromCharCode(0x09e6 + ch.charCodeAt(0) - 48));
  }
  let helpers = {
    toBn: (n) => (typeof global.toBn === 'function' ? global.toBn(n) : digitsToBn(n)),
    showToast: () => {},
  };
  /** @type {string|null} */
  let _openKhadimId = null;
  /** @type {Record<string, { vy: number, vm: number, a: string|null, b: string|null }>} */
  const leavePickState = {};

  function useRemote() {
    if (!global.MMSharedAPI || !MMSharedAPI.supabaseClient || !global.MDRKhadiminSupabase) return false;
    const fn = MDRKhadiminSupabase.actor;
    if (!fn) return false;
    const a = fn();
    return !!(a && a.id && a.pin);
  }

  function academicYearBounds() {
    if (global.MDRKhadiminSupabase && MDRKhadiminSupabase.academicYearBounds) {
      return MDRKhadiminSupabase.academicYearBounds();
    }
    const end = new Date().toISOString().slice(0, 10);
    const start = (global.API && API.Settings && API.Settings.get)
      ? ((API.Settings.get().session_start_date || '').trim() || null)
      : null;
    return { start, end };
  }

  const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const BN_DOW = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক', 'শনি'];

  const uid = () => 'kh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (s) => global.API && API.esc ? API.esc(s) : String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** onclick="...('…')" এর জন্য — ডাবল কোট ভাঙ্গা এড়াতে (JSON.stringify এখানে ব্যবহার নয়) */
  function jsSingleQuote(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
  }

  function initialCharPlain(name) {
    const s = String(name || '').trim();
    return s ? s[0] : '?';
  }

  function initialChar(name) {
    const s = String(name || '').trim();
    if (!s) return '?';
    const ch = s[0];
    return esc(ch);
  }

  function isoFromYmd(y, m0, d) {
    return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function ensureLeavePick(id) {
    if (!leavePickState[id]) {
      const t = new Date();
      leavePickState[id] = { vy: t.getFullYear(), vm: t.getMonth(), a: null, b: null };
    }
    return leavePickState[id];
  }

  function syncLeaveHidden(id) {
    if (_openKhadimId !== id) return;
    const st = ensureLeavePick(id);
    const fromEl = document.getElementById('khd-leave-from');
    const toEl = document.getElementById('khd-leave-to');
    if (!fromEl || !toEl) return;
    if (!st.a) { fromEl.value = ''; toEl.value = ''; return; }
    if (!st.b) { fromEl.value = st.a; toEl.value = st.a; return; }
    const lo = st.a <= st.b ? st.a : st.b;
    const hi = st.a <= st.b ? st.b : st.a;
    fromEl.value = lo;
    toEl.value = hi;
  }

  function redrawLeaveCal(id) {
    if (_openKhadimId !== id) return;
    const host = document.getElementById('khd-cal-host');
    if (!host) return;
    host.innerHTML = buildCalInnerHtml(id);
    syncLeaveHidden(id);
  }

  function leaveRangeLabel(id) {
    const st = ensureLeavePick(id);
    if (!st.a) return 'ক্যালেন্ডারে শুরুর দিন টোকা দিন; শেষ দিন আবার টোকা দিন। একদিন হলে দুবার একই দিন।';
    if (!st.b) return `${esc(st.a)} থেকে — শেষ তারিখ বেছে নিন (${helpers.toBn(daysBetween(st.a, st.a))} দিন)`;
    const lo = st.a <= st.b ? st.a : st.b;
    const hi = st.a <= st.b ? st.b : st.a;
    return `${esc(lo)} থেকে ${esc(hi)} — মোট ${helpers.toBn(daysBetween(lo, hi))} দিন`;
  }

  function buildCalInnerHtml(id) {
    const st = ensureLeavePick(id);
    const y = st.vy;
    const m = st.vm;
    const first = new Date(y, m, 1);
    const lastDate = new Date(y, m + 1, 0).getDate();
    const pad = first.getDay();
    const td = today();
    let lo = null; let hi = null;
    if (st.a) {
      lo = st.b ? (st.a <= st.b ? st.a : st.b) : st.a;
      hi = st.b ? (st.a <= st.b ? st.b : st.a) : st.a;
    }
    const inRange = (iso) => lo && hi && iso >= lo && iso <= hi;
    const parts = [];
    const qid = jsSingleQuote(id);
    parts.push(`<div class="kh-cal-head">`);
    parts.push(`<button type="button" class="kh-cal-nav" aria-label="আগের মাস" onclick="MDRHomePanels.leaveCalNav('${qid}',-1)">‹</button>`);
    parts.push(`<div class="kh-cal-mo">${esc(BN_MONTHS[m])} ${helpers.toBn(y)}</div>`);
    parts.push(`<button type="button" class="kh-cal-nav" aria-label="পরের মাস" onclick="MDRHomePanels.leaveCalNav('${qid}',1)">›</button>`);
    parts.push(`</div><div class="kh-cal-grid">`);
    for (let i = 0; i < 7; i++) parts.push(`<div class="kh-cal-dow">${esc(BN_DOW[i])}</div>`);
    for (let i = 0; i < pad; i++) parts.push('<div class="kh-cal-pad"></div>');
    for (let d = 1; d <= lastDate; d++) {
      const iso = isoFromYmd(y, m, d);
      const cls = ['kh-cal-day'];
      if (iso === td) cls.push('kh-cal-today');
      if (st.a && st.b) {
        if (inRange(iso)) cls.push('kh-cal-inrange');
        if (iso === lo || iso === hi) cls.push('kh-cal-edge');
      } else if (st.a && iso === st.a) cls.push('kh-cal-edge');
      parts.push(`<button type="button" class="${cls.join(' ')}" onclick="MDRHomePanels.pickLeaveDay('${qid}','${jsSingleQuote(iso)}')">${helpers.toBn(d)}</button>`);
    }
    parts.push('</div>');
    parts.push(`<p class="kh-cal-hint">${leaveRangeLabel(id)}</p>`);
    parts.push(`<div class="kh-cal-tools"><button type="button" class="kh-cal-clear" onclick="MDRHomePanels.clearLeavePick('${qid}')">নির্বাচন মুছুন</button></div>`);
    return parts.join('');
  }

  function ensureKhadimDetailModal() {
    if (document.getElementById(KHD_MODAL_ID)) return;
    const wrap = document.createElement('div');
    wrap.id = KHD_MODAL_ID;
    wrap.className = 'modal-bg';
    wrap.innerHTML = `
<div class="modal modal--student" id="khd-inner">
  <div class="st-modal-hd">
    <div class="st-modal-hd-main">
      <div class="st-avatar st-avatar--empty khd-avatar" id="khd-avatar" aria-hidden="true">
        <span class="st-avatar-ph" id="khd-avatar-ph">?</span>
      </div>
      <div class="st-modal-texts">
        <h2 class="st-modal-title-khd" id="khd-title">খাদেম</h2>
        <p class="st-modal-sub" id="khd-sub"></p>
      </div>
    </div>
    <button type="button" class="modal-close" id="khd-close" aria-label="বন্ধ">✕</button>
  </div>
  <div id="khd-tabs-wrap">
    <div class="st-tabs" role="tablist" aria-label="খাদেমের তথ্য">
      <button type="button" class="st-tab st-tab--on" data-tab="info" role="tab" aria-selected="true" onclick="MDRHomePanels.switchKhadimTab('info')">তথ্য</button>
      <button type="button" class="st-tab" data-tab="notes" role="tab" aria-selected="false" onclick="MDRHomePanels.switchKhadimTab('notes')">নোট ও ঘটনা</button>
      <button type="button" class="st-tab" data-tab="leave" role="tab" aria-selected="false" onclick="MDRHomePanels.switchKhadimTab('leave')">ছুটির হিসাব</button>
    </div>
    <div class="st-tab-panels">
      <div class="st-tab-panel st-tab-panel--on" data-panel="info" id="khd-panel-info"></div>
      <div class="st-tab-panel" data-panel="notes" id="khd-panel-notes"></div>
      <div class="st-tab-panel" data-panel="leave" id="khd-panel-leave"></div>
    </div>
  </div>
</div>`;
    wrap.addEventListener('click', (e) => { if (e.target.id === KHD_MODAL_ID) closeKhadimDetail(); });
    const inner = wrap.querySelector('#khd-inner');
    if (inner) inner.addEventListener('click', (e) => e.stopPropagation());
    const cls = wrap.querySelector('#khd-close');
    if (cls) cls.addEventListener('click', closeKhadimDetail);
    document.body.appendChild(wrap);
    const notesRoot = wrap.querySelector('#khd-panel-notes');
    if (notesRoot) {
      notesRoot.innerHTML = `
<div id="khd-notes-list" class="khd-notes-list"></div>
<textarea class="form-input" id="khd-note-ta" rows="3" placeholder="নতুন ঘটনা বা অবস্থা লিখুন…"></textarea>
<button type="button" class="kh-mini-btn gold" style="margin-top:8px" onclick="MDRHomePanels.addKhadimNote()">নোট যোগ করুন</button>`;
    }
    const leaveRoot = wrap.querySelector('#khd-panel-leave');
    if (leaveRoot) {
      leaveRoot.innerHTML = `
<p class="khd-leave-summary" id="khd-leave-summary"></p>
<div class="kh-subtitle">এই শিক্ষাবর্ষের ছুটি (মাদরাসা সেটিংসের শুরুর তারিখ থেকে আজ)</div>
<div id="khd-leave-list" class="kh-leave-scroll"></div>
<div class="kh-subtitle">নতুন ছুটি — ক্যালেন্ডারে প্রথমে শুরু, তারপর শেষ দিন (এক দিন হলে দুবার একই দিন)</div>
<div class="kh-cal"><div id="khd-cal-host"></div></div>
<input type="hidden" id="khd-leave-from" value="">
<input type="hidden" id="khd-leave-to" value="">
<input class="form-input" id="khd-leave-reason" placeholder="ছুটির কারণ" style="margin-top:8px">
<button type="button" class="kh-mini-btn gold" style="margin-top:8px;width:100%" onclick="MDRHomePanels.addLeave()">ছুটি সংরক্ষণ করুন</button>`;
    }
  }

  function switchKhadimTab(key) {
    const root = document.getElementById('khd-tabs-wrap');
    if (!root) return;
    root.querySelectorAll('.st-tab').forEach((btn) => {
      const on = btn.getAttribute('data-tab') === key;
      btn.classList.toggle('st-tab--on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    root.querySelectorAll('.st-tab-panel').forEach((p) => {
      p.classList.toggle('st-tab-panel--on', p.getAttribute('data-panel') === key);
    });
    if (key === 'leave' && _openKhadimId) {
      const t = new Date();
      leavePickState[_openKhadimId] = { vy: t.getFullYear(), vm: t.getMonth(), a: null, b: null };
      redrawLeaveCal(_openKhadimId);
    }
  }

  function khdKv(lbl, val) {
    return `<div class="st-kv-item"><div class="st-kv-lbl">${lbl}</div><div class="st-kv-val">${val}</div></div>`;
  }

  function refreshKhadimDetailPanels() {
    if (!_openKhadimId) return;
    const k = getKhadimin().find((x) => x.id === _openKhadimId);
    if (!k) { closeKhadimDetail(); return; }
    const bounds = academicYearBounds();
    const allLeaves = getLeaves().filter((l) => l.khadim_id === k.id);
    const Ksup = global.MDRKhadiminSupabase;
    const leaves = Ksup && Ksup.leavesInAcademicWindow
      ? Ksup.leavesInAcademicWindow(getLeaves(), k.id, bounds)
      : getLeaves().filter((l) => l.khadim_id === k.id);
    const yDays = Ksup && Ksup.leaveDaysYearToDateForKhadim
      ? Ksup.leaveDaysYearToDateForKhadim(k.id, getLeaves(), bounds)
      : null;
    const totalAll = allLeaves.reduce((sum, l) => sum + (Number(l.days) || 0), 0);
    const st = k.status || 'active';
    const tagBg = st === 'away' ? 'rgba(180,120,40,.2);color:#5a4010' : st === 'inactive' ? 'var(--cream2);color:var(--ink3)' : 'rgba(40,120,80,.15);color:#1d5c3a';
    const yLabel = bounds.start
      ? `${helpers.toBn(yDays != null ? yDays : 0)} দিন (${esc(bounds.start)} থেকে ${esc(bounds.end)} পর্যন্ত ছেদ)`
      : `— (মাদরাসা সেটিংসে «চলতি শিক্ষাবর্ষ শুরুর তারিখ» দিন)`;
    const infoEl = document.getElementById('khd-panel-info');
    if (infoEl) {
      infoEl.innerHTML = `
<div class="st-kv-grid">
  ${khdKv('দায়িত্ব', esc(k.duty || '—'))}
  ${khdKv('মোবাইল', esc(k.phone || '—'))}
  ${khdKv('অবস্থা', `<span class="st-kv-val--tag" style="background:${tagBg}">${esc(statusLabel(st))}</span>`)}
  ${khdKv('যোগদান', esc(k.join_date || '—'))}
  ${khdKv('ঠিকানা', esc(k.address || '—'))}
  ${khdKv('বিস্তারিত', esc(k.details || '—'))}
  ${khdKv('এই শিক্ষাবর্ষে ছুটি (শুরু থেকে আজ)', yLabel)}
  ${bounds.start ? khdKv('সব মৌসুম মিলে মোট দিন (রেকর্ড)', helpers.toBn(totalAll) + ' দিন') : ''}
</div>
<p class="kh-meta" style="margin-top:12px">সম্পাদনা করতে তালিকার «সম্পাদনা» বাটন ব্যবহার করুন।</p>`;
    }
    const listNotes = document.getElementById('khd-notes-list');
    if (listNotes) {
      const notes = (k.notes || []).map((n) => `<div class="kh-note">${esc(n.date)} — ${esc(n.text)}</div>`).join('');
      listNotes.innerHTML = notes || '<div class="kh-note">কোনো নোট নেই</div>';
    }
    const sumEl = document.getElementById('khd-leave-summary');
    if (sumEl) {
      sumEl.textContent = bounds.start
        ? `এই শিক্ষাবর্ষে মোট ${helpers.toBn(yDays != null ? yDays : 0)} দিন ছুটি (শুরু: ${bounds.start} → আজ ${bounds.end})।`
        : `শিক্ষাবর্ষ শুরুর তারিখ সেট নেই — নিচে সব যুক্ত ছুটির রেকর্ড দেখাচ্ছে। সেটিংসে তারিখ দিন।`;
    }
    const leaveList = document.getElementById('khd-leave-list');
    if (leaveList) {
      leaveList.innerHTML = leaves.length
        ? leaves.map((l) => `<div class="kh-leave-row"><span>${esc(l.from)} → ${esc(l.to || l.from)}${l.reason ? ' · ' + esc(l.reason) : ''}</span><strong>${helpers.toBn(l.days)} দিন</strong></div>`).join('')
        : '<div class="kh-note">' + (bounds.start ? 'এই শিক্ষাবর্ষে কোনো ছুটির রেকর্ড নেই' : 'কোনো ছুটির রেকর্ড নেই') + '</div>';
    }
    const reasonEl = document.getElementById('khd-leave-reason');
    if (reasonEl) reasonEl.value = '';
  }

  function openKhadimDetail(id) {
    const k = getKhadimin().find((x) => x.id === id);
    if (!k) { helpers.showToast('খাদেম পাওয়া যায়নি'); return; }
    _openKhadimId = id;
    ensureKhadimDetailModal();
    const ph = document.getElementById('khd-avatar-ph');
    if (ph) ph.textContent = initialCharPlain(k.name);
    const title = document.getElementById('khd-title');
    if (title) title.textContent = k.name || 'খাদেম';
    const sub = document.getElementById('khd-sub');
    if (sub) sub.textContent = [k.duty, k.phone, statusLabel(k.status || 'active')].filter(Boolean).join(' · ');
    switchKhadimTab('info');
    refreshKhadimDetailPanels();
    document.getElementById(KHD_MODAL_ID).classList.add('open');
  }

  function closeKhadimDetail() {
    _openKhadimId = null;
    const el = document.getElementById(KHD_MODAL_ID);
    if (el) el.classList.remove('open');
  }

  function loadArr(key) {
    if (global.API && API.persistLoadArr) return API.persistLoadArr(key);
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }

  function saveArr(key, rows) {
    if (global.API && API.persistSaveArr) API.persistSaveArr(key, rows);
    else localStorage.setItem(key, JSON.stringify(rows || []));
  }

  function injectOnce() {
    if (document.getElementById('mdr-home-panels-style')) return;
    const style = document.createElement('style');
    style.id = 'mdr-home-panels-style';
    style.textContent = `
      #modal-khadimin.modal-bg,#modal-absent-home.modal-bg{align-items:center;justify-content:center;padding:16px}
      #modal-khadimin .modal,#modal-absent-home .modal{width:min(760px,calc(100vw - 32px));height:min(760px,calc(100vh - 32px));max-height:calc(100vh - 32px);border-radius:22px;padding:18px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}
      .kh-panel{flex:1;overflow-y:auto;min-height:0}
      .kh-panel-form{display:none}.kh-panel-form.active{display:block}
      .kh-panel-list{display:block}.kh-panel-list.hidden{display:none}
      .kh-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-shrink:0}
      .kh-modal-title{font-family:'Tiro Bangla',serif;font-size:17px;font-weight:800;color:var(--ink)}
      .kh-add-btn{border:none;background:var(--ink);color:var(--gold2);border-radius:10px;padding:8px 14px;font-family:'Tiro Bangla',serif;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}
      .kh-back-btn{border:1px solid var(--cream3);background:#fff;color:var(--ink2);border-radius:10px;padding:7px 12px;font-family:'Tiro Bangla',serif;font-size:12px;font-weight:800;cursor:pointer}
      .kh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      #kh-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(292px,1fr));gap:8px;align-content:start}
      .kh-card-wrap{background:#fff;border:1px solid rgba(26,18,8,.07);border-radius:14px;box-shadow:0 4px 12px rgba(26,18,8,.05);overflow:hidden}
      .kh-compact{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px 10px 10px 12px}
      .kh-main-row{display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1}
      .kh-av{flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--ink);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-family:'Tiro Bangla',serif;font-size:16px;font-weight:800}
      .kh-row-text{flex:1;min-width:0}
      .kh-name-btn{display:block;width:100%;font-family:'Tiro Bangla',serif;font-size:14px;font-weight:800;color:var(--ink);background:none;border:none;padding:0;margin:0;cursor:pointer;text-align:left;line-height:1.25}
      .kh-name-btn:hover{color:var(--blue);text-decoration:underline}
      .kh-name-btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
      .kh-meta--1l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .kh-row-side{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
      .kh-pill{display:inline-block;background:var(--cream2);border-radius:20px;padding:2px 8px;font-size:10px;color:var(--ink3);white-space:nowrap}
      .kh-pill--away{background:rgba(180,120,40,.18);color:#6a4a12}
      .kh-pill--inactive{background:rgba(120,120,120,.15);color:var(--ink3)}
      .kh-pill--active{background:rgba(40,120,80,.12);color:#1d5c3a}
      .kh-edit{border:1px solid var(--cream3);background:#fff;border-radius:10px;padding:8px 9px;font-family:'Tiro Bangla',serif;font-size:10px;font-weight:800;color:var(--ink2);cursor:pointer;align-self:center}
      .kh-mini-btn{border:1px solid var(--cream3);background:#fff;border-radius:10px;padding:8px;font-family:'Tiro Bangla',serif;font-size:11px;font-weight:800;color:var(--ink2);cursor:pointer}
      .kh-mini-btn.gold{background:var(--ink);color:var(--gold2);border-color:var(--ink)}
      .kh-subtitle{font-size:12px;font-weight:900;color:var(--ink2);margin:10px 0 6px}
      .kh-leave-scroll{max-height:112px;overflow-y:auto;margin:4px 0 8px;padding-right:4px;border-radius:8px}
      .kh-leave-row{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--cream2);padding:6px 0;font-size:11px;color:var(--ink2)}
      .kh-leave-row:first-child{border-top:none;padding-top:0}
      .kh-cal{border:1px solid rgba(26,18,8,.1);border-radius:14px;padding:8px 8px 6px;background:#fff;margin-top:6px}
      .kh-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:0 2px}
      .kh-cal-nav{border:none;background:var(--cream2);width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:18px;line-height:1;color:var(--ink2)}
      .kh-cal-mo{font-size:13px;font-weight:800;color:var(--ink);font-family:'Tiro Bangla',serif}
      .kh-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}
      .kh-cal-dow{font-size:9px;color:var(--ink3);padding:4px 0;font-weight:700}
      .kh-cal-pad{min-height:32px}
      .kh-cal-day{min-height:32px;border:none;border-radius:9px;background:transparent;cursor:pointer;font-size:12px;font-family:inherit;color:var(--ink2);padding:0}
      .kh-cal-day:hover{background:var(--cream2)}
      .kh-cal-day.kh-cal-today{box-shadow:inset 0 0 0 1.5px var(--gold)}
      .kh-cal-day.kh-cal-inrange{background:rgba(201,149,42,.14)}
      .kh-cal-day.kh-cal-edge{background:var(--ink);color:var(--gold2);font-weight:800}
      .kh-cal-hint{font-size:10px;color:var(--ink3);line-height:1.45;margin:8px 2px 4px;min-height:2.8em}
      .kh-cal-tools{text-align:center}
      .kh-cal-clear{border:none;background:transparent;color:var(--blue);font-size:11px;cursor:pointer;text-decoration:underline;padding:2px;font-family:'Tiro Bangla',serif}
      .abs-row-home{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid rgba(26,18,8,.07);border-radius:14px;box-shadow:0 5px 14px rgba(26,18,8,.06);padding:12px;margin-bottom:8px}
      .abs-rank-home{font-family:'Tiro Bangla',serif;font-size:18px;font-weight:800;color:var(--gold);min-width:34px;text-align:center}
      .abs-info-home{flex:1;min-width:0}.abs-name-home{font-size:14px;font-weight:700;color:var(--ink)}
      .abs-days-home{font-family:'Tiro Bangla',serif;font-size:17px;font-weight:800;color:var(--red);white-space:nowrap;text-align:center}
      .abs-days-sub{font-size:10px;font-weight:700;color:var(--ink3);font-family:'Tiro Bangla',serif;line-height:1.3}
      .abs-days-prefix{font-size:11px;color:var(--ink3);font-weight:700}
      .abs-days-sub.is-present{color:var(--green)}
      .abs-tabs{display:flex;gap:4px;margin:0 0 10px;padding:4px;background:rgba(255,255,255,.72);border:1px solid rgba(26,18,8,.07);border-radius:12px;flex-shrink:0}
      .abs-tab{flex:1;border:none;border-radius:9px;background:transparent;padding:9px 8px;font-family:'Tiro Bangla',serif;font-size:13px;font-weight:700;color:var(--ink3);cursor:pointer}
      .abs-tab.active{color:#fff;background:linear-gradient(135deg,var(--gold),#9a6a21);font-weight:800;box-shadow:0 5px 12px rgba(154,106,33,.22)}
      .abs-section-title{font-size:12px;font-weight:800;color:var(--ink2);margin:14px 0 8px}
      .abs-section-title:first-child{margin-top:0}
      .abs-section-sub{font-size:11px;color:var(--ink3);margin:-4px 0 8px;line-height:1.45}
      .abs-section-empty{font-size:12px;color:var(--ink3);padding:10px 0 4px}
      #modal-absent-home .modal-title,#modal-absent-home .kh-meta{flex-shrink:0}
      #modal-absent-home #abs-home-list{flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;padding-right:2px}
      @media(max-width:520px){.kh-grid{grid-template-columns:1fr}#kh-list{grid-template-columns:1fr}}
      .kh-list-empty{grid-column:1/-1}
      #modal-khadim-detail.modal-bg{
        align-items:center;justify-content:center;
        padding:max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
        backdrop-filter:blur(2px);z-index:220;
      }
      #modal-khadim-detail .modal.modal--student{
        --st-modal-h:min(75vh,640px);
        width:min(600px,calc(100vw - 32px));max-width:min(600px,calc(100vw - 32px));
        height:var(--st-modal-h);min-height:var(--st-modal-h);max-height:var(--st-modal-h);
        margin:0;padding:0;border-radius:20px;align-self:center;overflow:hidden;
        display:flex;flex-direction:column;
        background:linear-gradient(180deg,#fffef9 0%,#fcfaf5 8%,#fff 14%);
        box-shadow:0 4px 6px rgba(26,18,8,.04),0 24px 64px rgba(26,18,8,.16);
        border:1px solid rgba(201,149,42,.12);
      }
      #modal-khadim-detail #khd-tabs-wrap{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
      #modal-khadim-detail #khd-title{font-family:'Tiro Bangla',serif;font-size:18px;font-weight:700;color:var(--ink2);margin:0 0 4px 0;line-height:1.2;word-break:break-word}
      .khd-notes-list{max-height:min(200px,35vh);overflow-y:auto;margin-bottom:8px}
      .khd-leave-summary{font-size:12px;color:var(--ink2);margin:0 0 8px;font-weight:600}
      #modal-khadim-detail .st-tab-panels{padding:12px 14px 16px;overflow-y:auto;flex:1;min-height:0}
    `;
    document.head.appendChild(style);

    const kh = document.createElement('div');
    kh.className = 'modal-bg';
    kh.id = 'modal-khadimin';
    kh.innerHTML = `<div class="modal">
      <!-- তালিকা প্যানেল -->
      <div class="kh-panel kh-panel-list" id="kh-panel-list">
        <div class="kh-modal-head">
          <div class="kh-modal-title">★ খাদিমিন</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button" class="kh-add-btn" onclick="MDRHomePanels.showAddForm()">+ নতুন খাদেম</button>
            <button class="modal-close" onclick="MDRHomePanels.closeKhadimin()">✕</button>
          </div>
        </div>
        <div id="kh-list"></div>
      </div>
      <!-- ফর্ম প্যানেল (লুকানো) -->
      <div class="kh-panel kh-panel-form" id="kh-panel-form">
        <div class="kh-modal-head">
          <button type="button" class="kh-back-btn" onclick="MDRHomePanels.showList()">← তালিকায় ফিরুন</button>
          <span id="kh-form-title" style="font-size:13px;font-weight:800;color:var(--ink)">নতুন খাদেম</span>
          <button class="modal-close" onclick="MDRHomePanels.closeKhadimin()">✕</button>
        </div>
        <input type="hidden" id="kh-id">
        <div class="kh-grid">
          <div class="form-group"><label class="form-label">নাম <span style="color:var(--red)">*</span></label><input class="form-input" id="kh-name" placeholder="খাদেমের নাম"></div>
          <div class="form-group"><label class="form-label">মোবাইল</label><input class="form-input" id="kh-phone" placeholder="০১৭XX-XXXXXX"></div>
          <div class="form-group"><label class="form-label">দায়িত্ব</label><input class="form-input" id="kh-duty" placeholder="রান্নাঘর, পরিষ্কার, দারোয়ান…"></div>
          <div class="form-group"><label class="form-label">যোগদানের তারিখ</label><input class="form-input" id="kh-join" type="date"></div>
          <div class="form-group"><label class="form-label">অবস্থা</label><select class="form-input form-select" id="kh-status"><option value="active">সক্রিয়</option><option value="away">ছুটিতে</option><option value="inactive">নিষ্ক্রিয়</option></select></div>
          <div class="form-group"><label class="form-label">ঠিকানা</label><input class="form-input" id="kh-address" placeholder="ঠিকানা"></div>
          <div class="form-group" style="grid-column:1/-1"><label class="form-label">পূর্ণাঙ্গ বিবরণ</label><textarea class="form-input" id="kh-details" rows="3" placeholder="পরিবার, পরিচয়, জরুরি তথ্য…"></textarea></div>
        </div>
        <button class="submit-btn gold" onclick="MDRHomePanels.saveKhadim()">সংরক্ষণ করুন</button>
      </div>
    </div>`;
    document.body.appendChild(kh);

    const abs = document.createElement('div');
    abs.className = 'modal-bg';
    abs.id = 'modal-absent-home';
    abs.innerHTML = `<div class="modal">
      <div class="modal-title">অনুপস্থিত তালিকা <button class="modal-close" onclick="MDRHomePanels.closeAbsent()">✕</button></div>
      <div class="kh-meta" style="margin-bottom:10px">আজকের অনুপস্থিত ও সর্বমোট অনুপস্থিতির রেকর্ড — আলাদা ট্যাবে।</div>
      <div class="abs-tabs" id="abs-home-tabs"></div>
      <div id="abs-home-list"></div>
    </div>`;
    document.body.appendChild(abs);
  }

  function getKhadimin() {
    if (useRemote() && global.MDRKhadiminSupabase) return MDRKhadiminSupabase.getKhadimin();
    return loadArr(KHADIMIN_KEY);
  }

  function getLeaves() {
    if (useRemote() && global.MDRKhadiminSupabase) return MDRKhadiminSupabase.getLeaves();
    return loadArr(LEAVES_KEY);
  }

  function saveKhadim() {
    const name = document.getElementById('kh-name').value.trim();
    if (!name) { helpers.showToast('নাম লিখুন'); return; }
    const rawId = (document.getElementById('kh-id').value || '').trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const existingId = uuidRe.test(rawId) ? rawId : null;

    const doLocal = () => {
      const id = existingId || rawId || uid();
      const rows = loadArr(KHADIMIN_KEY);
      const row = {
        id,
        name,
        phone: document.getElementById('kh-phone').value.trim(),
        duty: document.getElementById('kh-duty').value.trim(),
        join_date: document.getElementById('kh-join').value,
        status: document.getElementById('kh-status').value,
        address: document.getElementById('kh-address').value.trim(),
        details: document.getElementById('kh-details').value.trim(),
        notes: (rows.find((x) => x.id === id) || {}).notes || [],
      };
      const idx = rows.findIndex((x) => x.id === id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
      saveArr(KHADIMIN_KEY, rows);
      afterSaveRefresh(id);
    };

    if (useRemote()) {
      MDRKhadiminSupabase.upsertKhadim({
        id: existingId,
        name,
        phone: document.getElementById('kh-phone').value.trim(),
        duty: document.getElementById('kh-duty').value.trim(),
        join_date: document.getElementById('kh-join').value || null,
        status: document.getElementById('kh-status').value,
        address: document.getElementById('kh-address').value.trim(),
        details: document.getElementById('kh-details').value.trim(),
      }).then((newId) => {
        const fid = newId || existingId;
        if (fid) document.getElementById('kh-id').value = fid;
        afterSaveRefresh(fid || _openKhadimId);
        updateCards();
        showList();
        helpers.showToast('খাদেমের তথ্য সংরক্ষণ হয়েছে ✓');
      }).catch(() => {
        helpers.showToast('সংরক্ষণ ব্যর্থ — আবার চেষ্টা করুন');
      });
      return;
    }
    doLocal();
    updateCards();
    showList();
    helpers.showToast('খাদেমের তথ্য সংরক্ষণ হয়েছে ✓');
  }

  function afterSaveRefresh(id) {
    renderKhadimin();
    if (id && _openKhadimId === id) {
      const k2 = getKhadimin().find((x) => x.id === id);
      if (k2) {
        const title = document.getElementById('khd-title');
        if (title) title.textContent = k2.name || 'খাদেম';
        const sub = document.getElementById('khd-sub');
        if (sub) sub.textContent = [k2.duty, k2.phone, statusLabel(k2.status || 'active')].filter(Boolean).join(' · ');
        const ph = document.getElementById('khd-avatar-ph');
        if (ph) ph.textContent = initialCharPlain(k2.name);
        refreshKhadimDetailPanels();
      }
    }
  }

  function showList() {
    document.getElementById('kh-panel-list').classList.remove('hidden');
    document.getElementById('kh-panel-form').classList.remove('active');
  }

  function showAddForm() {
    clearKhadimForm();
    const t = document.getElementById('kh-form-title');
    if (t) t.textContent = 'নতুন খাদেম';
    document.getElementById('kh-panel-list').classList.add('hidden');
    document.getElementById('kh-panel-form').classList.add('active');
    document.getElementById('kh-panel-form').scrollTop = 0;
  }

  function clearKhadimForm() {
    ['kh-id', 'kh-name', 'kh-phone', 'kh-duty', 'kh-join', 'kh-address', 'kh-details'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('kh-status').value = 'active';
  }

  function editKhadim(id) {
    closeKhadimDetail();
    const k = getKhadimin().find((x) => x.id === id);
    if (!k) return;
    document.getElementById('kh-id').value = k.id;
    document.getElementById('kh-name').value = k.name || '';
    document.getElementById('kh-phone').value = k.phone || '';
    document.getElementById('kh-duty').value = k.duty || '';
    document.getElementById('kh-join').value = k.join_date || '';
    document.getElementById('kh-status').value = k.status || 'active';
    document.getElementById('kh-address').value = k.address || '';
    document.getElementById('kh-details').value = k.details || '';
    const t = document.getElementById('kh-form-title');
    if (t) t.textContent = (k.name || '') + ' — সম্পাদনা';
    document.getElementById('kh-panel-list').classList.add('hidden');
    document.getElementById('kh-panel-form').classList.add('active');
    document.getElementById('kh-panel-form').scrollTop = 0;
  }

  function daysBetween(from, to) {
    const a = new Date((from || '') + 'T12:00:00');
    const b = new Date((to || from || '') + 'T12:00:00');
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }

  function addKhadimNote() {
    if (!_openKhadimId) {
      helpers.showToast('প্রথমে তালিকা থেকে খাদেমের নামে ক্লিক করে বিস্তারিত খুলুন');
      return;
    }
    const id = _openKhadimId;
    const el = document.getElementById('khd-note-ta');
    const text = el && el.value.trim();
    if (!text) { helpers.showToast('ঘটনা/নোট লিখুন'); return; }
    const done = () => {
      if (el) el.value = '';
      renderKhadimin();
      refreshKhadimDetailPanels();
      helpers.showToast('নোট যোগ হয়েছে ✓');
    };
    if (useRemote()) {
      MDRKhadiminSupabase.addNote(id, text).then(done).catch(() => helpers.showToast('নোট সংরক্ষণ ব্যর্থ'));
      return;
    }
    const rows = loadArr(KHADIMIN_KEY).map((k) => (k.id === id ? { ...k, notes: [{ date: today(), text }].concat(k.notes || []) } : k));
    saveArr(KHADIMIN_KEY, rows);
    done();
  }

  function addLeave() {
    if (!_openKhadimId) {
      helpers.showToast('প্রথমে তালিকা থেকে খাদেমের নামে ক্লিক করে বিস্তারিত খুলুন');
      return;
    }
    const id = _openKhadimId;
    const fromEl = document.getElementById('khd-leave-from');
    const toEl = document.getElementById('khd-leave-to');
    const from = fromEl && fromEl.value;
    const to = (toEl && toEl.value) || from;
    const reasonEl = document.getElementById('khd-leave-reason');
    const reason = reasonEl && reasonEl.value.trim();
    if (!from) { helpers.showToast('ক্যালেন্ডার থেকে ছুটির তারিখ বেছে নিন'); return; }
    const done = () => {
      if (reasonEl) reasonEl.value = '';
      const t = new Date();
      leavePickState[id] = { vy: t.getFullYear(), vm: t.getMonth(), a: null, b: null };
      renderKhadimin();
      redrawLeaveCal(id);
      refreshKhadimDetailPanels();
      helpers.showToast('ছুটির হিসাব যোগ হয়েছে ✓');
    };
    if (useRemote()) {
      MDRKhadiminSupabase.addLeave(id, from, to, reason).then(done).catch(() => helpers.showToast('ছুটি সংরক্ষণ ব্যর্থ'));
      return;
    }
    const leaves = loadArr(LEAVES_KEY);
    leaves.unshift({ id: uid(), khadim_id: id, from, to, reason, days: daysBetween(from, to) });
    saveArr(LEAVES_KEY, leaves);
    done();
  }

  function pickLeaveDay(id, iso) {
    const st = ensureLeavePick(id);
    if (!st.a || (st.a && st.b)) {
      st.a = iso;
      st.b = null;
    } else if (iso < st.a) {
      st.b = st.a;
      st.a = iso;
    } else {
      st.b = iso;
    }
    redrawLeaveCal(id);
  }

  function leaveCalNav(id, delta) {
    const st = ensureLeavePick(id);
    let m = st.vm + delta;
    let y = st.vy;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    st.vm = m;
    st.vy = y;
    redrawLeaveCal(id);
  }

  function clearLeavePick(id) {
    const st = ensureLeavePick(id);
    st.a = null;
    st.b = null;
    redrawLeaveCal(id);
  }

  function renderKhadimin() {
    const rows = getKhadimin();
    const leaves = getLeaves();
    const el = document.getElementById('kh-list');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="empty-state kh-list-empty"><span class="empty-icon">🤲</span><div class="empty-text">এখনো কোনো খাদেম যোগ করা হয়নি</div></div>';
      return;
    }
    el.innerHTML = rows.map((k) => {
      const qid = jsSingleQuote(k.id);
      const bounds = academicYearBounds();
      const Ksup = global.MDRKhadiminSupabase;
      const yDays = Ksup && Ksup.leaveDaysYearToDateForKhadim
        ? Ksup.leaveDaysYearToDateForKhadim(k.id, leaves, bounds)
        : null;
      const st = k.status || 'active';
      const pcl = st === 'away' ? 'kh-pill--away' : st === 'inactive' ? 'kh-pill--inactive' : 'kh-pill--active';
      const leavePill = bounds.start
        ? `ছুটি ${helpers.toBn(yDays != null ? yDays : 0)} দিন (শিক্ষাবর্ষ)`
        : 'ছুটি — শিক্ষাবর্ষ শুরু সেট করুন';
      return `<article class="kh-card-wrap">
        <div class="kh-compact">
          <div class="kh-main-row">
            <div class="kh-av" aria-hidden="true">${initialChar(k.name)}</div>
            <div class="kh-row-text">
              <button type="button" class="kh-name-btn" onclick="MDRHomePanels.openKhadimDetail('${qid}')">${esc(k.name)}</button>
              <div class="kh-meta kh-meta--1l">${esc(k.duty || 'দায়িত্ব —')} · ${esc(k.phone || 'ফোন নেই')}</div>
            </div>
            <div class="kh-row-side">
              <span class="kh-pill ${pcl}">${statusLabel(st)}</span>
              <span class="kh-pill">${leavePill}</span>
            </div>
          </div>
          <button type="button" class="kh-edit" onclick="MDRHomePanels.editKhadim('${qid}')">সম্পাদনা</button>
        </div>
      </article>`;
    }).join('');
  }

  function statusLabel(status) {
    return status === 'away' ? 'ছুটিতে' : status === 'inactive' ? 'নিষ্ক্রিয়' : 'সক্রিয়';
  }

  var _absentDeptScope = null;

  function scopeDepts() {
    if (global.MMSession && MMSession.getAllowedMadrasaDepts) {
      const allowed = MMSession.getAllowedMadrasaDepts();
      if (allowed && allowed.length) return allowed;
    }
    return ['kitab', 'maktab'];
  }

  function getAbsentDepts() {
    if (_absentDeptScope && _absentDeptScope.length) return _absentDeptScope;
    return scopeDepts();
  }

  function absentScopeLabel(depts) {
    const deptName = (d) => (d === 'maktab' ? 'মক্তব বিভাগ' : 'কিতাব বিভাগ');
    if (!depts || !depts.length) return '';
    if (depts.length > 1) return 'সামগ্রিক';
    return deptName(depts[0]);
  }

  function absentRows() {
    const depts = getAbsentDepts();
    if (global.API && API.loadDaftarAbsentSummaryRaw) {
      const raw = API.loadDaftarAbsentSummaryRaw();
      if (raw && Array.isArray(raw.rows)) {
        const allowed = depts.length ? depts : ['kitab', 'maktab'];
        return raw.rows.filter((x) => allowed.indexOf(x.dept) >= 0);
      }
    }
    if (global.API && API.loadDaftarAbsentSummaryRows) {
      const cached = API.loadDaftarAbsentSummaryRows(depts);
      if (cached) return cached;
    }
    if (!global.API || !API.Attendance) return [];
    return depts
      .flatMap((dept) => API.Attendance.getStudentsWithAbsentSortedByDept(dept).map((x) => ({ ...x, dept })))
      .sort((a, b) => (b.absentDays || 0) - (a.absentDays || 0));
  }

  function todayAbsentRows() {
    const depts = getAbsentDepts();
    if (!global.API || !API.Attendance || !API.Students || !API.Classes) return [];
    const iso = API.today ? API.today() : new Date().toISOString().slice(0, 10);
    const out = [];
    const seen = Object.create(null);
    depts.forEach((dept) => {
      (API.Classes.getByDept(dept) || []).forEach((cls) => {
        (API.Attendance.getByClassDate(cls.id, iso) || []).forEach((rec) => {
          if (API.Attendance.statusOf(rec) !== 'absent') return;
          const sid = String(rec.student_id || '');
          const student = (API.Students.getAll() || []).find((s) =>
            s && s.active !== false && (String(s.id) === sid || String(s.supabase_id || '') === sid)
          );
          if (!student || seen[student.id]) return;
          seen[student.id] = true;
          out.push({ student, dept, absentDays: 1 });
        });
      });
    });
    out.sort((a, b) => String(a.student.name || '').localeCompare(String(b.student.name || ''), 'bn'));
    return out;
  }

  /** আজ যাদের উপস্থিত হাজিরা আছে — student_id/supabase_id দুটোই key হিসেবে রাখা হয় */
  function todayPresentIdSet() {
    const depts = getAbsentDepts();
    const out = Object.create(null);
    if (!global.API || !API.Attendance || !API.Classes) return out;
    const iso = API.today ? API.today() : new Date().toISOString().slice(0, 10);
    depts.forEach((dept) => {
      (API.Classes.getByDept(dept) || []).forEach((cls) => {
        (API.Attendance.getByClassDate(cls.id, iso) || []).forEach((rec) => {
          if (API.Attendance.statusOf(rec) !== 'present') return;
          const sid = String(rec.student_id || '');
          if (sid) out[sid] = true;
        });
      });
    });
    return out;
  }

  function renderAbsentRow(x, i, days, showDeptTag) {
    const cls = API.Classes.getById(x.student.class_id);
    const deptLabel = x.dept === 'maktab' ? 'মক্তব বিভাগ' : 'কিতাব বিভাগ';
    const metaLine = esc(cls ? cls.name : '—') + (showDeptTag ? ' · ' + esc(deptLabel) : '') + ' · রোল ' + helpers.toBn(esc(x.student.roll || '—'));
    const daysHtml =
      `<div class="abs-days-home">${days.prefix ? '<span class="abs-days-prefix">' + esc(days.prefix) + ' </span>' : ''}${helpers.toBn(days.main)} দিন` +
      (days.sub ? `<div class="abs-days-sub${days.subPresent ? ' is-present' : ''}">${esc(days.sub)}</div>` : '') +
      '</div>';
    return `<div class="abs-row-home">
      <div class="abs-rank-home">${helpers.toBn(i + 1)}</div>
      <div class="abs-info-home">
        <div class="abs-name-home"><button type="button" class="s-name-btn" style="font-size:14px;font-weight:600" onclick="MMStudentModal.open('${jsSingleQuote(x.student.id)}')">${esc(x.student.name)}</button></div>
        <div class="abs-meta-home">${metaLine}</div>
      </div>
      ${daysHtml}
    </div>`;
  }

  /** আজকের অনুপস্থিতদের টানা (ধারাবাহিক) অনুপস্থিত দিন — আজসহ। হিসাব লোকাল হাজিরা
      ক্যাশ থেকে (সাম্প্রতিক ~৩০ দিন); উপস্থিত পেলে থামে, ছুটির দিন গোনা হয় না কিন্তু
      ধারাবাহিকতা ভাঙেও না। একবারে সব ছাত্রের জন্য হিসাব হয় (getAll একবারই পড়া হয়)। */
  function buildAbsentStreaks(rows) {
    const out = Object.create(null);
    if (!global.API || !API.Attendance || !API.Attendance.getAll) return out;
    const idKey = Object.create(null); /* rec student_id → canonical student.id */
    rows.forEach((x) => {
      if (!x.student) return;
      if (x.student.id) idKey[String(x.student.id)] = String(x.student.id);
      if (x.student.supabase_id) idKey[String(x.student.supabase_id)] = String(x.student.id);
    });
    const byStudent = Object.create(null);
    (API.Attendance.getAll() || []).forEach((r) => {
      const canon = idKey[String(r.student_id || '')];
      if (!canon) return;
      const d = String(r.date || '').slice(0, 10);
      if (!d) return;
      if (!byStudent[canon]) byStudent[canon] = {};
      if (!byStudent[canon][d]) byStudent[canon][d] = r;
    });
    Object.keys(byStudent).forEach((canon) => {
      const dates = Object.keys(byStudent[canon]).sort().reverse();
      let streak = 0;
      for (let i = 0; i < dates.length; i++) {
        const st = API.Attendance.statusOf(byStudent[canon][dates[i]]);
        if (st === 'absent') streak++;
        else if (st === 'holiday') continue;
        else break;
      }
      out[canon] = streak || 1;
    });
    return out;
  }

  var _absTab = 'today'; /* 'today' | 'total' */

  function setAbsentTab(tab) {
    _absTab = tab === 'total' ? 'total' : 'today';
    renderAbsent();
    const list = document.getElementById('abs-home-list');
    if (list) list.scrollTop = 0;
  }

  function renderAbsent() {
    const depts = getAbsentDepts();
    const todayRows = todayAbsentRows();
    const totalRows = absentRows();
    const meta = document.querySelector('#modal-absent-home .kh-meta');
    if (meta) {
      const label = absentScopeLabel(depts);
      meta.textContent = (label ? label + ' — ' : '') + 'আজ = আজকের অনুপস্থিত; সর্বমোট = রেকর্ড অনুযায়ী সমগ্র তালিকা (বেশি দিন থেকে কম)।';
    }
    const tabsEl = document.getElementById('abs-home-tabs');
    if (tabsEl) {
      tabsEl.innerHTML =
        '<button type="button" class="abs-tab' + (_absTab === 'today' ? ' active' : '') + '" onclick="MDRHomePanels.setAbsentTab(\'today\')">আজ (' + helpers.toBn(todayRows.length) + ')</button>' +
        '<button type="button" class="abs-tab' + (_absTab === 'total' ? ' active' : '') + '" onclick="MDRHomePanels.setAbsentTab(\'total\')">সর্বমোট (' + helpers.toBn(totalRows.length) + ')</button>';
    }
    const el = document.getElementById('abs-home-list');
    if (!el) return;
    const showDeptTag = depts.length > 1;
    /* সর্বমোট অনুপস্থিত দিনের ম্যাপ — আজ ট্যাবে "আজসহ মোট X দিন" দেখাতে */
    const totalDaysById = Object.create(null);
    totalRows.forEach((x) => {
      if (!x.student) return;
      if (x.student.id) totalDaysById[String(x.student.id)] = x.absentDays || 0;
      if (x.student.supabase_id) totalDaysById[String(x.student.supabase_id)] = x.absentDays || 0;
    });
    const parts = [];
    if (_absTab === 'today') {
      parts.push('<div class="abs-section-sub">' + helpers.toBn(todayRows.length) + ' জন আজ অনুপস্থিত · মোট = বর্ষের শুরু থেকে আজসহ, টানা = আজসহ ধারাবাহিক · বেশি থেকে কম</div>');
      if (todayRows.length) {
        const streaks = buildAbsentStreaks(todayRows);
        const totalOf = (x) => totalDaysById[String(x.student.id)] || totalDaysById[String(x.student.supabase_id || '')] || 1;
        const sorted = todayRows.slice().sort((a, b) => totalOf(b) - totalOf(a));
        parts.push(sorted.map((x, i) => {
          const streak = streaks[String(x.student.id)] || 1;
          return renderAbsentRow(x, i, { main: totalOf(x), prefix: 'মোট', sub: 'টানা ' + helpers.toBn(streak) + ' দিন' }, showDeptTag);
        }).join(''));
      } else {
        parts.push('<div class="abs-section-empty">আজ কোনো অনুপস্থিত রেকর্ড নেই</div>');
      }
    } else {
      const presentIds = todayPresentIdSet();
      parts.push('<div class="abs-section-sub">' + helpers.toBn(totalRows.length) + ' জন · বেশি দিন থেকে কম</div>');
      if (totalRows.length) {
        parts.push(totalRows.map((x, i) => {
          const isPresentToday = !!(presentIds[String(x.student.id)] || presentIds[String(x.student.supabase_id || '')]);
          return renderAbsentRow(x, i, { main: x.absentDays, sub: isPresentToday ? 'আজ উপস্থিত' : '', subPresent: true }, showDeptTag);
        }).join(''));
      } else {
        parts.push('<div class="abs-section-empty">কোনো ছাত্রের অনুপস্থিত রেকর্ড নেই</div>');
      }
    }
    el.innerHTML = parts.join('');
  }

  function updateCards() {
    const kh = document.getElementById('m-khadimin');
    const ab = document.getElementById('m-absent-list');
    if (kh) kh.textContent = helpers.toBn(getKhadimin().filter((k) => k.status !== 'inactive').length);
    if (ab && global.API && API.Attendance) ab.textContent = helpers.toBn(absentRows().length);
  }

  function openKhadimin() {
    injectOnce();
    const open = () => {
      renderKhadimin();
      showList();
      document.getElementById('modal-khadimin').classList.add('open');
    };
    if (useRemote()) {
      MDRKhadiminSupabase.sync().then(open).catch(() => {
        helpers.showToast('খাদিমিন লোড হয়নি');
        open();
      });
    } else open();
  }

  function closeKhadimin() {
    closeKhadimDetail();
    document.getElementById('modal-khadimin').classList.remove('open');
  }

  function openAbsent(opts) {
    injectOnce();
    _absentDeptScope = (opts && Array.isArray(opts.depts) && opts.depts.length) ? opts.depts.slice() : null;
    _absTab = 'today';
    function show() {
      renderAbsent();
      document.getElementById('modal-absent-home').classList.add('open');
      const list = document.getElementById('abs-home-list');
      if (list) list.scrollTop = 0;
    }
    if (useRemote() && global.MMSession && MMSession.ensureDaftarDataReady) {
      MMSession.ensureDaftarDataReady({ silent: true }).then(show).catch(function () {
        helpers.showToast('অনুপস্থিত তালিকা লোড হয়নি');
        show();
      });
      return;
    }
    show();
  }

  function closeAbsent() {
    document.getElementById('modal-absent-home').classList.remove('open');
    _absentDeptScope = null;
  }

  function init(opts) {
    helpers = { ...helpers, ...(opts || {}) };
    injectOnce();
    if (global.API && API.hydrateSessionCache) API.hydrateSessionCache();
    if (global.API && API.rebuildDaftarAbsentSummary && API.loadDaftarAbsentSummaryRaw &&
        !API.loadDaftarAbsentSummaryRaw()) {
      try {
        var attLen = API.Attendance && API.Attendance.getAll ? API.Attendance.getAll().length : 0;
        if (attLen > 0) API.rebuildDaftarAbsentSummary();
      } catch (e) {}
    }
    updateCards();
  }

  global.MDRHomePanels = {
    init,
    setAbsentTab,
    updateCards,
    openKhadimin,
    closeKhadimin,
    showList,
    showAddForm,
    saveKhadim,
    editKhadim,
    openKhadimDetail,
    closeKhadimDetail,
    switchKhadimTab,
    addKhadimNote,
    addLeave,
    pickLeaveDay,
    leaveCalNav,
    clearLeavePick,
    openAbsent,
    closeAbsent,
  };
})(typeof window !== 'undefined' ? window : globalThis);
