import { el, fmtMoney, toBase, groupSum, topEntry, escapeHTML, maskedValue, isAnonymized } from "./utils.js";
import { getFiltered } from "./ingreso.js";

const REENTRY_TRANSFER_SOURCES = ["Reingreso por transferencia", "Reintegro", "Venta de divisas"];

function isRegularIncome(tx){
  return tx.type === "income" && !isReentryTransfer(tx);
}
const GROUP_BUDGET_PREFIX = "__group__::";

function groupBudgetKey(group){
  return `${GROUP_BUDGET_PREFIX}${group}`;
}

function isReentryTransfer(tx){
  if(tx.type !== "income") return false;
  const pay = String(tx.pay || "").trim().toLowerCase();
  return REENTRY_TRANSFER_SOURCES.some(label => pay === String(label).toLowerCase());
}

function expenseKeyFromAgg(tx, config, aggMode){
  if(aggMode !== "group") return tx.category;
  const group = config.expenseCategoryGroups?.[tx.category];
  return group || tx.category;
}

function breakdownEntitiesForMode(config, aggMode){
  if(aggMode === "group") return (config.expenseGroups || []).filter(Boolean);
  return (config.expenseCategories || []).filter(Boolean);
}

function syncBreakdownEntityOptions(state){
  const aggMode = el("dashAgg")?.value || "category";
  const allEntities = breakdownEntitiesForMode(state.config, aggMode);
  const select = el("dashBreakdownEntities");
  if(!select) return;

  const previous = new Set([...select.selectedOptions].map(o => o.value));
  const hadSelection = previous.size > 0;

  select.innerHTML = allEntities.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");

  for(const opt of select.options){
    opt.selected = hadSelection ? previous.has(opt.value) : true;
  }

  const label = el("labDashBreakdownEntities");
  if(label) label.textContent = aggMode === "group"
    ? "Ver grupos en comparativa"
    : "Ver categorías en comparativa";
}

function selectedBreakdownEntities(state){
  const aggMode = el("dashAgg")?.value || "category";
  const allEntities = breakdownEntitiesForMode(state.config, aggMode);
  const select = el("dashBreakdownEntities");
  if(!select) return allEntities;
  const selected = [...select.selectedOptions].map(o=>o.value).filter(Boolean);
  return selected.length ? selected : allEntities;
}

