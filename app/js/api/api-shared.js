/* মাদরাসাতুল মদীনা — Supabase shared client helpers */

const MMSharedAPI = (() => {
  const cfg = window.MM_SUPABASE_CONFIG || {};

  function getSupabaseKey() {
    return cfg.publishableKey || cfg.anonKey || '';
  }

  function createClientOrNull() {
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[MMSharedAPI] Supabase client script is not loaded.');
      return null;
    }
    const key = getSupabaseKey();
    if (!cfg.url || !key) {
      console.warn('[MMSharedAPI] supabase-config.js is missing SUPABASE_URL or publishable key.');
      return null;
    }
    return window.supabase.createClient(cfg.url, key);
  }

  const supabaseClient = createClientOrNull();

  async function rpc(name, params) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.rpc(name, params || {});
      if (error) throw error;
      return data;
    }
    const key = getSupabaseKey();
    if (!cfg.url || !key || typeof fetch !== 'function') {
      throw new Error('Supabase client is not configured');
    }
    const res = await fetch(String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + encodeURIComponent(name), {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params || {}),
    });
    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch (e) { payload = text; }
    }
    if (!res.ok) {
      const msg = payload && payload.message ? payload.message : (text || ('RPC failed: ' + name));
      throw new Error(msg);
    }
    return payload;
  }

  return {
    supabaseClient,
    rpc,
    loginAdmin(pin) {
      return rpc('mdr_rel_admin_login', { p_pin: pin });
    },
    adminChangePin(currentPin, newPin) {
      return rpc('mdr_rel_admin_change_pin', {
        p_current_pin: currentPin || '',
        p_new_pin: newPin || '',
      });
    },
    fullDatabaseBackup(actorId, pin) {
      return rpc('mdr_rel_full_database_backup', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    publicSettings() {
      return rpc('mdr_rel_public_settings', {});
    },
    loginUser(userId, pin) {
      return rpc('mdr_rel_user_login', { p_user_id: userId, p_pin: pin });
    },
    loginStaff(role, loginId, pin) {
      return rpc('mdr_rel_staff_login', {
        p_role: role,
        p_login_id: loginId || null,
        p_pin: pin,
      });
    },
    adminUsers(pin) {
      return rpc('mdr_rel_admin_users', { p_pin: pin });
    },
    saveMadrasaUser(pin, user) {
      return rpc('mdr_rel_save_user', {
        p_pin: pin,
        p_user_id: user.id || null,
        p_name: user.name,
        p_role: user.role,
        p_login_id: user.login_id || null,
        p_user_pin: user.pin,
        p_class_code: user.class_code || null,
        p_admin_perms: user.admin_perms || {},
        p_is_active: user.is_active !== false,
      });
    },
    saveScopedMadrasaUser(actorId, pin, user) {
      return rpc('mdr_rel_save_scoped_user', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_user_id: user.id || null,
        p_name: user.name,
        p_role: user.role,
        p_login_id: user.login_id || null,
        p_user_pin: user.pin,
        p_class_code: user.class_code || null,
        p_is_active: user.is_active !== false,
      });
    },
    settingsUsersBootstrap(actorId, pin) {
      return rpc('mdr_rel_settings_users_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    upsertBook(actorId, pin, book) {
      return rpc('mdr_rel_upsert_book', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_book_id: book.id || null,
        p_class_code: book.class_code,
        p_name: book.name,
        p_total_pages: Number(book.total_pages) || 0,
        p_sort_order: Number(book.sort_order) || 0,
      });
    },
    deleteBook(actorId, pin, bookId) {
      return rpc('mdr_rel_delete_book', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_book_id: bookId,
      });
    },
    studentDocumentsList(actorId, pin, studentId) {
      return rpc('mdr_rel_student_documents_list', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_student_id: studentId,
      });
    },
    addStudentDocument(actorId, pin, payload) {
      return rpc('mdr_rel_student_document_add', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    deleteStudentDocument(actorId, pin, documentId) {
      return rpc('mdr_rel_student_document_delete', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_document_id: documentId,
      });
    },
    settingsBooksBootstrap(actorId, pin) {
      return rpc('mdr_rel_settings_books_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    staffChangeOwnPin(userId, currentPin, newPin) {
      return rpc('mdr_rel_staff_change_own_pin', {
        p_user_id: userId,
        p_current_pin: currentPin,
        p_new_pin: newPin,
      });
    },
    daftarBootstrap(actorId, pin) {
      return rpc('mdr_rel_daftar_bootstrap', {
        p_actor_id: actorId,
        p_pin: pin,
      });
    },
    daftarAttendanceForDate(actorId, pin, date) {
      return rpc('mdr_rel_daftar_attendance_for_date', {
        p_actor_id: actorId,
        p_pin: pin,
        p_date: date,
      });
    },
    saveAttendanceDay(actorId, pin, date, records, hijriYear) {
      return rpc('mdr_rel_save_attendance_day', {
        p_actor_id: actorId,
        p_pin: pin,
        p_date: date,
        p_records: records || [],
        p_hijri_year: hijriYear || null,
      });
    },
    teacherClassBootstrap(actorId, pin) {
      return rpc('mdr_rel_teacher_class_bootstrap', {
        p_actor_id: actorId,
        p_pin: pin,
      });
    },
    adminDarsBootstrap(actorId, pin) {
      return rpc('mdr_rel_admin_dars_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    adminMadrasaBootstrap(actorId, pin) {
      return rpc('mdr_rel_admin_madrasa_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    setSpecialWatch(actorId, pin, studentId, specialWatch) {
      return rpc('mdr_rel_set_special_watch', {
        p_actor_id: actorId,
        p_pin: pin,
        p_student_id: studentId,
        p_special_watch: !!specialWatch,
      });
    },
    setAlhamdulillah(actorId, pin, studentId, value) {
      return rpc('mdr_rel_set_alhamdulillah', {
        p_actor_id: actorId,
        p_pin: pin,
        p_student_id: studentId,
        p_alhamdulillah: !!value,
      });
    },
    setStudentStatus(actorId, pin, studentId, status, reason) {
      return rpc('mdr_rel_set_student_status', {
        p_actor_id: actorId,
        p_pin: pin,
        p_student_id: studentId,
        p_status: status,
        p_reason: reason || null,
      });
    },
    alumniBootstrap(actorId, pin) {
      return rpc('mdr_rel_alumni_bootstrap', {
        p_actor_id: actorId,
        p_pin: pin,
      });
    },
    saveAkhlaq(actorId, pin, studentId, score, reason) {
      return rpc('mdr_rel_save_akhlaq', {
        p_actor_id: actorId,
        p_pin: pin,
        p_student_id: studentId,
        p_score: Number(score),
        p_reason: reason || '',
      });
    },
    updateAkhlaq(actorId, pin, akhlaqId, score, reason) {
      return rpc('mdr_rel_update_akhlaq', {
        p_actor_id: actorId,
        p_pin: pin,
        p_akhlaq_id: akhlaqId,
        p_score: Number(score),
        p_reason: reason || '',
      });
    },
    getStudentAkhlaq(actorId, pin, studentId) {
      return rpc('mdr_rel_get_student_akhlaq', {
        p_actor_id: actorId,
        p_pin: pin,
        p_student_id: studentId,
      });
    },
    saveTeacherLog(actorId, pin, type, studentId, content, reviewRequested) {
      return rpc('mdr_rel_save_teacher_log', {
        p_actor_id: actorId,
        p_pin: pin,
        p_type: type,
        p_student_id: studentId || null,
        p_content: content || '',
        p_review_requested: !!reviewRequested,
      });
    },
    updateTeacherLog(actorId, pin, logId, content) {
      return rpc('mdr_rel_update_teacher_log', {
        p_actor_id: actorId,
        p_pin: pin,
        p_log_id: logId,
        p_content: content || '',
      });
    },
    adminReviewLog(actorId, pin, logId, reply) {
      return rpc('mdr_rel_admin_review_log', {
        p_actor_id: actorId,
        p_pin: pin,
        p_log_id: logId,
        p_reply: reply || null,
      });
    },
    adminPendingReviewCount(actorId, pin) {
      return rpc('mdr_rel_admin_pending_review_count', {
        p_actor_id: actorId,
        p_pin: pin,
      });
    },
    adminPendingReviewItems(actorId, pin) {
      return rpc('mdr_rel_admin_pending_review_items', {
        p_actor_id: actorId,
        p_pin: pin,
      });
    },
    saveBookProgress(actorId, pin, bookId, pagesDone, note) {
      return rpc('mdr_rel_save_book_progress', {
        p_actor_id: actorId,
        p_pin: pin,
        p_book_id: bookId,
        p_pages_done: Number(pagesDone),
        p_note: note || null,
      });
    },
    setBookActive(actorId, pin, bookId, isActive) {
      return rpc('mdr_rel_set_book_active', {
        p_actor_id: actorId,
        p_pin: pin,
        p_book_id: bookId,
        p_is_active: !!isActive,
      });
    },
    chatBootstrap(actorId, pin, isAdmin) {
      return rpc('mdr_rel_chat_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_is_admin: !!isAdmin,
      });
    },
    async chatSend(actorId, pin, threadId, text, isAdmin, request) {
      const params = {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_thread_id: threadId,
        p_text: text,
        p_is_admin: !!isAdmin,
        p_request: request || null,
      };
      return rpc('mdr_rel_chat_send', params);
    },
    chatUpdateRequest(actorId, pin, messageId, status) {
      return rpc('mdr_rel_chat_update_request', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_message_id: messageId,
        p_status: status,
      });
    },
    chatMarkRead(actorId, pin, threadId, isAdmin) {
      return rpc('mdr_rel_chat_mark_read', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_thread_id: threadId,
        p_is_admin: !!isAdmin,
      });
    },
    pushSubscribe(actorId, pin, endpoint, p256dh, auth, isAdmin, userAgent) {
      return rpc('mdr_rel_push_subscribe', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
        p_is_admin: !!isAdmin,
        p_user_agent: userAgent || null,
      });
    },
    pushUnsubscribe(endpoint) {
      return rpc('mdr_rel_push_unsubscribe', { p_endpoint: endpoint });
    },
    examBootstrap(actorId, pin) {
      return rpc('mdr_rel_exam_bootstrap', { p_actor_id: actorId, p_pin: pin });
    },
    khadiminList(actorId, pin) {
      return rpc('mdr_rel_khadimin_list', { p_actor_id: actorId, p_pin: pin });
    },
    khadiminUpsert(actorId, pin, payload) {
      return rpc('mdr_rel_khadimin_upsert', {
        p_actor_id: actorId,
        p_pin: pin,
        p_id: payload.id || null,
        p_name: payload.name || '',
        p_phone: payload.phone || null,
        p_duty: payload.duty || null,
        p_join_date: payload.join_date || null,
        p_status: payload.status || null,
        p_address: payload.address || null,
        p_details: payload.details || null,
      });
    },
    khadiminAddNote(actorId, pin, khadimId, text) {
      return rpc('mdr_rel_khadimin_add_note', {
        p_actor_id: actorId,
        p_pin: pin,
        p_khadim_id: khadimId,
        p_text: text || '',
      });
    },
    khadiminAddLeave(actorId, pin, khadimId, dateFrom, dateTo, reason) {
      return rpc('mdr_rel_khadimin_add_leave', {
        p_actor_id: actorId,
        p_pin: pin,
        p_khadim_id: khadimId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_reason: reason || null,
      });
    },
    daftarNotesList(actorId, pin) {
      return rpc('mdr_rel_daftar_notes_list', { p_actor_id: actorId, p_pin: pin });
    },
    daftarNotesUpsert(actorId, pin, noteId, text) {
      return rpc('mdr_rel_daftar_notes_upsert', {
        p_actor_id: actorId,
        p_pin: pin,
        p_id: noteId || null,
        p_text: text || '',
      });
    },
    daftarNotesDelete(actorId, pin, noteId) {
      return rpc('mdr_rel_daftar_notes_delete', {
        p_actor_id: actorId,
        p_pin: pin,
        p_id: noteId,
      });
    },
    dastarkhanGet(actorId, pin) {
      return rpc('mdr_rel_dastarkhan_get', { p_actor_id: actorId, p_pin: pin });
    },
    dastarkhanSave(actorId, pin, payload) {
      return rpc('mdr_rel_dastarkhan_save', {
        p_actor_id: actorId,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    accountsBootstrap(actorId, pin) {
      return rpc('mdr_rel_accounts_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    upsertAccountIncome(actorId, pin, entry) {
      return rpc('mdr_rel_account_upsert_income', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_entry: entry || {},
      });
    },
    upsertAccountExpense(actorId, pin, entry) {
      return rpc('mdr_rel_account_upsert_expense', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_entry: entry || {},
      });
    },
    deleteAccountEntry(actorId, pin, type, id) {
      return rpc('mdr_rel_account_delete_entry', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_type: type,
        p_id: id,
      });
    },
    adjustAccountDuePurchase(actorId, pin, supplier, account, amountDelta) {
      return rpc('mdr_rel_account_adjust_due_purchase', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_supplier: supplier || '',
        p_account: account || 'general',
        p_amount_delta: Number(amountDelta || 0),
      });
    },
    recordAccountDuePayment(actorId, pin, dueId, amount) {
      return rpc('mdr_rel_account_record_due_payment', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_due_id: dueId,
        p_amount: Number(amount || 0),
      });
    },
    addAccountCategory(actorId, pin, name) {
      return rpc('mdr_rel_account_add_category', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_name: name,
      });
    },
    deleteAccountCategory(actorId, pin, name) {
      return rpc('mdr_rel_account_delete_category', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_name: name,
      });
    },
    programsBootstrap(actorId, pin) {
      return rpc('mdr_rel_programs_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    upsertProgram(actorId, pin, program) {
      return rpc('mdr_rel_program_upsert', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_program: program || {},
      });
    },
    deleteProgram(actorId, pin, programId) {
      return rpc('mdr_rel_program_delete', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_program_id: programId,
      });
    },
    upsertProgramIncome(actorId, pin, entry) {
      return rpc('mdr_rel_program_upsert_income', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_entry: entry || {},
      });
    },
    upsertProgramExpense(actorId, pin, entry) {
      return rpc('mdr_rel_program_upsert_expense', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_entry: entry || {},
      });
    },
    deleteProgramEntry(actorId, pin, type, id) {
      return rpc('mdr_rel_program_delete_entry', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_type: type,
        p_id: id,
      });
    },
    addProgramExpenseAttachment(actorId, pin, attachment) {
      return rpc('mdr_rel_program_add_expense_attachment', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_attachment: attachment || {},
      });
    },
    deleteProgramExpenseAttachment(actorId, pin, attachmentId) {
      return rpc('mdr_rel_program_delete_expense_attachment', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_attachment_id: attachmentId,
      });
    },
    saveExam(actorId, pin, name, type, subjects, paperName, paperData) {
      return rpc('mdr_rel_save_exam', {
        p_actor_id: actorId,
        p_pin: pin,
        p_name: name,
        p_type: type,
        p_subjects: subjects,
        p_paper_name: paperName || null,
        p_paper_data: paperData || null,
      });
    },
    updateExam(actorId, pin, examId, name, type, subjects, paperName, paperData) {
      return rpc('mdr_rel_update_exam', {
        p_actor_id: actorId,
        p_pin: pin,
        p_exam_id: examId,
        p_name: name,
        p_type: type,
        p_subjects: subjects || null,
        p_paper_name: paperName || null,
        p_paper_data: paperData || null,
      });
    },
    deleteExam(actorId, pin, examId) {
      return rpc('mdr_rel_delete_exam', {
        p_actor_id: actorId,
        p_pin: pin,
        p_exam_id: examId,
      });
    },
    saveExamResults(actorId, pin, examId, results) {
      return rpc('mdr_rel_save_exam_results', {
        p_actor_id: actorId,
        p_pin: pin,
        p_exam_id: examId,
        p_results: results,
      });
    },
    listDepartments() {
      return rpc('mdr_dept_rel_list_departments', {});
    },
    adminDepartments(pin) {
      return rpc('mdr_dept_rel_admin_departments', { p_pin: pin });
    },
    saveDepartment(pin, id, name, emoji, code, isActive) {
      return rpc('mdr_dept_rel_save_department', {
        p_pin: pin,
        p_id: id || null,
        p_name: name,
        p_emoji: emoji || '🏢',
        p_code: code || null,
        p_is_active: isActive !== false,
      });
    },
    deptBootstrap(actorId, pin, deptCode) {
      return rpc('mdr_dept_rel_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode || null,
      });
    },
    saveDeptSettings(actorId, pin, deptCode, settings) {
      return rpc('mdr_dept_rel_save_settings', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_settings: settings || {},
      });
    },
    saveDeptProduct(actorId, pin, deptCode, product) {
      const packSize = product.pack_size === '' || product.pack_size == null
        ? null
        : Number(product.pack_size);
      return rpc('mdr_dept_rel_save_product', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_product_id: product.id && /^[0-9a-f-]{36}$/i.test(String(product.id)) ? product.id : null,
        p_name: product.name,
        p_unit: product.unit || 'পিস',
        p_price: Number(product.price || 0),
        p_is_active: product.is_active !== false,
        p_stock_unit: product.stock_unit || product.unit || 'পিস',
        p_pack_size: packSize > 0 ? packSize : null,
        p_stock_product_id: product.stock_product_id && /^[0-9a-f-]{36}$/i.test(String(product.stock_product_id)) ? product.stock_product_id : null,
        p_is_stock_item: product.is_stock_item !== false,
        p_is_sellable: product.is_sellable !== false,
      });
    },
    removeDeptProduct(actorId, pin, deptCode, productId, mode) {
      return rpc('mdr_dept_rel_remove_product', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_product_id: productId,
        p_mode: mode === 'zero_stock' ? 'zero_stock' : 'keep_stock',
      });
    },
    saveDeptTransaction(actorId, pin, deptCode, txn) {
      const honorAmount = Number(txn.honor_amount || (txn.metadata && txn.metadata.honor_amount) || 0);
      const hasItems = !!(txn.items && txn.items.length) || !!(txn.metadata && txn.metadata.line_items && txn.metadata.line_items.length);
      const partyName = txn.type === 'expense'
        ? (txn.seller_name || (txn.metadata && txn.metadata.seller_name) || null)
        : (txn.buyer_name || (txn.metadata && txn.metadata.buyer_name) || null);
      const rpcAmount = txn.type === 'income' && !hasItems
        ? Math.max(Number(txn.amount || 0) - honorAmount, 0)
        : Number(txn.amount || 0);
      return rpc('mdr_dept_rel_save_transaction', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_type: txn.type,
        p_description: txn.description || '',
        p_date: txn.date || txn.txn_date || null,
        p_category: txn.category || null,
        p_amount: rpcAmount,
        p_honor_amount: honorAmount,
        p_buyer_name: partyName,
        p_buyer_phone: txn.buyer_phone || (txn.metadata && txn.metadata.buyer_phone) || null,
        p_items: txn.items || (txn.metadata && txn.metadata.line_items) || [],
        p_metadata: txn.metadata || {},
      });
    },
    updateDeptTransaction(actorId, pin, deptCode, txnId, txn) {
      const honorAmount = Number(txn.honor_amount || (txn.metadata && txn.metadata.honor_amount) || 0);
      const hasItems = !!(txn.items && txn.items.length) || !!(txn.metadata && txn.metadata.line_items && txn.metadata.line_items.length);
      const partyName = txn.type === 'expense'
        ? (txn.seller_name || (txn.metadata && txn.metadata.seller_name) || null)
        : (txn.buyer_name || (txn.metadata && txn.metadata.buyer_name) || null);
      const rpcAmount = txn.type === 'income' && !hasItems
        ? Math.max(Number(txn.amount || 0) - honorAmount, 0)
        : Number(txn.amount || 0);
      return rpc('mdr_dept_rel_update_transaction', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_transaction_id: txnId,
        p_description: txn.description || '',
        p_date: txn.date || txn.txn_date || null,
        p_category: txn.category || null,
        p_amount: rpcAmount,
        p_honor_amount: honorAmount,
        p_buyer_name: partyName,
        p_buyer_phone: txn.buyer_phone || (txn.metadata && txn.metadata.buyer_phone) || null,
        p_items: txn.items || (txn.metadata && txn.metadata.line_items) || [],
        p_metadata: txn.metadata || {},
      });
    },
    deleteDeptTransaction(actorId, pin, deptCode, txnId) {
      return rpc('mdr_dept_rel_delete_transaction', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_transaction_id: txnId,
      });
    },
    saveDeptExtraField(pin, deptCode, field) {
      return rpc('mdr_dept_rel_save_extra_field', {
        p_pin: pin,
        p_dept_code: deptCode,
        p_field: field || {},
      });
    },
    deleteDeptExtraField(pin, deptCode, key) {
      return rpc('mdr_dept_rel_delete_extra_field', {
        p_pin: pin,
        p_dept_code: deptCode,
        p_key: key,
      });
    },
    saveDeptEditRequest(actorId, pin, deptCode, req) {
      return rpc('mdr_dept_rel_save_edit_request', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_transaction_id: req.transaction_id && /^[0-9a-f-]{36}$/i.test(String(req.transaction_id)) ? req.transaction_id : null,
        p_kind: req.kind || 'dept_transaction_edit',
        p_reason: req.reason || '',
        p_original: req.original || {},
        p_proposed: req.proposed || null,
      });
    },
    resolveDeptEditRequest(pin, requestId, status) {
      return rpc('mdr_dept_rel_resolve_edit_request', {
        p_pin: pin,
        p_request_id: requestId,
        p_status: status,
      });
    },
    khedmatBootstrap(actorId, pin) {
      return rpc('mdr_khedmat_rel_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
    khedmatUpsertBeneficiary(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_upsert_beneficiary', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatUpsertActivityType(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_upsert_activity_type', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatInsertActivity(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_insert_activity', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatUpsertActivity(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_upsert_activity', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatDeleteActivity(actorId, pin, activityId) {
      return rpc('mdr_khedmat_rel_delete_activity', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_activity_id: activityId,
      });
    },
    khedmatAddActivityImages(actorId, pin, activityId, images) {
      return rpc('mdr_khedmat_rel_add_activity_images', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_activity_id: activityId,
        p_images: images || [],
      });
    },
    khedmatInsertDailyLog(actorId, pin, content, byName) {
      return rpc('mdr_khedmat_rel_insert_daily_log', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_content: content || '',
        p_by: byName || null,
      });
    },
    khedmatUpsertDailyLog(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_upsert_daily_log', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatDeleteDailyLog(actorId, pin, logId) {
      return rpc('mdr_khedmat_rel_delete_daily_log', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_log_id: logId,
      });
    },
    khedmatInsertFinance(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_insert_finance', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatUpsertFinance(actorId, pin, payload) {
      return rpc('mdr_khedmat_rel_upsert_finance', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_payload: payload || {},
      });
    },
    khedmatDeleteFinance(actorId, pin, financeId) {
      return rpc('mdr_khedmat_rel_delete_finance', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_finance_id: financeId,
      });
    },
    khedmatDeleteBeneficiary(actorId, pin, beneficiaryId) {
      return rpc('mdr_khedmat_rel_delete_beneficiary', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_beneficiary_id: beneficiaryId,
      });
    },
    hifzBootstrap(actorId, pin) {
      return rpc('mdr_rel_hifz_bootstrap', { p_actor_id: actorId || null, p_pin: pin });
    },
    hifzEligibleStudents(actorId, pin) {
      return rpc('mdr_rel_hifz_eligible_students', { p_actor_id: actorId || null, p_pin: pin });
    },
    hifzSaveGroup(actorId, pin, group) {
      return rpc('mdr_rel_hifz_save_group', {
        p_actor_id: actorId || null, p_pin: pin,
        p_group_id: group.id || null, p_name: group.name,
        p_teacher: group.teacher || null, p_start_date: group.start || null, p_note: group.note || null,
      });
    },
    hifzSaveProgress(actorId, pin, groupId, paraDone, currentPara, note) {
      return rpc('mdr_rel_hifz_save_progress', {
        p_actor_id: actorId || null, p_pin: pin,
        p_group_id: groupId, p_para_done: Number(paraDone),
        p_current_para: Number(currentPara), p_note: note || null,
      });
    },
    hifzAddMember(actorId, pin, groupId, studentId, joinedDate) {
      return rpc('mdr_rel_hifz_add_member', {
        p_actor_id: actorId || null, p_pin: pin,
        p_group_id: groupId, p_student_id: studentId, p_joined_date: joinedDate || null,
      });
    },
    hifzMemberLeave(actorId, pin, memberId, status, reason, leftAt, note) {
      return rpc('mdr_rel_hifz_member_leave', {
        p_actor_id: actorId || null, p_pin: pin,
        p_member_id: memberId, p_status: status,
        p_reason: reason || null, p_left_at: leftAt || null, p_note: note || null,
      });
    },
    hifzSaveActivity(actorId, pin, groupId, type, text, byName) {
      return rpc('mdr_rel_hifz_save_activity', {
        p_actor_id: actorId || null, p_pin: pin,
        p_group_id: groupId, p_type: type, p_text: text, p_by_name: byName || null,
      });
    },
    adjustDeptInventory(actorId, pin, deptCode, item) {
      return rpc('mdr_dept_rel_adjust_inventory', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_product_id: item.product_id && /^[0-9a-f-]{36}$/i.test(String(item.product_id)) ? item.product_id : null,
        p_item_name: item.item_name || item.product || '',
        p_unit: item.unit || 'পিস',
        p_quantity_delta: Number(item.quantity_delta || item.quantity || 0),
        p_reason: item.reason || 'stock_in',
        p_notes: item.notes || null,
      });
    },
    updateDeptInventoryItem(actorId, pin, deptCode, item) {
      const qty = item.quantity;
      return rpc('mdr_dept_rel_update_inventory_item', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_inventory_id: item.inventory_id,
        p_item_name: item.item_name || '',
        p_unit: item.unit || null,
        p_quantity: qty === '' || qty == null ? null : Number(qty),
        p_notes: item.notes || null,
      });
    },
    deleteDeptInventoryItem(actorId, pin, deptCode, inventoryId, notes) {
      return rpc('mdr_dept_rel_delete_inventory_item', {
        p_actor_id: actorId || null,
        p_pin: pin,
        p_dept_code: deptCode,
        p_inventory_id: inventoryId,
        p_notes: notes || null,
      });
    },
    classRoutineGet(actorId, pin, classCode, routineId) {
      return rpc('mdr_rel_class_routine_get', {
        p_actor_id: actorId,
        p_pin: pin,
        p_class_code: classCode || null,
        p_routine_id: routineId || null,
      });
    },
    classRoutineSave(actorId, pin, slots, changeNote) {
      return rpc('mdr_rel_class_routine_save', {
        p_actor_id: actorId,
        p_pin: pin,
        p_slots: slots || [],
        p_change_note: changeNote || '',
      });
    },
    classRoutineUpdate(actorId, pin, slots, changeNote) {
      return rpc('mdr_rel_class_routine_update', {
        p_actor_id: actorId,
        p_pin: pin,
        p_slots: slots || [],
        p_change_note: changeNote || null,
      });
    },
    classRoutineDelete(actorId, pin, routineId) {
      return rpc('mdr_rel_class_routine_delete', {
        p_actor_id: actorId,
        p_pin: pin,
        p_routine_id: routineId,
      });
    },
    adminRoutineBootstrap(actorId, pin) {
      return rpc('mdr_rel_admin_routine_bootstrap', {
        p_actor_id: actorId || null,
        p_pin: pin,
      });
    },
  };
})();

if (typeof window !== 'undefined') {
  window.MMSharedAPI = MMSharedAPI;
  window.supabaseClient = MMSharedAPI.supabaseClient;
}
