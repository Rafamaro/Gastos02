import { el, fillSelect, monthISO, escapeHTML, toast } from "./utils.js";
import {
  saveSettings,
  createGroup,
  createCategory,
  listBudgets,
  upsertBudget,
  deleteBudget,
  syncBudgetMapFromRows,
  connectDataFolder,
  getBackendMode,
  listAvailableMonths,
  loadComparisonMonths,
  setActiveMonth,
  saveUiState,
  getUiState
} from "./dataStore.js";

const GROUP_BUDGET_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";

function groupBudgetKey(group){ return `${GROUP_BUDGET_PREFIX}${group}`; }

function uniqueTrimmed(values = []){
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))];
}

const configPickerDraft = {
  currencies: [],
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
    renderPickerManager({ containerId, valuesKey, values: configPickerDraft[valuesKey] });
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

export function initConfig(state){
  state.bus.on("config:refresh", ()=>{
    renderConfigPickers(state);
    renderRates(state);
    renderCategoryGrouping(state);
    renderBudgetTable(state);
    renderLocalStorageCard(state);
  });

  el("btnSaveConfig")?.addEventListener("click", ()=> saveConfigFromUI(state));
  el("btnResetConfig")?.addEventListener("click", ()=> location.reload());

  el("btnLoadBudgets")?.addEventListener("click", ()=> renderBudgetTable(state));
  el("btnSaveBudgets")?.addEventListener("click", ()=> saveBudgetsFromUI(state));
  el("budgetMonth")?.addEventListener("change", ()=> renderBudgetTable(state));
  el("budgetMode")?.addEventListener("change", ()=> renderBudgetTable(state));

  el("btnChooseFolder")?.addEventListener("click", async ()=>{
    try{
      await connectDataFolder();
      toast("Carpeta conectada ✅");
      location.reload();
    }catch(err){
      toast(err.message || "No se pudo conectar carpeta", "danger");
    }
  });

  el("activeMonthPicker")?.addEventListener("change", async ()=>{
    const selected = el("activeMonthPicker").value;
    if(!selected) return;
    await setActiveMonth(selected);
    state.activeMonth = selected;
    const enabled = Boolean(el("compareEnabled")?.checked);
    const selectedCmp = enabled
      ? [...(el("cmpMonths")?.selectedOptions || [])].map(o=>o.value)
      : [];

    await loadComparisonMonths(enabled ? selectedCmp : []);
    state.loadedComparisonMonths = enabled ? selectedCmp : [];
    state.tx = await state.reloadTransactions();
    state.budgetRows = await listBudgets();
    state.budgets = syncBudgetMapFromRows(state.budgetRows);

    if(el("dashMonth")) el("dashMonth").value = selected;
    if(el("budgetMonth")) el("budgetMonth").value = selected;
    if(el("pillMonth")) el("pillMonth").textContent = `Mes activo: ${selected}`;

    saveUiState({ lastActiveMonth: selected, compareEnabled: enabled, compareMonths: state.loadedComparisonMonths });
    toast(`Mes activo actualizado: ${selected}`);

    state.bus.emit("dashboard:refresh");
    state.bus.emit("ingreso:refresh");
    state.bus.emit("config:refresh");
    renderLocalStorageCard(state);
  });

  el("compareEnabled")?.addEventListener("change", async ()=>{
    const enabled = Boolean(el("compareEnabled").checked);
    if(!enabled){
      await loadComparisonMonths([]);
      state.loadedComparisonMonths = [];
      state.tx = await state.reloadTransactions();
      state.bus.emit("dashboard:refresh");
      state.bus.emit("ingreso:refresh");
      renderLocalStorageCard(state);
    }
    saveUiState({ compareEnabled: enabled, compareMonths: enabled ? state.loadedComparisonMonths : [] });
  });

  el("cmpMonths")?.addEventListener("change", async ()=>{
    const selected = [...el("cmpMonths").selectedOptions].map(o=>o.value);
    const enabled = Boolean(el("compareEnabled")?.checked);
    await loadComparisonMonths(enabled ? selected : []);
    state.loadedComparisonMonths = enabled ? selected : [];
    state.tx = await state.reloadTransactions();
    state.bus.emit("dashboard:refresh");
    state.bus.emit("ingreso:refresh");
    renderLocalStorageCard(state);
  });
}

export function renderRates(state){
  const config = state.config;
  const monthKey = state.activeMonth || monthISO();
  if(!config.ratesByMonth || typeof config.ratesByMonth !== "object") config.ratesByMonth = {};
  if(!config.ratesByMonth[monthKey] || typeof config.ratesByMonth[monthKey] !== "object") config.ratesByMonth[monthKey] = {};

  for(const c of config.currencies){ if(config.ratesToBase[c] == null) config.ratesToBase[c] = 1; }
  config.ratesToBase[config.baseCurrency] = 1;
  config.ratesByMonth[monthKey][config.baseCurrency] = 1;
  const box = el("ratesBox"); box.innerHTML = "";
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gap = "10px";
  grid.style.gridTemplateColumns = "repeat(2, 1fr)";
  box.appendChild(grid);

  for(const cur of config.currencies){
    const wrap = document.createElement("div");
    const lab = document.createElement("label");
    lab.textContent = `${cur} → ${config.baseCurrency}`;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.0001";
    inp.min = "0";
    const monthRate = Number(config.ratesByMonth?.[monthKey]?.[cur]);
    const globalRate = Number(config.ratesToBase[cur] ?? 1);
    inp.value = Number.isFinite(monthRate) && monthRate > 0 ? monthRate : globalRate;
    inp.dataset.cur = cur;
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    grid.appendChild(wrap);
  }
}

export function renderConfigPickers(state){
  configPickerDraft.currencies = uniqueTrimmed(state.config.currencies || configPickerDraft.currencies || []);
  configPickerDraft.expense = uniqueTrimmed(state.config.expenseCategories || configPickerDraft.expense || []);
  configPickerDraft.income = uniqueTrimmed(state.config.incomeCategories || configPickerDraft.income || []);
  configPickerDraft.reentry = uniqueTrimmed(state.config.reentryCategories || configPickerDraft.reentry || []);
  configPickerDraft.groups = uniqueTrimmed(state.config.expenseGroups || configPickerDraft.groups || []);

  renderPickerManager({ containerId: "currenciesPicker", valuesKey: "currencies", values: configPickerDraft.currencies });
  renderPickerManager({ containerId: "expenseCategoriesPicker", valuesKey: "expense", values: configPickerDraft.expense });
  renderPickerManager({ containerId: "incomeCategoriesPicker", valuesKey: "income", values: configPickerDraft.income });
  renderPickerManager({ containerId: "reentryCategoriesPicker", valuesKey: "reentry", values: configPickerDraft.reentry });
  renderPickerManager({ containerId: "expenseGroupsPicker", valuesKey: "groups", values: configPickerDraft.groups });
}

export function renderCategoryGrouping(state){
  const { expenseGroups = [], expenseCategoryGroups = {}, expenseCategories = [] } = state.config;
  el("tbodyCategoryGrouping").innerHTML = expenseCategories.map(cat => {
    const options = ["<option value=''>Sin grupo (usa categoría)</option>"]
      .concat(expenseGroups.filter(Boolean).map(group => `<option value="${escapeHTML(group)}" ${expenseCategoryGroups[cat]===group?"selected":""}>${escapeHTML(group)}</option>`))
      .join("");
    return `<tr><td style="font-weight:900">${escapeHTML(cat)}</td><td><select data-group-cat="${escapeHTML(cat)}">${options}</select></td></tr>`;
  }).join("") || `<tr><td colspan="2" class="muted">Sin categorías de gastos.</td></tr>`;
}

function renderLocalStorageCard(state){
  const mode = getBackendMode();
  const uiState = getUiState();

  if(el("localMode")) el("localMode").textContent = mode === "local-folder" ? "Local (carpeta)" : "Manual";
  if(el("folderConnected")) el("folderConnected").textContent = mode === "local-folder" ? "sí" : "no";
  if(el("activeMonthStatus")) el("activeMonthStatus").textContent = state.activeMonth || monthISO();
  if(el("activeMonthPicker")) el("activeMonthPicker").value = state.activeMonth || monthISO();
  if(el("comparisonStatus")) el("comparisonStatus").textContent = (state.loadedComparisonMonths || []).join(", ") || "ninguno";
  if(el("compareEnabled")) el("compareEnabled").checked = uiState.compareEnabled;

  listAvailableMonths().then(months=>{
    const cmp = el("cmpMonths");
    if(!cmp) return;
    cmp.innerHTML = "";
    const previous = new Set(state.loadedComparisonMonths || uiState.compareMonths || []);
    months.filter(m=>m!==state.activeMonth).forEach(m=>{
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      o.selected = previous.has(m);
      cmp.appendChild(o);
    });
  });
}

export async function saveConfigFromUI(state){
  const config = state.config;
  const currencies = readPickerValues("currencies").map(x=>String(x||"" ).toUpperCase());
  const expCats = readPickerValues("expense");
  const incCats = readPickerValues("income");
  const reentryCats = readPickerValues("reentry");
  const groups = readPickerValues("groups");

  if(!currencies.length) return toast("Definí al menos 1 divisa.", "danger");
  if(expCats.length < 1) return toast("Definí al menos 1 categoría de gasto.", "danger");

  const rates = { ...config.ratesToBase };
  document.querySelectorAll("#ratesBox input[data-cur]").forEach(inp=>{ rates[inp.dataset.cur] = Number(inp.value) || 1; });
  const monthKey = state.activeMonth || monthISO();
  const ratesByMonth = { ...(config.ratesByMonth || {}) };
  ratesByMonth[monthKey] = { ...(ratesByMonth[monthKey] || {}), ...rates };
  const categoryGroups = {};
  document.querySelectorAll("#tbodyCategoryGrouping select[data-group-cat]").forEach(sel=>{ if(sel.value) categoryGroups[sel.dataset.groupCat] = sel.value.trim(); });

  Object.assign(config, {
    locale: el("numLocale").value,
    baseCurrency: el("baseCurrency").value,
    currencies,
    expenseCategories: expCats,
    incomeCategories: incCats,
    reentryCategories: reentryCats,
    expenseGroups: groups,
    expenseCategoryGroups: categoryGroups,
    ratesToBase: rates,
    ratesByMonth
  });

  state.config = await saveSettings(config);
  for(const g of groups) await createGroup({ name: g, description: "" });
  for(const c of expCats) await createCategory({ name: c, type: "expense", group: categoryGroups[c] });
  for(const c of incCats) await createCategory({ name: c, type: "income" });
  for(const c of reentryCats) await createCategory({ name: c, type: "reentry" });

  fillSelect(el("fCurrency"), state.config.currencies);
  fillSelect(el("eCurrency"), state.config.currencies);
  fillSelect(el("baseCurrency"), state.config.currencies);
  if(!state.config.currencies.includes(state.config.baseCurrency)) state.config.baseCurrency = state.config.currencies[0];
  renderConfigPickers(state);
  renderRates(state);
  renderCategoryGrouping(state);

  toast("Config guardada ✅");
  state.bus.emit("config:changed");
  state.bus.emit("dashboard:refresh");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("config:refresh");
}

export function renderBudgetTable(state){
  const tbody = el("tbodyBudgets");
  if(!tbody) return;
  const month = el("budgetMonth")?.value || state.activeMonth || monthISO();
  const mode = el("budgetMode")?.value || "category";
  const entities = mode === "group"
    ? uniqueTrimmed(state.config.expenseGroups || [])
    : uniqueTrimmed(state.config.expenseCategories || []);
  const monthBudgets = state.budgets?.[month] || {};
  const keyForEntity = mode === "group" ? groupBudgetKey : (name => name);

  const title = el("thBudgetEntity");
  if(title) title.textContent = mode === "group" ? "Grupo" : "Categoría";

  if(!entities.length){
    tbody.innerHTML = `<tr><td colspan='2' class='muted'>No hay ${mode === "group" ? "grupos" : "categorías"} configurados.</td></tr>`;
    return;
  }

  tbody.innerHTML = entities.map(name=>{
    const key = keyForEntity(name);
    const value = Number(monthBudgets[key] || 0);
    return `
      <tr>
        <td style="font-weight:700">${escapeHTML(name)}</td>
        <td>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            data-budget-key="${escapeHTML(key)}"
            value="${value > 0 ? String(value) : ""}"
          />
        </td>
      </tr>
    `;
  }).join("");
}

export async function saveBudgetsFromUI(state){
  const m = el("budgetMonth").value || monthISO();
  const payload = [];
  const keep = new Set();
  document.querySelectorAll("#tbodyBudgets input[data-budget-key]").forEach(inp=>{
    const v = Number(inp.value);
    const key = String(inp.dataset.budgetKey || "").trim();
    if(Number.isFinite(v) && v > 0 && key){
      keep.add(key);
      payload.push({ month: m, category: key, amount: v, currency: state.config.baseCurrency });
    }
  });

  const existing = Object.keys(state.budgets?.[m] || {});
  for(const key of existing){
    if(keep.has(key)) continue;
    await deleteBudget(`${m}:${key}`);
  }

  for(const row of payload){
    const category = row.category.startsWith(GROUP_BUDGET_PREFIX) ? `${PAYLOAD_GROUP_PREFIX}${row.category.replace(GROUP_BUDGET_PREFIX, "")}` : row.category;
    await upsertBudget({ ...row, category });
  }
  state.budgetRows = await listBudgets();
  state.budgets = syncBudgetMapFromRows(state.budgetRows);
  toast("Presupuestos guardados ✅");
  state.bus.emit("budgets:changed");
  state.bus.emit("dashboard:refresh");
}

void createGroup;
void createCategory;
