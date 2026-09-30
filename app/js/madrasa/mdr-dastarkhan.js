/* দফতর — দস্তরখান: তালিকা · রান্না · দায়িত্ব (Supabase + localStorage ফallback) */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'mm_dastarkhan_weekly';
  const MODAL_ID = 'modal-dastarkhan';
  const MODAL_VER = '3';

  const DAYS = [
    { key: 'sat', label: 'শনিবার' },
    { key: 'sun', label: 'রবিবার' },
    { key: 'mon', label: 'সোমবার' },
    { key: 'tue', label: 'মঙ্গলবার' },
    { key: 'wed', label: 'বুধবার' },
    { key: 'thu', label: 'বৃহস্পতিবার' },
    { key: 'fri', label: 'শুক্রবার' },
  ];

  const MEALS = [
    { key: 'breakfast', label: 'সকাল' },
    { key: 'lunch', label: 'দুপুর' },
    { key: 'dinner', label: 'রাত' },
  ];

  const SHEETS = {
    menu: {
      label: 'তালিকা',
      hint: 'সপ্তাহ শনিবার থেকে শুরু। প্রতিটি দিন ও বেলার খাদ্যসূচী লিখুন। লগইন থাকলে ডেটাবেসে সংরক্ষিত।',
    },
    cooking: {
      label: 'রান্না',
      hint: 'কোন দিন, কোন বেলায় কার রান্নার দায়িত্ব — নাম বা গ্রুপ লিখুন। লগইন থাকলে ডেটাবেসে সংরক্ষিত।',
    },
    duty: {
      label: 'দস্তরখান',
      hint: 'কোন দিন কোন বর্ষের দস্তরখান প্রস্তুত ও সাজানোর দায়িত্ব লিখুন। লগইন থাকলে ডেটাবেসে সংরক্ষিত।',
    },
  };

  /** @type {'menu'|'cooking'|'duty'} */
  let _activeSheet = 'menu';
  let helpers = { showToast: function () {} };
  /** @type {{menu:object,cooking:object,duty:object}|null} সার্ভার বা সর্বশেষ সফল লোড */
  let _cachedBundle = null;

  function _actor() {
    if (!global.MMSession) return null;
    if (MMSession.isAdmin && MMSession.isAdmin()) {
      return { id: MMSession.getAdminUserId && MMSession.getAdminUserId(), pin: MMSession.getAdminPin && MMSession.getAdminPin() };
    }
    return { id: MMSession.getStaffUserId && MMSession.getStaffUserId(), pin: MMSession.getStaffPin && MMSession.getStaffPin() };
  }

  function esc(s) {
    return global.API && API.esc ? API.esc(s) : String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]);
    });
  }

  function defaultGrid() {
    const o = {};
    DAYS.forEach(function (d) {
      o[d.key] = { breakfast: '', lunch: '', dinner: '' };
    });
    return o;
  }

  function mergeGrid(parsed) {
    var base = defaultGrid();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
    DAYS.forEach(function (d) {
      var row = parsed[d.key];
      if (row && typeof row === 'object') {
        MEALS.forEach(function (m) {
          base[d.key][m.key] = row[m.key] != null ? String(row[m.key]) : '';
        });
      }
    });
    return base;
  }

  function loadBundleLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { menu: defaultGrid(), cooking: defaultGrid(), duty: defaultGrid() };
      }
      var p = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p) && p.menu && typeof p.menu === 'object') {
        return {
          menu: mergeGrid(p.menu),
          cooking: mergeGrid(p.cooking),
          duty: mergeGrid(p.duty),
        };
      }
      return {
        menu: mergeGrid(p),
        cooking: defaultGrid(),
        duty: defaultGrid(),
      };
    } catch (e) {
      return { menu: defaultGrid(), cooking: defaultGrid(), duty: defaultGrid() };
    }
  }

  function bundleFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { menu: defaultGrid(), cooking: defaultGrid(), duty: defaultGrid() };
    }
    return {
      menu: mergeGrid(payload.menu),
      cooking: mergeGrid(payload.cooking),
      duty: mergeGrid(payload.duty),
    };
  }

  function loadBundleForRender() {
    if (_cachedBundle) return _cachedBundle;
    return loadBundleLocal();
  }

  function saveBundleLocal(b) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        menu: b.menu,
        cooking: b.cooking,
        duty: b.duty,
      })
    );
  }

  function sync() {
    var a = _actor();
    if (!a || !a.id || !a.pin || !global.MMSharedAPI || !MMSharedAPI.supabaseClient) {
      _cachedBundle = null;
      return Promise.resolve(false);
    }
    return MMSharedAPI.dastarkhanGet(a.id, a.pin)
      .then(function (res) {
        if (res && res.ok) {
          _cachedBundle = bundleFromPayload(res.payload);
          return true;
        }
        _cachedBundle = null;
        return false;
      })
      .catch(function () {
        _cachedBundle = null;
        return false;
      });
  }

  function cellId(sheetKey, dayKey, mealKey) {
    return 'dst-' + sheetKey + '-' + dayKey + '-' + mealKey;
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing && existing.getAttribute('data-dst-ver') === MODAL_VER) return;
    if (existing) existing.remove();
    var stOld = document.getElementById('mdr-dastarkhan-style');
    if (stOld) stOld.remove();

    var style = document.createElement('style');
    style.id = 'mdr-dastarkhan-style';
    style.textContent =
      '#modal-dastarkhan.modal-bg{align-items:center;justify-content:center;padding:16px;z-index:210}' +
      '#modal-dastarkhan .dst-modal{width:min(720px,calc(100vw - 24px));max-height:min(88vh,calc(100vh - 24px));' +
      'border-radius:20px;padding:14px 14px 16px;box-sizing:border-box;background:#fffef9;' +
      'border:1px solid rgba(201,149,42,.12);box-shadow:0 24px 64px rgba(26,18,8,.14);display:flex;flex-direction:column;overflow:hidden}' +
      '.dst-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;flex-shrink:0}' +
      '.dst-modal-title{font-family:\"Tiro Bangla\",serif;font-size:16px;font-weight:800;color:var(--ink)}' +
      '.dst-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;flex-shrink:0}' +
      '.dst-tab{border:1px solid var(--cream3);background:#fff;color:var(--ink2);border-radius:10px;' +
      'padding:8px 14px;font-family:\"Tiro Bangla\",serif;font-size:12px;font-weight:800;cursor:pointer;line-height:1.2}' +
      '.dst-tab:hover{background:var(--cream2)}' +
      '.dst-tab--active{background:linear-gradient(180deg,rgba(201,149,42,.22),rgba(201,149,42,.12));color:var(--ink);border-color:rgba(201,149,42,.45)}' +
      '.dst-tab:focus-visible{outline:2px solid var(--gold);outline-offset:2px}' +
      '.dst-hint{font-size:11px;color:var(--ink3);line-height:1.45;margin:0 0 10px;flex-shrink:0}' +
      '.dst-panel{display:none;flex-direction:column;flex:1;min-height:0}' +
      '.dst-panel--active{display:flex}' +
      '.dst-table-wrap{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;margin-bottom:12px;border-radius:12px;border:1px solid var(--cream3)}' +
      '.dst-sheet{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}' +
      '.dst-sheet th,.dst-sheet td{border:1px solid var(--cream2);padding:0;vertical-align:top}' +
      '.dst-sheet thead th{background:var(--ink);color:var(--gold2);padding:8px 6px;text-align:left;font-weight:700;font-size:10px}' +
      '.dst-sheet .dst-day-col{width:22%;background:var(--cream2);font-weight:800;color:var(--ink2);padding:8px 6px;white-space:nowrap}' +
      '.dst-cell{width:100%;min-height:48px;border:0;resize:vertical;margin:0;font-family:\"Tiro Bangla\",serif;font-size:11px;' +
      'padding:8px;box-sizing:border-box;background:#fff;color:var(--ink2);line-height:1.4}' +
      '.dst-cell:focus{outline:2px solid var(--gold);outline-offset:-2px}' +
      '.dst-sheet tbody tr:nth-child(even) .dst-cell{background:#fffaf5}';
    document.head.appendChild(style);

    var tabsHtml =
      '<div class="dst-tabs" role="tablist" aria-label="দস্তরখান বিভাগ">' +
      Object.keys(SHEETS)
        .map(function (key) {
          return (
            '<button type="button" class="dst-tab' +
            (key === 'menu' ? ' dst-tab--active' : '') +
            '" role="tab" data-dst-sheet="' +
            key +
            '" aria-selected="' +
            (key === 'menu' ? 'true' : 'false') +
            '">' +
            esc(SHEETS[key].label) +
            '</button>'
          );
        })
        .join('') +
      '</div>';

    var panelsHtml = Object.keys(SHEETS)
      .map(function (key) {
        return (
          '<div class="dst-panel' +
          (key === 'menu' ? ' dst-panel--active' : '') +
          '" id="dst-panel-' +
          key +
          '" role="tabpanel" data-dst-sheet="' +
          key +
          '" aria-hidden="' +
          (key === 'menu' ? 'false' : 'true') +
          '">' +
          '<div class="dst-table-wrap"><table class="dst-sheet" id="dst-sheet-' +
          key +
          '" aria-label="' +
          esc(SHEETS[key].label) +
          '"></table></div></div>'
        );
      })
      .join('');

    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'modal-bg';
    wrap.setAttribute('data-dst-ver', MODAL_VER);
    wrap.innerHTML =
      '<div class="modal dst-modal">' +
      '<div class="dst-modal-head">' +
      '<div class="dst-modal-title">দস্তরখান</div>' +
      '<button type="button" class="modal-close" aria-label="বন্ধ" onclick="MDRDastarkhan.close()">✕</button>' +
      '</div>' +
      tabsHtml +
      '<p class="dst-hint" id="dst-hint">' +
      esc(SHEETS.menu.hint) +
      '</p>' +
      panelsHtml +
      '<button type="button" class="submit-btn gold" onclick="MDRDastarkhan.save()">সংরক্ষণ করুন</button>' +
      '</div>';
    wrap.addEventListener('click', function (e) {
      if (e.target.id === MODAL_ID) MDRDastarkhan.close();
    });
    var inner = wrap.querySelector('.dst-modal');
    if (inner) inner.addEventListener('click', function (e) { e.stopPropagation(); });

    wrap.querySelectorAll('.dst-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-dst-sheet');
        if (key && SHEETS[key]) setActiveSheet(key);
      });
    });

    document.body.appendChild(wrap);
    _activeSheet = 'menu';
  }

  function setActiveSheet(key) {
    if (!SHEETS[key]) return;
    _activeSheet = key;
    var hint = document.getElementById('dst-hint');
    if (hint) hint.textContent = SHEETS[key].hint;
    document.querySelectorAll('#' + MODAL_ID + ' .dst-tab').forEach(function (b) {
      var k = b.getAttribute('data-dst-sheet');
      var on = k === key;
      b.classList.toggle('dst-tab--active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#' + MODAL_ID + ' .dst-panel').forEach(function (p) {
      var k = p.getAttribute('data-dst-sheet');
      var on = k === key;
      p.classList.toggle('dst-panel--active', on);
      p.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
  }

  function buildTableHTML(sheetKey) {
    var head =
      '<thead><tr><th class="dst-day-col">বার</th>' +
      MEALS.map(function (m) { return '<th>' + esc(m.label) + '</th>'; }).join('') +
      '</tr></thead>';
    var body = '<tbody>';
    DAYS.forEach(function (d) {
      body += '<tr><td class="dst-day-col">' + esc(d.label) + '</td>';
      MEALS.forEach(function (m) {
        body +=
          '<td><textarea class="dst-cell" rows="2" id="' +
          cellId(sheetKey, d.key, m.key) +
          '" aria-label="' +
          esc(SHEETS[sheetKey].label + ': ' + d.label + ', ' + m.label) +
          '"></textarea></td>';
      });
      body += '</tr>';
    });
    body += '</tbody>';
    return head + body;
  }

  function fillTable(sheetKey, grid) {
    DAYS.forEach(function (d) {
      MEALS.forEach(function (m) {
        var el = document.getElementById(cellId(sheetKey, d.key, m.key));
        if (el) el.value = (grid[d.key] && grid[d.key][m.key]) || '';
      });
    });
  }

  function renderTables() {
    var bundle = loadBundleForRender();
    Object.keys(SHEETS).forEach(function (sk) {
      var table = document.getElementById('dst-sheet-' + sk);
      if (!table) return;
      table.innerHTML = buildTableHTML(sk);
      fillTable(sk, bundle[sk] || defaultGrid());
    });
  }

  function readGridFromForm(sheetKey) {
    var grid = defaultGrid();
    DAYS.forEach(function (d) {
      MEALS.forEach(function (m) {
        var el = document.getElementById(cellId(sheetKey, d.key, m.key));
        grid[d.key][m.key] = el ? el.value.trim() : '';
      });
    });
    return grid;
  }

  function open() {
    ensureModal();
    sync().finally(function () {
      renderTables();
      setActiveSheet('menu');
      document.getElementById(MODAL_ID).classList.add('open');
    });
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove('open');
  }

  function save() {
    var bundle = {
      menu: readGridFromForm('menu'),
      cooking: readGridFromForm('cooking'),
      duty: readGridFromForm('duty'),
    };
    _cachedBundle = bundle;
    var a = _actor();
    if (a && global.MMSharedAPI && MMSharedAPI.supabaseClient) {
      MMSharedAPI.dastarkhanSave(a.id, a.pin, bundle)
        .then(function (res) {
          if (res && res.ok) {
            helpers.showToast('দস্তরখান সংরক্ষিত ✓');
            return;
          }
          throw new Error((res && res.error) || 'save_failed');
        })
        .catch(function (e) {
          /* ফোনে রাখা হয় না — অন্যরা দেখতে পাবে না বলে; ফর্মে লেখা থেকে যায়, আবার চাপুন */
          helpers.showToast(String((e && e.message) || e) === 'pin_locked'
            ? 'অনেকবার ভুল পিন — ১৫ মিনিট পরে আবার চেষ্টা করুন'
            : 'সংরক্ষণ হয়নি — ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন');
        });
      return;
    }
    saveBundleLocal(bundle);
    helpers.showToast('দস্তরখান সংরক্ষিত ✓ (স্থানীয়)');
  }

  function init(opts) {
    helpers = Object.assign({}, helpers, opts || {});
  }

  global.MDRDastarkhan = {
    init: init,
    open: open,
    close: close,
    save: save,
    sync: sync,
  };
})(typeof window !== 'undefined' ? window : globalThis);
