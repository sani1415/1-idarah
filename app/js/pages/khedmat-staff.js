  const myRole = MMSession.getRole();
  const myName = MMSession.getName() || 'খেদমত দায়িত্বশীল';
  if (myRole !== 'khedmat' && myRole !== 'admin') { location.href = '../index.html'; }
  mmInsertMonitorBanner();
  MMSession.configureTopbarHubAndLockout();
  const khActorId = MMSession.getId ? MMSession.getId() : (MMSession.isAdmin() ? MMSession.getAdminUserId() : MMSession.getStaffUserId());
  const khPin = MMSession.getPin ? MMSession.getPin() : (MMSession.isAdmin() ? MMSession.getAdminPin() : MMSession.getStaffPin());

  const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const toBn = n => String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const fmtAmt = n => '৳' + toBn(Number(n).toLocaleString('en'));
  const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return toBn(p[2]+'/'+p[1]+'/'+p[0]); };
  const fmtMonth = m => { const p = m.split('-'); return BN_MONTHS[parseInt(p[1])-1]+' '+toBn(p[0]); };
  const fmtYear = y => toBn(y);

  let activeBenId = null;
  let activeAcctTab = 'all';
  let activeAcctPeriod = '';
  let openFinEntryId = null;
  let openActItemId = null;
  let lightboxImages = [];
  let lightboxIndex = 0;
  let pendingImgActId = null;
  let editingActId = null;
  let editingFinId = null;
  let editingLogId = null;

  function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
  function openModal(id) { if (mmMutationBlocked(showToast)) return; document.getElementById(id).classList.add('open'); }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  }
  function afterSave(id, renderFn, toastMsg) {
    closeModal(id);
    if (renderFn) {
      try { renderFn(); } catch (err) { console.error('[Khedmat] render after save failed:', err); }
    }
    if (toastMsg) showToast(toastMsg);
  }
  function showDbError(err) { console.error('[Khedmat] database operation failed:', err); showToast('ডাটাবেজে সংরক্ষণ হয়নি'); }
  async function refreshKhedmatData() { await KhAPI.bootstrapRemote(khActorId, khPin); }

  function switchPanel(name) {
    ['ben','fin','log'].forEach(p => {
      document.getElementById('panel-'+p).style.display = p===name ? '' : 'none';
      document.getElementById('nav-'+p).classList.toggle('active', p===name);
    });
    if (name==='ben') renderBen();
    if (name==='fin') renderFin();
    if (name==='log') renderLog();
  }

  function benInitial(name) {
    const t = String(name || '').trim();
    return t ? KhAPI.esc(t.charAt(0)) : '?';
  }

  function benActivityStats(benId) {
    const acts = KhAPI.Activities.getByBeneficiary(benId);
    const total = acts.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    let lastDate = null;
    acts.forEach(a => { if (a.date && (!lastDate || a.date > lastDate)) lastDate = a.date; });
    return { count: acts.length, total, lastDate };
  }

  function renderBenStats() {
    const bens = KhAPI.Beneficiaries.getAll();
    const month = new Date().toISOString().slice(0, 7);
    const monthActs = KhAPI.Activities.getAll().filter(a => (a.date || '').startsWith(month)).length;
    const totalHelp = KhAPI.Activities.getAll().reduce((s, a) => s + (Number(a.amount) || 0), 0);
    document.getElementById('ben-stats').innerHTML = `<div class="kh-hero"><div class="kh-hero-stats">
      <div class="kh-stat"><span class="kh-stat-val">${toBn(bens.length)}</span><span class="kh-stat-lbl">মাখদুম</span></div>
      <div class="kh-stat"><span class="kh-stat-val">${toBn(monthActs)}</span><span class="kh-stat-lbl">এই মাসে কার্যক্রম</span></div>
      <div class="kh-stat"><span class="kh-stat-val red">${fmtAmt(totalHelp)}</span><span class="kh-stat-lbl">মোট সাহায্য</span></div>
    </div></div>`;
  }

  function renderBen() {
    renderBenStats();
    const bens = KhAPI.Beneficiaries.getAll();
    document.getElementById('ben-list').innerHTML = bens.length
      ? bens.map(b => {
          const st = benActivityStats(b.id);
          return `<div class="ben-card" onclick="openBenDetail('${b.id}')">
            <div class="ben-top">
              <div class="ben-avatar">${benInitial(b.name)}</div>
              <div class="ben-info">
                <div class="ben-name">${KhAPI.esc(b.name)}</div>
                <div class="ben-addr">${KhAPI.esc(b.address || 'ঠিকানা উল্লেখ নেই')}</div>
                <div class="ben-meta">
                  <span class="ben-chip">${toBn(st.count)} কার্যক্রম</span>
                  ${st.lastDate ? `<span class="ben-chip">শেষ: ${fmtDate(st.lastDate)}</span>` : ''}
                </div>
              </div>
              <div class="ben-side">
                ${st.total ? `<div class="ben-side-amt">${fmtAmt(st.total)}</div><div class="ben-side-sub">মোট সাহায্য</div>` : '<div class="ben-side-sub">—</div>'}
              </div>
            </div>
          </div>`;
        }).join('')
      : '<div class="kh-empty">কোনো মাখদুম নেই — উপরে বাটন দিয়ে যোগ করুন</div>';
  }

  function openAddBen() {
    ['b-name','b-addr','b-phone','b-family','b-notes'].forEach(id => document.getElementById(id).value='');
    document.getElementById('b-date').value = KhAPI.today();
    openModal('modal-ben');
  }

  async function saveBen() {
    if (mmMutationBlocked(showToast)) return;
    const name = document.getElementById('b-name').value.trim();
    const addr = document.getElementById('b-addr').value.trim();
    if (!name) { showToast('নাম দিন'); return; }
    try {
      await KhAPI.Beneficiaries.add({ name, address:addr, phone:document.getElementById('b-phone').value.trim(), family_info:document.getElementById('b-family').value.trim(), notes:document.getElementById('b-notes').value.trim(), first_contact:document.getElementById('b-date').value || KhAPI.today() }, khActorId, khPin);
    } catch (err) { showDbError(err); return; }
    afterSave('modal-ben', renderBen, 'মাখদুম যোগ হয়েছে');
  }

  function openBenDetail(id) {
    activeBenId = id;
    const ben = KhAPI.Beneficiaries.getById(id);
    if (!ben) return;
    document.getElementById('bd-title').textContent = ben.name;
    renderBenDetail(ben);
    document.getElementById('ben-detail').classList.add('open');
  }

  function renderBenDetail(ben) {
    const acts = KhAPI.Activities.getByBeneficiary(ben.id);
    const types = KhAPI.ActivityTypes.getAll();
    const typeMap = {}; types.forEach(t => typeMap[t.id] = t);
    const st = benActivityStats(ben.id);
    const infoRows = [
      ben.address ? `<div class="bd-info-row"><span>ঠিকানা: </span>${KhAPI.esc(ben.address)}</div>` : '',
      ben.phone ? `<div class="bd-info-row"><span>ফোন: </span>${KhAPI.esc(ben.phone)}</div>` : '',
      ben.family_info ? `<div class="bd-info-row"><span>পরিবার: </span>${KhAPI.esc(ben.family_info)}</div>` : '',
      ben.notes ? `<div class="bd-info-row"><span>নোট: </span>${KhAPI.esc(ben.notes)}</div>` : '',
      `<div class="bd-info-row"><span>প্রথম যোগাযোগ: </span>${fmtDate(ben.first_contact)}</div>`
    ].filter(Boolean).join('');
    document.getElementById('bd-content').innerHTML = `
      <div class="bd-profile">
        <div class="bd-profile-top">
          <div class="bd-avatar">${benInitial(ben.name)}</div>
          <div>
            <div class="bd-name">${KhAPI.esc(ben.name)}</div>
            <div class="bd-addr">${KhAPI.esc(ben.address || 'ঠিকানা উল্লেখ নেই')}</div>
          </div>
        </div>
        <div class="bd-stats">
          <div class="bd-stat"><span class="bd-stat-val">${toBn(st.count)}</span><span class="bd-stat-lbl">কার্যক্রম</span></div>
          <div class="bd-stat"><span class="bd-stat-val red">${st.total ? fmtAmt(st.total) : '—'}</span><span class="bd-stat-lbl">মোট সাহায্য</span></div>
          <div class="bd-stat"><span class="bd-stat-val">${st.lastDate ? fmtDate(st.lastDate) : '—'}</span><span class="bd-stat-lbl">শেষ সাহায্য</span></div>
        </div>
        <div class="bd-info-grid">${infoRows}</div>
      </div>
      <div class="d-section">
        <div class="d-section-hd">
          <div class="d-section-title">কার্যক্রমের ইতিহাস</div>
          <button class="topbar-btn" style="color:var(--gold2);border-color:var(--gold);font-size:11px;" onclick="openAddAct()">+ যোগ করুন</button>
        </div>
      ${acts.length ? acts.map(a => {
        const tp = typeMap[a.type_id];
        const imgs = a.images || [];
        const openCls = openActItemId === a.id ? ' open' : '';
        return `<div class="act-item${openCls}" data-act-id="${a.id}" onclick="toggleActItem('${a.id}', event)">
          <div class="act-inner">
            <div class="act-head"><span class="act-emoji">${tp?.emoji||'🤝'}</span><span class="act-title">${KhAPI.esc(a.title)}</span>${a.amount?`<span class="act-amt">${fmtAmt(a.amount)}</span>`:''}</div>
            <div class="act-desc">${KhAPI.esc(a.description)}</div>
            <div class="act-date">${fmtDate(a.date)}${tp?.name ? ' · ' + KhAPI.esc(tp.name) : ''}</div>
            <div class="act-images" onclick="event.stopPropagation()">
              ${imgs.map((img,i) => `<img class="act-img-thumb" src="${img}" alt="" onclick="openLightbox('${a.id}',${i})" loading="lazy">`).join('')}
              <div class="act-img-add" onclick="triggerImgUpload('${a.id}')" title="ছবি যোগ করুন">+</div>
            </div>
            <div class="item-actions" onclick="event.stopPropagation()">
              <button class="mini-action" onclick="openEditAct('${a.id}')">সম্পাদনা</button>
              <button class="mini-action danger" onclick="deleteAct('${a.id}')">ডিলিট</button>
            </div>
          </div>
        </div>`;
      }).join('') : '<div class="kh-empty">এখনো কোনো কার্যক্রম নেই</div>'}
      </div>`;
  }

  function toggleActItem(id, e) {
    if (e && e.target.closest('.act-images, .item-actions, .mini-action')) return;
    openActItemId = openActItemId === id ? null : id;
    const ben = KhAPI.Beneficiaries.getById(activeBenId);
    if (ben) renderBenDetail(ben);
  }

  function closeBenDetail() { document.getElementById('ben-detail').classList.remove('open'); }
  function openEditBen() {
    const ben = KhAPI.Beneficiaries.getById(activeBenId);
    if (!ben) return;
    document.getElementById('eb-name').value = ben.name || '';
    document.getElementById('eb-addr').value = ben.address || '';
    document.getElementById('eb-phone').value = ben.phone || '';
    document.getElementById('eb-family').value = ben.family_info || '';
    document.getElementById('eb-date').value = ben.first_contact || KhAPI.today();
    document.getElementById('eb-notes').value = ben.notes || '';
    openModal('modal-edit-ben');
  }

  async function saveEditBen() {
    if (mmMutationBlocked(showToast)) return;
    const name = document.getElementById('eb-name').value.trim();
    if (!name) { showToast('নাম দিন'); return; }
    try {
      await KhAPI.Beneficiaries.update(activeBenId, { name, address:document.getElementById('eb-addr').value.trim(), phone:document.getElementById('eb-phone').value.trim(), family_info:document.getElementById('eb-family').value.trim(), first_contact:document.getElementById('eb-date').value || KhAPI.today(), notes:document.getElementById('eb-notes').value.trim() }, khActorId, khPin);
    } catch (err) { showDbError(err); return; }
    afterSave('modal-edit-ben', () => {
      const ben = KhAPI.Beneficiaries.getById(activeBenId);
      if (ben) {
        document.getElementById('bd-title').textContent = ben.name;
        renderBenDetail(ben);
      }
      renderBen();
    }, 'তথ্য আপডেট হয়েছে');
  }

  async function deleteBen() {
    if (mmMutationBlocked(showToast)) return;
    const ben = KhAPI.Beneficiaries.getById(activeBenId);
    if (!ben || !confirm('এই মাখদুম ও তার সব কার্যক্রম ডিলিট হবে। নিশ্চিত?')) return;
    try {
      await KhAPI.Beneficiaries.delete(activeBenId, khActorId, khPin);
      closeBenDetail();
      renderBen();
      showToast('মাখদুম ডিলিট হয়েছে');
    } catch (err) { showDbError(err); }
  }

  function openAddAct() {
    editingActId = null;
    document.getElementById('modal-act-title').textContent = 'কার্যক্রম যোগ করুন';
    const types = KhAPI.ActivityTypes.getAll();
    document.getElementById('act-type').innerHTML = types.map(t => `<option value="${t.id}">${t.emoji} ${KhAPI.esc(t.name)}</option>`).join('');
    ['act-title-inp','act-desc-inp','act-amount'].forEach(id => document.getElementById(id).value='');
    document.getElementById('act-date').value = KhAPI.today();
    document.getElementById('act-images-inp').value = '';
    document.getElementById('act-images-inp').closest('.form-group').style.display = '';
    openModal('modal-act');
  }

  function openEditAct(id) {
    const act = KhAPI.Activities.getAll().find(a => a.id === id);
    if (!act) return;
    editingActId = id;
    document.getElementById('modal-act-title').textContent = 'কার্যক্রম সম্পাদনা';
    const types = KhAPI.ActivityTypes.getAll();
    document.getElementById('act-type').innerHTML = types.map(t => `<option value="${t.id}" ${t.id===act.type_id?'selected':''}>${t.emoji} ${KhAPI.esc(t.name)}</option>`).join('');
    document.getElementById('act-title-inp').value = act.title || '';
    document.getElementById('act-date').value = act.date || KhAPI.today();
    document.getElementById('act-desc-inp').value = act.description || '';
    document.getElementById('act-amount').value = act.amount || '';
    document.getElementById('act-images-inp').value = '';
    document.getElementById('act-images-inp').closest('.form-group').style.display = 'none';
    openModal('modal-act');
  }

  async function saveAct() {
    if (mmMutationBlocked(showToast)) return;
    const type_id = document.getElementById('act-type').value;
    const title = document.getElementById('act-title-inp').value.trim();
    const desc = document.getElementById('act-desc-inp').value.trim();
    const amount = parseFloat(document.getElementById('act-amount').value)||0;
    const date = document.getElementById('act-date').value || KhAPI.today();
    if (!title) { showToast('শিরোনাম দিন'); return; }
    if (!desc) { showToast('বিবরণ দিন'); return; }
    const wasEdit = editingActId;
    try {
      const files = document.getElementById('act-images-inp').files;
      const images = files && files.length ? await readFilesAsBase64Async(files) : [];
      if (editingActId) await KhAPI.Activities.update(editingActId, { beneficiary_id:activeBenId, type_id, title, description:desc, amount, date }, khActorId, khPin);
      else await KhAPI.Activities.add({ beneficiary_id:activeBenId, type_id, title, description:desc, amount, date, images }, khActorId, khPin);
    } catch (err) { showDbError(err); return; }
    editingActId = null;
    afterSave('modal-act', () => { refreshDetail(); renderBen(); }, wasEdit ? 'কার্যক্রম আপডেট হয়েছে' : 'কার্যক্রম যোগ হয়েছে');
  }

  async function deleteAct(id) {
    if (mmMutationBlocked(showToast)) return;
    if (!confirm('এই কার্যক্রম ডিলিট হবে। নিশ্চিত?')) return;
    try {
      await KhAPI.Activities.delete(id, khActorId, khPin);
      refreshDetail();
      renderBen();
      showToast('কার্যক্রম ডিলিট হয়েছে');
    } catch (err) { showDbError(err); }
  }

  function triggerImgUpload(actId) {
    pendingImgActId = actId;
    document.getElementById('act-img-adder').click();
  }

  async function onExtraImagesSelected(e) {
    const files = e.target.files;
    if (!files || !files.length || !pendingImgActId) return;
    const activityId = pendingImgActId;
    e.target.value = '';
    pendingImgActId = null;
    try {
      const images = await readFilesAsBase64Async(files);
      if (images.length) await KhAPI.Activities.addImages(activityId, images, khActorId, khPin);
      refreshDetail();
      showToast(toBn(images.length)+' টি ছবি যোগ হয়েছে');
    } catch (err) { showDbError(err); }
  }

  function refreshDetail() {
    const ben = KhAPI.Beneficiaries.getById(activeBenId);
    if (ben) renderBenDetail(ben);
  }

  function readFilesAsBase64(files, cb) { readFilesAsBase64Async(files).then(cb); }
  function readFilesAsBase64Async(files) {
    return Promise.all(Array.from(files).map(file => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    })));
  }
  function openLightbox(actId, index) {
    const acts = KhAPI.Activities.getByBeneficiary(activeBenId);
    const act = acts.find(a => a.id === actId);
    if (!act || !act.images || !act.images.length) return;
    lightboxImages = act.images;
    lightboxIndex = index;
    showLightboxImage();
    document.getElementById('lightbox').classList.add('open');
  }

  function showLightboxImage() {
    document.getElementById('lb-img').src = lightboxImages[lightboxIndex];
    document.getElementById('lb-counter').textContent = toBn(lightboxIndex+1)+'/'+toBn(lightboxImages.length);
    document.getElementById('lb-prev').style.display = lightboxIndex>0 ? '' : 'none';
    document.getElementById('lb-next').style.display = lightboxIndex<lightboxImages.length-1 ? '' : 'none';
  }

  function lbPrev() { if (lightboxIndex>0) { lightboxIndex--; showLightboxImage(); } }
  function lbNext() { if (lightboxIndex<lightboxImages.length-1) { lightboxIndex++; showLightboxImage(); } }
  function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

  function finLedgerStats() {
    let openingBalance = 0, periodIncome = 0, periodExpense = 0, closingBalance = 0;
    if (activeAcctTab === 'all') {
      const txns = KhAPI.Finance.getAll();
      periodIncome = txns.filter(f => f.type === 'income').reduce((s, f) => s + f.amount, 0);
      periodExpense = txns.filter(f => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
      closingBalance = periodIncome - periodExpense;
    } else if (activeAcctTab === 'daily') {
      openingBalance = KhAPI.Finance.getBalanceBefore(activeAcctPeriod);
      const txns = KhAPI.Finance.getForDay(activeAcctPeriod);
      periodIncome = txns.filter(f => f.type === 'income').reduce((s, f) => s + f.amount, 0);
      periodExpense = txns.filter(f => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
      closingBalance = openingBalance + periodIncome - periodExpense;
    } else if (activeAcctTab === 'monthly') {
      openingBalance = KhAPI.Finance.getBalanceBefore(activeAcctPeriod + '-01');
      const daily = KhAPI.Finance.getDailySummary(activeAcctPeriod);
      periodIncome = daily.reduce((s, d) => s + d.income, 0);
      periodExpense = daily.reduce((s, d) => s + d.expense, 0);
      closingBalance = openingBalance + periodIncome - periodExpense;
    } else {
      openingBalance = KhAPI.Finance.getBalanceBefore(activeAcctPeriod + '-01-01');
      const monthly = KhAPI.Finance.getMonthlySummary(activeAcctPeriod);
      periodIncome = monthly.reduce((s, m) => s + m.income, 0);
      periodExpense = monthly.reduce((s, m) => s + m.expense, 0);
      closingBalance = openingBalance + periodIncome - periodExpense;
    }
    return { openingBalance, periodIncome, periodExpense, closingBalance };
  }

  function renderFinCards() {
    const st = finLedgerStats();
    const netSign = (st.periodIncome - st.periodExpense) >= 0 ? '+' : '';
    document.getElementById('fin-cards').innerHTML = `<div class="fin-cards">
      <div class="fin-card fin-card--balance"><span class="fin-card-val">${fmtAmt(st.closingBalance)}</span><span class="fin-card-lbl">অবশিষ্ট জমা</span></div>
      <div class="fin-card"><span class="fin-card-val green">+${fmtAmt(st.periodIncome)}</span><span class="fin-card-lbl">মোট আয়</span></div>
      <div class="fin-card"><span class="fin-card-val red">−${fmtAmt(st.periodExpense)}</span><span class="fin-card-lbl">মোট ব্যয়</span></div>
      <div class="fin-card"><span class="fin-card-val ${(st.periodIncome - st.periodExpense) >= 0 ? 'green' : 'red'}">${netSign}${fmtAmt(st.periodIncome - st.periodExpense)}</span><span class="fin-card-lbl">নীট পরিবর্তন</span></div>
    </div>`;
  }

  function renderFin() {
    renderFinCards();
    updateFinFilter();
    renderAcct();
  }

  function switchAcctTab(tab) {
    activeAcctTab = tab;
    openFinEntryId = null;
    if (tab === 'all') activeAcctPeriod = '';
    else if (tab === 'daily') activeAcctPeriod = KhAPI.today();
    else if (tab === 'monthly') activeAcctPeriod = new Date().toISOString().slice(0, 7);
    else activeAcctPeriod = String(new Date().getFullYear());
    renderFin();
  }

  function shiftAcctPeriod(delta) {
    if (activeAcctTab === 'daily') {
      const d = new Date(activeAcctPeriod || KhAPI.today());
      d.setDate(d.getDate() + delta);
      activeAcctPeriod = d.toISOString().slice(0, 10);
    } else if (activeAcctTab === 'monthly') {
      const p = (activeAcctPeriod || new Date().toISOString().slice(0, 7)).split('-');
      const d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
      activeAcctPeriod = d.toISOString().slice(0, 7);
    } else if (activeAcctTab === 'yearly') {
      activeAcctPeriod = String(Number(activeAcctPeriod || new Date().getFullYear()) + delta);
    } else return;
    renderFin();
  }

  function acctPeriodLabel() {
    if (activeAcctTab === 'daily') return fmtDate(activeAcctPeriod);
    if (activeAcctTab === 'monthly') return fmtMonth(activeAcctPeriod);
    if (activeAcctTab === 'yearly') return fmtYear(activeAcctPeriod);
    return '';
  }

  function updateFinFilter() {
    let periodHtml = '';
    if (activeAcctTab === 'daily' || activeAcctTab === 'monthly') {
      periodHtml = `<div class="fin-period-nav">
        <button type="button" class="fin-period-btn" onclick="shiftAcctPeriod(-1)" aria-label="আগের">‹</button>
        <span class="fin-period-label">${acctPeriodLabel()}</span>
        <button type="button" class="fin-period-btn" onclick="shiftAcctPeriod(1)" aria-label="পরের">›</button>
      </div>`;
    } else if (activeAcctTab === 'yearly') {
      const years = KhAPI.Finance.getYearlySummary();
      const opts = years.length ? years.map(y => `<option value="${y.year}" ${String(y.year)===String(activeAcctPeriod)?'selected':''}>${fmtYear(y.year)}</option>`).join('')
        : `<option value="${new Date().getFullYear()}">${fmtYear(String(new Date().getFullYear()))}</option>`;
      periodHtml = `<div class="fin-period-nav"><select class="form-input form-select" id="acct-year" onchange="onAcctPeriodChange()">${opts}</select></div>`;
    }
    document.getElementById('fin-filter').innerHTML = `<div class="fin-filter-row">
      <select class="form-input form-select" id="acct-view" onchange="switchAcctTab(this.value)">
        <option value="all" ${activeAcctTab==='all'?'selected':''}>সব লেনদেন</option>
        <option value="daily" ${activeAcctTab==='daily'?'selected':''}>দৈনিক</option>
        <option value="monthly" ${activeAcctTab==='monthly'?'selected':''}>মাসিক</option>
        <option value="yearly" ${activeAcctTab==='yearly'?'selected':''}>বার্ষিক</option>
      </select>
      ${periodHtml}
    </div>`;
  }

  function onAcctPeriodChange() {
    if (activeAcctTab === 'yearly') activeAcctPeriod = document.getElementById('acct-year').value;
    renderFin();
  }

  function toggleFinEntry(id, e) {
    if (e) e.stopPropagation();
    openFinEntryId = openFinEntryId === id ? null : id;
    renderAcct();
  }

  function renderTxnRow(f) {
    const isIncome = f.type === 'income';
    const cls = isIncome ? 'income' : 'expense';
    const sign = isIncome ? '+' : '−';
    const dir = isIncome ? '↑' : '↓';
    const openCls = openFinEntryId === f.id ? ' open' : '';
    return `<div class="fin-entry${openCls}" onclick="toggleFinEntry('${f.id}', event)">
      <div class="fin-entry-icon ${cls}">${dir}</div>
      <div class="fin-entry-body">
        <div class="fin-entry-title">${KhAPI.esc(f.description)}</div>
        <div class="fin-entry-sub">${fmtDate(f.date)}${f.source ? ' · ' + KhAPI.esc(f.source) : ''}</div>
      </div>
      <div class="fin-amt ${cls}">${sign}${fmtAmt(f.amount)}</div>
    </div>
    <div class="fin-entry-actions">
      <button class="mini-action" onclick="event.stopPropagation();openEditFin('${f.id}')">সম্পাদনা</button>
      <button class="mini-action danger" onclick="event.stopPropagation();deleteFin('${f.id}')">ডিলিট</button>
    </div>`;
  }

  function renderSummaryRow(label, income, expense, net) {
    const netCls = net >= 0 ? 'pos' : 'neg';
    const netSign = net >= 0 ? '+' : '';
    return `<div class="ledger-sum-row">
      <span>${label}</span>
      <span class="acct-in">${income ? fmtAmt(income) : '—'}</span>
      <span class="acct-out">${expense ? fmtAmt(expense) : '—'}</span>
      <span class="acct-net ${netCls}">${netSign}${fmtAmt(net)}</span>
    </div>`;
  }

  function renderAcct() {
    let rowsHtml, headTitle = '', headSub = '', showOpening = false, showTableHead = false, tableFirstCol = 'তারিখ';
    const st = finLedgerStats();

    if (activeAcctTab === 'all') {
      const txns = KhAPI.Finance.getAll();
      rowsHtml = txns.length ? txns.map(renderTxnRow).join('') : '<div class="kh-empty">কোনো লেনদেন নেই</div>';
      document.getElementById('acct-ledger').innerHTML = `<div class="ledger-panel ledger-panel--flat">
        <div class="ledger-list-meta">${toBn(txns.length)}টি লেনদেন · ট্যাপ করে সম্পাদনা</div>
        <div class="ledger-body">${rowsHtml}</div>
      </div>`;
      return;
    }

    if (activeAcctTab === 'daily') {
      const txns = KhAPI.Finance.getForDay(activeAcctPeriod);
      headTitle = fmtDate(activeAcctPeriod);
      headSub = 'দৈনিক হিসাব';
      showOpening = true;
      rowsHtml = txns.length ? txns.map(renderTxnRow).join('') : '<div class="kh-empty">এই দিনে কোনো লেনদেন নেই</div>';
    } else if (activeAcctTab === 'monthly') {
      const daily = KhAPI.Finance.getDailySummary(activeAcctPeriod);
      headTitle = fmtMonth(activeAcctPeriod);
      headSub = 'দৈনিক সারাংশ';
      showOpening = true;
      showTableHead = true;
      tableFirstCol = 'তারিখ';
      rowsHtml = daily.length ? daily.map(d => renderSummaryRow(fmtDate(d.date), d.income, d.expense, d.net)).join('')
        : '<div class="kh-empty">এই মাসে কোনো লেনদেন নেই</div>';
    } else {
      const monthly = KhAPI.Finance.getMonthlySummary(activeAcctPeriod);
      headTitle = fmtYear(activeAcctPeriod);
      headSub = 'মাসভিত্তিক সারাংশ';
      showOpening = true;
      showTableHead = true;
      tableFirstCol = 'মাস';
      rowsHtml = monthly.length ? monthly.map(m => renderSummaryRow(fmtMonth(m.month), m.income, m.expense, m.net)).join('')
        : '<div class="kh-empty">এই বছরে কোনো লেনদেন নেই</div>';
    }

    const openingHtml = showOpening
      ? `<div class="ledger-opening"><span>উদ্বৃত্ত (পূর্ববর্তী)</span><strong class="${st.openingBalance >= 0 ? 'pos' : 'neg'}">${fmtAmt(st.openingBalance)}</strong></div>`
      : '';
    const tableHeadHtml = showTableHead
      ? `<div class="ledger-table-head"><span>${tableFirstCol}</span><span>আয়</span><span>ব্যয়</span><span>নিট</span></div>`
      : '';

    document.getElementById('acct-ledger').innerHTML = `<div class="ledger-panel">
      <div class="ledger-head"><div><div class="ledger-title">${headTitle}</div><div class="ledger-sub">${headSub}</div></div></div>
      ${openingHtml}${tableHeadHtml}
      <div class="ledger-body">${rowsHtml}</div>
    </div>`;
  }

  function openAddFin() {
    editingFinId = null;
    document.getElementById('modal-fin-title').textContent = 'লেনদেন যোগ করুন';
    document.getElementById('fn-type').value = 'income';
    ['fn-amount','fn-desc','fn-source'].forEach(id => document.getElementById(id).value='');
    document.getElementById('fn-date').value = activeAcctTab === 'daily' ? activeAcctPeriod : KhAPI.today();
    openModal('modal-fin');
  }

  function openEditFin(id) {
    const txn = KhAPI.Finance.getAll().find(f => f.id === id);
    if (!txn) return;
    editingFinId = id;
    document.getElementById('modal-fin-title').textContent = 'লেনদেন সম্পাদনা';
    document.getElementById('fn-type').value = txn.type;
    document.getElementById('fn-amount').value = txn.amount || '';
    document.getElementById('fn-date').value = txn.date || KhAPI.today();
    document.getElementById('fn-desc').value = txn.description || '';
    document.getElementById('fn-source').value = txn.source || '';
    openModal('modal-fin');
  }

  async function saveFin() {
    if (mmMutationBlocked(showToast)) return;
    const type = document.getElementById('fn-type').value;
    const amount = parseFloat(document.getElementById('fn-amount').value);
    const desc = document.getElementById('fn-desc').value.trim();
    const source = document.getElementById('fn-source').value.trim();
    const date = document.getElementById('fn-date').value || KhAPI.today();
    if (!amount || amount <= 0) { showToast('সঠিক পরিমাণ দিন'); return; }
    if (!desc) { showToast('বিবরণ দিন'); return; }
    const wasEdit = editingFinId;
    try {
      if (editingFinId) await KhAPI.Finance.update(editingFinId, { type, amount, date, description:desc, source:source||null }, khActorId, khPin);
      else await KhAPI.Finance.add({ type, amount, date, description:desc, source:source||null }, khActorId, khPin);
    } catch (err) { showDbError(err); return; }
    editingFinId = null;
    afterSave('modal-fin', renderFin, wasEdit ? 'লেনদেন আপডেট হয়েছে' : 'লেনদেন সংরক্ষিত হয়েছে');
  }

  async function deleteFin(id) {
    if (mmMutationBlocked(showToast)) return;
    if (!confirm('এই লেনদেন ডিলিট হবে। নিশ্চিত?')) return;
    try {
      await KhAPI.Finance.delete(id, khActorId, khPin);
      renderFin();
      showToast('লেনদেন ডিলিট হয়েছে');
    } catch (err) { showDbError(err); }
  }

  function renderLog() {
    if (!document.getElementById('log-date').value) document.getElementById('log-date').value = KhAPI.today();
    document.getElementById('log-date-label').textContent = 'দৈনিক লগ লিখুন';
    const logs = KhAPI.DailyLogs.getAll();
    document.getElementById('log-list').innerHTML = logs.length
      ? logs.map(l => `<div class="log-item"><div class="log-meta"><span>${KhAPI.esc(l.by||'—')}</span><span>${fmtDate(l.date)}</span></div><div class="log-text">${KhAPI.esc(l.content)}</div><div class="item-actions"><button class="mini-action" onclick="openEditLog('${l.id}')">এডিট</button><button class="mini-action danger" onclick="deleteLog('${l.id}')">ডিলিট</button></div></div>`).join('')
      : '<div style="text-align:center;color:var(--ink3);padding:30px 0;font-size:13px;">কোনো লগ নেই</div>';
  }

  async function saveLog() {
    if (mmMutationBlocked(showToast)) return;
    const txt = document.getElementById('log-input').value.trim();
    const date = document.getElementById('log-date').value || KhAPI.today();
    if (!txt) { showToast('লগ লিখুন'); return; }
    try {
      await KhAPI.DailyLogs.add(txt, myName, khActorId, khPin, date);
      document.getElementById('log-input').value = '';
      renderLog(); showToast('লগ সংরক্ষিত হয়েছে');
    } catch (err) { showDbError(err); }
  }

  function openEditLog(id) {
    const log = KhAPI.DailyLogs.getAll().find(l => l.id === id);
    if (!log) return;
    editingLogId = id;
    document.getElementById('el-date').value = log.date || KhAPI.today();
    document.getElementById('el-content').value = log.content || '';
    openModal('modal-log-edit');
  }

  async function saveEditLog() {
    if (mmMutationBlocked(showToast)) return;
    const content = document.getElementById('el-content').value.trim();
    if (!content) { showToast('লগ লিখুন'); return; }
    try {
      await KhAPI.DailyLogs.update(editingLogId, { content, by:myName, date:document.getElementById('el-date').value || KhAPI.today() }, khActorId, khPin);
    } catch (err) { showDbError(err); return; }
    editingLogId = null;
    afterSave('modal-log-edit', renderLog, 'লগ আপডেট হয়েছে');
  }

  async function deleteLog(id) {
    if (mmMutationBlocked(showToast)) return;
    if (!confirm('এই লগ ডিলিট হবে। নিশ্চিত?')) return;
    try {
      await KhAPI.DailyLogs.delete(id, khActorId, khPin);
      renderLog();
      showToast('লগ ডিলিট হয়েছে');
    } catch (err) { showDbError(err); }
  }

  /* ═══ PIN ─── */
  function openPinChangeModal(){document.getElementById('pc-cur').value='';document.getElementById('pc-new').value='';document.getElementById('pc-conf').value='';document.getElementById('pc-err').textContent='';document.getElementById('modal-pin-change').classList.add('open');}
  function closePinChangeModal(){document.getElementById('modal-pin-change').classList.remove('open');}
  function saveOwnPin(){
    var c=document.getElementById('pc-cur').value,n=document.getElementById('pc-new').value,f=document.getElementById('pc-conf').value,e=document.getElementById('pc-err');
    if(!c||!n||!f){e.textContent='সব ঘর পূরণ করুন';return;} if(n!==f){e.textContent='PIN মিলছে না';return;}
    if(n.length!==4||!/^\d+$/.test(n)){e.textContent='PIN ৪ সংখ্যার হতে হবে';return;}
    var uid=MMSession.getStaffUserId(); if(!uid||!API.Teachers.changeOwnPin(uid,c,n)){e.textContent='বর্তমান PIN ভুল';return;}
    MMSession.setStaffSession(MMSession.getRole(),MMSession.getName(),uid,n);
    if(typeof MMSharedAPI!=='undefined'&&MMSharedAPI.staffChangeOwnPin){try{MMSharedAPI.staffChangeOwnPin(uid,c,n);}catch(ex){console.warn('Supabase PIN sync skipped',ex);}}
    closePinChangeModal(); if(typeof showToast==='function')showToast('PIN সফলভাবে পরিবর্তন হয়েছে');
  }

  async function initKhedmatPage() {
    try {
      await refreshKhedmatData();
    } catch (err) {
      console.error('[Khedmat] bootstrap failed:', err);
      showToast('ডাটাবেজ থেকে খেদমত ডেটা লোড হয়নি');
    }
    renderBen();
    var h = (location.hash || '').replace(/^#/, '');
    if (['ben', 'fin', 'log'].indexOf(h) >= 0) switchPanel(h);
  }
  MMLoading.run(initKhedmatPage);
