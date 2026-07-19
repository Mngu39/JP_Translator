import { createStoredZip } from "./zip-store.js";

const DB_SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null,
  csum integer not null, flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null,
  due integer not null, ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null, odid integer not null,
  flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
  type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const SENTENCE_MODEL_ID = 1740000000101;
const WORD_MODEL_ID = 1740000000102;
const DEFAULT_DECK_ID = 1740000000201;

const CARD_CSS = `
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 18px;
  text-align: left;
  color: #202124;
  background: #fff;
  line-height: 1.55;
  max-width: 760px;
  margin: 0 auto;
}
.jp-main { font-size: 27px; font-weight: 650; line-height: 1.8; }
ruby { ruby-position: over; }
rt { font-size: .5em; color: #666; font-weight: 500; }
.jp-word { font-size: 34px; font-weight: 750; }
.reading { color: #5f6368; font-size: 19px; margin-top: 2px; }
.translation { font-size: 21px; font-weight: 650; margin: 12px 0; }
.explanation, .kanji-info { margin-top: 12px; padding: 11px 13px; background: #f4f6f8; border-radius: 10px; }
.example { margin-top: 14px; font-size: 20px; }
.target { color: #c62828; font-weight: 750; }
.shot img { display: block; max-width: 100%; max-height: 520px; object-fit: contain; margin: 14px auto; border-radius: 10px; }
.source { margin-top: 13px; font-size: 12px; color: #777; overflow-wrap: anywhere; }
.source a { color: #5577aa; text-decoration: none; }
.label { color: #777; font-size: 12px; font-weight: 650; letter-spacing: .03em; text-transform: uppercase; }
hr { border: 0; border-top: 1px solid #ddd; margin: 18px 0; }
.nightMode .card { color: #eee; background: #222; }
.nightMode .explanation, .nightMode .kanji-info { background: #303238; }
.nightMode .source { color: #aaa; }
`;

const SENTENCE_FIELDS = ["ID","Source","Translation","Explanation","Image","SourceTitle","SourceURL","SavedAt"];
const WORD_FIELDS = ["ID","Word","Reading","Meaning","Explanation","Example","ExampleTranslation","Kanji","Image","SourceTitle","SourceURL","SavedAt"];

const SENTENCE_TEMPLATE = {
  name:"Sentence Card",
  qfmt:`<div class="jp-main" lang="ja">{{Source}}</div>{{Image}}<div class="source">{{SourceTitle}}</div>`,
  afmt:`{{FrontSide}}<hr id="answer"><div class="translation">{{Translation}}</div>{{#Explanation}}<div class="explanation">{{Explanation}}</div>{{/Explanation}}<div class="source">{{#SourceURL}}<a href="{{SourceURL}}">{{SourceTitle}}</a>{{/SourceURL}}{{^SourceURL}}{{SourceTitle}}{{/SourceURL}}<br>{{SavedAt}}</div>`
};

const WORD_TEMPLATE = {
  name:"Word Card",
  qfmt:`<div class="jp-word" lang="ja">{{Word}}</div><div class="example" lang="ja">{{Example}}</div>{{Image}}<div class="source">{{SourceTitle}}</div>`,
  afmt:`<div class="jp-word" lang="ja">{{Word}}</div>{{#Reading}}<div class="reading" lang="ja">{{Reading}}</div>{{/Reading}}<div class="translation">{{Meaning}}</div>{{#Explanation}}<div class="explanation">{{Explanation}}</div>{{/Explanation}}<hr><div class="label">Example</div><div class="example" lang="ja">{{Example}}</div><div>{{ExampleTranslation}}</div>{{#Kanji}}<div class="kanji-info">{{Kanji}}</div>{{/Kanji}}{{Image}}<div class="source">{{#SourceURL}}<a href="{{SourceURL}}">{{SourceTitle}}</a>{{/SourceURL}}{{^SourceURL}}{{SourceTitle}}{{/SourceURL}}<br>{{SavedAt}}</div>`
};

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}


function hasKanji(s){ return /[\u3400-\u9fff]/.test(String(s||"")); }

function sentenceHtml(item){
  let tokens=[];
  try{ tokens=JSON.parse(item.source_furigana_json || "[]"); }catch{}
  if(!Array.isArray(tokens) || !tokens.length) return esc(item.source_text || "");
  return tokens.map(t=>{
    const surface=String(t?.surface||"");
    const reading=String(t?.reading||"");
    return hasKanji(surface) && reading
      ? `<ruby lang="ja">${esc(surface)}<rt>${esc(reading)}</rt></ruby>`
      : esc(surface);
  }).join("");
}

