const DEFAULT_BASE_URL = "https://directus.drperez86.com";
const RETRY_DELAYS = [300, 900];
const DIRECTUS_SERVICE_EMAIL_KEY = "gastos02_directus_service_email";
const DIRECTUS_SERVICE_PASSWORD_KEY = "gastos02_directus_service_password";

const cfg = {
  baseUrl: localStorage.getItem("gastos02_directus_url") || DEFAULT_BASE_URL,
  serviceEmail: window.__GASTOS02_DIRECTUS_SERVICE_EMAIL || localStorage.getItem(DIRECTUS_SERVICE_EMAIL_KEY) || "",
  servicePassword: window.__GASTOS02_DIRECTUS_SERVICE_PASSWORD || localStorage.getItem(DIRECTUS_SERVICE_PASSWORD_KEY) || "",
  accessToken: "",
  loginPromise: null
};

export function setDirectusConfig({ baseUrl, serviceEmail, servicePassword } = {}){
  if(typeof baseUrl === "string" && baseUrl.trim()){
    cfg.baseUrl = baseUrl.trim().replace(/\/$/, "");
    cfg.accessToken = "";
    localStorage.setItem("gastos02_directus_url", cfg.baseUrl);
  }
  if(typeof serviceEmail === "string"){
    cfg.serviceEmail = serviceEmail.trim();
    cfg.accessToken = "";
    localStorage.setItem(DIRECTUS_SERVICE_EMAIL_KEY, cfg.serviceEmail);
  }
  if(typeof servicePassword === "string"){
    cfg.servicePassword = servicePassword;
    cfg.accessToken = "";
    localStorage.setItem(DIRECTUS_SERVICE_PASSWORD_KEY, cfg.servicePassword);
  }
}

function buildHeaders(extra = {}){
  const headers = { "Content-Type": "application/json", ...extra };
  if(cfg.accessToken) headers.Authorization = `Bearer ${cfg.accessToken}`;
  return headers;
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
  await ensureAuth();

  const url = normalizeUrlForDirectus(`${cfg.baseUrl}${path}`);
  let lastErr;
  let didRelogin = false;

  for(let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++){
    try{
      const res = await fetch(url, {
        ...options,
        headers: buildHeaders(options.headers)
      });
      if(res.status === 401 && !didRelogin){
        didRelogin = true;
        await login(cfg.serviceEmail, cfg.servicePassword, { force: true });
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        const msg = data?.errors?.[0]?.message || `${res.status} ${res.statusText}`;
        throw new Error(`Directus error en ${path}: ${msg}`);
      }
      return data;
    }catch(err){
      lastErr = err;
      const networkError = err instanceof TypeError;
      if(!networkError || attempt >= RETRY_DELAYS.length) break;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  throw new Error(`No se pudo conectar a Directus (${path}). ${lastErr?.message || "Error desconocido"}`);
}

async function ensureAuth(){
  if(cfg.accessToken) return;
  await login(cfg.serviceEmail, cfg.servicePassword);
}

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
      if(!token) throw new Error("Directus no devolvió access_token.");
      cfg.accessToken = token;
      cfg.serviceEmail = safeEmail;
      cfg.servicePassword = safePassword;
      return token;
    })
    .finally(()=>{ cfg.loginPromise = null; });

  return cfg.loginPromise;
}

function toQuery(params = {}){
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{
    if(v == null) return;
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
  setDirectusConfig,
  ping,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  findOneByFilter,
  upsertByUnique
};

if(typeof window !== "undefined"){
  window.directusClient = directusClient;
}

export default directusClient;
