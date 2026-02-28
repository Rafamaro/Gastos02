export const APP_VERSION = "2.0.0";

export const LS = {
  THEME: "mov_theme_v2"
};

export const defaults = {
  version: 1,
  currency: "ARS",
  groups: [
    { id: "hogar", name: "Hogar" },
    { id: "trabajo", name: "Trabajo" }
  ],
  categories: [
    { id: "comida", name: "Comida", groupId: "hogar" },
    { id: "transporte", name: "Transporte", groupId: "hogar" }
  ],
  payment_methods: [
    { id: "tarjeta", name: "Tarjeta" },
    { id: "efectivo", name: "Efectivo" }
  ],
  tags: [],
  ui: { defaultView: "month" }
};
