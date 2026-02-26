import { LS } from "./constants.js";

const DEFAULT_BASE_URL = "https://directus.drperez86.com";

function normalizeBaseUrl(baseUrl){
  const raw = String(baseUrl || "").trim() || localStorage.getItem(LS.DX_URL) || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function makeError(message, fallback){
  const err = new Error(message || fallback || "Error de Directus");
  err.userMessage = message || fallback || "Error de Directus";
  return err;
}

function extractErrorMessage(payload){
  if(!payload) return "";
  if(typeof payload === "string") return payload;
  if(Array.isArray(payload?.errors) && payload.errors[0]){
    return payload.errors[0].message || payload.errors[0].extensions?.reason || "";
  }
  return payload.message || payload.error || "";
}

async function requestJson(url, options = {}, fallbackMessage = "No se pudo completar la operación con Directus"){
  let response;
  try{
    response = await fetch(url, options);
  }catch(_err){
    throw makeError("No se pudo conectar con Directus. Verificá URL y red.", fallbackMessage);
  }

  let payload = null;
  try{ payload = await response.json(); }catch(_err){ payload = null; }

  if(!response.ok){
    const msg = extractErrorMessage(payload) || `${fallbackMessage} (HTTP ${response.status})`;
    const err = makeError(msg, fallbackMessage);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function authHeaders(access_token){
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${access_token}`
  };
}

function warnInvalidFieldSortParam(key, rawValue){
  if(!import.meta.env?.DEV) return;
  if(key !== "fields" && key !== "sort") return;
  const candidate = String(rawValue || "");
  if(candidate.includes("[") || candidate.includes("]")){
    console.warn(`[Directus] Query param "${key}" parece estar serializado como JSON. Usá CSV (ej: ${key}=id,date). Valor recibido:`, rawValue);
  }
}

function buildQuery(query = {}){
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if(value === undefined || value === null || value === "") return;

    if(Array.isArray(value)){
      const csvValue = value.map(v => String(v)).join(",");
      warnInvalidFieldSortParam(key, csvValue);
      params.set(key, csvValue);
      return;
    }

    if(typeof value === "object"){
      params.set(key, JSON.stringify(value));
      return;
    }

    warnInvalidFieldSortParam(key, value);
    params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function saveSession(session = {}){
  const normalized = {
    baseUrl: normalizeBaseUrl(session.baseUrl),
    access_token: session.access_token || "",
    refresh_token: session.refresh_token || "",
    expires: Number(session.expires || 0)
  };
  localStorage.setItem(LS.DX_AUTH, JSON.stringify(normalized));
  localStorage.setItem(LS.DX_URL, normalized.baseUrl);
  return normalized;
}

export function loadSession(){
  const baseUrl = normalizeBaseUrl(localStorage.getItem(LS.DX_URL));
  try{
    const raw = localStorage.getItem(LS.DX_AUTH);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl || baseUrl),
      access_token: parsed.access_token || "",
      refresh_token: parsed.refresh_token || "",
      expires: Number(parsed.expires || 0)
    };
  }catch(_err){
    clearSession();
    return null;
  }
}

export function clearSession(){
  localStorage.removeItem(LS.DX_AUTH);
}

export async function ping(baseUrl){
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  return requestJson(`${cleanBaseUrl}/server/ping`, { method: "GET" }, "Ping falló");
}

export async function login({ baseUrl, email, password, otp } = {}){
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const safeEmail = String(email || "").trim();
  const safePassword = String(password || "");
  if(!safeEmail || !safePassword) throw makeError("Ingresá email y password para conectar.");

  const body = { email: safeEmail, password: safePassword, mode: "json" };
  const safeOtp = String(otp || "").trim();
  if(safeOtp) body.otp = safeOtp;

  const payload = await requestJson(`${cleanBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, "No se pudo iniciar sesión");

  const session = {
    baseUrl: cleanBaseUrl,
    access_token: payload?.data?.access_token || "",
    refresh_token: payload?.data?.refresh_token || "",
    expires: Number(payload?.data?.expires || 0)
  };

  if(!session.access_token || !session.refresh_token){
    throw makeError("Respuesta de login inválida: faltan tokens.");
  }

  return session;
}

export async function refresh({ baseUrl, refresh_token } = {}){
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  if(!refresh_token) throw makeError("No hay refresh_token para renovar sesión.");

  const payload = await requestJson(`${cleanBaseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token, mode: "json" })
  }, "No se pudo refrescar la sesión");

  const refreshed = {
    baseUrl: cleanBaseUrl,
    access_token: payload?.data?.access_token || "",
    refresh_token: payload?.data?.refresh_token || refresh_token,
    expires: Number(payload?.data?.expires || 0)
  };

  if(!refreshed.access_token){
    throw makeError("Directus no devolvió access_token al refrescar.");
  }
  return refreshed;
}

export async function logout({ baseUrl, refresh_token } = {}){
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  if(!refresh_token) return { ok: true };
  return requestJson(`${cleanBaseUrl}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token, mode: "json" })
  }, "No se pudo cerrar la sesión");
}

