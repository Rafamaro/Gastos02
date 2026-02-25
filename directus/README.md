# Directus schema package (Gastos02)

Este paquete alinea Directus con los endpoints y payloads que usa la app.

## 1) Importar snapshot

1. Entrar a Directus con un usuario admin.
2. Ir a **Settings → Data Model / Schema**.
3. Elegir **Import / Apply snapshot**.
4. Seleccionar `directus/schema-snapshot.json`.
5. Aplicar cambios.

> Importante: si tu proyecto ya tenía colecciones con otro key (ej: `Settings`, `gastos_settings`), el endpoint correcto para esta app **debe** ser exactamente:
>
> - `settings`
> - `categories`
> - `transactions`
> - `budgets`
> - `currencies`
> - `expense_groups`

## 2) IDs auto-generados (evitar “id required”)

Para cada colección anterior:

- Campo `id`: tipo **UUID**
- `id` debe ser **auto-generated** por Directus
- `id` **no** debe pedirse en create

## 3) Campos y tipos mínimos

### settings
- `id` (uuid)
- `base_currency` (m2o a `currencies`) + `locale` (string)
- Compat adicional (opcional) para config expandida: `baseCurrency`, `currencies`, `ratesToBase`, `expenseCategories`, `incomeCategories`, `expenseGroups`, `expenseCategoryGroups`

### categories
- `id` (uuid)
- `name` (string, required)
- `type` (string: `expense|income`, required)
- `group` (m2o a `expense_groups`, nullable)
- Recomendado: unique compuesto `(name, type)`

### transactions
- `id` (uuid)
- `type` (`expense|income`)
- `date` (date)
- `amount` (decimal)
- `currency` (m2o a `currencies`)
- `category` (m2o a `categories`)
- `vendor`, `pay`, `desc` (string)
- `notes` (text)
- `tags` (json array)

### budgets
- `id` (uuid)
- `month` (string `YYYY-MM`)
- `category` (m2o a `categories`)
- `amount` (decimal)
- `currency` (m2o a `currencies`)
- Recomendado: unique `(month, category, currency)`

### currencies
- `id` (uuid)
- `code` (string, unique)
- `name` (string)
- `symbol` (string)
- `decimals` (integer)
- `rateToBase` (decimal)

### expense_groups
- `id` (uuid)
- `name` (string, unique)
- `description` (text)

## 4) Permisos del rol usado por la app

Al rol del usuario de servicio (o admin) darle CRUD en:

- `settings`
- `categories`
- `transactions`
- `budgets`
- `currencies`
- `expense_groups`

Sin esto aparecen falsos 401/403.

## 5) Checklist de validación (API)

Asumiendo `DIRECTUS_URL` y `TOKEN` válidos:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$DIRECTUS_URL/items/settings?limit=1"
```

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Comida","type":"expense"}' \
  "$DIRECTUS_URL/items/categories"
```

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"expense","date":"2026-02-25","amount":1200,"vendor":"Demo","pay":"Efectivo","desc":"Test","notes":"","tags":[]}' \
  "$DIRECTUS_URL/items/transactions"
```

### Resultado esperado

- No aparece `Route /items/... doesn\'t exist`
- No aparece `id required`
- Los creates funcionan sin mandar `id`
