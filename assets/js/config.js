import { el, fillSelect, monthISO, escapeHTML, toast } from "./utils.js";
import { saveSettings, createGroup, createCategory, listBudgets, upsertBudget, syncBudgetMapFromRows } from "./dataStore.js";
import {
  ping,
  login,
  logout,
  getMe,
  getMyPermissions,
  loadSession,
  saveSession,
  clearSession
} from "./directusClient.js";

const GROUP_BUDGET_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";
const DEFAULT_DX_URL = "https://directus.drperez86.com";

function buildAbilitiesFromPermissions(permissions = []){
  const out = {};
  for(const perm of permissions){
    const collection = String(perm?.collection || "").trim() || "*";
    const action = String(perm?.action || "").trim();
    if(!out[collection]) out[collection] = { read: false, create: false, update: false, delete: false };
    if(action === "read" || action === "create" || action === "update" || action === "delete") out[collection][action] = true;
  }
  return out;
}

function groupBudgetKey(group){ return `${GROUP_BUDGET_PREFIX}${group}`; }

function summarizePermissions(permissions = []){
  if(!permissions.length) return "Sin permisos cargados.";
  return permissions
    .slice(0, 20)
    .map(p => `• ${p.collection || "*"} → ${p.action}`)
    .join("\n");
}

function syncDirectusState(state, partial = {}){
  state.directus = {
    connected: Boolean(partial.connected),
    baseUrl: partial.baseUrl || state.directus?.baseUrl || DEFAULT_DX_URL,
    user: partial.user || null,
    role: partial.role || null,
    permissions: partial.permissions || [],
    abilities: partial.abilities || {},
    access_token: partial.access_token || "",
    refresh_token: partial.refresh_token || "",
    expires: Number(partial.expires || 0),
    lastError: partial.lastError || null
  };
  state.bus.emit("directus:changed", state.directus);
}

function currentDirectusCredentials(){
  return {
    baseUrl: (el("dxUrl")?.value || "").trim() || DEFAULT_DX_URL,
    email: (el("dxEmail")?.value || "").trim(),
    password: el("dxPass")?.value || "",
    otp: (el("dxOtp")?.value || "").trim()
  };
}

async function fetchDirectusProfile(baseUrl, access_token){
  const [user, permissions] = await Promise.all([
    getMe({ baseUrl, access_token }),
    getMyPermissions({ baseUrl, access_token })
  ]);
  return {
    user,
    role: user?.role ? { id: user.role.id || null, name: user.role.name || "Sin rol" } : null,
    permissions,
    abilities: buildAbilitiesFromPermissions(permissions)
  };
}

