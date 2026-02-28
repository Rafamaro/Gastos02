import { el, monthISO, toast } from "./utils.js";
import { createTransaction, deleteTransaction, listTransactions } from "./dataStore.js";

const FX_CURRENCIES = ["USD", "EUR", "COP", "USDT", "USDC", "DJED"];
const BUY_CATEGORY = "Compra de divisas";
const SELL_CATEGORY = "Venta de divisas";

function monthToDate(month){
  return `${month}-01`;
}

function isFxTx(tx){
  return tx.category === BUY_CATEGORY || tx.category === SELL_CATEGORY;
}

function isFxSell(tx){
  return tx.category === SELL_CATEGORY;
}

function fillFxCurrencies(state){
  const available = (state.config?.currencies || []).filter(c => FX_CURRENCIES.includes(c));
  const currencies = available.length ? available : FX_CURRENCIES;
  el("fxCurrency").innerHTML = currencies.map(c => `<option value="${c}">${c}</option>`).join("");
}

function clearFxForm(){
  el("fxMonth").value = monthISO();
  el("fxType").value = "buy";
  el("fxAmount").value = "";
  el("fxNotes").value = "";
}

async function saveFxOperation(state){
  const month = el("fxMonth").value;
  const currency = el("fxCurrency").value;
  const type = el("fxType").value;
  const amount = Number(el("fxAmount").value);

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

  const isBuy = type === "buy";
  const category = isBuy ? BUY_CATEGORY : SELL_CATEGORY;

  await createTransaction({
    date: monthToDate(month),
    type: isBuy ? "expense" : "income",
    amount,
    currency,
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
    .filter(tx => String(tx.date || "").startsWith(month) && isFxTx(tx))
    .sort((a,b)=> a.date < b.date ? 1 : -1);

  el("fxMonthHint").textContent = `Mes seleccionado: ${month}`;

  if(!fxTx.length){
    el("fxTbody").innerHTML = '<tr><td colspan="5" class="muted">No hay operaciones para este mes.</td></tr>';
    return;
  }

  el("fxTbody").innerHTML = fxTx.map(tx => `
    <tr>
      <td>${tx.date || "-"}</td>
      <td>${isFxSell(tx) ? "Venta" : "Compra"}</td>
      <td>${tx.currency || "-"}</td>
      <td>${Number(tx.amount || 0).toFixed(2)}</td>
      <td><button class="btn small danger" data-fx-del="${tx.id}">Eliminar</button></td>
    </tr>
  `).join("");
}

export function initAhorros(state){
  fillFxCurrencies(state);
  clearFxForm();

  el("btnFxSave").addEventListener("click", ()=> saveFxOperation(state).catch(err => {
    toast(err?.message || "No se pudo registrar la operación.", "danger");
  }));

  el("btnFxClear").addEventListener("click", ()=> clearFxForm());
  el("fxMonth").addEventListener("change", ()=> renderFxList(state));

  el("fxTbody").addEventListener("click", (ev)=>{
    const btn = ev.target.closest("[data-fx-del]");
    if(!btn) return;
    handleDelete(state, btn.dataset.fxDel).catch(err => {
      toast(err?.message || "No se pudo eliminar.", "danger");
    });
  });

  state.bus.on("ahorros:refresh", ()=> renderFxList(state));
  state.bus.on("config:changed", ()=> fillFxCurrencies(state));
  state.bus.on("tx:changed", ()=> renderFxList(state));

  renderFxList(state);
}
