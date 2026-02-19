import { el, fmtMoney, toBase, groupSum, topEntry, escapeHTML } from "./utils.js";
import { getFiltered } from "./ingreso.js";

function expenseKeyFromAgg(tx, config, aggMode){
  if(aggMode !== "group") return tx.category;
  const group = config.expenseCategoryGroups?.[tx.category];
  return group || tx.category;
}

export function initDashboard(state){
  // refrescos por eventos
  state.bus.on("dashboard:refresh", ()=> refreshDash(state));
  state.bus.on("tx:changed", ()=> refreshDash(state));
  state.bus.on("config:changed", ()=> refreshDash(state));
  state.bus.on("budgets:changed", ()=> refreshDash(state));

  // controles propios
  el("btnRefreshDash").addEventListener("click", ()=> refreshDash(state));
  el("dashMonth").addEventListener("change", ()=> refreshDash(state));
  el("dashScope").addEventListener("change", ()=> refreshDash(state));
  el("dashCatsMode").addEventListener("change", ()=> refreshDash(state));
  el("dashAgg").addEventListener("change", ()=> refreshDash(state));

  refreshDash(state);
}

export function refreshDash(state){
  const config = state.config;
  const scope = el("dashScope").value;
  const month = el("dashMonth").value;

  let list = [];
  if(scope === "all"){
    list = state.tx;
  } else if(scope === "range"){
    // usa filtros del ingreso
    list = getFiltered(state);
  } else {
    list = state.tx.filter(x => String(x.date||"").startsWith(month));
  }

  // normalizamos para asegurar shape
  const nlist = list.map(x => ({
    ...x,
    amount: Number(x.amount)||0
  }));

  const incomes = nlist.filter(x=>x.type==="income");
  const expenses = nlist.filter(x=>x.type==="expense");

  const incTotal = incomes.reduce((s,x)=> s + toBase(x.amount, x.currency, config), 0);
  const expTotal = expenses.reduce((s,x)=> s + toBase(x.amount, x.currency, config), 0);
  const net = incTotal - expTotal;

  const count = nlist.length;
  const avg = count ? (incTotal + expTotal) / count : 0;

  const expenseAgg = el("dashAgg").value;
  const byCatExpense = groupSum(expenses, x=>expenseKeyFromAgg(x, config, expenseAgg), x=>toBase(x.amount, x.currency, config));
  const byCatIncome = groupSum(incomes, x=>x.category, x=>toBase(x.amount, x.currency, config));
  const byPay = groupSum(nlist, x=>x.pay, x=>toBase(x.amount, x.currency, config));

  const topExp = topEntry(byCatExpense);
  const topInc = topEntry(byCatIncome);

  el("kpi").innerHTML = `
    <div class="box">
      <div class="label">Ingresos (base)</div>
      <div class="value">${fmtMoney(incTotal, config.baseCurrency, config)}</div>
      <div class="sub">${topInc ? "Top: " + escapeHTML(topInc.key) : "—"}</div>
    </div>
    <div class="box">
      <div class="label">Gastos (base)</div>
      <div class="value">${fmtMoney(expTotal, config.baseCurrency, config)}</div>
      <div class="sub">${topExp ? "Top: " + escapeHTML(topExp.key) : "—"}</div>
    </div>
    <div class="box">
      <div class="label">Neto (base)</div>
      <div class="value">${fmtMoney(net, config.baseCurrency, config)}</div>
      <div class="sub">${count} movimiento(s) • prom ${fmtMoney(avg, config.baseCurrency, config)}</div>
    </div>
    <div class="box">
      <div class="label">Ahorro (%)</div>
      <div class="value">${incTotal>0 ? ((net/incTotal)*100).toFixed(0)+"%" : "—"}</div>
      <div class="sub">${incTotal>0 ? "Neto / Ingresos" : "Sin ingresos"}</div>
    </div>
  `;

  renderCharts(state, nlist, month, byCatExpense, byCatIncome, byPay);
  renderBudgetStatus(state, expenses, month);
  renderCategoryTable(state, expenses, byCatExpense, month, expenseAgg);
}

