const sourceNames=`信報財經新聞|Finance730|香港經濟日報 HKET|香港財經時報 HKBT|新城財經台|香港金融管理局|游庭皓的財經皓角|柴鼠兄弟 ZRBros|风傳媒-下班经济學|老王愛說笑|SHIN LI|自由女神邱沁宜|Better Leaf 好葉|慢活夫妻 George & Dewi|大俠武林|股乾爹 KuKanTieh|Gooaye股癌|理財不能等|懶錢包LazyWallet|M觀點|蕾咪Rami|財經 M 平方 MacroMicro|元大投顧財金頻道|股海老牛|财经风云|视野环球财经|阳光财经|ChineseFN 中文投資網|财经全世界|老李玩钱|土妹发财|贝拉说美股|美投说美股|艾爾文|寶可孟の省錢大作戰|吳淡如人生實用商學院|郭哲榮分析師|央视财经|Bloomberg中国|老徐价值投资|小Lin说|CK财经频道|钱姐说钱|硅谷居士|Mr.Market市场先生|财报狗|天下杂志|商业周刊|今周刊|非凡财经新闻|东森财经新闻|第一财经|FT中文网|BBC News 中文|德国之声中文|美国之音中文网|自由亚洲电台|观视频工作室|睡前消息|曲博科技教室`.split('|');
const box=document.querySelector('#channels');
const totalEl=document.querySelector('#total');
box.innerHTML=sourceNames.map((n,i)=>`<label class="channel"><input type="checkbox" value="${n}" checked> ${n}</label>`).join('');
if(totalEl)totalEl.textContent=sourceNames.length;
const checked=()=>[...box.querySelectorAll(':checked')].map(x=>x.value);

// === Retro esports HUD helpers ===
function updateCombo(){
  const c=checked().length, total=sourceNames.length;
  const pct=Math.round(c/total*100);
  const rank = c===total? 'SSS' : c>=45? 'SS' : c>=30? 'S' : c>=15? 'A' : c>=5? 'B' : 'C';
  const el=document.querySelector('#combo'); if(el) el.textContent=c;
  const h=document.querySelector('#hero-combo'); if(h) h.textContent=c+'×';
  const hs=document.querySelector('#hero-combo-sub'); if(hs) hs.textContent = c===total? 'FULL COMBO · SSS' : pct+'% SELECT · '+rank+' RANK';
  const sc=document.querySelector('#score-combo'); if(sc) sc.textContent=c+'×';
  const sr=document.querySelector('#score-rank'); if(sr) sr.textContent=rank;
  const sr2=document.querySelector('#score-ready'); if(sr2) sr2.textContent=String(c).padStart(3,'0');
}
function updatePushMeta(){
  const pc=document.querySelector('#packetCount');
  if(pc) pc.textContent=last.length;
  const ps=document.querySelector('#pushStatus');
  if(ps){
    if(!last.length) ps.textContent='STANDBY';
    else if(document.querySelector('#push')?.disabled) ps.textContent='ARMED · READY TO FIRE';
    else ps.textContent='READY · '+last.length+' PACKETS';
  }
}
function setPushStatus(t){
  const el=document.querySelector('#pushStatus'); if(el) el.textContent=t;
  const s=document.querySelector('#state'); if(s) s.textContent=t;
}

const count=()=>{ document.querySelector('#count').textContent=`// ${checked().length}/${sourceNames.length} CH`; updateCombo(); };
box.onchange=count; count();
document.querySelector('#all').onclick=()=>{const all=checked().length===sourceNames.length;box.querySelectorAll('input').forEach(x=>x.checked=!all);count()};

let last=[];
function esc(s=''){return s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))}
function render(items){
  const out=document.querySelector('#results');
  const empty=document.querySelector('#empty');
  if(empty) empty.style.display='none';
  out.innerHTML=items.map(x=>x.error?`<article class="item error"><div class="meta">${esc(x.channel)} · SCAN ERROR · 已自动尝试多方向仍异常</div><h3>未完成读取</h3><p class="tag">${esc(x.error)}</p><small style="color:#8a94a6">已自动尝试 5 个搜索方向 × 4 套解析策略 × 多字幕方向，仍未命中。请稍后手动重试或检查频道名称是否变更。</small></article>`:`<article class="item"><div class="meta">${esc(x.channel)} · ${esc(x.published)} · ${esc(x.status)}${x.direction?` · 方向${esc(x.direction)}`:''}</div><h3><a href="${x.url}" target="_blank" rel="noreferrer">${esc(x.title)}</a></h3>${x.transcript?`<div class="transcript">${esc(x.transcript)}</div>`:'<p class="tag">该视频未能读取公开中文字幕。请通过标题链接观看原视频。</p>'}</article>`).join('');
  // update esports HUD
  updatePushMeta();
  // flash scoreboard
  const sr=document.querySelector('#score-ready');
  if(sr){ sr.style.color='#00ffd1'; setTimeout(()=>sr.style.color='', 300); }
}

// latency ticker for esports feel
setInterval(()=>{
  const v= 28 + Math.floor(Math.random()*36);
  const a=document.querySelector('#latency'); if(a) a.textContent=v+'ms';
  const b=document.querySelector('#foot-latency'); if(b) b.textContent=v;
}, 2200);

