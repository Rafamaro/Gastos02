import { defaults } from "./constants.js";
import { mergeConfig, loadConfig, saveConfig, loadTransactions, saveTransactions, loadBudgets, saveBudgets } from "./storage.js";
import { normalizeTx } from "./utils.js";
import { ensureSession as ensureDirectusClientSession } from "./directusClient.js";
import { listItems, createItem, createItems, updateItem, deleteItem } from "./directusClient.js";

const GROUP_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";
const COLLECTIONS = {
  categories: "categories",
  groups: "groups",
  movements: "movements",
  budgets: "budgets",
  settings: "settings",
  importsLog: "imports_log"
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidId(v){
  if(typeof v === "number" && Number.isFinite(v)) return true;
  const s = String(v ?? "").trim();
  return UUID_RE.test(s) || /^\d+$/.test(s);
}

function normalizeId(v){
  if(typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if(!s) return null;
  if(UUID_RE.test(s)) return s;
  if(/^\d+$/.test(s)) return Number(s);
  return null;
}

function extractId(res){
  if(res && typeof res === "object" && "id" in res && isValidId(res.id)) return res.id;
  if(res?.data && typeof res.data === "object" && "id" in res.data && isValidId(res.data.id)) return res.data.id;
  if(Array.isArray(res) && res[0]?.id && isValidId(res[0].id)) return res[0].id;
  if(Array.isArray(res?.data) && res.data[0]?.id && isValidId(res.data[0].id)) return res.data[0].id;
  if(res?.data?.data?.id && isValidId(res.data.data.id)) return res.data.data.id;
  if(Array.isArray(res?.data?.data) && res.data.data[0]?.id && isValidId(res.data.data[0].id)) return res.data.data[0].id;
  return null;
}

function buildDirectusDebugInfo(errorOrNull, responseOrNull){
  const out = {};
  if(errorOrNull){
    out.status = errorOrNull?.status || null;
    out.body = errorOrNull?.payload || errorOrNull?.message || null;
  }
  if(responseOrNull !== undefined) out.response = responseOrNull ?? null;
  return out;
}

async function getDirectusSession(){
  try{
    const session = await ensureDirectusClientSession();
    return session?.connected ? session : null;
  }catch(_err){
    return null;
  }
}

function directusArgs(session){
  return { baseUrl: session.baseUrl, access_token: session.access_token };
}

async function resolveCategoryIdByName(session, categoryName, type = "expense"){
  const safeType = type === "income" ? "income" : "expense";
  const list = await listItems({
    ...directusArgs(session),
    collection: COLLECTIONS.categories,
    query: {
      limit: 1,
      filter: { name: { _eq: String(categoryName || "").trim() }, type: { _eq: safeType } },
      fields: ["id"]
    }
  });
  const id = extractId(list);
  return isValidId(id) ? normalizeId(id) : null;
}

const resolveOrCreateCategoryId = async (session, categoryRef, type = "expense") => {
  const safeType = type === "income" ? "income" : "expense";

  if(typeof categoryRef === "number" && Number.isFinite(categoryRef)) return categoryRef;
  const directId = normalizeId(categoryRef);
  if(directId !== null) return directId;

  const name = String(categoryRef ?? "").trim();
  if(!name) return null;

  const firstLookup = await listItems({
    ...directusArgs(session),
    collection: COLLECTIONS.categories,
    query: {
      limit: 1,
      filter: { name: { _eq: name }, type: { _eq: safeType } },
      fields: ["id"]
    }
  });
  const firstId = normalizeId(extractId(firstLookup));
  if(firstId !== null) return firstId;

  let postRes = null;
  let postErr = null;
  try{
    postRes = await createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.categories,
      data: { name, type: safeType, group: null, is_active: true }
    });
    const postId = normalizeId(extractId(postRes));
    if(postId !== null) return postId;
  }catch(err){
    postErr = err;
  }

  const secondLookup = await listItems({
    ...directusArgs(session),
    collection: COLLECTIONS.categories,
    query: {
      limit: 1,
      filter: { name: { _eq: name }, type: { _eq: safeType } },
      fields: ["id"]
    }
  });
  const secondId = normalizeId(extractId(secondLookup));
  if(secondId !== null) return secondId;

  const debugInfo = {
    post: buildDirectusDebugInfo(postErr, postRes),
    firstLookup,
    secondLookup
  };
  throw new Error(`No se pudo resolver/crear la categoría '${name}' (${safeType}) en Directus. Debug: ${JSON.stringify(debugInfo)}`);
};

