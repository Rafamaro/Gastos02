import { el, fillSelect, fmtMoney, toBase, safeTags, normalizeTx, sortTx, todayISO, monthISO, toast, escapeHTML } from "./utils.js";
import { saveTransactions } from "./storage.js";

export function initIngreso(state){
  // listeners de refresco externo
  state.bus.on("config:changed", ()=> {
    refreshCategorySelects(state);
    updateAmountHint(state);
    syncLabelsByType(state);
    // re-render si estamos en ingreso
    state.bus.emit("ingreso:refresh");
  });

  state.bus.on("ingreso:refresh", ()=> renderList(state));

  // tipo radio
  document.querySelectorAll('input[name="fType"]').forEach(r=>{
    r.addEventListener("change", ()=>{
      refreshCategorySelects(state);
      syncLabelsByType(state);
    });
  });

  // botones form
  el("btnAdd").addEventListener("click", ()=> addTx(state));
  el("btnClear").addEventListener("click", ()=> clearForm(state));

  // filtros
  ["qSearch","qType","qCategory","qFrom","qTo"].forEach(id=>{
    el(id).addEventListener("input", ()=>{ state.page=1; renderList(state); });
    el(id).addEventListener("change", ()=>{ state.page=1; renderList(state); });
  });

  // quick
  el("btnQuickToday").addEventListener("click", ()=>{
    el("qFrom").value = todayISO();
    el("qTo").value = todayISO();
    state.page = 1;
    renderList(state);
    toast("Filtro: hoy");
    state.bus.emit("dashboard:refresh");
  });
  el("btnQuickMonth").addEventListener("click", ()=>{
    const m = monthISO();
    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
    el("qFrom").value = `${m}-01`;
    el("qTo").value = `${m}-${String(lastDay).padStart(2,"0")}`;
    state.page = 1;
    renderList(state);
    toast("Filtro: mes actual");
    state.bus.emit("dashboard:refresh");
  });

  // paging
  el("btnPrevPage").addEventListener("click", ()=>{
    state.page = Math.max(1, state.page-1);
    renderList(state);
  });
  el("btnNextPage").addEventListener("click", ()=>{
    state.page = state.page + 1;
    renderList(state);
  });

  // modal edit
  el("btnCloseDlg").addEventListener("click", ()=> el("dlgEdit").close());
  el("btnCancelEdit").addEventListener("click", ()=> el("dlgEdit").close());
  el("btnSaveEdit").addEventListener("click", ()=> saveEdit(state));
  el("btnDelete").addEventListener("click", ()=> deleteEdit(state));
  el("eType").addEventListener("change", ()=> refreshCategorySelects(state));

  // amount hint
  el("fAmount").addEventListener("input", ()=> updateAmountHint(state));
  el("fCurrency").addEventListener("change", ()=> updateAmountHint(state));

  // primer render
  refreshCategorySelects(state);
  syncLabelsByType(state);
  renderList(state);
}

export function currentFormType(){
  return document.querySelector('input[name="fType"]:checked')?.value || "expense";
}

function unionCategories(config){
  const set = new Set([...(config.expenseCategories||[]), ...(config.incomeCategories||[])]);
  return [...set];
}

export function refreshCategorySelects(state){
  const config = state.config;

  // form category depende del tipo
  const t = currentFormType();
  const cats = t==="income" ? config.incomeCategories : config.expenseCategories;
  fillSelect(el("fCategory"), cats.length ? cats : ["Otros"]);

  // filtro usa unión y conserva selección previa si sigue disponible
  const qCategory = el("qCategory");
  const previousFilter = qCategory.value;
  const allCategories = ["(Todas)", ...unionCategories(config)];
  fillSelect(qCategory, allCategories);
  qCategory.value = allCategories.includes(previousFilter) ? previousFilter : "(Todas)";

  // edit depende del tipo actual de edición
  const et = el("eType").value || "expense";
  const ecats = et==="income" ? config.incomeCategories : config.expenseCategories;
  fillSelect(el("eCategory"), ecats.length ? ecats : ["Otros"]);
}