// -----------------------------
// Charts
// -----------------------------
function renderCharts(state, list, month, byCatExpense, byCatIncome, byPay){
  const config = state.config;
  const hasChart = typeof Chart !== "undefined";

  const daysInMonth = (() => {
    const [y,m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  })();

  const incByDay = new Array(daysInMonth).fill(0);
  const expByDay = new Array(daysInMonth).fill(0);

  for(const x of list){
    if(!String(x.date||"").startsWith(month)) continue;
    const d = Number(String(x.date).slice(8,10));
    if(d>=1 && d<=daysInMonth){
      const base = toBase(x.amount, x.currency, config);
      if(x.type==="income") incByDay[d-1] += base;
      else expByDay[d-1] += base;
    }
  }
  const netByDay = incByDay.map((v,i)=> v - expByDay[i]);

  if(!hasChart){
    el("fallbackDaily").style.display = "";
    el("fallbackCats").style.display = "";
    el("fallbackPay").style.display = "";
    el("fallbackDaily").textContent = "Charts no disponibles (offline).";
    el("fallbackCats").textContent = "Charts no disponibles (offline).";
    el("fallbackPay").textContent = "Charts no disponibles (offline).";
    return;
  } else {
    el("fallbackDaily").style.display = "none";
    el("fallbackCats").style.display = "none";
    el("fallbackPay").style.display = "none";
  }

  // destroy prev
  for(const k of Object.keys(state.charts)){
    if(state.charts[k]){ state.charts[k].destroy(); state.charts[k]=null; }
  }

  state.charts.daily = new Chart(el("chartDaily"), {
    type: "line",
    data: {
      labels: Array.from({length: daysInMonth}, (_,i)=> String(i+1)),
      datasets: [
        { label: `Ingresos (${config.baseCurrency})`, data: incByDay.map(v=>Number(v.toFixed(2))) },
        { label: `Gastos (${config.baseCurrency})`, data: expByDay.map(v=>Number(v.toFixed(2))) },
        { label: `Neto (${config.baseCurrency})`, data: netByDay.map(v=>Number(v.toFixed(2))) }
      ]
    },
    options: { responsive:true, plugins:{ legend:{display:true} } }
  });

  const mode = el("dashCatsMode").value;
  const byCat = mode==="income" ? byCatIncome : byCatExpense;
  if(mode==="income") el("hCats").textContent = "Ingresos por categoría";
  else el("hCats").textContent = el("dashAgg").value === "group" ? "Gastos por grupo" : "Gastos por categoría";

  const catLabels = byCat.slice(0,10).map(x=>x.key);
  const catVals = byCat.slice(0,10).map(x=>Number(x.value.toFixed(2)));

  state.charts.cats = new Chart(el("chartCats"), {
    type: "doughnut",
    data: { labels: catLabels, datasets: [{ label: `Por categoría (${config.baseCurrency})`, data: catVals }] },
    options: { responsive:true }
  });

  const payLabels = byPay.map(x=>x.key);
  const payVals = byPay.map(x=>Number(x.value.toFixed(2)));

  state.charts.pay = new Chart(el("chartPay"), {
    type: "bar",
    data: { labels: payLabels, datasets: [{ label: `Por medio/fuente (${config.baseCurrency})`, data: payVals }] },
    options: { responsive:true }
  });
}

// -----------------------------
// Budgets
// -----------------------------
function renderBudgetStatus(state, expenses, monthKey){
  const config = state.config;
  const budgets = state.budgets;

  const monthBudget = budgets[monthKey] || {};
  const byCat = groupSum(
    expenses.filter(x=> String(x.date||"").startsWith(monthKey)),
    x=>x.category,
    x=>toBase(x.amount, x.currency, config)
  );

  const rows = (config.expenseCategories||[]).map(cat=>{
    const spent = byCat.find(x=>x.key===cat)?.value || 0;
    const limit = Number(monthBudget[cat] || 0);
    if(!limit) return { cat, spent, limit, pct: null, status: "—" };
    const p = (spent/limit)*100;
    let status = "ok";
    if(p>=100) status="danger";
    else if(p>=80) status="warn";
    return { cat, spent, limit, pct: p, status };
  }).filter(r=>r.limit>0);

  if(rows.length===0){
    el("budgetStatus").innerHTML = `<span class="muted">No hay presupuestos definidos para ${monthKey}.</span>`;
    return;
  }

  el("budgetStatus").innerHTML = rows
    .sort((a,b)=>(b.pct||0)-(a.pct||0))
    .slice(0,8)
    .map(r=>{
      const badge = r.status==="danger" ? "danger" : r.status==="warn" ? "warn" : "ok";
      const label = r.status==="danger" ? "Superado" : r.status==="warn" ? "Alerta" : "OK";
      return `
        <div style="display:flex; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:900">${escapeHTML(r.cat)}</div>
            <div class="muted" style="margin-top:2px">${fmtMoney(r.spent, config.baseCurrency, config)} / ${fmtMoney(r.limit, config.baseCurrency, config)}</div>
          </div>
          <div style="text-align:right">
            <span class="badge ${badge}">${label}</span>
            <div class="muted" style="margin-top:6px; font-family:var(--mono)">${(r.pct||0).toFixed(0)}%</div>
          </div>
        </div>
      `;
    }).join("");
}

function renderCategoryTable(state, expenses, byCatExpense, monthKey, expenseAgg){
  const config = state.config;
  const budgets = state.budgets;

  if(expenseAgg === "group"){
    el("tbodyCats").innerHTML = byCatExpense.map(r=>`
      <tr>
        <td style="font-weight:900">${escapeHTML(r.key)}</td>
        <td>${fmtMoney(r.value, config.baseCurrency, config)}</td>
        <td><span class='muted'>—</span></td>
        <td><span class='muted'>N/A</span></td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Sin datos.</td></tr>`;
    return;
  }

  const monthBudget = budgets[monthKey] || {};
  const mapBudget = new Map(Object.entries(monthBudget).map(([k,v])=>[k, Number(v)||0]));
  const byCategory = groupSum(
    expenses.filter(x=> String(x.date||"").startsWith(monthKey)),
    x=>x.category,
    x=>toBase(x.amount, x.currency, config)
  );

  const set = new Set([...byCategory.map(x=>x.key), ...Object.keys(monthBudget)]);
  const rows = [...set].map(cat=>{
    const spent = byCategory.find(x=>x.key===cat)?.value || 0;
    const limit = mapBudget.get(cat) || 0;
    const pct = limit>0 ? (spent/limit)*100 : null;
    return {cat, spent, limit, pct};
  }).sort((a,b)=> (b.spent - a.spent));

  el("tbodyCats").innerHTML = rows.map(r=>{
    const pctStr = r.pct==null ? "—" : r.pct.toFixed(0)+"%";
    const flag = r.pct==null ? "" : (r.pct>=100 ? "danger" : r.pct>=80 ? "warn" : "ok");
    return `
      <tr>
        <td style="font-weight:900">${escapeHTML(r.cat)}</td>
        <td>${fmtMoney(r.spent, config.baseCurrency, config)}</td>
        <td>${r.limit>0 ? fmtMoney(r.limit, config.baseCurrency, config) : "<span class='muted'>—</span>"}</td>
        <td>${r.pct==null ? "<span class='muted'>—</span>" : `<span class="badge ${flag}">${pctStr}</span>`}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4" class="muted">Sin datos.</td></tr>`;
}

