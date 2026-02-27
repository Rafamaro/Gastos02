#!/usr/bin/env node

const DIRECTUS_URL = String(process.env.DIRECTUS_URL || "").trim().replace(/\/+$/, "");
const DIRECTUS_ADMIN_TOKEN = String(process.env.DIRECTUS_ADMIN_TOKEN || "").trim();
const DIRECTUS_ADMIN_EMAIL = String(process.env.DIRECTUS_ADMIN_EMAIL || "").trim();
const DIRECTUS_ADMIN_PASSWORD = String(process.env.DIRECTUS_ADMIN_PASSWORD || "").trim();

if(!DIRECTUS_URL){
  console.error("❌ Falta DIRECTUS_URL");
  process.exit(1);
}

const summary = { collections: [], fields: [], relations: [], policies: [], roles: [], access: [], permissions: [] };

const COLLECTIONS = ["categories", "groups", "movements", "budgets", "settings", "imports_log"];

function errorMessage(err){
  return String(err?.payload?.errors?.[0]?.message || err?.message || "");
}

function isNotFoundOrMissingCollection(err){
  const message = errorMessage(err).toLowerCase();
  return err?.status === 404 || message.includes("does not exist") || message.includes("route /") && message.includes("doesn't exist");
}

async function http(path, { method = "GET", token, body } = {}){
  const headers = { "Content-Type": "application/json" };
  if(token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if(!response.ok){
    const message = payload?.errors?.[0]?.message || payload?.error || `${method} ${path} falló (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    console.error(`❌ HTTP ${response.status} ${method} ${path}`);
    console.error(JSON.stringify(payload, null, 2));
    throw err;
  }
  return payload;
}

async function getAdminToken(){
  if(DIRECTUS_ADMIN_TOKEN) return DIRECTUS_ADMIN_TOKEN;
  if(!DIRECTUS_ADMIN_EMAIL || !DIRECTUS_ADMIN_PASSWORD){
    throw new Error("Definí DIRECTUS_ADMIN_TOKEN o DIRECTUS_ADMIN_EMAIL + DIRECTUS_ADMIN_PASSWORD");
  }
  const payload = await http("/auth/login", {
    method: "POST",
    body: { email: DIRECTUS_ADMIN_EMAIL, password: DIRECTUS_ADMIN_PASSWORD, mode: "json" }
  });
  return payload?.data?.access_token;
}

async function collectionExists(token, collection){
  const res = await http("/collections", { token });
  const list = res?.data || res;
  return Array.isArray(list) && list.some((c) => c.collection === collection);
}

async function ensureCollection(token, payload){
  const collection = payload.collection;
  const exists = await collectionExists(token, collection);
  if(exists){
    summary.collections.push(`${collection}:ok`);
    return;
  }

  await http("/collections", { method: "POST", token, body: payload });
  summary.collections.push(`${collection}:created`);
  console.log(`✅ Creada colección: ${collection}`);
}

async function listFields(token, collection){
  try{
    const result = await http(`/fields/${collection}`, { token });
    const fields = result?.data || result;
    return Array.isArray(fields) ? fields : [];
  }catch(err){
    if(err?.status === 403){
      console.error(`❌ Sin acceso para listar campos de ${collection}. Verificá políticas con acceso a system/fields.`);
      console.error(JSON.stringify(err?.payload || {}, null, 2));
    }
    throw err;
  }
}

async function fieldExists(token, collection, field){
  const fields = await listFields(token, collection);
  return fields.some((item) => item?.field === field);
}

async function ensureField(token, collection, field, type, extras = {}){
  const body = { field, type, ...extras };
  if(await fieldExists(token, collection, body.field)){
    summary.fields.push(`${collection}.${field}:ok`);
    return;
  }
  await http(`/fields/${collection}`, { method: "POST", token, body });
  summary.fields.push(`${collection}.${field}:created`);
  console.log(`✅ Creado campo: ${collection}.${body.field}`);
}


async function ensureFieldPrecisionScale(token, collection, field, { precision, scale } = {}){
  const fields = await listFields(token, collection);
  const current = fields.find((item) => item?.field === field);
  if(!current) return;

  const currentPrecision = Number(current?.schema?.numeric_precision ?? current?.schema?.precision ?? NaN);
  const currentScale = Number(current?.schema?.numeric_scale ?? current?.schema?.scale ?? NaN);
  if(currentPrecision === Number(precision) && currentScale === Number(scale)){
    summary.fields.push(`${collection}.${field}:precision-ok`);
    return;
  }

  await http(`/fields/${collection}/${field}`, {
    method: "PATCH",
    token,
    body: {
      schema: {
        numeric_precision: Number(precision),
        numeric_scale: Number(scale)
      }
    }
  });
  summary.fields.push(`${collection}.${field}:precision-updated`);
  console.log(`✅ Actualizado ${collection}.${field} a numeric(${precision},${scale})`);
}


async function ensurePolicy(token, name){
  const found = await http(`/policies?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`, { token });
  if(found?.data?.[0]?.id){
    summary.policies.push(`${name}:ok`);
    return found.data[0].id;
  }

  const created = await http("/policies", {
    method: "POST",
    token,
    body: {
      name,
      admin_access: false,
      app_access: true,
      ip_access: null,
      enforce_tfa: false,
      description: name === "app_admin" ? "Política administrador funcional de Gastos02" : "Política usuario final Gastos02"
    }
  });

  summary.policies.push(`${name}:created`);
  return created?.data?.id;
}

async function ensureRole(token, name){
  const found = await http(`/roles?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`, { token });
  if(found?.data?.[0]?.id){
    summary.roles.push(`${name}:ok`);
    return found.data[0].id;
  }
  const created = await http("/roles", {
    method: "POST",
    token,
    body: {
      name,
      icon: name === "app_admin" ? "admin_panel_settings" : "person",
      app_access: true,
      admin_access: false,
      description: name === "app_admin" ? "Administrador funcional de Gastos02" : "Usuario final Gastos02"
    }
  });
  summary.roles.push(`${name}:created`);
  return created?.data?.id;
}

async function ensureAccessLink(token, roleId, policyId, roleName, policyName){
  const found = await http(`/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&limit=1`, { token });
  if(found?.data?.[0]?.id){
    summary.access.push(`${roleName}->${policyName}:ok`);
    return found.data[0].id;
  }

  const created = await http("/access", {
    method: "POST",
    token,
    body: {
      role: roleId,
      policy: policyId
    }
  });
  summary.access.push(`${roleName}->${policyName}:created`);
  return created?.data?.id;
}

async function ensurePermission(token, policyId, collection, action, fields = "*", permissions = {}, validation = {}, presets = {}){
  const found = await http(`/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`, { token });
  const body = {
    policy: policyId,
    collection,
    action,
    permissions: permissions || {},
    validation: validation || {},
    presets: presets || {},
    fields: Array.isArray(fields) ? fields : [fields]
  };

  if(found?.data?.[0]?.id){
    await http(`/permissions/${found.data[0].id}`, { method: "PATCH", token, body });
    summary.permissions.push(`${collection}.${action}:ok`);
  }else{
    await http("/permissions", { method: "POST", token, body });
    summary.permissions.push(`${collection}.${action}:created`);
  }
}

async function ensureRelation(token, manyCollection, manyField, oneCollection){
  const existing = await http(`/relations?filter[many_collection][_eq]=${manyCollection}&filter[many_field][_eq]=${manyField}&limit=1`, { token });
  if(existing?.data?.length){
    summary.relations.push(`${manyCollection}.${manyField}:ok`);
    return;
  }
  await http("/relations", {
    method: "POST",
    token,
    body: {
      many_collection: manyCollection,
      many_field: manyField,
      one_collection: oneCollection
    }
  });
  summary.relations.push(`${manyCollection}.${manyField}:created`);
}

async function ensureSchema(token){
  const commonMeta = { note: "Gastos02", accountability: "all", hidden: false, singleton: false };
  const commonSchema = { name: null };
  for(const collection of COLLECTIONS){
    await ensureCollection(token, { collection, meta: commonMeta, schema: commonSchema });
  }

  await ensureField(token, "categories", "name", "string", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "categories", "type", "string", { schema: { is_nullable: false, default_value: "expense" }, meta: { required: true, options: { choices: [{ text: "expense", value: "expense" }, { text: "income", value: "income" }] } } });
  await ensureField(token, "categories", "group", "uuid", { schema: { is_nullable: true, foreign_key_table: "groups", foreign_key_column: "id" }, meta: { special: ["m2o"], interface: "select-dropdown-m2o" } });
  await ensureField(token, "categories", "sort", "integer", { schema: { is_nullable: true } });
  await ensureField(token, "categories", "color", "string", { schema: { is_nullable: true } });
  await ensureField(token, "categories", "icon", "string", { schema: { is_nullable: true } });
  await ensureField(token, "categories", "is_active", "boolean", { schema: { is_nullable: false, default_value: true }, meta: { required: false } });

  await ensureField(token, "groups", "name", "string", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "groups", "type", "string", { schema: { is_nullable: false, default_value: "expense" }, meta: { required: true, options: { choices: [{ text: "expense", value: "expense" }, { text: "income", value: "income" }] } } });
  await ensureField(token, "groups", "sort", "integer", { schema: { is_nullable: true } });
  await ensureField(token, "groups", "color", "string", { schema: { is_nullable: true } });
  await ensureField(token, "groups", "icon", "string", { schema: { is_nullable: true } });
  await ensureField(token, "groups", "is_active", "boolean", { schema: { is_nullable: false, default_value: true } });

  await ensureField(token, "movements", "date", "date", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "movements", "amount", "decimal", { schema: { is_nullable: false, numeric_precision: 14, numeric_scale: 2 }, meta: { required: true } });
  await ensureFieldPrecisionScale(token, "movements", "amount", { precision: 14, scale: 2 });
  await ensureField(token, "movements", "type", "string", { schema: { is_nullable: false, default_value: "expense" }, meta: { required: true, options: { choices: [{ text: "expense", value: "expense" }, { text: "income", value: "income" }] } } });
  await ensureField(token, "movements", "category", "uuid", { schema: { is_nullable: false, foreign_key_table: "categories", foreign_key_column: "id" }, meta: { special: ["m2o"], interface: "select-dropdown-m2o", required: true } });
  await ensureField(token, "movements", "group_snapshot", "string", { schema: { is_nullable: true } });
  await ensureField(token, "movements", "note", "text", { schema: { is_nullable: true } });
  await ensureField(token, "movements", "source", "string", { schema: { is_nullable: true } });
  await ensureField(token, "movements", "imported_batch_id", "string", { schema: { is_nullable: true } });

  await ensureField(token, "budgets", "month", "string", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "budgets", "group", "uuid", { schema: { is_nullable: true, foreign_key_table: "groups", foreign_key_column: "id" }, meta: { special: ["m2o"], interface: "select-dropdown-m2o" } });
  await ensureField(token, "budgets", "category", "uuid", { schema: { is_nullable: true, foreign_key_table: "categories", foreign_key_column: "id" }, meta: { special: ["m2o"], interface: "select-dropdown-m2o" } });
  await ensureField(token, "budgets", "amount", "decimal", { schema: { is_nullable: false }, meta: { required: true } });

  await ensureField(token, "settings", "key", "string", { schema: { is_nullable: false, is_unique: true }, meta: { required: true } });
  await ensureField(token, "settings", "value", "json", { schema: { is_nullable: false }, meta: { required: true } });

  await ensureField(token, "imports_log", "month", "string", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "imports_log", "source", "string", { schema: { is_nullable: false }, meta: { required: true } });
  await ensureField(token, "imports_log", "status", "string", { schema: { is_nullable: false }, meta: { required: true, options: { choices: [{ text: "ok", value: "ok" }, { text: "error", value: "error" }] } } });
  await ensureField(token, "imports_log", "summary", "json", { schema: { is_nullable: true } });
  await ensureField(token, "imports_log", "created_at", "timestamp", { schema: { is_nullable: true, default_value: "$NOW" }, meta: { special: ["date-created"], interface: "datetime" } });

  await ensureRelation(token, "categories", "group", "groups");
  await ensureRelation(token, "movements", "category", "categories");
  await ensureRelation(token, "budgets", "group", "groups");
  await ensureRelation(token, "budgets", "category", "categories");
}

async function safeReadItems(token, collection){
  try{
    return await http(`/items/${collection}?limit=1`, { token });
  }catch(err){
    if(!isNotFoundOrMissingCollection(err)) throw err;
    await ensureSchema(token);
    return http(`/items/${collection}?limit=1`, { token });
  }
}

(async () => {
  const token = await getAdminToken();
  await ensureSchema(token);

  const appAdminPolicyId = await ensurePolicy(token, "app_admin");
  const appUserPolicyId = await ensurePolicy(token, "app_user");
  const appAdminRoleId = await ensureRole(token, "app_admin");
  const appUserRoleId = await ensureRole(token, "app_user");

  await ensureAccessLink(token, appAdminRoleId, appAdminPolicyId, "app_admin", "app_admin");
  await ensureAccessLink(token, appUserRoleId, appUserPolicyId, "app_user", "app_user");

  for(const collection of COLLECTIONS){
    for(const action of ["create", "read", "update", "delete"]){
      await ensurePermission(token, appAdminPolicyId, collection, action);
    }
  }

  const ownFilter = { user_created: { _eq: "$CURRENT_USER" } };
  const appUserCollections = [...COLLECTIONS];
  let currentUserSupported = true;

  try{
    for(const collection of appUserCollections){
      await ensurePermission(token, appUserPolicyId, collection, "create");
      await ensurePermission(token, appUserPolicyId, collection, "read", "*", ownFilter);
      await ensurePermission(token, appUserPolicyId, collection, "update", "*", ownFilter);
      await ensurePermission(token, appUserPolicyId, collection, "delete", "*", ownFilter);
    }
  }catch(err){
    const message = errorMessage(err).toLowerCase();
    if(message.includes("$current_user") || message.includes("current_user")){
      currentUserSupported = false;
      console.warn("⚠️ $CURRENT_USER no soportado, dejando app_user en modo read-only temporal.");
    }else{
      throw err;
    }
  }

  if(!currentUserSupported){
    for(const collection of appUserCollections){
      await ensurePermission(token, appUserPolicyId, collection, "read");
    }
  }

  await safeReadItems(token, "categories");
  await safeReadItems(token, "groups");

  console.log("\n✅ Bootstrap Directus completado");
  console.log("Colecciones:", summary.collections.join(", "));
  console.log("Campos:", summary.fields.length);
  console.log("Relaciones:", summary.relations.join(", "));
  console.log("Policies:", summary.policies.join(", "));
  console.log("Roles:", summary.roles.join(", "));
  console.log("Access:", summary.access.join(", "));
  console.log("Permisos:", summary.permissions.length);
})().catch(err => {
  console.error("❌ Error en bootstrap:", err.message);
  if(err?.status) console.error("Status:", err.status);
  if(err?.payload) console.error(JSON.stringify(err.payload, null, 2));
  process.exit(1);
});
