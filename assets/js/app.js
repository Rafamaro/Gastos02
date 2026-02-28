import { el, monthISO, todayISO, fillSelect, toast } from "./utils.js";
import { getTheme, setTheme } from "./storage.js";
import { APP_VERSION, defaults } from "./constants.js";
import { initTabs } from "./router.js";
import { initIngreso } from "./ingreso.js";
import { initDashboard } from "./dashboard.js";
import { initConfig } from "./config.js";
import { initExport } from "./export.js";
import {
  getSettings,
  listTransactions,
  listBudgets,
  syncBudgetMapFromRows,
  bootstrapStorage,
  loadCurrentMonth,
  getUiState,
  loadComparisonMonths,
  saveUiState
} from "./dataStore.js";

function makeBus(){ return { emit(name, detail){ document.dispatchEvent(new CustomEvent(name, { detail })); }, on(name, fn){ document.addEventListener(name, fn); return ()=> document.removeEventListener(name, fn); } }; }

const state = {
  bus: makeBus(), config: null, tx: [], budgetRows: [], budgets: {}, page: 1, PAGE_SIZE: 12,
  charts: { daily:null, monthly:null, cats:null, monthlyBreakdown:null, pay:null },
  activeMonth: null,
  loadedComparisonMonths: [],
  reloadTransactions: ()=> listTransactions()
};

async function init(){
  setTheme(getTheme());
  const modeInfo = await bootstrapStorage();

  const uiState = getUiState();
  state.activeMonth = await loadCurrentMonth(uiState.lastActiveMonth);

  if(uiState.compareEnabled && uiState.compareMonths.length){
    await loadComparisonMonths(uiState.compareMonths);
    state.loadedComparisonMonths = uiState.compareMonths;
  }

  await safelyLoadData();

  el("fDate").value = todayISO();
  el("dashMonth").value = state.activeMonth || monthISO();
  el("budgetMonth").value = state.activeMonth || monthISO();
  el("budgetMode").value = "category";
  el("pillMonth").textContent = "Mes activo: " + state.activeMonth;
  if(el("activeMonthPicker")) el("activeMonthPicker").value = state.activeMonth;
  if(el("pillMode")) el("pillMode").textContent = `Modo: ${modeInfo.mode === "local-folder" ? "Local (carpeta)" : "Manual"}`;

  console.info(`[App] APP_VERSION=${APP_VERSION}`);
  const versionBadge = el("appVersionBadge");
  if(versionBadge) versionBadge.textContent = `Versión ${APP_VERSION}`;

  fillSelect(el("fCurrency"), [state.config.baseCurrency]);
  fillSelect(el("eCurrency"), [state.config.baseCurrency]);
  fillSelect(el("baseCurrency"), [state.config.baseCurrency]);
  fillSelect(el("ePay"), ["Tarjeta","Débito","Efectivo","Transferencia","Otro"]);
  el("numLocale").value = state.config.locale || "es-AR";
  el("baseCurrency").value = state.config.baseCurrency;

  initTabs(state);
  initIngreso(state);
  initDashboard(state);
  initConfig(state);
  initExport(state);

  state.bus.emit("dashboard:refresh");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("config:refresh");

  if(!modeInfo.connected) toast("Sin carpeta conectada. Usá “Elegir carpeta de datos” o modo manual.", "warn");
  if(!modeInfo.fsSupported) toast("Modo carpeta requiere Chrome/Edge moderno. Usá modo manual.", "warn");

  window.addEventListener("beforeunload", ()=>{
    saveUiState({
      lastActiveMonth: state.activeMonth,
      compareEnabled: state.loadedComparisonMonths.length > 0,
      compareMonths: state.loadedComparisonMonths
    });
  });
}

async function safelyLoadData(){
  const loadedSettings = await safelyLoad("configuración", () => getSettings(), null);
  state.config = loadedSettings || structuredClone(defaults);
  state.tx = await safelyLoad("movimientos", () => listTransactions(), []);
  state.budgetRows = await safelyLoad("presupuestos", () => listBudgets(), []);
  state.budgets = syncBudgetMapFromRows(state.budgetRows);
}

async function safelyLoad(label, fn, fallback){
  try{ return await fn(); }
  catch(err){
    console.error(`Error al cargar ${label}`, err);
    toast(`No se pudo cargar ${label}.`, "warn");
    return fallback;
  }
}

init();
