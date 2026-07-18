const ALLOW_ORIGIN = "https://mngu39.github.io";
const RUN_BASE = "https://furigana-api-345684237835.asia-northeast1.run.app";

function corsHeaders(req){
  const origin = req.headers.get("origin") || ALLOW_ORIGIN;
  const allow = origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-app-token,x-log-token,authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(req, data, status=200){
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:{...corsHeaders(req), "content-type":"application/json; charset=utf-8", "cache-control":"no-store"}
  });
}

function text(req, data, status=200, type="text/plain; charset=utf-8"){
  return new Response(data, {status, headers:{...corsHeaders(req), "content-type":type, "cache-control":"no-store"}});
}

function nowIso(){ return new Date().toISOString(); }
function uuid(){ return crypto.randomUUID(); }
function newId(){ const a=new Uint8Array(8); crypto.getRandomValues(a); return Date.now().toString(36)+"-"+Array.from(a,x=>x.toString(16).padStart(2,"0")).join(""); }
function toBase64(ab){ let s=""; const a=new Uint8Array(ab); for(let i=0;i<a.length;i++) s+=String.fromCharCode(a[i]); return btoa(s); }
function b64urlEncodeString(s){ return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function b64urlEncodeBytes(buf){ let s=""; const a=new Uint8Array(buf); for(let i=0;i<a.length;i++) s+=String.fromCharCode(a[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function b64urlDecodeString(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; return atob(s); }

async function hmacSign(secret, data){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncodeBytes(sig);
}

async function createLogToken(env, payload={}){
  const secret = env.LOG_TOKEN_SECRET || env.APP_TOKEN;
  if(!secret) throw new Error("missing LOG_TOKEN_SECRET");
  const now = Math.floor(Date.now()/1000);
  const full = { typ:"jp-log", iat:now, exp:now + 24*3600, ...payload };
  const body = b64urlEncodeString(JSON.stringify(full));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function verifyLogToken(env, token){
  if(!token) return null;
  const secret = env.LOG_TOKEN_SECRET || env.APP_TOKEN;
  if(!secret) return null;
  const [body, sig] = String(token).split(".");
  if(!body || !sig) return null;
  const expected = await hmacSign(secret, body);
  if(expected !== sig) return null;
  let payload = null;
  try{ payload = JSON.parse(b64urlDecodeString(body)); }catch{ return null; }
  if(payload.exp && Math.floor(Date.now()/1000) > Number(payload.exp)) return null;
  return payload;
}

function getMasterToken(req){
  const url = new URL(req.url);
  return req.headers.get("x-app-token") || (req.headers.get("authorization")||"").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
}

function isMasterAuth(req, env){
  const expected = env.APP_TOKEN || "";
  if(!expected) return false;
  return getMasterToken(req) === expected;
}

async function requireMaster(req, env){
  if(!isMasterAuth(req, env)) throw Object.assign(new Error("unauthorized"), {status:401});
  return {kind:"master"};
}

async function requireAnyAuth(req, env){
  if(isMasterAuth(req, env)) return {kind:"master"};
  const url = new URL(req.url);
  const token = req.headers.get("x-log-token") || url.searchParams.get("log_token") || "";
  const payload = await verifyLogToken(env, token);
  if(payload) return {kind:"log", payload};
  throw Object.assign(new Error("unauthorized"), {status:401});
}

async function handleOpenToken(req, env){
  await requireMaster(req, env);
  const body = req.method === "POST" ? await req.json().catch(()=>({})) : {};
  const log_token = await createLogToken(env, { scope: body.scope || "open" });
  return json(req, { ok:true, log_token, expires_in:24*3600 });
}

// -------------------- OCR upload/image/GCV --------------------
async function handleUpload(req, env){
  await requireMaster(req, env);
  const buf = await req.arrayBuffer();
  if(!buf || buf.byteLength === 0) return json(req, { error:"empty body" },400);
  if(buf.byteLength > 10*1024*1024) return json(req, { error:"too large" },413);
  const ct = req.headers.get("content-type") || "application/octet-stream";
  const id = newId();
  const key = `tmp-ocr/${id}`;
  await env.MEDIA.put(key, buf, {
    httpMetadata:{ contentType:ct },
    customMetadata:{ kind:"ocr-temp", created_at:nowIso() }
  });
  const log_token = await createLogToken(env, { scope:"image", image_id:id });
  return json(req, { id, log_token, image_url:`/image?id=${encodeURIComponent(id)}` });
}

async function getTempImage(env, id){
  if(!id) return null;
  const obj = await env.MEDIA.get(`tmp-ocr/${id}`);
  if(!obj) return null;
  return obj;
}

async function handleImage(req, url, env){
  const id = url.searchParams.get("id");
  if(!id) return json(req, { error:"missing id" },400);
  const obj = await getTempImage(env, id);
  if(!obj) return json(req, { error:"not found" },404);
  const ct = obj.httpMetadata?.contentType || "image/png";
  return new Response(obj.body, { headers:{ ...corsHeaders(req), "content-type":ct, "cache-control":"no-store" } });
}

async function handleGcvOCR(req, env){
  await requireAnyAuth(req, env);
  let body={}; try{ body=await req.json(); }catch{ return json(req, { error:"bad json" },400); }
  const id=body.id; if(!id) return json(req, { error:"missing id" },400);
  const obj = await getTempImage(env, id);
  if(!obj) return json(req, { error:"not found" },404);
  const ab = await obj.arrayBuffer();
  const value = toBase64(ab);

  const payload={ requests:[{ image:{ content:value }, features:[{ type:"TEXT_DETECTION" }], imageContext:{ languageHints:["ja"] } }] };
  const r=await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${env.GCV_API_KEY}`,{
    method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(payload)
  });
  if(!r.ok) return json(req, { error:"gcv_error", status:r.status, detail:(await r.text()).slice(0,200) },502);
  const j=await r.json();

  const pages=j.responses?.[0]?.fullTextAnnotation?.pages||[]; const annos=[];
  for (const p of pages) for (const b of p.blocks||[]) for (const para of b.paragraphs||[]){
    let text=""; for(const w of para.words||[]) for(const s of w.symbols||[]) text += s.text||"";
    text=text.replace(/\s+/g,"").trim(); if(!text) continue;
    const v=para.boundingBox?.vertices||[];
    annos.push({ text, polygon:[[v[0]?.x||0,v[0]?.y||0],[v[1]?.x||0,v[1]?.y||0],[v[2]?.x||0,v[2]?.y||0],[v[3]?.x||0,v[3]?.y||0]] });
  }
  if(!annos.length){
    const ta=j.responses?.[0]?.textAnnotations||[];
    for(const a of ta.slice(1)){
      const v=a.boundingPoly?.vertices||[];
      const t=(a.description||"").replace(/\s+/g,"").trim();
      if(t) annos.push({ text:t, polygon:[[v[0]?.x||0,v[0]?.y||0],[v[1]?.x||0,v[1]?.y||0],[v[2]?.x||0,v[2]?.y||0],[v[3]?.x||0,v[3]?.y||0]] });
    }
  }
  return json(req, { annos });
}

// -------------------- Furigana / DeepL --------------------
async function handleFurigana(req, env){
  await requireAnyAuth(req, env);
  const body = await req.text();
  const paths = ["/furigana","/api/furigana","/v1/furigana"];
  let last=null, lastText="", lastCT="";
  for(const p of paths){
    const r=await fetch(`${RUN_BASE}${p}`,{ method:"POST", headers:{ "content-type":"application/json" }, body });
    last=r; lastText=await r.text().catch(()=> ""); lastCT=r.headers.get("content-type")||"";
    if (r.ok) {
      return new Response(lastText, { status:200, headers:{ ...corsHeaders(req), "content-type":/\bjson\b/i.test(lastCT)?"application/json":"application/json" } });
    }
  }
  return json(req, { error:"furigana_failed", status:last?.status||0, detail:lastText.slice(0,200) }, 502);
}

async function handleTranslate(req, env){
  await requireAnyAuth(req, env);
  let body={}; try{ body=await req.json(); }catch{ return json(req, { error:"bad json" },400); }
  const textIn=(body.text||"").toString();
  const text = textIn.trim();
  const src=((body.src || body.sourceLang || "JA")+"").toUpperCase();
  const tgt=((body.tgt || body.target || body.targetLang || "KO")+"").toUpperCase();
  const KEY = env.DEEPL_API_KEY || "";
  if(!text) return json(req, { error:"empty text" },400);
  if(!KEY) return json(req, { error:"no_deepl_key" },500);
  const isFree = String(KEY).includes(":fx");
  const endpoint = isFree ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
  const params = new URLSearchParams();
  params.append("text", textIn); // 줄바꿈/공백 최대한 유지
  if(src) params.append("source_lang", src === "JA" ? "JA" : src);
  params.append("target_lang", tgt === "KO" ? "KO" : tgt);
  params.append("preserve_formatting", "1");
  params.append("split_sentences", "nonewlines");

  const r = await fetch(endpoint, {
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded", "Authorization":`DeepL-Auth-Key ${KEY}`},
    body:params
  });
  const raw = await r.text().catch(()=>"");
  if(!r.ok) return json(req, { error:"deepl_error", status:r.status, detail:raw.slice(0,300) }, 502);
  let j={}; try{ j=JSON.parse(raw); }catch{ return json(req, { error:"deepl_parse", raw:raw.slice(0,200) }, 502); }
  const out = j?.translations?.[0]?.text || "";
  return json(req, { translation:out, text:out, result:out });
}

// -------------------- Learning log helpers --------------------
function parseUrlMaybe(raw){ try{ return new URL(raw); }catch{ return null; } }
function normalizeYoutubeUrl(raw){
  raw = String(raw||"").trim();
  const u = parseUrlMaybe(raw);
  if(!u) return { raw_url: raw, canonical_url: raw, session_key: `manual:${raw}`, source_type:"manual" };
  let videoId = "";
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if(host === "youtu.be") videoId = u.pathname.split("/").filter(Boolean)[0] || "";
  else if(host.endsWith("youtube.com")){
    if(u.pathname === "/watch") videoId = u.searchParams.get("v") || "";
    else if(u.pathname.startsWith("/shorts/")) videoId = u.pathname.split("/").filter(Boolean)[1] || "";
    else if(u.pathname.startsWith("/live/")) videoId = u.pathname.split("/").filter(Boolean)[1] || "";
  }
  if(videoId){
    const canonical = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    return { raw_url: raw, canonical_url: canonical, session_key:`youtube:${videoId}`, source_type:"youtube", video_id:videoId };
  }
  u.hash = "";
  return { raw_url: raw, canonical_url: u.toString(), session_key:`url:${u.toString()}`, source_type:host || "url" };
}

async function fetchTitle(meta){
  if(meta.source_type !== "youtube" || !meta.canonical_url) return { title: meta.canonical_url || meta.raw_url || "Manual Session", status:"skipped" };
  try{
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(meta.canonical_url)}`;
    const r = await fetch(endpoint, {cf:{cacheTtl:3600, cacheEverything:true}});
    if(!r.ok) throw new Error(`oEmbed ${r.status}`);
    const j = await r.json();
    return { title: j.title || meta.canonical_url, status:"ok" };
  }catch(e){
    return { title: `YouTube ${meta.video_id || "Session"}`, status:`failed:${String(e.message||e).slice(0,80)}` };
  }
}

async function resolveSession(env, rawUrl){
  const meta = normalizeYoutubeUrl(rawUrl);
  const existing = await env.DB.prepare("SELECT * FROM sessions WHERE session_key = ? AND deleted_at IS NULL LIMIT 1").bind(meta.session_key).first();
  const now = nowIso();
  if(existing){
    await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, existing.id).run();
    return {...existing, last_used_at: now};
  }
  const title = await fetchTitle(meta);
  const id = uuid();
  const expires = new Date(Date.now() + 90*24*3600*1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO sessions
    (id, source_type, raw_url, canonical_url, session_key, title, title_fetch_status, created_at, last_used_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, meta.source_type, meta.raw_url, meta.canonical_url, meta.session_key, title.title, title.status, now, now, expires).run();
  return await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
}

function base64ToBytes(b64){
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function storeMedia(env, itemId, body){
  const now = nowIso();
  const shot = body.screenshot;
  let bytes = null, mime = "image/webp", width = null, height = null, size = null, downscaled = 0;
  if(shot?.base64){
    bytes = base64ToBytes(shot.base64);
    mime = shot.mime || "image/webp";
    width = shot.width || null; height = shot.height || null;
    size = shot.size_bytes || bytes.byteLength; downscaled = shot.downscaled ? 1 : 0;
  }else if(body.source_image_id){
    const obj = await getTempImage(env, body.source_image_id);
    if(obj){
      const ab = await obj.arrayBuffer(); bytes = new Uint8Array(ab);
      mime = obj.httpMetadata?.contentType || "application/octet-stream";
      size = bytes.byteLength; downscaled = 0;
    }
  }else if(body.source_image_url){
    const r = await fetch(body.source_image_url);
    if(r.ok){ const ab = await r.arrayBuffer(); bytes = new Uint8Array(ab); mime = r.headers.get("content-type") || "application/octet-stream"; size = bytes.byteLength; downscaled = 0; }
  }
  if(!bytes) return null;
  const mediaId = uuid();
  const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "bin";
  const r2Key = `screenshots/${itemId}.${ext}`;
  await env.MEDIA.put(r2Key, bytes, { httpMetadata:{ contentType:mime } });
  await env.DB.prepare(`
    INSERT INTO media (id, saved_item_id, r2_key, mime_type, width, height, size_bytes, downscaled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(mediaId, itemId, r2Key, mime, width, height, size, downscaled, now).run();
  return { id:mediaId, r2_key:r2Key, mime_type:mime, width, height, size_bytes:size, downscaled };
}

async function handleSave(req, env){
  await requireAnyAuth(req, env);
  const body = await req.json();
  if(!body.session_id) throw Object.assign(new Error("session_id required"), {status:400});
  if(!body.source_text) throw Object.assign(new Error("source_text required"), {status:400});
  const itemType = body.item_type === "kanji_box" ? "kanji_box" : "sentence_box";
  if(itemType === "kanji_box" && !body.target_word) throw Object.assign(new Error("target_word required"), {status:400});
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").bind(body.session_id).first();
  if(!session) throw Object.assign(new Error("session not found"), {status:404});

  const id = uuid(); const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO saved_items
    (id, session_id, item_type, source_text, ui_translation, target_word, target_surface, target_word_lemma,
     target_word_reading, target_start_index, target_end_index, source_image_id, source_image_url, page_url,
     created_at, created_tz_offset_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.session_id, itemType, body.source_text, body.ui_translation || null,
    body.target_word || null, body.target_surface || null, body.target_word_lemma || null,
    body.target_word_reading || null,
    Number.isFinite(body.target_start_index) ? body.target_start_index : null,
    Number.isFinite(body.target_end_index) ? body.target_end_index : null,
    body.source_image_id || null, body.source_image_url || null, body.page_url || null,
    now, Number.isFinite(body.created_tz_offset_min) ? body.created_tz_offset_min : null
  ).run();
  const media = await storeMedia(env, id, body).catch(e=>({error:String(e.message||e)}));
  if(media?.id) await env.DB.prepare("UPDATE saved_items SET screenshot_media_id = ? WHERE id = ?").bind(media.id, id).run();
  await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, body.session_id).run();
  const updatedSession = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(body.session_id).first();
  return json(req, { ok:true, id, session:updatedSession, media });
}

async function listRecent(req, env){
  await requireAnyAuth(req, env);
  const {results} = await env.DB.prepare(`SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY last_used_at DESC LIMIT 20`).all();
  return json(req, { sessions: results || [] });
}

async function searchSessions(req, env){
  await requireAnyAuth(req, env);
  const q = new URL(req.url).searchParams.get("q") || "";
  const like = `%${q}%`;
  const {results} = await env.DB.prepare(`
    SELECT * FROM sessions
    WHERE deleted_at IS NULL
      AND (? = '' OR raw_url LIKE ? OR canonical_url LIKE ? OR title LIKE ? OR session_key LIKE ?)
    ORDER BY last_used_at DESC LIMIT 20
  `).bind(q, like, like, like, like).all();
  return json(req, { sessions: results || [] });
}

async function handleResolveSession(req, env){
  await requireAnyAuth(req, env);
  const body = await req.json();
  const session = await resolveSession(env, body.url || "");
  return json(req, {session});
}

async function mediaResponse(req, env, id){
  await requireAnyAuth(req, env);
  const m = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first();
  if(!m) return json(req, {error:"media not found"}, 404);
  const obj = await env.MEDIA.get(m.r2_key);
  if(!obj) return json(req, {error:"object not found"}, 404);
  return new Response(obj.body, { headers:{...corsHeaders(req), "content-type":m.mime_type || "application/octet-stream", "cache-control":"private, max-age=3600"} });
}

function htmlEscape(s){ return String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function highlightTarget(source, start, end, target){
  source = String(source||"");
  if(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= source.length){
    return htmlEscape(source.slice(0,start)) + `<span style="color:#d11;font-weight:700;">${htmlEscape(source.slice(start,end))}</span>` + htmlEscape(source.slice(end));
  }
  if(target && source.includes(target)) return htmlEscape(source).replace(htmlEscape(target), `<span style="color:#d11;font-weight:700;">${htmlEscape(target)}</span>`);
  return htmlEscape(source);
}

async function getTranslationCache(env, savedItemId){ return await env.DB.prepare("SELECT * FROM translation_cache WHERE saved_item_id = ? ORDER BY created_at DESC LIMIT 1").bind(savedItemId).first(); }
function stripJsonFence(s){ return String(s||"").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); }

async function generateAiCache(env, item){
  const cached = await getTranslationCache(env, item.id); if(cached) return cached;
  if(!env.GEMINI_API_KEY){ return { source_translation:item.ui_translation||"", word_translation:"", word_explanation:"", kanji_json:"[]", raw_json:"{}" }; }
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = item.item_type === "kanji_box" ? `
너는 일본어 학습카드 생성기다. 한국어로 답한다. 아래 JSON 스키마만 출력한다. 마크다운 금지.
입력:
- 카드 유형: 단어/한자박스
- 표제어: ${item.target_word || item.target_surface || ""}
- 화면에 나온 형태: ${item.target_surface || ""}
- 읽기: ${item.target_word_reading || ""}
- 원문: ${item.source_text || ""}
출력 JSON:
{"source_translation":"원문 전체의 자연스러운 한국어 번역","word_translation":"표제어의 문맥상 한국어 뜻","word_explanation":"짧은 문맥 설명. 신조어/은유/말투가 있으면 설명","kanji":[{"char":"한자 1글자","onyomi":"음독","kunyomi":"훈독","meaning_ko":"한국어 뜻"}]}
` : `
너는 일본어 학습카드 생성기다. 한국어로 답한다. 아래 JSON 스키마만 출력한다. 마크다운 금지.
입력:
- 카드 유형: 문장박스
- 원문: ${item.source_text || ""}
출력 JSON:
{"source_translation":"원문 전체의 자연스러운 한국어 번역","word_translation":"","word_explanation":"문장 속 핵심 표현/말투/은유가 있으면 짧게 설명","kanji":[]}
`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const r = await fetch(endpoint, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ contents:[{role:"user", parts:[{text:prompt}]}], generationConfig:{ temperature:0.2, responseMimeType:"application/json" } }) });
  if(!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const rawText = j?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n") || "{}";
  let parsed = {}; try{ parsed = JSON.parse(stripJsonFence(rawText)); }catch{ parsed = {source_translation:item.ui_translation||"", word_explanation:rawText}; }
  const id = uuid(); const kanjiJson = JSON.stringify(parsed.kanji || []); const rawJson = JSON.stringify(parsed);
  await env.DB.prepare(`
    INSERT INTO translation_cache
    (id, saved_item_id, ai_model, prompt_version, source_translation, word_translation, word_explanation, kanji_json, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, item.id, model, "jp-log-v2", parsed.source_translation || item.ui_translation || "", parsed.word_translation || "", parsed.word_explanation || "", kanjiJson, rawJson, nowIso()).run();
  return await getTranslationCache(env, item.id);
}

function formatKanjiJson(kanjiJson){
  let arr=[]; try{ arr=JSON.parse(kanjiJson||"[]"); }catch{}
  if(!Array.isArray(arr) || !arr.length) return "";
  return arr.map(k=>`${htmlEscape(k.char||"")} — 音: ${htmlEscape(k.onyomi||"")} / 訓: ${htmlEscape(k.kunyomi||"")} / 뜻: ${htmlEscape(k.meaning_ko||"")}`).join("<br>");
}

async function exportJson(req, env){
  await requireAnyAuth(req, env);
  const sessions = (await env.DB.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY last_used_at DESC").all()).results || [];
  const items = (await env.DB.prepare(`
    SELECT si.*, s.title AS session_title, s.raw_url AS session_link, s.canonical_url AS session_canonical_url,
           m.id AS media_id, m.r2_key, m.mime_type, m.width, m.height, m.size_bytes, m.downscaled
    FROM saved_items si JOIN sessions s ON s.id = si.session_id
    LEFT JOIN media m ON m.id = si.screenshot_media_id
    WHERE si.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY si.created_at ASC
  `).all()).results || [];
  return json(req, { exported_at:nowIso(), sessions, items });
}

async function exportAnkiTsv(req, env){
  await requireAnyAuth(req, env);
  const useAi = new URL(req.url).searchParams.get("ai") === "1";
  const {results} = await env.DB.prepare(`
    SELECT si.*, s.title AS session_title, s.raw_url AS session_link, s.canonical_url AS session_canonical_url,
           m.id AS media_id
    FROM saved_items si JOIN sessions s ON s.id = si.session_id
    LEFT JOIN media m ON m.id = si.screenshot_media_id
    WHERE si.deleted_at IS NULL AND s.deleted_at IS NULL AND si.anki_status != 'excluded'
    ORDER BY si.created_at ASC
  `).all();
  const publicBase = new URL(req.url).origin;
  const token = new URL(req.url).searchParams.get("token") || "";
  const rows = [["note_type","front","back","tags"]];
  for(const it of results || []){
    const imgUrl = it.media_id ? `${publicBase}/api/media/${encodeURIComponent(it.media_id)}${token?`?token=${encodeURIComponent(token)}`:""}` : "";
    const img = imgUrl ? `<br><img src="${htmlEscape(imgUrl)}">` : "";
    const meta = `<div style="font-size:12px;color:#777;">${htmlEscape(it.session_title||"")}<br>${htmlEscape(it.session_canonical_url||it.session_link||"")}</div>`;
    const cache = useAi ? await generateAiCache(env, it).catch(e=>({ source_translation:it.ui_translation||"", word_translation:"", word_explanation:`AI 생성 실패: ${String(e.message||e)}`, kanji_json:"[]" })) : await getTranslationCache(env, it.id) || {};
    if(it.item_type === "kanji_box"){
      const example = highlightTarget(it.source_text, it.target_start_index, it.target_end_index, it.target_surface || it.target_word);
      const front = `<div lang="ja" style="font-size:28px;">${htmlEscape(it.target_word||it.target_surface||"")}</div><hr><div lang="ja">${example}</div>${img}${meta}`;
      const back = `<div lang="ja" style="font-size:28px;">${htmlEscape(it.target_word||it.target_surface||"")}</div><div>${htmlEscape(cache.word_translation||"")}</div><div>${htmlEscape(cache.word_explanation||"")}</div><hr><div><b>원문 번역</b><br>${htmlEscape(cache.source_translation || it.ui_translation || "")}</div><hr><div lang="ja">${example}</div><hr><div>${formatKanjiJson(cache.kanji_json)}</div>${img}${meta}`;
      rows.push(["JPWordContext", front, back, "jp-log kanji-box"]);
    }else{
      const front = `<div lang="ja" style="font-size:22px;">${htmlEscape(it.source_text)}</div>${img}${meta}`;
      const back = `<div lang="ja" style="font-size:22px;">${htmlEscape(it.source_text)}</div><hr><div>${htmlEscape(cache.source_translation || it.ui_translation || "")}</div><div>${htmlEscape(cache.word_explanation||"")}</div>${img}${meta}`;
      rows.push(["JPSentenceContext", front, back, "jp-log sentence-box"]);
    }
  }
  const tsv = rows.map(r=>r.map(v=>String(v??"").replace(/\t/g," ").replace(/\r?\n/g,"<br>")).join("\t")).join("\n");
  return text(req, tsv, 200, "text/tab-separated-values; charset=utf-8");
}

async function deleteSession(req, env, id){
  await requireAnyAuth(req, env);
  const media = (await env.DB.prepare(`SELECT m.* FROM media m JOIN saved_items si ON si.screenshot_media_id = m.id WHERE si.session_id = ?`).bind(id).all()).results || [];
  for(const m of media) await env.MEDIA.delete(m.r2_key).catch(()=>{});
  await env.DB.prepare("UPDATE saved_items SET deleted_at = ? WHERE session_id = ?").bind(nowIso(), id).run();
  await env.DB.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").bind(nowIso(), id).run();
  return json(req, {ok:true, deleted_media:media.length});
}

export default {
  async fetch(req, env){
    if(req.method === "OPTIONS") return new Response(null, {headers:corsHeaders(req)});
    const url = new URL(req.url);
    try{
      if(url.pathname === "/" || url.pathname === "/health") return json(req, { ok:true, name:"JP_Translator_API", worker:"jp-translator-api" });

      // Auth
      if(url.pathname === "/auth/open-token" && (req.method === "POST" || req.method === "GET")) return handleOpenToken(req, env);

      // Image/OCR
      if(url.pathname === "/ocr/upload" && req.method === "POST") return handleUpload(req, env);
      if(url.pathname === "/image" && req.method === "GET") return handleImage(req, url, env);
      if(url.pathname === "/gcv/ocr" && req.method === "POST") return handleGcvOCR(req, env);

      // Furigana / DeepL. Keep old-compatible paths too.
      if(url.pathname === "/run/furigana" && req.method === "POST") return handleFurigana(req, env);
      if((url.pathname === "/run/translate" || url.pathname === "/text/translate" || url.pathname === "/translate") && req.method === "POST") return handleTranslate(req, env);

      // Learning log API
      if(req.method === "POST" && url.pathname === "/api/sessions/resolve") return handleResolveSession(req, env);
      if(req.method === "GET" && url.pathname === "/api/sessions/search") return searchSessions(req, env);
      if(req.method === "GET" && url.pathname === "/api/sessions/recent") return listRecent(req, env);
      if(req.method === "POST" && url.pathname === "/api/save") return handleSave(req, env);
      if(req.method === "GET" && url.pathname === "/api/export/json") return exportJson(req, env);
      if(req.method === "GET" && url.pathname === "/api/export/anki.tsv") return exportAnkiTsv(req, env);
      if(req.method === "GET" && url.pathname.startsWith("/api/media/")) return mediaResponse(req, env, url.pathname.split("/").pop());
      if(req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) return deleteSession(req, env, url.pathname.split("/").pop());

      return json(req, {error:"not found"}, 404);
    }catch(e){
      console.error(e);
      return json(req, {error:e.message || String(e)}, e.status || 500);
    }
  }
};
