import { el, toast, downloadBlob, toBase } from "./utils.js";
import { saveTransactions, saveConfig, saveBudgets, getTheme, setTheme } from "./storage.js";

export function initExport(state){
  // theme
  el("btnTheme").addEventListener("click", ()=>{
    const current = getTheme();
    setTheme(current === "dark" ? "light" : "dark");
    toast("Tema: " + getTheme());
    state.bus.emit("dashboard:refresh");
  });

  // export/import/reset/csv
  el("btnExport").addEventListener("click", ()=> exportJSON(state));
  el("fileImport").addEventListener("change", (ev)=> importJSON(state, ev));
  el("btnWipe").addEventListener("click", ()=> wipeAll());

  el("btnCSV").addEventListener("click", ()=> exportCSV(state));
}

export function exportJSON(state){
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    config: state.config,
    budgets: state.budgets,
    transactions: state.tx
  };
  downloadBlob(JSON.stringify(payload, null, 2), `movimientos_export_${Date.now()}.json`, "application/json");
  toast("Exportado ✅");
}

export function importJSON(state, ev){
  const file = ev.target.files?.[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(String(reader.result || "{}"));
      if(parsed && typeof parsed === "object"){
        // v2 expected
        if(Array.isArray(parsed.transactions)) state.tx = parsed.transactions;
        // v1 compat: expenses
        else if(Array.isArray(parsed.expenses)) state.tx = parsed.expenses.map(x=> ({ ...x, type:"expense" }));

        if(parsed.config) state.config = parsed.config;
        if(parsed.budgets && typeof parsed.budgets === "object") state.budgets = parsed.budgets;

        saveTransactions(state.tx);
        saveConfig(state.config);
        saveBudgets(state.budgets);

        toast("Importado ✅ (recargando…)", "warn");
        setTimeout(()=> location.reload(), 600);
      }
    }catch{
      toast("Archivo inválido.", "danger");
    }finally{
      ev.target.value = "";
    }
  };
  reader.readAsText(file);
}

export function exportCSV(state){
  const config = state.config;
  const list = state.tx.slice().sort((a,b)=> (a.date < b.date ? 1 : -1));

  const rows = [
    ["type","date","amount","currency","amount_base","base_currency","category","pay","vendor","desc","tags","notes"]
  ];

  for(const x of list){
    rows.push([
      x.type,
      x.date,
      String(Number(x.amount||0)),
      x.currency,
      String(toBase(x.amount, x.currency, config)),
      config.baseCurrency,
      x.category,
      x.pay,
      (x.vendor||"").replaceAll("\n"," "),
      (x.desc||"").replaceAll("\n"," "),
      (x.tags||[]).join("|"),
      (x.notes||"").replaceAll("\n"," ")
    ]);
  }

  const csv = rows.map(r=> r.map(cell=>{
    const s = String(cell ?? "");
    const needs = /[",\n]/.test(s);
    const esc = s.replaceAll('"','""');
    return needs ? `"${esc}"` : esc;
  }).join(",")).join("\n");

  downloadBlob(csv, `movimientos_${Date.now()}.csv`, "text/csv");
  toast("CSV exportado ✅");
}

export function wipeAll(){
  if(!confirm("Esto borra TODOS los datos locales de esta app. ¿Seguro?")) return;

  localStorage.removeItem("mov_tx_v2");
  localStorage.removeItem("mov_cfg_v2");
  localStorage.removeItem("mov_bud_v2");

  toast("Datos borrados. Recargando…", "warn");
  setTimeout(()=> location.reload(), 600);
}
