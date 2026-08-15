import fs from 'fs';

const FILE='data/state.json';
const BASE='https://pc28.help';
const C=['大单','大双','小单','小双'];
const SOURCE_TIMEOUT=5500;

const SOURCES=[
  {
    id:'pc28668',name:'PC28预测网',url:'https://www.pc28668.com/',baseWeight:1.00,type:'组合型',
    parse(html){
      const rows=[...html.matchAll(/(\d{7})[\s\S]{0,140}?([大小])\s*([单双])/g)];
      if(!rows.length)return null;
      const m=rows[0];
      return {issue:m[1],signal:{kind:'combo',size:m[2],oe:m[3]},raw:`${m[2]}${m[3]}`};
    }
  },
  {
    id:'canada28org',name:'Canada28.org',url:'https://kj.canada28.org/jndpc28jk/index.php?i=5&type=10',baseWeight:.82,type:'排除型',
    parse(html){
      const clean=html.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
      const m=clean.match(/(\d{7})[\s\S]{0,120}?(杀中|杀小边|杀大边)/);
      if(!m)return null;
      return {issue:m[1],signal:{kind:'excludeBand',value:m[2]},raw:m[2]};
    }
  },
  {
    id:'pc28ai',name:'PC28.AI',url:'https://www.pc28.ai/',baseWeight:.72,type:'动态AI',
    parse(html){
      const clean=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
      const issue=(clean.match(/第\s*(\d{7})\s*期/)||[])[1];
      const num=(clean.match(/预测号码\s*[:：]?\s*(\d{1,2})/)||[])[1];
      const combo=clean.match(/(?:算法1|智能预测|AI预测|预测)[\s\S]{0,260}?([大小])[\s\S]{0,80}?([单双])/);
      if(issue && num!=null)return {issue,signal:{kind:'sum',sum:Number(num)},raw:`和值${num}`};
      if(issue && combo)return {issue,signal:{kind:'combo',size:combo[1],oe:combo[2]},raw:`${combo[1]}${combo[2]}`};
      return null;
    }
  },
  {
    id:'jnd28yc',name:'JND28 AI分析',url:'https://www.jnd28-yc.com/',baseWeight:.68,type:'动态AI',
    parse(html){
      const clean=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
      const issue=(clean.match(/(?:期号|第)\s*[:：]?\s*(\d{7})/)||[])[1];
      const sum=(clean.match(/(?:预测和值|AI和值|预测号码)\s*[:：]?\s*(\d{1,2})/)||[])[1];
      const combo=clean.match(/(?:AI单项预测|AI预测|预测)[\s\S]{0,220}?([大小])[\s\S]{0,70}?([单双])/);
      if(issue && sum!=null)return {issue,signal:{kind:'sum',sum:Number(sum)},raw:`和值${sum}`};
      if(issue && combo)return {issue,signal:{kind:'combo',size:combo[1],oe:combo[2]},raw:`${combo[1]}${combo[2]}`};
      return null;
    }
  }
];

const cls=n=>(n<=13?'小':'大')+(n%2?'单':'双');
const classify=n=>({size:n<=13?'小':'大',oe:n%2?'单':'双',combo:cls(n)});
const val=(o,ks)=>{for(const k of ks)if(o?.[k]!=null&&o[k]!=='')return o[k]};

