import { defaults } from "./constants.js";
import { mergeConfig, loadConfig, saveConfig, loadTransactions, saveTransactions, loadBudgets, saveBudgets } from "./storage.js";
import { normalizeTx } from "./utils.js";
import {
  setDirectusConfig,
  ping,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  findOneByFilter,
  upsertByUnique,
  login as directusLogin,
  ensureAuth,
  clearSession,
  getSessionStatus
} from "./directusClient.js";

const BACKEND_KEY = "gastos02_backend";
const DIRECTUS_URL_KEY = "gastos02_directus_url";
const DIRECTUS_SERVICE_EMAIL_KEY = "gastos02_directus_service_email";
const DIRECTUS_SERVICE_PASSWORD_KEY = "gastos02_directus_service_password";
const GROUP_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";

export function getBackendMode(){
  return localStorage.getItem(BACKEND_KEY) === "directus" ? "directus" : "local";
}

export function setBackendMode(mode){
  const next = mode === "directus" ? "directus" : "local";
  localStorage.setItem(BACKEND_KEY, next);
}

export function getDirectusConfig(){
  return {
    baseUrl: localStorage.getItem(DIRECTUS_URL_KEY) || "https://directus.drperez86.com",
    serviceEmail: localStorage.getItem(DIRECTUS_SERVICE_EMAIL_KEY) || "",
    servicePassword: localStorage.getItem(DIRECTUS_SERVICE_PASSWORD_KEY) || ""
  };
}

export function setDirectusSettings({ baseUrl, serviceEmail, servicePassword }){
  setDirectusConfig({ baseUrl, serviceEmail, servicePassword });
}

function isDirectus(){
  return getBackendMode() === "directus";
}

function categoryToGroupMap(categories){
  const map = {};
  for(const c of categories){
    if(c.type === "expense" && c.group?.name) map[c.name] = c.group.name;
  }
  return map;
}

function budgetRowsToLocal(rows){
  const out = {};
  for(const b of rows){
    const month = b.month;
    if(!out[month]) out[month] = {};
    const rawName = b.category?.name || "";
    const isGroup = rawName.startsWith(PAYLOAD_GROUP_PREFIX);
    const key = isGroup ? `${GROUP_PREFIX}${rawName.replace(PAYLOAD_GROUP_PREFIX, "")}` : rawName;
    if(key) out[month][key] = Number(b.amount) || 0;
  }
  return out;
}

export async function getSettings(){
  if(!isDirectus()) return loadConfig();
  try{
    const [settings] = await getItems("settings", { limit: 1, fields: ["id", "locale", "base_currency.code"] });
    if(!settings){
      await createItem("settings", { base_currency: defaults.baseCurrency, locale: defaults.locale });
    }
    const settingRow = settings || (await getItems("settings", { limit: 1, fields: ["id", "locale", "base_currency.code"] }))[0];
    const currencies = await listCurrencies();
    const cats = await getItems("categories", { fields: ["id","name","type","group.id","group.name"] });
    const groups = await getItems("expense_groups", { fields: ["id","name","description"] });

    return mergeConfig({
      baseCurrency: settingRow?.base_currency?.code || defaults.baseCurrency,
      locale: settingRow?.locale || defaults.locale,
      currencies: currencies.map(x=>x.code),
      expenseCategories: cats.filter(x=>x.type==="expense").map(x=>x.name),
      incomeCategories: cats.filter(x=>x.type==="income").map(x=>x.name),
      expenseGroups: groups.map(x=>x.name),
      expenseCategoryGroups: categoryToGroupMap(cats)
    });
  }catch(err){
    console.warn("No se pudieron cargar settings", err);
    return null;
  }
}

export async function saveSettings(payload){
  if(!isDirectus()){
    const merged = mergeConfig({ ...loadConfig(), ...payload });
    saveConfig(merged);
    return merged;
  }

  const current = await getSettings();
  const merged = mergeConfig({ ...current, ...payload });
  const [existing] = await getItems("settings", { limit: 1 });
  const body = { base_currency: merged.baseCurrency, locale: merged.locale };
  if(existing?.id) await updateItem("settings", existing.id, body);
  else await createItem("settings", body);

  return merged;
}

export async function listCurrencies(){
  if(!isDirectus()) return (loadConfig().currencies || []).map(code => ({ code }));
  return getItems("currencies", { sort: "code", fields: ["code"] });
}

export async function listGroups(){
  if(!isDirectus()) return (loadConfig().expenseGroups || []).map(name => ({ id:name, name, description:"" }));
  return getItems("expense_groups", { sort: "name", fields: ["id", "name", "description"] });
}

