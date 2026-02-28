import { defaults } from "./constants.js";
import { monthISO } from "./utils.js";
import { chooseDataDirectory, getSavedDirectory, isFsAccessSupported, listMonthKeys, readJsonFile, writeJsonFile } from "./storage/fsAccess.js";

const UI_STATE_KEY = "gastos02:ui-state";
const GROUP_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";

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
  const year = parts.find(p=>p.type === "year")?.value;
  const month = parts.find(p=>p.type === "month")?.value;
  return `${year}-${month}`;
}

function validMonthKey(v){ return /^\d{4}-\d{2}$/.test(String(v || "")); }
function uniqueTrimmed(values = []){ return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))]; }
function slug(v){ return String(v || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, ""); }

function loadJsonLocal(key, fallback = null){
  try{ return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch(_err){ return fallback; }
}
function saveJsonLocal(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

function normalizeLegacyConfig(cfg = {}){
  const out = {
    ...structuredClone(defaults),
    ...(cfg || {})
  };

  // compat import schema nuevo
  if(Array.isArray(cfg?.categories) && !Array.isArray(cfg?.expenseCategories)){
    out.expenseCategories = cfg.categories.map(c => String(c?.name || "").trim()).filter(Boolean);
  }
  if(Array.isArray(cfg?.groups) && !Array.isArray(cfg?.expenseGroups)){
    out.expenseGroups = cfg.groups.map(g => String(g?.name || "").trim()).filter(Boolean);
  }

  out.baseCurrency = String(out.baseCurrency || out.currency || "ARS").toUpperCase();
  out.currencies = uniqueTrimmed(Array.isArray(out.currencies) ? out.currencies : [out.baseCurrency]);
  if(!out.currencies.includes(out.baseCurrency)) out.currencies.unshift(out.baseCurrency);
  out.locale = String(out.locale || "es-AR");

  out.expenseCategories = uniqueTrimmed(out.expenseCategories || defaults.expenseCategories);
  out.incomeCategories = uniqueTrimmed(out.incomeCategories || defaults.incomeCategories);
  out.reentryCategories = uniqueTrimmed(out.reentryCategories || defaults.reentryCategories);
  out.expenseGroups = uniqueTrimmed(out.expenseGroups || defaults.expenseGroups);

  const groupMap = out.expenseCategoryGroups && typeof out.expenseCategoryGroups === "object" ? out.expenseCategoryGroups : {};
  out.expenseCategoryGroups = Object.fromEntries(
    Object.entries(groupMap)
      .map(([k, v])=> [String(k || "").trim(), String(v || "").trim()])
      .filter(([k, v])=> k && v)
  );

  out.ratesToBase = { ...(out.ratesToBase || {}) };
  for(const c of out.currencies){
    const rate = Number(out.ratesToBase[c]);
    out.ratesToBase[c] = Number.isFinite(rate) && rate > 0 ? rate : 1;
  }
  out.ratesToBase[out.baseCurrency] = 1;

  const byMonth = out.ratesByMonth && typeof out.ratesByMonth === "object" ? out.ratesByMonth : {};
  out.ratesByMonth = {};
  for(const [monthKey, rates] of Object.entries(byMonth)){
    if(!validMonthKey(monthKey) || !rates || typeof rates !== "object") continue;
    out.ratesByMonth[monthKey] = {};
    for(const c of out.currencies){
      const r = Number(rates[c]);
      if(Number.isFinite(r) && r > 0) out.ratesByMonth[monthKey][c] = r;
    }
    out.ratesByMonth[monthKey][out.baseCurrency] = 1;
  }

  if(!out.budgets || typeof out.budgets !== "object") out.budgets = {};

  return out;
}

function toConfigFileShape(legacyCfg){
  const cfg = normalizeLegacyConfig(legacyCfg);
  const groupsByName = Object.fromEntries((cfg.expenseGroups || []).map(name => [name, { id: slug(name), name }]));
  return {
    version: 1,
    currency: cfg.baseCurrency,
    categories: (cfg.expenseCategories || []).map(name => ({
      id: slug(name),
      name,
      groupId: cfg.expenseCategoryGroups?.[name] ? slug(cfg.expenseCategoryGroups[name]) : null
    })),
    groups: (cfg.expenseGroups || []).map(name => groupsByName[name]),
    payment_methods: (cfg.paymentMethods || ["Tarjeta", "Débito", "Efectivo", "Transferencia", "Reintegro", "Cripto", "Otro"]).map(name=> ({ id: slug(name), name })),
    tags: cfg.tags || [],
    ui: { ...(cfg.ui || {}), defaultView: "month" },

    // extras para mantener compatibilidad de UI actual
    baseCurrency: cfg.baseCurrency,
    currencies: cfg.currencies,
    locale: cfg.locale,
    expenseCategories: cfg.expenseCategories,
    incomeCategories: cfg.incomeCategories,
    reentryCategories: cfg.reentryCategories,
    expenseGroups: cfg.expenseGroups,
    expenseCategoryGroups: cfg.expenseCategoryGroups,
    ratesToBase: cfg.ratesToBase,
    ratesByMonth: cfg.ratesByMonth,
    budgets: cfg.budgets
  };
}


function mergeConfigValues(baseCfg = {}, incoming = {}){
  const base = normalizeLegacyConfig(baseCfg);
  const inc = incoming || {};

  return {
    ...base,
    ...inc,
    baseCurrency: inc.baseCurrency || inc.currency || base.baseCurrency,
    locale: inc.locale || base.locale,
    currencies: uniqueTrimmed([...(base.currencies || []), ...((inc.currencies || []).map(String))]),
    expenseCategories: uniqueTrimmed([...(base.expenseCategories || []), ...((inc.expenseCategories || []).map(String))]),
    incomeCategories: uniqueTrimmed([...(base.incomeCategories || []), ...((inc.incomeCategories || []).map(String))]),
    reentryCategories: uniqueTrimmed([...(base.reentryCategories || []), ...((inc.reentryCategories || []).map(String))]),
    expenseGroups: uniqueTrimmed([...(base.expenseGroups || []), ...((inc.expenseGroups || []).map(String))]),
    expenseCategoryGroups: { ...(base.expenseCategoryGroups || {}), ...(inc.expenseCategoryGroups || {}) },
    ratesToBase: { ...(base.ratesToBase || {}), ...(inc.ratesToBase || {}) },
    ratesByMonth: { ...(base.ratesByMonth || {}), ...(inc.ratesByMonth || {}) },
    budgets: { ...(base.budgets || {}), ...(inc.budgets || {}) }
  };
}

function emptyMonth(monthKey){
  return { version: 1, month: monthKey, currency: runtime.config?.baseCurrency || "ARS", movements: [] };
}

async function ensureMonth(monthKey){
  if(runtime.monthData.has(monthKey)) return runtime.monthData.get(monthKey);
  if(!runtime.dirHandle){
    const local = loadJsonLocal(`gastos02:${monthKey}`) || emptyMonth(monthKey);
    runtime.monthData.set(monthKey, local);
    return local;
  }
  const data = await readJsonFile(runtime.dirHandle, `${monthKey}.json`) || emptyMonth(monthKey);
  await writeJsonFile(runtime.dirHandle, `${monthKey}.json`, data);
  runtime.monthData.set(monthKey, data);
  return data;
}

async function saveMonthObj(monthKey, data){
  runtime.monthData.set(monthKey, data);
  if(runtime.dirHandle) await writeJsonFile(runtime.dirHandle, `${monthKey}.json`, data);
  else saveJsonLocal(`gastos02:${monthKey}`, data);
}

async function persistCurrentConfig(){
  const filePayload = toConfigFileShape(runtime.config || defaults);
  if(runtime.dirHandle) await writeJsonFile(runtime.dirHandle, "config.json", filePayload);
  else saveJsonLocal("gastos02:config", filePayload);
}

export function getBackendMode(){ return runtime.mode; }
export function setBackendMode(){ return runtime.mode; }

export function getUiState(){
  const raw = loadJsonLocal(UI_STATE_KEY, {});
  return {
    lastActiveMonth: validMonthKey(raw?.lastActiveMonth) ? raw.lastActiveMonth : null,
    compareEnabled: Boolean(raw?.compareEnabled),
    compareMonths: Array.isArray(raw?.compareMonths) ? raw.compareMonths.filter(validMonthKey) : []
  };
}

export function saveUiState(partial = {}){
  const current = getUiState();
  const next = {
    ...current,
    ...partial,
    compareMonths: Array.isArray(partial.compareMonths) ? partial.compareMonths.filter(validMonthKey) : current.compareMonths,
    compareEnabled: partial.compareEnabled ?? current.compareEnabled
  };
  saveJsonLocal(UI_STATE_KEY, next);
  return next;
}

export async function connectDataFolder(){
  if(!isFsAccessSupported()) throw new Error("Tu navegador no soporta File System Access API.");
  runtime.dirHandle = await chooseDataDirectory();
  runtime.mode = "local-folder";
  runtime.config = null;
  runtime.monthData.clear();
  return true;
}

export async function bootstrapStorage(){
  runtime.dirHandle = isFsAccessSupported() ? await getSavedDirectory() : null;
  runtime.mode = runtime.dirHandle ? "local-folder" : "manual";
  runtime.config = await getConfig();
  return {
    mode: runtime.mode,
    connected: Boolean(runtime.dirHandle),
    fsSupported: isFsAccessSupported()
  };
}

export async function getConfig(){
  if(runtime.config) return runtime.config;
  let cfg = null;
  if(runtime.dirHandle) cfg = await readJsonFile(runtime.dirHandle, "config.json");
  else cfg = loadJsonLocal("gastos02:config");

  runtime.config = normalizeLegacyConfig(cfg || defaults);
  await persistCurrentConfig();
  return runtime.config;
}

export async function saveConfig(payload){
  const current = runtime.config || await getConfig();
  runtime.config = normalizeLegacyConfig(mergeConfigValues(current, payload || {}));
  await persistCurrentConfig();
  return runtime.config;
}

export async function loadCurrentMonth(preferredMonth){
  const defaultMonth = monthInBuenosAires();
  const monthKey = validMonthKey(preferredMonth) ? preferredMonth : defaultMonth;
  runtime.currentMonth = monthKey;
  runtime.loadedMonths = new Set([monthKey]);
  await ensureMonth(monthKey);
  saveUiState({ lastActiveMonth: monthKey });
  return monthKey;
}

export async function setActiveMonth(monthKey){
  if(!validMonthKey(monthKey)) throw new Error("Mes inválido");
  return loadCurrentMonth(monthKey);
}

export async function getMonth(monthKey){ return ensureMonth(monthKey); }
export async function saveMonth(monthKey, payload){ return saveMonthObj(monthKey, payload); }

export async function listAvailableMonths(){
  if(runtime.dirHandle) return listMonthKeys(runtime.dirHandle);
  return Object.keys(localStorage)
    .map(k=>k.match(/^gastos02:(\d{4}-\d{2})$/)?.[1])
    .filter(Boolean)
    .sort();
}

export async function loadComparisonMonths(monthKeys = []){
  const sanitized = monthKeys.filter(validMonthKey).filter(m=>m !== runtime.currentMonth);
  runtime.loadedMonths = new Set([runtime.currentMonth, ...sanitized]);
  for(const m of runtime.loadedMonths) await ensureMonth(m);
  saveUiState({ compareEnabled: sanitized.length > 0, compareMonths: sanitized });
  return [...runtime.loadedMonths];
}

function txFromMovement(mov, month){
  return {
    id: mov.id,
    type: mov.type,
    date: mov.date,
    amount: mov.amount,
    currency: mov.currency || runtime.config.baseCurrency,
    category: mov.categoryId,
    pay: mov.paymentMethodId || "",
    vendor: mov.vendor || "",
    tags: mov.tags || [],
    notes: mov.note || "",
    desc: mov.note || "",
    group: mov.groupId || "",
    fxRate: Number(mov.exchangeRate || mov.fxRate) || null,
    includeInNet: mov.includeInNet !== false,
    month
  };
}

function movementFromTx(tx){
  return {
    id: tx.id || crypto.randomUUID(),
    date: tx.date,
    type: tx.type === "income" ? "income" : "expense",
    amount: Math.round(Number(tx.amount) || 0),
    categoryId: tx.categoryId || tx.category || "otros",
    groupId: tx.group || runtime.config.expenseCategoryGroups?.[tx.category] || null,
    currency: tx.currency || runtime.config.baseCurrency,
    paymentMethodId: tx.pay || null,
    vendor: tx.vendor || "",
    note: tx.notes || tx.desc || "",
    tags: tx.tags || [],
    exchangeRate: Number(tx.fxRate) > 0 ? Number(tx.fxRate) : null,
    includeInNet: tx.includeInNet !== false
  };
}

export async function getSettings(){ return normalizeLegacyConfig(await getConfig()); }

export async function saveSettings(payload){
  const current = runtime.config || await getConfig();
  const merged = normalizeLegacyConfig(mergeConfigValues(current, payload || {}));
  runtime.config = merged;
  await persistCurrentConfig();
  return merged;
}

export async function listCurrencies(){ return (runtime.config?.currencies || (await getConfig()).currencies).map(code => ({ code })); }

export async function listGroups(){
  const cfg = await getConfig();
  return (cfg.expenseGroups || []).map(name => ({ id: name, name, description: "" }));
}

export async function createGroup({ name } = {}){
  const safeName = String(name || "").trim();
  if(!safeName) throw new Error("Nombre de grupo inválido");
  const cfg = await getConfig();
  cfg.expenseGroups = uniqueTrimmed([...(cfg.expenseGroups || []), safeName]);
  await persistCurrentConfig();
  return { id: safeName, name: safeName };
}

export async function updateGroup(id, payload = {}){
  const oldName = String(id || "").trim();
  const newName = String(payload.name || oldName).trim();
  if(!oldName || !newName) throw new Error("Nombre de grupo inválido");

  const cfg = await getConfig();
  cfg.expenseGroups = (cfg.expenseGroups || []).map(g => g === oldName ? newName : g);
  cfg.expenseGroups = uniqueTrimmed(cfg.expenseGroups);

  const map = { ...(cfg.expenseCategoryGroups || {}) };
  Object.keys(map).forEach(cat => { if(map[cat] === oldName) map[cat] = newName; });
  cfg.expenseCategoryGroups = map;

  Object.keys(cfg.budgets || {}).forEach(month => {
    const sourceKey = `${GROUP_PREFIX}${oldName}`;
    const targetKey = `${GROUP_PREFIX}${newName}`;
    if(Object.prototype.hasOwnProperty.call(cfg.budgets[month] || {}, sourceKey)){
      cfg.budgets[month][targetKey] = Number(cfg.budgets[month][sourceKey]) || 0;
      delete cfg.budgets[month][sourceKey];
    }
  });

  await persistCurrentConfig();
  return { id: newName, name: newName };
}

export async function listCategories({ type } = {}){
  const cfg = await getConfig();
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
  const safeType = type === "income" ? "income" : type === "reentry" ? "reentry" : "expense";
  if(!safeName) throw new Error("Nombre de categoría inválido");

  const cfg = await getConfig();
  if(safeType === "income") cfg.incomeCategories = uniqueTrimmed([...(cfg.incomeCategories || []), safeName]);
  else if(safeType === "reentry") cfg.reentryCategories = uniqueTrimmed([...(cfg.reentryCategories || []), safeName]);
  else cfg.expenseCategories = uniqueTrimmed([...(cfg.expenseCategories || []), safeName]);

  if(safeType === "expense"){
    const groupName = String(group?.name || group || "").trim();
    if(groupName) cfg.expenseCategoryGroups[safeName] = groupName;
  }

  await persistCurrentConfig();
  return { id: `${safeType}:${safeName}`, name: safeName, type: safeType };
}

export async function updateCategory(id, payload = {}){
  const [rawType, ...rest] = String(id || "").split(":");
  const currentType = rawType || "expense";
  const currentName = rest.join(":").trim();
  const nextType = payload.type || currentType;
  const nextName = String(payload.name || currentName).trim();
  if(!currentName || !nextName) throw new Error("Categoría inválida");

  const cfg = await getConfig();
  const removeFrom = (arr)=> arr.filter(x => x !== currentName);
  cfg.expenseCategories = removeFrom(cfg.expenseCategories || []);
  cfg.incomeCategories = removeFrom(cfg.incomeCategories || []);
  cfg.reentryCategories = removeFrom(cfg.reentryCategories || []);

  if(nextType === "income") cfg.incomeCategories = uniqueTrimmed([...(cfg.incomeCategories || []), nextName]);
  else if(nextType === "reentry") cfg.reentryCategories = uniqueTrimmed([...(cfg.reentryCategories || []), nextName]);
  else cfg.expenseCategories = uniqueTrimmed([...(cfg.expenseCategories || []), nextName]);

  const groupName = String(payload.group?.name || payload.group || cfg.expenseCategoryGroups?.[currentName] || "").trim();
  delete cfg.expenseCategoryGroups[currentName];
  if(nextType === "expense" && groupName) cfg.expenseCategoryGroups[nextName] = groupName;

  await persistCurrentConfig();
  return { id: `${nextType}:${nextName}`, name: nextName, type: nextType };
}

export async function deleteCategory(id){
  const [rawType, ...rest] = String(id || "").split(":");
  const type = rawType || "expense";
  const name = rest.join(":").trim() || String(id || "").trim();

  const cfg = await getConfig();
  if(type === "income") cfg.incomeCategories = (cfg.incomeCategories || []).filter(x => x !== name);
  else if(type === "reentry") cfg.reentryCategories = (cfg.reentryCategories || []).filter(x => x !== name);
  else cfg.expenseCategories = (cfg.expenseCategories || []).filter(x => x !== name);

  delete cfg.expenseCategoryGroups[name];

  Object.keys(cfg.budgets || {}).forEach(m => {
    delete cfg.budgets[m]?.[name];
  });

  await persistCurrentConfig();
  return true;
}

export async function listTransactions(){
  const out = [];
  for(const m of runtime.loadedMonths){
    const data = await ensureMonth(m);
    out.push(...(data.movements || []).map(x=> txFromMovement(x, m)));
  }
  return out.sort((a,b)=> a.date < b.date ? 1 : -1);
}

export async function createTransaction(tx){
  const monthKey = String(tx.date || monthISO()).slice(0, 7);
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
    if(next.length !== data.movements.length){
      data.movements = next;
      await saveMonthObj(m, data);
      return true;
    }
  }
  return false;
}

export async function listBudgets({ month } = {}){
  const cfg = await getConfig();
  const map = cfg.budgets || {};
  const rows = [];

  Object.entries(map).forEach(([m, data]) => {
    if(month && m !== month) return;
    Object.entries(data || {}).forEach(([key, amount]) => {
      const isGroup = key.startsWith(GROUP_PREFIX);
      rows.push({
        id: `${m}:${key}`,
        month: m,
        amount: Number(amount) || 0,
        currency: { code: cfg.baseCurrency },
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

  const cfg = await getConfig();
  if(!cfg.budgets[safeMonth]) cfg.budgets[safeMonth] = {};
  const normalizedKey = safeCategory.startsWith(PAYLOAD_GROUP_PREFIX)
    ? `${GROUP_PREFIX}${safeCategory.replace(PAYLOAD_GROUP_PREFIX, "")}`
    : safeCategory;

  cfg.budgets[safeMonth][normalizedKey] = Number(amount) || 0;
  await persistCurrentConfig();
  return { month: safeMonth, category: normalizedKey, amount: Number(amount) || 0, currency };
}

export async function deleteBudget(id){
  const raw = String(id || "");
  const sep = raw.indexOf(":");
  if(sep < 0) return true;
  const month = raw.slice(0, sep);
  const category = raw.slice(sep + 1);

  const cfg = await getConfig();
  if(cfg.budgets[month] && Object.prototype.hasOwnProperty.call(cfg.budgets[month], category)){
    delete cfg.budgets[month][category];
    if(Object.keys(cfg.budgets[month]).length === 0) delete cfg.budgets[month];
    await persistCurrentConfig();
  }
  return true;
}

export function syncBudgetMapFromRows(rows = []){
  const out = {};
  for(const b of rows || []){
    const m = String(b.month || "").trim();
    if(!m) continue;
    if(!out[m]) out[m] = {};

    const rawName = String(b.category?.name || "");
    const isGroup = rawName.startsWith(PAYLOAD_GROUP_PREFIX);
    const key = isGroup ? `${GROUP_PREFIX}${rawName.replace(PAYLOAD_GROUP_PREFIX, "")}` : rawName;
    if(key) out[m][key] = Number(b.amount) || 0;
  }
  return out;
}

export async function importMonthlyJson(payload){
  const data = emptyMonth(payload.month);
  data.movements = (payload.movements || []).map(m=> ({
    id: crypto.randomUUID(),
    date: m.date,
    type: m.type === "income" ? "income" : "expense",
    amount: Math.round(Number(m.amount) || 0),
    categoryId: m.categoryId || m.category || "otros",
    groupId: m.groupId || m.group || null,
    currency: m.currency || payload.currency || runtime.config?.baseCurrency || "ARS",
    paymentMethodId: m.paymentMethodId || null,
    vendor: m.vendor || "",
    note: m.note || "",
    tags: m.tags || []
  }));
  await saveMonthObj(payload.month, data);
}
