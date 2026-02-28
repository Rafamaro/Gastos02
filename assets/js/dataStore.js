import { defaults } from "./constants.js";
import { monthISO } from "./utils.js";
import { chooseDataDirectory, getSavedDirectory, isFsAccessSupported, listMonthKeys, readJsonFile, writeJsonFile } from "./storage/fsAccess.js";

const runtime = {
  mode: "manual",
  dirHandle: null,
  config: null,
  loadedMonths: new Set(),
  monthData: new Map(),
  currentMonth: null
};

function monthInBuenosAires(){
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p=>p.type === "year")?.value;
  const m = parts.find(p=>p.type === "month")?.value;
  return `${y}-${m}`;
}

function toLegacyConfig(cfg){
  const expenseCategories = cfg.categories.map(c=> c.name);
  const expenseCategoryGroups = Object.fromEntries(cfg.categories.filter(c=>c.groupId).map(c=> [c.name, cfg.groups.find(g=>g.id===c.groupId)?.name || c.groupId]));
  return {
    ...cfg,
    baseCurrency: cfg.currency,
    currencies: [cfg.currency],
    locale: "es-AR",
    expenseCategories,
    incomeCategories: ["Ingresos"],
    reentryCategories: ["Reintegro"],
    expenseGroups: cfg.groups.map(g=> g.name),
    expenseCategoryGroups
  };
}

function fromLegacyConfig(cfg){
  const groups = (cfg.expenseGroups || []).map(name=> ({ id: slug(name), name }));
  return {
    version: 1,
    currency: cfg.baseCurrency || "ARS",
    groups,
    categories: (cfg.expenseCategories || []).map(name => ({ id: slug(name), name, groupId: slug(cfg.expenseCategoryGroups?.[name] || "") || null })),
    payment_methods: (cfg.paymentMethods || ["Tarjeta", "Efectivo"]).map(name=> ({ id: slug(name), name })),
    tags: [],
    ui: { defaultView: "month" }
  };
}

function slug(v){ return String(v || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, ""); }

function emptyMonth(monthKey){
  return { version: 1, month: monthKey, currency: runtime.config?.currency || "ARS", movements: [] };
}

async function ensureMonth(monthKey){
  if(runtime.monthData.has(monthKey)) return runtime.monthData.get(monthKey);
  if(!runtime.dirHandle){
    const local = JSON.parse(localStorage.getItem(`gastos02:${monthKey}`) || "null") || emptyMonth(monthKey);
    runtime.monthData.set(monthKey, local);
    return local;
  }
  const file = `${monthKey}.json`;
  const data = await readJsonFile(runtime.dirHandle, file) || emptyMonth(monthKey);
  await writeJsonFile(runtime.dirHandle, file, data);
  runtime.monthData.set(monthKey, data);
  return data;
}

async function saveMonthObj(monthKey, data){
  runtime.monthData.set(monthKey, data);
  if(runtime.dirHandle) await writeJsonFile(runtime.dirHandle, `${monthKey}.json`, data);
  else localStorage.setItem(`gastos02:${monthKey}`, JSON.stringify(data));
}

export function getBackendMode(){ return runtime.mode; }
export function setBackendMode(){ return runtime.mode; }

export async function connectDataFolder(){
  if(!isFsAccessSupported()) throw new Error("Tu navegador no soporta File System Access API.");
  runtime.dirHandle = await chooseDataDirectory();
  runtime.mode = "local-folder";
  return true;
}

export async function bootstrapStorage(){
  runtime.dirHandle = isFsAccessSupported() ? await getSavedDirectory() : null;
  runtime.mode = runtime.dirHandle ? "local-folder" : "manual";
  runtime.config = await getConfig();
  return { mode: runtime.mode, connected: Boolean(runtime.dirHandle), fsSupported: isFsAccessSupported() };
}

export async function getConfig(){
  if(runtime.config) return runtime.config;
  let cfg = null;
  if(runtime.dirHandle) cfg = await readJsonFile(runtime.dirHandle, "config.json");
  else cfg = JSON.parse(localStorage.getItem("gastos02:config") || "null");
  if(!cfg){
    cfg = structuredClone(defaults);
    await saveConfig(cfg);
  }
  runtime.config = cfg;
  return cfg;
}

export async function saveConfig(payload){
  const cfg = payload.categories ? payload : fromLegacyConfig(payload);
  runtime.config = cfg;
  if(runtime.dirHandle) await writeJsonFile(runtime.dirHandle, "config.json", cfg);
  else localStorage.setItem("gastos02:config", JSON.stringify(cfg));
  return toLegacyConfig(cfg);
}

export async function loadCurrentMonth(){
  const monthKey = monthInBuenosAires();
  runtime.currentMonth = monthKey;
  runtime.loadedMonths = new Set([monthKey]);
  await ensureMonth(monthKey);
  return monthKey;
}

export async function getMonth(monthKey){ return ensureMonth(monthKey); }
export async function saveMonth(monthKey, payload){ return saveMonthObj(monthKey, payload); }

