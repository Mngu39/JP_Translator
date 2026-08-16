const KANJI_RE=/[\u3400-\u9fff\uf900-\ufaff]/;
let dataPromise=null;
let koPromise=null;

const kataToHira=s=>String(s||"").replace(/[\u30a1-\u30f6]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));
const hiraToKata=s=>String(s||"").replace(/[\u3041-\u3096]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));
const isKanji=ch=>KANJI_RE.test(String(ch||""));

function jsonUrl(name){ return new URL(`../text/${name}`, import.meta.url).href; }

export async function loadUsageData(){
  if(!dataPromise) dataPromise=fetch(jsonUrl("jmdict_usage.min.json"),{cache:"no-store"}).then(r=>r.ok?r.json():({_meta:{},readings:{},examples:{}})).catch(()=>({_meta:{},readings:{},examples:{}}));
  return dataPromise;
}
export async function loadKoKanji(){
  if(!koPromise) koPromise=fetch(jsonUrl("kanji_ko_attr_irreg.min.json"),{cache:"no-store"}).then(r=>r.ok?r.json():{}).catch(()=>({}));
  return koPromise;
}

const RENDAKU={
  "か":["が"],"き":["ぎ"],"く":["ぐ"],"け":["げ"],"こ":["ご"],
  "さ":["ざ"],"し":["じ"],"す":["ず"],"せ":["ぜ"],"そ":["ぞ"],
  "た":["だ"],"ち":["ぢ"],"つ":["づ"],"て":["で"],"と":["ど"],
  "は":["ば","ぱ"],"ひ":["び","ぴ"],"ふ":["ぶ","ぷ"],"へ":["べ","ぺ"],"ほ":["ぼ","ぽ"]
};
function variants(r){
  r=kataToHira(r); const out=[[r,0]], seen=new Set([r]);
  const add=(v,p)=>{if(v&&!seen.has(v)){seen.add(v);out.push([v,p]);}};
  for(const f of RENDAKU[r[0]]||[]) add(f+r.slice(1),1);
  if(r.length>=2 && "つちく".includes(r.at(-1))){
    const v=r.slice(0,-1)+"っ"; add(v,1);
    for(const f of RENDAKU[v[0]]||[]) add(f+v.slice(1),2);
  }
  return out;
}

function alignWord(surface,reading,usage){
  const chars=[...String(surface||"")]; const rd=kataToHira(reading).replace(/\s/g,"");
  const memo=new Map();
  const rec=(i,j)=>{
    const key=`${i}|${j}`; if(memo.has(key)) return memo.get(key);
    if(i===chars.length){ const z=j===rd.length?{score:0,path:[]}:null; memo.set(key,z); return z; }
    const ch=chars[i], base=ch==="々"&&i>0?chars[i-1]:ch;
    let best=null;
    if(isKanji(base)){
      for(const [r,type] of usage?.readings?.[base]||[]){
        for(const [seg,penalty] of variants(r)){
          if(!rd.startsWith(seg,j)) continue;
          const tail=rec(i+1,j+seg.length); if(!tail) continue;
          const cand={score:penalty+tail.score,path:[{index:i,char:ch,reading:seg,type},...tail.path]};
          if(!best||cand.score<best.score) best=cand;
        }
      }
    }else{
      const lit=kataToHira(ch);
      if(lit&&rd.startsWith(lit,j)) best=rec(i+1,j+lit.length);
    }
    memo.set(key,best); return best;
  };
  return rec(0,0)?.path||null;
}

function koMeaning(rec){ return String(rec?.["훈음"] || [rec?.["훈"],rec?.["음"]].filter(Boolean).join(" ") || "").trim(); }

export async function buildKanjiUsage(surface,reading,{maxExamples=3}={}){
  surface=String(surface||""); reading=kataToHira(reading||"");
  const chars=[...surface].filter(isKanji);
  if(!chars.length) return [];
  const [usage,ko]=await Promise.all([loadUsageData(),loadKoKanji()]);
  if(!usage?.readings || !Object.keys(usage.readings).length){
    return [...new Set(chars)].map(ch=>({char:ch,meaning_ko:koMeaning(ko?.[ch]),unavailable:true}));
  }
  const path=reading?alignWord(surface,reading,usage):null;
  if(!path){
    return [...new Set(chars)].map(ch=>({char:ch,meaning_ko:koMeaning(ko?.[ch]),special:true,word:surface,word_reading:reading}));
  }
  const out=[];
  for(const part of path){
    const ch=part.char==="々" ? surface[Math.max(0,part.index-1)] : part.char;
    if(!isKanji(ch)) continue;
    const key=`${ch}|${part.reading}`;
    const examples=(usage?.examples?.[key]||[]).filter(x=>String(x?.[0]||"")!==surface).slice(0,maxExamples).map(x=>({word:String(x?.[0]||""),reading:String(x?.[1]||"")}));
    out.push({
      char:ch,
      meaning_ko:koMeaning(ko?.[ch]),
      used_reading:part.reading,
      reading_type:part.type||"",
      display_reading:part.type==="on"?hiraToKata(part.reading):part.reading,
      examples
    });
  }
  return out;
}

export async function enrichSourceTokens(raw){
  let arr=[]; try{arr=typeof raw==="string"?JSON.parse(raw||"[]"):(raw||[]);}catch{}
  if(!Array.isArray(arr)) return [];
  return Promise.all(arr.map(async t=>({
    ...t,
    kanji:await buildKanjiUsage(String(t?.surface||""),String(t?.reading||""))
  })));
}

export function formatUsageText(arr){
  if(!Array.isArray(arr)) return "";
  return arr.map(k=>{
    if(k.unavailable) return `${k.char} ${k.meaning_ko||"정보 없음"}`;
    if(k.special) return `${k.char} ${k.meaning_ko||"정보 없음"} · ${k.word_reading||""} (특수 읽기)`;
    const typ=k.reading_type==="on"?"音":k.reading_type==="kun"?"訓":"";
    const ex=(k.examples||[]).map(v=>`${v.word}（${v.reading}）`).join(" · ");
    return `${k.char} ${k.meaning_ko||"정보 없음"} · ${k.display_reading||k.used_reading||""}${typ?`〔${typ}〕`:""}${ex?` · 예: ${ex}`:""}`;
  }).join("\n");
}