export async function createGroup({ name, description }){
  if(!isDirectus()){
    const cfg = loadConfig();
    if(!cfg.expenseGroups.includes(name)) cfg.expenseGroups.push(name);
    saveConfig(cfg);
    return { id: name, name, description: description || "" };
  }
  return upsertByUnique("expense_groups", "name", name, { name, description: description || "" });
}

export async function updateGroup(id, payload){
  if(!isDirectus()) return { id, ...payload };
  return updateItem("expense_groups", id, payload);
}

export async function listCategories({ type } = {}){
  if(!isDirectus()){
    const cfg = loadConfig();
    const local = [
      ...cfg.expenseCategories.map(name=>({ id:`expense:${name}`, name, type:"expense", group: cfg.expenseCategoryGroups?.[name] ? { name: cfg.expenseCategoryGroups[name], type:"group" } : null })),
      ...cfg.incomeCategories.map(name=>({ id:`income:${name}`, name, type:"income", group: null }))
    ];
    return type ? local.filter(x=>x.type===type) : local;
  }
  const filter = type ? { type: { _eq: type } } : undefined;
  return getItems("categories", { filter, sort: "name", fields:["id","name","type","group.id","group.name"] });
}

export async function createCategory({ name, type, group }){
  if(!isDirectus()){
    const cfg = loadConfig();
    const arr = type === "income" ? cfg.incomeCategories : cfg.expenseCategories;
    if(!arr.includes(name)) arr.push(name);
    if(type === "expense" && group) cfg.expenseCategoryGroups[name] = group;
    saveConfig(cfg);
    return { id: `${type}:${name}`, name, type, group: group ? { name: group } : null };
  }

  const foundByName = await findOneByFilter("categories", { name: { _eq: name } });
  let safeName = name;
  if(foundByName && foundByName.type !== type){
    safeName = `${name} (${type})`;
  }
  const groupRow = group ? await upsertByUnique("expense_groups", "name", group, { name: group, description: "" }) : null;
  return upsertByUnique("categories", "name", safeName, { name: safeName, type, group: groupRow?.id || null });
}

export async function updateCategory(id, payload){
  if(!isDirectus()) return { id, ...payload };
  return updateItem("categories", id, payload);
}

export async function deleteCategory(id){
  if(!isDirectus()) return true;
  return deleteItem("categories", id);
}

export async function listTransactions(filters = {}){
  if(!isDirectus()) return loadTransactions(loadConfig());
  const queryFilter = {};
  if(filters.type) queryFilter.type = { _eq: filters.type };
  if(filters.month) queryFilter.date = { _starts_with: filters.month };
  return getItems("transactions", {
    filter: Object.keys(queryFilter).length ? queryFilter : undefined,
    sort: "-date",
    fields: ["id","type","date","amount","currency.code","category.id","category.name","pay","vendor","desc","notes","tags"]
  }).then(rows => rows.map(x => normalizeTx({
    id: x.id,
    type: x.type,
    date: String(x.date || "").slice(0,10),
    amount: Number(x.amount),
    currency: x.currency?.code || defaults.baseCurrency,
    category: x.category?.name,
    pay: x.pay,
    vendor: x.vendor,
    desc: x.desc,
    notes: x.notes,
    tags: x.tags
  }, loadConfig())));
}

export async function createTransaction(payload){
  if(!isDirectus()){
    const cfg = loadConfig();
    const tx = loadTransactions(cfg);
    tx.push(normalizeTx(payload, cfg));
    saveTransactions(tx);
    return tx[tx.length - 1];
  }

  const importId = payload?.tags?.import_id || payload?.notes?.match(/import_id:([^\s]+)/)?.[1];
  if(importId){
    const existing = await findOneByFilter("transactions", { tags: { _contains: { import_id: importId } } });
    if(existing) return existing;
  }

  const category = payload.category
    ? await createCategory({ name: payload.category, type: payload.type || "expense" })
    : null;
  return createItem("transactions", {
    type: payload.type,
    date: payload.date,
    amount: payload.amount,
    currency: payload.currency,
    category: category?.id || null,
    vendor: payload.vendor || "",
    pay: payload.pay || "",
    desc: payload.desc || "",
    notes: payload.notes || "",
    tags: Array.isArray(payload.tags) ? payload.tags : []
  });
}

