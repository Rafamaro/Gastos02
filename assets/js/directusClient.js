const DEFAULT_BASE_URL = "https://directus.drperez86.com";
const RETRY_DELAYS = [300, 900];
const DIRECTUS_SERVICE_EMAIL_KEY = "gastos02_directus_service_email";
const DIRECTUS_SERVICE_PASSWORD_KEY = "gastos02_directus_service_password";
const LS_ACCESS = "gastos02_directus_access_token";
const LS_REFRESH = "gastos02_directus_refresh_token";
const DIRECTUS_USER_EMAIL_KEY = "gastos02_directus_user_email";

const cfg = {
  baseUrl: localStorage.getItem("gastos02_directus_url") || DEFAULT_BASE_URL,
  serviceEmail: window.__GASTOS02_DIRECTUS_SERVICE_EMAIL || localStorage.getItem(DIRECTUS_SERVICE_EMAIL_KEY) || "",
  servicePassword: window.__GASTOS02_DIRECTUS_SERVICE_PASSWORD || localStorage.getItem(DIRECTUS_SERVICE_PASSWORD_KEY) || "",
  accessToken: localStorage.getItem(LS_ACCESS) || "",
  refreshToken: localStorage.getItem(LS_REFRESH) || "",
  loginPromise: null,
  refreshPromise: null
};

const TOKEN_KEYS = {
  access: LS_ACCESS,
  refresh: LS_REFRESH,
  email: DIRECTUS_USER_EMAIL_KEY
};

export function setDirectusConfig({ baseUrl, serviceEmail, servicePassword } = {}){
  if(typeof baseUrl === "string" && baseUrl.trim()){
    // Aceptar URLs sin esquema (ej: "directus.dominio.com")
    const raw = baseUrl.trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const nextBaseUrl = withScheme.replace(/\/$/, "");
    if(nextBaseUrl !== cfg.baseUrl){
      cfg.baseUrl = nextBaseUrl;
      clearSession();
      localStorage.setItem("gastos02_directus_url", cfg.baseUrl);
    }
  }
  if(typeof serviceEmail === "string"){
    const nextEmail = serviceEmail.trim();
    if(nextEmail !== cfg.serviceEmail){
      cfg.serviceEmail = nextEmail;
      clearSession();
      localStorage.setItem(DIRECTUS_SERVICE_EMAIL_KEY, cfg.serviceEmail);
    }
  }
  if(typeof servicePassword === "string"){
    const nextPassword = servicePassword;
    if(nextPassword !== cfg.servicePassword){
      cfg.servicePassword = nextPassword;
      clearSession();
      localStorage.setItem(DIRECTUS_SERVICE_PASSWORD_KEY, cfg.servicePassword);
    }
  }
}

