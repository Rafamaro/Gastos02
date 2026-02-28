import { LS } from "./constants.js";

export function getTheme(){
  return localStorage.getItem(LS.THEME) || "light";
}

export function setTheme(t){
  localStorage.setItem(LS.THEME, t);
  document.documentElement.setAttribute("data-theme", t);
}

export const mergeConfig = (x)=> x;
export const loadConfig = ()=> ({});
export const saveConfig = ()=> {};
export const loadTransactions = ()=> [];
export const saveTransactions = ()=> {};
export const loadBudgets = ()=> ({});
export const saveBudgets = ()=> {};