export async function updateTransaction(id, payload){
  if(!isDirectus()) return { id, ...payload };
  const category = payload.category
    ? await createCategory({ name: payload.category, type: payload.type || "expense" })
    : null;
  return updateItem("transactions", id, {
    type: payload.type,
    date: payload.date,
    amount: payload.amount,
    currency: payload.currency,
    category: category?.id || null,
    vendor: payload.vendor || "",
    pay: payload.pay || "",
    desc: payload.desc || "",
    notes: payload.notes || "",
    tags: Array.isArray(payload.tags) ? payload.tags : []
  });
}

export async function deleteTransaction(id){
  if(!isDirectus()) return true;
  return deleteItem("transactions", id);
}

export async function listBudgets({ month } = {}){
  if(!isDirectus()){
    const map = loadBudgets();
    const rows = [];
    Object.entries(map).forEach(([m, data])=>{
      if(month && m !== month) return;
      Object.entries(data || {}).forEach(([key, amount])=>{
        const isGroup = key.startsWith(GROUP_PREFIX);
        rows.push({ id: `${m}:${key}`, month: m, amount, currency: { code: loadConfig().baseCurrency }, category: { name: isGroup ? `${PAYLOAD_GROUP_PREFIX}${key.replace(GROUP_PREFIX, "")}` : key, type: "expense" } });
      });
    });
    return rows;
  }

  return getItems("budgets", {
    filter: month ? { month: { _eq: month } } : undefined,
    fields: ["id", "month", "amount", "category.id", "category.name", "category.type", "currency.code"]
  });
}

export async function upsertBudget({ month, category, amount, currency }){
  if(!isDirectus()){
    const map = loadBudgets();
    if(!map[month]) map[month] = {};
    map[month][category] = Number(amount) || 0;
    saveBudgets(map);
    return { month, category, amount, currency };
  }

  const categoryRow = await createCategory({ name: category, type: "expense" });
  const found = await findOneByFilter("budgets", { month: { _eq: month }, category: { _eq: categoryRow.id } });
  const payload = { month, category: categoryRow.id, amount: Number(amount), currency };
  if(found) return updateItem("budgets", found.id, payload);
  return createItem("budgets", payload);
}

export async function deleteBudget(id){
  if(!isDirectus()) return true;
  return deleteItem("budgets", id);
}

export async function pingDirectus(){
  return ping();
}

export async function loginDirectus(email, password){
  return directusLogin(email, password, { force: true });
}

export function logoutDirectus(){
  clearSession();
}

export function getDirectusSession(){
  return getSessionStatus();
}

export async function ensureDirectusSession(){
  if(!isDirectus()) return { connected: true, source: "local" };
  return ensureAuth();
}

export async function importLocalDataToDirectus(onProgress){
  const cfg = loadConfig();
  const tx = loadTransactions(cfg);
  const budgets = loadBudgets();

  const groups = cfg.expenseGroups || [];
  const catsExpense = cfg.expenseCategories || [];
  const catsIncome = cfg.incomeCategories || [];
  let done = 0;
  const total = cfg.currencies.length + 1 + groups.length + catsExpense.length + catsIncome.length + tx.length;

  for(const code of cfg.currencies){
    await upsertByUnique("currencies", "code", code, { code, symbol: code, decimals: 2, name: code });
    onProgress?.(++done, total, `Moneda ${code}`);
  }

  await saveSettings({ baseCurrency: cfg.baseCurrency, locale: cfg.locale });
  onProgress?.(++done, total, "Settings");

  for(const g of groups){
    await createGroup({ name: g, description: "" });
    onProgress?.(++done, total, `Grupo ${g}`);
  }

  for(const c of catsExpense){
    await createCategory({ name: c, type: "expense", group: cfg.expenseCategoryGroups?.[c] });
    onProgress?.(++done, total, `Categoría ${c}`);
  }

  for(const c of catsIncome){
    await createCategory({ name: c, type: "income" });
    onProgress?.(++done, total, `Categoría ${c}`);
  }

  for(const [month, data] of Object.entries(budgets)){
    for(const [category, amount] of Object.entries(data || {})){
      const targetCategory = category.startsWith(GROUP_PREFIX) ? `${PAYLOAD_GROUP_PREFIX}${category.replace(GROUP_PREFIX, "")}` : category;
      await upsertBudget({ month, category: targetCategory, amount, currency: cfg.baseCurrency });
    }
  }

  for(const row of tx){
    const importId = `local-${row.id}`;
    await createTransaction({ ...row, tags: { import_id: importId } });
    onProgress?.(++done, total, `Movimiento ${row.id}`);
  }

  return true;
}

export function syncBudgetMapFromRows(rows){
  return budgetRowsToLocal(rows);
}
