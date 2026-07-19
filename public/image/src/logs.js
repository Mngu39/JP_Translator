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
const deleteAll=document.getElementById("deleteAll");
const imageModal=document.getElementById("imageModal");
const imageModalBody=document.getElementById("imageModalBody");
const imageModalClose=document.getElementById("imageModalClose");
const moveDlg=document.getElementById("moveDlg");
const moveTarget=document.getElementById("moveTarget");
const moveCancel=document.getElementById("moveCancel");
const moveOk=document.getElementById("moveOk");

const mediaUrls=new Map();
let currentSession=null;
let currentItems=[];
let sessionsCache=[];
let movingItemId="";

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

async function getMediaUrl(mediaId){
  if(mediaUrls.has(mediaId)) return mediaUrls.get(mediaId);
  const blob=await fetchMedia(mediaId);
  const url=URL.createObjectURL(blob);
  mediaUrls.set(mediaId,url);
  return url;
}

function clearMediaUrls(){
  for(const url of mediaUrls.values()) URL.revokeObjectURL(url);
  mediaUrls.clear();
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
    const out=await createAnkiApkg(data,{fetchMedia,onProgress:setStatus});
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

function parseJson(raw,fallback=null){
  try{return JSON.parse(raw);}catch{return fallback;}
}

function hasKanji(s){ return /[\u3400-\u9fff]/.test(String(s||"")); }

function rubySource(text,raw){
  const tokens=parseJson(raw,[]);
  if(!Array.isArray(tokens)||!tokens.length) return esc(text||"");
  return tokens.map(t=>{
    const surface=String(t?.surface||"");
    const reading=String(t?.reading||"");
    return hasKanji(surface)&&reading
      ? `<ruby lang="ja">${esc(surface)}<rt>${esc(reading)}</rt></ruby>`
      : esc(surface);
  }).join("");
}

function rubyWord(word,reading){
  const w=String(word||"");
  const r=String(reading||"");
  return w&&r ? `<ruby lang="ja">${esc(w)}<rt>${esc(r)}</rt></ruby>` : esc(w);
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
  const arr=parseJson(raw,[]);
  if(!Array.isArray(arr)||!arr.length) return "";
  return `<div class="info-block"><div class="info-label">한자 정보</div>${arr.map(k=>`<div><strong>${esc(k.char||"")}</strong>　음독 ${esc(k.onyomi||"-")} · 훈독 ${esc(k.kunyomi||"-")} · ${esc(k.meaning_ko||"")}</div>`).join("")}</div>`;
}

function bboxData(item){
  const b=parseJson(item.source_bbox_json,null);
  if(!b) return null;
  const x=Number(b.x),y=Number(b.y),width=Number(b.width),height=Number(b.height);
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0) return null;
  return {x,y,width,height};
}

function bboxAttr(item){
  const b=bboxData(item);
  return b ? esc(JSON.stringify(b)) : "";
}

function itemSummary(item){
  const isWord=item.item_type==="kanji_box";
  const jp=isWord
    ? rubyWord(item.target_word||item.target_surface||"",item.target_word_reading||"")
    : rubySource(item.source_text||"",item.source_furigana_json);
  const meaning=isWord
    ? (item.word_translation||item.source_translation||item.ui_translation||"")
    : (item.source_translation||item.ui_translation||"");
  return `<article class="item-row" data-kind="${isWord?"word":"sentence"}" data-item-id="${esc(item.id)}">
    <div class="item-summary" role="button" tabindex="0" aria-expanded="false">
      <span class="badge ${isWord?"word":"sentence"}">${isWord?"단어":"문장"}</span>
      <div class="summary-jp" lang="ja" title="${esc(isWord?(item.target_word||item.target_surface||""):(item.source_text||""))}">${jp}</div>
      <div class="summary-meaning" title="${esc(meaning)}">${esc(meaning)}</div>
      <div class="more-wrap">
        <button class="more-btn" type="button" aria-label="항목 메뉴" aria-expanded="false">⋯</button>
        <div class="more-menu" hidden>
          <button type="button" data-item-act="move">이동</button>
          <button type="button" data-item-act="delete" class="danger-text">삭제</button>
        </div>
      </div>
    </div>
    <div class="item-detail" hidden>
      ${item.media_id ? `<div class="shot loading" data-media-id="${esc(item.media_id)}" data-bbox="${bboxAttr(item)}">이미지 불러오는 중…</div>` : ""}
      ${isWord ? `
        <div class="info-block"><div class="info-label">원문</div><div class="jp-source" lang="ja">${rubySource(item.source_text||"",item.source_furigana_json)}</div><div class="ko-source">${esc(item.source_translation||item.ui_translation||"")}</div></div>
        ${item.word_explanation ? `<div class="info-block"><div class="info-label">설명</div>${esc(item.word_explanation)}</div>` : ""}
        ${kanjiLines(item.kanji_json)}
      ` : `
        ${item.word_explanation ? `<div class="info-block"><div class="info-label">표현 설명</div>${esc(item.word_explanation)}</div>` : ""}
      `}
      <div class="detail-meta">${esc(fmtDate(item.created_at))}</div>
    </div>
  </article>`;
}

