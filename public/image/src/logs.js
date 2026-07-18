import { getLogWorkerBase, setLogWorkerBase, getAppToken, setAppToken, recentSessions, ensureLogConfig } from "./log.js";

const workerBase = document.getElementById("workerBase");
const saveBase = document.getElementById("saveBase");
const setToken = document.getElementById("setToken");
const refresh = document.getElementById("refresh");
const list = document.getElementById("list");
const exportJson = document.getElementById("exportJson");
const exportTsv = document.getElementById("exportTsv");

function esc(s){ return String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function authUrl(path){
  // 다운로드 링크는 header를 붙일 수 없으므로 token을 query로 넘긴다.
  // 개인용 관리페이지 기준. URL 공유 금지.
  const base = getLogWorkerBase();
  const tok = encodeURIComponent(getAppToken() || "");
  return `${base}${path}?token=${tok}`;
}

async function api(path, opts={}){
  const {base, token} = await ensureLogConfig();
  const r = await fetch(`${base}${path}`, { ...opts, headers:{"x-app-token":token, ...(opts.headers||{})} });
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

async function load(){
  workerBase.value = getLogWorkerBase();
  exportJson.href = authUrl("/api/export/json");
  exportTsv.href = authUrl("/api/export/anki.tsv") + "&ai=1";
  list.textContent = "불러오는 중…";
  try{
    const out = await recentSessions();
    const sessions = out.sessions || [];
    if(!sessions.length){ list.textContent = "저장된 세션이 없습니다."; return; }
    list.innerHTML = sessions.map(s=>`
      <section class="card" data-id="${esc(s.id)}">
        <h3>${esc(s.title || s.session_key || s.id)}</h3>
        <div class="meta">${esc(s.canonical_url || s.raw_url || "")}</div>
        <div class="meta">last_used: ${esc(s.last_used_at || "")} / key: ${esc(s.session_key || "")}</div>
        <div class="actions">
          <button class="btn danger" data-act="delete">세션 삭제</button>
        </div>
      </section>`).join("");
  }catch(e){
    console.error(e);
    list.textContent = `오류: ${e.message || e}`;
  }
}

saveBase.addEventListener("click",()=>{ setLogWorkerBase(workerBase.value.trim()); load(); });
setToken.addEventListener("click",()=>{
  const tok = prompt("APP_TOKEN 입력", getAppToken() || "");
  if(tok) setAppToken(tok.trim());
  load();
});
refresh.addEventListener("click", load);
list.addEventListener("click", async ev=>{
  const btn = ev.target.closest("button[data-act]");
  if(!btn) return;
  const card = ev.target.closest(".card");
  const id = card?.dataset.id;
  if(!id) return;
  if(btn.dataset.act === "delete"){
    if(!confirm("이 세션과 연결된 저장 항목/이미지를 서버에서 삭제할까요? PC로 옮기기 전이면 복구하기 어렵습니다.")) return;
    await api(`/api/sessions/${encodeURIComponent(id)}`, {method:"DELETE"});
    await load();
  }
});

load();
