/* Department module DB bridge.
   DeptAPI keeps a per-page memory cache after a successful Supabase read. */
(function (global) {
  'use strict';

  var DEPT_LS_KEY = 'mm_dept_departments';
  var TXN_LS_KEY = 'mm_dept_transactions';
  var INV_LS_KEY = 'mm_dept_inventory';
  var PRODUCT_LS_KEY = 'mm_dept_products';
  var EXTRA_LS_KEY = 'mm_dept_extra_fields';
  var SETTINGS_LS_KEY = 'mm_dept_settings';
  var EDIT_REQ_LS_KEY = 'mm_dept_edit_requests';

  function requireShared() {
    if (!global.MMSharedAPI) throw new Error('Supabase API is not loaded');
    return global.MMSharedAPI;
  }

  function requireDeptAPI() {
    if (!global.DeptAPI || !DeptAPI.__cacheGet || !DeptAPI.__cacheSet) {
      throw new Error('DeptAPI cache is not loaded');
    }
    return global.DeptAPI;
  }

  function readJson(key, fallback) {
    return requireDeptAPI().__cacheGet(key, fallback);
  }

  function writeJson(key, value) {
    requireDeptAPI().__cacheSet(key, value);
  }

  function normalizeEmoji(code, emoji) {
    if (code === 'dept_4' && (!emoji || emoji === '🧵')) return '✂️';
    return emoji || '🏢';
  }

  function mapDept(d) {
    return {
      id: d.code,
      db_id: String(d.id || ''),
      name: d.name || '',
      emoji: normalizeEmoji(d.code, d.emoji),
      is_active: d.is_active !== false,
      pin: d.head_pin || '',
      head_user_id: d.head_user_id ? String(d.head_user_id) : '',
      head_name: d.head_name || '',
      head_login_id: d.head_login_id || '',
    };
  }

  function replaceDeptRows(key, deptCode, rows) {
    var existing = readJson(key, []);
    var next = existing.filter(function (row) { return row && row.dept_id !== deptCode; })
      .concat((rows || []).map(function (row) { return Object.assign({}, row, { dept_id: deptCode }); }));
    writeJson(key, next);
  }

  function replaceExtraFields(deptCode, rows) {
    var all = readJson(EXTRA_LS_KEY, {});
    all[deptCode] = (rows || []).map(function (f) {
      return {
        id: String(f.id || ''),
        key: f.key || '',
        label: f.label || '',
        type: f.type === 'number' ? 'number' : 'text',
        optional: f.optional !== false,
        sort_order: Number(f.sort_order || 0),
      };
    }).filter(function (f) { return f.key && f.label; });
    writeJson(EXTRA_LS_KEY, all);
  }

  function replaceEditRequests(deptCode, rows) {
    replaceDeptRows(EDIT_REQ_LS_KEY, deptCode, (rows || []).map(function (r) {
      return {
        id: String(r.id || ''),
        dept_id: deptCode,
        transaction_id: String(r.transaction_id || ''),
        kind: r.kind || 'dept_transaction_edit',
        reason: r.reason || '',
        status: r.status || 'pending',
        original: r.original || {},
        proposed: r.proposed || null,
        created_at: r.created_at || '',
        resolved_at: r.resolved_at || '',
      };
    }));
  }

  function replaceSettings(deptCode, settings) {
    var all = readJson(SETTINGS_LS_KEY, {});
    all[deptCode] = settings && typeof settings === 'object' ? settings : {};
    writeJson(SETTINGS_LS_KEY, all);
  }

  function applyDeptBootstrap(deptCode, res) {
    replaceDeptRows(PRODUCT_LS_KEY, deptCode, res.products || []);
    replaceDeptRows(INV_LS_KEY, deptCode, res.inventory || []);
    replaceDeptRows(TXN_LS_KEY, deptCode, res.transactions || []);
    replaceExtraFields(deptCode, res.extra_fields || []);
    replaceSettings(deptCode, res.settings || {});
    replaceEditRequests(deptCode, res.edit_requests || []);
  }

  async function bootstrap(pin, includeInactive) {
    var api = requireShared();
    var res = includeInactive && api.adminDepartments
      ? await api.adminDepartments(pin)
      : await api.listDepartments();
    if (!res || !res.ok) throw new Error((res && res.error) || 'dept_bootstrap_failed');
    writeJson(DEPT_LS_KEY, (res.departments || []).map(mapDept));
    return true;
  }

  async function bootstrapData(actorId, pin, deptCode) {
    if (!pin || !deptCode) throw new Error('dept_session_missing');
    var api = requireShared();
    var res = await api.deptBootstrap(actorId || null, pin, deptCode);
    if (!res || !res.ok) throw new Error((res && res.error) || 'dept_data_bootstrap_failed');
    applyDeptBootstrap(deptCode, res);
    return true;
  }

  async function bootstrapAllData(actorId, pin) {
    if (!pin) throw new Error('admin_session_missing');
    var api = requireShared();
    var res = api.adminDepartments ? await api.adminDepartments(pin) : await api.listDepartments();
    if (!res || !res.ok) throw new Error((res && res.error) || 'dept_admin_bootstrap_failed');

    var depts = (res.departments || []).map(mapDept);
    writeJson(DEPT_LS_KEY, depts);

    var products = [];
    var inventory = [];
    var transactions = [];
    var editRequests = [];
    var extraFields = {};
    var settings = {};

    for (var i = 0; i < depts.length; i += 1) {
      var d = depts[i];
      if (d.is_active === false) {
        extraFields[d.id] = [];
        settings[d.id] = {};
        continue;
      }
      var data = await api.deptBootstrap(actorId || null, pin, d.id);
      if (!data || !data.ok) throw new Error((data && data.error) || ('dept_bootstrap_failed_' + d.id));
      products = products.concat((data.products || []).map(function (row) { return Object.assign({}, row, { dept_id: d.id }); }));
      inventory = inventory.concat((data.inventory || []).map(function (row) { return Object.assign({}, row, { dept_id: d.id }); }));
      transactions = transactions.concat((data.transactions || []).map(function (row) { return Object.assign({}, row, { dept_id: d.id }); }));
      editRequests = editRequests.concat((data.edit_requests || []).map(function (row) {
        return Object.assign({}, row, { dept_id: d.id, transaction_id: String(row.transaction_id || '') });
      }));
      extraFields[d.id] = (data.extra_fields || []).map(function (f) {
        return {
          id: String(f.id || ''),
          key: f.key || '',
          label: f.label || '',
          type: f.type === 'number' ? 'number' : 'text',
          optional: f.optional !== false,
          sort_order: Number(f.sort_order || 0),
        };
      }).filter(function (f) { return f.key && f.label; });
      settings[d.id] = data.settings && typeof data.settings === 'object' ? data.settings : {};
    }

    writeJson(PRODUCT_LS_KEY, products);
    writeJson(INV_LS_KEY, inventory);
    writeJson(TXN_LS_KEY, transactions);
    writeJson(EDIT_REQ_LS_KEY, editRequests);
    writeJson(EXTRA_LS_KEY, extraFields);
    writeJson(SETTINGS_LS_KEY, settings);
    return true;
  }

  async function saveDepartment(pin, dbId, name, emoji) {
    var api = requireShared();
    var res = await api.saveDepartment(pin, dbId || null, name, emoji || '🏢', null, true);
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_failed');
    await bootstrap(pin, true);
    return res.id;
  }

  async function toggleDepartment(pin, dbId, isActive) {
    var api = requireShared();
    var dept = (readJson(DEPT_LS_KEY, [])).find(function (d) { return d.db_id === dbId; });
    if (!dept) throw new Error('dept_not_found');
    var res = await api.saveDepartment(pin, dbId, dept.name, dept.emoji, null, isActive);
    if (!res || !res.ok) throw new Error((res && res.error) || 'update_failed');
    await bootstrap(pin, true);
  }

  async function saveProduct(actorId, pin, deptCode, product) {
    var api = requireShared();
    var res = await api.saveDeptProduct(actorId, pin, deptCode, product || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_product_failed');
    await bootstrapData(actorId, pin, deptCode);
    return res.id;
  }

  async function removeProduct(actorId, pin, deptCode, productId, mode) {
    var api = requireShared();
    var res = await api.removeDeptProduct(actorId, pin, deptCode, productId, mode || 'keep_stock');
    if (!res || !res.ok) throw new Error((res && res.error) || 'remove_product_failed');
    await bootstrapData(actorId, pin, deptCode);
    return true;
  }

  async function saveTransaction(actorId, pin, deptCode, txn) {
    var api = requireShared();
    var res = await api.saveDeptTransaction(actorId, pin, deptCode, txn || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_transaction_failed');
    await bootstrapData(actorId, pin, deptCode);
    return res.id;
  }

  async function updateTransaction(actorId, pin, deptCode, txnId, txn) {
    var api = requireShared();
    var res = await api.updateDeptTransaction(actorId, pin, deptCode, txnId, txn || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'update_transaction_failed');
    await bootstrapData(actorId, pin, deptCode);
    return res.id;
  }

  async function deleteTransaction(actorId, pin, deptCode, txnId) {
    var api = requireShared();
    var res = await api.deleteDeptTransaction(actorId, pin, deptCode, txnId);
    if (!res || !res.ok) throw new Error((res && res.error) || 'delete_transaction_failed');
    await bootstrapData(actorId, pin, deptCode);
    return res.id;
  }

  async function adjustInventory(actorId, pin, deptCode, item) {
    var api = requireShared();
    var res = await api.adjustDeptInventory(actorId, pin, deptCode, item || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'adjust_inventory_failed');
    await bootstrapData(actorId, pin, deptCode);
    return true;
  }

  async function updateInventoryItem(actorId, pin, deptCode, item) {
    var api = requireShared();
    var res = await api.updateDeptInventoryItem(actorId, pin, deptCode, item || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'update_inventory_item_failed');
    await bootstrapData(actorId, pin, deptCode);
    return true;
  }

  async function deleteInventoryItem(actorId, pin, deptCode, inventoryId, notes) {
    var api = requireShared();
    var res = await api.deleteDeptInventoryItem(actorId, pin, deptCode, inventoryId, notes);
    if (!res || !res.ok) throw new Error((res && res.error) || 'delete_inventory_item_failed');
    await bootstrapData(actorId, pin, deptCode);
    return true;
  }

  async function listInventoryMovements(actorId, pin, deptCode, productId, limit) {
    var api = requireShared();
    var res = await api.listDeptInventoryMovements(actorId, pin, deptCode, productId || null, limit || 50);
    if (!res || !res.ok) throw new Error((res && res.error) || 'list_inventory_movements_failed');
    return res.movements || [];
  }

  async function saveSettings(actorId, pin, deptCode, settings) {
    var api = requireShared();
    var res = await api.saveDeptSettings(actorId, pin, deptCode, settings || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_settings_failed');
    await bootstrapData(actorId, pin, deptCode);
    return true;
  }

  async function saveExtraField(pin, deptCode, field) {
    var api = requireShared();
    var res = await api.saveDeptExtraField(pin, deptCode, field || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_extra_field_failed');
    await bootstrapAllData(null, pin);
    return res.id;
  }

  async function deleteExtraField(pin, deptCode, key) {
    var api = requireShared();
    var res = await api.deleteDeptExtraField(pin, deptCode, key);
    if (!res || !res.ok) throw new Error((res && res.error) || 'delete_extra_field_failed');
    await bootstrapAllData(null, pin);
    return true;
  }

  async function saveEditRequest(actorId, pin, deptCode, req) {
    var api = requireShared();
    var res = await api.saveDeptEditRequest(actorId, pin, deptCode, req || {});
    if (!res || !res.ok) throw new Error((res && res.error) || 'save_edit_request_failed');
    await bootstrapData(actorId, pin, deptCode);
    return res.id;
  }

  async function resolveEditRequest(pin, requestId, status) {
    var api = requireShared();
    var res = await api.resolveDeptEditRequest(pin, requestId, status);
    if (!res || !res.ok) throw new Error((res && res.error) || 'resolve_edit_request_failed');
    await bootstrapAllData(null, pin);
    return true;
  }

  global.DeptSync = {
    bootstrap: bootstrap,
    bootstrapData: bootstrapData,
    bootstrapAllData: bootstrapAllData,
    saveDepartment: saveDepartment,
    toggleDepartment: toggleDepartment,
    saveProduct: saveProduct,
    removeProduct: removeProduct,
    saveTransaction: saveTransaction,
    updateTransaction: updateTransaction,
    deleteTransaction: deleteTransaction,
    adjustInventory: adjustInventory,
    updateInventoryItem: updateInventoryItem,
    deleteInventoryItem: deleteInventoryItem,
    listInventoryMovements: listInventoryMovements,
    saveSettings: saveSettings,
    saveExtraField: saveExtraField,
    deleteExtraField: deleteExtraField,
    saveEditRequest: saveEditRequest,
    resolveEditRequest: resolveEditRequest,
  };
})(typeof window !== 'undefined' ? window : globalThis);
