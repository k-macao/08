const sourceNames=`信報財經新聞|Finance730|香港經濟日報 HKET|香港財經時報 HKBT|新城財經台|香港金融管理局|游庭皓的財經皓角|柴鼠兄弟 ZRBros|风傳媒-下班经济學|老王愛說笑|SHIN LI|自由女神邱沁宜|Better Leaf 好葉|慢活夫妻 George & Dewi|大俠武林|股乾爹 KuKanTieh|Gooaye股癌|理財不能等|懶錢包LazyWallet|M觀點|蕾咪Rami|財經 M 平方 MacroMicro|元大投顧財金頻道|股海老牛|财经风云|视野环球财经|阳光财经|ChineseFN 中文投資網|财经全世界|老李玩钱|土妹发财|贝拉说美股|美投说美股|艾爾文|寶可孟の省錢大作戰|吳淡如人生實用商學院|郭哲榮分析師|央视财经|Bloomberg中国|老徐价值投资|小Lin说|CK财经频道|钱姐说钱|硅谷居士|Mr.Market市场先生|财报狗|天下杂志|商业周刊|今周刊|非凡财经新闻|东森财经新闻|第一财经|FT中文网|观视频工作室|睡前消息|曲博科技教室`.split('|');
const box = document.querySelector('#channels');
const totalEl = document.querySelector('#hero-channels');
box.innerHTML = sourceNames.map(n => `<label class="channel"><input type="checkbox" value="${n}" checked> <span>${n}</span></label>`).join('');
const checked = () => [...box.querySelectorAll(':checked')].map(x => x.value);

function updatePushMeta() {
  const pc = document.querySelector('#packetCount');
  if (pc) pc.textContent = last.length;
  const ps = document.querySelector('#pushStatus');
  if (ps) {
    if (!last.length) ps.textContent = 'STANDBY';
    else if (document.querySelector('#push')?.disabled) ps.textContent = 'ARMED · ' + last.length + ' PACKETS';
    else ps.textContent = 'READY · ' + last.length + ' PACKETS';
  }
}

function setPushStatus(t) {
  const el = document.querySelector('#pushStatus'); if (el) el.textContent = t;
  const s = document.querySelector('#state'); if (s) s.textContent = t;
}

const count = () => {
  const c = checked().length, total = sourceNames.length;
  const countEl = document.querySelector('#count');
  if (countEl) countEl.textContent = `// ${c}/${total} CH`;
  if (totalEl) totalEl.textContent = `${c} CH`;
};
box.onchange = count;
count();

document.querySelector('#all').onclick = () => {
  const all = checked().length === sourceNames.length;
  box.querySelectorAll('input').forEach(x => x.checked = !all);
  count();
};

let last = [];
function esc(s = '') {
  return s.replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
}

function render(items) {
  const out = document.querySelector('#results');
  const empty = document.querySelector('#empty');
  if (empty) empty.style.display = 'none';
  out.innerHTML = items.map((x, i) => x.error ? `
    <article class="item error">
      <div class="meta">
        <span class="ch-name">[${i + 1}] ${esc(x.channel)}</span>
        <span class="hl-badge">SCAN ERROR</span>
      </div>
      <h3 style="margin:4px 0;font-size:12px;color:#990000;">未完成读取</h3>
      <p style="margin:4px 0 0;font-size:11.5px;color:#555;">${esc(x.error)}</p>
      <small style="display:block;margin-top:4px;color:#888;font-size:10px;">已自动尝试 5 个搜索方向 × 多套解析策略 × 多字幕方向仍未命中，可稍后重试。</small>
    </article>` : `
    <article class="item">
      <div class="meta">
        <div class="ch-name">
          <span class="hl-badge">#${i + 1}</span>
          ${esc(x.channel)}
        </div>
        <div>${esc(x.published)} · ${esc(x.status || '')}${x.direction ? ` · ${esc(x.direction)}` : ''}</div>
      </div>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.title)}</a></h3>
      ${x.transcript ? `<div class="transcript">${esc(x.transcript)}</div>` : '<div class="no-sub">该视频未能读取公开中文字幕，请点击标题观看原视频。</div>'}
    </article>`
  ).join('');
  updatePushMeta();
}

const tokenInput = document.querySelector('#token');
if (tokenInput) {
  tokenInput.addEventListener('input', () => {
    const light = document.querySelector('.input-light');
    if (!light) return;
    if (tokenInput.value.trim().length > 8) {
      light.style.background = '#00ff66';
      light.style.boxShadow = '0 0 6px #00ff66';
    } else {
      light.style.background = '#cccccc';
      light.style.boxShadow = 'none';
    }
  });
}