function buildHeaders(extra = {}){
  const headers = { "Content-Type": "application/json", ...extra };
  const { access } = loadTokens();
  const accessToken = access || cfg.accessToken;
  if(accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function saveTokens({ access, refresh, email } = {}){
  const safeAccess = cleanToken(access);
  const safeRefresh = cleanToken(refresh);
  cfg.accessToken = safeAccess;
  cfg.refreshToken = safeRefresh;
  if(safeAccess) localStorage.setItem(TOKEN_KEYS.access, safeAccess);
  else localStorage.removeItem(TOKEN_KEYS.access);
  if(safeRefresh) localStorage.setItem(TOKEN_KEYS.refresh, safeRefresh);
  else localStorage.removeItem(TOKEN_KEYS.refresh);
  if(typeof email === "string" && email.trim()) localStorage.setItem(TOKEN_KEYS.email, email.trim());
}

function loadTokens(){
  return {
    access: cleanToken(localStorage.getItem(TOKEN_KEYS.access)),
    refresh: cleanToken(localStorage.getItem(TOKEN_KEYS.refresh)),
    email: localStorage.getItem(TOKEN_KEYS.email)
  };
}

function clearTokens(){
  cfg.accessToken = "";
  cfg.refreshToken = "";
  localStorage.removeItem(TOKEN_KEYS.access);
  localStorage.removeItem(TOKEN_KEYS.refresh);
  localStorage.removeItem(TOKEN_KEYS.email);
}

export function clearSession(){
  clearTokens();
}

export function getSessionStatus(){
  const tokens = loadTokens();
  return {
    email: tokens.email || "",
    connected: Boolean(tokens.access || tokens.refresh)
  };
}

function cleanToken(value){
  if(typeof value !== "string") return "";
  const t = value.trim();
  if(!t) return "";
  // defensivo: evitar tokens corruptos guardados como strings
  if(t === "undefined" || t === "null" || t === "false") return "";
  return t;
}

function hasServiceCreds(){
  return Boolean(cfg.serviceEmail && cfg.servicePassword);
}

async function sleep(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}


function normalizeListParam(value){
  if(Array.isArray(value)) return value.map(item => String(item));
  if(typeof value !== "string") return null;
  const trimmed = value.trim();
  if(!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try{
    const parsed = JSON.parse(trimmed);
    if(!Array.isArray(parsed)) return null;
    return parsed.map(item => String(item));
  }catch(_err){
    return null;
  }
}

function normalizeUrlForDirectus(rawUrl){
  const url = new URL(rawUrl);
  ["fields", "sort"].forEach(key => {
    const current = url.searchParams.get(key);
    const normalized = normalizeListParam(current);
    if(normalized) url.searchParams.set(key, normalized.join(","));
  });
  return url.toString();
}

async function request(path, options = {}){
  const requiresAuth = options.requiresAuth !== false;
  if(requiresAuth){
    const auth = await ensureAuth();
    if(!auth.ok){
      const err = new Error("AUTH_REQUIRED");
      err.status = 401;
      err.code = "AUTH_REQUIRED";
      err.reason = auth.reason || "auth_missing";
      err.userMessage = auth.userMessage || "No conectado a Directus. Iniciá sesión para continuar.";
      throw err;
    }
  }

  const url = normalizeUrlForDirectus(`${cfg.baseUrl}${path}`);

  const execute = async ()=>{
    const res = await fetch(url, {
      ...options,
      headers: buildHeaders(options.headers)
    });

    // Directus puede responder 204 en DELETE
    if(res.status === 204) return { data: null };

    const ctype = String(res.headers.get("content-type") || "").toLowerCase();
    const isJson = ctype.includes("application/json");
    if(!isJson){
      // Típico de Cloudflare Access / redirect / reverse-proxy devolviendo HTML
      const sample = await res.text().catch(()=> "");
      const err = new Error(`Respuesta no JSON desde Directus (${path}). status=${res.status}`);
      err.status = res.status;
      err.code = "DIRECTUS_NON_JSON";
      err.userMessage = "Directus respondió contenido no-JSON (probable Cloudflare Access, redirección o proxy). Revisá que la URL apunte al API de Directus y que no esté protegida por Access.";
      err.debug = { url: res.url, contentType: ctype, sample: sample.slice(0, 180) };
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
      const err = new Error(`Directus error en ${path}: ${msg}`);
      err.status = res.status;
      if(res.status === 401){
        err.code = "AUTH_REQUIRED";
        err.userMessage = "Sesión expirada. Iniciá sesión nuevamente.";
      }
      if(res.status === 403) err.userMessage = "Sin permisos en Directus (403). Revisá el rol del usuario.";
      throw err;
    }
    // Si es /items/* y no vino {data: ...}, es sospechoso (proxy/Access suele romper el shape)
    if(path.startsWith("/items/") && data?.data === undefined){
      const err = new Error(`Respuesta inesperada desde Directus (${path}).`);
      err.status = res.status;
      err.code = "DIRECTUS_BAD_SHAPE";
      err.userMessage = "Directus devolvió una respuesta inesperada. Si usás Access/proxy, puede estar alterando el response.";
      throw err;
    }
    return data;
  };

  let lastErr;
  for(let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++){
    try{
      return await execute();
    }catch(err){
      if(err?.status === 401){
        try{
          await refresh();
          return await execute();
        }catch(_refreshErr){
          // Si falla el refresh, intentamos reloguear con credenciales de servicio (si están guardadas)
          clearTokens();
          if(hasServiceCreds()){
            try{
              await login(cfg.serviceEmail, cfg.servicePassword);
              return await execute();
            }catch(_loginErr){
              // sigue al bloque de error estándar
            }
          }
          const authErr = new Error("AUTH_REQUIRED");
          authErr.status = 401;
          authErr.code = "AUTH_REQUIRED";
          authErr.userMessage = "Sesión expirada. Iniciá sesión nuevamente.";
          throw authErr;
        }
      }
      if(err?.status === 403) throw err;
      lastErr = err;
      const networkError = err instanceof TypeError;
      if(!networkError || attempt >= RETRY_DELAYS.length) break;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  throw new Error(`No se pudo conectar a Directus (${path}). ${lastErr?.message || "Error desconocido"}`);
}

async function ensureAuth(){
  const { access, refresh: refreshToken } = loadTokens();
  if(access){
    cfg.accessToken = access;
    return { ok: true, access };
  }

  if(refreshToken){
    try{
      await refresh();
      return { ok: true };
    }catch(_err){
      if(hasServiceCreds()){
        try{
          await login(cfg.serviceEmail, cfg.servicePassword);
          return { ok: true, source: "service_login_after_refresh_fail" };
        }catch(__loginErr){
          clearTokens();
          return { ok: false, reason: "refresh_and_login_failed", userMessage: `Sesión inválida y falló el login automático. ${String(__loginErr?.message || "").slice(0,180)}` };
        }
      }

      clearTokens();
      return { ok: false, reason: "refresh_failed" };
    }
  }

  // Auto-login con credenciales guardadas (modo "usuario de servicio")
  if(hasServiceCreds()){
    try{
      await login(cfg.serviceEmail, cfg.servicePassword);
      return { ok: true, source: "service_login" };
    }catch(_err){
      clearTokens();
      return { ok: false, reason: "login_failed", userMessage: `No se pudo iniciar sesión en Directus con el usuario configurado. ${String(_err?.message || "").slice(0,180)}` };
    }
  }

  return { ok: false, reason: "missing_session" };
}

export { ensureAuth };

export async function login(email, password){
  if(cfg.loginPromise) return cfg.loginPromise;

  const safeEmail = typeof email === "string" ? email.trim() : "";
  const safePassword = typeof password === "string" ? password : "";
  if(!safeEmail || !safePassword){
    throw new Error("Faltan credenciales del usuario de servicio de Directus.");
  }

  cfg.loginPromise = fetch(`${cfg.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: safeEmail, password: safePassword })
  })
    .then(async res => {
      const ctype = String(res.headers.get("content-type") || "").toLowerCase();
      const isJson = ctype.includes("application/json");
      if(!isJson){
        const sample = await res.text().catch(()=> "");
        throw new Error(`Auth/login no devolvió JSON (status=${res.status}). Posible Cloudflare Access / proxy. Sample: ${sample.slice(0, 120)}`);
      }

      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
        throw new Error(`No se pudo autenticar en Directus: ${msg}`);
      }
      const accessToken = data?.data?.access_token;
      const refreshToken = data?.data?.refresh_token;
      if(!accessToken) throw new Error("Directus no devolvió access_token.");
      saveTokens({ access: accessToken, refresh: refreshToken, email: safeEmail });
      cfg.serviceEmail = safeEmail;
      cfg.servicePassword = safePassword;
      return data.data;
    })
    .finally(()=>{ cfg.loginPromise = null; });

  return cfg.loginPromise;
}

export async function refresh(){
  if(cfg.refreshPromise) return cfg.refreshPromise;
  const { refresh: refreshToken } = loadTokens();
  if(!refreshToken) throw new Error("Sesión expirada. Iniciá sesión nuevamente.");

  cfg.refreshPromise = fetch(`${cfg.baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  })
    .then(async res => {
      const ctype = String(res.headers.get("content-type") || "").toLowerCase();
      const isJson = ctype.includes("application/json");
      if(!isJson){
        const sample = await res.text().catch(()=> "");
        clearTokens();
        const err = new Error(`Auth/refresh no devolvió JSON (status=${res.status}). Posible Cloudflare Access / proxy.`);
        err.status = res.status;
        err.userMessage = "No se pudo refrescar la sesión: Directus devolvió contenido no-JSON (posible Access/proxy).";
        err.debug = { url: res.url, contentType: ctype, sample: sample.slice(0, 180) };
        throw err;
      }

      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        clearTokens();
        const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
        const err = new Error(`Sesión expirada: ${msg}`);
        err.status = res.status;
        err.userMessage = "Sesión expirada. Iniciá sesión nuevamente.";
        throw err;
      }
      const nextAccessToken = data?.data?.access_token;
      const nextRefreshToken = data?.data?.refresh_token || refreshToken;
      if(!nextAccessToken){
        clearTokens();
        throw new Error("Sesión expirada. Iniciá sesión nuevamente.");
      }
      saveTokens({ access: nextAccessToken, refresh: nextRefreshToken });
      return nextAccessToken;
    })
    .finally(()=>{ cfg.refreshPromise = null; });

  return cfg.refreshPromise;
}

function toQuery(params = {}){
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{
    if(v == null) return;
    if((k === "fields" || k === "sort") && Array.isArray(v)){
      qs.set(k, v.map(item => String(item)).join(","));
      return;
    }
    const normalizedList = normalizeListParam(v);
    if(normalizedList){
      qs.set(k, normalizedList.join(","));
      return;
    }
    if(typeof v === "object"){
      qs.set(k, JSON.stringify(v));
      return;
    }
    qs.set(k, String(v));
  });
  const q = qs.toString();
  return q ? `?${q}` : "";
}

export async function ping(){
  // /server/ping es público en Directus (no requiere auth)
  return request("/server/ping", { method: "GET", requiresAuth: false });
}

export async function getItems(collection, params = {}){
  const out = await request(`/items/${collection}${toQuery(params)}`, { method: "GET" });
  return out?.data || [];
}

export async function createItem(collection, payload){
  const out = await request(`/items/${collection}`, { method: "POST", body: JSON.stringify(payload) });
  return out?.data;
}

export async function updateItem(collection, id, payload){
  const out = await request(`/items/${collection}/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  return out?.data;
}

export async function deleteItem(collection, id){
  await request(`/items/${collection}/${id}`, { method: "DELETE" });
  return true;
}

export async function findOneByFilter(collection, filter){
  const rows = await getItems(collection, { filter, limit: 1 });
  return rows[0] || null;
}

export async function upsertByUnique(collection, uniqueField, value, payload){
  const found = await findOneByFilter(collection, { [uniqueField]: { _eq: value } });
  if(found) return updateItem(collection, found.id || found[uniqueField], payload);
  return createItem(collection, { ...payload, [uniqueField]: value });
}

export const directusClient = {
  login,
  refresh,
  clearSession,
  getSessionStatus,
  setDirectusConfig,
  ping,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  findOneByFilter,
  upsertByUnique,
  ensureAuth
};

if(typeof window !== "undefined"){
  window.directusClient = directusClient;
}

export default directusClient;
