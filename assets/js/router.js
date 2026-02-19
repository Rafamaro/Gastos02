import { toast } from "./utils.js";

/**
 * Tabs / router simple por data-view
 */
export function initTabs(state){
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach(t=>{
    t.addEventListener("click", ()=> setTab(state, t.dataset.tab));
    t.addEventListener("keydown", (e)=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        setTab(state, t.dataset.tab);
      }
    });
  });
}

export function setTab(state, name){
  document.querySelectorAll(".tab").forEach(t=>{
    t.setAttribute("aria-selected", String(t.dataset.tab === name));
  });

  document.querySelectorAll("[data-view]").forEach(v=>{
    v.style.display = v.dataset.view === name ? "" : "none";
  });

  // “hooks” simples
  if(name === "dashboard") state.bus.emit("dashboard:refresh");
  if(name === "ingreso") state.bus.emit("ingreso:refresh");
  if(name === "config") state.bus.emit("config:refresh");
}