document.querySelector('#scan').onclick = async () => {
  const channels = checked();
  if (!channels.length) return alert('请至少选择一个频道 / SELECT AT LEAST ONE CHANNEL');
  const b = document.querySelector('#scan'), p = document.querySelector('#progress'), pt = document.querySelector('#progress-text'), state = document.querySelector('#state');
  b.disabled = true;
  p.style.width = '10%';
  if (pt) pt.textContent = '10%';
  state.textContent = `正在连接…（0/${channels.length}）`;
  setPushStatus('SCANNING');
  try {
    const all = [];
    const BATCH = 4;
    for (let i = 0; i < channels.length; i += BATCH) {
      const batch = channels.slice(i, i + BATCH);
      const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: batch }) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      all.push(...data.items);
      const done = Math.min(i + BATCH, channels.length);
      const pct = Math.round(done / channels.length * 88);
      p.style.width = pct + '%';
      if (pt) pt.textContent = pct + '%';
      state.textContent = `扫描中…（${done}/${channels.length}）`;
      setPushStatus(`SCANNING ${done}/${channels.length}`);
      last = all;
      render(last);
    }
    const failedChannels = [...new Set(all.filter(x => x.error).map(x => x.channel))];
    if (failedChannels.length) {
      state.textContent = `检测到 ${failedChannels.length} 个异常频道，自动切换备用方向重试…`;
      p.style.width = '90%';
      if (pt) pt.textContent = '90%';
      for (let idx = 0; idx < failedChannels.length; idx++) {
        const ch = failedChannels[idx];
        state.textContent = `备用重试（${idx + 1}/${failedChannels.length}）${ch}`;
        const retryPct = 90 + Math.round((idx + 1) / failedChannels.length * 8);
        p.style.width = retryPct + '%';
        if (pt) pt.textContent = retryPct + '%';
        try {
          const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: [ch] }) });
          const data = await r.json();
          if (!r.ok) throw Error(data.error || ('HTTP ' + r.status));
          const retryItems = data.items || [];
          const hasSuccess = retryItems.some(v => !v.error);
          const errIdx = all.findIndex(x => x.channel === ch && x.error);
          if (hasSuccess && errIdx !== -1) {
            all.splice(errIdx, 1, ...retryItems);
          } else if (!hasSuccess && errIdx !== -1) {
            all[errIdx].error = (all[errIdx].error || '') + '（已自动尝试多方向重试）';
          } else if (hasSuccess) {
            all.push(...retryItems);
          }
          last = [...all];
          render(last);
        } catch (e) {
          const errIdx = all.findIndex(x => x.channel === ch && x.error);
          if (errIdx !== -1) all[errIdx].error += '（重试异常：' + e.message + '）';
          render(all);
        }
        if (idx < failedChannels.length - 1) await new Promise(r => setTimeout(r, 700));
      }
      const stillFailed = [...new Set(all.filter(x => x.error).map(x => x.channel))].length;
      if (stillFailed) {
        state.textContent = `扫描完成（${stillFailed} 个频道异常）`;
        setPushStatus('COMPLETE · ' + stillFailed + ' ERR');
      } else {
        state.textContent = '扫描完成（重试已全部恢复）';
        setPushStatus('READY TO PUSH');
      }
    } else {
      state.textContent = '扫描完成 · ALL SUCCESS';
      setPushStatus('READY TO PUSH');
    }
    p.style.width = '100%';
    if (pt) pt.textContent = '100%';
    const stamp = document.querySelector('#stamp');
    if (stamp) stamp.textContent = 'COMPLETED · ' + last.length + ' ITEMS';
    const pushBtn = document.querySelector('#push');
    if (pushBtn) pushBtn.disabled = false;
    updatePushMeta();
  } catch (e) {
    state.textContent = '执行失败';
    setPushStatus('FAILED');
    alert('扫描失败：' + e.message);
  } finally {
    b.disabled = false;
    setTimeout(() => { p.style.width = '0%'; if (pt) pt.textContent = '0%'; }, 1500);
  }
};

