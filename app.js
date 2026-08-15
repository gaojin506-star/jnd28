const $=id=>document.getElementById(id);
let state=null;
let timer=null;

function fmt(sec){
  if(sec==null||sec<0)return '--:--';
  sec=Math.max(0,Math.floor(sec));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function startCountdown(){
  if(timer)clearInterval(timer);
  const tick=()=>{
    const end=Number(state?.countdownEndsAt||0);
    if(!end){$('countdown').textContent=state?.countdown||'--:--';return}
    const sec=(end-Date.now())/1000;
    $('countdown').textContent=fmt(sec);
    if(sec<=0)setTimeout(syncData,1200);
  };
  tick();timer=setInterval(tick,1000);
}
function setAuto(s){
  const a=s?.autoReference,p=a?.picks||[];
  $('nextIssueText').textContent=a?.issue?`第 ${a.issue} 期`:'等待分析';
  $('pick1').textContent=p[0]?.name||'--';
  $('pick2').textContent=p[1]?.name||'--';
  $('score1').textContent=`参考度 ${p[0]?.confidence??'--'}%`;
  $('score2').textContent=`参考度 ${p[1]?.confidence??'--'}%`;
  $('reason').textContent=a?.reason||'根据近期历史走势自动分析。';
}
function setCodes(s){
  const c=s?.consensus4,codes=c?.codes||[];
  $('fourIssueText').textContent=c?.issue?`第 ${c.issue} 期`:'等待分析';
  $('fourCodes').innerHTML=[0,1,2,3].map(i=>`<b>${codes[i]!=null?String(codes[i]).padStart(2,'0'):'--'}</b>`).join('');
}
function judgeClass(x){return x==='对'?'ok':x==='错'?'bad':'wait'}
function renderHistory(s){
  const rows=Object.values(s?.comparisons||{})
    .filter(x=>x.status==='已开奖')
    .sort((a,b)=>Number(b.issue)-Number(a.issue))
    .slice(0,60);
  const box=$('historyList');
  if(!rows.length){box.innerHTML='<div class="empty">新版本启用后会自动积累对比记录</div>';return}
  box.innerHTML=rows.map(x=>`<div class="history-row">
    <div class="actual"><strong>#${x.issue}</strong><span>${x.actualABC||'--'} = ${x.actualSum??'--'} · ${x.actualCombo||'--'}</span></div>
    <div class="auto-ref">${(x.autoPicks||[]).join(' / ')||'--'}</div>
    <div class="judge ${judgeClass(x.autoResult)}">${x.autoResult||'待'}</div>
    <div class="four-ref">${(x.codes||[]).map(n=>String(n).padStart(2,'0')).join(' · ')||'--'}</div>
    <div class="judge ${judgeClass(x.codeResult)}">${x.codeResult||'待'}</div>
  </div>`).join('');
}
async function syncData(){
  try{
    $('syncHint').textContent='正在自动获取最新开奖…';
    const r=await fetch(`data/state.json?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw Error('HTTP '+r.status);
    state=await r.json();
    const latest=state.latestDraw;
    $('issueText').textContent=latest?.issue?`最新：第 ${latest.issue} 期 · 和值 ${latest.sum} · ${latest.combo}`:'等待开奖数据';
    setAuto(state);setCodes(state);renderHistory(state);startCountdown();
    const d=state.updatedAt?new Date(state.updatedAt):new Date();
    $('lastSync').textContent=d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});
    $('syncHint').textContent=`已自动同步 · 下一期 ${state.nextIssue||'--'}`;
    $('onlineText').textContent='运行中';
  }catch(e){
    $('syncHint').textContent='同步失败，正在使用上次数据';
    $('onlineText').textContent='重试中';
  }
}

$('syncBtn').addEventListener('click',syncData);
syncData();
setInterval(syncData,15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncData()});