export function syncLabelsByType(state){
  const t = currentFormType();
  el("labVendor").textContent = t==="income" ? "Origen" : "Comercio / Lugar";
  el("labPay").textContent = t==="income" ? "Fuente / Medio" : "Medio de pago";
  el("labCategory").textContent = "Categoría";
  el("hintType").textContent = t==="income"
    ? "Ingreso: suma al neto."
    : "Gasto: resta al neto (y aplica presupuesto si lo definiste).";
  updateAmountHint(state);
}

export function updateAmountHint(state){
  const config = state.config;
  const a = Number(el("fAmount").value) || 0;
  const c = el("fCurrency").value;
  const base = toBase(a, c, config);

  el("hintAmount").textContent = (a>0 && c!==config.baseCurrency)
    ? `≈ ${fmtMoney(base, config.baseCurrency, config)} (base)`
    : "";
}

export function clearForm(state){
  const config = state.config;
  el("fDate").value = todayISO();
  el("fAmount").value = "";
  el("fVendor").value = "";
  el("fDesc").value = "";
  el("fTags").value = "";
  el("fNotes").value = "";
  el("fPay").value = "Tarjeta";
  el("fCurrency").value = config.baseCurrency;

  refreshCategorySelects(state);
  updateAmountHint(state);
  toast("Formulario limpio");
}

export function addTx(state){
  const config = state.config;
  const amount = Number(el("fAmount").value);
  if(!Number.isFinite(amount) || amount<=0){
    toast("Poné un monto válido (>0).", "danger");
    el("fAmount").focus();
    return;
  }

  const t = currentFormType();
  const x = normalizeTx({
    type: t,
    date: el("fDate").value || todayISO(),
    amount,
    currency: el("fCurrency").value,
    category: el("fCategory").value,
    pay: el("fPay").value,
    vendor: el("fVendor").value.trim(),
    desc: el("fDesc").value.trim(),
    tags: safeTags(el("fTags").value),
    notes: el("fNotes").value.trim(),
  }, config);

  state.tx.push(x);
  saveTransactions(state.tx);

  toast("Guardado ✅");
  clearForm(state);
  state.page = 1;
  renderList(state);

  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
}

