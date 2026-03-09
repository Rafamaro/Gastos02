import { el, escapeHTML, fmtMoney, toBase, id, toast, parseAmountInput } from "./utils.js";
import { getHouseholds, saveHouseholds } from "./dataStore.js";

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function defaultPerson(){
  return { id: id(), name: "Persona", income: 0, percent: 0 };
}

function sanitizePerson(person = {}, index = 0){
  return {
    id: person.id || id(),
    name: String(person.name || `Persona ${index + 1}`).trim() || `Persona ${index + 1}`,
    income: Math.max(0, Number(person.income) || 0),
    percent: Math.max(0, Math.min(100, Number(person.percent) || 0))
  };
}

function normalizeHome(input = {}, state){
  const fallbackMonth = MONTH_KEY_RE.test(String(state?.activeMonth || "")) ? state.activeMonth : new Date().toISOString().slice(0, 7);
  const persons = Array.isArray(input.persons) && input.persons.length
    ? input.persons.map((p, idx)=> sanitizePerson(p, idx))
    : [sanitizePerson({ name: "Persona 1", income: 0 }, 0), sanitizePerson({ name: "Persona 2", income: 0 }, 1)];

  const versions = Array.isArray(input.versions) && input.versions.length
    ? input.versions.map((version, idx)=> normalizeVersion(version, fallbackMonth, idx)).sort((a,b)=> a.effectiveMonth.localeCompare(b.effectiveMonth))
    : [normalizeVersion({
      effectiveMonth: input.createdAt ? String(input.createdAt).slice(0, 7) : fallbackMonth,
      model: input.model,
      groups: input.groups,
      categories: input.categories,
      persons
    }, fallbackMonth, 0)];

  return {
    id: String(input.id || id()),
    name: String(input.name || "Hogar").trim() || "Hogar",
    versions,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeVersion(version = {}, fallbackMonth, index = 0){
  const persons = Array.isArray(version.persons) && version.persons.length
    ? version.persons.map((p, idx)=> sanitizePerson(p, idx))
    : [sanitizePerson({ name: "Persona 1", income: 0 }, 0), sanitizePerson({ name: "Persona 2", income: 0 }, 1)];

  return {
    id: String(version.id || id()),
    effectiveMonth: MONTH_KEY_RE.test(String(version.effectiveMonth || "")) ? String(version.effectiveMonth) : fallbackMonth,
    model: version.model === "personalizado" ? "personalizado" : "equitativo",
    groups: [...new Set((version.groups || []).map(v=>String(v || "").trim()).filter(Boolean))],
    categories: [...new Set((version.categories || []).map(v=>String(v || "").trim()).filter(Boolean))],
    persons,
    createdAt: version.createdAt || new Date().toISOString(),
    order: index
  };
}

function resolveVersion(home, monthKey){
  const versions = Array.isArray(home?.versions) ? [...home.versions] : [];
  if(!versions.length) return null;
  const safeMonth = MONTH_KEY_RE.test(String(monthKey || "")) ? String(monthKey) : versions[versions.length - 1].effectiveMonth;
  let picked = versions[0];
  for(const version of versions){
    if(version.effectiveMonth <= safeMonth) picked = version;
  }
  return picked;
}

function versionSnapshotEqual(a, b){
  if(!a || !b) return false;
  return JSON.stringify({
    model: a.model,
    groups: a.groups,
    categories: a.categories,
    persons: (a.persons || []).map(sanitizePerson)
  }) === JSON.stringify({
    model: b.model,
    groups: b.groups,
    categories: b.categories,
    persons: (b.persons || []).map(sanitizePerson)
  });
}

function upsertVersionByMonth(home, version){
  const month = String(version?.effectiveMonth || "");
  const versions = Array.isArray(home?.versions) ? [...home.versions] : [];
  const idx = versions.findIndex(v => String(v?.effectiveMonth || "") === month);
  if(idx >= 0) versions[idx] = normalizeVersion({ ...versions[idx], ...version }, month, idx);
  else versions.push(normalizeVersion(version, month, versions.length));
  return versions.sort((a,b)=> a.effectiveMonth.localeCompare(b.effectiveMonth));
}

function selectedValues(select){
  return [...(select?.selectedOptions || [])].map(o=>String(o.value || "").trim()).filter(Boolean);
}

function fillMulti(select, values = [], selected = []){
  if(!select) return;
  const selectedSet = new Set(selected);
  select.innerHTML = values.map(v=>`<option value="${escapeHTML(v)}" ${selectedSet.has(v) ? "selected" : ""}>${escapeHTML(v)}</option>`).join("");
}

function enableMultiToggle(select){
  if(!select || select.dataset.multiToggleReady === "1") return;
  select.dataset.multiToggleReady = "1";
  select.addEventListener("mousedown", (ev)=>{
    const option = ev.target?.closest?.("option");
    if(!option) return;
    ev.preventDefault();
    option.selected = !option.selected;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function resolveCategories(home, state){
  const groups = new Set(home.groups || []);
  const categories = new Set(home.categories || []);
  const mapping = state.config.expenseCategoryGroups || {};
  for(const cat of state.config.expenseCategories || []){
    if(groups.has(mapping[cat])) categories.add(cat);
  }
  return [...categories];
}

function computeShares(home){
  const people = (home.persons || []).map(sanitizePerson);
  if(home.model === "personalizado"){
    let total = people.reduce((acc, p)=> acc + p.percent, 0);
    if(total <= 0){
      const eq = people.length ? 100 / people.length : 0;
      people.forEach(p=>{ p.percent = eq; });
      total = 100;
    }
    return people.map(p=> ({ ...p, share: (p.percent / total) }));
  }

  const totalIncome = people.reduce((acc, p)=> acc + Math.max(0, p.income), 0);
  if(totalIncome <= 0){
    const eq = people.length ? 1 / people.length : 0;
    return people.map(p=> ({ ...p, share: eq }));
  }
  return people.map(p=> ({ ...p, share: Math.max(0, p.income) / totalIncome }));
}

export function initHogar(state){
  const ui = { currentId: null, draftPersons: [] };

  const refresh = async ()=>{
    const households = await getHouseholds();
    if(!households.length){
      if(el("tab-hogar")) el("tab-hogar").style.display = "none";
      if(el("btnEditHogar")) el("btnEditHogar").disabled = true;
      if(el("btnDeleteHogar")) el("btnDeleteHogar").disabled = true;
      return;
    }

    const current = normalizeHome(households.find(h=> h.id === ui.currentId) || households[0], state);
    ui.currentId = current.id;
    if(el("tab-hogar")){
      el("tab-hogar").style.display = "";
      el("tab-hogar").textContent = `🏠 ${current.name}`;
    }
    if(el("btnEditHogar")) el("btnEditHogar").disabled = false;
    if(el("btnDeleteHogar")) el("btnDeleteHogar").disabled = false;

    renderMain(state, current, resolveVersion(current, state.activeMonth));
  };

  state.bus.on("hogar:refresh", refresh);

  el("btnSetupHogar")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = households.find(h=> h.id === ui.currentId) || households[0] || null;
    openDialog(state, ui, current);
  });

  el("btnEditHogar")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = households.find(h=> h.id === ui.currentId) || households[0] || null;
    if(!current) return toast("Primero creá una configuración de hogar", "warn");
    openDialog(state, ui, current);
  });

  el("btnCloseHogarDlg")?.addEventListener("click", ()=> el("dlgHogar")?.close());
  el("btnCancelHogar")?.addEventListener("click", ()=> el("dlgHogar")?.close());

  enableMultiToggle(el("hogarGroups"));
  enableMultiToggle(el("hogarCategories"));

  el("hogarModel")?.addEventListener("change", ()=>{
    const model = el("hogarModel")?.value;
    const hint = model === "personalizado"
      ? "Personalizado: elegís manualmente el porcentaje (0% a 100%) que paga cada persona."
      : "Equitativo: se suman ingresos y cada gasto se divide por la proporción de ingreso de cada persona.";
    if(el("hogarModelHint")) el("hogarModelHint").textContent = hint;
    renderDraftPersons(ui, model);
  });

  el("btnHogarDraftAddPerson")?.addEventListener("click", ()=>{
    ui.draftPersons.push(defaultPerson());
    renderDraftPersons(ui, el("hogarModel")?.value || "equitativo");
  });

  el("btnSaveHogar")?.addEventListener("click", async ()=>{
    const pickedModel = el("hogarModel")?.value;
    if(!pickedModel) return toast("Elegí un modelo de reparto para continuar", "warn");
    const households = await getHouseholds();
    const original = normalizeHome(households.find(h=> h.id === ui.currentId) || {}, state);
    const currentVersion = resolveVersion(original, state.activeMonth);
    const payload = {
      id: original.id || ui.currentId || id(),
      name: el("hogarName")?.value,
      model: pickedModel,
      groups: selectedValues(el("hogarGroups")),
      categories: selectedValues(el("hogarCategories")),
      persons: readDraftPersons(ui)
    };
    const next = normalizeHome({ ...original, name: payload.name }, state);
    const candidate = normalizeVersion({ ...payload, effectiveMonth: state.activeMonth }, state.activeMonth);
    if(!currentVersion || !versionSnapshotEqual(currentVersion, candidate)){
      next.versions = upsertVersionByMonth(next, candidate);
    }
    const idx = households.findIndex(h=> h.id === next.id);
    if(idx >= 0) households[idx] = next;
    else households.push(next);

    await saveHouseholds(households);
    ui.currentId = next.id;
    el("dlgHogar")?.close();
    toast("Configuración de hogar guardada ✅");
    state.bus.emit("hogar:refresh");
  });

  el("btnDeleteHogar")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = households.find(h=> h.id === ui.currentId) || households[0];
    if(!current) return;
    if(!window.confirm(`¿Seguro que querés borrar el hogar "${current.name}"? Esta acción no se puede deshacer.`)) return;
    const filtered = households.filter(h=> h.id !== current.id);
    await saveHouseholds(filtered);
    ui.currentId = filtered[0]?.id || null;
    toast("Hogar borrado ✅");
    state.bus.emit("hogar:refresh");
  });

  el("btnHogarSaveModel")?.addEventListener("click", async ()=>{
    const model = el("hogarInlineModel")?.value;
    if(!model) return;
    const households = await getHouseholds();
    const home = normalizeHome(households.find(h=> h.id === ui.currentId) || households[0], state);
    if(!home.id) return;
    const version = resolveVersion(home, state.activeMonth);
    const updated = normalizeVersion({ ...version, model, effectiveMonth: state.activeMonth }, state.activeMonth);
    if(versionSnapshotEqual(version, updated)) return toast("No hay cambios para guardar", "warn");
    home.versions = upsertVersionByMonth(home, updated);
    await saveHouseholds(households.map(h=> h.id === home.id ? home : h));
    toast(`Modelo actualizado desde ${state.activeMonth} ✅`);
    state.bus.emit("hogar:refresh");
  });

  el("btnHogarAddPerson")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = normalizeHome(households.find(h=> h.id === ui.currentId) || households[0], state);
    if(!current) return;
    const version = resolveVersion(current, state.activeMonth);
    const persons = [...(version?.persons || []), sanitizePerson({ name: `Persona ${(version?.persons || []).length + 1}` }, (version?.persons || []).length)];
    current.versions = upsertVersionByMonth(current, normalizeVersion({ ...version, persons, effectiveMonth: state.activeMonth }, state.activeMonth));
    await saveHouseholds(households.map(h=> h.id === current.id ? current : h));
    state.bus.emit("hogar:refresh");
  });

  el("btnHogarSavePersons")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = normalizeHome(households.find(h=> h.id === ui.currentId) || households[0], state);
    if(!current) return;

    const rows = [...document.querySelectorAll("[data-hogar-person-row]")];
    const persons = rows.map((row, idx)=>(
      sanitizePerson({
        id: row.dataset.personId,
        name: row.querySelector("[data-hogar-name]")?.value,
        income: row.querySelector("[data-hogar-income]")?.value,
        percent: row.querySelector("[data-hogar-percent]")?.value
      }, idx)
    )).filter(p=>p.name);

    const version = resolveVersion(current, state.activeMonth);
    const nextPersons = persons.length ? persons : [sanitizePerson({ name: "Persona 1" }, 0)];
    current.versions = upsertVersionByMonth(current, normalizeVersion({ ...version, persons: nextPersons, effectiveMonth: state.activeMonth }, state.activeMonth));
    await saveHouseholds(households.map(h=> h.id === current.id ? normalizeHome(current, state) : h));
    toast("Participantes guardados ✅");
    state.bus.emit("hogar:refresh");
  });

  refresh();
}