export function getBackendMode(){
  return "local";
}

export function setBackendMode(){
  return "local";
}

function unique(list){
  return Array.from(new Set((list || []).map(x => String(x || "").trim()).filter(Boolean)));
}

function parseCategoryId(id){
  const [type, ...rest] = String(id || "").split(":");
  return { type, name: rest.join(":") };
}

function budgetRowsToLocal(rows){
  const out = {};
  for(const b of rows || []){
    const month = String(b.month || "").trim();
    if(!month) continue;
    if(!out[month]) out[month] = {};

    const rawName = String(b.category?.name || "");
    const isGroup = rawName.startsWith(PAYLOAD_GROUP_PREFIX);
    const key = isGroup ? `${GROUP_PREFIX}${rawName.replace(PAYLOAD_GROUP_PREFIX, "")}` : rawName;
    if(key) out[month][key] = Number(b.amount) || 0;
  }
  return out;
}

export async function getSettings(){
  const session = await getDirectusSession();
  if(session){
    const rows = await listItems({ ...directusArgs(session), collection: COLLECTIONS.settings, query: { fields: ["key", "value"], limit: 200 } });
    if(rows.length){
      const cfg = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      return mergeConfig(cfg);
    }
  }
  return mergeConfig(loadConfig());
}

export async function saveSettings(payload){
  const merged = mergeConfig({ ...loadConfig(), ...(payload || {}) });
  merged.expenseCategories = unique(merged.expenseCategories);
  merged.incomeCategories = unique(merged.incomeCategories);
  merged.reentryCategories = unique(merged.reentryCategories);
  merged.expenseGroups = unique(merged.expenseGroups);
  const session = await getDirectusSession();
  if(session){
    const entries = Object.entries(merged);
    const existing = await listItems({ ...directusArgs(session), collection: COLLECTIONS.settings, query: { fields: ["id", "key"], limit: 500 } });
    const byKey = new Map(existing.map(x => [x.key, x.id]));
    for(const [key, value] of entries){
      const id = byKey.get(key);
      if(id) await updateItem({ ...directusArgs(session), collection: COLLECTIONS.settings, id, data: { value } });
      else await createItem({ ...directusArgs(session), collection: COLLECTIONS.settings, data: { key, value } });
    }
  }
  saveConfig(merged);
  return merged;
}

export async function listCurrencies(){
  return (loadConfig().currencies || []).map(code => ({ code }));
}

export async function listGroups(){
  const session = await getDirectusSession();
  if(session){
    return listItems({ ...directusArgs(session), collection: COLLECTIONS.groups, query: { fields: ["id", "name", "type", "sort", "color", "icon", "is_active"], sort: ["sort", "name"], limit: 500 } });
  }
  return (loadConfig().expenseGroups || []).map(name => ({ id: name, name, description: "" }));
}

export async function createGroup({ name, description } = {}){
  const safeName = String(name || "").trim();
  if(!safeName) throw new Error("Nombre de grupo inválido");
  const session = await getDirectusSession();
  if(session){
    return createItem({ ...directusArgs(session), collection: COLLECTIONS.groups, data: { name: safeName, type: "expense", is_active: true, sort: null, color: null, icon: null, description } });
  }
  const cfg = loadConfig();
  cfg.expenseGroups = unique([...(cfg.expenseGroups || []), safeName]);
  saveConfig(cfg);
  return { id: safeName, name: safeName, description: description || "" };
}

