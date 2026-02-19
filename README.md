# Gastos02

Aplicación web (SPA) para registrar movimientos de ingresos/gastos, evaluarlos con dashboard y gestionar presupuestos mensuales.

## Funcionalidades

- Alta, edición y eliminación de movimientos.
- Filtros por texto, tipo, categoría y rango de fechas.
- Dashboard con KPIs, gráficos y estado de presupuestos.
- Configuración de moneda base, tasas de cambio y categorías.
- Exportación/Importación de JSON y exportación CSV.
- Persistencia local en navegador (`localStorage`) con migración de datos v1 a v2.

## Estructura

- `index.html`: layout principal de vistas (Ingreso, Dashboard, Config).
- `assets/js/app.js`: inicialización del estado y módulos.
- `assets/js/ingreso.js`: formulario, filtros y listado de movimientos.
- `assets/js/dashboard.js`: KPIs, gráficos y tabla de presupuesto.
- `assets/js/config.js`: configuración general y presupuestos.
- `assets/js/export.js`: export/import, CSV, tema y reset.
- `assets/js/storage.js`: lectura/escritura en `localStorage` + migraciones.
- `assets/js/router.js`: navegación entre tabs.

## Ejecutar localmente

No requiere build. Abrí `index.html` en tu navegador o levantá un servidor estático.

Ejemplo con Python:

```bash
python3 -m http.server 8080
```

Luego visitá:

```text
http://localhost:8080
```

## Calidad y validación rápida

Este repo no incluye test runner automático. Para validar rápido:

1. Crear un gasto y un ingreso.
2. Filtrar por tipo/categoría/fecha y verificar paginación.
3. Editar y eliminar un movimiento.
4. Confirmar dashboard (KPIs + presupuesto).
5. Exportar e importar JSON.

## Mejoras sugeridas

- Agregar tests unitarios para `utils.js` y tests E2E para flujos críticos.
- Backend opcional para sincronización multi-dispositivo.
- Observabilidad de errores (ej. reporter remoto opcional).
