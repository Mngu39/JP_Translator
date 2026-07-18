export const WORKER_BASE = "https://jp-translator-api.rlaalsrbr.workers.dev";

const LS_LOG_TOKEN = "jpTranslatorLogToken";
const LS_WORKER_BASE = "jpTranslatorApiBase";

export function getWorkerBase(){
  return (localStorage.getItem(LS_WORKER_BASE) || WORKER_BASE).replace(/\/$/, "");
}

export function setWorkerBase(base){
  if(base) localStorage.setItem(LS_WORKER_BASE, String(base).replace(/\/$/, ""));
}

export function importLogTokenFromLocation(){
  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const token = hash.get("log_token") || hash.get("token") || "";
  if(token){
    localStorage.setItem(LS_LOG_TOKEN, token);
    // URL에 토큰이 계속 보이지 않도록 제거. id query는 유지.
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function getLogToken(){
  importLogTokenFromLocation();
  return localStorage.getItem(LS_LOG_TOKEN) || "";
}

function authHeaders(extra={}){
  const token = getLogToken();
  return token ? { ...extra, "x-log-token": token } : extra;
}

// 이미지 URL: <img> 태그는 header를 붙일 수 없으므로 id의 난수성으로 보호한다.
export async function getImageById(id){
  return `${getWorkerBase()}/image?id=${encodeURIComponent(id)}`;
}

// Google OCR
export async function gcvOCR(id){
  const r = await fetch(`${getWorkerBase()}/gcv/ocr`, {
    method:"POST",
    headers: authHeaders({ "content-type":"application/json" }),
    body: JSON.stringify({ id })
  });
  if(!r.ok) throw new Error(`GCV ${r.status}: ${await r.text().catch(()=>"")}`);
  const j = await r.json(); return j.annos || [];
}

// 후리가나 → 통합 Worker 프록시
export async function getFurigana(text){
  const r = await fetch(`${getWorkerBase()}/run/furigana`, {
    method:"POST",
    headers: authHeaders({ "content-type":"application/json" }),
    body: JSON.stringify({ text })
  });
  if(!r.ok) throw new Error(`furigana failed ${r.status}`);
  return await r.json();
}

// DeepL 번역 → 통합 Worker
export async function translateJaKo(text){
  const r = await fetch(`${getWorkerBase()}/run/translate`, {
    method:"POST",
    headers: authHeaders({ "content-type":"application/json" }),
    body: JSON.stringify({ text, src:"JA", tgt:"KO", target:"KO" })
  });
  if(!r.ok) throw new Error(`translate failed ${r.status}`);
  const j = await r.json();
  const out = (j && (j.translation || j.text || j.result)) || "";
  return { text: out, result: out };
}

export function openNaverJaLemma(term){
  window.open(`https://ja.dict.naver.com/#/search?range=all&query=${encodeURIComponent(term)}`,"_blank");
}
export function openNaverHanja(ch){
  window.open(`https://hanja.dict.naver.com/hanja?q=${encodeURIComponent(ch)}`,"_blank");
}
