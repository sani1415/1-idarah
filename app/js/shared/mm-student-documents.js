/**
 * Student detail modal — documents tab (view: all modal users; manage: daftar only).
 */
(function (global) {
  'use strict';

  var BUCKET = 'mdr-student-documents';
  var MAX_BYTES = 512000;
  var STYLE_ID = 'mm-student-documents-style';

  var DOC_TYPES = {
    student_application: 'ছাত্রের আবেদন',
    guardian_application: 'অভিভাবকের আবেদন',
    other: 'অন্যান্য',
  };

  function getApi() {
    if (global.API && global.API.esc) return global.API;
    if (typeof API !== 'undefined' && API && API.esc) return API;
    return null;
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function toBn(n) {
    if (typeof global.toBn === 'function') return global.toBn(n);
    return String(n).replace(/[0-9]/g, function (d) {
      return '০১২৩৪৫৬৭৮৯'[d];
    });
  }

  function actor() {
    if (!global.MMSession) return null;
    var id = global.MMSession.getId && global.MMSession.getId();
    var pin = global.MMSession.getPin && global.MMSession.getPin();
    if (!id || !pin) return null;
    return { id: id, pin: pin };
  }

  function canManageRole() {
    return !!(global.MMSession && global.MMSession.getRole && global.MMSession.getRole() === 'daftar');
  }

  function uuidLike() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'doc-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function safeFileName(name) {
    return String(name || 'document')
      .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '-')
      .replace(/\s+/g, '-')
      .slice(-80) || 'document';
  }

  function storagePath(studentId, file) {
    return String(studentId) + '/' + Date.now() + '-' + uuidLike() + '-' + safeFileName(file.name);
  }

  function renameToJpg(name) {
    var base = String(name || 'document').replace(/\.[^.]+$/, '');
    return base + '.jpg';
  }

  function canvasToJpegBlob(bitmap, width, height, quality) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas_unavailable'));
        return;
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('blob_failed'));
        else resolve(blob);
      }, 'image/jpeg', quality);
    });
  }

  async function compressImageFile(file, maxBytes) {
    if (!global.createImageBitmap) throw new Error('compress_unsupported');
    var bitmap = await createImageBitmap(file);
    var w = bitmap.width;
    var h = bitmap.height;
    var scale = 1;
    try {
      while (scale >= 0.25) {
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        for (var q = 0.88; q >= 0.35; q -= 0.08) {
          var blob = await canvasToJpegBlob(bitmap, cw, ch, q);
          if (blob.size <= maxBytes) {
            return new File([blob], renameToJpg(file.name), { type: 'image/jpeg' });
          }
        }
        scale -= 0.15;
      }
      throw new Error('too_large_after_compress');
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }

  async function prepareUploadFile(file) {
    if (!file) throw new Error('no_file');
    var mime = String(file.type || '').toLowerCase();
    var isPdf = mime === 'application/pdf';
    var isImage = /^image\/(jpeg|png|webp)$/.test(mime);
    if (!isPdf && !isImage) throw new Error('bad_type');
    if (isPdf) {
      if (file.size > MAX_BYTES) throw new Error('pdf_too_large');
      return file;
    }
    if (file.size <= MAX_BYTES && mime === 'image/jpeg') return file;
    return compressImageFile(file, MAX_BYTES);
  }

  function formatSize(bytes) {
    var kb = Math.max(1, Math.round(Number(bytes || 0) / 1024));
    return toBn(kb) + ' KB';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return String(iso).slice(0, 10);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.st-doc-list{display:flex;flex-direction:column;gap:8px;}' +
      '.st-doc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--cream2);font-size:13px;}' +
      '.st-doc-row:last-child{border-bottom:none;}' +
      '.st-doc-main{min-width:0;flex:1;}' +
      '.st-doc-title{font-weight:600;margin-bottom:2px;}' +
      '.st-doc-meta{font-size:11px;color:var(--ink3);line-height:1.45;}' +
      '.st-doc-actions{display:flex;gap:6px;flex-shrink:0;}' +
      '.st-doc-btn{background:#fff;border:1px solid var(--cream3);border-radius:8px;padding:5px 9px;font-family:"Tiro Bangla",serif;font-size:11px;color:var(--ink2);cursor:pointer;}' +
      '.st-doc-btn--danger{color:var(--red,#c1440e);}' +
      '.st-doc-form{margin-top:12px;padding-top:12px;border-top:1px solid var(--cream2);}' +
      '.st-doc-form .form-group{margin-bottom:10px;}' +
      '.st-doc-hint{font-size:11px;color:var(--ink3);margin:6px 0 0;line-height:1.45;}';
    document.head.appendChild(style);
  }

  function buildManageForm(API) {
    if (!canManageRole()) return '';
    var opts = Object.keys(DOC_TYPES).map(function (k) {
      return '<option value="' + API.esc(k) + '">' + API.esc(DOC_TYPES[k]) + '</option>';
    }).join('');
    return (
      '<div class="st-doc-form">' +
      '<h4 style="margin:0 0 10px;font-size:14px;">নতুন ডকুমেন্ট</h4>' +
      '<div class="form-group"><label class="form-label">শিরোনাম</label>' +
      '<input class="form-input" id="st-doc-title" placeholder="যেমন: ভর্তি আবেদন ২০২৬"></div>' +
      '<div class="form-group"><label class="form-label">ধরন</label>' +
      '<select class="form-input form-select" id="st-doc-type">' + opts + '</select></div>' +
      '<div class="form-group"><label class="form-label">নোট (ঐচ্ছিক)</label>' +
      '<input class="form-input" id="st-doc-note" placeholder="সংক্ষিপ্ত মন্তব্য"></div>' +
      '<div class="form-group"><label class="form-label">ফাইল (PDF বা ছবি)</label>' +
      '<input class="form-input" type="file" id="st-doc-file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>' +
      '<p class="st-doc-hint">সর্বোচ্চ ৫০০ KB। ছবি বড় হলে অ্যাপ নিজে ছোট করে নেবে; PDF বড় হলে আগে ছোট করে দিন।</p>' +
      '<button type="button" class="submit-btn" id="st-doc-save-btn" style="margin-top:8px;padding:11px 16px;font-size:13px;width:100%">সংরক্ষণ করুন</button>' +
      '</div>'
    );
  }

  function renderList(API, docs, canManage) {
    if (!docs.length) {
      return '<div class="st-empty">এখনো কোনো ডকুমেন্ট নেই।</div>';
    }
    return (
      '<div class="st-doc-list">' +
      docs.map(function (d) {
        var typeLbl = DOC_TYPES[d.doc_type] || DOC_TYPES.other;
        var delBtn = canManage
          ? '<button type="button" class="st-doc-btn st-doc-btn--danger" data-doc-delete="' + API.esc(String(d.id)) + '">মুছুন</button>'
          : '';
        return (
          '<div class="st-doc-row">' +
          '<div class="st-doc-main">' +
          '<div class="st-doc-title">' + API.esc(d.title || d.file_name || 'ডকুমেন্ট') + '</div>' +
          '<div class="st-doc-meta">' + API.esc(typeLbl) +
          ' · ' + formatSize(d.file_size) +
          ' · ' + API.esc(formatDate(d.created_at)) +
          (d.created_by ? ' · ' + API.esc(d.created_by) : '') +
          (d.note ? '<br>' + API.esc(d.note) : '') +
          '</div></div>' +
          '<div class="st-doc-actions">' +
          '<button type="button" class="st-doc-btn" data-doc-open="' + API.esc(String(d.id)) + '">দেখুন</button>' +
          delBtn +
          '</div></div>'
        );
      }).join('') +
      '</div>'
    );
  }

  var _cache = {};
  var _currentSid = null;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function panelEl() {
    return document.getElementById('st-panel-docs');
  }

  async function loadDocuments(studentId) {
    var a = actor();
    if (!a || !global.MMSharedAPI || !MMSharedAPI.studentDocumentsList) {
      return { ok: false, error: 'no_api', documents: [], can_manage: false };
    }
    var res = await MMSharedAPI.studentDocumentsList(a.id, a.pin, studentId);
    if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'load_failed', documents: [], can_manage: false };
    _cache[studentId] = res.documents || [];
    return res;
  }

  function bindPanelEvents(studentId, docs, canManage) {
    var panel = panelEl();
    if (!panel) return;
    panel.querySelectorAll('[data-doc-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-doc-open');
        var doc = (docs || []).find(function (d) { return String(d.id) === String(id); });
        if (doc) openDocument(doc);
      });
    });
    panel.querySelectorAll('[data-doc-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-doc-delete');
        var doc = (docs || []).find(function (d) { return String(d.id) === String(id); });
        if (doc) deleteDocument(studentId, doc);
      });
    });
    var saveBtn = panel.querySelector('#st-doc-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', function () { uploadDocument(studentId); });
  }

  async function renderPanel(studentId, force) {
    ensureStyles();
    var API = getApi();
    var panel = panelEl();
    if (!API || !panel) return;

    _currentSid = studentId;
    if (!force && panel.dataset.loadedFor === String(studentId)) return;

    if (!UUID_RE.test(String(studentId || ''))) {
      panel.innerHTML = '<div class="st-empty">ডকুমেন্ট সংরক্ষণের জন্য ডাটাবেজ-সংযুক্ত ছাত্র প্রোফাইল লাগবে।</div>';
      panel.dataset.loadedFor = String(studentId);
      return;
    }

    panel.innerHTML = '<div class="st-note" style="padding:8px 0;">ডকুমেন্ট লোড হচ্ছে…</div>';

    var res;
    try {
      res = await loadDocuments(studentId);
    } catch (e) {
      console.warn('student documents load failed', e);
      panel.innerHTML = '<div class="st-empty">ডকুমেন্ট লোড হয়নি।</div>';
      return;
    }

    if (!res.ok) {
      panel.innerHTML = '<div class="st-empty">ডকুমেন্ট দেখার অনুমতি নেই বা সংযোগ সমস্যা।</div>';
      return;
    }

    var docs = res.documents || [];
    var canManage = !!res.can_manage;
    panel.innerHTML =
      '<div class="st-block" style="margin-top:0;padding-top:0;border-top:none">' +
      '<h4 style="margin:0 0 8px">জমা দেওয়া ডকুমেন্ট</h4>' +
      renderList(API, docs, canManage) +
      buildManageForm(API) +
      '</div>';
    panel.dataset.loadedFor = String(studentId);
    bindPanelEvents(studentId, docs, canManage);
  }

  async function openDocument(doc) {
    if (!doc || !doc.storage_path || !global.MMSharedAPI || !MMSharedAPI.supabaseClient) {
      toast('ডকুমেন্ট খোলা যায়নি');
      return;
    }
    try {
      var bucket = doc.bucket_id || BUCKET;
      var out = await MMSharedAPI.supabaseClient.storage.from(bucket).createSignedUrl(doc.storage_path, 300);
      if (out.error) throw out.error;
      var url = out.data && (out.data.signedUrl || out.data.signedURL);
      if (!url) throw new Error('signed_url_missing');
      global.open(url, '_blank', 'noopener');
    } catch (e) {
      console.warn('open student document failed', e);
      toast('ডকুমেন্ট খোলা যায়নি');
    }
  }

  async function deleteDocument(studentId, doc) {
    if (!canManageRole()) {
      toast('শুধু দপ্তর দায়িত্বশীল মুছতে পারবেন');
      return;
    }
    if (!confirm('এই ডকুমেন্টটি মুছে ফেলবেন?')) return;
    var a = actor();
    if (!a || !global.MMSharedAPI) return;
    try {
      var res = await MMSharedAPI.deleteStudentDocument(a.id, a.pin, doc.id);
      if (!res || !res.ok) throw new Error((res && res.error) || 'delete_failed');
      var path = res.storagePath || doc.storage_path;
      var bucket = res.bucketId || doc.bucket_id || BUCKET;
      if (path && MMSharedAPI.supabaseClient) {
        await MMSharedAPI.supabaseClient.storage.from(bucket).remove([path]);
      }
      delete _cache[studentId];
      toast('ডকুমেন্ট মুছে ফেলা হয়েছে');
      await renderPanel(studentId, true);
    } catch (e) {
      console.warn('delete student document failed', e);
      toast('ডকুমেন্ট মুছা যায়নি');
    }
  }

  async function uploadDocument(studentId) {
    if (!canManageRole()) {
      toast('শুধু দপ্তর দায়িত্বশীল যুক্ত করতে পারবেন');
      return;
    }
    var API = getApi();
    var a = actor();
    if (!API || !a || !global.MMSharedAPI || !MMSharedAPI.addStudentDocument || !MMSharedAPI.supabaseClient) {
      toast('ডাটাবেজ সংযোগ নেই');
      return;
    }

    var titleEl = document.getElementById('st-doc-title');
    var typeEl = document.getElementById('st-doc-type');
    var noteEl = document.getElementById('st-doc-note');
    var fileEl = document.getElementById('st-doc-file');
    var title = titleEl ? String(titleEl.value || '').trim() : '';
    var docType = typeEl ? typeEl.value : 'other';
    var note = noteEl ? String(noteEl.value || '').trim() : '';
    var rawFile = fileEl && fileEl.files && fileEl.files[0];
    if (!title) { toast('শিরোনাম দিন'); return; }
    if (!rawFile) { toast('ফাইল বেছে নিন'); return; }

    var btn = document.getElementById('st-doc-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'আপলোড হচ্ছে…'; }

    try {
      var file = await prepareUploadFile(rawFile);
      var path = storagePath(studentId, file);
      var up = await MMSharedAPI.supabaseClient.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (up.error) throw up.error;

      var meta = await MMSharedAPI.addStudentDocument(a.id, a.pin, {
        studentId: studentId,
        title: title,
        docType: docType,
        storagePath: path,
        fileName: file.name || 'document',
        mimeType: file.type || '',
        fileSize: file.size || 0,
        note: note,
      });
      if (!meta || !meta.ok) {
        await MMSharedAPI.supabaseClient.storage.from(BUCKET).remove([path]);
        throw new Error((meta && meta.error) || 'metadata_failed');
      }

      if (titleEl) titleEl.value = '';
      if (noteEl) noteEl.value = '';
      if (fileEl) fileEl.value = '';
      toast('ডকুমেন্ট সংরক্ষিত ✓');
      delete _cache[studentId];
      await renderPanel(studentId, true);
    } catch (e) {
      console.warn('upload student document failed', e);
      if (e && e.message === 'pdf_too_large') toast('PDF সর্বোচ্চ ৫০০ KB হতে হবে');
      else if (e && e.message === 'too_large_after_compress') toast('ছবি ৫০০ KB-এর নিচে নামানো যায়নি');
      else if (e && e.message === 'bad_type') toast('শুধু PDF বা ছবি যুক্ত করা যাবে');
      else toast('ডকুমেন্ট সংরক্ষণ হয়নি');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'সংরক্ষণ করুন'; }
    }
  }

  function onTabOpen(studentId) {
    renderPanel(studentId, false);
  }

  function invalidate(studentId) {
    if (studentId) delete _cache[studentId];
    var panel = panelEl();
    if (panel && (!studentId || panel.dataset.loadedFor === String(studentId))) {
      delete panel.dataset.loadedFor;
    }
  }

  global.MMStudentDocuments = {
    onTabOpen: onTabOpen,
    invalidate: invalidate,
    MAX_BYTES: MAX_BYTES,
  };
})(typeof window !== 'undefined' ? window : this);