function safeUrl(s){
  const raw=String(s||"").trim();
  if(!raw) return "";
  try{
    const u=new URL(raw);
    return /^https?:$/.test(u.protocol) ? esc(u.toString()) : "";
  }catch{ return ""; }
}

function stableHash(text){
  let h=2166136261;
  for(const ch of String(text||"")){
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deckIdFor(data){
  const sessions=data?.sessions || [];
  if(sessions.length === 1){
    return 1000000000 + (stableHash(sessions[0].id) % 900000000);
  }
  return DEFAULT_DECK_ID;
}

function deckNameFor(data){
  const sessions=data?.sessions || [];
  if(sessions.length === 1){
    const title=String(sessions[0].title || "Session").replace(/::/g,"：").trim().slice(0,80);
    return `JP Translator::${title || "Session"}`;
  }
  return "JP Translator";
}

function fieldDefs(names){
  return names.map((name,ord)=>({name, ord, sticky:false, rtl:false, font:"Arial", size:20, media:[]}));
}

function templateDef(template, deckId){
  return [{...template, ord:0, bqfmt:"", bafmt:"", did:null, bfont:"", bsize:0}];
}

function modelJson(id, name, fields, template, deckId, nowSec, requiredFieldOrd){
  return {
    css:CARD_CSS,
    did:deckId,
    flds:fieldDefs(fields),
    id:String(id),
    latexPost:"\\end{document}",
    latexPre:"\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\begin{document}\n",
    latexsvg:false,
    mod:nowSec,
    name,
    req:[[0,"all",[requiredFieldOrd]]],
    sortf:requiredFieldOrd,
    tags:[],
    tmpls:templateDef(template, deckId),
    type:0,
    usn:-1,
    vers:[]
  };
}

function deckJson(id, name, nowSec){
  return {
    collapsed:false, conf:1, desc:"JP Translator에서 생성한 일본어 학습 카드",
    dyn:0, extendNew:10, extendRev:50, id,
    lrnToday:[0,0], mod:nowSec, name,
    newToday:[0,0], revToday:[0,0], timeToday:[0,0], usn:-1
  };
}

function defaultDconf(){
  return {
    "1":{
      autoplay:true, id:1,
      lapse:{delays:[10],leechAction:0,leechFails:8,minInt:1,mult:0},
      maxTaken:60, mod:0, name:"Default",
      new:{bury:true,delays:[1,10],initialFactor:2500,ints:[1,4,7],order:1,perDay:20,separate:true},
      replayq:true,
      rev:{bury:true,ease4:1.3,fuzz:0.05,ivlFct:1,maxIvl:36500,minSpace:1,perDay:100},
      timer:0, usn:0
    }
  };
}

function highlightExample(item){
  const source=String(item.source_text || "");
  const start=Number(item.target_start_index);
  const end=Number(item.target_end_index);
  if(Number.isFinite(start) && Number.isFinite(end) && start>=0 && end>start && end<=source.length){
    return `${esc(source.slice(0,start))}<span class="target">${esc(source.slice(start,end))}</span>${esc(source.slice(end))}`;
  }
  const target=String(item.target_surface || item.target_word || "");
  const idx=target ? source.indexOf(target) : -1;
  if(idx>=0){
    return `${esc(source.slice(0,idx))}<span class="target">${esc(target)}</span>${esc(source.slice(idx+target.length))}`;
  }
  return esc(source);
}

function kanjiHtml(raw){
  let arr=[];
  try{ arr=JSON.parse(raw || "[]"); }catch{}
  if(!Array.isArray(arr) || !arr.length) return "";
  return arr.map(k=>`${esc(k.char||"")} — 音: ${esc(k.onyomi||"")} / 訓: ${esc(k.kunyomi||"")} / 뜻: ${esc(k.meaning_ko||"")}`).join("<br>");
}

function imageHtml(item){
  return item.media_filename ? `<div class="shot"><img src="${esc(item.media_filename)}"></div>` : "";
}

function noteFields(item){
  const title=esc(item.session_title || "");
  const url=safeUrl(item.session_canonical_url || item.session_link || "");
  const saved=esc(item.created_at || "");
  const image=imageHtml(item);
  if(item.item_type === "kanji_box"){
    return {
      modelId:WORD_MODEL_ID,
      tags:" jp-translator word-box ",
      sort:String(item.target_word || item.target_surface || item.source_text || ""),
      fields:[
        esc(item.id),
        esc(item.target_word || item.target_surface || ""),
        esc(item.target_word_reading || ""),
        esc(item.word_translation || ""),
        esc(item.word_explanation || ""),
        highlightExample(item),
        esc(item.source_translation || item.ui_translation || ""),
        kanjiHtml(item.kanji_json),
        image,
        title,
        url,
        saved
      ]
    };
  }
  return {
    modelId:SENTENCE_MODEL_ID,
    tags:" jp-translator sentence-box ",
    sort:String(item.source_text || ""),
    fields:[
      esc(item.id),
      sentenceHtml(item),
      esc(item.source_translation || item.ui_translation || ""),
      esc(item.word_explanation || ""),
      image,
      title,
      url,
      saved
    ]
  };
}

function collectionConfig(deckId){
  return {
    activeDecks:[deckId], addToCur:true, collapseTime:1200, curDeck:deckId,
    curModel:String(SENTENCE_MODEL_ID), dueCounts:true, estTimes:true,
    newBury:true, newSpread:0, nextPos:1, sortBackwards:false,
    sortType:"noteFld", timeLim:0
  };
}

let sqlPromise=null;
async function getSqlJs(){
  if(sqlPromise) return sqlPromise;
  sqlPromise=(async()=>{
    if(!globalThis.initSqlJs){
      const src=new URL("../vendor/sql-wasm.js", import.meta.url).href;
      await new Promise((resolve,reject)=>{
        const script=document.createElement("script");
        script.src=src;
        script.async=true;
        script.onload=resolve;
        script.onerror=()=>reject(new Error("sql.js 로딩 실패"));
        document.head.appendChild(script);
      });
    }
    return globalThis.initSqlJs({ locateFile:()=>new URL("../vendor/sql-wasm.wasm", import.meta.url).href });
  })();
  return sqlPromise;
}

export async function createAnkiApkg(data, {fetchMedia, onProgress=()=>{}}={}){
  const items=(data?.items || []).filter(it=>it.anki_status !== "excluded");
  if(!items.length) throw new Error("내보낼 카드가 없습니다.");
  if(typeof fetchMedia !== "function") throw new Error("미디어 다운로드 함수가 없습니다.");

  onProgress("Anki 데이터베이스 준비 중…");
  const SQL=await getSqlJs();
  const db=new SQL.Database();
  db.run(DB_SCHEMA);

  const nowMs=Date.now();
  const nowSec=Math.floor(nowMs/1000);
  const deckId=deckIdFor(data);
  const deckName=deckNameFor(data);
  const models={
    [String(SENTENCE_MODEL_ID)]:modelJson(SENTENCE_MODEL_ID,"JP Sentence Context",SENTENCE_FIELDS,SENTENCE_TEMPLATE,deckId,nowSec,1),
    [String(WORD_MODEL_ID)]:modelJson(WORD_MODEL_ID,"JP Word Context",WORD_FIELDS,WORD_TEMPLATE,deckId,nowSec,1)
  };
  const decks={"1":deckJson(1,"Default",nowSec),[String(deckId)]:deckJson(deckId,deckName,nowSec)};

  db.run(
    "INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [1,nowSec,nowMs,nowMs,11,0,0,0,JSON.stringify(collectionConfig(deckId)),JSON.stringify(models),JSON.stringify(decks),JSON.stringify(defaultDconf()),"{}"]
  );

  const noteStmt=db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const cardStmt=db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const baseId=nowMs;
  let due=1;
  for(let i=0;i<items.length;i++){
    const item=items[i];
    const note=noteFields(item);
    const noteId=baseId+i;
    const cardId=baseId+100000+i;
    const flds=note.fields.join("\x1f");
    const guid=`jp-${String(item.id).replace(/[^A-Za-z0-9_-]/g,"")}`;
    noteStmt.run([noteId,guid,note.modelId,nowSec,-1,note.tags,flds,note.sort,0,0,""]);
    cardStmt.run([cardId,noteId,deckId,0,nowSec,-1,0,0,due++,0,0,0,0,0,0,0,0,""]);
  }
  noteStmt.free();
  cardStmt.free();

  const collectionBytes=db.export();
  db.close();

  const uniqueMedia=new Map();
  for(const item of items){
    if(item.media_id && item.media_filename && !uniqueMedia.has(item.media_id)){
      uniqueMedia.set(item.media_id,item.media_filename);
    }
  }

  const mediaMap={};
  const entries=[{name:"collection.anki2",data:collectionBytes}];
  let index=0;
  for(const [mediaId,filename] of uniqueMedia){
    onProgress(`이미지 내려받는 중… ${index+1}/${uniqueMedia.size}`);
    const blob=await fetchMedia(mediaId);
    mediaMap[String(index)]=filename;
    entries.push({name:String(index),data:blob});
    index+=1;
  }
  entries.splice(1,0,{name:"media",data:JSON.stringify(mediaMap)});

  onProgress("APKG 파일 만드는 중…");
  const blob=await createStoredZip(entries);
  return {blob,cardCount:items.length,mediaCount:uniqueMedia.size,deckName};
}