export function getFiltered(state){
  const config = state.config;

  const q = (el("qSearch").value || "").trim().toLowerCase();
  const type = el("qType").value;
  const cat = el("qCategory").value;
  const from = el("qFrom").value;
  const to = el("qTo").value;

  let list = state.tx.map(x => normalizeTx(x, config));

  if(type && type !== "(Todos)") list = list.filter(x => x.type === type);
  if(cat && cat !== "(Todas)") list = list.filter(x => x.category === cat);
  if(from) list = list.filter(x => x.date >= from);
  if(to) list = list.filter(x => x.date <= to);

  if(q){
    list = list.filter(x=>{
      const hay = [
        x.vendor, x.desc, x.notes, x.category, x.pay, x.currency, x.type,
        ...(x.tags || [])
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  return sortTx(list);
}

export function renderList(state){
  const config = state.config;
  const list = getFiltered(state);
  const total = list.length;

  const maxPage = Math.max(1, Math.ceil(total / state.PAGE_SIZE));
  if(state.page > maxPage) state.page = maxPage;

  const start = (state.page - 1) * state.PAGE_SIZE;
  const view = list.slice(start, start + state.PAGE_SIZE);

  el("tbody").innerHTML = view.map(x => rowHTML(x, config)).join("") || `
    <tr><td colspan="4" class="muted">No hay movimientos con estos filtros.</td></tr>
  `;

  el("countInfo").textContent = `${total} movimiento(s) • mostrando ${view.length} en página ${state.page}/${maxPage}`;
  el("pageInfo").textContent = `Página ${state.page} / ${maxPage}`;

  el("btnPrevPage").disabled = state.page <= 1;
  el("btnNextPage").disabled = state.page >= maxPage;

  view.forEach(x=>{
    const b = document.querySelector(`[data-edit="${x.id}"]`);
    if(b) b.addEventListener("click", ()=> openEdit(state, x.id));
  });
}

function rowHTML(x, config){
  const tags = (x.tags||[]).slice(0,6).map(t=>`<span class="tag">#${escapeHTML(t)}</span>`).join("");
  const base = toBase(x.amount, x.currency, config);
  const sign = x.type==="income" ? "+" : "−";
  const badge = x.type==="income" ? `<span class="badge income">Ingreso</span>` : `<span class="badge expense">Gasto</span>`;

  const moneyRaw = x.currency === config.baseCurrency
    ? fmtMoney(x.amount, x.currency, config)
    : `${fmtMoney(x.amount, x.currency, config)} <span class="muted">(${fmtMoney(base, config.baseCurrency, config)} base)</span>`;

  const money = `<span style="font-weight:900">${sign} ${moneyRaw}</span>`;

  return `
    <tr>
      <td class="mono">${escapeHTML(x.date)}</td>
      <td>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
          ${badge}
          <div style="font-weight:900">${escapeHTML(x.desc || "—")}</div>
        </div>
        <div class="muted" style="margin-top:3px">
          ${escapeHTML(x.category)} · ${escapeHTML(x.pay)} · ${escapeHTML(x.vendor || "—")}
        </div>
        <div style="margin-top:6px">${tags}</div>
      </td>
      <td style="white-space:nowrap">${money}</td>
      <td style="text-align:right">
        <button class="btn small" data-edit="${x.id}">Editar</button>
      </td>
    </tr>
  `;
}

export function openEdit(state, txId){
  const config = state.config;
  const x = state.tx.find(e => e.id === txId);
  if(!x){ toast("No se encontró.", "danger"); return; }

  el("eId").value = x.id;
  el("eType").value = x.type;
  refreshCategorySelects(state);

  el("eDate").value = x.date;
  el("eAmount").value = x.amount;
  el("eCurrency").value = x.currency;

  // después del refreshCategorySelects
  el("eCategory").value = x.category;
  el("ePay").value = x.pay;

  el("eVendor").value = x.vendor;
  el("eDesc").value = x.desc;
  el("eTags").value = (x.tags || []).join(", ");
  el("eNotes").value = x.notes;

  el("dlgEdit").showModal();
}

export function saveEdit(state){
  const config = state.config;
  const idv = el("eId").value;
  const idx = state.tx.findIndex(e => e.id === idv);
  if(idx < 0){ toast("No se encontró.", "danger"); return; }

  const amount = Number(el("eAmount").value);
  if(!Number.isFinite(amount) || amount<=0){
    toast("Monto inválido.", "danger");
    return;
  }

  const updated = normalizeTx({
    id: idv,
    type: el("eType").value,
    date: el("eDate").value || todayISO(),
    amount,
    currency: el("eCurrency").value,
    category: el("eCategory").value,
    pay: el("ePay").value,
    vendor: el("eVendor").value.trim(),
    desc: el("eDesc").value.trim(),
    tags: safeTags(el("eTags").value),
    notes: el("eNotes").value.trim(),
  }, config);

  state.tx[idx] = updated;
  saveTransactions(state.tx);
  el("dlgEdit").close();

  toast("Cambios guardados ✅");
  renderList(state);

  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
}

export function deleteEdit(state){
  const idv = el("eId").value;
  const x = state.tx.find(e => e.id === idv);
  if(!x) return;

  if(!confirm("¿Eliminar este movimiento?")) return;

  state.tx = state.tx.filter(e => e.id !== idv);
  saveTransactions(state.tx);
  el("dlgEdit").close();

  toast("Eliminado", "warn");
  renderList(state);

  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
}
