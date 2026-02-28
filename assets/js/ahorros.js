import { el, monthISO, toast, toBase, resolveRate, fmtMoney } from "./utils.js";
import { createTransaction, deleteTransaction, listTransactions } from "./dataStore.js";

const FX_CURRENCIES = ["USD", "EUR", "COP", "USDT", "USDC", "TUSD", "DJED"];
const BUY_CATEGORY = "Compra de divisas";
const SELL_CATEGORY = "Venta de divisas";

function monthToDate(month){
  return `${month}-01`;
}

function isFxCategoryTx(tx){
  return tx.category === BUY_CATEGORY || tx.category === SELL_CATEGORY;
}

function isTrackedFxTx(tx, config){
  if(!tx) return false;
  if(isFxCategoryTx(tx)) return true;
  return String(tx.currency || "") !== String(config.baseCurrency || "");
}

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

  if(!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0){
    el("fxBasePreview").value = "";
    return;
  }

  const baseAmount = toBase(amount, currency, state.config, el("fxMonth").value || monthISO(), rate);
  el("fxBasePreview").value = fmtMoney(baseAmount, state.config.baseCurrency, state.config);
}

function clearFxForm(state){
  el("fxMonth").value = monthISO();
  el("fxType").value = "buy";
  el("fxAmount").value = "";
  el("fxRate").value = "";
  el("fxBasePreview").value = "";
  el("fxNotes").value = "";
  updateBasePreview(state);
}

async function saveFxOperation(state){
  const month = el("fxMonth").value;
  const currency = el("fxCurrency").value;
  const type = el("fxType").value;
  const amount = Number(el("fxAmount").value);
  const fxRate = Number(el("fxRate").value);

  if(!month){
    toast("Elegí un mes.", "danger");
    return;
  }
  if(!currency){
    toast("Elegí una divisa.", "danger");
    return;
  }
  if(!Number.isFinite(amount) || amount <= 0){
    toast("Ingresá un monto válido.", "danger");
    return;
  }
  if(!Number.isFinite(fxRate) || fxRate <= 0){
    toast("Ingresá la tasa de operación (> 0).", "danger");
    return;
  }

  const isBuy = type === "buy";
  const category = isBuy ? BUY_CATEGORY : SELL_CATEGORY;

  await createTransaction({
    date: monthToDate(month),
    type: isBuy ? "expense" : "income",
    amount,
    currency,
    fxRate,
    category,
    categoryId: category,
    pay: isBuy ? "Compra de divisas" : "Venta de divisas",
    vendor: "Operación mensual de divisas",
    notes: el("fxNotes").value.trim(),
    desc: el("fxNotes").value.trim(),
    tags: ["divisas", type === "buy" ? "compra" : "venta"]
  });

  state.tx = await listTransactions();
  toast(`Operación registrada: ${isBuy ? "compra" : "venta"} ${currency}.`);
  state.bus.emit("tx:changed");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("dashboard:refresh");
  renderFxList(state);
}

async function handleDelete(state, id){
  await deleteTransaction(id);
  state.tx = await listTransactions();
  state.bus.emit("tx:changed");
  state.bus.emit("ingreso:refresh");
  state.bus.emit("dashboard:refresh");
  renderFxList(state);
  toast("Operación de divisas eliminada.");
}

function renderFxList(state){
  const month = el("fxMonth").value || monthISO();
  const fxTx = (state.tx || [])
    .filter(tx => String(tx.date || "").startsWith(month) && isTrackedFxTx(tx, state.config))
    .sort((a,b)=> a.date < b.date ? 1 : -1);

  el("fxMonthHint").textContent = `Mes seleccionado: ${month}. También se listan ingresos/gastos en divisas cargados desde la pestaña Ingreso.`;

  if(!fxTx.length){
    el("fxTbody").innerHTML = '<tr><td colspan="7" class="muted">No hay operaciones para este mes.</td></tr>';
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
        <td><button class="btn small danger" data-fx-del="${tx.id}">Eliminar</button></td>
      </tr>
    `;
  }).join("");
}

export function initAhorros(state){
  fillFxCurrencies(state);
  clearFxForm(state);

  el("btnFxSave").addEventListener("click", ()=> saveFxOperation(state).catch(err => {
    toast(err?.message || "No se pudo registrar la operación.", "danger");
  }));

  el("btnFxClear").addEventListener("click", ()=> clearFxForm(state));
  el("fxMonth").addEventListener("change", ()=> {
    renderFxList(state);
    updateBasePreview(state);
  });
  el("fxAmount").addEventListener("input", ()=> updateBasePreview(state));
  el("fxRate").addEventListener("input", ()=> updateBasePreview(state));
  el("fxCurrency").addEventListener("change", ()=> updateBasePreview(state));

  el("fxTbody").addEventListener("click", (ev)=>{
    const btn = ev.target.closest("[data-fx-del]");
    if(!btn) return;
    handleDelete(state, btn.dataset.fxDel).catch(err => {
      toast(err?.message || "No se pudo eliminar.", "danger");
    });
  });

  state.bus.on("ahorros:refresh", ()=> renderFxList(state));
  state.bus.on("config:changed", ()=> {
    fillFxCurrencies(state);
    updateBasePreview(state);
    renderFxList(state);
  });
  state.bus.on("tx:changed", ()=> renderFxList(state));

  renderFxList(state);
}