async function fetchTimeout(url, ms=SOURCE_TIMEOUT){
  const c=new AbortController(), t=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 jnd28-v3-updater','accept':'*/*'},signal:c.signal,redirect:'follow'});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    return r;
  }finally{clearTimeout(t)}
}
async function api(path){
  const r=await fetchTimeout(BASE+path,8000);
  return r.json();
}
function kenoPc(s){
  const a=Array.isArray(s)?s:String(s||'').split(/[,\s]+/).filter(Boolean).map(Number);
  if(a.length<19)return null;
  const g=idx=>idx.reduce((t,i)=>t+(Number(a[i])||0),0)%10;
  return g([1,4,7,10,13,16])+g([2,5,8,11,14,17])+g([3,6,9,12,15,18]);
}
async function rows(){
  try{
    const j=await api('/api/kj.json?nbr=100');
    const a=Array.isArray(j)?j:Array.isArray(j?.data)?j.data:Array.isArray(j?.data?.list)?j.data.list:[];
    const r=a.map(o=>{
      const issue=val(o,['nbr','issue','period','expect','qihao','no']);
      const raw=val(o,['number','sum','result','total','value']);
      const n=Number(Array.isArray(raw)?raw.reduce((x,y)=>x+Number(y),0):raw);
      return {issue:issue==null?'':String(issue),sum:n,...classify(n)};
    }).filter(x=>x.issue&&Number.isFinite(x.sum));
    if(r.length)return {source:'kj',rows:r};
  }catch(e){console.log('kj fallback',e.message)}

  const j=await api('/api/keno.json?nbr=100');
  const a=Array.isArray(j)?j:Array.isArray(j?.data)?j.data:[];
  const r=a.map(o=>{
    const n=kenoPc(val(o,['nbrs','numbers','result']));
    const issue=val(o,['nbr','issue','period','expect','qihao','no']);
    return {issue:issue==null?'':String(issue),sum:n,...classify(n)};
  }).filter(x=>x.issue&&Number.isFinite(x.sum));
  if(!r.length)throw Error('开奖接口无法解析');
  return {source:'keno',rows:r};
}
function autoReference(rs){
  const recent=rs.slice(0,30), score=Object.fromEntries(C.map(c=>[c,1.2])), why=[];
  recent.forEach((r,i)=>{score[r.combo]+=1.1*(1-i/Math.max(30,recent.length+1))});
  const last8=recent.slice(0,8),cnt=Object.fromEntries(C.map(c=>[c,0]));
  last8.forEach(r=>cnt[r.combo]++);
  if(last8.length>=4){
    const mn=Math.min(...Object.values(cnt));
    C.forEach(c=>{if(cnt[c]===mn)score[c]+=.9});
    why.push('近8期回补');
  }
  if(recent.length){
    const last=recent[0].combo, opp={'大双':'小单','小单':'大双','大单':'小双','小双':'大单'}[last];
    let streak=0;for(const r of recent){if(r.combo===last)streak++;else break}
    if(streak>=2){score[opp]+=Math.min(2.4,streak*.6);score[last]-=Math.min(1,streak*.2);why.push(`${last}连开${streak}期修正`)}
  }
  const last10=recent.slice(0,10);
  if(last10.length>=6){
    const big=last10.filter(r=>r.size==='大').length, odd=last10.filter(r=>r.oe==='单').length;
    if(big>=7){score['小单']+=.65;score['小双']+=.65;why.push('近期偏大')}
    else if(big<=3){score['大单']+=.65;score['大双']+=.65;why.push('近期偏小')}
    if(odd>=7){score['大双']+=.5;score['小双']+=.5}
    else if(odd<=3){score['大单']+=.5;score['小单']+=.5}
  }
  const rank=Object.entries(score).sort((a,b)=>b[1]-a[1]), total=rank.reduce((s,[,v])=>s+Math.max(v,.1),0);
  return {
    picks:rank.slice(0,2).map(([name,v],i)=>({name,confidence:Math.max(45,Math.min(72,Math.round(43+Math.max(v,.1)/total*58-i*2)))})),
    reason:why.slice(0,3).join('；')||'根据近期历史频率自动生成'
  };
}
function freshness(predIssue,targetIssue,base){
  const p=Number(predIssue),t=Number(targetIssue);
  if(!p||!t)return {weight:0,state:'失败',label:'无期号'};
  const d=p-t;
  if(d===0)return {weight:base,state:'同步',label:'同步'};
  if(d===-1)return {weight:base*.38,state:'降权',label:'慢1期'};
  if(d===1)return {weight:base*.62,state:'降权',label:'快1期'};
  return {weight:0,state:'剔除',label:`差${d>0?'+':''}${d}期`};
}
function baseDistribution(){
  const ways=Array(28).fill(0);
  for(let a=0;a<10;a++)for(let b=0;b<10;b++)for(let c=0;c<10;c++)ways[a+b+c]++;
  const mx=Math.max(...ways);return ways.map(x=>x/mx*.28);
}
function localScores(rs){
  const s=Array(28).fill(0),freq=Array(28).fill(0),gap=Array(28).fill(30),recent=rs.slice(0,30);
  recent.forEach((r,i)=>{freq[r.sum]++;if(gap[r.sum]===30)gap[r.sum]=i});
  for(let n=0;n<28;n++)s[n]=freq[n]*.08+Math.min(gap[n],15)*.018;
  return s;
}
function applySignal(score,signal,w){
  if(!signal||w<=0)return;
  if(signal.kind==='sum'){
    for(let n=0;n<28;n++){const d=Math.abs(n-signal.sum);score[n]+=w*(d===0?2.8:d===1?.65:d===2?.22:0)}
  }else if(signal.kind==='combo'){
    for(let n=0;n<28;n++){const c=classify(n);if(c.size===signal.size)score[n]+=w*.72;if(c.oe===signal.oe)score[n]+=w*.62;if(c.size===signal.size&&c.oe===signal.oe)score[n]+=w*.88}
  }else if(signal.kind==='excludeBand'){
    let ex=[];if(signal.value==='杀中')ex=[...Array(8)].map((_,i)=>10+i);if(signal.value==='杀小边')ex=[...Array(10)].map((_,i)=>i);if(signal.value==='杀大边')ex=[...Array(10)].map((_,i)=>18+i);
    for(let n=0;n<28;n++)score[n]+=ex.includes(n)?-w*.8:w*.18;
  }
}
function accuracy(stats,id){
  const s=stats[id];if(!s||!s.total)return .5;
  return (s.hit+2)/(s.total+4);
}
async function fetchSources(targetIssue,stats){
  return Promise.all(SOURCES.map(async src=>{
    const out={id:src.id,name:src.name,type:src.type,baseWeight:src.baseWeight,pred:null,error:null,status:'失败',syncLabel:'读取失败',effectiveWeight:0,accuracy:accuracy(stats,src.id)};
    try{
      const r=await fetchTimeout(src.url+(src.url.includes('?')?'&':'?')+'_v3='+Date.now());
      const html=await r.text(), pred=src.parse(html);
      if(!pred)throw Error('页面未识别到预测');
      const fw=freshness(pred.issue,targetIssue,src.baseWeight), perf=.75+Math.max(0,Math.min(1,out.accuracy))*.45;
      out.pred=pred;out.status=fw.state;out.syncLabel=fw.label;out.effectiveWeight=fw.weight*perf;
    }catch(e){out.error=e.name==='AbortError'?'超时跳过':e.message}
    return out;
  }));
}
function consensus(rs,sourceStates){
  const score=baseDistribution(), used=[];
  for(const s of sourceStates){
    if(s.pred&&s.effectiveWeight>0){applySignal(score,s.pred.signal,s.effectiveWeight);used.push(s)}
  }
  const local=localScores(rs);for(let n=0;n<28;n++)score[n]+=local[n]*.72;
  const ranked=[...Array(28).keys()].sort((a,b)=>score[b]-score[a]||Math.abs(a-14)-Math.abs(b-14));
  return {codes:ranked.slice(0,4).sort((a,b)=>a-b),score:score.map(x=>Number(x.toFixed(4))),usedCount:used.length};
}
function rate(snaps,n){
  const a=Object.values(snaps).filter(s=>s.judgement==='对'||s.judgement==='错').sort((a,b)=>Number(b.issue)-Number(a.issue)).slice(0,n);
  const hit=a.filter(s=>s.judgement==='对').length;return {hit,total:a.length,pct:a.length?Math.round(hit/a.length*100):null};
}
function settle(state,latest){
  state.v3 ||= {snapshots:{},sourceStats:{}};
  const snaps=state.v3.snapshots, stats=state.v3.sourceStats;
  const s=snaps[latest.issue];
  if(s && s.judgement==='待'){
    s.actualSum=latest.sum;s.actualCombo=latest.combo;s.judgement=s.codes.includes(latest.sum)?'对':'错';s.judgedAt=new Date().toISOString();
    if(!s.statsCounted){
      for(const d of s.sources||[]){stats[d.id]||={total:0,hit:0};stats[d.id].total++;if(s.judgement==='对')stats[d.id].hit++}
      s.statsCounted=true;
    }
  }
  const keys=Object.keys(snaps).sort((a,b)=>Number(b)-Number(a)).slice(0,150), trim={};for(const k of keys)trim[k]=snaps[k];
  state.v3.snapshots=trim;
}
async function tick(){
  let st={};try{st=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{}
  st.v3 ||= {snapshots:{},sourceStats:{}};

  const d=await rows(), latest=d.rows[0];
  settle(st,latest);
  const nextIssue=/^\d+$/.test(latest.issue)?String(BigInt(latest.issue)+1n):latest.issue+'-next';
  const src=await fetchSources(nextIssue,st.v3.sourceStats);
  const con=consensus(d.rows,src);
  const ar=autoReference(d.rows);

  if(!st.v3.snapshots[nextIssue]){
    st.v3.snapshots[nextIssue]={
      issue:nextIssue,codes:con.codes,judgement:'待',createdAt:new Date().toISOString(),
      sources:src.filter(x=>x.pred&&x.effectiveWeight>0).map(x=>({id:x.id,name:x.name,predIssue:x.pred.issue,raw:x.pred.raw,effectiveWeight:Number(x.effectiveWeight.toFixed(3)),sync:x.syncLabel}))
    };
  }

  st.updatedAt=new Date().toISOString();
  st.dataSource=d.source;
  st.latestDraw=latest;
  st.nextIssue=nextIssue;
  st.drawHistory=d.rows.slice(0,100);
  st.autoReference={issue:nextIssue,...ar};
  st.consensus4={issue:nextIssue,codes:con.codes,score:con.score,usedCount:con.usedCount,totalSources:SOURCES.length};
  st.sources=src.map(x=>({
    id:x.id,name:x.name,type:x.type,status:x.status,syncLabel:x.syncLabel,
    predIssue:x.pred?.issue||null,raw:x.pred?.raw||null,error:x.error||null,
    effectiveWeight:Number((x.effectiveWeight||0).toFixed(3)),accuracy:Math.round(x.accuracy*100)
  }));
  st.rates={r10:rate(st.v3.snapshots,10),r30:rate(st.v3.snapshots,30),r100:rate(st.v3.snapshots,100)};
  fs.writeFileSync(FILE,JSON.stringify(st,null,2));
  console.log(`V3 updated ${latest.issue} -> ${nextIssue}; sources ${con.usedCount}/${SOURCES.length}; 4码 ${con.codes.join(',')}`);
}

const loops=Number(process.env.POLL_LOOPS||1),ms=Number(process.env.POLL_INTERVAL_MS||0);
let ok=0;
for(let i=0;i<loops;i++){
  try{await tick();ok++}catch(e){console.error('本轮更新失败:',e.message)}
  if(i<loops-1&&ms)await new Promise(r=>setTimeout(r,ms));
}
if(!ok)process.exitCode=1;
