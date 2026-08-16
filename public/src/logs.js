import {
  getLogWorkerBase,
  setLogWorkerBase,
  getAppToken,
  setAppToken,
  ensureLogConfig
} from "./log.js";
import { createAnkiApkg } from "./apkg.js";
import { loadUsageData, buildKanjiUsage, enrichSourceTokens } from "./kanji_usage.js";

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

const sessionDlg=document.getElementById("sessionDlg");
const sessionDlgTitle=document.getElementById("sessionDlgTitle");
const sessionInput=document.getElementById("sessionInput");
const sessionPaste=document.getElementById("sessionPaste");
const sessionExisting=document.getElementById("sessionExisting");
const sessionDlgHint=document.getElementById("sessionDlgHint");
const existingPanel=document.getElementById("existingPanel");
const existingSearch=document.getElementById("existingSearch");
const existingList=document.getElementById("existingList");
const sessionCancel=document.getElementById("sessionCancel");
const sessionConfirm=document.getElementById("sessionConfirm");

const choiceDlg=document.getElementById("choiceDlg");
const choiceTitle=document.getElementById("choiceTitle");
const choiceMessage=document.getElementById("choiceMessage");
const choiceCancel=document.getElementById("choiceCancel");
const choiceOnly=document.getElementById("choiceOnly");
const choiceTogether=document.getElementById("choiceTogether");
const wordInfoDlg=document.getElementById("wordInfoDlg");
const wordInfoTitle=document.getElementById("wordInfoTitle");
const wordInfoBody=document.getElementById("wordInfoBody");
const wordInfoClose=document.getElementById("wordInfoClose");

const editItemDlg=document.getElementById("editItemDlg");
const editItemTitle=document.getElementById("editItemTitle");
const editSourceText=document.getElementById("editSourceText");
const editReanalyzeSource=document.getElementById("editReanalyzeSource");
const editSourceHint=document.getElementById("editSourceHint");
const editReadingList=document.getElementById("editReadingList");
const editWordContext=document.getElementById("editWordContext");
const editTargetLabel=document.getElementById("editTargetLabel");
const editInstruction=document.getElementById("editInstruction");
const editCurrentTranslation=document.getElementById("editCurrentTranslation");
const editCurrentWordRow=document.getElementById("editCurrentWordRow");
const editCurrentWordMeaning=document.getElementById("editCurrentWordMeaning");
const editCurrentExplanation=document.getElementById("editCurrentExplanation");
const editStatus=document.getElementById("editStatus");
const editItemCancel=document.getElementById("editItemCancel");
const editItemSave=document.getElementById("editItemSave");

const bulkBar=document.getElementById("bulkBar");
const bulkCount=document.getElementById("bulkCount");
const bulkSelectAll=document.getElementById("bulkSelectAll");
const bulkMove=document.getElementById("bulkMove");
const bulkDelete=document.getElementById("bulkDelete");
const bulkCancel=document.getElementById("bulkCancel");

const mediaUrls=new Map();
let currentSession=null;
let currentItems=[];
let sessionsCache=[];
let selectionMode=false;
let selectedIds=new Set();
let currentFilter="all";
let editState=null;

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

async function api(path,opts={}){ return (await authFetch(path,opts)).json(); }
async function fetchMedia(mediaId){ return (await authFetch(`/api/media/${encodeURIComponent(mediaId)}`)).blob(); }

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

function sessionIdFromUrl(){ return new URL(location.href).searchParams.get("session") || ""; }
function setStatus(message){ exportStatus.textContent=message || ""; }
function setExportBusy(busy){ for(const btn of document.querySelectorAll("[data-apkg],#exportAll")) btn.disabled=busy; }

function parseJson(raw,fallback=null){
  try{return JSON.parse(raw);}catch{return fallback;}
}

async function enrichItems(items){
  return Promise.all((items||[]).map(async item=>{
    const tokens=await enrichSourceTokens(item.source_furigana_json);
    const target=item.target_surface||item.target_word||"";
    const wordKanji=item.item_type==="kanji_box" ? await buildKanjiUsage(target,item.target_word_reading||"") : [];
    return {
      ...item,
      source_furigana_json:tokens.length?JSON.stringify(tokens):item.source_furigana_json,
      kanji_json:item.item_type==="kanji_box"?JSON.stringify(wordKanji):"[]"
    };
  }));
}

