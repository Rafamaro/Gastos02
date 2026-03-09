import { el, escapeHTML, fmtMoney, toBase, id, toast } from "./utils.js";
import { getHouseholds, saveHouseholds } from "./dataStore.js";

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
  const persons = Array.isArray(input.persons) && input.persons.length
    ? input.persons.map((p, idx)=> sanitizePerson(p, idx))
    : [sanitizePerson({ name: "Persona 1", income: 0 }, 0), sanitizePerson({ name: "Persona 2", income: 0 }, 1)];

  return {
    id: String(input.id || id()),
    name: String(input.name || "Hogar").trim() || "Hogar",
    model: input.model === "personalizado" ? "personalizado" : "equitativo",
    groups: [...new Set((input.groups || []).map(v=>String(v || "").trim()).filter(Boolean))],
    categories: [...new Set((input.categories || []).map(v=>String(v || "").trim()).filter(Boolean))],
    persons,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function selectedValues(select){
  return [...(select?.selectedOptions || [])].map(o=>String(o.value || "").trim()).filter(Boolean);
}

function fillMulti(select, values = [], selected = []){
  if(!select) return;
  const selectedSet = new Set(selected);
  select.innerHTML = values.map(v=>`<option value="${escapeHTML(v)}" ${selectedSet.has(v) ? "selected" : ""}>${escapeHTML(v)}</option>`).join("");
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
      return;
    }

    const current = households.find(h=> h.id === ui.currentId) || households[0];
    ui.currentId = current.id;
    if(el("tab-hogar")){
      el("tab-hogar").style.display = "";
      el("tab-hogar").textContent = `🏠 ${current.name}`;
    }

    renderMain(state, current);
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
    const households = await getHouseholds();
    const payload = {
      id: ui.currentId || id(),
      name: el("hogarName")?.value,
      model: el("hogarModel")?.value,
      groups: selectedValues(el("hogarGroups")),
      categories: selectedValues(el("hogarCategories")),
      persons: readDraftPersons(ui)
    };
    const next = normalizeHome(payload, state);
    const idx = households.findIndex(h=> h.id === next.id);
    if(idx >= 0) households[idx] = next;
    else households.push(next);

    await saveHouseholds(households);
    ui.currentId = next.id;
    el("dlgHogar")?.close();
    toast("Configuración de hogar guardada ✅");
    state.bus.emit("hogar:refresh");
  });

  el("btnHogarAddPerson")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = households.find(h=> h.id === ui.currentId) || households[0];
    if(!current) return;
    current.persons = [...(current.persons || []), sanitizePerson({ name: `Persona ${(current.persons || []).length + 1}` }, (current.persons || []).length)];
    await saveHouseholds(households.map(h=> h.id === current.id ? current : h));
    state.bus.emit("hogar:refresh");
  });

  el("btnHogarSavePersons")?.addEventListener("click", async ()=>{
    const households = await getHouseholds();
    const current = households.find(h=> h.id === ui.currentId) || households[0];
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

    current.persons = persons.length ? persons : [sanitizePerson({ name: "Persona 1" }, 0)];
    await saveHouseholds(households.map(h=> h.id === current.id ? normalizeHome(current, state) : h));
    toast("Participantes guardados ✅");
    state.bus.emit("hogar:refresh");
  });

  refresh();
}

function openDialog(state, ui, home){
  const normalized = normalizeHome(home || {}, state);
  ui.currentId = home?.id || null;
  ui.draftPersons = (normalized.persons || []).map((p, idx)=> sanitizePerson(p, idx));

  if(el("hogarName")) el("hogarName").value = normalized.name || "";
  if(el("hogarModel")) el("hogarModel").value = normalized.model;

  fillMulti(el("hogarGroups"), state.config.expenseGroups || [], normalized.groups || []);
  fillMulti(el("hogarCategories"), state.config.expenseCategories || [], normalized.categories || []);
  renderDraftPersons(ui, normalized.model);

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
        <input type="number" min="0" max="${model === "personalizado" ? "100" : "999999999"}" step="0.01" data-draft-value value="${model === "personalizado" ? person.percent : person.income}" />
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
    const value = Number(row.querySelector("[data-draft-value]")?.value) || 0;
    if((el("hogarModel")?.value || "equitativo") === "personalizado") base.percent = value;
    else base.income = value;
    return sanitizePerson(base, idx);
  });
}

function renderMain(state, home){
  const categories = resolveCategories(home, state);
  const shares = computeShares(home);
  const expenses = state.tx.filter(tx => tx.type === "expense" && categories.includes(tx.category));

  const byCategory = new Map();
  for(const tx of expenses){
    const base = toBase(Number(tx.amount) || 0, tx.currency, state.config, tx.date, tx.fxRate);
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + base);
  }

  if(el("hogarTitle")) el("hogarTitle").textContent = home.name || "Hogar";
  if(el("hogarSummary")) el("hogarSummary").textContent = `${home.model === "equitativo" ? "Modelo equitativo" : "Modelo personalizado"} · ${categories.length} categorías incluidas.`;

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
          <input type="number" min="0" step="0.01" data-hogar-income value="${p.income}" ${home.model === "personalizado" ? "disabled" : ""} />
        </div>
        <div>
          <label>Porcentaje</label>
          <input type="number" min="0" max="100" step="0.01" data-hogar-percent value="${(p.share * 100).toFixed(2)}" ${home.model === "equitativo" ? "disabled" : ""} />
        </div>
      </div>
    `).join("");
  }
}