export async function updateGroup(id, payload = {}){
  const oldName = String(id || "").trim();
  const newName = String(payload.name || oldName).trim();
  if(!oldName || !newName) throw new Error("Nombre de grupo inválido");

  const session = await getDirectusSession();
  if(session){
    return updateItem({ ...directusArgs(session), collection: COLLECTIONS.groups, id, data: payload });
  }

  const cfg = loadConfig();
  cfg.expenseGroups = (cfg.expenseGroups || []).map(g => g === oldName ? newName : g);
  cfg.expenseGroups = unique(cfg.expenseGroups);

  const map = { ...(cfg.expenseCategoryGroups || {}) };
  Object.keys(map).forEach(cat => {
    if(map[cat] === oldName) map[cat] = newName;
  });
  cfg.expenseCategoryGroups = map;
  saveConfig(cfg);

  const budgets = loadBudgets();
  Object.keys(budgets).forEach(month => {
    const sourceKey = `${GROUP_PREFIX}${oldName}`;
    const targetKey = `${GROUP_PREFIX}${newName}`;
    if(Object.prototype.hasOwnProperty.call(budgets[month] || {}, sourceKey)){
      budgets[month][targetKey] = Number(budgets[month][sourceKey]) || 0;
      delete budgets[month][sourceKey];
    }
  });
  saveBudgets(budgets);

  return { id: newName, name: newName, description: payload.description || "" };
}

export async function listCategories({ type } = {}){
  const session = await getDirectusSession();
  if(session){
    const query = { fields: ["id", "name", "type", "group", "group.id", "group.name", "sort", "color", "icon", "is_active"], sort: ["sort", "name"], limit: 1000 };
    if(type){
      const safeType = type === "reentry" ? "income" : type;
      query.filter = { type: { _eq: safeType } };
    }
    return listItems({ ...directusArgs(session), collection: COLLECTIONS.categories, query });
  }
  const cfg = loadConfig();
  const local = [
    ...(cfg.expenseCategories || []).map(name => ({
      id: `expense:${name}`,
      name,
      type: "expense",
      group: cfg.expenseCategoryGroups?.[name] ? { name: cfg.expenseCategoryGroups[name], type: "group" } : null
    })),
    ...(cfg.incomeCategories || []).map(name => ({ id: `income:${name}`, name, type: "income", group: null })),
    ...(cfg.reentryCategories || []).map(name => ({ id: `reentry:${name}`, name, type: "reentry", group: null }))
  ];
  if(type === "reentry") return local.filter(x => x.type === "reentry");
  return type ? local.filter(x => x.type === type) : local;
}

export async function createCategory({ name, type, group } = {}){
  const safeName = String(name || "").trim();
  const safeType = type === "income" ? "income" : "expense";
  if(!safeName) throw new Error("Nombre de categoría inválido");

  const session = await getDirectusSession();
  if(session){
    return createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.categories,
      data: { name: safeName, type: safeType, group: group?.id || group || null, is_active: true }
    });
  }

  const cfg = loadConfig();
  const arr = safeType === "income" ? cfg.incomeCategories : cfg.expenseCategories;
  if(!arr.includes(safeName)) arr.push(safeName);

  if(safeType === "expense"){
    if(group) cfg.expenseCategoryGroups[safeName] = String(group).trim();
  }else{
    delete cfg.expenseCategoryGroups[safeName];
  }

  saveConfig(cfg);
  return { id: `${safeType}:${safeName}`, name: safeName, type: safeType, group: group ? { name: group } : null };
}

export async function updateCategory(id, payload = {}){
  const session = await getDirectusSession();
  if(session){
    return updateItem({ ...directusArgs(session), collection: COLLECTIONS.categories, id, data: { ...payload, group: payload.group?.id || payload.group || null } });
  }

  const { type: idType, name: idName } = parseCategoryId(id);
  const nextType = payload.type || idType;
  const nextName = String(payload.name || idName).trim();
  if(!idName || !nextName) throw new Error("Categoría inválida");

  const cfg = loadConfig();
  const fromArr = idType === "income" ? cfg.incomeCategories : cfg.expenseCategories;
  const toArr = nextType === "income" ? cfg.incomeCategories : cfg.expenseCategories;

  const fromIndex = fromArr.indexOf(idName);
  if(fromIndex >= 0) fromArr.splice(fromIndex, 1);
  if(!toArr.includes(nextName)) toArr.push(nextName);

  if(nextType === "expense"){
    const groupName = payload.group?.name || payload.group || cfg.expenseCategoryGroups[idName] || "";
    if(groupName) cfg.expenseCategoryGroups[nextName] = String(groupName).trim();
  }
  delete cfg.expenseCategoryGroups[idName];
  saveConfig(cfg);

  const tx = loadTransactions(cfg).map(row => {
    if(row.category !== idName) return row;
    return { ...row, category: nextName, type: nextType };
  });
  saveTransactions(tx);

  const budgets = loadBudgets();
  Object.keys(budgets).forEach(month => {
    if(Object.prototype.hasOwnProperty.call(budgets[month] || {}, idName)){
      budgets[month][nextName] = Number(budgets[month][idName]) || 0;
      delete budgets[month][idName];
    }
  });
  saveBudgets(budgets);

  return { id: `${nextType}:${nextName}`, name: nextName, type: nextType, group: cfg.expenseCategoryGroups[nextName] ? { name: cfg.expenseCategoryGroups[nextName] } : null };
}

