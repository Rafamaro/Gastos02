const ENC_MARKER = "gastos02:enc-key";
const ENC_VERSION = 1;

function ensureCrypto(){
  if(typeof crypto === "undefined" || !crypto.subtle) throw new Error("El navegador no soporta cifrado WebCrypto.");
}

function toBase64(bytes){
  let out = "";
  const chunk = 0x8000;
  for(let i=0; i<bytes.length; i += chunk){
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function fromBase64(b64){
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getOrCreateSecret(){
  const existing = localStorage.getItem(ENC_MARKER);
  if(existing) return existing;
  ensureCrypto();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const b64 = toBase64(key);
  localStorage.setItem(ENC_MARKER, b64);
  return b64;
}

async function deriveAesKey(salt){
  ensureCrypto();
  const secretBytes = fromBase64(getOrCreateSecret());
  const baseKey = await crypto.subtle.importKey("raw", secretBytes, { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedEnvelope(payload){
  return Boolean(payload && payload.__enc === true && payload.version === ENC_VERSION && payload.data && payload.iv && payload.salt);
}

export async function encryptPayload(payload){
  ensureCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(salt);
  const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  return {
    __enc: true,
    version: ENC_VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher))
  };
}

export async function decryptPayload(envelope){
  if(!isEncryptedEnvelope(envelope)) return envelope;
  ensureCrypto();
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const data = fromBase64(envelope.data);
  const key = await deriveAesKey(salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  const text = new TextDecoder().decode(plainBuffer);
  return JSON.parse(text);
}