function focusBoxHtml(bbox){
  if(!bbox) return "";
  const left=Math.max(0,Math.min(1,bbox.x))*100;
  const top=Math.max(0,Math.min(1,bbox.y))*100;
  const width=Math.max(0,Math.min(1-bbox.x,bbox.width))*100;
  const height=Math.max(0,Math.min(1-bbox.y,bbox.height))*100;
  return `<span class="focus-box" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></span>`;
}

async function hydrateShot(node){
  if(!node||node.dataset.loaded==="1") return;
  node.dataset.loaded="1";
  try{
    const mediaId=node.dataset.mediaId;
    const url=await getMediaUrl(mediaId);
    const bbox=parseJson(node.dataset.bbox,null);
    node.classList.remove("loading");
    node.innerHTML=`<button type="button" class="thumb-frame" data-open-media="${esc(mediaId)}" data-bbox="${esc(node.dataset.bbox||"")}" aria-label="이미지 크게 보기"><img src="${url}" alt="저장된 스크린샷">${focusBoxHtml(bbox)}</button>`;
  }catch(e){
    node.classList.remove("loading");
    node.textContent=`이미지 오류: ${e.message||e}`;
  }
}

async function showImage(mediaId,bboxRaw){
  const url=await getMediaUrl(mediaId);
  const bbox=parseJson(bboxRaw,null);
  imageModalBody.innerHTML=`<div class="modal-frame"><img src="${url}" alt="저장된 스크린샷 원본">${focusBoxHtml(bbox)}</div>`;
  imageModal.showModal();
}

function closeImageModal(){
  if(imageModal.open) imageModal.close();
  imageModalBody.innerHTML="";
}

async function loadOverview(){
  clearMediaUrls();
  currentSession=null;
  currentItems=[];
  mainView.innerHTML="<div class=loading-text>세션 목록을 불러오는 중…</div>";
  const out=await api("/api/sessions/recent");
  sessionsCache=out.sessions||[];
  if(!sessionsCache.length){
    mainView.innerHTML="<div class=empty>저장된 세션이 없습니다.</div>";
    return;
  }
  mainView.innerHTML=`<div class="session-list">${sessionsCache.map(s=>`
    <section class="session-card" data-id="${esc(s.id)}" data-title="${esc(s.title||"")}">
      <a class="session-title" href="?session=${encodeURIComponent(s.id)}">${esc(s.title||s.session_key||s.id)}</a>
      <a class="source-link" href="${esc(s.canonical_url||s.raw_url||"#")}" target="_blank" rel="noopener">${esc(s.canonical_url||s.raw_url||"")}</a>
      <div class="session-meta"><span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span></div>
      <div class="actions">
        <button class="btn" data-session-act="rename">세션명 변경</button>
        <button class="btn" data-session-act="export" data-apkg>이 세션 APKG</button>
        <button class="btn danger" data-session-act="delete">세션 삭제</button>
      </div>
    </section>`).join("")}</div>`;
}

