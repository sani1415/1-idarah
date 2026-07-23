/* ═══════════════════════════════════════════
   মাদরাসাতুল মদীনা — chat-api.js
   শুধুমাত্র স্টাফ ↔ জিম্মাদার (অ্যাডমিন)।
   স্টাফদের মধ্যে থ্রেড বা সরাসরি যোগাযোগ নেই।
   ═══════════════════════════════════════════ */

const ChatAPI = (() => {

  let messages = [];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function save(data) {
    messages = Array.isArray(data) ? data.slice() : [];
    if (typeof window !== 'undefined') {
      if (typeof window.MMRefreshChatBadges === 'function') window.MMRefreshChatBadges();
      window.dispatchEvent(new Event('mm-chat-updated'));
    }
  }

  const THREAD_LABELS = {
    daftar:  { name:'দফতর দায়িত্বশীল',      icon:'📋' },
    hifz:    { name:'হিফজ দায়িত্বশীল',       icon:'📿' },
    library: { name:'মাকতাবা দায়িত্বশীল',  icon:'📚' },
    alumni:  { name:'পুরনো ছাত্র দায়িত্বশীল', icon:'🎓' },
    khedmat: { name:'খেদমত দায়িত্বশীল',      icon:'🤝' },
  };

  function getLabel(thread_id) {
    if (THREAD_LABELS[thread_id]) return THREAD_LABELS[thread_id];
    if (thread_id.startsWith('teacher-')) return { name:'বর্ষ দায়িত্বশীল', icon:'📖' };
    if (thread_id.startsWith('dept-'))    return { name:'বিভাগ দায়িত্বশীল', icon:'🏢' };
    return { name:thread_id, icon:'👤' };
  }

  /* ── SEED ── */
  function seedIfEmpty() {
    /* Production prototype: do not auto-create sample chat messages. */
  }

  /* ── API ── */

  function getThreads() {
    const msgs = messages;
    const threads = {};
    msgs.forEach(m => {
      if (!threads[m.thread_id]) threads[m.thread_id] = { thread_id:m.thread_id, staff_name:'', msgs:[] };
      if (m.from_role !== 'admin' && m.from_name) threads[m.thread_id].staff_name = m.from_name;
      threads[m.thread_id].msgs.push(m);
    });
    return Object.values(threads).map(t => ({
      thread_id:  t.thread_id,
      staff_name: t.staff_name || getLabel(t.thread_id).name,
      label:      getLabel(t.thread_id),
      last_msg:   t.msgs[t.msgs.length-1],
      unread:     t.msgs.filter(m => m.from_role !== 'admin' && !m.read_admin).length,
    })).sort((a,b) => (b.last_msg?.ts||'').localeCompare(a.last_msg?.ts||''));
  }

  function getThread(thread_id) {
    return messages.filter(m => m.thread_id === thread_id).sort((a,b) => a.ts.localeCompare(b.ts));
  }

  function getAllMessages() {
    return messages.slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  }

  function getRecentMessages(limit) {
    return getAllMessages().slice(0, limit == null ? 25 : limit);
  }

  function send(thread_id, from_role, from_name, text, extra) {
    const m = {
      id: uid(), thread_id, from_role, from_name, text,
      ts: new Date().toISOString(),
      read_admin: from_role === 'admin',
      read_staff: from_role !== 'admin',
      ...(extra || {}),
    };
    save(messages.concat(m));
    return m;
  }

  function updateMessage(id, updater) {
    let updated = null;
    const msgs = messages.map(m => {
      if (m.id !== id) return m;
      updated = typeof updater === 'function' ? updater({ ...m }) : { ...m, ...(updater || {}) };
      return updated;
    });
    save(msgs);
    return updated;
  }

  function markReadAdmin(thread_id) {
    save(messages.map(m => m.thread_id===thread_id && m.from_role!=='admin' ? {...m,read_admin:true} : m));
  }

  function markReadStaff(thread_id) {
    save(messages.map(m => m.thread_id===thread_id && m.from_role==='admin' ? {...m,read_staff:true} : m));
  }

  function countUnreadStaff(thread_id) {
    return messages.filter(m => m.thread_id===thread_id && m.from_role==='admin' && !m.read_staff).length;
  }

  function countUnreadAdmin() {
    return messages.filter(m => m.from_role!=='admin' && !m.read_admin).length;
  }

  function normalizeRemoteMessages(raw) {
    let rows = raw;
    if (typeof rows === 'string') {
      try { rows = JSON.parse(rows); } catch (e) { rows = []; }
    }
    if (!Array.isArray(rows)) rows = [];
    return rows;
  }

  async function syncRemote(actorId, pin, isAdmin) {
    if (!globalThis.MMSharedAPI || !pin) return { ok: false, error: 'chat_not_configured' };
    const res = await MMSharedAPI.chatBootstrap(actorId || null, pin, !!isAdmin);
    if (!res || !res.ok) {
      return { ok: false, error: (res && res.error) || 'chat_sync_failed', res: res || null };
    }
    const remoteMsgs = normalizeRemoteMessages(res.messages).map(m => ({
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
    save(remoteMsgs);
    return { ok: true, count: remoteMsgs.length };
  }

  async function sendRemote(actorId, pin, threadId, text, isAdmin, extra) {
    if (!globalThis.MMSharedAPI || !pin) return null;
    return MMSharedAPI.chatSend(actorId || null, pin, threadId, text, !!isAdmin, extra && extra.request ? extra.request : null);
  }

  async function updateRequestRemote(actorId, pin, messageId, status) {
    if (!globalThis.MMSharedAPI || !pin || !messageId) return null;
    return MMSharedAPI.chatUpdateRequest(actorId || null, pin, messageId, status);
  }

  async function markReadRemote(actorId, pin, threadId, isAdmin) {
    if (!globalThis.MMSharedAPI || !pin || !threadId) return false;
    const res = await MMSharedAPI.chatMarkRead(actorId || null, pin, threadId, !!isAdmin);
    return !!(res && res.ok);
  }

  seedIfEmpty();
  return {
    getThreads, getThread, getAllMessages, getRecentMessages,
    send, updateMessage, markReadAdmin, markReadStaff,
    countUnreadStaff, countUnreadAdmin, getLabel, esc,
    syncRemote, sendRemote, updateRequestRemote, markReadRemote,
  };

})();

if (typeof globalThis !== 'undefined') {
  globalThis.ChatAPI = ChatAPI;
}
