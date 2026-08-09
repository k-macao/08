const sourceNames=`信報財經新聞|Finance730|香港經濟日報 HKET|香港財經時報 HKBT|新城財經台|香港金融管理局|游庭皓的財經皓角|柴鼠兄弟 ZRBros|风傳媒-下班经济學|老王愛說笑|SHIN LI|自由女神邱沁宜|Better Leaf 好葉|慢活夫妻 George & Dewi|大俠武林|股乾爹 KuKanTieh|Gooaye股癌|理財不能等|懶錢包LazyWallet|M觀點|蕾咪Rami|財經 M 平方 MacroMicro|元大投顧財金頻道|股海老牛|财经风云|视野环球财经|阳光财经|ChineseFN 中文投資網|财经全世界|王剑财经观察|老李玩钱|土妹发财|贝拉说美股|美投说美股|艾爾文|寶可孟の省錢大作戰|吳淡如人生實用商學院|郭哲榮分析師|央视财经|Bloomberg中国|肖恩|老徐价值投资|小Lin说|CK财经频道|钱姐说钱|硅谷居士|Mr.Market市场先生|财报狗|天下杂志|商业周刊|今周刊|非凡财经新闻|东森财经新闻|第一财经|FT中文网|BBC News 中文|德国之声中文|美国之音中文网|自由亚洲电台|观视频工作室|睡前消息|曲博科技教室`.split('|');
const box=document.querySelector('#channels');
const totalEl=document.querySelector('#total');
box.innerHTML=sourceNames.map((n,i)=>`<label class="channel"><input type="checkbox" value="${n}" ${i<4?'checked':''}> ${n}</label>`).join('');
if(totalEl)totalEl.textContent=sourceNames.length;
const checked=()=>[...box.querySelectorAll(':checked')].map(x=>x.value);
const count=()=>document.querySelector('#count').textContent=`// ${checked().length}/${sourceNames.length} CH`;
box.onchange=count; count();
document.querySelector('#all').onclick=()=>{const all=checked().length===sourceNames.length;box.querySelectorAll('input').forEach(x=>x.checked=!all);count()};
let last=[];
function esc(s=''){return s.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))}
function render(items){const out=document.querySelector('#results');document.querySelector('#empty').style.display='none';out.innerHTML=items.map(x=>x.error?`<article class="item error"><div class="meta">${esc(x.channel)} · SCAN ERROR</div><h3>未完成读取</h3><p class="tag">${esc(x.error)}</p></article>`:`<article class="item"><div class="meta">${esc(x.channel)} · ${esc(x.published)} · ${esc(x.status)}</div><h3><a href="${x.url}" target="_blank" rel="noreferrer">${esc(x.title)}</a></h3>${x.transcript?`<div class="transcript">${esc(x.transcript)}</div>`:'<p class="tag">该视频未能读取公开中文字幕。请通过标题链接观看原视频。</p>'}</article>`).join('')}
document.querySelector('#scan').onclick=async()=>{
  const channels=checked();
  if(!channels.length)return alert('请至少选择一个频道');
  const b=document.querySelector('#scan'), p=document.querySelector('#progress'),state=document.querySelector('#state');
  b.disabled=true;p.style.width='10%';state.textContent=`正在连接 YouTube…（0/${channels.length}）`;
  try{
    // 全频道逐个扫描，前端分批推送进度
    const all=[];
    const BATCH=4;
    for(let i=0;i<channels.length;i+=BATCH){
      const batch=channels.slice(i,i+BATCH);
      const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channels:batch})});
      const data=await r.json();
      if(!r.ok)throw Error(data.error);
      all.push(...data.items);
      const done=Math.min(i+BATCH,channels.length);
      p.style.width=Math.round(done/channels.length*90)+'%';
      state.textContent=`扫描中…（${done}/${channels.length}）`;
      last=all;
      render(last);
    }
    p.style.width='100%';state.textContent='扫描完成';
    document.querySelector('#stamp').textContent='LAST RUN · '+new Date().toLocaleString('zh-CN');
    document.querySelector('#push').disabled=false;
  }catch(e){state.textContent='执行失败';alert('扫描失败：'+e.message)}
  finally{b.disabled=false;setTimeout(()=>p.style.width='0',1200)}
};
document.querySelector('#runflows').onclick=async()=>{const b=document.querySelector('#runflows'),msg=document.querySelector('#flowsmsg');b.disabled=true;msg.textContent='正在触发 GitHub Actions…';try{const r=await fetch('/api/run-flows',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const d=await r.json();if(!r.ok)throw Error(d.error);msg.textContent='已触发 workflow_dispatch（HTTP '+d.status+'）'}catch(e){msg.textContent='触发失败：'+e.message}finally{b.disabled=false}};
document.querySelector('#push').onclick=async()=>{
  const token=document.querySelector('#token').value.trim();
  if(!token)return alert('请输入 PushPlus Token');
  const items=last.map((x,i)=>x.error?`<section style="margin:12px 0;padding:10px;border-left:3px solid #e74c3c;background:#fdf0ef;"><b style="color:#c0392b">[${i+1}] ${esc(x.channel)} · 扫描异常</b><p style="margin:6px 0 0;color:#555;">${esc(x.error)}</p></section>`:`<section style="margin:14px 0;padding:12px;border:1px solid #e3e8ee;border-radius:6px;background:#fafbfc;"><div style="font-size:12px;color:#8a94a6;">${esc(x.channel)} · ${esc(x.published)} · ${esc(x.status||'')}</div><h3 style="margin:6px 0;"><a href="${esc(x.url)}" style="color:#1a4d8f;text-decoration:none;">${i+1}. ${esc(x.title)}</a></h3>${x.transcript?`<p style="margin:8px 0 0;color:#333;white-space:pre-wrap;">${esc(x.transcript)}</p>`:`<p style="margin:8px 0 0;color:#888;">该视频未提供公开中文字幕，请点击标题查看原视频。</p>`}</section>`).join('');
  const content=`<h2 style="border-bottom:2px solid #1a4d8f;padding-bottom:8px;color:#1a4d8f;">章鱼 AI 全景分析</h2><p style="color:#666;font-size:13px;">作者：章鱼 AI · 主动式多大模型混合调用 · 智能分析全网境内外有价值动态资讯</p><p style="color:#666;font-size:13px;">抓取时间：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Macau'})}（澳门时间） · 共 ${last.length} 条</p>${items}<p style="color:#999;font-size:12px;">© 章鱼 AI 全景分析 · 仅作研究参考，不构成投资建议。数据来源：YouTube 公开页面。</p>`;
  const b=document.querySelector('#push');b.disabled=true;
  try{
    const r=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,title:'章鱼 AI 全景分析 '+new Date().toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),content,template:'html',channel:'wechat'})});
    const d=await r.json();
    if(!r.ok||!d.ok)throw Error(d.msg||d.error||('HTTP '+r.status));
    const sent=d.sentParts||1,total=d.totalParts||1;
    alert(`已推送到微信（PushPlus）。\n发送 ${sent}/${total} 条`+(total>1?`（超过 10 万字自动分条发送）`:'')+(d.data?'\n首条流水号：'+d.data:''))
  }catch(e){alert('推送失败：'+e.message+'\n\n常见原因：\n1. Token 错误或未实名认证（2024-08-01 起未实名无法发送）\n2. PushPlus 服务器临时不可用或触发频率限制\n3. 网络异常')}finally{b.disabled=false}
};