export function initDashboard(state){
  // refrescos por eventos
  state.bus.on("dashboard:refresh", ()=> refreshDash(state));
  state.bus.on("tx:changed", ()=> refreshDash(state));
  state.bus.on("config:changed", ()=> { syncBreakdownEntityOptions(state); refreshDash(state); });
  state.bus.on("budgets:changed", ()=> refreshDash(state));

  // controles propios
  el("btnRefreshDash").addEventListener("click", ()=> refreshDash(state));
  el("dashMonth").addEventListener("change", ()=> refreshDash(state));
  el("dashScope").addEventListener("change", ()=> refreshDash(state));
  el("dashCatsMode").addEventListener("change", ()=> refreshDash(state));
  el("dashAgg").addEventListener("change", ()=> { syncBreakdownEntityOptions(state); refreshDash(state); });
  el("dashMonthlyWindow").addEventListener("change", ()=> refreshDash(state));
  el("dashBreakdownEntities")?.addEventListener("change", ()=> refreshDash(state));

  syncBreakdownEntityOptions(state);
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
  const reentryTransfers = incomes.filter(isReentryTransfer);
  const regularIncomes = incomes.filter(isRegularIncome);

  const netImpacting = nlist.filter(x => x.includeInNet !== false);
  const netImpactingIncome = netImpacting.filter(x => x.type === "income");
  const netImpactingExpenses = netImpacting.filter(x => x.type === "expense");
  const netImpactingReentry = netImpactingIncome.filter(isReentryTransfer);
  const netImpactingRegularIncome = netImpactingIncome.filter(isRegularIncome);

  const incTotal = regularIncomes.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0);
  const reentryTotal = reentryTransfers.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0);
  const expTotal = expenses.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0);
  const net = netImpactingRegularIncome.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0)
    + netImpactingReentry.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0)
    - netImpactingExpenses.reduce((s,x)=> s + toBase(x.amount, x.currency, config, x.date, x.fxRate), 0);

  const count = nlist.length;
  const avg = count ? (incTotal + reentryTotal + expTotal) / count : 0;

  const expenseAgg = el("dashAgg").value;
  const byCatExpense = groupSum(expenses, x=>expenseKeyFromAgg(x, config, expenseAgg), x=>toBase(x.amount, x.currency, config, x.date, x.fxRate));
  const byCatIncome = groupSum(regularIncomes, x=>x.category, x=>toBase(x.amount, x.currency, config, x.date, x.fxRate));
  const byCatReentry = groupSum(reentryTransfers, x=>x.category, x=>toBase(x.amount, x.currency, config, x.date, x.fxRate));
  const byPay = groupSum(nlist, x=>x.pay, x=>toBase(x.amount, x.currency, config, x.date, x.fxRate));

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
      <div class="sub">${maskedValue(String(count))} movimiento(s) • prom ${fmtMoney(avg, config.baseCurrency, config)}</div>
    </div>
    <div class="box">
      <div class="label">Ahorro (%)</div>
      <div class="value">${maskedValue(incTotal>0 ? ((net/incTotal)*100).toFixed(0)+"%" : "—")}</div>
      <div class="sub">${incTotal>0 ? `Neto / Ingresos${reentryTotal>0 ? " (sin reingresos)" : ""}` : "Sin ingresos"}</div>
    </div>
  `;

  renderCharts(state, nlist, month, byCatExpense, byCatIncome, byCatReentry, byPay);
  renderBudgetStatus(state, expenses, month, expenseAgg);
  renderCategoryTable(state, expenses, byCatExpense, month, expenseAgg);
}

// -----------------------------
// Charts
// -----------------------------
function renderCharts(state, list, month, byCatExpense, byCatIncome, byCatReentry, byPay){
  const config = state.config;
  const hasChart = typeof Chart !== "undefined";

  const css = getComputedStyle(document.documentElement);
  const axisColor = css.getPropertyValue("--muted").trim() || "#9ca3af";
  const borderColor = css.getPropertyValue("--border").trim() || "rgba(255,255,255,.14)";
  const textColor = css.getPropertyValue("--text").trim() || "#e5e7eb";

  if(isAnonymized()){
    ["fallbackDaily", "fallbackMonthly", "fallbackCats", "fallbackMonthlyBreakdown", "fallbackPay"].forEach(id => {
      el(id).style.display = "";
      el(id).textContent = "Gráfico anonimizado.";
    });

    for(const k of Object.keys(state.charts)){
      if(state.charts[k]){ state.charts[k].destroy(); state.charts[k] = null; }
    }
    return;
  }

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
      const base = toBase(x.amount, x.currency, config, x.date, x.fxRate);
      if(isRegularIncome(x)) incByDay[d-1] += base;
      else if(x.type==="expense") expByDay[d-1] += base;
      else if(isReentryTransfer(x)) expByDay[d-1] -= base;

      if(x.includeInNet === false){
        if(isRegularIncome(x)) incByDay[d-1] -= base;
        else if(x.type === "expense") expByDay[d-1] -= base;
        else if(isReentryTransfer(x)) expByDay[d-1] += base;
      }
    }
  }
  const netByDay = incByDay.map((v,i)=> v - expByDay[i]);

  const monthlyWindow = Number(el("dashMonthlyWindow").value || 6);
  const monthlyMetrics = buildMonthlyComparisonMetrics(state.tx, config, month, monthlyWindow);
  const monthlyBreakdown = buildMonthlyBreakdownMetrics(state.tx, config, monthlyMetrics.months, el("dashAgg").value, selectedBreakdownEntities(state));

  if(!hasChart){
    ["fallbackDaily", "fallbackMonthly", "fallbackCats", "fallbackMonthlyBreakdown", "fallbackPay"].forEach(id => {
      el(id).style.display = "";
      el(id).textContent = "Charts no disponibles (offline).";
    });
    return;
  }

  ["fallbackDaily", "fallbackMonthly", "fallbackCats", "fallbackMonthlyBreakdown", "fallbackPay"].forEach(id => {
    el(id).style.display = "none";
  });

  for(const k of Object.keys(state.charts)){
    if(state.charts[k]){ state.charts[k].destroy(); state.charts[k]=null; }
  }

  state.charts.daily = new Chart(el("chartDaily"), {
    type: "line",
    data: {
      labels: Array.from({length: daysInMonth}, (_,i)=> String(i+1)),
      datasets: [
        {
          label: `Ingresos (${config.baseCurrency})`,
          data: incByDay.map(v=>Number(v.toFixed(2))),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, .22)",
          pointBackgroundColor: "#22c55e",
          tension: .32,
          fill: true
        },
        {
          label: `Gastos (${config.baseCurrency})`,
          data: expByDay.map(v=>Number(v.toFixed(2))),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, .20)",
          pointBackgroundColor: "#ef4444",
          tension: .32,
          fill: true
        },
        {
          label: `Neto (${config.baseCurrency})`,
          data: netByDay.map(v=>Number(v.toFixed(2))),
          borderColor: "#8b5cf6",
          backgroundColor: "rgba(139, 92, 246, .18)",
          pointBackgroundColor: "#8b5cf6",
          borderDash: [6,4],
          tension: .28,
          fill: false
        }
      ]
    },
    options: {
      responsive:true,
      interaction: { mode: "index", intersect: false },
      plugins:{
        legend:{ display:true, labels:{ color:textColor, usePointStyle:true, boxWidth:10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y || 0, config.baseCurrency, config)}` } }
      },
      scales: {
        x: { grid: { color: borderColor }, ticks: { color: axisColor } },
        y: { grid: { color: borderColor }, ticks: { color: axisColor } }
      }
    }
  });

  state.charts.monthly = new Chart(el("chartMonthlyCompare"), {
    type: "line",
    data: {
      labels: monthlyMetrics.months,
      datasets: [
        { label: `Ingresos (${config.baseCurrency})`, data: monthlyMetrics.income, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,.2)", tension: .28, fill: false },
        { label: `Gastos (${config.baseCurrency})`, data: monthlyMetrics.expense, borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,.2)", tension: .28, fill: false },
        { label: `Neto (${config.baseCurrency})`, data: monthlyMetrics.net, borderColor: "#8b5cf6", borderDash: [6,4], tension: .22, fill: false }
      ]
    },
    options: {
      responsive:true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color:textColor, usePointStyle:true, boxWidth:10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y || 0, config.baseCurrency, config)}` } }
      },
      scales: {
        x: { grid: { color: borderColor }, ticks: { color: axisColor } },
        y: { grid: { color: borderColor }, ticks: { color: axisColor } }
      }
    }
  });

  const mode = el("dashCatsMode").value;
  const byCat = mode==="income" ? byCatIncome : mode==="reentry" ? byCatReentry : byCatExpense;
  if(mode==="income") el("hCats").textContent = "Ingresos por categoría";
  else if(mode==="reentry") el("hCats").textContent = "Reintegros por categoría";
  else el("hCats").textContent = el("dashAgg").value === "group" ? "Gastos por grupo" : "Gastos por categoría";

  const catLabels = byCat.slice(0,10).map(x=>x.key);
  const catVals = byCat.slice(0,10).map(x=>Number(x.value.toFixed(2)));
  const catPalette = buildPalette(catVals.length, mode === "income" || mode === "reentry" ? "income" : "expense");

  state.charts.cats = new Chart(el("chartCats"), {
    type: "doughnut",
    data: {
      labels: isAnonymized() ? catLabels.map(()=>"*") : catLabels,
      datasets: [{
        label: `Por categoría (${config.baseCurrency})`,
        data: catVals,
        backgroundColor: catPalette,
        borderColor,
        borderWidth: 1.5,
        hoverOffset: 8
      }]
    },
    options: {
      responsive:true,
      plugins: {
        legend: { labels: { color:textColor } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtMoney(ctx.parsed || 0, config.baseCurrency, config)}` } }
      }
    }
  });

  const selectedCount = selectedBreakdownEntities(state).length;
  const breakdownTitle = el("dashAgg").value === "group" ? "Gastos por grupo (comparativa)" : "Gastos por categoría (comparativa)";
  el("hMonthlyBreakdown").textContent = `${breakdownTitle} · ${selectedCount} seleccionado(s)`;
  const breakdownPalette = buildPalette(monthlyBreakdown.labels.length, "expense");
  state.charts.monthlyBreakdown = new Chart(el("chartMonthlyBreakdown"), {
    type: "bar",
    data: {
      labels: monthlyBreakdown.months,
      datasets: monthlyBreakdown.labels.map((label, idx)=>(
        {
          label,
          data: monthlyBreakdown.series.map(row=>Number((row[label] || 0).toFixed(2))),
          backgroundColor: breakdownPalette[idx],
          borderColor: breakdownPalette[idx],
          borderWidth: 1,
          borderRadius: 6
        }
      ))
    },
    options: {
      responsive:true,
      plugins: {
        legend: { labels: { color:textColor } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y || 0, config.baseCurrency, config)}` } }
      },
      scales: {
        x: { stacked: true, grid: { color: borderColor }, ticks: { color: axisColor } },
        y: { stacked: true, grid: { color: borderColor }, ticks: { color: axisColor } }
      }
    }
  });

  const payLabels = byPay.map(x=>x.key);
  const payVals = byPay.map(x=>Number(x.value.toFixed(2)));
  const payPalette = buildPalette(payVals.length, "pay");

  state.charts.pay = new Chart(el("chartPay"), {
    type: "bar",
    data: {
      labels: isAnonymized() ? payLabels.map(()=>"*") : payLabels,
      datasets: [{
        label: `Por medio/fuente (${config.baseCurrency})`,
        data: payVals,
        backgroundColor: payPalette,
        borderColor: payPalette,
        borderWidth: 1,
        borderRadius: 8,
        maxBarThickness: 44
      }]
    },
    options: {
      responsive:true,
      plugins: {
        legend: { labels: { color:textColor } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y || 0, config.baseCurrency, config)}` } }
      },
      scales: {
        x: { grid: { color: borderColor }, ticks: { color: axisColor } },
        y: { grid: { color: borderColor }, ticks: { color: axisColor } }
      }
    }
  });
}

