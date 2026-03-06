// Utilidades compartidas
export const el = (id) => document.getElementById(id);

const ANONYMIZE_KEY = "gastos02:anonymize-values";

export function isAnonymized(){
  return localStorage.getItem(ANONYMIZE_KEY) === "1";
}

export function setAnonymized(enabled){
  localStorage.setItem(ANONYMIZE_KEY, enabled ? "1" : "0");
  document.documentElement.classList.toggle("anonymized", Boolean(enabled));
}

export function maskedValue(value){
  return isAnonymized() ? "*" : value;
}

export function fillSelect(select, items){
  select.innerHTML = "";
  for(const it of items){
    const o = document.createElement("option");
    o.value = it;
    o.textContent = it;
    select.appendChild(o);
  }
}

export function fmtMoney(n, currency, config){
  const value = Number.isFinite(n) ? n : 0;
  const locale = config?.locale || "es-AR";
  const safeCurrency = String(currency || "").trim().toUpperCase();

  const isIntlCurrency = (()=>{
    if(!safeCurrency) return false;
    if(typeof Intl.supportedValuesOf === "function"){
      const supported = Intl.supportedValuesOf("currency").map(code => String(code || "").toUpperCase());
      return supported.includes(safeCurrency);
    }

    try{
      new Intl.NumberFormat(locale, { style: "currency", currency: safeCurrency });
      return true;
    }catch(_err){
      return false;
    }
  })();

  const out = isIntlCurrency
    ? new Intl.NumberFormat(locale, { style: "currency", currency: safeCurrency }).format(value)
    : `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    }).format(value)} ${safeCurrency || "—"}`;

  return isAnonymized() ? "*" : out;
}

export function todayISO(){
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export function monthISO(d = new Date()){
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 7);
}

export function toast(msg, type="ok"){
  const toastEl = el("toast");
  const dot = el("toastDot");
  el("toastMsg").textContent = msg;

  dot.style.background = type==="danger" ? "var(--danger)" : type==="warn" ? "var(--warn)" : "var(--ok)";
  dot.style.boxShadow = `0 0 0 3px color-mix(in oklab, ${type==="danger" ? "var(--danger)" : type==="warn" ? "var(--warn)" : "var(--ok)"} 25%, transparent)`;

  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> toastEl.classList.remove("show"), 2600);
}

export function id(){
  if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function monthFromDateLike(value){
  const raw = String(value || "").trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  if(/^\d{4}-\d{2}$/.test(raw)) return raw;
  return "";
}

export function resolveRate(currency, config, dateLike = "", customRate = null){
  const overrideRate = Number(customRate);
  if(Number.isFinite(overrideRate) && overrideRate > 0) return overrideRate;

  const ccy = String(currency || "").toUpperCase();
  const stableCoins = ["USDT", "USDC", "TUSD", "DJED", "DAI"];
  const effectiveCurrency = stableCoins.includes(ccy) ? "USD" : ccy;

  const monthKey = monthFromDateLike(dateLike);
  const monthRate = monthKey ? Number(config?.ratesByMonth?.[monthKey]?.[effectiveCurrency]) : NaN;
  const fallbackRate = Number(config?.ratesToBase?.[effectiveCurrency] ?? 1);

  return Number.isFinite(monthRate) && monthRate > 0
    ? monthRate
    : (Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 1);
}

export function toBase(amount, currency, config, dateLike = "", customRate = null){
  const a = Number(amount) || 0;
  const rate = resolveRate(currency, config, dateLike, customRate);
  return a * rate;
}

export function safeTags(str){
  return String(str || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function normalizeTx(x, config){
  const type = (x.type==="income" || x.type==="expense" || x.type==="reentry") ? x.type : "expense";
  const linkedExpenseId = String(x.linkedExpenseId || "").trim();
  return {
    id: x.id || id(),
    type,
    date: x.date || todayISO(),
    amount: Number(x.amount) || 0,
    currency: x.currency || config.baseCurrency,
    category: x.category || (type==="income" ? "Otros ingresos" : type==="reentry" ? "Reintegro" : "Otros"),
    pay: x.pay || (type==="expense" ? "Tarjeta" : type==="reentry" ? "Reintegro" : "Transferencia"),
    vendor: x.vendor || "",
    desc: x.desc || "",
    tags: Array.isArray(x.tags) ? x.tags : safeTags(x.tags),
    notes: x.notes || "",
    fxRate: Number(x.fxRate) || null,
    includeInNet: x.includeInNet !== false,
    linkedExpenseId: linkedExpenseId || null
  };
}

export function isReentryTx(tx){
  if(tx?.type !== "income") return false;
  return String(tx.pay || "").trim().toLowerCase() === "reintegro";
}

export function buildEffectiveExpenseEntries(txList = [], config){
  const expenses = txList.filter(tx => tx?.type === "expense");
  const discountByExpenseId = new Map();

  for(const tx of txList){
    if(!isReentryTx(tx)) continue;
    const linkedExpenseId = String(tx?.linkedExpenseId || "").trim();
    if(!linkedExpenseId) continue;
    const amountBase = toBase(Number(tx.amount) || 0, tx.currency, config, tx.date, tx.fxRate);
    if(!(amountBase > 0)) continue;
    discountByExpenseId.set(linkedExpenseId, (discountByExpenseId.get(linkedExpenseId) || 0) + amountBase);
  }

  return expenses.map(expense => {
    const amountBase = toBase(Number(expense.amount) || 0, expense.currency, config, expense.date, expense.fxRate);
    const discount = Math.min(amountBase, discountByExpenseId.get(String(expense.id || "")) || 0);
    return {
      ...expense,
      amountBase,
      linkedReentryBase: discount,
      effectiveAmountBase: Math.max(0, amountBase - discount)
    };
  });
}

export function sortTx(list){
  return list.slice().sort((a,b)=>{
    if(a.date === b.date){
      // ingreso primero si mismo día; luego monto desc
      if(a.type !== b.type){
        const rank = { income: 0, reentry: 1, expense: 2 };
        return (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
      }
      return (b.amount||0) - (a.amount||0);
    }
    return a.date < b.date ? 1 : -1;
  });
}

export function escapeHTML(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

export function groupSum(list, keyFn, valFn){
  const m = new Map();
  for(const x of list){
    const k = keyFn(x);
    const v = Number(valFn(x)) || 0;
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m.entries()]
    .map(([key,value])=>({key,value}))
    .sort((a,b)=> b.value - a.value);
}

export function topEntry(arr){
  return arr && arr.length ? arr[0] : null;
}

export async function downloadBlob(content, filename, type, options = {}){
  const blob = new Blob([content], { type });
  const pickerTypes = options?.pickerTypes || [{ description: type || "Archivo", accept: { [type || "application/octet-stream"]: [`.${String(filename || "").split(".").pop() || "txt"}`] } }];

  if(window?.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: pickerTypes,
        excludeAcceptAllOption: false
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }catch(err){
      if(err?.name !== "AbortError") console.warn("No se pudo guardar con selector de archivos, se usará descarga del navegador.", err);
      if(err?.name === "AbortError") return false;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
