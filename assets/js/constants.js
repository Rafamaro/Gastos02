export const APP_VERSION = "2.21";

export const LS = {
  THEME: "mov_theme_v2"
};

export const defaults = {
  baseCurrency: "ARS",
  currencies: ["ARS", "USD", "EUR", "COP", "USDT", "USDC", "TUSD", "DJED", "DAI"],
  locale: "es-AR",
  expenseCategories: [
    "Comida", "Transporte", "Salud", "Hogar", "Servicios", "Educación",
    "Ocio", "Impuestos", "Ropa", "Trabajo", "Compra de divisas", "Otros"
  ],
  incomeCategories: [
    "Salario", "Honorarios", "Reembolso", "Inversiones", "Ventas", "Otros ingresos"
  ],
  reentryCategories: ["Reintegro", "Devoluciones", "Reembolso de gasto", "Venta de divisas"],
  expenseGroups: ["Esenciales", "Finanzas", "Estilo de vida", "Trabajo"],
  expenseCategoryGroups: {},
  ratesToBase: { ARS: 1, USD: 1050, EUR: 1150, COP: 0.27, USDT: 1050, USDC: 1050, TUSD: 1050, DJED: 1050, DAI: 1050 },
  ratesByMonth: {},
  budgets: {},

  // compat nuevo esquema
  version: 1,
  currency: "ARS",
  categories: [{ id: "comida", name: "Comida", groupId: "esenciales" }],
  groups: [{ id: "esenciales", name: "Esenciales" }],
  payment_methods: [{ id: "tarjeta", name: "Tarjeta" }, { id: "efectivo", name: "Efectivo" }],
  tags: [],
  ui: { defaultView: "month" }
};
