import {
  getLogWorkerBase,
  setLogWorkerBase,
  getAppToken,
  setAppToken,
  ensureLogConfig
} from "./log.js";
import { createAnkiApkg } from "./apkg.js";

const workerBase=document.getElementById("workerBase");
const saveBase=document.getElementById("saveBase");
const setToken=document.getElementById("setToken");
const refresh=document.getElementById("refresh");
const mainView=document.getElementById("mainView");
const exportStatus=document.getElementById("exportStatus");
const exportAll=document.getElementById("exportAll");

const objectUrls=[];

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtDate(s){
  if(!s) return "";
  const d=new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
}

function timestampName(){
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeFilePart(s){
  return String(s||"JP_Translator").replace(/[\\/:*?"<>|]/g,"_").replace(/\s+/g," ").trim().slice(0,70) || "JP_Translator";
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

async function authFetch(path,opts={}){
  const {base,appToken,logToken}=await ensureLogConfig();
  const headers=appToken ? {"x-app-token":appToken} : {"x-log-token":logToken};
  const r=await fetch(`${base}${path}`,{...opts,headers:{...headers,...(opts.headers||{})}});
  if(!r.ok){
    const raw=await r.text().catch(()=>"");
    let message=raw;
    try{ message=JSON.parse(raw)?.error || raw; }catch{}
    throw new Error(message || `HTTP ${r.status}`);
  }
  return r;
}

async function api(path,opts={}){
  return (await authFetch(path,opts)).json();
}

async function fetchMedia(mediaId){
  return (await authFetch(`/api/media/${encodeURIComponent(mediaId)}`)).blob();
}

function clearObjectUrls(){
  while(objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
}

function sessionIdFromUrl(){
  return new URL(location.href).searchParams.get("session") || "";
}

function setStatus(message){
  exportStatus.textContent=message || "";
}

function setExportBusy(busy){
  for(const btn of document.querySelectorAll("[data-apkg],#exportAll")) btn.disabled=busy;
}

async function exportApkg(sessionId="",title=""){
  setExportBusy(true);
  setStatus("카드 설명과 APKG 데이터를 준비하는 중…");
  try{
    const q=new URLSearchParams({ai:"1"});
    if(sessionId) q.set("session_id",sessionId);
    const data=await api(`/api/export/apkg-data?${q}`);
    const out=await createAnkiApkg(data,{
      fetchMedia,
      onProgress:setStatus
    });
    const base=sessionId ? `JP_Translator_${safeFilePart(title)}` : "JP_Translator_All";
    downloadBlob(out.blob,`${base}_${timestampName()}.apkg`);
    setStatus(`완료: 카드 ${out.cardCount}개 · 이미지 ${out.mediaCount}개`);
  }catch(e){
    console.error(e);
    setStatus(`오류: ${e.message || e}`);
    alert(`APKG export 실패: ${e.message || e}`);
  }finally{
    setExportBusy(false);
  }
}

function highlight(item){
  const source=String(item.source_text||"");
  const start=Number(item.target_start_index);
  const end=Number(item.target_end_index);
  if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=source.length){
    return `${esc(source.slice(0,start))}<mark>${esc(source.slice(start,end))}</mark>${esc(source.slice(end))}`;
  }
  const target=String(item.target_surface||item.target_word||"");
  const idx=target ? source.indexOf(target) : -1;
  if(idx>=0) return `${esc(source.slice(0,idx))}<mark>${esc(target)}</mark>${esc(source.slice(idx+target.length))}`;
  return esc(source);
}

function kanjiLines(raw){
  let arr=[];
  try{ arr=JSON.parse(raw||"[]"); }catch{}
  if(!Array.isArray(arr)||!arr.length) return "";
  return `<div class="info-block"><div class="info-label">한자 정보</div>${arr.map(k=>`<div><strong>${esc(k.char||"")}</strong>　음독 ${esc(k.onyomi||"-")} · 훈독 ${esc(k.kunyomi||"-")} · ${esc(k.meaning_ko||"")}</div>`).join("")}</div>`;
}

function itemCard(item){
  const isWord=item.item_type==="kanji_box";
  const sourceTranslation=item.source_translation || item.ui_translation || "";
  const image=item.media_id ? `<div class="shot loading" data-media-id="${esc(item.media_id)}">이미지 불러오는 중…</div>` : "";
  if(isWord){
    return `<article class="item-card" data-kind="word">
      <div class="item-top"><span class="badge word">단어</span><time>${esc(fmtDate(item.created_at))}</time></div>
      ${image}
      <div class="word-title" lang="ja">${esc(item.target_word || item.target_surface || "")}</div>
      ${item.target_word_reading ? `<div class="reading" lang="ja">${esc(item.target_word_reading)}</div>` : ""}
      ${item.word_translation ? `<div class="translation">${esc(item.word_translation)}</div>` : ""}
      ${item.word_explanation ? `<div class="info-block"><div class="info-label">설명</div>${esc(item.word_explanation)}</div>` : ""}
      <div class="info-block"><div class="info-label">원문</div><div class="jp-source" lang="ja">${highlight(item)}</div><div class="ko-source">${esc(sourceTranslation)}</div></div>
      ${kanjiLines(item.kanji_json)}
    </article>`;
  }
  return `<article class="item-card" data-kind="sentence">
    <div class="item-top"><span class="badge sentence">문장</span><time>${esc(fmtDate(item.created_at))}</time></div>
    ${image}
    <div class="sentence-title" lang="ja">${esc(item.source_text||"")}</div>
    <div class="translation">${esc(sourceTranslation)}</div>
    ${item.word_explanation ? `<div class="info-block"><div class="info-label">표현 설명</div>${esc(item.word_explanation)}</div>` : ""}
  </article>`;
}

async function hydrateImages(){
  const nodes=[...document.querySelectorAll("[data-media-id]")];
  await Promise.all(nodes.map(async node=>{
    try{
      const blob=await fetchMedia(node.dataset.mediaId);
      const url=URL.createObjectURL(blob);
      objectUrls.push(url);
      node.classList.remove("loading");
      node.innerHTML=`<img src="${url}" alt="저장된 스크린샷">`;
    }catch(e){
      node.classList.remove("loading");
      node.textContent=`이미지 오류: ${e.message || e}`;
    }
  }));
}

async function loadOverview(){
  clearObjectUrls();
  mainView.innerHTML="<div class=loading-text>세션 목록을 불러오는 중…</div>";
  const out=await api("/api/sessions/recent");
  const sessions=out.sessions||[];
  if(!sessions.length){
    mainView.innerHTML="<div class=empty>저장된 세션이 없습니다.</div>";
    return;
  }
  mainView.innerHTML=`<div class="session-list">${sessions.map(s=>`
    <section class="session-card" data-id="${esc(s.id)}" data-title="${esc(s.title||"")}">
      <a class="session-title" href="?session=${encodeURIComponent(s.id)}">${esc(s.title || s.session_key || s.id)}</a>
      <a class="source-link" href="${esc(s.canonical_url || s.raw_url || "#")}" target="_blank" rel="noopener">${esc(s.canonical_url || s.raw_url || "")}</a>
      <div class="session-meta">
        <span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span>
      </div>
      <div class="actions">
        <button class="btn" data-act="export" data-apkg>이 세션 APKG</button>
        <button class="btn danger" data-act="delete">세션 삭제</button>
      </div>
    </section>`).join("")}</div>`;
}

async function loadDetail(sessionId){
  clearObjectUrls();
  mainView.innerHTML="<div class=loading-text>저장된 카드와 AI 설명을 불러오는 중…</div>";
  const out=await api(`/api/sessions/${encodeURIComponent(sessionId)}/detail?ai=1`);
  const s=out.session;
  const items=out.items||[];
  mainView.innerHTML=`
    <section class="detail-head">
      <a class="back-link" href="./logs.html">← 세션 목록</a>
      <h2>${esc(s.title || s.session_key || s.id)}</h2>
      <a class="source-link" href="${esc(s.canonical_url || s.raw_url || "#")}" target="_blank" rel="noopener">YouTube에서 열기</a>
      <div class="session-meta"><span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span></div>
      <div class="actions">
        <button class="btn" id="exportSession" data-apkg>이 세션 APKG 내보내기</button>
        <button class="btn danger" id="deleteSession">세션 삭제</button>
      </div>
    </section>
    <div class="filters" role="group" aria-label="카드 필터">
      <button class="filter active" data-filter="all">전체 ${items.length}</button>
      <button class="filter" data-filter="sentence">문장 ${Number(s.sentence_count||0)}</button>
      <button class="filter" data-filter="word">단어 ${Number(s.word_count||0)}</button>
    </div>
    <section id="itemList" class="item-list">${items.length ? items.map(itemCard).join("") : "<div class=empty>저장된 카드가 없습니다.</div>"}</section>`;

  document.getElementById("exportSession")?.addEventListener("click",()=>exportApkg(s.id,s.title||"Session"));
  document.getElementById("deleteSession")?.addEventListener("click",()=>removeSession(s.id,true));
  for(const btn of document.querySelectorAll(".filter")){
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b===btn));
      const f=btn.dataset.filter;
      document.querySelectorAll(".item-card").forEach(card=>card.hidden=f!=="all"&&card.dataset.kind!==f);
    });
  }
  await hydrateImages();
}

