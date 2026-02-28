import { el, fillSelect, monthISO, toast } from "./utils.js";
import { saveSettings, createGroup, createCategory, listBudgets, upsertBudget, syncBudgetMapFromRows, connectDataFolder, getBackendMode, listAvailableMonths, loadComparisonMonths } from "./dataStore.js";

const GROUP_BUDGET_PREFIX = "__group__::";
function groupBudgetKey(group){ return `${GROUP_BUDGET_PREFIX}${group}`; }

export function initConfig(state){
  state.bus.on("config:refresh", ()=>{ renderConfigPickers(state); renderRates(state); renderCategoryGrouping(state); renderBudgetTable(state); renderLocalStorageCard(state); });

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
    }catch(err){ toast(err.message || "No se pudo conectar carpeta", "danger"); }
  });

  el("cmpMonths")?.addEventListener("change", async ()=>{
    const selected = [...el("cmpMonths").selectedOptions].map(o=>o.value);
    await loadComparisonMonths(selected);
    state.loadedComparisonMonths = selected;
    state.tx = await state.reloadTransactions();
    state.bus.emit("dashboard:refresh");
    state.bus.emit("ingreso:refresh");
    renderLocalStorageCard(state);
  });
}

function renderLocalStorageCard(state){
  const mode = getBackendMode();
  if(el("localMode")) el("localMode").textContent = mode === "local-folder" ? "Local (carpeta)" : "Manual";
  if(el("folderConnected")) el("folderConnected").textContent = mode === "local-folder" ? "sí" : "no";
  if(el("activeMonthStatus")) el("activeMonthStatus").textContent = state.activeMonth || monthISO();
  if(el("comparisonStatus")) el("comparisonStatus").textContent = (state.loadedComparisonMonths || []).join(", ") || "ninguno";

  listAvailableMonths().then(months=>{
    const cmp = el("cmpMonths");
    if(!cmp) return;
    cmp.innerHTML = "";
    months.filter(m=>m!==state.activeMonth).forEach(m=>{
      const o=document.createElement("option");o.value=m;o.textContent=m;cmp.appendChild(o);
    });
  });
}

export function renderConfigPickers(state){ fillSelect(el("baseCurrency"), [state.config.baseCurrency]); }
export function renderRates(){}
export function renderCategoryGrouping(){}

export async function saveConfigFromUI(state){
  state.config.baseCurrency = el("baseCurrency").value || state.config.baseCurrency;
  state.config = await saveSettings(state.config);
  toast("Config guardada ✅");
  state.bus.emit("config:changed");
}

export function renderBudgetTable(state){
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
