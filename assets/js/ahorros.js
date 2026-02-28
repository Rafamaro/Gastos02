import { el, monthISO, toast, toBase, resolveRate, fmtMoney } from "./utils.js";
import { createTransaction, deleteTransaction, listTransactions, updateTransaction, listAvailableMonths, getMonth } from "./dataStore.js";

const FX_CURRENCIES = ["USD", "EUR", "COP", "USDT", "USDC", "TUSD", "DJED"];
const BUY_CATEGORY = "Compra de divisas";
const SELL_CATEGORY = "Venta de divisas";

function monthToDate(month){ return `${month}-01`; }
function isFxCategoryTx(tx){ return tx.category === BUY_CATEGORY || tx.category === SELL_CATEGORY; }
function isTrackedFxTx(tx, config){ return isFxCategoryTx(tx) || String(tx.currency || "") !== String(config.baseCurrency || ""); }
function operationLabel(tx){
  if(tx.category === BUY_CATEGORY) return "Compra";
  if(tx.category === SELL_CATEGORY) return "Venta";
  return tx.type === "income" ? "Ingreso" : "Gasto";
}

function fillFxCurrencies(state){
  const available = (state.config?.currencies || []).filter(c => FX_CURRENCIES.includes(c));
  const currencies = available.length ? available : FX_CURRENCIES;
  el("fxCurrency").innerHTML = currencies.map(c => `<option value="${c}">${c}</option>`).join("");
}

function updateBasePreview(state){
  const amount = Number(el("fxAmount").value);
  const rate = Number(el("fxRate").value);
  const currency = el("fxCurrency").value;
  if(!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0){ el("fxBasePreview").value = ""; return; }
  const baseAmount = toBase(amount, currency, state.config, el("fxMonth").value || monthISO(), rate);
  el("fxBasePreview").value = fmtMoney(baseAmount, state.config.baseCurrency, state.config);
}

function clearFxForm(state){
  el("fxMonth").value = monthISO();
  el("fxType").value = "buy";
  el("fxAmount").value = "";
  el("fxRate").value = "";
  el("fxBasePreview").value = "";
  el("fxAffectsNet").checked = true;
  el("fxNotes").value = "";
  updateBasePreview(state);
}

async function saveFxOperation(state){
  const month = el("fxMonth").value;
  const currency = el("fxCurrency").value;
  const type = el("fxType").value;
  const amount = Number(el("fxAmount").value);
  const fxRate = Number(el("fxRate").value);
  const includeInNet = el("fxAffectsNet").checked;

  if(!month) return toast("Elegí un mes.", "danger");
  if(!currency) return toast("Elegí una divisa.", "danger");
  if(!Number.isFinite(amount) || amount <= 0) return toast("Ingresá un monto válido.", "danger");
  if(!Number.isFinite(fxRate) || fxRate <= 0) return toast("Ingresá la tasa de operación (> 0).", "danger");

  const isBuy = type === "buy";
  const category = isBuy ? BUY_CATEGORY : SELL_CATEGORY;

  await createTransaction({
    date: monthToDate(month),
    type: isBuy ? "expense" : "income",
    amount, currency, fxRate, includeInNet,
    category, categoryId: category,
    pay: isBuy ? "Compra de divisas" : "Venta de divisas",
    vendor: "Operación mensual de divisas",
    notes: el("fxNotes").value.trim(),
    desc: el("fxNotes").value.trim(),
    tags: ["divisas", isBuy ? "compra" : "venta"]
  });

  state.tx = await listTransactions();
  toast(`Operación registrada: ${isBuy ? "compra" : "venta"} ${currency}.`);
  state.bus.emit("tx:changed");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("dashboard:refresh");
  await renderAll(state);
}

async function handleDelete(state, id){
  await deleteTransaction(id);
  state.tx = await listTransactions();
  state.bus.emit("tx:changed");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("dashboard:refresh");
  await renderAll(state);
  toast("Operación de divisas eliminada.");
}

async function toggleIncludeInNet(state, id, checked){
  await updateTransaction(id, { includeInNet: Boolean(checked) });
  state.tx = await listTransactions();
  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
  await renderAll(state);
}