function buildMonthlyComparisonMetrics(txList, config, month, monthsBack){
  const [year, monthNum] = month.split("-").map(Number);
  const current = new Date(year, monthNum - 1, 1);
  const months = [];

  for(let idx = monthsBack - 1; idx >= 0; idx--){
    const d = new Date(current.getFullYear(), current.getMonth() - idx, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`);
  }

  const totals = new Map(months.map(key => [key, { income: 0, expense: 0 }]));

  for(const tx of txList){
    const txMonth = String(tx.date || "").slice(0, 7);
    if(!totals.has(txMonth)) continue;
    const amountBase = toBase(Number(tx.amount) || 0, tx.currency, config, tx.date, tx.fxRate);
    if(isRegularIncome(tx)) totals.get(txMonth).income += amountBase;
    if(tx.type === "expense") totals.get(txMonth).expense += amountBase;
  }

  const income = months.map(key => Number((totals.get(key)?.income || 0).toFixed(2)));
  const expense = months.map(key => Number((totals.get(key)?.expense || 0).toFixed(2)));
  const net = months.map((key, i) => Number(((income[i] || 0) - (expense[i] || 0)).toFixed(2)));

  return { months, income, expense, net };
}

function buildMonthlyBreakdownMetrics(txList, config, monthKeys, aggMode, selectedEntities = []){
  const monthMap = new Map(monthKeys.map(key => [key, new Map()]));

  for(const tx of txList){
    if(tx.type !== "expense") continue;
    const month = String(tx.date || "").slice(0, 7);
    const bucket = monthMap.get(month);
    if(!bucket) continue;
    const key = expenseKeyFromAgg(tx, config, aggMode);
    bucket.set(key, (bucket.get(key) || 0) + toBase(Number(tx.amount) || 0, tx.currency, config, tx.date, tx.fxRate));
  }

  const labels = Array.from(monthMap.values())
    .flatMap(map => Array.from(map.entries()))
    .reduce((acc, [key, value]) => {
      acc.set(key, (acc.get(key) || 0) + value);
      return acc;
    }, new Map());

  const selectedSet = new Set((selectedEntities || []).filter(Boolean));
  const topLabels = Array.from(labels.entries())
    .filter(([key])=> selectedSet.size ? selectedSet.has(key) : true)
    .sort((a,b)=> b[1] - a[1])
    .map(([key])=> key);

  const series = monthKeys.map(month => {
    const row = {};
    const data = monthMap.get(month) || new Map();
    for(const label of topLabels){
      row[label] = data.get(label) || 0;
    }
    return row;
  });

  return { months: monthKeys, labels: topLabels, series };
}

function buildPalette(size, theme){
  if(size <= 0) return [];

  const themes = {
    income: { startHue: 120, spread: 220, sat: 72, light: 52 },
    expense: { startHue: 10, spread: 320, sat: 78, light: 56 },
    pay: { startHue: 210, spread: 260, sat: 74, light: 54 }
  };

  const { startHue, spread, sat, light } = themes[theme] || themes.pay;

  return Array.from({ length: size }, (_, i)=>{
    const t = size === 1 ? 0 : i / size;
    const hue = (startHue + spread * t) % 360;
    const satShift = sat + ((i % 2 === 0) ? 0 : -8);
    const lightShift = light + ((i % 3 === 0) ? 5 : 0);
    return `hsla(${Math.round(hue)} ${satShift}% ${lightShift}% / .88)`;
  });
}

// -----------------------------
// Budgets
// -----------------------------
function renderBudgetStatus(state, expenses, monthKey, expenseAgg){
  const config = state.config;
  const budgets = state.budgets;

  const monthBudget = budgets[monthKey] || {};
  const rows = expenseAgg === "group"
    ? buildGroupBudgetRows(expenses, config, monthBudget, monthKey)
    : buildCategoryBudgetRows(expenses, config, monthBudget, monthKey);

  if(rows.length===0){
    el("budgetStatus").innerHTML = `<span class="muted">No hay presupuestos definidos para ${monthKey} en modo ${expenseAgg === "group" ? "grupo" : "categoría"}.</span>`;
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
            <div style="font-weight:900">${escapeHTML(r.label)}</div>
            <div class="muted" style="margin-top:2px">${fmtMoney(r.spent, config.baseCurrency, config)} / ${fmtMoney(r.limit, config.baseCurrency, config)}</div>
          </div>
          <div style="text-align:right">
            <span class="badge ${badge}">${label}</span>
            <div class="muted" style="margin-top:6px; font-family:var(--mono)">${maskedValue((r.pct||0).toFixed(0)+"%")}</div>
          </div>
        </div>
      `;
    }).join("");
}

