# Gastos02

Aplicación web (SPA) para registrar movimientos de ingresos/gastos, evaluarlos con dashboard y gestionar presupuestos mensuales.

## Funcionalidades

- Alta, edición y eliminación de movimientos.
- Filtros por texto, tipo, categoría y rango de fechas.
- Dashboard con KPIs, gráficos y estado de presupuestos.
- Configuración de moneda base, tasas de cambio, categorías y grupos.
- Exportación/Importación de JSON y exportación CSV.
- Persistencia 100% local en navegador (`localStorage`) con migración de datos v1 a v2.

## Versionado

- La versión visible en UI se incrementa en cada cambio siguiendo el esquema `1.21`, `1.22`, `1.23`, etc.
- La fuente de verdad es `APP_VERSION` en `assets/js/constants.js` y se refleja en el badge del header.

## Estructura

- `index.html`: layout principal de vistas (Ingreso, Dashboard, Config).
- `assets/js/dataStore.js`: capa de datos local (localStorage).
- `assets/js/app.js`: inicialización del estado y módulos.
- `assets/js/ingreso.js`: formulario, filtros y listado de movimientos.
- `assets/js/dashboard.js`: KPIs, gráficos y tabla de presupuesto.
- `assets/js/config.js`: configuración general y presupuestos.
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

1. Crear grupo/categoría/movimiento/presupuesto.
2. Cambiar moneda base y locale.
3. Recargar página y confirmar persistencia.