async function refreshUsageFooter(){
  try{
    const data=await loadUsageData();
    const meta=data?._meta||{};
    const el=document.getElementById("jmdictDate");
    if(el) el.textContent=meta.jmdict_date || (meta.generated_at?String(meta.generated_at).slice(0,10):"") || "업데이트 필요";
  }catch{}
}

async function exportApkg(sessionId="",title=""){
  setExportBusy(true);
  setStatus("카드 설명과 APKG 데이터를 준비하는 중…");
  try{
    const q=new URLSearchParams({ai:"1"});
    if(sessionId) q.set("session_id",sessionId);
    const data=await api(`/api/export/apkg-data?${q}`);
    data.items=await enrichItems(data.items||[]);
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

function hasKanji(s){ return /[\u3400-\u9fff]/.test(String(s||"")); }

function usageHtml(arr){
  if(!Array.isArray(arr)||!arr.length) return "";
  return arr.map(k=>{
    if(k?.unavailable){
      return `<div class="kanji-row"><strong class="kanji-char">${esc(k.char||"")}</strong><span class="kanji-ko">${esc(k.meaning_ko||"정보 없음")}</span></div>`;
    }
    if(k?.special){
      return `<div class="kanji-row"><strong class="kanji-char">${esc(k.char||"")}</strong><span class="kanji-ko">${esc(k.meaning_ko||"정보 없음")}</span><span class="special-reading">${esc(k.word_reading||"")} · 특수 읽기</span></div>`;
    }
    const typ=k.reading_type==="on"?"音":k.reading_type==="kun"?"訓":"";
    const ex=(k.examples||[]).map(v=>`${esc(v.word||"")}（${esc(v.reading||"")}）`).join(" · ");
    return `<div class="kanji-row"><strong class="kanji-char">${esc(k.char||"")}</strong><span class="kanji-ko">${esc(k.meaning_ko||"정보 없음")}</span><span class="reading-group">${typ?`<span class="reading-badge">${typ}</span>`:""}<span>${esc(k.display_reading||k.used_reading||"")}</span></span>${ex?`<span class="kanji-examples">예: ${ex}</span>`:""}</div>`;
  }).join("");
}

function tokenDataAttr(t){
  const data={
    surface:String(t?.surface||""),reading:String(t?.reading||""),lemma:String(t?.lemma||t?.surface||""),
    meaning:String(t?.meaning||""),note:String(t?.note||""),kanji:Array.isArray(t?.kanji)?t.kanji:[]
  };
  return esc(encodeURIComponent(JSON.stringify(data)));
}

function rubySource(text,raw,clickable=true){
  const tokens=parseJson(raw,[]);
  if(!Array.isArray(tokens)||!tokens.length) return esc(text||"");
  return tokens.map(t=>{
    const surface=String(t?.surface||"");
    const reading=String(t?.reading||"");
    const body=hasKanji(surface)&&reading
      ? `<ruby lang="ja">${esc(surface)}<rt>${esc(reading)}</rt></ruby>`
      : esc(surface);
    return clickable ? `<button type="button" class="source-token" data-token="${tokenDataAttr(t)}">${body}</button>` : body;
  }).join("");
}

function rubyWord(word,reading){
  const w=String(word||"");
  const r=String(reading||"");
  return w&&r ? `<ruby lang="ja">${esc(w)}<rt>${esc(r)}</rt></ruby>` : esc(w);
}

function kanjiLines(raw){
  const arr=parseJson(raw,[]);
  if(!Array.isArray(arr)||!arr.length) return "";
  return `<div class="info-block"><div class="info-label">한자 정보</div>${usageHtml(arr)}</div>`;
}

function bboxData(item){
  const b=parseJson(item.source_bbox_json,null);
  if(!b) return null;
  const x=Number(b.x),y=Number(b.y),width=Number(b.width),height=Number(b.height);
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0) return null;
  return {x,y,width,height};
}
function bboxAttr(item){ const b=bboxData(item); return b ? esc(JSON.stringify(b)) : ""; }

function itemSummary(item){
  const isWord=item.item_type==="kanji_box";
  const jp=isWord
    ? rubyWord(item.target_word||item.target_surface||"",item.target_word_reading||"")
    : rubySource(item.source_text||"",item.source_furigana_json,false);
  const meaning=isWord
    ? (item.word_translation||item.source_translation||item.ui_translation||"")
    : (item.source_translation||item.ui_translation||"");
  return `<article class="item-row" data-kind="${isWord?"word":"sentence"}" data-item-id="${esc(item.id)}">
    <div class="item-summary" role="button" tabindex="0" aria-expanded="false">
      <button class="select-mark" type="button" data-select-item="${esc(item.id)}" aria-label="선택">✓</button>
      <span class="badge ${isWord?"word":"sentence"}">${isWord?"단어":"문장"}</span>
      <div class="summary-jp" lang="ja" title="${esc(isWord?(item.target_word||item.target_surface||""):(item.source_text||""))}">${jp}</div>
      <div class="summary-meaning" title="${esc(meaning)}">${esc(meaning)}</div>
      <div class="more-wrap">
        <button class="more-btn" type="button" aria-label="항목 메뉴" aria-expanded="false">⋯</button>
        <div class="more-menu" hidden>
          <button type="button" data-item-act="edit">수정</button>
          <button type="button" data-item-act="move">이동</button>
          <button type="button" data-item-act="delete" class="danger-text">삭제</button>
        </div>
      </div>
    </div>
    <div class="item-detail" hidden>
      ${item.media_id ? `<div class="shot loading" data-media-id="${esc(item.media_id)}" data-bbox="${bboxAttr(item)}">이미지 불러오는 중…</div>` : ""}
      ${isWord ? `
        <div class="info-block"><div class="info-label">원문</div><div class="jp-source" lang="ja">${rubySource(item.source_text||"",item.source_furigana_json)}</div><div class="ko-source">${esc(item.source_translation||item.ui_translation||"")}</div></div>
        ${item.word_explanation ? `<div class="info-block prewrap"><div class="info-label">설명</div>${esc(item.word_explanation)}</div>` : ""}
        ${kanjiLines(item.kanji_json)}
      ` : `
        <div class="info-block"><div class="info-label">원문</div><div class="jp-source" lang="ja">${rubySource(item.source_text||"",item.source_furigana_json)}</div><div class="ko-source">${esc(item.source_translation||item.ui_translation||"")}</div></div>
        ${item.word_explanation ? `<div class="info-block prewrap"><div class="info-label">표현 설명</div>${esc(item.word_explanation)}</div>` : ""}
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
function closeImageModal(){ if(imageModal.open) imageModal.close(); imageModalBody.innerHTML=""; }

function sourceLinkHtml(s,label=null){
  const url=s?.canonical_url||s?.raw_url||"";
  if(!url) return "";
  return `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label||url)}</a>`;
}

async function loadOverview(){
  clearMediaUrls();
  currentSession=null;
  currentItems=[];
  selectionMode=false;
  selectedIds.clear();
  updateBulkBar();
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
      ${sourceLinkHtml(s)}
      <div class="session-meta"><span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span></div>
      <div class="actions">
        <button class="btn" data-session-act="export" data-apkg>이 세션 APKG 내보내기</button>
        <button class="btn" data-session-act="edit">세션명 변경</button>
        <button class="btn danger" data-session-act="delete">세션 삭제</button>
      </div>
    </section>`).join("")}</div>`;
}

async function loadDetail(sessionId){
  clearMediaUrls();
  selectionMode=false;
  selectedIds.clear();
  currentFilter="all";
  updateBulkBar();
  mainView.innerHTML="<div class=loading-text>저장된 카드와 AI 설명을 불러오는 중…</div>";
  const out=await api(`/api/sessions/${encodeURIComponent(sessionId)}/detail?ai=1`);
  currentSession=out.session;
  currentItems=await enrichItems(out.items||[]);
  const s=currentSession;
  mainView.innerHTML=`
    <section class="detail-head">
      <a class="back-link" href="./logs.html">← 세션 목록</a>
      <h2>${esc(s.title||s.session_key||s.id)}</h2>
      ${sourceLinkHtml(s,"YouTube에서 열기")}
      <div class="session-meta"><span>문장 ${Number(s.sentence_count||0)}개</span><span>단어 ${Number(s.word_count||0)}개</span><span>마지막 저장 ${esc(fmtDate(s.last_used_at))}</span></div>
      <div class="actions">
        <button class="btn" id="exportSession" data-apkg>이 세션 APKG 내보내기</button>
        <button class="btn" id="editSession">세션명 변경</button>
        <button class="btn danger" id="deleteSession">세션 삭제</button>
      </div>
    </section>
    <div class="filters" role="group" aria-label="카드 필터">
      <button class="filter active" data-filter="all">전체 ${currentItems.length}</button>
      <button class="filter" data-filter="sentence">문장 ${Number(s.sentence_count||0)}</button>
      <button class="filter" data-filter="word">단어 ${Number(s.word_count||0)}</button>
      <button class="btn selection-toggle" id="selectionToggle" type="button">선택</button>
    </div>
    <section id="itemList" class="item-list">${currentItems.length?currentItems.map(itemSummary).join(""):"<div class=empty>저장된 카드가 없습니다.</div>"}</section>`;

  document.getElementById("exportSession")?.addEventListener("click",()=>exportApkg(s.id,s.title||"Session"));
  document.getElementById("editSession")?.addEventListener("click",()=>editSessionFlow(s));
  document.getElementById("deleteSession")?.addEventListener("click",()=>removeSession(s.id,true));
  document.getElementById("selectionToggle")?.addEventListener("click",()=>setSelectionMode(!selectionMode));
  for(const btn of document.querySelectorAll(".filter")){
    btn.addEventListener("click",()=>{
      currentFilter=btn.dataset.filter;
      document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b===btn));
      document.querySelectorAll(".item-row").forEach(card=>card.hidden=currentFilter!=="all"&&card.dataset.kind!==currentFilter);
      updateBulkBar();
    });
  }
}