export async function deleteCategory(id){
  const session = await getDirectusSession();
  if(session) return deleteItem({ ...directusArgs(session), collection: COLLECTIONS.categories, id });
  const { type, name } = parseCategoryId(id);
  if(!name) return true;

  const cfg = loadConfig();
  if(type === "income") cfg.incomeCategories = (cfg.incomeCategories || []).filter(c => c !== name);
  else cfg.expenseCategories = (cfg.expenseCategories || []).filter(c => c !== name);
  delete cfg.expenseCategoryGroups[name];
  saveConfig(cfg);

  const budgets = loadBudgets();
  Object.keys(budgets).forEach(month => {
    if(Object.prototype.hasOwnProperty.call(budgets[month] || {}, name)) delete budgets[month][name];
  });
  saveBudgets(budgets);
  return true;
}

export async function listTransactions(){
  const session = await getDirectusSession();
  if(session){
    const rows = await listItems({
      ...directusArgs(session),
      collection: COLLECTIONS.movements,
      query: { fields: ["id", "date", "amount", "type", "note", "source", "imported_batch_id", "category", "category.id", "category.name", "group_snapshot"], sort: ["-date"], limit: 2000 }
    });
    return rows.map(row => ({
      id: row.id,
      date: row.date,
      amount: Number(row.amount) || 0,
      type: row.type === "income" && String(row.source || "").trim().toLowerCase() === "reintegro" ? "reentry" : row.type,
      category: row.category?.name || "",
      desc: row.note || "",
      notes: row.note || "",
      pay: row.source || "",
      currency: loadConfig().baseCurrency,
      group_snapshot: row.group_snapshot || "",
      imported_batch_id: row.imported_batch_id || ""
    }));
  }
  return loadTransactions(loadConfig());
}

export async function updateMovement(session, id, patch = {}){
  if(!session?.access_token) throw new Error("Sesión Directus inválida para editar movimiento.");
  if(!id) throw new Error("ID de movimiento inválido.");
  return updateItem({
    ...directusArgs(session),
    collection: COLLECTIONS.movements,
    id,
    data: patch
  });
}

export async function deleteMovement(session, id){
  if(!session?.access_token) throw new Error("Sesión Directus inválida para borrar movimiento.");
  if(!id) throw new Error("ID de movimiento inválido.");
  return deleteItem({
    ...directusArgs(session),
    collection: COLLECTIONS.movements,
    id
  });
}

function buildLegacyCategoryMap(json = {}){
  const map = new Map();
  const raw = json?.categories;
  if(Array.isArray(raw)){
    raw.forEach((item, idx) => {
      if(typeof item === "string") map.set(String(idx), item.trim());
      else if(item && typeof item === "object"){
        const id = item.id ?? item.value ?? item.key ?? idx;
        const name = item.name ?? item.label ?? item.title ?? "";
        if(String(name || "").trim()) map.set(String(id), String(name).trim());
      }
    });
  }else if(raw && typeof raw === "object"){
    Object.entries(raw).forEach(([id, value]) => {
      if(typeof value === "string") map.set(String(id), value.trim());
      else if(value?.name) map.set(String(id), String(value.name).trim());
    });
  }
  return map;
}

function resolveLegacyCategoryName(value, legacyMap){
  if(typeof value === "number") return legacyMap.get(String(value)) || String(value);
  const raw = String(value || "").trim();
  if(/^\d+$/.test(raw) && legacyMap.has(raw)) return legacyMap.get(raw) || raw;
  return raw;
}

