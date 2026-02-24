const DEFAULT_BASE_URL = "https://directus.drperez86.com";
const RETRY_DELAYS = [300, 900];
const DIRECTUS_SERVICE_EMAIL_KEY = "gastos02_directus_service_email";
const DIRECTUS_SERVICE_PASSWORD_KEY = "gastos02_directus_service_password";
const DIRECTUS_ACCESS_TOKEN_KEY = "gastos02_directus_access_token";
const DIRECTUS_REFRESH_TOKEN_KEY = "gastos02_directus_refresh_token";
const DIRECTUS_USER_EMAIL_KEY = "gastos02_directus_user_email";

const cfg = {
  baseUrl: localStorage.getItem("gastos02_directus_url") || DEFAULT_BASE_URL,
  serviceEmail: window.__GASTOS02_DIRECTUS_SERVICE_EMAIL || localStorage.getItem(DIRECTUS_SERVICE_EMAIL_KEY) || "",
  servicePassword: window.__GASTOS02_DIRECTUS_SERVICE_PASSWORD || localStorage.getItem(DIRECTUS_SERVICE_PASSWORD_KEY) || "",
  accessToken: localStorage.getItem(DIRECTUS_ACCESS_TOKEN_KEY) || "",
  refreshToken: localStorage.getItem(DIRECTUS_REFRESH_TOKEN_KEY) || "",
  loginPromise: null,
  refreshPromise: null
};

const TOKEN_KEYS = {
  access: DIRECTUS_ACCESS_TOKEN_KEY,
  refresh: DIRECTUS_REFRESH_TOKEN_KEY,
  email: DIRECTUS_USER_EMAIL_KEY
};

export function setDirectusConfig({ baseUrl, serviceEmail, servicePassword } = {}){
  if(typeof baseUrl === "string" && baseUrl.trim()){
    const nextBaseUrl = baseUrl.trim().replace(/\/$/, "");
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

function saveTokens(access, refresh, email){
  const safeAccess = typeof access === "string" ? access : "";
  const safeRefresh = typeof refresh === "string" ? refresh : "";
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
    access: localStorage.getItem(TOKEN_KEYS.access),
    refresh: localStorage.getItem(TOKEN_KEYS.refresh),
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
  const auth = await ensureAuth();
  if(!auth.ok){
    const err = new Error("No conectado a Directus. Iniciá sesión para continuar.");
    err.status = 401;
    err.code = "DIRECTUS_AUTH_REQUIRED";
    err.userMessage = "No conectado a Directus. Iniciá sesión para continuar.";
    throw err;
  }

  const url = normalizeUrlForDirectus(`${cfg.baseUrl}${path}`);
  let lastErr;
  let didRefresh = false;

  for(let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++){
    try{
      const res = await fetch(url, {
        ...options,
        headers: buildHeaders(options.headers)
      });
      if(res.status === 401 && !didRefresh){
        didRefresh = true;
        try{
          await refresh();
        }catch(_err){
          clearTokens();
          const authErr = new Error("Sesión expirada. Iniciá sesión nuevamente.");
          authErr.status = 401;
          authErr.code = "DIRECTUS_AUTH_REQUIRED";
          authErr.userMessage = "Sesión expirada. Iniciá sesión nuevamente.";
          throw authErr;
        }
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
        const err = new Error(`Directus error en ${path}: ${msg}`);
        err.status = res.status;
        if(res.status === 401) err.userMessage = "Sesión expirada. Iniciá sesión nuevamente.";
        if(res.status === 403) err.userMessage = "Sin permisos en Directus (403). Revisá el rol del usuario.";
        throw err;
      }
      return data;
    }catch(err){
      if(err?.status === 401 || err?.status === 403){
        throw err;
      }
      lastErr = err;
      const networkError = err instanceof TypeError;
      if(!networkError || attempt >= RETRY_DELAYS.length) break;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  throw new Error(`No se pudo conectar a Directus (${path}). ${lastErr?.message || "Error desconocido"}`);
}

async function ensureAuth(){
  const tokens = loadTokens();
  if(cfg.accessToken || tokens.access) return { ok: true, connected: true, source: "access_token" };

  if(tokens.refresh){
    try{
      await refresh();
      return { ok: true, connected: true, source: "refresh" };
    }catch(_err){
      clearTokens();
      return { ok: false, connected: false, reason: "refresh_failed" };
    }
  }

  if(cfg.serviceEmail && cfg.servicePassword){
    await login(cfg.serviceEmail, cfg.servicePassword, { force: true });
    return { ok: true, connected: true, source: "auto_login" };
  }
  return { ok: false, connected: false, reason: "missing_session" };
}

export { ensureAuth };

export async function login(email, password, { force = false } = {}){
  if(!force && cfg.accessToken) return cfg.accessToken;
  if(force) cfg.accessToken = "";
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
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
        throw new Error(`No se pudo autenticar en Directus: ${msg}`);
      }
      const token = data?.data?.access_token;
      const refreshToken = data?.data?.refresh_token;
      if(!token) throw new Error("Directus no devolvió access_token.");
      saveTokens(token, refreshToken, safeEmail);
      cfg.serviceEmail = safeEmail;
      cfg.servicePassword = safePassword;
      return token;
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
      saveTokens(nextAccessToken, nextRefreshToken);
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
  return request("/server/ping", { method: "GET" });
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
