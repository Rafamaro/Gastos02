export const APP_VERSION = "1.36";
// Constantes y defaults (v2)
export const LS = {
  TX: "mov_tx_v2",
  CFG: "mov_cfg_v2",
  BUD: "mov_bud_v2",
  THEME: "mov_theme_v2",
  // compat old
  OLD_EXP: "gastos_expenses_v1",
  OLD_CFG: "gastos_config_v1",
  OLD_BUD: "gastos_budgets_v1"
};

export const defaults = {
  baseCurrency: "ARS",
  currencies: ["ARS", "USD", "EUR"],
  locale: "es-AR",
  expenseCategories: [
    "Comida", "Transporte", "Salud", "Hogar", "Servicios", "Educación",
    "Ocio", "Impuestos", "Ropa", "Trabajo", "Otros"
  ],
  incomeCategories: [
    "Salario", "Honorarios", "Reembolso", "Inversiones", "Ventas", "Otros ingresos"
  ],
  expenseGroups: ["Esenciales", "Finanzas", "Estilo de vida", "Trabajo"],
  expenseCategoryGroups: {},
  ratesToBase: { "ARS": 1, "USD": 1050, "EUR": 1150 } // ejemplo
};