async function loadDetail(sessionId){
  clearMediaUrls();
  mainView.innerHTML="<div class=loading-text>저장된 카드와 AI 설명을 불러오는 중…</div>";
  const out=await api(`/api/sessions/${encodeURIComponent(sessionId)}/detail?ai=1`);
  currentSession=out.session;
  currentItems=out.items||[];
  const s=currentSession;
  mainView.innerHTML=`
    <section class="detail-head">
      <a class="back-link" href="./logs.html">← 세션 목록</a>
      <h2>${esc(s.title||s.session_key||s.id)}</h2>
      <a class="source-link" href="${esc(s.canonical_url||s.raw_url||"#")}" target="_blank" rel="noopener">YouTube에서 열기</a>
      <div class="session-meta"><span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span></div>
      <div class="actions">
        <button class="btn" id="renameSession">세션명 변경</button>
        <button class="btn" id="exportSession" data-apkg>이 세션 APKG 내보내기</button>
        <button class="btn danger" id="deleteSession">세션 삭제</button>
      </div>
    </section>
    <div class="filters" role="group" aria-label="카드 필터">
      <button class="filter active" data-filter="all">전체 ${currentItems.length}</button>
      <button class="filter" data-filter="sentence">문장 ${Number(s.sentence_count||0)}</button>
      <button class="filter" data-filter="word">단어 ${Number(s.word_count||0)}</button>
    </div>
    <section id="itemList" class="item-list">${currentItems.length?currentItems.map(itemSummary).join(""):"<div class=empty>저장된 카드가 없습니다.</div>"}</section>`;

  document.getElementById("exportSession")?.addEventListener("click",()=>exportApkg(s.id,s.title||"Session"));
  document.getElementById("renameSession")?.addEventListener("click",()=>renameSession(s.id,s.title||""));
  document.getElementById("deleteSession")?.addEventListener("click",()=>removeSession(s.id,true));
  for(const btn of document.querySelectorAll(".filter")){
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b===btn));
      const f=btn.dataset.filter;
      document.querySelectorAll(".item-row").forEach(card=>card.hidden=f!=="all"&&card.dataset.kind!==f);
    });
  }
}

async function renameSession(id,currentTitle){
  const title=prompt("새 세션명을 입력하세요.",currentTitle||"");
  if(title==null) return;
  const trimmed=title.trim();
  if(!trimmed) return alert("세션명은 비워둘 수 없습니다.");
  await api(`/api/sessions/${encodeURIComponent(id)}`,{
    method:"PATCH",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({title:trimmed})
  });
  await loadCurrent();
}

async function removeSession(id,fromDetail=false){
  if(!confirm("이 세션과 연결된 문장·단어·스크린샷을 삭제합니다. 이 작업은 되돌릴 수 없습니다.\n\n계속할까요?")) return;
  await api(`/api/sessions/${encodeURIComponent(id)}`,{method:"DELETE"});
  if(fromDetail) location.href="./logs.html";
  else await loadCurrent();
}

async function removeAll(){
  if(!confirm("모든 세션, 문장, 단어, 스크린샷을 삭제합니다.\n이 작업은 되돌릴 수 없습니다.\n\n정말 전체 삭제할까요?")) return;
  deleteAll.disabled=true;
  try{
    await api("/api/all",{method:"DELETE"});
    setStatus("전체 학습로그를 삭제했습니다.");
    await loadCurrent();
  }finally{
    deleteAll.disabled=false;
  }
}

async function removeItem(id){
  if(!confirm("이 항목을 삭제할까요? 같은 사진을 사용하는 다른 항목이 있으면 사진은 유지됩니다.")) return;
  await api(`/api/items/${encodeURIComponent(id)}`,{method:"DELETE"});
  await loadDetail(currentSession.id);
}

async function openMoveDialog(id){
  movingItemId=id;
  const out=await api("/api/sessions/recent");
  sessionsCache=out.sessions||[];
  const choices=sessionsCache.filter(s=>s.id!==currentSession?.id);
  if(!choices.length){
    alert("이동할 다른 세션이 없습니다.");
    return;
  }
  moveTarget.innerHTML=choices.map(s=>`<option value="${esc(s.id)}">${esc(s.title||s.session_key||s.id)}</option>`).join("");
  moveDlg.showModal();
}

