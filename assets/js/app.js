import { el, monthISO, todayISO, fillSelect, toast } from "./utils.js";
import { loadConfig, loadTransactions, loadBudgets, getTheme, setTheme } from "./storage.js";
import { defaults } from "./constants.js";
import { initTabs } from "./router.js";
import { initIngreso } from "./ingreso.js";
import { initDashboard } from "./dashboard.js";
import { initConfig } from "./config.js";
import { initExport } from "./export.js";

function makeBus(){
  return {
    emit(name, detail){
      document.dispatchEvent(new CustomEvent(name, { detail }));
    },
    on(name, fn){
      document.addEventListener(name, fn);
      return ()=> document.removeEventListener(name, fn);
    }
  };
}

// Estado único compartido
const state = {
  bus: makeBus(),
  config: null,
  tx: [],
  budgets: {},
  page: 1,
  PAGE_SIZE: 12,
  charts: { daily:null, cats:null, pay:null },
};

function init(){
  // theme
  setTheme(getTheme());

  // load data
  state.config = safelyLoad("configuración", () => loadConfig(), structuredClone(defaults));
  state.tx = safelyLoad("movimientos", () => loadTransactions(state.config), []);
  state.budgets = safelyLoad("presupuestos", () => loadBudgets(), {});

  // defaults UI values
  el("fDate").value = todayISO();
  el("dashMonth").value = monthISO();
  el("budgetMonth").value = monthISO();
  el("pillMonth").textContent = "Mes: " + monthISO();

  // selects (currency/base)
  fillSelect(el("fCurrency"), state.config.currencies);
  fillSelect(el("eCurrency"), state.config.currencies);
  fillSelect(el("baseCurrency"), state.config.currencies);

  // pay options for edit select
  // (en ingreso.js se refresca categorías, acá llenamos ePay y queda fijo)
  const pay = ["Tarjeta","Débito","Efectivo","Transferencia","Reingreso por transferencia","Cripto","Otro"];
  fillSelect(el("ePay"), pay);

  // config UI
  el("numLocale").value = state.config.locale;
  el("baseCurrency").value = state.config.baseCurrency;
  el("categoriesExpenseText").value = state.config.expenseCategories.join("\n");
  el("categoriesIncomeText").value = state.config.incomeCategories.join("\n");
  el("expenseGroupsText").value = (state.config.expenseGroups || []).join("\n");

  // init modules
  initTabs(state);
  initIngreso(state);
  initDashboard(state);
  initConfig(state);
  initExport(state);

  // primer refresco global
  state.bus.emit("dashboard:refresh");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("config:refresh");
}

function safelyLoad(label, fn, fallback){
  try{
    return fn();
  }catch(err){
    console.error(`Error al cargar ${label}`, err);
    toast(`No se pudo cargar ${label}. Se usaron valores por defecto.`, "warn");
    return fallback;
  }
}

init();
