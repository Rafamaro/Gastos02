import { el, toast, toBase } from "./utils.js";
import { getTheme, setTheme } from "./storage.js";
import { getConfig, saveConfig, importMonthlyJson, listTransactions, listBudgets, syncBudgetMapFromRows, saveMonth, getMonth } from "./dataStore.js";
import { importJsonFromFile, exportJsonToDownload } from "./storage/fallbackFiles.js";

export function initExport(state){
  el("btnTheme").addEventListener("click", ()=>{
    const current = getTheme();
    setTheme(current === "dark" ? "light" : "dark");
    toast("Tema: " + getTheme());
    state.bus.emit("dashboard:refresh");
  });

  el("btnExport").addEventListener("click", async ()=> exportJSON(state));
  el("fileImport").addEventListener("change", (ev)=> importJSON(state, ev));
  el("btnWipe").addEventListener("click", ()=> wipeAll());
  el("btnCSV").addEventListener("click", async ()=> exportCSV(state));

  el("importMonthFile")?.addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0];
    if(!file) return;
    const parsed = await importJsonFromFile(file);
    if(!parsed?.month || !Array.isArray(parsed.movements)) return toast("JSON mensual inválido", "danger");
    await saveMonth(parsed.month, parsed);
    toast("Mes importado ✅");
    ev.target.value = "";
  });

  el("btnExportMonth")?.addEventListener("click", async ()=>{
    const month = state.activeMonth;
    const payload = await getMonth(month);
    await exportJsonToDownload(`${month}.json`, payload);
    toast("Mes exportado ✅");
  });

  el("importConfigFile")?.addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0];
    if(!file) return;
    try{
      const parsed = await importJsonFromFile(file);
      if(parsed.config){
        await saveConfig(parsed.config);
        if(Array.isArray(parsed.months)){
          for(const m of parsed.months) await saveMonth(m.month, m);
        }
      }else if(parsed.categories && parsed.groups && parsed.payment_methods){
        await saveConfig(parsed);
      }else throw new Error("Falta schema mínimo de configuración");
      toast("Configuración importada ✅");
      setTimeout(()=> location.reload(), 300);
    }catch(err){ toast(err.message, "danger"); }
    ev.target.value = "";
  });
}

export async function exportJSON(state){
  const payload = { version: 1, config: await getConfig(), transactions: state.tx };
  await exportJsonToDownload(`gastos02_backup_${Date.now()}.json`, payload);
  toast("Exportado ✅");
}

export async function importJSON(state, ev){
  const file = ev.target.files?.[0];
  if(!file) return;
  try{
    const parsed = await importJsonFromFile(file);
    if(parsed.config) await saveConfig(parsed.config);
    if(Array.isArray(parsed.transactions)){
      const byMonth = new Map();
      for(const tx of parsed.transactions){
        const m = String(tx.date || "").slice(0,7);
        if(!m) continue;
        if(!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(tx);
      }
      for(const [month, list] of byMonth.entries()) await importMonthlyJson({ month, movements: list });
    }
    state.tx = await listTransactions();
    state.budgetRows = await listBudgets();
    state.budgets = syncBudgetMapFromRows(state.budgetRows);
    toast("Importado ✅");
    setTimeout(()=> location.reload(), 300);
  }catch(err){ toast(err?.message || "Archivo inválido", "danger"); }
  ev.target.value = "";
}

export async function exportCSV(state){
  const config = state.config;
  const list = state.tx.slice().sort((a,b)=> (a.date < b.date ? 1 : -1));
  const rows = [["type","date","amount","currency","amount_base","base_currency","category","pay","tags","notes"]];
  for(const x of list){ rows.push([x.type,x.date,String(Number(x.amount||0)),x.currency,String(toBase(x.amount, x.currency, config, x.date)),config.baseCurrency,x.category,x.pay,(x.tags||[]).join("|"),x.notes||""]); }
  const csv = rows.map(r=> r.join(",")).join("\n");
  await exportJsonToDownload(`movimientos_${Date.now()}.csv`, csv);
  toast("CSV exportado ✅");
}

export function wipeAll(){
  if(!confirm("Esto borra datos manuales locales. ¿Seguro?")) return;
  Object.keys(localStorage).filter(k=>k.startsWith("gastos02:")).forEach(k=> localStorage.removeItem(k));
  toast("Datos borrados.", "warn");
  setTimeout(()=> location.reload(), 300);
}
