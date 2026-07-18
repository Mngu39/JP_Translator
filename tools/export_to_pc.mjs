// PC permanent export helper.
// Usage:
//   node tools/export_to_pc.mjs https://jp-learning-log.rlaalsrbr.workers.dev YOUR_APP_TOKEN ./jp-log-export
//
// Output:
//   jp-log-export/
//     manifest.json
//     anki.tsv
//     <media_id>.webp / .png / .jpg ...

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [,, baseArg, tokenArg, outArg] = process.argv;
if(!baseArg || !tokenArg){
  console.error("Usage: node tools/export_to_pc.mjs <WORKER_BASE> <APP_TOKEN> [OUT_DIR]");
  process.exit(1);
}
const base = baseArg.replace(/\/$/, "");
const token = tokenArg;
const outDir = outArg || `jp-log-export-${new Date().toISOString().slice(0,10)}`;

async function fetchOk(url, opts={}){
  const r = await fetch(url, { ...opts, headers:{"x-app-token":token, ...(opts.headers||{})} });
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return r;
}

function extFromMime(mime){
  mime = String(mime||"");
  if(mime.includes("webp")) return "webp";
  if(mime.includes("png")) return "png";
  if(mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "bin";
}

await mkdir(outDir, {recursive:true});

console.log("Downloading manifest...");
const manifest = await (await fetchOk(`${base}/api/export/json`)).json();
await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

const mediaName = new Map();
for(const item of manifest.items || []){
  if(!item.media_id) continue;
  const ext = extFromMime(item.mime_type);
  const filename = `${item.media_id}.${ext}`;
  mediaName.set(item.media_id, filename);
  console.log("Downloading media", filename);
  const r = await fetchOk(`${base}/api/media/${encodeURIComponent(item.media_id)}`);
  const ab = await r.arrayBuffer();
  await writeFile(path.join(outDir, filename), Buffer.from(ab));
}

console.log("Generating Anki TSV with AI cache/generation...");
let tsv = await (await fetchOk(`${base}/api/export/anki.tsv?ai=1`)).text();
for(const [mediaId, filename] of mediaName.entries()){
  tsv = tsv.replaceAll(`/api/media/${mediaId}`, filename);
}
await writeFile(path.join(outDir, "anki.tsv"), tsv, "utf8");

console.log("Done:", path.resolve(outDir));
console.log("Import anki.tsv into Anki. Keep the image files in the same folder during import.");
