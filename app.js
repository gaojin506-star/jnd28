const $=id=>document.getElementById(id);
let state=null;
let timer=null;

function fmt(sec){if(sec==null||sec<0)return '--:--';sec=Math.max(0,Math.floor(sec));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function startCountdown(){if(timer)clearInterval(timer);const tick=()=>{const end=Number(state?.countdownEndsAt||0);if(!end){$('countdown').textContent=state?.countdown||'--:--';return}const sec=(end-Date.now())/1000;$('countdown').textContent=fmt(sec);if(sec<=0)setTimeout(syncData,1200)};tick();timer=setInterval(tick,1000)}
function setCurrent(r){if(!r)return;$('issueText').textContent=`第 ${r.issue} 期 · ${r.date||''} ${r.time||''}`.trim();$('sum').textContent=r.sum??'--';$('size').textContent=r.size||'--';$('oddEven').textContent=r.oe||'--';$('abc').textContent=r.abc||'--'}
function setAuto(s){const a=s?.autoReference,p=a?.picks||[];$('nextIssueText').textContent=a?.issue?`第 ${a.issue} 期`:'等待分析';$('pick1').textContent=p[0]?.name||'--';$('pick2').textContent=p[1]?.name||'--';$('score1').textContent=`参考度 ${p[0]?.confidence??'--'}%`;$('score2').textContent=`参考度 ${p[1]?.confidence??'--'}%`;$('reason').textContent=a?.reason||'根据近期走势自动分析。'}
function setCodes(s){const codes=s?.consensus4?.codes||[];$('fourCodes').innerHTML=[0,1,2,3].map(i=>`<b>${codes[i]!=null?String(codes[i]).padStart(2,'0'):'--'}</b>`).join('')}
function judgeClass(x){return x==='对'?'ok':x==='错'?'bad':'wait'}
function renderHistory(s){const a=Object.values(s?.comparisons||{}).filter(x=>x.status==='已开奖').sort((x,y)=>Number(y.issue)-Number(x.issue)).slice(0,50);const box=$('historyList');if(!a.length){box.innerHTML='<div class="empty">新版本启用后会自动积累对比记录</div>';return}box.innerHTML=a.map(x=>`<div class="history-row">
<div class="actual"><strong>#${x.issue}</strong><span>${x.actualABC||'--'} = ${x.actualSum??'--'} · ${x.actualCombo||'--'}</span></div>
<div class="compare"><span>${(x.autoPicks||[]).join(' / ')||'--'}</span><em class="${judgeClass(x.autoResult)}">${x.autoResult||'待'}</em></div>
<div class="compare"><span>${(x.codes||[]).map(n=>String(n).padStart(2,'0')).join(' · ')||'--'}</span><em class="${judgeClass(x.codeResult)}">${x.codeResult||'待'}</em></div>
</div>`).join('')}
async function syncData(){try{$('syncHint').textContent='正在自动获取最新开奖…';const r=await fetch(`data/state.json?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);state=await r.json();setCurrent(state.latestDraw);setAuto(state);setCodes(state);renderHistory(state);startCountdown();const d=state.updatedAt?new Date(state.updatedAt):new Date();$('lastSync').textContent=d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});$('syncHint').textContent=`已自动同步 · 下一期 ${state.nextIssue||'--'}`;$('onlineText').textContent='运行中'}catch(e){$('syncHint').textContent='同步失败，正在使用上次数据';$('onlineText').textContent='重试中'}}
$('syncBtn').addEventListener('click',syncData);
syncData();setInterval(syncData,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncData()});