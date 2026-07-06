/**
 * বর্ষের নিজাম — শিক্ষক এডিট / নতুন ভার্সন / ডিলিট।
 */
(function (global) {
  'use strict';

  var TIME_PLACEHOLDER = '৫:৩০';

  var hooks = {
    getActor: function () { return null; },
    notify: function () {},
    escapeHtml: function (s) { return String(s || ''); },
    toBn: function (n) { return String(n); },
    formatDateTime: function (iso) { return String(iso || ''); },
    confirm: function (msg) { return global.confirm(msg); },
  };

  var state = {
    loaded: false,
    loading: false,
    data: null,
    viewingRoutineId: null,
    editing: false,
    editMode: null,
    draftSlots: [],
    saving: false,
  };

  function esc(s) { return hooks.escapeHtml(s); }
  function toBn(n) { return hooks.toBn(n); }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function toLatinDigits(s) {
    return String(s || '').replace(/[০-৯]/g, function (ch) {
      var i = '০১২৩৪৫৬৭৮৯'.indexOf(ch);
      return i >= 0 ? String(i) : ch;
    });
  }

  function formatClockText(hour, minute) {
    if (!hour) return '';
    return toBn(pad2(hour)) + ':' + toBn(pad2(minute || 0));
  }

  function parseClockText(raw) {
    var norm = toLatinDigits(String(raw || '').trim());
    var m = norm.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h < 1 || h > 12 || min < 0 || min > 59) return null;
    return { hour: h, minute: min };
  }

  function parseDraftTime(clock, ampm) {
    if (!String(clock || '').trim()) return null;
    var c = parseClockText(clock);
    if (!c) return null;
    var ap = String(ampm || 'AM').toUpperCase();
    if (ap !== 'AM' && ap !== 'PM') ap = 'AM';
    return { hour: c.hour, minute: c.minute, ampm: ap };
  }

  function formatTime(hour, minute, ampm) {
    if (!hour) return '—';
    return toBn(pad2(hour)) + ':' + toBn(pad2(minute || 0)) + ' ' + ampm;
  }

  function formatRange(slot) {
    var start = formatTime(slot.start_hour, slot.start_minute, slot.start_ampm);
    if (slot.end_hour) {
      return start + ' – ' + formatTime(slot.end_hour, slot.end_minute, slot.end_ampm);
    }
    return start;
  }

  function timeKey(slot) {
    var h = Number(slot.start_hour) || 0;
    var m = Number(slot.start_minute) || 0;
    var ap = String(slot.start_ampm || 'AM').toUpperCase();
    if (ap === 'AM' && h === 12) return m;
    if (ap === 'AM') return h * 60 + m;
    if (h === 12) return 12 * 60 + m;
    return (h + 12) * 60 + m;
  }

  function sortSlots(slots) {
    return (slots || []).slice().sort(function (a, b) {
      var ak = timeKey(a);
      var bk = timeKey(b);
      if (ak !== bk) return ak - bk;
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
  }

  function emptySlot() {
    return {
      start_clock: '',
      start_ampm: 'AM',
      end_clock: '',
      end_ampm: 'AM',
      label: '',
    };
  }

  function cloneSlots(slots) {
    return sortSlots(slots || []).map(function (s) {
      return {
        start_clock: formatClockText(s.start_hour, s.start_minute),
        start_ampm: s.start_ampm === 'PM' ? 'PM' : 'AM',
        end_clock: s.end_hour ? formatClockText(s.end_hour, s.end_minute) : '',
        end_ampm: s.end_ampm === 'PM' ? 'PM' : 'AM',
        label: String(s.label || ''),
      };
    });
  }

  function draftSortKey(slot) {
    var p = parseDraftTime(slot.start_clock, slot.start_ampm);
    if (!p) return 99999;
    if (p.ampm === 'AM' && p.hour === 12) return p.minute;
    if (p.ampm === 'AM') return p.hour * 60 + p.minute;
    if (p.hour === 12) return 12 * 60 + p.minute;
    return (p.hour + 12) * 60 + p.minute;
  }

  function buildPayload() {
    var sorted = state.draftSlots.slice().sort(function (a, b) {
      return draftSortKey(a) - draftSortKey(b);
    });
    return sorted.map(function (s, idx) {
      var start = parseDraftTime(s.start_clock, s.start_ampm);
      var end = parseDraftTime(s.end_clock, s.end_ampm);
      var row = {
        sort_order: idx + 1,
        start_hour: start.hour,
        start_minute: start.minute,
        start_ampm: start.ampm,
        label: String(s.label || '').trim(),
        activity_type: 'other',
      };
      if (end) {
        row.end_hour = end.hour;
        row.end_minute = end.minute;
        row.end_ampm = end.ampm;
      }
      return row;
    });
  }

  function viewingRoutine() {
    if (!state.data) return null;
    if (state.viewingRoutineId) return state.data.viewing || null;
    return state.data.current || null;
  }

  function isReadOnly() {
    if (state.editing) return false;
    if (!state.data || !state.data.current) return false;
    if (!state.viewingRoutineId) return false;
    return state.viewingRoutineId !== state.data.current.id;
  }

  async function load() {
    var actor = hooks.getActor();
    if (!actor || !actor.id || !actor.pin) return;
    state.loading = true;
    render();
    try {
      var res = await global.MMSharedAPI.classRoutineGet(
        actor.id,
        actor.pin,
        null,
        state.viewingRoutineId
      );
      if (!res || !res.ok) throw new Error((res && res.error) || 'load_failed');
      state.data = res;
      state.loaded = true;
    } catch (e) {
      console.warn('[MDRClassRoutine] load failed', e);
      hooks.notify('নিজাম লোড হয়নি');
    } finally {
      state.loading = false;
      render();
    }
  }

  function startEdit(mode) {
    if (isReadOnly()) return;
    var cur = state.data && state.data.current;
    state.editing = true;
    state.editMode = mode === 'new' ? 'new' : 'update';
    if (state.editMode === 'new') {
      state.draftSlots = cur ? cloneSlots(cur.slots) : [emptySlot()];
    } else {
      if (!cur) return;
      state.draftSlots = cloneSlots(cur.slots);
    }
    if (!state.draftSlots.length) state.draftSlots = [emptySlot()];
    render();
  }

  function cancelEdit() {
    state.editing = false;
    state.editMode = null;
    state.draftSlots = [];
    render();
  }

  function addSlot() {
    state.draftSlots.push(emptySlot());
    render();
  }

  function removeSlot(idx) {
    state.draftSlots.splice(idx, 1);
    if (!state.draftSlots.length) state.draftSlots = [emptySlot()];
    render();
  }

  function updateSlot(idx, field, value) {
    if (!state.draftSlots[idx]) return;
    state.draftSlots[idx][field] = value;
  }

  function validateDraft() {
    for (var i = 0; i < state.draftSlots.length; i++) {
      var s = state.draftSlots[i];
      if (!parseDraftTime(s.start_clock, s.start_ampm)) {
        return 'স্লট ' + toBn(i + 1) + ': শুরুর সময় ' + TIME_PLACEHOLDER + ' ফরম্যাটে লিখুন';
      }
      if (String(s.end_clock || '').trim() && !parseDraftTime(s.end_clock, s.end_ampm)) {
        return 'স্লট ' + toBn(i + 1) + ': শেষের সময় ' + TIME_PLACEHOLDER + ' ফরম্যাটে লিখুন';
      }
      if (!String(s.label || '').trim()) {
        return 'স্লট ' + toBn(i + 1) + ': কাজের নাম লিখুন';
      }
    }
    return '';
  }

  async function saveDraft() {
    if (state.saving) return;
    var err = validateDraft();
    if (err) {
      hooks.notify(err);
      return;
    }
    var actor = hooks.getActor();
    if (!actor) return;
    var noteEl = global.document.getElementById('nizam-change-note');
    var note = noteEl ? String(noteEl.value || '').trim() : '';
    var hasCurrent = !!(state.data && state.data.current);
    var isNew = state.editMode === 'new';

    if (isNew && hasCurrent && !note) {
      hooks.notify('নতুন নিজামের কারণ সংক্ষেপে লিখুন');
      if (noteEl) noteEl.focus();
      return;
    }

    state.saving = true;
    render();
    try {
      var payload = buildPayload();
      var res;
      if (isNew) {
        res = await global.MMSharedAPI.classRoutineSave(actor.id, actor.pin, payload, note);
        if (!res || !res.ok) throw new Error((res && res.error) || 'save_failed');
        hooks.notify('নতুন নিজাম সংরক্ষিত — ভার্সন ' + toBn(res.version_no));
      } else {
        res = await global.MMSharedAPI.classRoutineUpdate(actor.id, actor.pin, payload, note || null);
        if (!res || !res.ok) throw new Error((res && res.error) || 'update_failed');
        hooks.notify('চলমান নিজাম আপডেট হয়েছে');
      }
      state.editing = false;
      state.editMode = null;
      state.draftSlots = [];
      state.viewingRoutineId = null;
      await load();
    } catch (e) {
      console.warn('[MDRClassRoutine] save failed', e);
      hooks.notify(isNew ? 'নতুন নিজাম সংরক্ষণ হয়নি' : 'নিজাম আপডেট হয়নি');
    } finally {
      state.saving = false;
      render();
    }
  }

  async function deleteVersion(routineId, versionNo) {
    if (!routineId) return;
    var msg = 'ভার্সন ' + toBn(versionNo || '') + ' মুছে ফেলবেন? এটি ফিরিয়ে আনা যাবে না।';
    if (!hooks.confirm(msg)) return;
    var actor = hooks.getActor();
    if (!actor) return;
    state.saving = true;
    render();
    try {
      var res = await global.MMSharedAPI.classRoutineDelete(actor.id, actor.pin, routineId);
      if (!res || !res.ok) throw new Error((res && res.error) || 'delete_failed');
      if (state.viewingRoutineId === routineId) state.viewingRoutineId = null;
      hooks.notify(res.deleted_all ? 'নিজাম মুছে ফেলা হয়েছে' : 'ভার্সন মুছে ফেলা হয়েছে');
      await load();
    } catch (e) {
      console.warn('[MDRClassRoutine] delete failed', e);
      hooks.notify('মুছে ফেলা হয়নি');
    } finally {
      state.saving = false;
      render();
    }
  }

  async function viewVersion(routineId) {
    state.viewingRoutineId = routineId || null;
    state.editing = false;
    state.editMode = null;
    await load();
  }

  function backToCurrent() {
    state.viewingRoutineId = null;
    load();
  }

  function ampmSelect(field, idx, value) {
    var ap = value === 'PM' ? 'PM' : 'AM';
    return (
      '<select class="form-input form-select awqat-ampm-select" data-field="' + field + '" data-idx="' + idx + '" aria-label="AM/PM">' +
        '<option value="AM"' + (ap === 'AM' ? ' selected' : '') + '>AM</option>' +
        '<option value="PM"' + (ap === 'PM' ? ' selected' : '') + '>PM</option>' +
      '</select>'
    );
  }

  function renderSlotEditor(slot, idx) {
    return (
      '<div class="awqat-edit-row" data-slot-idx="' + idx + '">' +
        '<div class="awqat-edit-row-hd">' +
          '<span>স্লট ' + toBn(idx + 1) + '</span>' +
          '<button type="button" class="awqat-link-btn" data-action="remove-slot" data-idx="' + idx + '">মুছুন</button>' +
        '</div>' +
        '<div class="awqat-time-inline">' +
          '<div class="awqat-time-group">' +
            '<input class="form-input awqat-time-input" type="text" inputmode="decimal" autocomplete="off" ' +
              'placeholder="' + TIME_PLACEHOLDER + '" maxlength="8" value="' + esc(slot.start_clock) + '" ' +
              'data-field="start_clock" data-idx="' + idx + '" aria-label="শুরুর সময়">' +
            ampmSelect('start_ampm', idx, slot.start_ampm) +
          '</div>' +
          '<span class="awqat-time-sep">–</span>' +
          '<div class="awqat-time-group">' +
            '<input class="form-input awqat-time-input" type="text" inputmode="decimal" autocomplete="off" ' +
              'placeholder="' + TIME_PLACEHOLDER + '" maxlength="8" value="' + esc(slot.end_clock) + '" ' +
              'data-field="end_clock" data-idx="' + idx + '" aria-label="শেষের সময় (ঐচ্ছিক)">' +
            ampmSelect('end_ampm', idx, slot.end_ampm) +
          '</div>' +
        '</div>' +
        '<input class="form-input awqat-label-input" type="text" maxlength="120" placeholder="কাজের নাম, যেমন: নাহু দরস" ' +
          'value="' + esc(slot.label) + '" data-field="label" data-idx="' + idx + '">' +
      '</div>'
    );
  }

  function renderTimeline(slots) {
    var sorted = sortSlots(slots);
    if (!sorted.length) {
      return '<div class="awqat-empty">এখনো কোনো স্লট নেই।</div>';
    }
    return sorted.map(function (slot) {
      return (
        '<div class="awqat-slot">' +
          '<div class="awqat-slot-time">' + esc(formatRange(slot)) + '</div>' +
          '<div class="awqat-slot-body">' +
            '<div class="awqat-slot-label">' + esc(slot.label) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderVersions() {
    var versions = (state.data && state.data.versions) || [];
    if (!versions.length) return '';
    var html = '<div class="awqat-versions"><div class="awqat-versions-hd">সব নিজামের ভার্সন</div>';
    versions.forEach(function (v) {
      var active = state.viewingRoutineId
        ? v.id === state.viewingRoutineId
        : !!v.is_current;
      var badge = v.is_current ? '<span class="awqat-badge">চলমান</span>' : '';
      html += (
        '<div class="awqat-version-row' + (active ? ' is-active' : '') + '">' +
          '<button type="button" class="awqat-version-btn" data-action="view-version" data-id="' + esc(v.id) + '">' +
            '<span>ভার্সন ' + toBn(v.version_no) + badge + '</span>' +
            '<span class="awqat-version-meta">' + esc(hooks.formatDateTime(v.created_at)) +
              (v.slot_count ? ' · ' + toBn(v.slot_count) + ' স্লট' : '') +
            '</span>' +
          '</button>' +
          '<button type="button" class="awqat-version-del" data-action="delete-version" data-id="' + esc(v.id) + '" data-version="' + esc(String(v.version_no)) + '" aria-label="ভার্সন মুছুন">✕</button>' +
        '</div>'
      );
    });
    html += '</div>';
    return html;
  }

  function render() {
    var root = global.document.getElementById('nizam-root');
    if (!root) return;

    if (state.loading && !state.data) {
      root.innerHTML = '<div class="awqat-empty">লোড হচ্ছে…</div>';
      return;
    }

    var routine = viewingRoutine();
    var readOnly = isReadOnly();
    var html = '';
    var isNew = state.editMode === 'new';

    if (state.editing) {
      if (isNew) {
        html += '<p class="awqat-lead">নতুন নিজাম তৈরি করুন। সংরক্ষণ করলে নতুন ভার্সন যোগ হবে; আগের ভার্সনগুলো থেকে যাবে।</p>';
        if (state.data && state.data.current) {
          html += '<div class="form-group"><label class="form-label">নতুন নিজামের কারণ</label><input class="form-input" id="nizam-change-note" type="text" maxlength="200" placeholder="যেমন: রমজানের পর সময় বদল"></div>';
        }
      } else {
        html += '<p class="awqat-lead">চলমান নিজাম সম্পাদনা করুন। সংরক্ষণ করলে একই ভার্সন আপডেট হবে।</p>';
      }
      html += '<div class="awqat-edit-list">' + state.draftSlots.map(renderSlotEditor).join('') + '</div>';
      html += '<button type="button" class="btn-secondary awqat-add-btn" data-action="add-slot">+ স্লট যোগ করুন</button>';
      html += '<div class="awqat-actions">';
      html += '<button type="button" class="submit-btn" data-action="save"' + (state.saving ? ' disabled' : '') + '>' +
        (state.saving ? 'সংরক্ষণ…' : (isNew ? 'নতুন নিজাম সংরক্ষণ' : 'আপডেট সংরক্ষণ')) +
      '</button>';
      html += '<button type="button" class="btn-secondary" data-action="cancel-edit">বাতিল</button>';
      html += '</div>';
      root.innerHTML = html;
      bindEvents(root);
      return;
    }

    if (!routine) {
      html += '<p class="awqat-lead">বছরের শুরুতে দৈনিক নিজাম নির্ধারণ করুন। সারা বছর একই নিজাম চলবে।</p>';
      html += '<div class="awqat-empty">এখনো নিজাম তৈরি হয়নি।</div>';
      html += '<button type="button" class="submit-btn" data-action="start-new">নিজাম তৈরি করুন</button>';
      root.innerHTML = html;
      bindEvents(root);
      return;
    }

    if (readOnly) {
      html += '<div class="awqat-readonly-banner">পুরনো ভার্সন — শুধু দেখা</div>';
      html += '<button type="button" class="btn-secondary awqat-back-btn" data-action="back-current">চলমান নিজামে ফিরুন</button>';
    } else {
      html += '<p class="awqat-lead">চলমান নিজাম। সম্পাদনা করলে একই ভার্সন আপডেট হবে; নতুন নিজাম করলে নতুন ভার্সন তৈরি হবে।</p>';
      html += '<div class="awqat-action-row">';
      html += '<button type="button" class="submit-btn awqat-edit-btn" data-action="start-edit">সম্পাদনা</button>';
      html += '<button type="button" class="btn-secondary awqat-edit-btn" data-action="start-new">+ নতুন নিজাম</button>';
      html += '</div>';
    }

    if (routine.change_note) {
      html += '<div class="awqat-note">নোট: ' + esc(routine.change_note) + '</div>';
    }

    html += renderTimeline(routine.slots || []);
    html += renderVersions();
    root.innerHTML = html;
    bindEvents(root);
  }

  function bindEvents(root) {
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        if (action === 'start-edit') startEdit('update');
        if (action === 'start-new') startEdit('new');
        if (action === 'cancel-edit') cancelEdit();
        if (action === 'add-slot') addSlot();
        if (action === 'save') saveDraft();
        if (action === 'back-current') backToCurrent();
        if (action === 'view-version') viewVersion(btn.getAttribute('data-id'));
        if (action === 'delete-version') deleteVersion(btn.getAttribute('data-id'), btn.getAttribute('data-version'));
        if (action === 'remove-slot') removeSlot(Number(btn.getAttribute('data-idx')));
      });
    });

    root.querySelectorAll('[data-field]').forEach(function (el) {
      function sync() {
        var idx = Number(el.getAttribute('data-idx'));
        var field = el.getAttribute('data-field');
        updateSlot(idx, field, el.value);
      }
      el.addEventListener('change', sync);
      el.addEventListener('input', sync);
    });
  }

  function onShow() {
    if (!state.loaded && !state.loading) load();
    else render();
  }

  function reset() {
    state.loaded = false;
    state.data = null;
    state.viewingRoutineId = null;
    state.editing = false;
    state.editMode = null;
    state.draftSlots = [];
  }

  global.MDRClassRoutine = {
    bind: function (opts) {
      hooks.getActor = opts.getActor || hooks.getActor;
      hooks.notify = opts.notify || hooks.notify;
      hooks.escapeHtml = opts.escapeHtml || hooks.escapeHtml;
      hooks.toBn = opts.toBn || hooks.toBn;
      hooks.formatDateTime = opts.formatDateTime || hooks.formatDateTime;
      hooks.confirm = opts.confirm || hooks.confirm;
    },
    onShow: onShow,
    reset: reset,
    render: render,
  };
})(window);