export async function getMe({ baseUrl, access_token } = {}){
  if(!access_token) throw makeError("No hay access_token para consultar el usuario.");
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const payload = await requestJson(
    `${cleanBaseUrl}/users/me?fields=id,email,first_name,last_name,role.id,role.name`,
    { method: "GET", headers: authHeaders(access_token) },
    "No se pudo obtener el usuario actual"
  );
  if(!payload?.data?.id) throw makeError("Directus no devolvió datos del usuario actual.");
  return payload.data;
}

export async function getMyPermissions({ baseUrl, access_token } = {}){
  if(!access_token) throw makeError("No hay access_token para consultar permisos.");
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const payload = await requestJson(
    `${cleanBaseUrl}/permissions/me`,
    { method: "GET", headers: authHeaders(access_token) },
    "No se pudieron obtener los permisos efectivos"
  );
  return Array.isArray(payload?.data) ? payload.data : [];
}

export function buildAbilities(permissions = []){
  const out = {};
  for(const perm of permissions){
    const collection = String(perm?.collection || "").trim() || "*";
    const action = String(perm?.action || "").trim();
    if(!out[collection]) out[collection] = { read: false, create: false, update: false, delete: false };
    if(action === "read" || action === "create" || action === "update" || action === "delete"){
      out[collection][action] = true;
    }
  }
  return out;
}

function extractRole(user){
  if(!user?.role) return null;
  return { id: user.role.id || null, name: user.role.name || "Sin rol" };
}

export async function ensureSession(){
  const session = loadSession();
  if(!session?.access_token) return { connected: false, baseUrl: normalizeBaseUrl(session?.baseUrl) };

  const tryCurrentToken = async(activeSession) => {
    const user = await getMe(activeSession);
    const permissions = await getMyPermissions(activeSession);
    return {
      connected: true,
      baseUrl: normalizeBaseUrl(activeSession.baseUrl),
      access_token: activeSession.access_token,
      refresh_token: activeSession.refresh_token,
      expires: activeSession.expires,
      user,
      role: extractRole(user),
      permissions,
      abilities: buildAbilities(permissions)
    };
  };

  try{
    return await tryCurrentToken(session);
  }catch(err){
    if(err?.status !== 401){
      clearSession();
      throw err;
    }
  }

  try{
    const renewed = await refresh({ baseUrl: session.baseUrl, refresh_token: session.refresh_token });
    const merged = saveSession({ ...session, ...renewed });
    return await tryCurrentToken(merged);
  }catch(err){
    clearSession();
    return { connected: false, baseUrl: normalizeBaseUrl(session.baseUrl), error: err };
  }
}

export async function requestAuthed({ baseUrl, access_token, path, method = "GET", body, fallbackMessage } = {}){
  if(!access_token) throw makeError("No hay access_token para operar con Directus.");
  const cleanBaseUrl = normalizeBaseUrl(baseUrl);
  const options = { method, headers: authHeaders(access_token) };
  if(body !== undefined) options.body = JSON.stringify(body);
  return requestJson(
    `${cleanBaseUrl}${path}`,
    options,
    fallbackMessage || "No se pudo completar la operación con Directus"
  );
}

export async function listItems({ baseUrl, access_token, collection, query } = {}){
  const payload = await requestAuthed({
    baseUrl,
    access_token,
    path: `/items/${collection}${buildQuery(query)}`,
    fallbackMessage: `No se pudo listar ${collection}`
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function createItem({ baseUrl, access_token, collection, data } = {}){
  const payload = await requestAuthed({
    baseUrl,
    access_token,
    path: `/items/${collection}`,
    method: "POST",
    body: data,
    fallbackMessage: `No se pudo crear en ${collection}`
  });
  return payload?.data || null;
}

export async function createItems({ baseUrl, access_token, collection, data } = {}){
  const payload = await requestAuthed({
    baseUrl,
    access_token,
    path: `/items/${collection}`,
    method: "POST",
    body: data,
    fallbackMessage: `No se pudo crear lote en ${collection}`
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function updateItem({ baseUrl, access_token, collection, id, data } = {}){
  const payload = await requestAuthed({
    baseUrl,
    access_token,
    path: `/items/${collection}/${id}`,
    method: "PATCH",
    body: data,
    fallbackMessage: `No se pudo actualizar ${collection}`
  });
  return payload?.data || null;
}

export async function deleteItem({ baseUrl, access_token, collection, id } = {}){
  await requestAuthed({
    baseUrl,
    access_token,
    path: `/items/${collection}/${id}`,
    method: "DELETE",
    fallbackMessage: `No se pudo eliminar ${collection}`
  });
  return true;
}