export async function importLegacyJsonToDirectus(session, json = {}, { onProgress } = {}){
  if(!session?.access_token) throw new Error("Importación requiere sesión Directus activa.");

  const parsed = json && typeof json === "object" ? json : {};
  const legacyMap = buildLegacyCategoryMap(parsed);
  const txList = Array.isArray(parsed.transactions)
    ? parsed.transactions
    : Array.isArray(parsed.expenses)
      ? parsed.expenses.map(x => ({ ...x, type: "expense" }))
      : [];

  if(!txList.length) throw new Error("El archivo no tiene movimientos válidos para importar.");

  const month = txList[0]?.date ? String(txList[0].date).slice(0, 7) : "";
  const safeBatchId = String(parsed.imported_batch_id || `${month}:${txList.length}`).trim();
  if(!safeBatchId) throw new Error("imported_batch_id inválido");

  const existing = await listItems({
    ...directusArgs(session),
    collection: COLLECTIONS.movements,
    query: { fields: ["id"], limit: 1, filter: { imported_batch_id: { _eq: safeBatchId } } }
  });
  if(existing.length){
    return { skipped: true, reason: "batch_exists", imported_batch_id: safeBatchId, inserted: 0 };
  }

  const movements = txList.map((mov) => ({
    date: mov.date,
    amount: Number(mov.amount) || 0,
    type: mov.type,
    category: resolveLegacyCategoryName(mov.category, legacyMap),
    group: mov.group || "",
    note: mov.note || mov.notes || mov.desc || ""
  })).filter(m => m.date && m.category);

  let inserted = 0;
  for(let idx = 0; idx < movements.length; idx++){
    const mov = movements[idx];
    if(typeof onProgress === "function") onProgress({ current: idx + 1, total: movements.length });
    const safeType = mov.type === "income" || mov.type === "reentry" ? "income" : "expense";
    const categoryId = await resolveOrCreateCategoryId(session, mov.category, safeType);
    if(!isValidId(categoryId)) throw new Error(`Categoría inválida durante import: ${mov.category}`);

    await createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.movements,
      data: {
        date: mov.date,
        amount: Number(mov.amount) || 0,
        type: safeType,
        category: categoryId,
        note: mov.note || "",
        source: "json",
        group_snapshot: mov.group || "",
        imported_batch_id: safeBatchId
      }
    });
    inserted += 1;
  }

  await createItem({
    ...directusArgs(session),
    collection: COLLECTIONS.importsLog,
    data: {
      month: month || "",
      source: "json",
      status: "ok",
      summary: { received: txList.length, inserted, imported_batch_id: safeBatchId }
    }
  });

  return { skipped: false, imported_batch_id: safeBatchId, inserted };
}

export async function createTransaction(payload){
  const session = await getDirectusSession();
  if(session){
    const normalized = normalizeTx(payload, loadConfig());
    const selectedCategoryValue = String(payload?.categoryId || "").trim();
    const categoryRef = isValidId(selectedCategoryValue)
      ? normalizeId(selectedCategoryValue)
      : String(normalized.category || payload?.category || "").trim();
    const categoryId = await resolveOrCreateCategoryId(session, categoryRef, normalized.type);

    if(!isValidId(categoryId)) throw new Error("No se pudo resolver la categoría del movimiento.");

    const saved = await createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.movements,
      data: {
        date: normalized.date,
        amount: Number(normalized.amount) || 0,
        type: normalized.type,
        category: categoryId,
        note: normalized.notes || normalized.desc || "",
        source: normalized.pay || "manual",
        group_snapshot: "",
        imported_batch_id: normalized.imported_batch_id || null
      }
    });
    return { ...normalized, id: saved?.id || normalized.id };
  }
  const cfg = loadConfig();
  const tx = loadTransactions(cfg);
  const normalized = normalizeTx(payload, cfg);
  tx.push(normalized);
  saveTransactions(tx);
  return normalized;
}

