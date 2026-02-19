/**
 * Tabs / router simple por data-view
 */
export function initTabs(state){
  const tabs = [...document.querySelectorAll(".tab")];

  tabs.forEach((t, idx)=>{
    t.addEventListener("click", ()=> setTab(state, t.dataset.tab));
    t.addEventListener("keydown", (e)=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        setTab(state, t.dataset.tab);
        return;
      }

      if(e.key === "ArrowRight" || e.key === "ArrowLeft"){
        e.preventDefault();
        const step = e.key === "ArrowRight" ? 1 : -1;
        const next = (idx + step + tabs.length) % tabs.length;
        tabs[next].focus();
        setTab(state, tabs[next].dataset.tab);
      }
    });
  });
}

export function setTab(state, name){
  document.querySelectorAll(".tab").forEach(t=>{
    const selected = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
  });

  document.querySelectorAll("[data-view]").forEach(v=>{
    v.style.display = v.dataset.view === name ? "" : "none";
  });

  // “hooks” simples
  if(name === "dashboard") state.bus.emit("dashboard:refresh");
  if(name === "ingreso") state.bus.emit("ingreso:refresh");
  if(name === "config") state.bus.emit("config:refresh");
}
