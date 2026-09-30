/* দফতর দায়িত্বশীলের নোট — Supabase RPC + localStorage ফallback */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'mm_daftar_staff_notes';
  const MODAL_ID = 'modal-daftar-notes';
  const MODAL_VER = '4';

  let helpers = { showToast: function () {} };
  /** @type {string|null} */
  let _editingId = null;
  /** @type {Array<{id:string,text:string,created_at:string}>} */
  let _notes = [];

  function esc(s) {
    return global.API && API.esc ? API.esc(s) : String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]);
    });
  }

  function uid() {
    return 'dn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function isUuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));
  }

  function _actor() {
    if (!global.MMSession) return null;
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      return { id: MMSession.getAdminUserId && MMSession.getAdminUserId(), pin: MMSession.getAdminPin && MMSession.getAdminPin() };
    }
    return { id: MMSession.getStaffUserId && MMSession.getStaffUserId(), pin: MMSession.getStaffPin && MMSession.getStaffPin() };
  }

  /** তালিকায় দেখানোর জন্য — প্রথম লাইনকে শিরোনাম */
  function noteTitleLine(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '(খালি নোট)';
    var first = raw.split('\n')[0].trim();
    return first || '(খালি নোট)';
  }

  function loadNotesFromLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  function saveNotesToLocal(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || []));
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (r) {
      if (!r) return null;
      return {
        id: String(r.id || ''),
        text: r.text != null ? String(r.text) : '',
        created_at: r.created_at != null ? String(r.created_at) : '',
      };
    }).filter(function (x) { return x && x.id; });
  }

  function pullFromServer() {
    var a = _actor();
    if (!a || !a.id || !a.pin || !global.MMSharedAPI || !MMSharedAPI.supabaseClient) {
      return Promise.resolve(false);
    }
    return MMSharedAPI.daftarNotesList(a.id, a.pin)
      .then(function (res) {
        if (res && res.ok && Array.isArray(res.notes)) {
          _notes = normalizeRows(res.notes);
          return true;
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  function loadNotes() {
    return _notes;
  }

  function syncEditorChrome() {
    var lbl = document.getElementById('dan-editor-label');
    var btnSave = document.getElementById('dan-btn-save');
    var btnCancel = document.getElementById('dan-btn-cancel');
    if (lbl) {
      lbl.textContent = _editingId ? 'নোট সম্পাদনা' : 'নতুন নোট';
    }
    if (btnSave) {
      btnSave.textContent = _editingId ? 'আপডেট করুন' : 'নোট যোগ করুন';
    }
    if (btnCancel) {
      btnCancel.style.display = _editingId ? 'inline-flex' : 'none';
    }
  }

  function clearEdit() {
    _editingId = null;
    var inp = document.getElementById('dan-input');
    if (inp) inp.value = '';
    syncEditorChrome();
    renderList();
  }

  function ensureModal() {
    var old = document.getElementById(MODAL_ID);
    if (old && old.getAttribute('data-dan-ver') === MODAL_VER) return;
    if (old) old.remove();
    var stOld = document.getElementById('mdr-daftar-notes-style');
    if (stOld) stOld.remove();

    var style = document.createElement('style');
    style.id = 'mdr-daftar-notes-style';
    style.textContent =
      '#modal-daftar-notes.modal-bg{' +
      'align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 16px 16px;z-index:210;' +
      'backdrop-filter:blur(2px)}' +
      '#modal-daftar-notes .dan-modal{' +
      'width:min(760px,calc(100vw - 28px));max-width:100%;' +
      'height:min(88vh,calc(100vh - 24px));max-height:min(880px,88vh);' +
      'border-radius:22px;padding:0;box-sizing:border-box;' +
      'background:linear-gradient(180deg,#fffef9 0%,#fcfaf5 6%,#fff 14%);' +
      'border:1px solid rgba(201,149,42,.14);' +
      'box-shadow:0 4px 6px rgba(26,18,8,.05),0 28px 72px rgba(26,18,8,.16);' +
      'display:flex;flex-direction:column;overflow:hidden}' +
      '.dan-head{' +
      'flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;' +
      'padding:18px 20px 12px;border-bottom:1px solid rgba(26,18,8,.06)}' +
      '.dan-title{' +
      'font-family:\"Tiro Bangla\",serif;font-size:19px;font-weight:800;color:var(--ink);line-height:1.25}' +
      '.dan-title-sub{font-size:11px;font-weight:600;color:var(--ink3);margin-top:4px}' +
      '.dan-hint{' +
      'flex-shrink:0;font-size:12px;color:var(--ink2);line-height:1.55;margin:0;padding:10px 20px 14px;' +
      'background:rgba(201,149,42,.06);border-bottom:1px solid rgba(26,18,8,.05)}' +
      '.dan-list-wrap{flex:1;min-height:140px;overflow:hidden;padding:14px 20px 10px;display:flex;flex-direction:column}' +
      '.dan-list{flex:1;overflow-y:auto;min-height:0;padding-right:6px}' +
      '.dan-item{' +
      'position:relative;background:#fff;border:1px solid rgba(26,18,8,.08);border-radius:14px;' +
      'margin-bottom:10px;box-shadow:0 2px 8px rgba(26,18,8,.04);transition:border-color .15s,box-shadow .15s}' +
      '.dan-item:hover{box-shadow:0 4px 14px rgba(26,18,8,.07)}' +
      '.dan-item--active{border-color:var(--gold);box-shadow:0 0 0 2px rgba(201,149,42,.25)}' +
      '.dan-item-del{' +
      'position:absolute;top:8px;right:8px;z-index:2;width:32px;height:32px;border:none;border-radius:10px;' +
      'background:var(--cream2);color:var(--red);cursor:pointer;font-size:14px;line-height:1;' +
      'display:flex;align-items:center;justify-content:center}' +
      '.dan-item-del:hover{background:rgba(180,60,50,.12)}' +
      '.dan-item-body{cursor:pointer;padding:10px 40px 10px 14px;min-height:44px;display:flex;align-items:center}' +
      '.dan-item-title{' +
      'font-size:14px;font-weight:700;line-height:1.35;color:var(--ink);' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;word-break:break-word;min-width:0;flex:1}' +
      '.dan-empty{text-align:center;color:var(--ink3);font-size:13px;padding:28px 16px;line-height:1.6}' +
      '.dan-composer{' +
      'flex-shrink:0;padding:16px 20px 20px;border-top:1px solid rgba(26,18,8,.07);' +
      'background:linear-gradient(180deg,rgba(255,254,249,.9) 0%,#fff 100%)}' +
      '.dan-editor-label{' +
      'font-size:12px;font-weight:800;color:var(--ink2);margin-bottom:8px;display:flex;align-items:center;gap:8px}' +
      '.dan-editor-label::before{content:\"\";width:4px;height:14px;border-radius:2px;background:var(--gold)}' +
      '.dan-ta{width:100%;min-height:110px;max-height:min(240px,35vh);box-sizing:border-box;' +
      'border:1px solid var(--cream3);border-radius:14px;padding:12px 14px;' +
      'font-family:\"Tiro Bangla\",serif;font-size:14px;line-height:1.5;resize:vertical;background:#fff}' +
      '.dan-ta:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,149,42,.15)}' +
      '.dan-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:center}' +
      '.dan-actions .submit-btn.gold{flex:1;min-width:140px;margin:0}' +
      '.dan-btn-cancel{' +
      'border:1px solid var(--cream3);background:#fff;color:var(--ink2);border-radius:12px;padding:10px 18px;' +
      'font-family:\"Tiro Bangla\",serif;font-size:13px;font-weight:800;cursor:pointer}' +
      '.dan-btn-cancel:hover{background:var(--cream2)}';
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'modal-bg';
    wrap.setAttribute('data-dan-ver', MODAL_VER);
    wrap.innerHTML =
      '<div class="modal dan-modal">' +
      '<div class="dan-head">' +
      '<div><div class="dan-title">দফতরের দায়িত্বশীল — নোট</div>' +
      '<div class="dan-title-sub">নোটে ট্যাপ করলে সম্পাদনা খুলবে</div></div>' +
      '<button type="button" class="modal-close" aria-label="বন্ধ" onclick="MDRDaftarNotes.close()">✕</button>' +
      '</div>' +
      '<p class="dan-hint">চিন্তা, পরিকল্পনা বা ঘটনার বিবরণ। ডাটাবেজে সংরক্ষিত হয়।</p>' +
      '<div class="dan-list-wrap"><div class="dan-list" id="dan-list-root"></div></div>' +
      '<div class="dan-composer">' +
      '<div class="dan-editor-label" id="dan-editor-label">নতুন নোট</div>' +
      '<textarea class="dan-ta" id="dan-input" rows="4" placeholder="এখানে লিখুন…"></textarea>' +
      '<div class="dan-actions">' +
      '<button type="button" class="dan-btn-cancel" id="dan-btn-cancel" onclick="MDRDaftarNotes.cancelEdit()" style="display:none">বাতিল</button>' +
      '<button type="button" class="submit-btn gold" id="dan-btn-save" onclick="MDRDaftarNotes.save()">নোট যোগ করুন</button>' +
      '</div></div></div>';
    wrap.addEventListener('click', function (e) {
      if (e.target.id === MODAL_ID) MDRDaftarNotes.close();
    });
    var inner = wrap.querySelector('.dan-modal');
    if (inner) inner.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(wrap);
  }

  function renderList() {
    var root = document.getElementById('dan-list-root');
    if (!root) return;
    var notes = loadNotes().slice().sort(function (a, b) {
      var ta = (a.created_at || '') + (a.id || '');
      var tb = (b.created_at || '') + (b.id || '');
      return tb < ta ? -1 : tb > ta ? 1 : 0;
    });
    if (!notes.length) {
      root.innerHTML = '<div class="dan-empty">এখনো কোনো নোট নেই। নিচে লিখে যোগ করুন।</div>';
    } else {
      root.innerHTML = notes.map(function (n) {
        var idAttr = esc(String(n.id || ''));
        var active = n.id === _editingId ? ' dan-item--active' : '';
        var title = esc(noteTitleLine(n.text));
        return (
          '<div class="dan-item' + active + '" data-note-id="' + idAttr + '">' +
          '<button type="button" class="dan-item-del" data-id="' + idAttr + '" aria-label="মুছুন">✕</button>' +
          '<div class="dan-item-body" role="button" tabindex="0" data-id="' + idAttr + '" aria-label="সম্পাদনার জন্য খুলুন">' +
          '<span class="dan-item-title">' + title + '</span>' +
          '</div></div>'
        );
      }).join('');
    }
    root.onclick = function (e) {
      var del = e.target.closest('.dan-item-del');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        var did = del.getAttribute('data-id');
        if (did) remove(did);
        return;
      }
      var body = e.target.closest('.dan-item-body');
      if (body) {
        var id = body.getAttribute('data-id');
        if (id) beginEdit(id);
      }
    };
    root.onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      var body = e.target.closest('.dan-item-body');
      if (!body) return;
      e.preventDefault();
      var id = body.getAttribute('data-id');
      if (id) beginEdit(id);
    };
  }

  function beginEdit(id) {
    var n = loadNotes().find(function (x) { return x.id === id; });
    if (!n) return;
    _editingId = id;
    var inp = document.getElementById('dan-input');
    if (inp) {
      inp.value = n.text || '';
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e2) {}
    }
    syncEditorChrome();
    renderList();
  }

  function cancelEdit() {
    clearEdit();
  }

  function open() {
    ensureModal();
    _editingId = null;
    syncEditorChrome();
    var inp = document.getElementById('dan-input');
    if (inp) inp.value = '';
    document.getElementById(MODAL_ID).classList.add('open');
    pullFromServer().then(function (ok) {
      if (!ok) _notes = loadNotesFromLocal();
      renderList();
      if (inp) setTimeout(function () { inp.focus(); }, 200);
    });
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove('open');
    _editingId = null;
    syncEditorChrome();
  }

  function saveLocalFallback(text) {
    var list = loadNotesFromLocal();
    if (_editingId) {
      var idx = list.findIndex(function (n) { return n.id === _editingId; });
      if (idx < 0) {
        helpers.showToast('নোট খুঁজে পাওয়া যায়নি');
        clearEdit();
        return;
      }
      list[idx] = { id: list[idx].id, created_at: list[idx].created_at || todayIso(), text: text };
      saveNotesToLocal(list);
      _notes = list;
      helpers.showToast('নোট আপডেট হয়েছে ✓');
      clearEdit();
      return;
    }
    list.unshift({ id: uid(), created_at: todayIso(), text: text });
    saveNotesToLocal(list);
    _notes = list;
    var inp = document.getElementById('dan-input');
    if (inp) inp.value = '';
    renderList();
    helpers.showToast('নোট সংরক্ষিত ✓');
  }

  function save() {
    var inp = document.getElementById('dan-input');
    var text = inp && inp.value.trim();
    if (!text) {
      helpers.showToast('নোট লিখুন');
      return;
    }
    var a = _actor();
    if (a && global.MMSharedAPI && MMSharedAPI.supabaseClient) {
      var idForRpc = _editingId && isUuid(_editingId) ? _editingId : null;
      MMSharedAPI.daftarNotesUpsert(a.id, a.pin, idForRpc, text)
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'upsert_failed');
          return pullFromServer();
        })
        .then(function (ok) {
          if (!ok) throw new Error('pull_failed');
          renderList();
          var wasEdit = !!_editingId;
          _editingId = null;
          if (inp) inp.value = '';
          syncEditorChrome();
          helpers.showToast(wasEdit ? 'নোট আপডেট হয়েছে ✓' : 'নোট সংরক্ষিত ✓');
        })
        .catch(function (e) {
          /* ফোনে রাখা হয় না — লেখা বক্সেই থাকে, আবার চাপুন */
          helpers.showToast(String((e && e.message) || e) === 'pin_locked'
            ? 'অনেকবার ভুল পিন — ১৫ মিনিট পরে আবার চেষ্টা করুন'
            : 'সংরক্ষণ হয়নি — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন');
        });
      return;
    }
    saveLocalFallback(text);
  }

  function removeLocal(id) {
    if (_editingId === id) {
      _editingId = null;
      var inp = document.getElementById('dan-input');
      if (inp) inp.value = '';
    }
    var list = loadNotesFromLocal().filter(function (n) { return n.id !== id; });
    saveNotesToLocal(list);
    _notes = list;
    syncEditorChrome();
    renderList();
    helpers.showToast('নোট মুছে ফেলা হয়েছে');
  }

  function remove(id) {
    if (!id) return;
    var a = _actor();
    if (a && global.MMSharedAPI && MMSharedAPI.supabaseClient && isUuid(id)) {
      MMSharedAPI.daftarNotesDelete(a.id, a.pin, id)
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'delete_failed');
          if (_editingId === id) {
            _editingId = null;
            var inp = document.getElementById('dan-input');
            if (inp) inp.value = '';
          }
          return pullFromServer();
        })
        .then(function (ok) {
          if (!ok) throw new Error('pull_failed');
          renderList();
          syncEditorChrome();
          helpers.showToast('নোট মুছে ফেলা হয়েছে');
        })
        .catch(function () {
          helpers.showToast('সার্ভারে মোছা ব্যর্থ');
        });
      return;
    }
    removeLocal(id);
  }

  function sync() {
    return pullFromServer().then(function (ok) {
      if (!ok) _notes = loadNotesFromLocal();
      return ok;
    });
  }

  function init(opts) {
    helpers = Object.assign({}, helpers, opts || {});
  }

  global.MDRDaftarNotes = {
    init: init,
    open: open,
    close: close,
    save: save,
    add: save,
    cancelEdit: cancelEdit,
    sync: sync,
  };
})(typeof window !== 'undefined' ? window : globalThis);