function renderExistingSessions(excludeIds=[]){
  const q=existingSearch.value.trim().toLocaleLowerCase("ko-KR");
  const excluded=new Set(excludeIds);
  const list=sessionsCache.filter(s=>!excluded.has(s.id)).filter(s=>{
    if(!q) return true;
    return [s.title,s.canonical_url,s.raw_url,s.session_key].some(v=>String(v||"").toLocaleLowerCase("ko-KR").includes(q));
  });
  existingList.innerHTML=list.length?list.map(s=>`
    <button class="existing-item" type="button" data-existing-id="${esc(s.id)}">
      <strong>${esc(s.title||s.session_key||s.id)}</strong>
      <small>${esc(s.canonical_url||s.raw_url||"링크 없음")}</small>
    </button>`).join(""):"<div class=empty>선택할 세션이 없습니다.</div>";
}

async function openSessionDialog({title,initial="",excludeIds=[]}={}){
  sessionDlgTitle.textContent=title||"세션 선택";
  sessionInput.value=initial||"";
  sessionDlgHint.textContent="세션명 또는 YouTube 링크를 입력하세요. 같은 이름이나 링크가 있으면 자동으로 병합합니다.";
  existingPanel.hidden=true;
  existingSearch.value="";
  existingList.innerHTML="";

  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{
      if(done) return;
      done=true;
      cleanup();
      if(sessionDlg.open) sessionDlg.close();
      resolve(value);
    };
    const onPaste=async()=>{
      try{
        const text=await navigator.clipboard?.readText?.();
        if(text) sessionInput.value=text.trim();
        sessionInput.focus();
      }catch(e){ sessionDlgHint.textContent=`붙여넣기 실패: ${e.message||e}`; }
    };
    const onExisting=async()=>{
      existingPanel.hidden=!existingPanel.hidden;
      if(existingPanel.hidden) return;
      existingList.innerHTML="<div class=loading-text>기존 세션을 불러오는 중…</div>";
      try{
        const out=await api("/api/sessions/recent");
        sessionsCache=out.sessions||[];
        renderExistingSessions(excludeIds);
        existingSearch.focus();
      }catch(e){
        existingList.innerHTML=`<div class="error">세션 목록 오류: ${esc(e.message||e)}</div>`;
      }
    };
    const onExistingSearch=()=>renderExistingSessions(excludeIds);
    const onExistingClick=e=>{
      const b=e.target.closest("[data-existing-id]");
      if(b) finish({target_session_id:b.dataset.existingId});
    };
    const onConfirm=()=>{
      const input=sessionInput.value.trim();
      if(!input){ sessionDlgHint.textContent="세션명 또는 YouTube 링크를 입력하세요."; return; }
      finish({input});
    };
    const onCancel=()=>finish(null);
    const onClose=()=>finish(null);
    const cleanup=()=>{
      sessionPaste.removeEventListener("click",onPaste);
      sessionExisting.removeEventListener("click",onExisting);
      existingSearch.removeEventListener("input",onExistingSearch);
      existingList.removeEventListener("click",onExistingClick);
      sessionConfirm.removeEventListener("click",onConfirm);
      sessionCancel.removeEventListener("click",onCancel);
      sessionDlg.removeEventListener("close",onClose);
    };
    sessionPaste.addEventListener("click",onPaste);
    sessionExisting.addEventListener("click",onExisting);
    existingSearch.addEventListener("input",onExistingSearch);
    existingList.addEventListener("click",onExistingClick);
    sessionConfirm.addEventListener("click",onConfirm);
    sessionCancel.addEventListener("click",onCancel);
    sessionDlg.addEventListener("close",onClose,{once:true});
    sessionDlg.showModal();
    sessionInput.focus();
    sessionInput.select();
  });
}