function buildCategoryBudgetRows(expenses, config, monthBudget, monthKey){
  const byCat = groupSum(
    expenses.filter(x=> String(x.date||"").startsWith(monthKey)),
    x=>x.category,
    x=>toBase(x.amount, x.currency, config, x.date, x.fxRate)
  );

  return (config.expenseCategories||[]).map(cat=>{
    const spent = byCat.find(x=>x.key===cat)?.value || 0;
    const limit = Number(monthBudget[cat] || 0);
    if(!limit) return null;
    const p = (spent/limit)*100;
    let status = "ok";
    if(p>=100) status="danger";
    else if(p>=80) status="warn";
    return { label: cat, spent, limit, pct: p, status };
  }).filter(Boolean);
}

function buildGroupBudgetRows(expenses, config, monthBudget, monthKey){
  const byGroup = groupSum(
    expenses.filter(x=> String(x.date||"").startsWith(monthKey)),
    x=>expenseKeyFromAgg(x, config, "group"),
    x=>toBase(x.amount, x.currency, config, x.date, x.fxRate)
  );

  const groups = (config.expenseGroups || []).filter(Boolean);
  return groups.map(group=>{
    const spent = byGroup.find(x=>x.key===group)?.value || 0;
    const limit = Number(monthBudget[groupBudgetKey(group)] || 0);
    if(!limit) return null;
    const p = (spent/limit)*100;
    let status = "ok";
    if(p>=100) status="danger";
    else if(p>=80) status="warn";
    return { label: group, spent, limit, pct: p, status };
  }).filter(Boolean);
}