export function initConfig(state){
  state.bus.on("config:refresh", ()=>{ renderConfigPickers(state); renderRates(state); renderCategoryGrouping(state); renderBudgetTable(state); renderDirectusCard(state); });
  state.bus.on("directus:changed", ()=> renderDirectusCard(state));

  el("btnSaveConfig")?.addEventListener("click", ()=> saveConfigFromUI(state));
  el("btnResetConfig")?.addEventListener("click", ()=> location.reload());

  el("btnLoadBudgets")?.addEventListener("click", ()=> renderBudgetTable(state));
  el("btnSaveBudgets")?.addEventListener("click", ()=> saveBudgetsFromUI(state));
  el("budgetMonth")?.addEventListener("change", ()=> renderBudgetTable(state));
  el("budgetMode")?.addEventListener("change", ()=> renderBudgetTable(state));

  el("btnDxPing")?.addEventListener("click", async ()=>{
    const { baseUrl } = currentDirectusCredentials();
    try{
      await ping(baseUrl);
      toast("Ping Directus OK ✅");
      el("dxStatus").textContent = `Conexión API OK (${baseUrl})`;
    }catch(err){
      toast(err.userMessage || "Ping Directus falló", "danger");
      el("dxStatus").textContent = "ERROR de conexión";
    }
  });

  el("btnDxLogin")?.addEventListener("click", async ()=>{
    const { baseUrl, email, password, otp } = currentDirectusCredentials();
    try{
      const session = await login({ baseUrl, email, password, otp });
      const profile = await fetchDirectusProfile(session.baseUrl, session.access_token);
      const fullSession = { ...session, ...profile, connected: true };
      saveSession(fullSession);
      syncDirectusState(state, fullSession);
      toast("Conectado a Directus ✅");
    }catch(err){
      clearSession();
      syncDirectusState(state, { connected: false, baseUrl, lastError: err });
      toast(err.userMessage || "No se pudo conectar a Directus", "danger");
    }
  });

  el("btnDxLogout")?.addEventListener("click", async ()=>{
    const stored = loadSession();
    const baseUrl = (el("dxUrl")?.value || stored?.baseUrl || state.directus?.baseUrl || DEFAULT_DX_URL).trim();
    try{
      if(stored?.refresh_token){
        await logout({ baseUrl, refresh_token: stored.refresh_token });
      }
    }catch(err){
      toast(err.userMessage || "No se pudo cerrar sesión en Directus", "warn");
    }finally{
      clearSession();
      syncDirectusState(state, { connected: false, baseUrl });
      toast("Sesión de Directus cerrada");
    }
  });

  el("btnDxReloadPerms")?.addEventListener("click", async ()=>{
    const stored = loadSession();
    const token = stored?.access_token || state.directus?.access_token;
    const baseUrl = stored?.baseUrl || state.directus?.baseUrl || DEFAULT_DX_URL;
    if(!token){
      toast("No hay sesión activa para recargar permisos", "warn");
      return;
    }

    try{
      const profile = await fetchDirectusProfile(baseUrl, token);
      const merged = {
        ...state.directus,
        ...stored,
        baseUrl,
        access_token: token,
        ...profile,
        connected: true
      };
      saveSession(merged);
      syncDirectusState(state, merged);
      toast("Permisos recargados ✅");
    }catch(err){
      clearSession();
      syncDirectusState(state, { connected: false, baseUrl, lastError: err });
      toast(err.userMessage || "No se pudieron recargar permisos", "danger");
    }
  });
}

export function renderDirectusCard(state){
  const dx = state.directus || { connected: false, permissions: [] };
  if(el("dxUrl") && !el("dxUrl").value) el("dxUrl").value = dx.baseUrl || DEFAULT_DX_URL;
  if(el("dxEmail") && dx.user?.email) el("dxEmail").value = dx.user.email;

  el("dxStatus").textContent = dx.connected
    ? `Conectado como ${dx.user?.email || "(sin email)"}`
    : "Desconectado";
  el("dxRole").textContent = dx.role?.name ? `Rol: ${dx.role.name}` : "Rol: -";

  const collections = Object.keys(dx.abilities || {});
  const summary = collections.length
    ? collections.map(name => {
      const ab = dx.abilities[name] || {};
      return `${name}: R${ab.read ? "✅" : "❌"} C${ab.create ? "✅" : "❌"} U${ab.update ? "✅" : "❌"} D${ab.delete ? "✅" : "❌"}`;
    }).join("\n")
    : summarizePermissions(dx.permissions || []);

  el("dxPermsSummary").textContent = summary;
}

export function renderRates(state){
  const config = state.config;
  for(const c of config.currencies){ if(config.ratesToBase[c] == null) config.ratesToBase[c] = 1; }
  config.ratesToBase[config.baseCurrency] = 1;
  const box = el("ratesBox"); box.innerHTML = "";
  const grid = document.createElement("div");
  grid.style.display = "grid"; grid.style.gap = "10px"; grid.style.gridTemplateColumns = "repeat(2, 1fr)"; grid.style.alignItems = "end";
  box.appendChild(grid);
  for(const cur of config.currencies){
    const wrap = document.createElement("div");
    const lab = document.createElement("label"); lab.textContent = `${cur} → ${config.baseCurrency}`;
    const inp = document.createElement("input"); inp.type = "number"; inp.step = "0.0001"; inp.min = "0"; inp.value = Number(config.ratesToBase[cur] ?? 1); inp.dataset.cur = cur;
    wrap.appendChild(lab); wrap.appendChild(inp); grid.appendChild(wrap);
  }
}

function uniqueTrimmed(values = []){
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))];
}

const configPickerDraft = {
  expense: [],
  income: [],
  reentry: [],
  groups: []
};

