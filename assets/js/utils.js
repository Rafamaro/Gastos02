// Utilidades compartidas
export const el = (id) => document.getElementById(id);

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
  return new Intl.NumberFormat(config.locale, { style: "currency", currency }).format(value);
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
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function toBase(amount, currency, config){
  const a = Number(amount) || 0;
  const rate = Number(config?.ratesToBase?.[currency] ?? 1) || 1;
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
    notes: x.notes || ""
  };
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
