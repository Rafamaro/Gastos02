const BUILD_TIMESTAMP = String(window.__BUILD_TIMESTAMP__ || Date.now());
const withBuild = (path) => `${path}?v=${encodeURIComponent(BUILD_TIMESTAMP)}`;

const { el, monthISO, todayISO, fillSelect, toast } = await import(withBuild("./utils.js"));
const { getTheme, setTheme } = await import(withBuild("./storage.js"));
const { APP_VERSION, defaults } = await import(withBuild("./constants.js"));
const { initTabs } = await import(withBuild("./router.js"));
const { initIngreso } = await import(withBuild("./ingreso.js"));
const { initDashboard } = await import(withBuild("./dashboard.js"));
const { initConfig } = await import(withBuild("./config.js"));
const { initExport } = await import(withBuild("./export.js"));
const {
  getSettings,
  listTransactions,
  listBudgets,
  syncBudgetMapFromRows,
  ensureDirectusSession
} = await import(withBuild("./dataStore.js"));

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
  charts: { daily:null, monthly:null, cats:null, monthlyBreakdown:null, pay:null },
  directus: { connected:false, baseUrl:"https://directus.drperez86.com", user:null, role:null, permissions:[], abilities:{} }
};

async function init(){
  setTheme(getTheme());
  await safelyLoadData();

  el("fDate").value = todayISO();
  el("dashMonth").value = monthISO();
  el("budgetMonth").value = monthISO();
  el("budgetMode").value = "category";
  el("pillMonth").textContent = "Mes: " + monthISO();

  const expectedVersion = String(window.__APP_VERSION__ || "").trim();
  console.info(`[App] APP_VERSION=${APP_VERSION}`);

  const versionBadge = el("appVersionBadge");
  if(versionBadge) versionBadge.textContent = `Versión ${APP_VERSION}`;

  if(expectedVersion && expectedVersion !== APP_VERSION){
    toast("Estás viendo assets cacheados", "warn");
  }

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
  state.bus.emit("directus:changed");
}

async function safelyLoadData(){
  const loadedSettings = await safelyLoad("configuración", () => getSettings(), null);
  state.config = loadedSettings || structuredClone(defaults);
  state.tx = await safelyLoad("movimientos", () => listTransactions(), []);
  state.budgetRows = await safelyLoad("presupuestos", () => listBudgets(), []);
  state.budgets = syncBudgetMapFromRows(state.budgetRows);
  const dxSession = await safelyLoad("sesión Directus", () => ensureDirectusSession(), { ok:true, connected:false, permissions:[], abilities:{} });
  state.directus = {
    connected: Boolean(dxSession?.connected),
    baseUrl: dxSession?.baseUrl || "https://directus.drperez86.com",
    user: dxSession?.user || null,
    role: dxSession?.role || null,
    permissions: dxSession?.permissions || [],
    abilities: dxSession?.abilities || {},
    access_token: dxSession?.access_token || "",
    refresh_token: dxSession?.refresh_token || "",
    expires: Number(dxSession?.expires || 0),
    lastError: dxSession?.ok === false ? (dxSession?.error || null) : null
  };
}

async function safelyLoad(label, fn, fallback){
  try{ return await fn(); }
  catch(err){
    console.error(`Error al cargar ${label}`, err);
    toast(err.userMessage || `No se pudo cargar ${label}. Se usaron valores por defecto.`, "warn");
    return fallback;
  }
}

init();
