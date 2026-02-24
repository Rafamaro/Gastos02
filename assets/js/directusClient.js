const DEFAULT_BASE_URL = "https://directus.drperez86.com";
const RETRY_DELAYS = [300, 900];

const cfg = {
  baseUrl: localStorage.getItem("gastos02_directus_url") || DEFAULT_BASE_URL,
  token: localStorage.getItem("gastos02_directus_token") || ""
};

export function setDirectusConfig({ baseUrl, token } = {}){
  if(typeof baseUrl === "string" && baseUrl.trim()){
    cfg.baseUrl = baseUrl.trim().replace(/\/$/, "");
    localStorage.setItem("gastos02_directus_url", cfg.baseUrl);
  }
  if(typeof token === "string"){
    cfg.token = token.trim();
    localStorage.setItem("gastos02_directus_token", cfg.token);
  }
}

function buildHeaders(extra = {}){
  const headers = { "Content-Type": "application/json", ...extra };
  if(cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  return headers;
}

async function sleep(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, options = {}){
  const url = `${cfg.baseUrl}${path}`;
  let lastErr;

  for(let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++){
    try{
      const res = await fetch(url, {
        ...options,
        headers: buildHeaders(options.headers)
      });
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

function toQuery(params = {}){
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{
    if(v == null) return;
    if(typeof v === "object") qs.set(k, JSON.stringify(v));
    else qs.set(k, String(v));
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
