// 中文财经频道 + 70 个英文资讯/社交媒体内容源（新增 20 个 Reddit／moomoo 来源）；英文结果会优先转为中文展示。
const sourceNames=`信報財經新聞|Finance730|香港經濟日報 HKET|香港財經時報 HKBT|新城財經台|香港金融管理局|游庭皓的財經皓角|柴鼠兄弟 ZRBros|风傳媒-下班经济學|老王愛說笑|SHIN LI|自由女神邱沁宜|Better Leaf 好葉|慢活夫妻 George & Dewi|大俠武林|股乾爹 KuKanTieh|Gooaye股癌|理財不能等|懶錢包LazyWallet|M觀點|蕾咪Rami|財經 M 平方 MacroMicro|元大投顧財金頻道|股海老牛|财经风云|视野环球财经|阳光财经|ChineseFN 中文投資網|财经全世界|老李玩钱|土妹发财|贝拉说美股|美投说美股|艾爾文|寶可孟の省錢大作戰|吳淡如人生實用商學院|郭哲榮分析師|央视财经|Bloomberg中国|老徐价值投资|小Lin说|CK财经频道|钱姐说钱|硅谷居士|Mr.Market市场先生|财报狗|天下杂志|商业周刊|今周刊|非凡财经新闻|东森财经新闻|第一财经|FT中文网|观视频工作室|睡前消息|曲博科技教室|Bloomberg Television|CNBC|Reuters|Financial Times|The Wall Street Journal|Yahoo Finance|Business Insider|Forbes|The Economist|The New York Times|The Washington Post|BBC News|Sky News|CNN|Fox Business|PBS NewsHour|Associated Press|The Guardian|Politico|Axios|Morning Brew|The Financial Diet|Patrick Boyle|The Plain Bagel|The Money Guy Show|Graham Stephan|Andrei Jikh|Mark Tilbury|Erika Kullberg|Humphrey Yang|Minority Mindset|Meet Kevin|Everything Money|Joseph Carlson|The Compound|Animal Spirits|Real Vision Finance|Kitco News|Coin Bureau|Bankless|Unchained|The Defiant|Altcoin Daily|CoinDesk|The Wall Street Journal News|Reddit Investing|WallStreetBets|Stocktwits|X Finance|LinkedIn News|Reddit|r investing|r stocks|r wallstreetbets|r personalfinance|r CryptoCurrency|Reddit News|Reddit Business|moomoo|moomoo US|moomoo Singapore|moomoo Malaysia|moomoo Australia|moomoo Canada|moomoo Global|moomoo Markets|moomoo Finance|Futubull|r finance|moomoo New Zealand`.split('|');
const ENGLISH_SOURCE_START = 56;
const MAX_REPORT_ITEMS = 50;
const box = document.querySelector('#channels');
box.innerHTML = sourceNames.map(n => `<label class="channel"><input type="checkbox" value="${n}" checked> <span>${n}</span></label>`).join('');
const checked = () => [...box.querySelectorAll(':checked')].map(x => x.value);
// 在 50 条上限内交错排入中英文来源，避免默认全选时英文内容被中文频道完全挤出。
function balancedChannels(names) {
  const english = names.filter(n => sourceNames.indexOf(n) >= ENGLISH_SOURCE_START);
  const chinese = names.filter(n => sourceNames.indexOf(n) < ENGLISH_SOURCE_START);
  const out = [];
  for (let i = 0; i < Math.max(english.length, chinese.length); i++) {
    if (english[i]) out.push(english[i]);
    if (chinese[i]) out.push(chinese[i]);
  }
  return out;
}

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
  if (countEl) countEl.textContent = `// ${c}/${total} CH · 已选 ${Math.round(c / total * 100)}%`;
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

/**
 * 字幕排版 + 明暗层级：
 * 把行首时间戳（00:12 / 01:02:03）压到最暗一层（.ts），
 * 正文保持 L3，标题保持 L1 —— 眼睛先读标题，再读内容，时间轴只做锚点。
 */
function fmtTranscript(text = '') {
  return esc(text).replace(/(^|\n)(\d{1,2}:\d{2}(?::\d{2})?)/g, '$1<span class="ts">$2</span>');
}

