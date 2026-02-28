import { downloadBlob } from "../utils.js";
import { decryptPayload, encryptPayload } from "./jsonCrypto.js";

export async function importJsonFromFile(file){
  const text = await file.text();
  const parsed = JSON.parse(text);
  return decryptPayload(parsed);
}

export async function exportJsonToDownload(filename, payload){
  const isJson = String(filename || "").toLowerCase().endsWith(".json");
  const content = isJson && typeof payload === "object"
    ? JSON.stringify(await encryptPayload(payload), null, 2)
    : String(payload ?? "");
  const pickerTypes = isJson
    ? [{ description: "JSON", accept: { "application/json": [".json"] } }]
    : [{ description: "CSV", accept: { "text/csv": [".csv"] } }];

  return downloadBlob(content, filename, isJson ? "application/json" : "text/csv", { pickerTypes });
}
