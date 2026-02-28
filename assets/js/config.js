import { el, fillSelect, monthISO, toast } from "./utils.js";
import {
  saveSettings,
  createGroup,
  createCategory,
  listBudgets,
  upsertBudget,
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
function groupBudgetKey(group){ return `${GROUP_BUDGET_PREFIX}${group}`; }

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
    state.loadedComparisonMonths = [];
    saveUiState({ lastActiveMonth: selected, compareEnabled: false, compareMonths: [] });
    toast(`Mes activo actualizado: ${selected}`);
    location.reload();
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

export function renderConfigPickers(state){ fillSelect(el("baseCurrency"), [state.config.baseCurrency]); }
export function renderRates(){ }
export function renderCategoryGrouping(){ }

export async function saveConfigFromUI(state){
  state.config.baseCurrency = el("baseCurrency").value || state.config.baseCurrency;
  state.config = await saveSettings(state.config);
  toast("Config guardada ✅");
  state.bus.emit("config:changed");
}

export function renderBudgetTable(){
  const tbody = el("tbodyBudgets");
  if(!tbody) return;
  tbody.innerHTML = "<tr><td colspan='2' class='muted'>Presupuestos desactivados en modo local 2.0.</td></tr>";
}

export async function saveBudgetsFromUI(state){
  const month = el("budgetMonth").value || monthISO();
  const mode = el("budgetMode").value || "category";
  const rows = [...document.querySelectorAll("#tbodyBudgets tr")];
  for(const row of rows){
    const key = row.dataset.key;
    const amount = Number(row.querySelector("input")?.value || 0);
    if(!key) continue;
    await upsertBudget({ month, key: mode === "group" ? groupBudgetKey(key) : key, amount });
  }
  state.budgetRows = await listBudgets();
  state.budgets = syncBudgetMapFromRows(state.budgetRows);
  toast("Presupuestos guardados ✅");
}

void createGroup;
void createCategory;