async function editSessionFlow(session){
  const spec=await openSessionDialog({
    title:"세션명·YouTube 링크 변경 / 병합",
    initial:session.title||"",
    excludeIds:[session.id]
  });
  if(!spec) return;
  const out=await api(`/api/sessions/${encodeURIComponent(session.id)}`,{
    method:"PATCH",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(spec)
  });
  const targetId=out?.session?.id || out?.target_session_id || session.id;
  if(sessionIdFromUrl()) location.href=`./logs.html?session=${encodeURIComponent(targetId)}`;
  else await loadCurrent();
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
  }finally{ deleteAll.disabled=false; }
}

async function showWordInfo(encoded){
  let t={}; try{t=JSON.parse(decodeURIComponent(encoded||""));}catch{}
  const surface=String(t.surface||"");
  wordInfoTitle.textContent=surface || "단어 정보";
  let meaning=String(t.meaning||"");
  wordInfoBody.innerHTML=`<div class="word-info-reading" lang="ja">${rubyWord(surface,t.reading||"")}</div><div class="word-info-meaning">${meaning?esc(meaning):"뜻 불러오는 중…"}</div>${t.note?`<div class="info-block prewrap"><div class="info-label">설명</div>${esc(t.note)}</div>`:""}${t.kanji?.length?`<div class="info-block"><div class="info-label">한자 정보</div>${usageHtml(t.kanji)}</div>`:""}`;
  wordInfoDlg.showModal();
  if(!meaning && surface){
    try{
      const r=await api("/run/translate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:t.lemma||surface,src:"JA",tgt:"KO",target:"KO"})});
      meaning=String(r.translation||r.text||r.result||"");
      const el=wordInfoBody.querySelector(".word-info-meaning"); if(el) el.textContent=meaning||"뜻 정보 없음";
    }catch{
      const el=wordInfoBody.querySelector(".word-info-meaning"); if(el) el.textContent="뜻 정보 없음";
    }
  }
}

function normalizeEditTokens(raw){
  const arr=parseJson(raw,[]);
  if(!Array.isArray(arr)) return [];
  return arr.map(t=>({
    surface:String(t?.surface||t?.text||""),
    reading:String(t?.reading||t?.read||t?.kana||""),
    lemma:String(t?.lemma||t?.base||t?.surface||t?.text||"")
  })).filter(t=>t.surface);
}
function editTokenText(tokens){ return (tokens||[]).map(t=>String(t.surface||"")).join(""); }
function copyEditTokens(tokens){ return (tokens||[]).map(t=>({...t})); }
function targetRangeForEdit(item,source){
  let start=Number(item?.target_start_index),end=Number(item?.target_end_index);
  if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=source.length) return {start,end};
  const surface=String(item?.target_surface||"");
  if(surface){ const i=source.indexOf(surface); if(i>=0) return {start:i,end:i+surface.length}; }
  return null;
}
function renderEditReadings(){
  if(!editState) return;
  const source=editSourceText.value.trim();
  const range=targetRangeForEdit(editState.item,source);
  let cursor=0;
  editReadingList.innerHTML=editState.tokens.map((t,index)=>{
    const start=cursor; cursor+=String(t.surface||"").length;
    const isTarget=range && cursor>range.start && start<range.end;
    return `<label class="reading-token${isTarget?" target-token":""}">
      <span class="reading-surface" lang="ja">${esc(t.surface||"")}</span>
      <input data-reading-index="${index}" value="${esc(t.reading||"")}" aria-label="${esc(t.surface||"")} 읽기" />
    </label>`;
  }).join("") || '<span class="edit-hint">요미가나 정보가 없습니다. 원문을 다시 분석하세요.</span>';
  if(editState.item.item_type==="kanji_box"){
    editWordContext.hidden=false;
    editTargetLabel.textContent=`${editState.item.target_surface||editState.item.target_word||""}${editState.item.target_word_reading?` · ${editState.item.target_word_reading}`:""}`;
  }else editWordContext.hidden=true;
}
function collectEditTokens(){
  if(!editState) return [];
  const out=copyEditTokens(editState.tokens);
  editReadingList.querySelectorAll("input[data-reading-index]").forEach(input=>{
    const i=Number(input.dataset.readingIndex);
    if(Number.isFinite(i)&&out[i]) out[i].reading=input.value.trim();
  });
  editState.tokens=out;
  return out;
}
function editedReadingLocks(tokens){
  if(!editState) return [];
  const base=editState.baselineTokens||[];
  const out=[];
  for(let i=0;i<tokens.length;i++){
    const a=tokens[i],b=base[i];
    if(!b || a.surface!==b.surface || String(a.reading||"")!==String(b.reading||"")){
      if(String(a.reading||"").trim()) out.push({index:i,surface:a.surface,reading:a.reading});
    }
  }
  return out;
}
function setEditStatus(text,isError=false){
  editStatus.textContent=text||"";
  editStatus.classList.toggle("error",!!isError);
}
function updateEditSourceHint(){
  if(!editState) return;
  const source=editSourceText.value.trim();
  if(source!==editState.analyzedSource){
    editSourceHint.textContent="원문이 바뀌었습니다. 저장 시 요미가나를 자동 재분석합니다.";
  }else editSourceHint.textContent="";
}
async function reanalyzeEditSource(){
  if(!editState) return false;
  const source=editSourceText.value.trim();
  if(!source){ setEditStatus("원문을 입력하세요.",true); return false; }
  editReanalyzeSource.disabled=true;
  setEditStatus("원문에서 요미가나를 다시 분석하는 중…");
  try{
    const fr=await api("/run/furigana",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:source})});
    const raw=fr?.tokens||fr?.result||fr?.morphs||fr?.morphemes||[];
    const tokens=(Array.isArray(raw)?raw:[]).map(t=>({
      surface:String(t?.surface||t?.text||""),reading:String(t?.reading||t?.read||t?.kana||""),
      lemma:String(t?.lemma||t?.base||t?.surface||t?.text||"")
    })).filter(t=>t.surface);
    if(!tokens.length || editTokenText(tokens)!==source) throw new Error("분석된 형태소가 원문과 정확히 일치하지 않습니다.");
    editState.tokens=copyEditTokens(tokens);
    editState.baselineTokens=copyEditTokens(tokens);
    editState.analyzedSource=source;
    renderEditReadings();
    updateEditSourceHint();
    setEditStatus("요미가나를 새 원문 기준으로 갱신했습니다. 필요한 읽기만 직접 고친 뒤 저장하세요.");
    return true;
  }catch(e){
    setEditStatus(`요미가나 재분석 실패: ${e.message||e}`,true);
    return false;
  }finally{ editReanalyzeSource.disabled=false; }
}