function ensureDraftValue(key, fallback = []){
  if(!Array.isArray(configPickerDraft[key]) || !configPickerDraft[key].length){
    configPickerDraft[key] = uniqueTrimmed(fallback);
  }
  return configPickerDraft[key];
}

function renderPickerManager({ containerId, valuesKey, values = [] }){
  const root = el(containerId);
  if(!root) return;

  const currentValues = ensureDraftValue(valuesKey, values);
  root.innerHTML = "";

  const row = document.createElement("div");
  row.className = "picker-manager-row";

  const select = document.createElement("select");
  select.dataset.managerSelect = valuesKey;
  for(const value of currentValues){
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  const addOption = document.createElement("option");
  addOption.value = "__new__";
  addOption.textContent = "➕ Agregar nuevo...";
  select.appendChild(addOption);

  select.addEventListener("change", ()=>{
    if(select.value !== "__new__") return;
    const typed = window.prompt("Escribí el nuevo valor");
    const value = String(typed || "").trim();
    if(!value){
      select.selectedIndex = 0;
      return;
    }
    if(!currentValues.includes(value)) currentValues.push(value);
    configPickerDraft[valuesKey] = uniqueTrimmed(currentValues);
    renderConfigPickers({ config: {
      expenseCategories: configPickerDraft.expense,
      incomeCategories: configPickerDraft.income,
      reentryCategories: configPickerDraft.reentry,
      expenseGroups: configPickerDraft.groups
    } });
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn small";
  addBtn.textContent = "Agregar seleccionada";
  addBtn.addEventListener("click", ()=>{
    if(select.value === "__new__") return;
    const value = String(select.value || "").trim();
    if(!value) return;
    if(!currentValues.includes(value)) currentValues.push(value);
    configPickerDraft[valuesKey] = uniqueTrimmed(currentValues);
    renderPickerManager({ containerId, valuesKey, values: currentValues });
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn small";
  removeBtn.textContent = "Quitar seleccionada";
  removeBtn.addEventListener("click", ()=>{
    if(select.value === "__new__") return;
    const value = String(select.value || "").trim();
    configPickerDraft[valuesKey] = currentValues.filter(item => item !== value);
    renderPickerManager({ containerId, valuesKey, values: configPickerDraft[valuesKey] });
  });

  row.appendChild(select);
  row.appendChild(addBtn);
  row.appendChild(removeBtn);
  root.appendChild(row);

  const summary = document.createElement("div");
  summary.className = "hint";
  summary.textContent = currentValues.length
    ? `Seleccionadas (${currentValues.length}): ${currentValues.join(", ")}`
    : "No hay elementos seleccionados.";
  root.appendChild(summary);
}

function readPickerValues(valuesKey){
  return uniqueTrimmed(configPickerDraft[valuesKey] || []);
}

function renderConfigPickers(state){
  configPickerDraft.expense = uniqueTrimmed(state.config.expenseCategories || configPickerDraft.expense || []);
  configPickerDraft.income = uniqueTrimmed(state.config.incomeCategories || configPickerDraft.income || []);
  configPickerDraft.reentry = uniqueTrimmed(state.config.reentryCategories || configPickerDraft.reentry || []);
  configPickerDraft.groups = uniqueTrimmed(state.config.expenseGroups || configPickerDraft.groups || []);

  renderPickerManager({ containerId: "expenseCategoriesPicker", valuesKey: "expense", values: configPickerDraft.expense });
  renderPickerManager({ containerId: "incomeCategoriesPicker", valuesKey: "income", values: configPickerDraft.income });
  renderPickerManager({ containerId: "reentryCategoriesPicker", valuesKey: "reentry", values: configPickerDraft.reentry });
  renderPickerManager({ containerId: "expenseGroupsPicker", valuesKey: "groups", values: configPickerDraft.groups });
}

function renderCategoryGrouping(state){
  const { expenseGroups = [], expenseCategoryGroups = {}, expenseCategories = [] } = state.config;
  el("tbodyCategoryGrouping").innerHTML = expenseCategories.map(cat => {
    const options = ["<option value=''>Sin grupo (usa categoría)</option>"].concat(expenseGroups.filter(Boolean).map(group => `<option value="${escapeHTML(group)}" ${expenseCategoryGroups[cat]===group?"selected":""}>${escapeHTML(group)}</option>`)).join("");
    return `<tr><td style="font-weight:900">${escapeHTML(cat)}</td><td><select data-group-cat="${escapeHTML(cat)}">${options}</select></td></tr>`;
  }).join("") || `<tr><td colspan="2" class="muted">Sin categorías de gastos.</td></tr>`;
}

export async function saveConfigFromUI(state){
  const config = state.config;
  const expCats = readPickerValues("expense");
  const incCats = readPickerValues("income");
  const reentryCats = readPickerValues("reentry");
  const groups = readPickerValues("groups");
  if(expCats.length < 3 || incCats.length < 2 || reentryCats.length < 1) return toast("Revisá categorías mínimas.", "danger");

  const rates = { ...config.ratesToBase };
  document.querySelectorAll("#ratesBox input[data-cur]").forEach(inp=>{ rates[inp.dataset.cur] = Number(inp.value) || 1; });
  const categoryGroups = {};
  document.querySelectorAll("#tbodyCategoryGrouping select[data-group-cat]").forEach(sel=>{ if(sel.value) categoryGroups[sel.dataset.groupCat] = sel.value.trim(); });

  Object.assign(config, {
    locale: el("numLocale").value,
    baseCurrency: el("baseCurrency").value,
    expenseCategories: expCats,
    incomeCategories: incCats,
    reentryCategories: reentryCats,
    expenseGroups: groups,
    expenseCategoryGroups: categoryGroups,
    ratesToBase: rates
  });

  await saveSettings(config);
  for(const g of groups) await createGroup({ name: g, description: "" });
  for(const c of expCats) await createCategory({ name: c, type: "expense", group: categoryGroups[c] });
  for(const c of incCats) await createCategory({ name: c, type: "income" });
  for(const c of reentryCats) await createCategory({ name: c, type: "income" });

  fillSelect(el("fCurrency"), config.currencies);
  fillSelect(el("eCurrency"), config.currencies);
  fillSelect(el("baseCurrency"), config.currencies);
  renderConfigPickers(state); renderRates(state); renderCategoryGrouping(state);
  toast("Config guardada ✅");
  state.bus.emit("config:changed"); state.bus.emit("dashboard:refresh"); state.bus.emit("ingreso:refresh"); state.bus.emit("config:refresh");
}

export function renderBudgetTable(state){
  const mode = el("budgetMode").value || "category";
  const m = el("budgetMonth").value || monthISO();
  const monthBudget = state.budgets[m] || {};
  el("thBudgetEntity").textContent = mode === "group" ? "Grupo" : "Categoría";
  const entities = mode === "group" ? (state.config.expenseGroups || []).filter(Boolean) : state.config.expenseCategories;
  const tbody = el("tbodyBudgets"); tbody.innerHTML = "";
  for(const entity of entities){
    const key = mode === "group" ? groupBudgetKey(entity) : entity;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="font-weight:900">${escapeHTML(entity)}</td><td><input type="number" step="0.01" min="0" data-budget-key="${escapeHTML(key)}" value="${Number(monthBudget[key]||"") || ""}" placeholder="(sin límite)" /></td>`;
    tbody.appendChild(tr);
  }
}

export async function saveBudgetsFromUI(state){
  const m = el("budgetMonth").value || monthISO();
  const payload = [];
  document.querySelectorAll("#tbodyBudgets input[data-budget-key]").forEach(inp=>{
    const v = Number(inp.value);
    if(Number.isFinite(v) && v>0) payload.push({ month: m, category: inp.dataset.budgetKey, amount: v, currency: state.config.baseCurrency });
  });

  for(const row of payload){
    const category = row.category.startsWith(GROUP_BUDGET_PREFIX) ? `${PAYLOAD_GROUP_PREFIX}${row.category.replace(GROUP_BUDGET_PREFIX, "")}` : row.category;
    await upsertBudget({ ...row, category });
  }

  state.budgetRows = await listBudgets();
  state.budgets = syncBudgetMapFromRows(state.budgetRows);
  toast("Presupuestos guardados ✅");
  state.bus.emit("budgets:changed"); state.bus.emit("dashboard:refresh");
}
