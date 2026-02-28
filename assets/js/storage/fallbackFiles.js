import { downloadBlob } from "../utils.js";

export async function importJsonFromFile(file){
  const text = await file.text();
  return JSON.parse(text);
}

export async function exportJsonToDownload(filename, payload){
  return downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json", {
    pickerTypes: [{ description: "JSON", accept: { "application/json": [".json"] } }]
  });
}