async function editItemFlow(item){
  if(!item) return;
  const isWord=item.item_type==="kanji_box";
  const tokens=normalizeEditTokens(item.source_furigana_json);
  editState={
    item,
    originalSource:String(item.source_text||""),
    analyzedSource:String(item.source_text||""),
    tokens:copyEditTokens(tokens),
    baselineTokens:copyEditTokens(tokens)
  };
  editItemTitle.textContent=isWord?"단어 항목 수정":"문장 항목 수정";
  editSourceText.value=item.source_text||"";
  editInstruction.value="";
  editCurrentTranslation.textContent=item.source_translation||item.ui_translation||"(없음)";
  editCurrentTranslation.classList.toggle("empty",!(item.source_translation||item.ui_translation));
  editCurrentWordRow.hidden=!isWord;
  editCurrentWordMeaning.textContent=isWord?(item.word_translation||"(없음)"):"";
  editCurrentExplanation.textContent=item.word_explanation||"(없음)";
  editCurrentExplanation.classList.toggle("empty",!item.word_explanation);
  editItemDlg.dataset.itemId=item.id;
  setEditStatus("");
  renderEditReadings();
  updateEditSourceHint();
  editItemDlg.showModal();
}

async function saveEditedItem(){
  const id=editItemDlg.dataset.itemId||""; if(!id||!editState) return;
  const item=editState.item;
  editItemSave.disabled=true;
  editReanalyzeSource.disabled=true;
  const oldLabel=editItemSave.textContent;
  editItemSave.textContent="저장 중…";
  try{
    const source=editSourceText.value.trim();
    if(!source) throw new Error("원문을 입력하세요.");
    collectEditTokens();
    if(source!==editState.analyzedSource || editTokenText(editState.tokens)!==source){
      const ok=await reanalyzeEditSource();
      if(!ok) return;
    }
    const tokens=collectEditTokens();
    const locked=editedReadingLocks(tokens);
    const instruction=editInstruction.value.trim();
    const changed=source!==editState.originalSource || locked.length>0 || !!instruction;
    if(!changed){ editItemDlg.close(); return; }
    setEditStatus("Gemini가 확정 원문·요미가나를 기준으로 해석과 설명을 다시 만드는 중…");
    await api(`/api/items/${encodeURIComponent(id)}/revise`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({source_text:source,source_furigana_json:tokens,locked_readings:locked,instruction})
    });
    editItemDlg.close();
    editState=null;
    await loadDetail(currentSession.id);
  }catch(e){
    setEditStatus(`수정 실패: ${e.message||e}`,true);
  }finally{
    editItemSave.disabled=false;
    editReanalyzeSource.disabled=false;
    editItemSave.textContent=oldLabel;
  }
}