async function confirmMove(){
  if(!movingItemId||!moveTarget.value) return;
  moveOk.disabled=true;
  try{
    await api(`/api/items/${encodeURIComponent(movingItemId)}`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({session_id:moveTarget.value})
    });
    moveDlg.close();
    await loadDetail(currentSession.id);
  }finally{
    moveOk.disabled=false;
    movingItemId="";
  }
}

function closeMenus(except=null){
  document.querySelectorAll(".more-wrap.open").forEach(w=>{
    if(w===except) return;
    w.classList.remove("open");
    w.querySelector(".more-menu")?.setAttribute("hidden","");
    w.querySelector(".more-btn")?.setAttribute("aria-expanded","false");
  });
}

async function loadCurrent(){
  workerBase.value=getLogWorkerBase();
  setStatus("");
  try{
    const id=sessionIdFromUrl();
    exportAll.hidden=Boolean(id);
    deleteAll.hidden=Boolean(id);
    if(id) await loadDetail(id);
    else await loadOverview();
  }catch(e){
    console.error(e);
    mainView.innerHTML=`<div class="error">오류: ${esc(e.message||e)}</div>`;
  }
}

mainView.addEventListener("click",async e=>{
  const sessionCard=e.target.closest(".session-card");
  const sessionAct=e.target.closest("[data-session-act]");
  if(sessionCard&&sessionAct){
    const id=sessionCard.dataset.id;
    const title=sessionCard.dataset.title||"";
    if(sessionAct.dataset.sessionAct==="rename") await renameSession(id,title);
    if(sessionAct.dataset.sessionAct==="export") await exportApkg(id,title);
    if(sessionAct.dataset.sessionAct==="delete") await removeSession(id,false);
    return;
  }

  const more=e.target.closest(".more-btn");
  if(more){
    e.stopPropagation();
    const wrap=more.closest(".more-wrap");
    const open=!wrap.classList.contains("open");
    closeMenus(wrap);
    wrap.classList.toggle("open",open);
    more.setAttribute("aria-expanded",String(open));
    wrap.querySelector(".more-menu").hidden=!open;
    return;
  }

  const itemAct=e.target.closest("[data-item-act]");
  if(itemAct){
    e.stopPropagation();
    const row=itemAct.closest(".item-row");
    closeMenus();
    if(itemAct.dataset.itemAct==="delete") await removeItem(row.dataset.itemId);
    if(itemAct.dataset.itemAct==="move") await openMoveDialog(row.dataset.itemId);
    return;
  }

  const openMedia=e.target.closest("[data-open-media]");
  if(openMedia){
    e.stopPropagation();
    await showImage(openMedia.dataset.openMedia,openMedia.dataset.bbox||"");
    return;
  }

  const summary=e.target.closest(".item-summary");
  if(summary){
    const row=summary.closest(".item-row");
    const detail=row.querySelector(".item-detail");
    const opening=detail.hidden;
    detail.hidden=!opening;
    summary.setAttribute("aria-expanded",String(opening));
    row.classList.toggle("expanded",opening);
    if(opening) await hydrateShot(detail.querySelector(".shot[data-media-id]"));
  }
});

mainView.addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&e.target.classList.contains("item-summary")){
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener("click",e=>{
  if(!e.target.closest(".more-wrap")) closeMenus();
});

imageModalClose.addEventListener("click",closeImageModal);
imageModal.addEventListener("click",e=>{if(e.target===imageModal) closeImageModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&imageModal.open) closeImageModal();});
moveCancel.addEventListener("click",()=>moveDlg.close());
moveOk.addEventListener("click",confirmMove);

saveBase.addEventListener("click",()=>{setLogWorkerBase(workerBase.value.trim());loadCurrent();});
setToken.addEventListener("click",()=>{
  const token=prompt("APP_TOKEN 입력",getAppToken()||"");
  if(token) setAppToken(token.trim());
  loadCurrent();
});
refresh.addEventListener("click",loadCurrent);
exportAll.addEventListener("click",()=>exportApkg());
deleteAll.addEventListener("click",removeAll);

window.addEventListener("beforeunload",clearMediaUrls);
loadCurrent();