function renderFxList(state){
  const month = el("fxMonth").value || monthISO();
  const fxTx = (state.tx || [])
    .filter(tx => String(tx.date || "").startsWith(month) && isTrackedFxTx(tx, state.config))
    .sort((a,b)=> a.date < b.date ? 1 : -1);

  el("fxMonthHint").textContent = `Mes seleccionado: ${month}. Incluye operaciones de Ahorros + ingresos/gastos en divisas desde Ingreso.`;

  if(!fxTx.length){
    el("fxTbody").innerHTML = '<tr><td colspan="8" class="muted">No hay operaciones para este mes.</td></tr>';
    return;
  }

  el("fxTbody").innerHTML = fxTx.map(tx => {
    const usedRate = resolveRate(tx.currency, state.config, tx.date, tx.fxRate);
    const baseAmount = toBase(tx.amount, tx.currency, state.config, tx.date, tx.fxRate);
    return `
      <tr>
        <td>${tx.date || "-"}</td>
        <td>${operationLabel(tx)}</td>
        <td>${tx.currency || "-"}</td>
        <td>${Number(tx.amount || 0).toFixed(2)}</td>
        <td>${usedRate.toFixed(4)}</td>
        <td>${fmtMoney(baseAmount, state.config.baseCurrency, state.config)}</td>
        <td><input type="checkbox" data-fx-net="${tx.id}" ${tx.includeInNet !== false ? "checked" : ""} /></td>
        <td><button class="btn small danger" data-fx-del="${tx.id}">Eliminar</button></td>
      </tr>
    `;
  }).join("");
}

async function buildHistoryFromAllMonths(state){
  const months = await listAvailableMonths();
  const history = [];
  for(const month of months){
    const monthObj = await getMonth(month);
    const movements = (monthObj?.movements || []).map(m => ({
      id: m.id,
      date: m.date,
      month,
      type: m.type,
      amount: Number(m.amount) || 0,
      currency: m.currency || state.config.baseCurrency,
      category: m.categoryId,
      pay: m.paymentMethodId || "",
      fxRate: Number(m.exchangeRate || m.fxRate) || null,
      includeInNet: m.includeInNet !== false
    }));
    history.push(...movements);
  }
  return history;
}

function summarizeSavings(state, history){
  const cfg = state.config;
  const byCurrency = new Map();
  const byMonth = new Map();

  for(const tx of history){
    if(!isTrackedFxTx(tx, cfg)) continue;
    const sign = tx.type === "expense" ? 1 : -1; // compra suma stock, venta resta stock
    const qty = sign * (Number(tx.amount) || 0);
    byCurrency.set(tx.currency, (byCurrency.get(tx.currency) || 0) + qty);

    const monthKey = String(tx.date || tx.month || "").slice(0,7);
    if(!monthKey) continue;
    const usdRate = resolveRate(tx.currency, cfg, tx.date || monthKey, null) / resolveRate("USD", cfg, tx.date || monthKey, null);
    const usdDelta = qty * (Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 1);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + usdDelta);
  }

  const rows = [...byCurrency.entries()].map(([currency, qty]) => {
    const usdVal = toBase(qty, currency, cfg, "", null) / resolveRate("USD", cfg, "", null);
    return { currency, qty, usdVal };
  }).sort((a,b)=> b.usdVal - a.usdVal);

  const totalUsd = rows.reduce((s,r)=> s + r.usdVal, 0);
  const monthSeries = [...byMonth.entries()].sort((a,b)=> a[0].localeCompare(b[0]));
  const cumulative = [];
  let acc = 0;
  for(const [m, delta] of monthSeries){
    acc += delta;
    cumulative.push({ month: m, totalUsd: acc });
  }

  return { rows, totalUsd, cumulative };
}

function destroyFxCharts(state){
  state.fxCharts = state.fxCharts || { composition: null, growth: null };
  Object.keys(state.fxCharts).forEach(k => {
    if(state.fxCharts[k]){ state.fxCharts[k].destroy(); state.fxCharts[k] = null; }
  });
}