async function removeSession(id,fromDetail=false){
  if(!confirm("이 세션과 연결된 문장·단어·스크린샷을 서버에서 삭제할까요? 이 작업은 되돌리기 어렵습니다.")) return;
  await api(`/api/sessions/${encodeURIComponent(id)}`,{method:"DELETE"});
  if(fromDetail) location.href="./logs.html";
  else await loadCurrent();
}

async function loadCurrent(){
  workerBase.value=getLogWorkerBase();
  setStatus("");
  try{
    const id=sessionIdFromUrl();
    exportAll.hidden=Boolean(id);
    if(id) await loadDetail(id);
    else await loadOverview();
  }catch(e){
    console.error(e);
    mainView.innerHTML=`<div class="error">오류: ${esc(e.message || e)}</div>`;
  }
}

saveBase.addEventListener("click",()=>{setLogWorkerBase(workerBase.value.trim());loadCurrent();});
setToken.addEventListener("click",()=>{
  const token=prompt("APP_TOKEN 입력",getAppToken()||"");
  if(token) setAppToken(token.trim());
  loadCurrent();
});
refresh.addEventListener("click",loadCurrent);
exportAll.addEventListener("click",()=>exportApkg());

mainView.addEventListener("click",async ev=>{
  const btn=ev.target.closest("button[data-act]");
  if(!btn) return;
  const card=btn.closest(".session-card");
  const id=card?.dataset.id;
  if(!id) return;
  if(btn.dataset.act==="export") await exportApkg(id,card.dataset.title||"Session");
  if(btn.dataset.act==="delete") await removeSession(id,false);
});

window.addEventListener("beforeunload",clearObjectUrls);
loadCurrent();
