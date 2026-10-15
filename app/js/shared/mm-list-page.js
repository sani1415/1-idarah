/**
 * ছাত্র-তালিকা পাতার সাধারণ কাঠামো (অনুপস্থিত, আলহামদুলিল্লাহ, বিশেষ পর্যবেক্ষণ, ছুটি)।
 * mm-ui.css + mm-ui.js লাগে।
 *
 * MMListPage.mount({
 *   el, title, sub,
 *   items: [{ id, name, roll, clsId, clsName, dept, value, badge, badgeTone, note, noteTone, bar, barTone }],
 *   buckets: [{ tone, icon, label, sub, test(item) }]   // প্রথম ঘর "সবাই"; চাপলে ছাঁকনি
 *            ({ ..., value(items) } দিলে শুধু তথ্য-ঘর, ছাঁকনি নয়)
 *   sorts: [{ key, label, cmp(a, b) }],
 *   empty: 'কেউ নেই…', emptyTitle, emptyIcon,
 * })
 */
(function (global) {
  'use strict';

  var esc = function (v) { return global.MMUI.esc(v); };
  var bn = function (v) { return global.MMUI.bn(v); };

  function mount(cfg) {
    var root = typeof cfg.el === 'string' ? document.getElementById(cfg.el) : cfg.el;
    if (!root) return;
    var items = cfg.items || [];
    var sorts = cfg.sorts && cfg.sorts.length ? cfg.sorts : [{ key: 'def', label: 'স্বাভাবিক', cmp: null }];
    var st = { bucket: -1, cls: '', sort: sorts[0].key, q: '' };
    var uid = 'lp' + Math.random().toString(36).slice(2, 7);

    var classes = [];
    var seen = {};
    items.forEach(function (x) {
      var k = String(x.clsId || '');
      if (!seen[k]) { seen[k] = 1; classes.push({ id: k, name: x.clsName || '—' }); }
    });

    root.classList.add('ui-cq');
    root.innerHTML =
      '<div class="ui-head"><div class="ui-head-l"><h2 class="ui-title">' + esc(cfg.title) + '</h2>' +
      (cfg.sub ? '<span class="ui-sub">' + esc(cfg.sub) + '</span>' : '') + '</div></div>' +
      '<div class="ui-stats" id="' + uid + '-stats"></div>' +
      (items.length ? '<div class="ui-box ui-filters lp-filters">' +
        '<label class="ui-field"><span>বর্ষ</span><select id="' + uid + '-cls"><option value="">সব বর্ষ</option>' +
        classes.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
        (sorts.length > 1 ? '<label class="ui-field"><span>সাজানো</span><select id="' + uid + '-sort">' +
          sorts.map(function (s) { return '<option value="' + esc(s.key) + '">' + esc(s.label) + '</option>'; }).join('') + '</select></label>' : '') +
        '<label class="ui-field"><span>খুঁজুন</span><input type="search" id="' + uid + '-q" placeholder="নাম বা পরিচিতি"></label>' +
        '</div>' : '') +
      '<section class="ui-box ui-panel"><div class="ui-ph"><h3 id="' + uid + '-cnt"></h3><small>নামে চাপলে বিবরণ</small></div>' +
      '<div class="lp-list" id="' + uid + '-list"></div></section>';

    function byId(s) { return document.getElementById(uid + '-' + s); }

    function renderStats() {
      var b = cfg.buckets || [];
      byId('stats').className = 'ui-stats' + (b.length === 3 ? ' is-3' : '');
      byId('stats').innerHTML = b.map(function (k, i) {
        if (typeof k.value === 'function') {
          return global.MMUI.stat({ tone: k.tone, icon: k.icon, label: k.label, value: k.value(items), sub: k.sub || '' });
        }
        var n = items.filter(k.test || function () { return true; }).length;
        return global.MMUI.stat({
          tone: k.tone, icon: k.icon, label: k.label, value: bn(n) + ' জন', sub: k.sub || '',
          on: st.bucket === i, onclick: items.length ? 'MMListPage._bucket(\'' + uid + '\',' + i + ')' : '',
        });
      }).join('');
    }

    function filtered() {
      var b = st.bucket >= 0 && cfg.buckets ? cfg.buckets[st.bucket] : null;
      var q = st.q.trim().toLowerCase();
      var out = items.filter(function (x) {
        if (b && b.test && !b.test(x)) return false;
        if (st.cls && String(x.clsId || '') !== st.cls) return false;
        if (q && String(x.name || '').toLowerCase().indexOf(q) < 0 && String(x.roll || '').indexOf(q) < 0 && bn(x.roll || '').indexOf(q) < 0) return false;
        return true;
      });
      var s = sorts.filter(function (z) { return z.key === st.sort; })[0];
      if (s && s.cmp) out = out.slice().sort(s.cmp);
      return out;
    }

    function rowHtml(x, i) {
      return '<div class="ui-row is-link lp-row" onclick="MMStudentModal.open(\'' + esc(x.id) + '\')">' +
        '<span class="lp-rank">' + bn(i + 1) + '</span>' +
        '<span class="ui-row-main"><span class="ui-row-name">' + esc(x.name) + '</span>' +
        '<span class="ui-row-meta">' + esc(x.clsName || '—') + (x.deptName ? ' · ' + esc(x.deptName) : '') +
        ' · পরিচিতি ' + esc(bn(x.roll || '—')) +
        (x.note ? ' · <b class="' + (x.noteTone ? 'ui-' + x.noteTone : '') + '">' + esc(x.note) + '</b>' : '') + '</span>' +
        (x.bar != null ? '<span class="ui-track lp-track"><span class="ui-fill ui-' + (x.barTone || 'ok') + '" style="width:' + Math.max(4, Math.min(100, x.bar)) + '%"></span></span>' : '') +
        '</span>' +
        (x.badge ? '<span class="ui-badge is-' + (x.badgeTone || 'info') + '">' + esc(x.badge) + '</span>' : '') +
        '</div>';
    }

    function renderList() {
      var rows = filtered();
      byId('cnt').textContent = 'ছাত্র (' + bn(rows.length) + ' জন)';
      byId('list').innerHTML = rows.length
        ? rows.map(rowHtml).join('')
        : (items.length ? '<div class="ui-empty">এই বাছাইয়ে কেউ নেই।</div>'
          : global.MMUI.empty({ icon: cfg.emptyIcon || 'check', title: cfg.emptyTitle || 'তালিকা খালি', sub: cfg.empty || '' }));
    }

    function render() { renderStats(); renderList(); }

    if (items.length) {
      byId('cls').addEventListener('change', function (e) { st.cls = e.target.value; renderList(); });
      if (byId('sort')) byId('sort').addEventListener('change', function (e) { st.sort = e.target.value; renderList(); });
      byId('q').addEventListener('input', function (e) { st.q = e.target.value; renderList(); });
    }
    INST[uid] = { st: st, render: render };
    render();
  }

  var INST = {};
  function bucket(uid, i) {
    var x = INST[uid];
    if (!x) return;
    x.st.bucket = x.st.bucket === i || i === 0 ? -1 : i;
    x.render();
  }

  /** দিন-ভিত্তিক তালিকার (অনুপস্থিত/ছুটি) সাধারণ ঘর ও সাজানো */
  function dayBuckets(totalLabel, totalSub) {
    return [
      { tone: 'bad', icon: 'users', label: totalLabel, sub: totalSub },
      { tone: 'bad', icon: 'alert', label: '৭+ দিন', sub: 'জরুরি খোঁজ নিন', test: function (x) { return x.value >= 7; } },
      { tone: 'warn', icon: 'clock', label: '৩–৬ দিন', test: function (x) { return x.value >= 3 && x.value < 7; } },
      { tone: 'info', icon: 'check', label: '১–২ দিন', test: function (x) { return x.value < 3; } },
    ];
  }
  function dayTone(v) { return v >= 7 ? 'bad' : v >= 3 ? 'warn' : 'info'; }
  var SORT_NAME = { key: 'name', label: 'নাম অনুযায়ী', cmp: function (a, b) { return String(a.name).localeCompare(String(b.name), 'bn'); } };
  var SORT_CLASS = { key: 'cls', label: 'বর্ষ অনুযায়ী', cmp: function (a, b) { return (a.clsOrder || 0) - (b.clsOrder || 0) || String(a.clsName).localeCompare(String(b.clsName), 'bn') || (Number(a.roll) || 0) - (Number(b.roll) || 0); } };
  var SORT_DAYS = { key: 'days', label: 'বেশি দিন আগে', cmp: function (a, b) { return (b.value || 0) - (a.value || 0); } };

  global.MMListPage = {
    mount: mount, _bucket: bucket, dayBuckets: dayBuckets, dayTone: dayTone,
    SORT_NAME: SORT_NAME, SORT_CLASS: SORT_CLASS, SORT_DAYS: SORT_DAYS,
  };
})(typeof window !== 'undefined' ? window : this);
