import { el, fillSelect, monthISO, escapeHTML, toast } from "./utils.js";
import {
  saveSettings, createGroup, createCategory, listBudgets, upsertBudget,
  getBackendMode, setBackendMode, getDirectusConfig, setDirectusSettings,
  pingDirectus, importLocalDataToDirectus, syncBudgetMapFromRows
} from "./dataStore.js";

const GROUP_BUDGET_PREFIX = "__group__::";
const PAYLOAD_GROUP_PREFIX = "[GRUPO] ";

function groupBudgetKey(group){ return `${GROUP_BUDGET_PREFIX}${group}`; }

export function initConfig(state){
  state.bus.on("config:refresh", ()=>{ renderRates(state); renderCategoryGrouping(state); renderBudgetTable(state); renderDirectusSettings(); });

  el("btnSaveConfig").addEventListener("click", ()=> saveConfigFromUI(state));
  el("btnResetConfig").addEventListener("click", ()=> location.reload());

  el("btnLoadBudgets").addEventListener("click", ()=> renderBudgetTable(state));
  el("btnSaveBudgets").addEventListener("click", ()=> saveBudgetsFromUI(state));
  el("budgetMonth").addEventListener("change", ()=> renderBudgetTable(state));
  el("budgetMode").addEventListener("change", ()=> renderBudgetTable(state));

  el("btnDirectusTest").addEventListener("click", async ()=>{
    try{
      setDirectusSettings({
        baseUrl: el("directusUrl")?.value?.trim() || "",
        serviceEmail: el("directusServiceEmail")?.value?.trim() || "",
        servicePassword: el("directusServicePassword")?.value || ""
      });
      await pingDirectus();
      toast("Conexión Directus OK ✅");
    }catch(err){ toast(err.message || "No se pudo conectar", "danger"); }
  });

  el("useDirectus").addEventListener("change", ()=>{
    setBackendMode(el("useDirectus").checked ? "directus" : "local");
    toast("Backend actualizado. Recargando…", "warn");
    setTimeout(()=> location.reload(), 400);
  });

  el("btnImportDirectus").addEventListener("click", async ()=>{
    const progress = el("directusImportProgress");
    progress.textContent = "Importando…";
    try{
      await importLocalDataToDirectus((done, total, label)=>{ progress.textContent = `${done}/${total} · ${label}`; });
      progress.textContent = "Importación finalizada ✅";
      toast("Importado a Directus ✅");
    }catch(err){
      progress.textContent = "Importación fallida";
      toast(err.message || "Error de importación", "danger");
    }
  });
}

function renderDirectusSettings(){
  const directus = getDirectusConfig();
  const urlInput = el("directusUrl");
  const emailInput = el("directusServiceEmail");
  const passwordInput = el("directusServicePassword");
  const useDirectus = el("useDirectus");
  if(urlInput) urlInput.value = directus.baseUrl;
  if(emailInput) emailInput.value = directus.serviceEmail || "";
  if(passwordInput) passwordInput.value = "";
  if(useDirectus) useDirectus.checked = getBackendMode() === "directus";
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

function renderCategoryGrouping(state){
  const { expenseGroups = [], expenseCategoryGroups = {}, expenseCategories = [] } = state.config;
  el("tbodyCategoryGrouping").innerHTML = expenseCategories.map(cat => {
    const options = ["<option value=''>Sin grupo (usa categoría)</option>"].concat(expenseGroups.filter(Boolean).map(group => `<option value="${escapeHTML(group)}" ${expenseCategoryGroups[cat]===group?"selected":""}>${escapeHTML(group)}</option>`)).join("");
    return `<tr><td style="font-weight:900">${escapeHTML(cat)}</td><td><select data-group-cat="${escapeHTML(cat)}">${options}</select></td></tr>`;
  }).join("") || `<tr><td colspan="2" class="muted">Sin categorías de gastos.</td></tr>`;
}

export async function saveConfigFromUI(state){
  const config = state.config;
  const expCats = el("categoriesExpenseText").value.split("\n").map(s=>s.trim()).filter(Boolean);
  const incCats = el("categoriesIncomeText").value.split("\n").map(s=>s.trim()).filter(Boolean);
  const groups = el("expenseGroupsText").value.split("\n").map(s=>s.trim()).filter(Boolean);
  if(expCats.length < 3 || incCats.length < 2) return toast("Revisá categorías mínimas.", "danger");

  const rates = { ...config.ratesToBase };
  document.querySelectorAll("#ratesBox input[data-cur]").forEach(inp=>{ rates[inp.dataset.cur] = Number(inp.value) || 1; });
  const categoryGroups = {};
  document.querySelectorAll("#tbodyCategoryGrouping select[data-group-cat]").forEach(sel=>{ if(sel.value) categoryGroups[sel.dataset.groupCat] = sel.value.trim(); });

  Object.assign(config, {
    locale: el("numLocale").value,
    baseCurrency: el("baseCurrency").value,
    expenseCategories: expCats,
    incomeCategories: incCats,
    expenseGroups: groups,
    expenseCategoryGroups: categoryGroups,
    ratesToBase: rates
  });

  await saveSettings(config);
  if(getBackendMode() === "directus"){
    for(const g of groups) await createGroup({ name: g, description: "" });
    for(const c of expCats) await createCategory({ name: c, type: "expense", group: categoryGroups[c] });
    for(const c of incCats) await createCategory({ name: c, type: "income" });
  }

  fillSelect(el("fCurrency"), config.currencies);
  fillSelect(el("eCurrency"), config.currencies);
  fillSelect(el("baseCurrency"), config.currencies);
  renderRates(state); renderCategoryGrouping(state);
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