function openDialog(state, ui, home){
  const normalized = normalizeHome(home || {}, state);
  const version = resolveVersion(normalized, state.activeMonth) || normalizeVersion({}, state.activeMonth);
  ui.currentId = home?.id || null;
  ui.draftPersons = (version.persons || []).map((p, idx)=> sanitizePerson(p, idx));

  if(el("hogarName")) el("hogarName").value = normalized.name || "";
  if(el("hogarModel")) el("hogarModel").value = home ? version.model : "";

  fillMulti(el("hogarGroups"), state.config.expenseGroups || [], version.groups || []);
  fillMulti(el("hogarCategories"), state.config.expenseCategories || [], version.categories || []);
  renderDraftPersons(ui, version.model || "equitativo");

  el("dlgHogar")?.showModal();
}

function renderDraftPersons(ui, model){
  const box = el("hogarPersonsDraft");
  if(!box) return;
  box.innerHTML = "";

  ui.draftPersons.forEach((person, idx)=>{
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = idx ? "8px" : "0";
    row.dataset.draftPerson = person.id;

    row.innerHTML = `
      <div>
        <label>Nombre</label>
        <input type="text" data-draft-name value="${escapeHTML(person.name)}" />
      </div>
      <div>
        <label>${model === "personalizado" ? "Porcentaje (%)" : "Ingreso"}</label>
        <input type="text" inputmode="decimal" autocomplete="off" data-draft-value value="${model === "personalizado" ? person.percent : person.income}" />
      </div>
    `;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn small danger";
    removeBtn.textContent = "Quitar";
    removeBtn.style.marginTop = "8px";
    removeBtn.addEventListener("click", ()=>{
      ui.draftPersons = ui.draftPersons.filter(p=> p.id !== person.id);
      renderDraftPersons(ui, model);
    });

    box.appendChild(row);
    box.appendChild(removeBtn);
  });
}