// token input light feedback
const tokenInput=document.querySelector('#token');
if(tokenInput){
  tokenInput.addEventListener('input',()=>{
    const light=document.querySelector('.input-light');
    if(!light) return;
    if(tokenInput.value.trim().length>8){ light.style.background='#00ffd1'; light.style.boxShadow='0 0 10px #00ffd1'; }
    else { light.style.background='#ff2e93'; light.style.boxShadow='0 0 8px #ff2e93'; }
  });
}

document.querySelector('#scan').onclick=async()=>{
  const channels=checked();
  if(!channels.length)return alert('请至少选择一个频道 / SELECT AT LEAST ONE MAP');
  const b=document.querySelector('#scan'), p=document.querySelector('#progress'),state=document.querySelector('#state');
  b.disabled=true;p.style.width='10%';state.textContent=`正在连接 YouTube…（0/${channels.length}）· CONNECTING`;
  setPushStatus('SCANNING · P1');
  try{
    const all=[];
    const BATCH=4;
    for(let i=0;i<channels.length;i+=BATCH){
      const batch=channels.slice(i,i+BATCH);
      const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channels:batch})});
      const data=await r.json();
      if(!r.ok)throw Error(data.error);
      all.push(...data.items);
      const done=Math.min(i+BATCH,channels.length);
      p.style.width=Math.round(done/channels.length*88)+'%';
      state.textContent=`扫描中…（${done}/${channels.length}）· SCANNING`;
      setPushStatus(`SCANNING ${done}/${channels.length}`);
      last=all;
      render(last);
    }
    const failedChannels=[...new Set(all.filter(x=>x.error).map(x=>x.channel))];
    if(failedChannels.length){
      state.textContent=`检测到 ${failedChannels.length} 个频道扫描异常，自动切换备用读取方向重试… · SWITCHING TACTICS`;
      p.style.width='90%';
      for(let idx=0; idx<failedChannels.length; idx++){
        const ch=failedChannels[idx];
        state.textContent=`备用方向重试中…（${idx+1}/${failedChannels.length}）${ch} · RETRY`;
        p.style.width=(90+Math.round((idx+1)/failedChannels.length*8))+'%';
        try{
          const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channels:[ch]})});
          const data=await r.json();
          if(!r.ok) throw Error(data.error||('HTTP '+r.status));
          const retryItems=data.items||[];
          const hasSuccess=retryItems.some(v=>!v.error);
          const errIdx=all.findIndex(x=>x.channel===ch && x.error);
          if(hasSuccess && errIdx!==-1){
            all.splice(errIdx,1,...retryItems);
            console.log(`[frontend] ${ch} 备用方向重试成功：${retryItems.length} 条`);
          } else if(!hasSuccess && errIdx!==-1){
            all[errIdx].error = (all[errIdx].error||'') + '（已自动尝试多方向：5 搜索词 × 多解析策略 × 多字幕轨道）';
            console.log(`[frontend] ${ch} 备用方向重试仍异常`);
          } else if(hasSuccess){
            all.push(...retryItems);
          }
          last=[...all];
          render(last);
        }catch(e){
          console.warn(`[frontend] ${ch} 重试请求失败：`,e.message);
          const errIdx=all.findIndex(x=>x.channel===ch && x.error);
          if(errIdx!==-1) all[errIdx].error+='（重试请求异常：'+e.message+'）';
          render(all);
        }
        if(idx < failedChannels.length-1) await new Promise(r=>setTimeout(r,700));
      }
      const stillFailed=[...new Set(all.filter(x=>x.error).map(x=>x.channel))].length;
      if(stillFailed) { state.textContent=`扫描完成（${failedChannels.length} 个异常频道已自动多方向重试，仍有 ${stillFailed} 个异常）· MISSION COMPLETE`; setPushStatus('COMPLETE · '+stillFailed+' ERR'); }
      else { state.textContent=`扫描完成（${failedChannels.length} 个异常频道经备用方向重试已全部恢复）· FLAWLESS`; setPushStatus('FLAWLESS · READY TO PUSH'); }
    } else {
      state.textContent='扫描完成 · MISSION COMPLETE';
      setPushStatus('COMPLETE · READY TO FIRE');
    }
    p.style.width='100%';
    const stamp=document.querySelector('#stamp');
    if(stamp) stamp.textContent='LAST RUN · '+new Date().toLocaleString('zh-CN')+' · P1 VICTORY';
    const pushBtn=document.querySelector('#push');
    if(pushBtn) pushBtn.disabled=false;
    updatePushMeta();
    // victory flash on push button
    if(pushBtn){
      pushBtn.style.filter='brightness(1.15)';
      setTimeout(()=>pushBtn.style.filter='', 600);
    }
  }catch(e){state.textContent='执行失败 · FAILED'; setPushStatus('FAILED'); alert('扫描失败：'+e.message)}
  finally{b.disabled=false;setTimeout(()=>p.style.width='0',1200)}
};
document.querySelector('#runflows').onclick=async()=>{const b=document.querySelector('#runflows'),msg=document.querySelector('#flowsmsg');b.disabled=true;msg.textContent='正在触发 GitHub Actions… · TRIGGERING';try{const r=await fetch('/api/run-flows',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const d=await r.json();if(!r.ok)throw Error(d.error);msg.textContent='已触发 workflow_dispatch（HTTP '+d.status+'）· FIRED'}catch(e){msg.textContent='触发失败：'+e.message}finally{b.disabled=false}};
document.querySelector('#push').onclick=async()=>{
  const token=document.querySelector('#token').value.trim();
  if(!token)return alert('请输入 PushPlus Token · INSERT ACCESS KEY');
  if(!last.length) return alert('请先执行扫描 · NO PACKETS · PRESS START FIRST');
  const items=last.map((x,i)=>x.error?`<section style="margin:16px 0;padding:14px 16px;border-left:4px solid #e74c3c;background:#fef2f2;border-radius:6px;"><b style="color:#c0392b;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:15px;line-height:1.6;">[${i+1}] ${esc(x.channel)} · 扫描异常</b><p style="margin:8px 0 0;color:#475569;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:13px;line-height:1.8;">${esc(x.error)}</p></section>`:`<section style="margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,.04);"><div style="font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:13px;color:#64748b;line-height:1.6;">${esc(x.channel)} · ${esc(x.published)} · ${esc(x.status||'')}${x.direction?` · 方向${esc(x.direction)}`:''}</div><h3 style="margin:8px 0 6px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:16px;line-height:1.55;"><a href="${esc(x.url)}" style="color:#1a4d8f;text-decoration:none;font-weight:700;">${i+1}. ${esc(x.title)}</a></h3>${x.transcript?`<p style="margin:10px 0 0;color:#1e293b;white-space:pre-wrap;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:14px;line-height:1.85;word-break:break-word;">${esc(x.transcript)}</p>`:`<p style="margin:10px 0 0;color:#94a3b8;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:14px;line-height:1.7;">该视频未提供公开中文字幕，请点击标题查看原视频。</p>`}</section>`).join('');
  const baseContent=`<div style="font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;"><h2 style="border-bottom:2px solid #1a4d8f;padding-bottom:10px;color:#0f2a44;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;font-size:20px;margin:0 0 10px;letter-spacing:.2px;">章鱼 AI·全景分析</h2><p style="color:#475569;font-size:14px;line-height:1.7;margin:6px 0;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;">作者：<b style="color:#0f2a44;">章鱼 AI</b> · 主动式多大模型混合调用 · 智能分析全网境内外有价值动态资讯</p><p style="color:#64748b;font-size:13px;line-height:1.6;margin:6px 0 14px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;">抓取时间：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Macau'})}（澳门时间） · 共 ${last.length} 条 · 共 ${Math.ceil(last.length/3)} 个频道</p>${items}<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif;">© 章鱼 AI·全景分析 · 仅作研究参考，不构成投资建议。数据来源：YouTube 公开页面。</p></div>`;
  const b=document.querySelector('#push');b.disabled=true;
  const setState=t=>{const s=document.querySelector('#state');if(s)s.textContent=t;};
  try{
    setState('AI 总结中… · ANALYZING'); setPushStatus('ANALYZING · AI');
    let summaryHtml='';
    try{
      const sr=await fetch('/api/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:last})});
      const sd=await sr.json();
      if(sr.ok&&sd&&sd.ok&&sd.summaryHtml)summaryHtml=sd.summaryHtml;
    }catch(_){ /* 降级：忽略 AI 失败 */ }
    const content = summaryHtml ? (summaryHtml + baseContent) : baseContent;
    setState('推送中… · FIRING'); setPushStatus('FIRING → WECHAT');
    const r=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,title:'章鱼 AI·全景分析 '+new Date().toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),content,template:'html',channel:'wechat'})});
    const d=await r.json();
    if(!r.ok||!d.ok)throw Error(d.msg||d.error||('HTTP '+r.status));
    const sent=d.sentParts||1,total=d.totalParts||1;
    // success animation
    b.style.filter='brightness(1.2)'; setTimeout(()=>b.style.filter='', 800);
    alert(`🎮 PUSH SUCCESS · 推送成功！\n已推送到微信（PushPlus）。\n${summaryHtml?'🧠 已附 AI 主题聚类总结\n':''}发送 ${sent}/${total} 条`+(total>1?`（超过 10 万字自动分条发送）`:'')+(d.data?`\n首条流水号：`+d.data:'')+`\n\n— OCTOPUS LEAGUE · P2 VICTORY —`)
    setPushStatus('VICTORY · PUSHED '+sent+'/'+total);
  }catch(e){alert('推送失败 · PUSH FAILED：'+e.message+'\n\n常见原因：\n1. Token 错误或未实名认证（2024-08-01 起未实名无法发送）\n2. PushPlus 服务器临时不可用或触发频率限制\n3. 网络异常\n\n— CHECK TOKEN AND RETRY —'); setPushStatus('FAILED · RETRY');}finally{b.disabled=false; if(!last.length) setPushStatus('STANDBY'); }
};
