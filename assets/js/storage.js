import { LS, defaults } from "./constants.js";
import { normalizeTx } from "./utils.js";

export function mergeConfig(parsed){
  const base = structuredClone(defaults);
  const out = {
    ...base,
    ...(parsed || {}),
    ratesToBase: { ...base.ratesToBase, ...((parsed && parsed.ratesToBase) || {}) }
  };

  // compat: si alguien guardó "categories" sin separar
  if(parsed?.categories && !parsed?.expenseCategories){
    out.expenseCategories = parsed.categories;
  }

  out.expenseCategories = Array.isArray(out.expenseCategories) ? out.expenseCategories : structuredClone(defaults.expenseCategories);
  out.incomeCategories = Array.isArray(out.incomeCategories) ? out.incomeCategories : structuredClone(defaults.incomeCategories);
  out.expenseGroups = Array.isArray(out.expenseGroups) ? out.expenseGroups : structuredClone(defaults.expenseGroups);

  const rawMap = out.expenseCategoryGroups && typeof out.expenseCategoryGroups === "object"
    ? out.expenseCategoryGroups
    : {};
  out.expenseCategoryGroups = Object.fromEntries(
    out.expenseCategories
      .filter(cat => typeof rawMap[cat] === "string" && rawMap[cat].trim())
      .map(cat => [cat, rawMap[cat].trim()])
  );

  out.ratesToBase[out.baseCurrency] = 1;
  return out;
}

export function loadConfig(){
  // v2
  try{
    const raw = localStorage.getItem(LS.CFG);
    if(raw){
      const parsed = JSON.parse(raw);
      return mergeConfig(parsed);
    }
  }catch(err){
    console.error("No se pudo leer configuración v2", err);
  }

  // migration v1
  try{
    const old = localStorage.getItem(LS.OLD_CFG);
    if(old){
      const parsed = JSON.parse(old);
      const v2 = mergeConfig({
        baseCurrency: parsed.baseCurrency,
        currencies: parsed.currencies,
        locale: parsed.locale,
        expenseCategories: parsed.categories || defaults.expenseCategories,
        ratesToBase: parsed.ratesToBase
      });
      localStorage.setItem(LS.CFG, JSON.stringify(v2));
      return v2;
    }
  }catch(err){
    console.error("No se pudo migrar configuración v1", err);
  }

  return structuredClone(defaults);
}

export function saveConfig(config){
  localStorage.setItem(LS.CFG, JSON.stringify(config));
}

export function loadTransactions(config){
  // v2
  try{
    const raw = localStorage.getItem(LS.TX);
    if(raw){
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(x => normalizeTx(x, config)) : [];
    }
  }catch(err){
    console.error("No se pudieron leer movimientos v2", err);
  }

  // migration v1 (solo gastos)
  try{
    const oldRaw = localStorage.getItem(LS.OLD_EXP);
    if(oldRaw){
      const parsed = JSON.parse(oldRaw);
      if(Array.isArray(parsed)){
        const migrated = parsed.map(x => normalizeTx({ ...x, type: "expense" }, config));
        localStorage.setItem(LS.TX, JSON.stringify(migrated));
        return migrated;
      }
    }
  }catch(err){
    console.error("No se pudieron migrar movimientos v1", err);
  }

  return [];
}

export function saveTransactions(tx){
  localStorage.setItem(LS.TX, JSON.stringify(tx));
}

export function loadBudgets(){
  // v2
  try{
    const raw = localStorage.getItem(LS.BUD);
    if(raw) return JSON.parse(raw) || {};
  }catch(err){
    console.error("No se pudieron leer presupuestos v2", err);
  }

  // migration v1
  try{
    const old = localStorage.getItem(LS.OLD_BUD);
    if(old){
      const parsed = JSON.parse(old) || {};
      localStorage.setItem(LS.BUD, JSON.stringify(parsed));
      return parsed;
    }
  }catch(err){
    console.error("No se pudieron migrar presupuestos v1", err);
  }

  return {};
}

export function saveBudgets(budgets){
  localStorage.setItem(LS.BUD, JSON.stringify(budgets));
}

export function getTheme(){
  return localStorage.getItem(LS.THEME) || "light";
}

export function setTheme(t){
  localStorage.setItem(LS.THEME, t);
  document.documentElement.setAttribute("data-theme", t);
}
