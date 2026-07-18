// Learning-log client helpers.
// 저장 기능은 OCR/번역 흐름과 분리. 단축어 WebView 문제를 피하기 위해 log_token을 우선 사용한다.

const DEFAULT_LOG_WORKER_BASE = "https://jp-translator-api.rlaalsrbr.workers.dev";
const LS_BASE  = "jpTranslatorApiBase";
const LS_APP_TOKEN = "jpTranslatorAppToken";       // 관리 페이지/수동용 fallback
const LS_LOG_TOKEN = "jpTranslatorLogToken";       // 단축어가 발급받아 URL hash로 넘기는 짧은 토큰
const LS_LAST_SESSION = "jpTranslatorLastSession";

export function getLogWorkerBase(){
  return (localStorage.getItem(LS_BASE) || DEFAULT_LOG_WORKER_BASE).replace(/\/$/, "");
}

export function setLogWorkerBase(base){
  if(base) localStorage.setItem(LS_BASE, String(base).replace(/\/$/, ""));
}

export function importLogTokenFromLocation(){
  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const token = hash.get("log_token") || hash.get("token") || "";
  if(token){
    localStorage.setItem(LS_LOG_TOKEN, token);
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function getLogToken(){
  importLogTokenFromLocation();
  return localStorage.getItem(LS_LOG_TOKEN) || "";
}

export function setLogToken(token){
  if(token) localStorage.setItem(LS_LOG_TOKEN, String(token));
}

export function clearLogToken(){
  localStorage.removeItem(LS_LOG_TOKEN);
}

export function getAppToken(){
  return localStorage.getItem(LS_APP_TOKEN) || "";
}

export function setAppToken(token){
  if(token) localStorage.setItem(LS_APP_TOKEN, String(token));
}

export function getLastSession(){
  try{ return JSON.parse(localStorage.getItem(LS_LAST_SESSION) || "null"); }
  catch{ return null; }
}

export function setLastSession(session){
  if(session?.id) localStorage.setItem(LS_LAST_SESSION, JSON.stringify({
    id: session.id,
    title: session.title || session.session_key || session.raw_url || session.id,
    raw_url: session.raw_url || "",
    canonical_url: session.canonical_url || "",
    session_key: session.session_key || ""
  }));
}

export async function ensureLogConfig(){
  importLogTokenFromLocation();
  const logToken = getLogToken();
  const appToken = getAppToken();
  if(!logToken && !appToken){
    const token = prompt("학습로그 토큰이 없습니다. 단축어를 새 버전으로 수정하거나, 관리용 APP_TOKEN을 입력하세요.");
    if(!token) throw new Error("학습로그 인증 토큰이 필요합니다.");
    setAppToken(token.trim());
  }
  return { base:getLogWorkerBase(), logToken:getLogToken(), appToken:getAppToken() };
}

async function request(path, {method="GET", body=null, retryOnUnauthorized=true}={}){
  const {base, logToken, appToken} = await ensureLogConfig();
  const headers = {};
  if(logToken) headers["x-log-token"] = logToken;
  else if(appToken) headers["x-app-token"] = appToken;
  let payload = undefined;
  if(body != null){
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch{ /* ignore */ }
  if(!r.ok){
    const msg = json?.error || text || `HTTP ${r.status}`;
    if((r.status === 401 || /unauthorized/i.test(msg)) && retryOnUnauthorized){
      clearLogToken();
      const fresh = prompt("학습로그 인증이 만료/실패했습니다. APP_TOKEN을 다시 입력하세요.");
      if(fresh){ setAppToken(fresh.trim()); return request(path, {method, body, retryOnUnauthorized:false}); }
    }
    throw new Error(msg);
  }
  return json;
}

export function searchSessions(q){
  return request(`/api/sessions/search?q=${encodeURIComponent(q||"")}`);
}

export function recentSessions(){
  return request(`/api/sessions/recent`);
}

export function resolveSession(url){
  return request(`/api/sessions/resolve`, { method:"POST", body:{ url } });
}

export async function saveItem(payload){
  const out = await request(`/api/save`, { method:"POST", body:payload });
  if(out?.session) setLastSession(out.session);
  return out;
}

function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.includes(",") ? s.split(",",2)[1] : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function blobImageSource(blob){
  if("createImageBitmap" in globalThis){
    try{
      const bitmap = await createImageBitmap(blob);
      return { source:bitmap, width:bitmap.width, height:bitmap.height, cleanup:()=>bitmap.close?.() };
    }catch{ /* Safari fallback below */ }
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise((resolve,reject)=>{
    image.onload=resolve;
    image.onerror=()=>reject(new Error("이미지 디코딩 실패"));
    image.src=objectUrl;
  });
  return {
    source:image,
    width:image.naturalWidth,
    height:image.naturalHeight,
    cleanup:()=>URL.revokeObjectURL(objectUrl)
  };
}

async function canvasToWebp(source, width, height, quality){
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha:false });
  if(!ctx) throw new Error("canvas context 생성 실패");
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
  if(!blob) throw new Error("WebP 변환 실패");
  return blob;
}

export async function downscaleImageElement(imgEl, {longEdge=1600, quality=0.78}={}){
  if(!imgEl) return null;
  const makeResult = async (source, nw, nh) => {
    if(!nw || !nh) throw new Error("이미지 크기를 읽지 못했습니다.");
    const scale = Math.min(1, longEdge / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const blob = await canvasToWebp(source, w, h, quality);
    return {
      base64:await blobToBase64(blob),
      mime:"image/webp",
      width:w,
      height:h,
      size_bytes:blob.size,
      downscaled:true
    };
  };

  try{
    return await makeResult(imgEl, imgEl.naturalWidth, imgEl.naturalHeight);
  }catch(firstError){
    try{
      const src = imgEl.currentSrc || imgEl.src || "";
      if(!src) throw firstError;
      const response = await fetch(src, { mode:"cors", cache:"no-store" });
      if(!response.ok) throw new Error(`이미지 재요청 실패: HTTP ${response.status}`);
      const decoded = await blobImageSource(await response.blob());
      try{ return await makeResult(decoded.source, decoded.width, decoded.height); }
      finally{ decoded.cleanup(); }
    }catch(secondError){
      console.warn("downscale failed; fallback to server image copy", firstError, secondError);
      return null;
    }
  }
}

