# Gastos02 (Local-first)

Gastos02 ahora funciona **100% local**, sin backend y sin Directus.

## Versión
- `APP_VERSION`: `2.29`.

## Modos de almacenamiento

### 1) Modo carpeta (recomendado)
- Botón: **Elegir carpeta de datos**.
- Usa File System Access API (`window.showDirectoryPicker`).
- Recomendado: Chrome/Edge.
- Estructura esperada dentro de la carpeta elegida:

```txt
/config.json
/YYYY-MM.json
```

### 2) Modo manual (fallback)
- Si la API de carpeta no está disponible:
  - **Importar mes (JSON)**
  - **Exportar mes (JSON)**

## Formato `config.json`

```json
{
  "version": 1,
  "currency": "ARS",
  "categories": [{ "id": "comida", "name": "Comida", "groupId": "hogar" }],
  "groups": [{ "id": "hogar", "name": "Hogar" }],
  "payment_methods": [{ "id": "tarjeta", "name": "Tarjeta" }],
  "tags": [],
  "ui": { "defaultView": "month" }
}
```

## Formato mensual `YYYY-MM.json`

```json
{
  "version": 1,
  "month": "2026-03",
  "currency": "ARS",
  "movements": [
    {
      "id": "uuid",
      "date": "2026-03-10",
      "type": "expense",
      "amount": 12500,
      "categoryId": "comida",
      "groupId": "hogar",
      "paymentMethodId": "tarjeta",
      "note": "texto",
      "tags": ["super"]
    }
  ]
}
```

> `amount` se guarda como **integer** (sin decimales).
> En la UI de movimientos se usa paso entero para evitar redondeos inesperados al guardar.

## Flujo de carga
- Al iniciar:
  1. Lee/crea `config.json`.
  2. Determina mes vigente en timezone `America/Argentina/Buenos_Aires`.
  3. Lee/crea solo `YYYY-MM.json` del mes vigente.
- Meses previos se cargan únicamente al usar **Comparar meses previos**.

## Desarrollo

```bash
npm install
npm run dev
```
