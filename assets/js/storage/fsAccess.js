import { decryptPayload, encryptPayload } from "./jsonCrypto.js";

const DB_NAME = "gastos02_fs";
const STORE = "handles";
const KEY = "dataDir";

function openDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = ()=> req.result.createObjectStore(STORE);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function idbGet(key){
  const db = await openDb();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await openDb();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

export function isFsAccessSupported(){
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function hasPermission(handle, write = true){
  const opts = { mode: write ? "readwrite" : "read" };
  if((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export async function chooseDataDirectory(){
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(KEY, handle);
  return handle;
}

export async function getSavedDirectory(){
  const handle = await idbGet(KEY);
  if(!handle) return null;
  if(!(await hasPermission(handle, true))) return null;
  return handle;
}

export async function readJsonFile(handle, filename){
  try{
    const f = await handle.getFileHandle(filename);
    const file = await f.getFile();
    const parsed = JSON.parse(await file.text());
    return await decryptPayload(parsed);
  }catch(err){
    if(err?.name === "NotFoundError") return null;
    throw err;
  }
}

export async function writeJsonFile(handle, filename, payload){
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  const encrypted = await encryptPayload(payload);
  await writable.write(JSON.stringify(encrypted, null, 2));
  await writable.close();
}

export async function listMonthKeys(handle){
  const out = [];
  for await (const [name, entry] of handle.entries()){
    if(entry.kind !== "file") continue;
    const m = String(name).match(/^(\d{4}-\d{2})\.json$/);
    if(m) out.push(m[1]);
  }
  return out.sort();
}