function render(items) {
  const out = document.querySelector('#results');
  const empty = document.querySelector('#empty');
  if (empty) empty.style.display = 'none';
  out.innerHTML = items.map((x, i) => x.error ? `
    <article class="item error">
      <div class="meta">
        <span class="ch-name"><span class="hl-badge">[${i + 1}]</span> ${esc(x.channel)}</span>
        <span class="hl-badge">SCAN ERROR</span>
      </div>
      <h3 style="margin:4px 12px;font-size:12.5px;color:var(--amber);">未完成读取</h3>
      <p class="err-detail" style="margin:4px 12px 0;font-size:11.5px;">${esc(x.error)}</p>
      <small class="err-note" style="margin:4px 12px 10px;">已自动尝试 5 个搜索方向 × 多套解析策略 × 多字幕方向仍未命中，可稍后重试。</small>
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
      ${x.transcript ? `<div class="transcript">${fmtTranscript(x.transcript)}</div>` : '<div class="no-sub">该视频未能读取公开中文字幕，请点击标题观看原视频。</div>'}
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
  const channels = balancedChannels(checked());
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
      if (all.length >= MAX_REPORT_ITEMS) break;
      const batch = channels.slice(i, i + BATCH);
      const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: batch, limit: MAX_REPORT_ITEMS - all.length }) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      all.push(...data.items);
      all.splice(MAX_REPORT_ITEMS);
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
    if (stamp) stamp.textContent = 'COMPLETED · ' + last.length + ' ITEMS' + (last.length >= MAX_REPORT_ITEMS ? ' · 50 条上限' : '');
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

  // === PushPlus DOS 监视器 · 复古终端 微信竖版长页面推送模板 ===
  // 文字明暗层级（微信会剥离 class，因此全部写 inline）：
  //   L1 #eafff0 必读 —— 视频标题
  //   L2 #00ff66 强调 —— 关键词、反白徽章
  //   L3 #8fdca4 正文 —— 字幕摘录
  //   L4 #63b47f 次要 —— 引导语、免责说明
  //   L5 #3f8f5b 辅助 —— 状态标签
  //   L6 #2c6742 元数据 —— 日期、路径、EXIT 装饰行
  const TIER = {
    key: 'color:#eafff0;font-weight:700;',
    accent: 'color:#00ff66;font-weight:700;',
    body: 'color:#8fdca4;font-weight:400;',
    soft: 'color:#63b47f;font-weight:400;',
    meta: 'color:#3f8f5b;font-weight:400;',
    dim: 'color:#2c6742;font-weight:400;'
  };
  // 字幕行首时间戳（00:12）压到最暗一层，只当锚点用
  const fmtPush = t => esc(t).replace(/(^|\n)(\d{1,2}:\d{2}(?::\d{2})?)/g, '$1<span style="color:#2c6742;font-size:10px;">$2</span>');

  const items = last.map((x, i) => x.error ?
    `<section style="margin:10px 0;border:1px solid #b98600;background:#1a1203;box-shadow:0 0 6px rgba(255,176,0,0.15);font-family:'Courier New',Consolas,'SimSun',monospace;">
      <div style="display:flex;align-items:center;gap:6px;background:#ffb000;color:#041404;padding:3px 8px;font-family:'Courier New',Consolas,monospace;font-size:10px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;">
        <span style="background:#041404;color:#ffb000;padding:1px 5px;">■</span>
        <span>SCAN_ERROR.LOG</span>
        <span style="margin-left:auto;background:#041404;color:#8a6a12;padding:1px 5px;font-weight:400;">[${i + 1}] ${esc(x.channel)} · 未完成读取</span>
      </div>
      <p style="margin:8px 10px;color:#ffb000;font-size:11.5px;line-height:1.6;font-family:'Courier New',Consolas,monospace;font-weight:700;">&gt; ${esc(x.error)}</p>
    </section>`
    :
    `<section style="margin:10px 0;border:1px solid #0d9b4c;background:#072007;box-shadow:0 0 6px rgba(0,255,102,0.15);font-family:'Courier New',Consolas,'SimSun',monospace;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;background:#00ff66;color:#041404;padding:3px 8px;font-family:'Courier New',Consolas,monospace;font-size:10px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;word-break:break-all;">
          <span style="background:#041404;color:#00ff66;padding:1px 5px;font-weight:400;">#${i + 1}</span>
          <span>DIR ▸ ${esc(x.channel)}</span>
        </div>
        ${x.status ? `<span style="background:#041404;padding:1px 5px;flex-shrink:0;${TIER.body}">${esc(x.status)}</span>` : ''}
      </div>
      <div style="padding:10px 12px;">
        <div style="${TIER.dim}font-family:'Courier New',Consolas,monospace;font-size:9.5px;letter-spacing:0.5px;">C:\\BRIEF\\LOGS&gt; ${esc(x.published)}</div>
        <h3 style="margin:6px 0 8px;">
          <a href="${esc(x.url)}" style="${TIER.key}font-size:13.5px;line-height:1.55;text-decoration:underline;text-decoration-color:#3f8f5b;text-underline-offset:3px;word-break:break-all;">&gt; ${esc(x.title)}</a>
        </h3>
        ${x.transcript ? `
          <div style="margin-top:8px;padding:8px 10px;background:#031203;border-left:3px solid #0d9b4c;${TIER.body}font-size:11.5px;line-height:1.75;">${fmtPush(x.transcript)}</div>
        ` : ''}
      </div>
    </section>`
  ).join('');

  const baseContent = `<div style="font-family:'Courier New',Consolas,'SimSun',monospace;background-color:#041404;color:#8fdca4;padding:14px 12px;font-size:12px;line-height:1.7;max-width:680px;margin:0 auto;box-sizing:border-box;letter-spacing:0.3px;">

    <!-- DOS 顶部命令行 / Command Bar -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px dashed #0d9b4c;font-family:'Courier New',Consolas,monospace;font-size:10px;margin-bottom:12px;letter-spacing:0.5px;flex-wrap:wrap;gap:4px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:7px;height:7px;background:#00ff66;box-shadow:0 0 4px rgba(0,255,102,0.8);"></span>
        <span style="color:#00ff66;font-weight:700;">C:\\OCTOPUS\\AI&gt; PANORAMA.EXE</span>
      </div>
      <span style="background:#00ff66;color:#041404;padding:1px 6px;font-weight:700;font-size:9px;">DOS MONITOR · 复古终端</span>
    </div>

    <!-- 视频情报流 -->
    ${items}

    <!-- 尾页宣言 / Editorial Manifesto -->
    <div style="margin-top:16px;border:1px solid #0d9b4c;background:#072007;box-shadow:0 0 8px rgba(0,255,102,0.18);">
      <div style="display:flex;justify-content:space-between;align-items:center;background:#00ff66;color:#041404;padding:3px 8px;font-family:'Courier New',Consolas,monospace;font-size:9.5px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;gap:4px;">
        <span>EDITORIAL_MANIFESTO.TXT</span>
        <span style="font-weight:400;opacity:0.75;">章鱼 AI · 全景视野</span>
      </div>
      <div style="padding:12px;">
        <div style="font-size:12px;color:#eafff0;font-weight:700;line-height:1.6;margin-bottom:8px;">
          作者：章鱼 ai &nbsp; &nbsp; &nbsp; 仅供参考，分析研究
        </div>
        <div style="font-size:11.5px;color:#63b47f;line-height:1.8;text-align:justify;border-left:3px solid #0d9b4c;padding:8px 10px;background:#031203;margin-bottom:10px;">
          <span style="${TIER.accent}">全网境内外为你寻找蛛丝马迹-提供全景视野分析</span> 由多模型协同推理决策 ，底层所使用的大语言模型（LLM）多模式背后结合使用了多种不同的先进模型，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen 以及 Kimi。 根据不同的资产管理任务需求，更好地发挥各个模型的优势来提供数据支持！[加油]
        </div>
        <div style="${TIER.meta}font-family:'Courier New',Consolas,monospace;font-size:9px;text-align:center;border-top:1px dashed #0d9b4c;padding-top:6px;">
          DOS MONITOR · 复古终端 · 微信竖版阅读版 · 仅供研究参考
        </div>
        <div style="${TIER.dim}font-family:'Courier New',Consolas,monospace;font-size:10px;">C:\\OCTOPUS\\AI&gt; EXIT<span>█</span></div>
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
    alert(`✅ 推送成功！\n已推送到微信（PushPlus）—— DOS 复古终端全景简报已发送！\n${summaryHtml ? '🧠 已附加 AI 主题聚类总结\n' : ''}发送 ${sent}/${total} 条` + (total > 1 ? `（超过限制自动分条发送）` : '') + (d.data ? `\n首条流水号：` + d.data : '') + `\n\n— 章鱼 AI 全景分析 —`);
    setPushStatus('PUSHED ' + sent + '/' + total);
  } catch (e) {
    alert('推送失败：' + e.message + '\n\n排查提示：\n1. Token 是否正确且已实名认证（2024-08-01 起需实名）\n2. 检查网络连接或 PushPlus 频率限制');
    setPushStatus('PUSH FAILED');
  } finally {
    b.disabled = false;
    if (!last.length) setPushStatus('STANDBY');
  }
};