export async function updateTransaction(id, payload){
  const session = await getDirectusSession();
  if(session){
    const data = { ...payload };
    const selectedCategoryValue = String(payload?.categoryId || "").trim();
    const categoryRef = isValidId(selectedCategoryValue)
      ? normalizeId(selectedCategoryValue)
      : String(payload?.category || "").trim();
    if(categoryRef){
      const categoryId = await resolveOrCreateCategoryId(session, categoryRef, payload?.type || "expense");
      if(!isValidId(categoryId)) throw new Error("No se pudo resolver la categoría del movimiento.");
      data.category = categoryId;
    }
    delete data.categoryId;
    if(payload?.notes || payload?.desc) data.note = payload.notes || payload.desc;
    return updateMovement(session, id, data);
  }
  const cfg = loadConfig();
  const tx = loadTransactions(cfg);
  const idx = tx.findIndex(x => x.id === id);
  if(idx < 0) return null;

  const updated = normalizeTx({ ...tx[idx], ...(payload || {}), id }, cfg);
  tx[idx] = updated;
  saveTransactions(tx);
  return updated;
}

export async function deleteTransaction(id){
  const session = await getDirectusSession();
  if(session) return deleteMovement(session, id);
  const cfg = loadConfig();
  const tx = loadTransactions(cfg).filter(x => x.id !== id);
  saveTransactions(tx);
  return true;
}

export async function listBudgets({ month } = {}){
  const session = await getDirectusSession();
  if(session){
    const query = { fields: ["id", "month", "amount", "group", "group.id", "group.name", "category", "category.id", "category.name"], limit: 2000 };
    if(month) query.filter = { month: { _eq: month } };
    const rows = await listItems({ ...directusArgs(session), collection: COLLECTIONS.budgets, query });
    return rows.map(row => ({
      id: row.id,
      month: row.month,
      amount: Number(row.amount) || 0,
      currency: { code: loadConfig().baseCurrency },
      category: { name: row.group?.name ? `${PAYLOAD_GROUP_PREFIX}${row.group.name}` : (row.category?.name || ""), type: "expense" }
    }));
  }
  const map = loadBudgets();
  const rows = [];

  Object.entries(map).forEach(([m, data]) => {
    if(month && m !== month) return;
    Object.entries(data || {}).forEach(([key, amount]) => {
      const isGroup = key.startsWith(GROUP_PREFIX);
      rows.push({
        id: `${m}:${key}`,
        month: m,
        amount: Number(amount) || 0,
        currency: { code: loadConfig().baseCurrency },
        category: { name: isGroup ? `${PAYLOAD_GROUP_PREFIX}${key.replace(GROUP_PREFIX, "")}` : key, type: "expense" }
      });
    });
  });

  return rows;
}

export async function upsertBudget({ month, category, amount, currency }){
  const safeMonth = String(month || "").trim();
  if(!safeMonth) throw new Error("Mes inválido");
  const safeCategory = String(category || "").trim();
  if(!safeCategory) throw new Error("Categoría inválida");

  const session = await getDirectusSession();
  if(session){
    const isGroup = safeCategory.startsWith(PAYLOAD_GROUP_PREFIX);
    const entityName = isGroup ? safeCategory.replace(PAYLOAD_GROUP_PREFIX, "") : safeCategory;
    const existing = await listItems({
      ...directusArgs(session),
      collection: COLLECTIONS.budgets,
      query: {
        limit: 1,
        fields: ["id"],
        filter: isGroup
          ? { month: { _eq: safeMonth }, group: { name: { _eq: entityName } } }
          : { month: { _eq: safeMonth }, category: { name: { _eq: entityName } } }
      }
    });
    let payload = { month: safeMonth, amount: Number(amount) || 0, group: null, category: null };
    if(isGroup){
      const groups = await listItems({ ...directusArgs(session), collection: COLLECTIONS.groups, query: { limit: 1, fields: ["id"], filter: { name: { _eq: entityName } } } });
      payload.group = groups[0]?.id || null;
    }else{
      payload.category = await resolveCategoryIdByName(session, entityName, "expense");
    }
    if(existing[0]?.id) await updateItem({ ...directusArgs(session), collection: COLLECTIONS.budgets, id: existing[0].id, data: payload });
    else await createItem({ ...directusArgs(session), collection: COLLECTIONS.budgets, data: payload });
    return { month: safeMonth, category: safeCategory, amount: Number(amount) || 0, currency };
  }

  const map = loadBudgets();
  if(!map[safeMonth]) map[safeMonth] = {};
  map[safeMonth][safeCategory] = Number(amount) || 0;
  saveBudgets(map);
  return { month: safeMonth, category: safeCategory, amount: Number(amount) || 0, currency };
}

