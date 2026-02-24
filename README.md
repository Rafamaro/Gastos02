# Gastos02

Aplicación web (SPA) para registrar movimientos de ingresos/gastos, evaluarlos con dashboard y gestionar presupuestos mensuales.

## Funcionalidades

- Alta, edición y eliminación de movimientos.
- Filtros por texto, tipo, categoría y rango de fechas.
- Dashboard con KPIs, gráficos y estado de presupuestos.
- Configuración de moneda base, tasas de cambio y categorías.
- Exportación/Importación de JSON y exportación CSV.
- Persistencia local en navegador (`localStorage`) con migración de datos v1 a v2.
- Backend dual: modo local + modo Directus (CRUD persistente).

## Integración con Directus

1. Ir a **Config → Directus**.
2. Cargar `Directus URL` (por defecto `https://directus.drperez86.com`).
3. Asegurar credenciales del usuario de servicio vía `window.__GASTOS02_DIRECTUS_SERVICE_EMAIL` y `window.__GASTOS02_DIRECTUS_SERVICE_PASSWORD`.
4. Presionar **Probar conexión**.
5. Activar **Usar Directus** para que Directus sea fuente de verdad.
6. Opcional: usar **Importar a Directus** para subir datos locales actuales.

### Feature flags / storage local

- `gastos02_backend = "local" | "directus"`
- `gastos02_directus_url`

### Colecciones utilizadas y mapeo

- `settings`:
  - `base_currency` ↔ `config.baseCurrency`
  - `locale` ↔ `config.locale`
- `currencies`:
  - `code`, `symbol`, `decimals`, `name`
- `expense_groups`:
  - `name`, `description`
- `categories`:
  - `name`, `type`, `group`
- `transactions`:
  - `type`, `date`, `amount`, `currency`, `category`, `vendor`, `pay`, `desc`, `notes`, `tags`
- `budgets`:
  - `month`, `category`, `amount`, `currency`

> Nota: presupuestos por grupo se guardan como categoría técnica con prefijo `[GRUPO] ` para mantener compatibilidad con el esquema existente.

## Estructura

- `index.html`: layout principal de vistas (Ingreso, Dashboard, Config).
- `assets/js/directusClient.js`: cliente REST Directus + retries.
- `assets/js/dataStore.js`: data layer unificado con modo local/directus.
- `assets/js/app.js`: inicialización del estado y módulos.
- `assets/js/ingreso.js`: formulario, filtros y listado de movimientos.
- `assets/js/dashboard.js`: KPIs, gráficos y tabla de presupuesto.
- `assets/js/config.js`: configuración general, directus y presupuestos.
- `assets/js/export.js`: export/import, CSV, tema y reset.
- `assets/js/storage.js`: lectura/escritura en `localStorage` + migraciones.
- `assets/js/router.js`: navegación entre tabs.

## Ejecutar localmente

No requiere build. Abrí `index.html` en tu navegador o levantá un servidor estático.

```bash
python3 -m http.server 8080
```

Luego visitá:

```text
http://localhost:8080
```

## Validación manual sugerida

1. Activar modo Directus con credenciales de servicio válidas.
2. Crear grupo/categoría/movimiento/presupuesto y verificar persistencia.
3. Recargar página y confirmar lectura desde Directus.
4. Desactivar Directus y confirmar fallback local sin crash.
