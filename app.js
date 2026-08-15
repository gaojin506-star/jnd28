const $ = id => document.getElementById(id);
let history = [];

function classify(sum){
  const size = sum <= 13 ? "小" : "大";
  const oe = sum % 2 === 0 ? "双" : "单";
  return {size, oe, combo:size+oe};
}

function parseABC(raw){
  if(!raw) return null;
  raw=String(raw).trim().replace(/[＝=].*$/,"");
  let nums=/^\d{3}$/.test(raw)?raw.split('').map(Number):(raw.match(/\d+/g)||[]).map(Number);
  if(nums.length!==3||nums.some(n=>!Number.isInteger(n)||n<0||n>9))return null;
  return nums;
}

function setCurrent(r){
  if(!r)return;
  $("sum").textContent=r.sum;
  $("size").textContent=r.size;
  $("oddEven").textContent=r.oe;
  $("abc").textContent=r.abc || "--";
  $("issueText").textContent=r.issue?`第 ${r.issue} 期`:`${r.abc} = ${r.sum}`;
  $("comboBadge").textContent=r.combo;
  $("comboBadge").className="badge";
}

function setPrediction(state){
  const ar=state?.autoReference;
  if(!ar?.picks?.length){
    $("pick1").textContent="--";$("pick2").textContent="--";
    $("score1").textContent="参考度 --";$("score2").textContent="参考度 --";
    $("modelState").textContent="待分析";$("reason").textContent="等待自动开奖数据。";return;
  }
  $("pick1").textContent=ar.picks[0]?.name||"--";
  $("pick2").textContent=ar.picks[1]?.name||"--";
  $("score1").textContent=`模型参考度 ${ar.picks[0]?.confidence??'--'}%`;
  $("score2").textContent=`模型参考度 ${ar.picks[1]?.confidence??'--'}%`;
  $("modelState").textContent="已自动更新";
  $("reason").textContent=ar.reason||"根据近期历史走势自动分析。";
}

function render(){
  $("total").textContent=history.length;
  $("big").textContent=history.filter(r=>r.size==="大").length;
  $("small").textContent=history.filter(r=>r.size==="小").length;
  $("odd").textContent=history.filter(r=>r.oe==="单").length;
  $("even").textContent=history.filter(r=>r.oe==="双").length;
  if(history.length){
    const first=history[0].combo;let n=0;for(const r of history){if(r.combo===first)n++;else break}
    $("streak").textContent=`${first}×${n}`;
  }else $("streak").textContent="--";

  const trend=$("trend");
  if(!history.length){trend.className="trend empty";trend.innerHTML="暂无数据"}
  else{trend.className="trend";trend.innerHTML=history.slice(0,12).map(r=>`<div class="ball"><b>${r.sum}</b><span>${r.combo}</span></div>`).join('')}

  const list=$("historyList");
  if(!history.length)list.innerHTML='<div class="history-empty">暂无记录</div>';
  else list.innerHTML=history.slice(0,40).map(r=>`<div class="history-item"><div class="num">#${r.issue||'本地'}</div><div class="abc">${r.abc||'--'}</div><div class="sum">${r.sum}</div><div class="combo">${r.combo}</div><div class="pred">${r.prediction||'--'}</div></div>`).join('');
}

function normalizeState(state){
  const predByIssue=new Map();
  const snaps=state?.v3?.snapshots||{};
  for(const [issue,s] of Object.entries(snaps)){
    if(s?.codes)predByIssue.set(issue,s.codes.join(' / '));
  }
  return (state?.drawHistory||[]).map(r=>({
    issue:String(r.issue||''),sum:Number(r.sum),...classify(Number(r.sum)),abc:r.abc?Array.isArray(r.abc)?r.abc.join('+'):String(r.abc):'--',prediction:predByIssue.get(String(r.issue))||'--'
  })).filter(r=>Number.isFinite(r.sum));
}

async function syncData(){
  $("syncHint").textContent="正在同步最新开奖…";
  try{
    const res=await fetch(`data/state.json?t=${Date.now()}`,{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const state=await res.json();history=normalizeState(state);
    if(history[0])setCurrent(history[0]);
    setPrediction(state);render();
    const d=state.updatedAt?new Date(state.updatedAt):new Date();
    $("lastSync").textContent=d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});
    $("syncHint").textContent=`已同步 · 下一期 ${state.nextIssue||'--'}`;
  }catch(e){
    $("syncHint").textContent="自动同步失败，可手动录入";
    $("lastSync").textContent="同步失败";
  }
}

function manualAnalyze(){
  const abc=parseABC($("quickInput").value);
  if(!abc){$("error").textContent="请输入3个 0-9 数字，例如 9+6+0 或 960";return}
  $("error").textContent="";
  const sum=abc.reduce((a,b)=>a+b,0),c=classify(sum);
  setCurrent({issue:'',abc:abc.join('+'),sum,...c});
  $("quickInput").value="";
}

$("goBtn").addEventListener("click",manualAnalyze);
$("quickInput").addEventListener("keydown",e=>{if(e.key==='Enter'){e.preventDefault();manualAnalyze()}});
$("syncBtn").addEventListener("click",syncData);

syncData();
setInterval(syncData,15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncData()});