function groupKey(item){
  if(item.context_group_id) return `ctx:${item.context_group_id}`;
  if(item.source_image_id||item.source_text) return `legacy:${item.source_image_id||""}|${item.source_text||""}`;
  return "";
}

function linkedExtraIds(ids){
  const selected=new Set(ids);
  const extras=new Set();
  for(const id of selected){
    const item=currentItems.find(v=>v.id===id);
    if(!item) continue;
    const key=groupKey(item);
    if(!key) continue;
    for(const other of currentItems){
      if(other.id===item.id||selected.has(other.id)) continue;
      if(other.item_type===item.item_type) continue;
      if(groupKey(other)===key) extras.add(other.id);
    }
  }
  return [...extras];
}

function askLinked(action,count){
  if(!count) return Promise.resolve("only");
  choiceTitle.textContent=action==="move"?"연결 항목 이동":"연결 항목 삭제";
  choiceMessage.textContent=`선택하지 않은 연결 문장·단어가 ${count}개 있습니다. 함께 ${action==="move"?"이동":"삭제"}할까요?`;
  choiceOnly.textContent="선택한 항목만";
  choiceTogether.textContent="연결 항목도 함께";
  return new Promise(resolve=>{
    let done=false;
    const finish=v=>{
      if(done) return;
      done=true;
      cleanup();
      if(choiceDlg.open) choiceDlg.close();
      resolve(v);
    };
    const onCancel=()=>finish("cancel");
    const onOnly=()=>finish("only");
    const onTogether=()=>finish("together");
    const onClose=()=>finish("cancel");
    const cleanup=()=>{
      choiceCancel.removeEventListener("click",onCancel);
      choiceOnly.removeEventListener("click",onOnly);
      choiceTogether.removeEventListener("click",onTogether);
      choiceDlg.removeEventListener("close",onClose);
    };
    choiceCancel.addEventListener("click",onCancel);
    choiceOnly.addEventListener("click",onOnly);
    choiceTogether.addEventListener("click",onTogether);
    choiceDlg.addEventListener("close",onClose,{once:true});
    choiceDlg.showModal();
  });
}