export async function listAvailableMonths(){
  if(runtime.dirHandle) return listMonthKeys(runtime.dirHandle);
  return Object.keys(localStorage).map(k=>k.match(/^gastos02:(\d{4}-\d{2})$/)?.[1]).filter(Boolean).sort();
}

export async function loadComparisonMonths(monthKeys = []){
  for(const m of monthKeys) if(m !== runtime.currentMonth) runtime.loadedMonths.add(m);
  for(const m of runtime.loadedMonths) await ensureMonth(m);
  return [...runtime.loadedMonths];
}

function txFromMovement(mov, month){
  return { id: mov.id, type: mov.type, date: mov.date, amount: mov.amount, currency: runtime.config.currency, category: mov.categoryId, pay: mov.paymentMethodId || "", tags: mov.tags || [], notes: mov.note || "", desc: mov.note || "", group: mov.groupId || "", month };
}
function movementFromTx(tx){
  return { id: tx.id || crypto.randomUUID(), date: tx.date, type: tx.type === "income" ? "income" : "expense", amount: Math.round(Number(tx.amount) || 0), categoryId: tx.category || "otros", groupId: tx.group || null, paymentMethodId: tx.pay || null, note: tx.notes || tx.desc || "", tags: tx.tags || [] };
}

export async function getSettings(){ return toLegacyConfig(await getConfig()); }
export async function saveSettings(payload){ return saveConfig(payload); }
export async function listCurrencies(){ return [{ code: (await getConfig()).currency }]; }
export async function listGroups(){ const cfg = await getConfig(); return cfg.groups.map(g=> ({ id:g.id, name:g.name })); }
export async function createGroup({ name }){ const cfg = await getConfig(); cfg.groups.push({ id: slug(name), name }); await saveConfig(cfg); return { id: slug(name), name }; }
export async function updateGroup(id, payload){ const cfg = await getConfig(); const g = cfg.groups.find(x=>x.id===id || x.name===id); if(g) g.name = payload.name || g.name; await saveConfig(cfg); return g; }
export async function listCategories(){ const cfg = await getConfig(); return cfg.categories.map(c=> ({ id:c.id, name:c.name, type:"expense", group: c.groupId ? { id:c.groupId, name:c.groupId } : null })); }
export async function createCategory({ name, group }){ const cfg = await getConfig(); const c = { id: slug(name), name, groupId: group?.id || slug(group) || null }; cfg.categories.push(c); await saveConfig(cfg); return c; }
export async function updateCategory(id, payload){ const cfg = await getConfig(); const c = cfg.categories.find(x=>x.id===id || x.name===id); if(c){ c.name = payload.name || c.name; c.groupId = payload.group?.id || slug(payload.group || c.groupId || "") || null; } await saveConfig(cfg); return c; }
export async function deleteCategory(id){ const cfg = await getConfig(); cfg.categories = cfg.categories.filter(c=> c.id !== id && c.name !== id); await saveConfig(cfg); return true; }

export async function listTransactions(){
  const out = [];
  for(const m of runtime.loadedMonths){
    const data = await ensureMonth(m);
    out.push(...(data.movements || []).map(x=> txFromMovement(x, m)));
  }
  return out.sort((a,b)=> a.date < b.date ? 1 : -1);
}

export async function createTransaction(tx){
  const monthKey = String(tx.date || monthISO()).slice(0,7);
  const data = await ensureMonth(monthKey);
  data.movements.push(movementFromTx(tx));
  await saveMonthObj(monthKey, data);
  return tx;
}

export async function updateTransaction(id, patch){
  const months = await listAvailableMonths();
  for(const m of months){
    const data = await ensureMonth(m);
    const idx = data.movements.findIndex(x=> String(x.id) === String(id));
    if(idx >= 0){
      data.movements[idx] = { ...data.movements[idx], ...movementFromTx({ ...txFromMovement(data.movements[idx], m), ...patch, id }) };
      await saveMonthObj(m, data);
      return data.movements[idx];
    }
  }
  return null;
}

export const updateMovement = updateTransaction;

export async function deleteTransaction(id){ return deleteMovement(id); }
export async function deleteMovement(id){
  const months = await listAvailableMonths();
  for(const m of months){
    const data = await ensureMonth(m);
    const next = data.movements.filter(x=> String(x.id) !== String(id));
    if(next.length !== data.movements.length){ data.movements = next; await saveMonthObj(m, data); return true; }
  }
  return false;
}

export async function listBudgets(){ return []; }
export async function upsertBudget(){ return null; }
export async function deleteBudget(){ return null; }
export function syncBudgetMapFromRows(){ return {}; }

export async function importMonthlyJson(payload){
  const data = emptyMonth(payload.month);
  data.movements = (payload.movements || []).map(m=> ({
    id: crypto.randomUUID(),
    date: m.date,
    type: m.type === "income" ? "income" : "expense",
    amount: Math.round(Number(m.amount) || 0),
    categoryId: m.category || "otros",
    groupId: m.group || null,
    paymentMethodId: m.paymentMethodId || null,
    note: m.note || "",
    tags: m.tags || []
  }));
  await saveMonthObj(payload.month, data);
}

