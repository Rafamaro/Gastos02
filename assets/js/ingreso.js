import { el, fillSelect, fmtMoney, toBase, safeTags, normalizeTx, sortTx, todayISO, monthISO, toast, escapeHTML } from "./utils.js";
import { createTransaction, updateTransaction, deleteTransaction, listCategories } from "./dataStore.js?v=1772015862292";
export function initIngreso(state){
  // listeners de refresco externo
  state.bus.on("config:changed", async ()=> {
    await refreshCategorySelects(state);
    updateAmountHint(state);
    syncLabelsByType(state);
    // re-render si estamos en ingreso
    state.bus.emit("ingreso:refresh");
  });

  state.bus.on("ingreso:refresh", ()=> renderList(state));

  // tipo radio
  document.querySelectorAll('input[name="fType"]').forEach(r=>{
    r.addEventListener("change", async ()=>{
      await refreshCategorySelects(state);
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

function setSelectOptions(select, options = []){
  select.innerHTML = "";
  for(const option of options){
    const element = document.createElement("option");
    element.value = String(option.value ?? "");
    element.textContent = String(option.label ?? option.value ?? "");
    select.appendChild(element);
  }
}

async function loadCategoryOptions(state, type){
  const config = state.config;
  const configuredNames = type === "income" ? (config.incomeCategories || []) : (config.expenseCategories || []);

  if(state.directus?.connected){
    const rows = await listCategories({ type });
    const byName = new Map(
      rows
        .filter(row => row?.id && row?.name)
        .map(row => [String(row.name).trim().toLowerCase(), row])
    );

    const options = configuredNames.map(name => {
      const cleanName = String(name || "").trim();
      const matched = byName.get(cleanName.toLowerCase());
      return { value: matched?.id || cleanName, label: cleanName };
    }).filter(opt => opt.label);

    for(const row of rows || []){
      const cleanName = String(row?.name || "").trim();
      if(!cleanName) continue;
      if(options.some(opt => opt.label.toLowerCase() === cleanName.toLowerCase())) continue;
      options.push({ value: row.id, label: cleanName });
    }

    if(options.length) return options;
  }

  const fallback = configuredNames.length ? configuredNames : ["Otros"];
  return fallback.map(name => ({ value: name, label: name }));
}

export async function refreshCategorySelects(state){
  const config = state.config;

  const t = currentFormType();
  const formOptions = await loadCategoryOptions(state, t);
  const currentFormValue = el("fCategory").value;
  setSelectOptions(el("fCategory"), formOptions);
  el("fCategory").value = formOptions.some(opt => opt.value === currentFormValue)
    ? currentFormValue
    : (formOptions[0]?.value || "");

  const qCategory = el("qCategory");
  const previousFilter = qCategory.value;
  const allCategories = ["(Todas)", ...unionCategories(config)];
  fillSelect(qCategory, allCategories);
  qCategory.value = allCategories.includes(previousFilter) ? previousFilter : "(Todas)";

  const et = el("eType").value || "expense";
  const editOptions = await loadCategoryOptions(state, et);
  const currentEditValue = el("eCategory").value;
  setSelectOptions(el("eCategory"), editOptions);
  el("eCategory").value = editOptions.some(opt => opt.value === currentEditValue)
    ? currentEditValue
    : (editOptions[0]?.value || "");
}

export function syncLabelsByType(state){
  const t = currentFormType();
  el("labVendor").textContent = t==="income" ? "Origen" : "Comercio / Lugar";
  el("labPay").textContent = t==="income" ? "Fuente / Medio" : "Medio de pago";
  el("labCategory").textContent = "Categoría";
  el("hintType").textContent = t==="income"
    ? "Ingreso: suma al neto. Si la fuente es Reintegro, no suma al KPI de ingresos."
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

export async function addTx(state){
  const config = state.config;
  const amount = Number(el("fAmount").value);
  if(!Number.isFinite(amount) || amount<=0){
    toast("Poné un monto válido (>0).", "danger");
    el("fAmount").focus();
    return;
  }

  const t = currentFormType();
  const selectedCategoryId = el("fCategory").value;
  const selectedCategoryName = el("fCategory").selectedOptions?.[0]?.textContent || selectedCategoryId;
  const x = normalizeTx({
    type: t,
    date: el("fDate").value || todayISO(),
    amount,
    currency: el("fCurrency").value,
    category: selectedCategoryName,
    categoryId: selectedCategoryId,
    pay: el("fPay").value,
    vendor: el("fVendor").value.trim(),
    desc: el("fDesc").value.trim(),
    tags: safeTags(el("fTags").value),
    notes: el("fNotes").value.trim(),
  }, config);

  const saved = await createTransaction({ ...x, categoryId: selectedCategoryId });
  state.tx.unshift({ ...x, id: saved?.id || x.id });

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

export async function openEdit(state, txId){
  const config = state.config;
  const x = state.tx.find(e => e.id === txId);
  if(!x){ toast("No se encontró.", "danger"); return; }

  el("eId").value = x.id;
  el("eType").value = x.type;
  await refreshCategorySelects(state);

  el("eDate").value = x.date;
  el("eAmount").value = x.amount;
  el("eCurrency").value = x.currency;

  // después del refreshCategorySelects
  const eCategory = el("eCategory");
  const byName = Array.from(eCategory.options).find(opt => opt.textContent === x.category);
  eCategory.value = byName?.value || x.category;
  el("ePay").value = x.pay;

  el("eVendor").value = x.vendor;
  el("eDesc").value = x.desc;
  el("eTags").value = (x.tags || []).join(", ");
  el("eNotes").value = x.notes;

  el("dlgEdit").showModal();
}

export async function saveEdit(state){
  const config = state.config;
  const idv = el("eId").value;
  const idx = state.tx.findIndex(e => e.id === idv);
  if(idx < 0){ toast("No se encontró.", "danger"); return; }

  const amount = Number(el("eAmount").value);
  if(!Number.isFinite(amount) || amount<=0){
    toast("Monto inválido.", "danger");
    return;
  }

  const selectedEditCategoryId = el("eCategory").value;
  const selectedEditCategoryName = el("eCategory").selectedOptions?.[0]?.textContent || selectedEditCategoryId;
  const updated = normalizeTx({
    id: idv,
    type: el("eType").value,
    date: el("eDate").value || todayISO(),
    amount,
    currency: el("eCurrency").value,
    category: selectedEditCategoryName,
    categoryId: selectedEditCategoryId,
    pay: el("ePay").value,
    vendor: el("eVendor").value.trim(),
    desc: el("eDesc").value.trim(),
    tags: safeTags(el("eTags").value),
    notes: el("eNotes").value.trim(),
  }, config);

  await updateTransaction(idv, { ...updated, categoryId: selectedEditCategoryId });
  state.tx[idx] = updated;
  el("dlgEdit").close();

  toast("Cambios guardados ✅");
  renderList(state);

  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
}

export async function deleteEdit(state){
  const idv = el("eId").value;
  const x = state.tx.find(e => e.id === idv);
  if(!x) return;

  if(!confirm("¿Eliminar este movimiento?")) return;

  await deleteTransaction(idv);
  state.tx = state.tx.filter(e => e.id !== idv);
  el("dlgEdit").close();

  toast("Eliminado", "warn");
  renderList(state);

  state.bus.emit("tx:changed");
  state.bus.emit("dashboard:refresh");
}