export async function deleteBudget(id){
  const session = await getDirectusSession();
  if(session) return deleteItem({ ...directusArgs(session), collection: COLLECTIONS.budgets, id });
  const raw = String(id || "");
  const sep = raw.indexOf(":");
  if(sep < 0) return true;
  const month = raw.slice(0, sep);
  const category = raw.slice(sep + 1);

  const map = loadBudgets();
  if(map[month] && Object.prototype.hasOwnProperty.call(map[month], category)){
    delete map[month][category];
    if(Object.keys(map[month]).length === 0) delete map[month];
    saveBudgets(map);
  }
  return true;
}

export function syncBudgetMapFromRows(rows){
  return budgetRowsToLocal(rows);
}

export async function importMonthlyJson({ batchId, month, movements = [], source = "json", onProgress } = {}){
  const session = await getDirectusSession();
  if(!session) throw new Error("Import JSON requiere sesión activa en Directus");

  const safeBatchId = String(batchId || `${month || ""}:${movements.length}`).trim();
  if(!safeBatchId) throw new Error("imported_batch_id inválido");

  const existing = await listItems({
    ...directusArgs(session),
    collection: COLLECTIONS.movements,
    query: { fields: ["id"], limit: 1, filter: { imported_batch_id: { _eq: safeBatchId } } }
  });
  if(existing.length){
    return { skipped: true, reason: "batch_exists", imported_batch_id: safeBatchId, inserted: 0 };
  }

  const mappedPayload = [];
  for(const mov of movements){
    const safeType = mov.type === "income" || mov.type === "reentry" ? "income" : "expense";
    const categoryRef = String(mov.category || "").trim();
    if(!categoryRef) continue;
    const categoryId = await resolveOrCreateCategoryId(session, categoryRef, safeType);
    mappedPayload.push({
      date: mov.date,
      amount: Number(mov.amount) || 0,
      type: safeType,
      category: categoryId,
      group_snapshot: mov.group || "",
      note: mov.note || mov.notes || mov.desc || "",
      source,
      imported_batch_id: safeBatchId
    });
  }

  const invalidCategoryRow = mappedPayload.find(item => !isValidId(item.category));
  if(invalidCategoryRow){
    throw new Error("Importación inválida: se detectaron categorías sin id válido.");
  }

  const payload = mappedPayload.filter(x => x.category && x.date);

  let inserted = 0;
  try{
    for(let idx = 0; idx < payload.length; idx++){
      if(typeof onProgress === "function") onProgress({ current: idx + 1, total: payload.length });
      await createItem({ ...directusArgs(session), collection: COLLECTIONS.movements, data: payload[idx] });
      inserted += 1;
    }

    await createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.importsLog,
      data: {
        month: month || "",
        source,
        status: "ok",
        summary: { received: movements.length, inserted, imported_batch_id: safeBatchId }
      }
    });

    return { skipped: false, imported_batch_id: safeBatchId, inserted };
  }catch(err){
    await createItem({
      ...directusArgs(session),
      collection: COLLECTIONS.importsLog,
      data: {
        month: month || "",
        source,
        status: "error",
        summary: { received: movements.length, inserted, imported_batch_id: safeBatchId, error: err?.message || "Import falló" }
      }
    });
    throw err;
  }
}

export async function ensureDirectusSession(){
  try{
    const session = await ensureDirectusClientSession();
    return {
      ok: true,
      connected: Boolean(session?.connected),
      baseUrl: session?.baseUrl || "",
      user: session?.user || null,
      role: session?.role || null,
      permissions: session?.permissions || [],
      abilities: session?.abilities || {},
      access_token: session?.access_token || "",
      refresh_token: session?.refresh_token || "",
      expires: Number(session?.expires || 0)
    };
  }catch(err){
    return {
      ok: false,
      connected: false,
      baseUrl: "",
      user: null,
      role: null,
      permissions: [],
      abilities: {},
      error: err
    };
  }
}