function renderCategoryTable(state, expenses, byCatExpense, monthKey, expenseAgg){
  const config = state.config;
  const budgets = state.budgets;

  if(expenseAgg === "group"){
    const monthBudget = budgets[monthKey] || {};
    el("tbodyCats").innerHTML = byCatExpense.map(r=>{
      const limit = Number(monthBudget[groupBudgetKey(r.key)] || 0);
      const pct = limit>0 ? (r.value/limit)*100 : null;
      const pctStr = pct==null ? "—" : maskedValue(pct.toFixed(0)+"%");
      const flag = pct==null ? "" : (pct>=100 ? "danger" : pct>=80 ? "warn" : "ok");
      return `
        <tr>
          <td style="font-weight:900">${isAnonymized() ? "*" : escapeHTML(r.key)}</td>
          <td>${fmtMoney(r.value, config.baseCurrency, config)}</td>
          <td>${limit>0 ? fmtMoney(limit, config.baseCurrency, config) : "<span class='muted'>—</span>"}</td>
          <td>${pct==null ? "<span class='muted'>—</span>" : `<span class="badge ${flag}">${pctStr}</span>`}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="4" class="muted">Sin datos.</td></tr>`;
    return;
  }

  const monthBudget = budgets[monthKey] || {};
  const mapBudget = new Map(Object.entries(monthBudget).map(([k,v])=>[k, Number(v)||0]));
  const byCategory = groupSum(
    expenses.filter(x=> String(x.date||"").startsWith(monthKey)),
    x=>x.category,
    x=>toBase(x.amount, x.currency, config, x.date, x.fxRate)
  );

  const set = new Set([...byCategory.map(x=>x.key), ...Object.keys(monthBudget)]);
  const rows = [...set].map(cat=>{
    const spent = byCategory.find(x=>x.key===cat)?.value || 0;
    const limit = mapBudget.get(cat) || 0;
    const pct = limit>0 ? (spent/limit)*100 : null;
    return {cat, spent, limit, pct};
  }).sort((a,b)=> (b.spent - a.spent));

  el("tbodyCats").innerHTML = rows.map(r=>{
    const pctStr = r.pct==null ? "—" : maskedValue(r.pct.toFixed(0)+"%");
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
