import { el, monthISO, todayISO, fillSelect, toast } from "./utils.js";
import { getTheme, setTheme } from "./storage.js";
import { defaults } from "./constants.js";
import { initTabs } from "./router.js";
import { initIngreso } from "./ingreso.js";
import { initDashboard } from "./dashboard.js";
import { initConfig } from "./config.js";
import { initExport } from "./export.js";
import { getSettings, listTransactions, listBudgets, syncBudgetMapFromRows } from "./dataStore.js";

function makeBus(){
  return {
    emit(name, detail){ document.dispatchEvent(new CustomEvent(name, { detail })); },
    on(name, fn){ document.addEventListener(name, fn); return ()=> document.removeEventListener(name, fn); }
  };
}

const state = {
  bus: makeBus(),
  config: null,
  tx: [],
  budgetRows: [],
  budgets: {},
  page: 1,
  PAGE_SIZE: 12,
  charts: { daily:null, monthly:null, cats:null, monthlyBreakdown:null, pay:null }
};

async function init(){
  setTheme(getTheme());

  state.config = await safelyLoad("configuración", () => getSettings(), structuredClone(defaults));
  state.tx = await safelyLoad("movimientos", () => listTransactions(), []);
  state.budgetRows = await safelyLoad("presupuestos", () => listBudgets(), []);
  state.budgets = syncBudgetMapFromRows(state.budgetRows);

  el("fDate").value = todayISO();
  el("dashMonth").value = monthISO();
  el("budgetMonth").value = monthISO();
  el("budgetMode").value = "category";
  el("pillMonth").textContent = "Mes: " + monthISO();

  fillSelect(el("fCurrency"), state.config.currencies);
  fillSelect(el("eCurrency"), state.config.currencies);
  fillSelect(el("baseCurrency"), state.config.currencies);

  fillSelect(el("ePay"), ["Tarjeta","Débito","Efectivo","Transferencia","Reingreso por transferencia","Cripto","Otro"]);

  el("numLocale").value = state.config.locale;
  el("baseCurrency").value = state.config.baseCurrency;
  el("categoriesExpenseText").value = state.config.expenseCategories.join("\n");
  el("categoriesIncomeText").value = state.config.incomeCategories.join("\n");
  el("expenseGroupsText").value = (state.config.expenseGroups || []).join("\n");

  initTabs(state);
  initIngreso(state);
  initDashboard(state);
  initConfig(state);
  initExport(state);

  state.bus.emit("dashboard:refresh");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("config:refresh");
}

async function safelyLoad(label, fn, fallback){
  try{ return await fn(); }
  catch(err){
    console.error(`Error al cargar ${label}`, err);
    toast(`No se pudo cargar ${label}. Se usaron valores por defecto.`, "warn");
    return fallback;
  }
}

init();
