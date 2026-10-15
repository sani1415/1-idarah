/**
 * পরীক্ষা বিশ্লেষণ — উত্তীর্ণ/অনুত্তীর্ণ, নম্বরের ভাগ, বিষয়ভিত্তিক গড়, শীর্ষ ও সাহায্য-দরকার ছাত্র।
 * নকশা: app/css/mm-ui.css (`ui-*`)। তিন পাতা ব্যবহার করে: madrasa-exams, admin/exams, madrasa-class-exams।
 */
(function (global) {
  'use strict';

  var PASS = 60; // উত্তীর্ণের সীমা (%)

  function getApi() {
    return typeof API !== 'undefined' ? API : null;
  }

  // ফলাফলের সারিতে বিষয় খোঁজা — id বা নাম দিয়ে (সার্ভারের ক্রম পরীক্ষার বিষয়-ক্রমের সাথে না-ও মিলতে পারে)
  function findSubj(row, sub, idx) {
    var list = (row && row.subjects) || [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (sub.id != null && x.subject_id != null && String(x.subject_id) === String(sub.id)) return x;
    }
    for (var j = 0; j < list.length; j++) {
      if (sub.name && list[j].name === sub.name) return list[j];
    }
    return list[idx] || null;
  }

  function buildStats(examId) {
    var A = getApi();
    if (!A || !A.Exams) return null;
    var exam = A.Exams.getAll().find(function (e) { return e.id === examId; });
    var results = A.Exams.getResults(examId);
    if (!exam || !results.length) return null;

    var subjects = exam.subjects || [];
    var subjStats = subjects.map(function (sub, idx) {
      var max = Number(sub.max || sub.max_marks) || 0;
      var sum = 0, n = 0, low = 0;
      results.forEach(function (row) {
        var subj = findSubj(row, sub, idx);
        if (subj && typeof subj.marks === 'number') {
          sum += subj.marks;
          n++;
          var m = Number(subj.max) || max;
          if (m && subj.marks / m * 100 < PASS) low++;
        }
      });
      if (n === 0) return { name: sub.name, max: max, avg: 0, pctOfMax: 0, n: 0, low: 0 };
      var avg = Math.round((sum / n) * 10) / 10;
      var pct = max ? Math.round((avg / max) * 1000) / 10 : 0;
      return { name: sub.name, max: max, avg: avg, pctOfMax: pct, n: n, low: low };
    });

    var pass = 0, pctSum = 0;
    var bands = [0, 0, 0, 0]; // ৮০+, ৭০–৭৯, ৬০–৬৯, ৬০-এর নিচে
    results.forEach(function (r) {
      var p = Number(r.percentage) || 0;
      pctSum += p;
      if (p >= PASS) pass++;
      bands[p >= 80 ? 0 : p >= 70 ? 1 : p >= PASS ? 2 : 3]++;
    });

    var nameOf = function (sid) {
      var s = A.Students && A.Students.getById ? A.Students.getById(sid) : null;
      return s ? s.name : '';
    };
    var ranked = results.slice().sort(function (a, b) { return (Number(b.percentage) || 0) - (Number(a.percentage) || 0); })
      .map(function (r) { return { name: nameOf(r.student_id) || r.student_name || '—', pct: Number(r.percentage) || 0, sid: r.student_id }; });

    return {
      exam: exam,
      examName: exam.name,
      resultCount: results.length,
      passCount: pass,
      failCount: results.length - pass,
      avgPct: results.length ? Math.round(pctSum / results.length * 10) / 10 : 0,
      bands: bands,
      top: ranked.slice(0, 5),
      weak: ranked.filter(function (x) { return x.pct < PASS; }).reverse().slice(0, 5),
      subjStats: subjStats
    };
  }

  /**
   * @param {string} examId
   * @param {{ esc: function, toBn: function }} ctx
   */
  function renderPanelHTML(examId, ctx) {
    var esc = ctx.esc;
    var toBn = ctx.toBn;
    var U = global.MMUI;
    var st = buildStats(examId);
    if (!st) {
      return '<div class="ui-box ui-empty">বিশ্লেষণের জন্য কমপক্ষে একটি ফলাফল লাগবে</div>';
    }
    var tone = function (p) { return U ? U.pctTone(p) : (p >= 70 ? 'ui-ok' : p >= 50 ? 'ui-warn' : 'ui-bad'); };
    var n = st.resultCount;
    var pc = function (k) { return n ? toBn(Math.round(k * 100 / n)) + '%' : ''; };
    var stat = function (o) {
      return U ? U.stat(o) : '<div class="ui-stat is-' + o.tone + '"><span class="ui-stat-txt"><span class="ui-stat-lbl">' + o.label + '</span><span class="ui-stat-val">' + o.value + '</span></span></div>';
    };
    var parts = [];
    parts.push('<div class="ui-cq exa">');
    parts.push('<div class="ui-stats">' +
      stat({ tone: 'info', icon: 'users', label: 'মোট জমা', value: toBn(n), sub: esc(st.examName || '') }) +
      stat({ tone: 'ok', icon: 'check', label: 'উত্তীর্ণ (≥৬০%)', value: toBn(st.passCount), sub: pc(st.passCount) }) +
      stat({ tone: 'bad', icon: 'alert', label: 'অনুত্তীর্ণ', value: toBn(st.failCount), sub: pc(st.failCount) }) +
      stat({ tone: st.avgPct >= 70 ? 'ok' : st.avgPct >= 50 ? 'warn' : 'bad', icon: 'star', label: 'গড় শতকরা', value: toBn(st.avgPct) + '%', sub: 'সব ছাত্রের গড়' }) +
      '</div>');

    // বিষয়ভিত্তিক
    var rows = st.subjStats.map(function (s) {
      var p = Math.min(100, s.pctOfMax || 0);
      return '<tr><td><b>' + esc(s.name) + '</b></td><td>' + toBn(s.avg) + ' / ' + toBn(s.max) + '</td>' +
        '<td class="exa-bar"><span class="ui-track"><span class="ui-fill ' + tone(p) + '" style="width:' + p + '%"></span></span></td>' +
        '<td class="' + tone(p) + '"><b>' + toBn(s.pctOfMax) + '%</b></td>' +
        '<td' + (s.low ? ' class="ui-bad"' : '') + '>' + toBn(s.low) + '</td></tr>';
    }).join('');
    var subjPanel = '<section class="ui-box ui-panel"><div class="ui-ph"><h3>বিষয়ভিত্তিক গড় নম্বর</h3><small>৭০%+ সবুজ, ৫০–৬৯ হলুদ, কম লাল</small></div>' +
      '<div style="overflow-x:auto"><table class="ui-tbl"><thead><tr><th>বিষয়</th><th>গড় / পূর্ণ</th><th class="exa-bar"></th><th>গড় %</th><th>৬০%-এর নিচে</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="ui-empty">বিষয় নেই</td></tr>') + '</tbody></table></div></section>';

    // নম্বরের ভাগ
    var BL = [['৮০% বা বেশি', 'ui-ok'], ['৭০–৭৯%', 'ui-ok'], ['৬০–৬৯%', 'ui-warn'], ['৬০%-এর নিচে', 'ui-bad']];
    var maxB = Math.max(1, st.bands[0], st.bands[1], st.bands[2], st.bands[3]);
    var bandPanel = '<section class="ui-box ui-panel"><div class="ui-ph"><h3>নম্বরের ভাগ</h3><small>কতজন কোন সীমায়</small></div><div class="exa-bands">' +
      BL.map(function (b, i) {
        return '<div class="exa-band"><span class="exa-band-l">' + b[0] + '</span><span class="ui-track"><span class="ui-fill ' + b[1] + '" style="width:' + Math.round(st.bands[i] / maxB * 100) + '%"></span></span>' +
          '<b>' + toBn(st.bands[i]) + ' জন</b></div>';
      }).join('') + '</div></section>';

    // শীর্ষ ও সাহায্য দরকার
    var list = function (arr, empty) {
      if (!arr.length) return '<div class="ui-empty">' + empty + '</div>';
      return arr.map(function (x, i) {
        return '<div class="ui-row"><span class="ui-row-main"><span class="ui-row-name">' + toBn(i + 1) + '. ' + esc(x.name) + '</span></span>' +
          '<span class="ui-row-end ' + tone(x.pct) + '"><b>' + toBn(x.pct) + '%</b></span></div>';
      }).join('');
    };
    var peoplePanel = '<section class="ui-box ui-panel"><div class="ui-ph"><h3>শীর্ষ ৫ জন</h3></div>' + list(st.top, 'কেউ নেই') +
      '<div class="ui-ph exa-sep"><h3>সাহায্য দরকার</h3><small>৬০%-এর নিচে, কম নম্বর আগে</small></div>' + list(st.weak, 'সবাই উত্তীর্ণ ✓') + '</section>';

    parts.push('<div class="ui-grid is-2 exa-grid">' + subjPanel + '<div class="exa-col">' + bandPanel + peoplePanel + '</div></div>');
    parts.push('</div>');
    return parts.join('');
  }

  global.ExamAnalytics = {
    buildStats: buildStats,
    renderPanelHTML: renderPanelHTML
  };
})(typeof window !== 'undefined' ? window : globalThis);
