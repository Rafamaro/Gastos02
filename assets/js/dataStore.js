import { defaults } from "./constants.js";
import { mergeConfig, loadConfig, saveConfig, loadTransactions, saveTransactions, loadBudgets, saveBudgets } from "./storage.js";
import { normalizeTx } from "./utils.js";
import { ensureSession as ensureDirectusClientSession } from "./directusClient.js";

const GROUP_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";

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
  return mergeConfig(loadConfig());
}

export async function saveSettings(payload){
  const merged = mergeConfig({ ...loadConfig(), ...(payload || {}) });
  merged.expenseCategories = unique(merged.expenseCategories);
  merged.incomeCategories = unique(merged.incomeCategories);
  merged.expenseGroups = unique(merged.expenseGroups);
  saveConfig(merged);
  return merged;
}

export async function listCurrencies(){
  return (loadConfig().currencies || []).map(code => ({ code }));
}

export async function listGroups(){
  return (loadConfig().expenseGroups || []).map(name => ({ id: name, name, description: "" }));
}

export async function createGroup({ name, description } = {}){
  const safeName = String(name || "").trim();
  if(!safeName) throw new Error("Nombre de grupo inválido");
  const cfg = loadConfig();
  cfg.expenseGroups = unique([...(cfg.expenseGroups || []), safeName]);
  saveConfig(cfg);
  return { id: safeName, name: safeName, description: description || "" };
}

export async function updateGroup(id, payload = {}){
  const oldName = String(id || "").trim();
  const newName = String(payload.name || oldName).trim();
  if(!oldName || !newName) throw new Error("Nombre de grupo inválido");

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
  const cfg = loadConfig();
  const local = [
    ...(cfg.expenseCategories || []).map(name => ({
      id: `expense:${name}`,
      name,
      type: "expense",
      group: cfg.expenseCategoryGroups?.[name] ? { name: cfg.expenseCategoryGroups[name], type: "group" } : null
    })),
    ...(cfg.incomeCategories || []).map(name => ({ id: `income:${name}`, name, type: "income", group: null }))
  ];
  return type ? local.filter(x => x.type === type) : local;
}

export async function createCategory({ name, type, group } = {}){
  const safeName = String(name || "").trim();
  const safeType = type === "income" ? "income" : "expense";
  if(!safeName) throw new Error("Nombre de categoría inválido");

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
  return loadTransactions(loadConfig());
}

export async function createTransaction(payload){
  const cfg = loadConfig();
  const tx = loadTransactions(cfg);
  const normalized = normalizeTx(payload, cfg);
  tx.push(normalized);
  saveTransactions(tx);
  return normalized;
}

export async function updateTransaction(id, payload){
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
  const cfg = loadConfig();
  const tx = loadTransactions(cfg).filter(x => x.id !== id);
  saveTransactions(tx);
  return true;
}

export async function listBudgets({ month } = {}){
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

  const map = loadBudgets();
  if(!map[safeMonth]) map[safeMonth] = {};
  map[safeMonth][safeCategory] = Number(amount) || 0;
  saveBudgets(map);
  return { month: safeMonth, category: safeCategory, amount: Number(amount) || 0, currency };
}

export async function deleteBudget(id){
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
