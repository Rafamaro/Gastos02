import { el, fillSelect, monthISO, escapeHTML, toast } from "./utils.js";
import { saveConfig, saveBudgets } from "./storage.js";

export function initConfig(state){
  // refrescos desde router
  state.bus.on("config:refresh", ()=>{
    renderRates(state);
    renderBudgetTable(state);
  });

  // save/reset config
  el("btnSaveConfig").addEventListener("click", ()=> saveConfigFromUI(state));
  el("btnResetConfig").addEventListener("click", ()=> {
    // defaults se re-cargan desde storage haciendo reload, como en la versión single-file
    localStorage.removeItem("mov_cfg_v2");
    toast("Config restaurada", "warn");
    location.reload();
  });

  // budgets
  el("btnLoadBudgets").addEventListener("click", ()=> renderBudgetTable(state));
  el("btnSaveBudgets").addEventListener("click", ()=> saveBudgetsFromUI(state));
  el("budgetMonth").addEventListener("change", ()=> renderBudgetTable(state));
}

export function renderRates(state){
  const config = state.config;

  for(const c of config.currencies){
    if(config.ratesToBase[c] == null) config.ratesToBase[c] = (c===config.baseCurrency ? 1 : 1);
  }
  config.ratesToBase[config.baseCurrency] = 1;

  const box = el("ratesBox");
  box.innerHTML = "";

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gap = "10px";
  grid.style.gridTemplateColumns = "repeat(2, 1fr)";
  grid.style.alignItems = "end";
  box.appendChild(grid);

  for(const cur of config.currencies){
    const wrap = document.createElement("div");
    const lab = document.createElement("label");
    lab.textContent = `${cur} → ${config.baseCurrency}`;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.0001";
    inp.min = "0";
    inp.value = Number(config.ratesToBase[cur] ?? 1);
    inp.dataset.cur = cur;

    wrap.appendChild(lab);
    wrap.appendChild(inp);
    grid.appendChild(wrap);
  }

  if(window.innerWidth < 560) grid.style.gridTemplateColumns = "1fr";
}

export function saveConfigFromUI(state){
  const config = state.config;

  const locale = el("numLocale").value;
  const baseCurrency = el("baseCurrency").value;

  const expCats = el("categoriesExpenseText").value
    .split("\n").map(s=>s.trim()).filter(Boolean);

  const incCats = el("categoriesIncomeText").value
    .split("\n").map(s=>s.trim()).filter(Boolean);

  if(expCats.length < 3){
    toast("Poné al menos 3 categorías de gasto.", "danger");
    return;
  }
  if(incCats.length < 2){
    toast("Poné al menos 2 categorías de ingreso.", "danger");
    return;
  }

  const rates = { ...config.ratesToBase };
  document.querySelectorAll("#ratesBox input[data-cur]").forEach(inp=>{
    const cur = inp.dataset.cur;
    rates[cur] = Number(inp.value) || 1;
  });
  rates[baseCurrency] = 1;

  config.locale = locale;
  config.baseCurrency = baseCurrency;
  config.expenseCategories = expCats;
  config.incomeCategories = incCats;
  config.ratesToBase = rates;

  saveConfig(config);

  // refrescar selects base y moneda
  fillSelect(el("fCurrency"), config.currencies);
  fillSelect(el("eCurrency"), config.currencies);
  fillSelect(el("baseCurrency"), config.currencies);

  renderRates(state);

  toast("Config guardada ✅");
  state.bus.emit("config:changed");
  state.bus.emit("dashboard:refresh");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("config:refresh");
}

export function renderBudgetTable(state){
  const config = state.config;
  const budgets = state.budgets;

  const m = el("budgetMonth").value || monthISO();
  const monthBudget = budgets[m] || {};
  const tbody = el("tbodyBudgets");
  tbody.innerHTML = "";

  for(const cat of config.expenseCategories){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:900">${escapeHTML(cat)}</td>
      <td>
        <input type="number" step="0.01" min="0" data-cat="${escapeHTML(cat)}"
          value="${Number(monthBudget[cat]||"") || ""}" placeholder="(sin límite)" />
      </td>
    `;
    tbody.appendChild(tr);
  }
}

export function saveBudgetsFromUI(state){
  const budgets = state.budgets;
  const m = el("budgetMonth").value || monthISO();
  const monthBudget = {};

  document.querySelectorAll("#tbodyBudgets input[data-cat]").forEach(inp=>{
    const cat = inp.dataset.cat;
    const v = Number(inp.value);
    if(Number.isFinite(v) && v>0) monthBudget[cat] = v;
  });

  budgets[m] = monthBudget;
  saveBudgets(budgets);

  toast("Presupuestos guardados ✅");
  state.bus.emit("budgets:changed");
  state.bus.emit("dashboard:refresh");
}