function renderFxDashboard(state, summary){
  const cfg = state.config;
  const total = summary.totalUsd;
  const parts = summary.rows.map(r => ({ ...r, pct: total !== 0 ? (r.usdVal / total) * 100 : 0 }));
  const prev = summary.cumulative.length >= 2 ? summary.cumulative[summary.cumulative.length - 2].totalUsd : 0;
  const current = summary.cumulative.length ? summary.cumulative[summary.cumulative.length - 1].totalUsd : 0;
  const growthPct = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : 0;
  const growthColor = growthPct >= 0 ? "#22c55e" : "#ef4444";

  el("fxKpi").innerHTML = `
    <div class="box">
      <div class="label">Ahorros totales (USD)</div>
      <div class="value">${fmtMoney(total, "USD", cfg)}</div>
      <div class="sub">Usa tasas de Config para convertir divisas</div>
    </div>
    <div class="box">
      <div class="label">Crecimiento mensual</div>
      <div class="value" style="color:${growthColor}">${growthPct.toFixed(2)}%</div>
      <div class="sub">Comparación contra el mes anterior</div>
    </div>
    <div class="box">
      <div class="label">Composición principal</div>
      <div class="value">${parts[0] ? parts[0].currency : "—"}</div>
      <div class="sub">${parts[0] ? parts[0].pct.toFixed(1) + "%" : "Sin datos"}</div>
    </div>
  `;

  if(typeof Chart === "undefined"){
    el("fxFallbackComposition").style.display = "block";
    el("fxFallbackComposition").textContent = "No se pudo cargar Chart.js.";
    el("fxFallbackGrowth").style.display = "block";
    el("fxFallbackGrowth").textContent = "No se pudo cargar Chart.js.";
    destroyFxCharts(state);
    return;
  }

  el("fxFallbackComposition").style.display = "none";
  el("fxFallbackGrowth").style.display = "none";
  destroyFxCharts(state);

  state.fxCharts.composition = new Chart(el("fxChartComposition"), {
    type: "doughnut",
    data: {
      labels: parts.map(p => `${p.currency} (${p.pct.toFixed(1)}%)`),
      datasets: [{ data: parts.map(p => Number(p.usdVal.toFixed(2))) }]
    },
    options: { responsive: true }
  });

  const growthSeries = [];
  for(let i=0;i<summary.cumulative.length;i++){
    if(i===0){ growthSeries.push(0); continue; }
    const p = summary.cumulative[i-1].totalUsd;
    const c = summary.cumulative[i].totalUsd;
    growthSeries.push(p !== 0 ? ((c-p)/Math.abs(p))*100 : 0);
  }

  state.fxCharts.growth = new Chart(el("fxChartGrowth"), {
    type: "bar",
    data: {
      labels: summary.cumulative.map(x => x.month),
      datasets: [{
        label: "Crecimiento mensual (%)",
        data: growthSeries.map(v=> Number(v.toFixed(2))),
        backgroundColor: growthSeries.map(v=> v >= 0 ? "rgba(34,197,94,.6)" : "rgba(239,68,68,.6)"),
        borderColor: growthSeries.map(v=> v >= 0 ? "#22c55e" : "#ef4444"),
        borderWidth: 1
      }]
    },
    options: { responsive: true }
  });
}

async function renderAll(state){
  renderFxList(state);
  const history = await buildHistoryFromAllMonths(state);
  const summary = summarizeSavings(state, history);
  renderFxDashboard(state, summary);
}

export function initAhorros(state){
  state.fxCharts = { composition: null, growth: null };
  fillFxCurrencies(state);
  clearFxForm(state);

  el("btnFxSave").addEventListener("click", ()=> saveFxOperation(state).catch(err => toast(err?.message || "No se pudo registrar la operación.", "danger")));
  el("btnFxClear").addEventListener("click", ()=> clearFxForm(state));
  el("fxMonth").addEventListener("change", ()=> { renderFxList(state); updateBasePreview(state); });
  el("fxAmount").addEventListener("input", ()=> updateBasePreview(state));
  el("fxRate").addEventListener("input", ()=> updateBasePreview(state));
  el("fxCurrency").addEventListener("change", ()=> updateBasePreview(state));

  el("fxTbody").addEventListener("click", (ev)=>{
    const delBtn = ev.target.closest("[data-fx-del]");
    if(delBtn) return handleDelete(state, delBtn.dataset.fxDel).catch(err => toast(err?.message || "No se pudo eliminar.", "danger"));
  });

  el("fxTbody").addEventListener("change", (ev)=>{
    const cb = ev.target.closest("[data-fx-net]");
    if(!cb) return;
    toggleIncludeInNet(state, cb.dataset.fxNet, cb.checked).catch(err => toast(err?.message || "No se pudo actualizar el neto.", "danger"));
  });

  state.bus.on("ahorros:refresh", ()=> { renderAll(state).catch(()=>{}); });
  state.bus.on("config:changed", ()=> { fillFxCurrencies(state); updateBasePreview(state); renderAll(state).catch(()=>{}); });
  state.bus.on("tx:changed", ()=> { renderAll(state).catch(()=>{}); });

  renderAll(state).catch(()=>{});
}