async function resolveLinkedSelection(ids,action){
  const base=[...new Set(ids)].filter(Boolean);
  const extras=linkedExtraIds(base);
  if(!extras.length) return base;
  const choice=await askLinked(action,extras.length);
  if(choice==="cancel") return null;
  return choice==="together" ? [...new Set([...base,...extras])] : base;
}

async function moveItems(ids){
  ids=await resolveLinkedSelection(ids,"move");
  if(!ids||!ids.length) return;
  const spec=await openSessionDialog({title:`${ids.length}개 항목 이동`,excludeIds:[currentSession?.id].filter(Boolean)});
  if(!spec) return;
  await api("/api/items/batch-move",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({item_ids:ids,...spec})
  });
  await loadDetail(currentSession.id);
}

async function deleteItems(ids){
  ids=await resolveLinkedSelection(ids,"delete");
  if(!ids||!ids.length) return;
  if(!confirm(`${ids.length}개 항목을 삭제합니다. 이 작업은 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
  await api("/api/items/batch-delete",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({item_ids:ids})
  });
  await loadDetail(currentSession.id);
}

function visibleItemIds(){
  return [...document.querySelectorAll(".item-row")].filter(row=>!row.hidden).map(row=>row.dataset.itemId);
}

function setSelectionMode(on){
  selectionMode=Boolean(on);
  if(!selectionMode) selectedIds.clear();
  document.getElementById("itemList")?.classList.toggle("selection-mode",selectionMode);
  const btn=document.getElementById("selectionToggle");
  if(btn) btn.textContent=selectionMode?"선택 종료":"선택";
  document.querySelectorAll(".item-detail").forEach(d=>{if(selectionMode)d.hidden=true;});
  document.querySelectorAll(".item-row").forEach(r=>r.classList.toggle("expanded",false));
  updateSelectionUi();
}

function toggleSelected(id){
  if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  updateSelectionUi();
}

function updateSelectionUi(){
  document.querySelectorAll(".item-row").forEach(row=>{
    const on=selectedIds.has(row.dataset.itemId);
    row.classList.toggle("selected",on);
    row.querySelector(".select-mark")?.setAttribute("aria-pressed",String(on));
  });
  updateBulkBar();
}

function updateBulkBar(){
  bulkBar.hidden=!selectionMode;
  bulkCount.textContent=`${selectedIds.size}개 선택`;
  bulkMove.disabled=selectedIds.size===0;
  bulkDelete.disabled=selectedIds.size===0;
  const visible=visibleItemIds();
  const allVisible=visible.length>0&&visible.every(id=>selectedIds.has(id));
  bulkSelectAll.textContent=allVisible?"전체 해제":"전체 선택";
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
    if(id) await loadDetail(id); else await loadOverview();
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
    if(sessionAct.dataset.sessionAct==="export") await exportApkg(id,title);
    if(sessionAct.dataset.sessionAct==="edit") await editSessionFlow(sessionsCache.find(s=>s.id===id)||{id,title});
    if(sessionAct.dataset.sessionAct==="delete") await removeSession(id,false);
    return;
  }

  const selectBtn=e.target.closest("[data-select-item]");
  if(selectBtn){ e.stopPropagation(); toggleSelected(selectBtn.dataset.selectItem); return; }

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
    if(itemAct.dataset.itemAct==="edit") await editItemFlow(currentItems.find(v=>v.id===row.dataset.itemId));
    if(itemAct.dataset.itemAct==="delete") await deleteItems([row.dataset.itemId]);
    if(itemAct.dataset.itemAct==="move") await moveItems([row.dataset.itemId]);
    return;
  }

  const openMedia=e.target.closest("[data-open-media]");
  if(openMedia){ e.stopPropagation(); await showImage(openMedia.dataset.openMedia,openMedia.dataset.bbox||""); return; }

  const sourceToken=e.target.closest(".source-token");
  if(sourceToken){ e.stopPropagation(); await showWordInfo(sourceToken.dataset.token||""); return; }

  const summary=e.target.closest(".item-summary");
  if(summary){
    const row=summary.closest(".item-row");
    if(selectionMode){ toggleSelected(row.dataset.itemId); return; }
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
    e.preventDefault(); e.target.click();
  }
});

document.addEventListener("click",e=>{ if(!e.target.closest(".more-wrap")) closeMenus(); });
imageModalClose.addEventListener("click",closeImageModal);
imageModal.addEventListener("click",e=>{if(e.target===imageModal) closeImageModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&imageModal.open) closeImageModal();});
wordInfoClose?.addEventListener("click",()=>wordInfoDlg.close());
editItemCancel?.addEventListener("click",()=>{editItemDlg.close();editState=null;});
editItemSave?.addEventListener("click",saveEditedItem);
editReanalyzeSource?.addEventListener("click",reanalyzeEditSource);
editSourceText?.addEventListener("input",updateEditSourceHint);

bulkSelectAll.addEventListener("click",()=>{
  const ids=visibleItemIds();
  const all=ids.length&&ids.every(id=>selectedIds.has(id));
  for(const id of ids){ if(all) selectedIds.delete(id); else selectedIds.add(id); }
  updateSelectionUi();
});
bulkMove.addEventListener("click",()=>moveItems([...selectedIds]));
bulkDelete.addEventListener("click",()=>deleteItems([...selectedIds]));
bulkCancel.addEventListener("click",()=>setSelectionMode(false));

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
refreshUsageFooter();
loadCurrent();