document.querySelector('#runflows').onclick = async () => {
  const b = document.querySelector('#runflows'), msg = document.querySelector('#flowsmsg'), fs = document.querySelector('#flowsstate');
  b.disabled = true;
  if (fs) fs.style.display = 'block';
  msg.textContent = '正在触发 GitHub Actions…';
  try {
    const r = await fetch('/api/run-flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    msg.textContent = '已触发 workflow_dispatch（HTTP ' + d.status + '）';
  } catch (e) {
    msg.textContent = '触发失败：' + e.message;
  } finally {
    b.disabled = false;
  }
};

document.querySelector('#push').onclick = async () => {
  const token = document.querySelector('#token').value.trim();
  if (!token) return alert('请输入 PushPlus Token');
  if (!last.length) return alert('请先执行扫描获取情报数据');

  // === PushPlus Style A「电子杂志 × 电子墨水」微信竖版长页面推送模板 ===
  const items = last.map((x, i) => x.error ?
    `<section style="margin:10px 0;padding:10px 12px;border:1.5px solid #000000;border-left:4px solid #000000;background:#ffffff;box-shadow:2px 2px 0 #000000;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
        <span style="background:#000000;color:#00ff66;padding:1px 5px;font-size:9.5px;font-weight:700;font-family:monospace,sans-serif;">SCAN ERROR</span>
        <span style="font-family:monospace,sans-serif;font-size:10.5px;font-weight:700;color:#111111;min-width:0;word-break:break-word;">[${i + 1}] ${esc(x.channel)} · 未完成读取</span>
      </div>
      <p style="margin:4px 0 0;color:#444444;font-size:11.5px;line-height:1.6;">${esc(x.error)}</p>
    </section>`
    :
    `<section style="margin:10px 0;padding:12px;border:1.5px solid #111111;background:#ffffff;box-shadow:2px 2px 0 #000000;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px 8px;margin-bottom:6px;border-bottom:1px solid #f0f0f0;padding-bottom:6px;flex-wrap:wrap;">
        <div style="font-family:monospace,sans-serif;font-size:10.5px;color:#111111;font-weight:700;flex:1 1 auto;min-width:0;word-break:break-word;">
          <span style="background:#000000;color:#00ff66;padding:1px 5px;font-weight:700;margin-right:4px;">#${i + 1}</span>
          ${esc(x.channel)} <span style="color:#666666;font-weight:normal;">· ${esc(x.published)}</span>
        </div>
        ${x.status ? `<span style="font-family:monospace,sans-serif;font-size:9px;color:#555555;background:#f5f6f8;border:1px solid #d8dade;padding:1px 5px;line-height:1.5;flex-shrink:0;margin-left:auto;word-break:break-word;">${esc(x.status)}</span>` : ''}
      </div>
      <h3 style="margin:6px 0 8px;font-size:13px;line-height:1.45;font-weight:700;font-family:'Noto Serif SC',Georgia,serif,sans-serif;">
        <a href="${esc(x.url)}" style="color:#111111;text-decoration:underline;text-underline-offset:3px;word-break:break-all;">${esc(x.title)}</a>
      </h3>
      ${x.transcript ? `
        <div style="margin-top:8px;padding:8px 10px;background:#f5f6f8;border:1px solid #e2e4e8;border-left:3.5px solid #000000;color:#111111;white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.7;">${esc(x.transcript)}</div>
      ` : `
        <div style="margin-top:8px;padding:6px 8px;background:#f5f6f8;border:1px dashed #cccccc;color:#777777;font-size:11px;font-style:italic;">该视频未提供公开中文字幕，请点击标题查看原视频。</div>
      `}
    </section>`
  ).join('');

  const baseContent = `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Serif SC',Georgia,sans-serif;background-color:#eeeff2;color:#111111;padding:16px 12px;font-size:12px;line-height:1.65;max-width:680px;margin:0 auto;box-sizing:border-box;">
    
    <!-- 杂志页眉 / Top Issue Bar -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1.5px solid #111111;font-family:monospace,sans-serif;font-size:10px;color:#111111;margin-bottom:12px;letter-spacing:0.5px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:7px;height:7px;background:#00ff66;border:1.5px solid #000000;"></span>
        <span style="font-weight:700;">OCTOPUS AI // 全景分析</span>
      </div>
      <span style="background:#000000;color:#00ff66;padding:1px 5px;font-weight:700;font-size:9px;">STYLE A · 电子杂志 × 电子墨水</span>
    </div>

    <!-- 封面看板 / Title Section -->
    <div style="background:#0a0a0b;border:2px solid #000000;padding:14px 14px;margin-bottom:12px;box-shadow:3px 3px 0 #000000;">
      <div style="font-family:monospace,sans-serif;font-size:9.5px;color:#00ff66;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;font-weight:700;">
        ◈ MULTI-MODEL INTELLIGENCE REPORT
      </div>
      <h1 style="margin:0;font-size:19px;font-weight:900;color:#00ff66;letter-spacing:0.5px;line-height:1.25;font-family:'Noto Serif SC',Georgia,serif,sans-serif;">
        章鱼 AI 全景分析
      </h1>
      <div style="margin-top:6px;font-size:11.5px;color:#ffffff;line-height:1.55;font-weight:500;">
        全网 AI 调研境内境外数据，由多个大模型混合部署 。
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #333333;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-family:monospace,sans-serif;font-size:10px;color:#aaaaaa;">
        <span style="background:#000000;color:#00ff66;padding:1px 5px;border:1px solid #00ff66;font-weight:700;">多模型协同</span>
        <span style="color:#ffffff;">Claude · ChatGPT · Gemini · Grok · Qwen · Kimi</span>
      </div>
    </div>

    <!-- 简报状态条 -->
    <div style="background:#ffffff;border:1.5px solid #111111;padding:8px 10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-family:monospace,sans-serif;font-size:10px;color:#111111;box-shadow:2px 2px 0 #000000;">
      <div><span style="background:#000000;color:#00ff66;padding:1px 5px;font-weight:700;margin-right:5px;">情报流</span> <span style="font-weight:700;">共 ${last.length} 条视频情报</span></div>
      <div>规范：台湾/台灣 统一规范为 <span style="background:#000000;color:#00ff66;padding:1px 4px;font-weight:700;">中国台湾</span></div>
    </div>

    <!-- 视频情报流 -->
    ${items}

    <!-- 尾页宣言 / Editorial Manifesto -->
    <div style="margin-top:16px;border:1.5px solid #111111;background:#ffffff;padding:14px;box-shadow:3px 3px 0 #000000;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-family:monospace,sans-serif;font-size:9.5px;border-bottom:1px solid #eeeeee;padding-bottom:6px;">
        <span style="background:#000000;color:#00ff66;padding:1px 5px;font-weight:700;">EDITORIAL MANIFESTO</span>
        <span style="color:#666666;">章鱼 AI · 全景视野</span>
      </div>
      <div style="font-size:12px;font-weight:700;color:#111111;line-height:1.6;margin-bottom:8px;">
        作者：章鱼 ai &nbsp; &nbsp; &nbsp; 仅供参考，分析研究
      </div>
      <div style="font-size:11.5px;color:#222222;line-height:1.75;text-align:justify;border-left:3px solid #000000;padding:8px 10px;background:#f5f6f8;margin-bottom:10px;">
        全网境内外为你寻找蛛丝马迹-提供全景视野分析 由多模型协同推理决策 ，底层所使用的大语言模型（LLM）多模式背后结合使用了多种不同的先进模型，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen 以及 Kimi。 根据不同的资产管理任务需求，更好地发挥各个模型的优势来提供数据支持！[加油]
      </div>
      <div style="font-family:monospace,sans-serif;font-size:9px;color:#888888;text-align:center;border-top:1px solid #eeeeee;padding-top:6px;">
        STYLE A「电子杂志 × 电子墨水」· 微信竖版阅读版 · 仅供研究参考
      </div>
    </div>

  </div>`;

  const b = document.querySelector('#push');
  b.disabled = true;
  const setState = t => { const s = document.querySelector('#state'); if (s) s.textContent = t; };
  try {
    setState('AI 总结中…');
    setPushStatus('SUMMARIZING');
    let summaryHtml = '';
    try {
      const sr = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: last }) });
      const sd = await sr.json();
      if (sr.ok && sd && sd.ok && sd.summaryHtml) summaryHtml = sd.summaryHtml;
    } catch (_) { /* 降级：无总结 */ }
    const content = summaryHtml ? (summaryHtml + baseContent) : baseContent;
    setState('推送中…');
    setPushStatus('PUSHING → WECHAT');
    const r = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        title: '章鱼 AI 全景分析',
        content,
        template: 'html',
        channel: 'wechat'
      })
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw Error(d.msg || d.error || ('HTTP ' + r.status));
    const sent = d.sentParts || 1, total = d.totalParts || 1;
    alert(`✅ 推送成功！\n已推送到微信（PushPlus）—— Style A 电子杂志全景简报已发送！\n${summaryHtml ? '🧠 已附加 AI 主题聚类总结\n' : ''}发送 ${sent}/${total} 条` + (total > 1 ? `（超过限制自动分条发送）` : '') + (d.data ? `\n首条流水号：` + d.data : '') + `\n\n— 章鱼 AI 全景分析 —`);
    setPushStatus('PUSHED ' + sent + '/' + total);
  } catch (e) {
    alert('推送失败：' + e.message + '\n\n排查提示：\n1. Token 是否正确且已实名认证（2024-08-01 起需实名）\n2. 检查网络连接或 PushPlus 频率限制');
    setPushStatus('PUSH FAILED');
  } finally {
    b.disabled = false;
    if (!last.length) setPushStatus('STANDBY');
  }
};