function readDraftPersons(ui){
  return [...document.querySelectorAll("[data-draft-person]")].map((row, idx)=>{
    const current = ui.draftPersons.find(p=>p.id === row.dataset.draftPerson) || {};
    const base = {
      id: row.dataset.draftPerson || id(),
      name: row.querySelector("[data-draft-name]")?.value,
      income: current.income,
      percent: current.percent
    };
    const value = parseAmountInput(row.querySelector("[data-draft-value]")?.value) || 0;
    if((el("hogarModel")?.value || "equitativo") === "personalizado") base.percent = value;
    else base.income = value;
    return sanitizePerson(base, idx);
  });
}

function renderMain(state, home, version){
  if(!version) return;
  const scopedHome = { ...home, ...version };
  const categories = resolveCategories(scopedHome, state);
  const shares = computeShares(scopedHome);
  const activeMonth = MONTH_KEY_RE.test(String(state.activeMonth || "")) ? String(state.activeMonth) : null;
  const creationMonth = MONTH_KEY_RE.test(String(home.createdAt || "").slice(0, 7)) ? String(home.createdAt).slice(0, 7) : null;
  const expenses = state.tx.filter(tx => {
    if(tx.type !== "expense" || !categories.includes(tx.category)) return false;
    const txMonth = String(tx.date || "").slice(0, 7);
    if(!MONTH_KEY_RE.test(txMonth)) return false;
    if(activeMonth && txMonth !== activeMonth) return false;
    if(creationMonth && txMonth < creationMonth) return false;
    return true;
  });

  const byCategory = new Map();
  for(const tx of expenses){
    const base = toBase(Number(tx.amount) || 0, tx.currency, state.config, tx.date, tx.fxRate);
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + base);
  }

  if(el("hogarTitle")) el("hogarTitle").textContent = home.name || "Hogar";
  if(el("hogarSummary")) el("hogarSummary").textContent = `${version.model === "equitativo" ? "Modelo equitativo" : "Modelo personalizado"} · ${categories.length} categorías incluidas. Vigente desde ${version.effectiveMonth}.`;
  if(el("hogarInlineModel")) el("hogarInlineModel").value = version.model;

  const head = el("hogarHeadRow");
  if(head){
    head.innerHTML = `<th>Categoría</th><th>Gasto (${escapeHTML(state.config.baseCurrency)})</th>` + shares.map(p=>`<th>${escapeHTML(p.name)}</th>`).join("");
  }

  const body = el("tbodyHogar");
  if(body){
    const rows = [...byCategory.entries()].sort((a,b)=> b[1]-a[1]);
    body.innerHTML = rows.length ? rows.map(([cat, total])=>{
      const cells = shares.map(p=> fmtMoney(total * p.share, state.config.baseCurrency, state.config));
      return `<tr><td>${escapeHTML(cat)}</td><td>${fmtMoney(total, state.config.baseCurrency, state.config)}</td>${cells.map(v=>`<td>${v}</td>`).join("")}</tr>`;
    }).join("") : `<tr><td colspan="${2 + shares.length}" class="muted">No hay gastos para las categorías seleccionadas en este período.</td></tr>`;
  }

  const peopleBox = el("hogarPersonsBox");
  if(peopleBox){
    peopleBox.innerHTML = shares.map(p=>`
      <div class="row" data-hogar-person-row data-person-id="${escapeHTML(p.id)}" style="margin-top:8px">
        <div>
          <label>Nombre</label>
          <input type="text" data-hogar-name value="${escapeHTML(p.name)}" />
        </div>
        <div>
          <label>Ingreso</label>
          <input type="text" inputmode="decimal" autocomplete="off" data-hogar-income value="${p.income}" ${version.model === "personalizado" ? "disabled" : ""} />
        </div>
        <div>
          <label>Porcentaje</label>
          <input type="text" inputmode="decimal" autocomplete="off" data-hogar-percent value="${(p.share * 100).toFixed(2)}" ${version.model === "equitativo" ? "disabled" : ""} />
        </div>
      </div>
    `).join("");
  }
}
