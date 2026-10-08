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

// ===================== 时效验证：只展示最近 72 小时内的内容 =====================
// 服务端已按 72 小时过滤；这里再做一次兜底，无法验证发布时间的内容一律隐藏。
const FRESH_WINDOW_MS = 72 * 60 * 60 * 1000;
const FRESH_WINDOW_LABEL = '72 小时';
function freshOnly(items) {
  const now = Date.now();
  return (items || []).filter(x => {
    if (x.error) return true;
    const t = x.publishedAt ? new Date(x.publishedAt).getTime() : NaN;
    if (!Number.isFinite(t)) {
      // 没有时间戳：用相对时间文案兜底（“3小时前” / “2 hours ago”）
      const rel = relAgeMs(x.publishedLabel || x.published);
      return rel != null && rel <= FRESH_WINDOW_MS;
    }
    return now - t <= FRESH_WINDOW_MS;
  });
}
function relAgeMs(text) {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(秒|分钟|分鐘|小时|小時|天|日|周|週|个月|個月|年|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s*(?:前|ago|before)/i);
  if (!m) return /(刚刚|剛剛|just now|now)/i.test(String(text || '')) ? 0 : null;
  const n = Number(String(m[1]).replace(',', '.'));
  const u = m[2].toLowerCase();
  const mult = /秒|sec/.test(u) ? 1000 : /分|min/.test(u) ? 60000 : /小时|小時|hour|hr/.test(u) ? 3600000
    : /天|日|day/.test(u) ? 86400000 : /周|週|week/.test(u) ? 604800000 : /个月|個月|month/.test(u) ? 2592000000 : 31536000000;
  return Number.isFinite(n) ? n * mult : null;
}

// ===================== AI 多空概率（看多 / 看空） =====================
// 取代原「无公开中文字幕」提示：无字幕内容同样给出 AI 多空概率，并明确标注推算来源。
function lsBar(v, width = 10) {
  const k = Math.max(0, Math.min(width, Math.round(v / 100 * width)));
  return '█'.repeat(k) + '░'.repeat(width - k);
}
function lsHtml(x) {
  const bb = x && x.bullBear;
  if (!bb || typeof bb.bull !== 'number') return '';
  const src = bb.source === 'ai' ? '模型：DeepSeek 多空推理' : '模型：本地规则（未配置 AI Key）';
  return `
        <div class="longshort">
          <div class="ls-head"><span class="ls-badge">AI 多空概率</span><span class="ls-tag">多 ${bb.bull}% / 空 ${bb.bear}%</span></div>
          <div class="ls-row bull"><span class="ls-k">多</span><span class="ls-bar">${lsBar(bb.bull)}</span><span class="ls-v">${bb.bull}%</span></div>
          <div class="ls-row bear"><span class="ls-k">空</span><span class="ls-bar">${lsBar(bb.bear)}</span><span class="ls-v">${bb.bear}%</span></div>
          <div class="ls-note">${esc(bb.note || '')} · ${src} · 仅供研究参考，不构成投资建议</div>
          ${x.transcript ? '' : '<div class="ls-note">未读取到公开中文字幕 · 概率由 AI 依据标题与频道推算</div>'}
        </div>`;
}

function updatePushMeta() {
  const packetItems = freshOnly(last);
  const pc = document.querySelector('#packetCount');
  if (pc) pc.textContent = packetItems.length;
  const ps = document.querySelector('#pushStatus');
  if (ps) {
    if (!packetItems.length) ps.textContent = 'STANDBY';
    else if (document.querySelector('#push')?.disabled) ps.textContent = 'ARMED · ' + packetItems.length + ' PACKETS';
    else ps.textContent = 'READY · ' + packetItems.length + ' PACKETS';
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
let lastSA = [];   // 新栏目：Seeking Alpha 最新分析（网页渲染 + 推送块共用）
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
  // 时效兜底：只渲染最近 72 小时之内的内容（服务端已过滤，此处二次校验）
  const visible = freshOnly(items);
  if (empty) {
    if (visible.length) {
      empty.style.display = 'none';
    } else {
      empty.style.display = '';
      empty.innerHTML = items.length
        ? `<span class="empty-kicker">NO CONTENT WITHIN ${FRESH_WINDOW_LABEL.toUpperCase()}</span>
           <div class="empty-line">最近 ${FRESH_WINDOW_LABEL}内没有新的内容，超时内容已全部隐藏。</div>
           <small class="empty-note">时效验证规则：仅保留发布时间在最近 ${FRESH_WINDOW_LABEL}之内的内容；无法验证发布时间的内容同样隐藏。</small>`
        : `<span class="empty-kicker">WAITING FOR SCAN</span>
           <div class="empty-line">选择频道后，点击「开始全景扫描」。</div>
           <small class="empty-note">扫描结果将以「DOS 监视器 · 复古终端」竖版长页排版呈现，并附每条内容的 AI 多空概率。</small>`;
    }
  }
  out.innerHTML = visible.map((x, i) => x.error ? `
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
          <span class="hl-badge fresh-badge">${FRESH_WINDOW_LABEL.toUpperCase()} ✓</span>
        </div>
        <div>${esc(x.publishedLabel || x.published || '')}${x.publishedMacau ? ` · ${esc(x.publishedMacau)}` : ''} · ${esc(x.status || '')}${x.direction ? ` · ${esc(x.direction)}` : ''}</div>
      </div>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.title)}</a></h3>
      ${lsHtml(x)}
      ${x.transcript ? `<div class="transcript">${fmtTranscript(x.transcript)}</div>` : ''}
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
      light.style.background = '#0a5c2c';   /* 熄灭态与 CSS --border-light 一致，不用灰色 */
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
    let hiddenTotal = 0;
    const BATCH = 4;
    for (let i = 0; i < channels.length; i += BATCH) {
      if (all.length >= MAX_REPORT_ITEMS) break;
      const batch = channels.slice(i, i + BATCH);
      const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: batch, limit: MAX_REPORT_ITEMS - all.length }) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      all.push(...data.items);
      all.splice(MAX_REPORT_ITEMS);
      hiddenTotal += Number(data.hiddenCount || 0);
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
        state.textContent = '扫描完成（重试已全部恢复）' + (hiddenTotal ? ` · 已隐藏 ${hiddenTotal} 条超${FRESH_WINDOW_LABEL}内容` : '');
        setPushStatus('READY TO PUSH');
      }
    } else {
      state.textContent = '扫描完成 · ALL SUCCESS' + (hiddenTotal ? `（已隐藏 ${hiddenTotal} 条超${FRESH_WINDOW_LABEL}内容）` : '');
      setPushStatus('READY TO PUSH');
    }
    p.style.width = '100%';
    if (pt) pt.textContent = '100%';
    const stamp = document.querySelector('#stamp');
    const freshCount = freshOnly(last).length;
    if (stamp) stamp.textContent = 'COMPLETED · ' + freshCount + ' ITEMS'
      + (hiddenTotal ? ' · 已隐藏 ' + hiddenTotal + ' 条超出 ' + FRESH_WINDOW_LABEL : '')
      + (last.length >= MAX_REPORT_ITEMS ? ' · 50 条上限' : '');
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

// 离线示例数据：无需外网即可查看「72 小时时效验证 + AI 多空概率」的完整排版
document.querySelector('#demo').onclick = async () => {
  const b = document.querySelector('#demo'), p = document.querySelector('#progress'), pt = document.querySelector('#progress-text');
  b.disabled = true;
  try {
    const r = await fetch('/api/demo');
    const d = await r.json();
    if (!r.ok) throw Error(d.error || ('HTTP ' + r.status));
    last = d.items || [];
    render(last);
    const stamp = document.querySelector('#stamp');
    const freshCount = freshOnly(last).length;
    if (stamp) stamp.textContent = 'DEMO · ' + freshCount + ' ITEMS' + (d.hiddenCount ? ' · 已隐藏 ' + d.hiddenCount + ' 条超出 ' + FRESH_WINDOW_LABEL : '') + ' · 示例数据';
    setPushStatus('DEMO · ' + freshCount + ' PACKETS');
    const stateEl = document.querySelector('#state');
    if (stateEl) stateEl.textContent = `示例数据已载入（${freshCount} 条 · 隐藏 ${d.hiddenCount || 0} 条超出 ${FRESH_WINDOW_LABEL}）`;
    if (p) { p.style.width = '100%'; if (pt) pt.textContent = '100%'; }
    const pushBtn = document.querySelector('#push');
    if (pushBtn) pushBtn.disabled = false;
    updatePushMeta();
  } catch (e) {
    alert('载入示例数据失败：' + e.message);
  } finally {
    b.disabled = false;
    setTimeout(() => { if (p) p.style.width = '0%'; if (pt) pt.textContent = '0%'; }, 1200);
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

// ===================== 新栏目：Seeking Alpha 最新分析 =====================
// 读取 seekingalpha.com/latest-articles → 中文解析 → AI 多空概率；真实读取失败自动降级示例数据（如实标注）。
async function loadSeekingAlpha(forceDemo = false) {
  const state = document.querySelector('#sa-state');
  const box = document.querySelector('#sa-results');
  if (!box) return;
  if (state) state.textContent = '读取中… / FETCHING';
  const get = async (url) => {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || !d.ok) throw Error(d.error || ('HTTP ' + r.status));
    return d;
  };
  try {
    let d, degraded = '';
    if (forceDemo) {
      d = await get('/api/seekingalpha?demo=1');
    } else {
      try { d = await get('/api/seekingalpha'); }
      catch (e) { degraded = e.message; d = await get('/api/seekingalpha?demo=1'); d.demo = true; }
    }
    lastSA = d.items || [];
    renderSA(lastSA);
    if (state) state.textContent = (d.demo || degraded)
      ? `示例数据 · ${lastSA.length} 条` + (degraded ? `（真实读取失败：${degraded}）` : '（离线预览）')
      : `已读取 · ${lastSA.length} 条 · 时效验证 ✓ ${FRESH_WINDOW_LABEL}内`;
  } catch (e) {
    if (state) state.textContent = '读取失败 / ERROR';
    box.innerHTML = `<span class="empty-kicker">SA FETCH FAILED</span>
      <div class="empty-line">Seeking Alpha 读取失败：${esc(e.message)}</div>
      <small class="empty-note">可点击上方按钮重试；SA 对部分网络环境限流时仅能预览示例数据。</small>`;
    box.className = 'empty';
  }
}
function renderSA(items) {
  const box = document.querySelector('#sa-results');
  if (!box) return;
  box.className = 'sa-results';
  if (!items.length) {
    box.innerHTML = `<div class="empty"><span class="empty-kicker">NO FRESH ANALYSIS</span><div class="empty-line">最近 ${FRESH_WINDOW_LABEL}内没有新的分析文章。</div></div>`;
    return;
  }
  box.innerHTML = items.map((x, i) => `
    <article class="item">
      <div class="meta">
        <div class="ch-name">
          <span class="hl-badge">SA#${i + 1}</span>
          SA ▸ ${esc(x.ticker || 'MARKET')}
          <span class="hl-badge fresh-badge">${FRESH_WINDOW_LABEL.toUpperCase()} ✓</span>
        </div>
        <div>${esc(x.publishedLabel || '')}${x.publishedMacau ? ` · ${esc(x.publishedMacau)}` : ''}${x.author ? ` · ${esc(x.author)}` : ''}</div>
      </div>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.title)}</a></h3>
      ${x.originalTitle ? `<div class="sa-original">EN ▸ ${esc(x.originalTitle)}</div>` : ''}
      ${x.summaryZh ? `<div class="sa-summary">${esc(x.summaryZh)}</div>` : ''}
      ${lsHtml(x)}
    </article>`).join('');
}
document.querySelector('#sarefresh') && (document.querySelector('#sarefresh').onclick = () => loadSeekingAlpha(false));
loadSeekingAlpha(); // 页面载入即读取该栏目（失败自动降级示例数据）

document.querySelector('#push').onclick = async () => {
  const token = document.querySelector('#token').value.trim();
  if (!token) return alert('请输入 PushPlus Token');
  if (!last.length) return alert('请先执行扫描获取情报数据');
  // 时效验证：只推送最近 72 小时内发布的内容；无内容则不推送
  const freshItems = freshOnly(last);
  if (!freshItems.length) return alert(`最近 ${FRESH_WINDOW_LABEL}内没有新的内容（超时内容已隐藏），本次不推送。`);
  if (!freshItems.some(x => !x.error)) return alert('本次扫描未取得任何有效内容（仅剩扫描异常），本次不推送。');

  // === PushPlus DOS 监视器 · 复古终端 微信竖版长页面推送模板 ===
  // 文字色深五档（微信会剥离 class，因此全部写 inline）：
  //   标题 #eafff0 —— 视频标题、今日主线、署名行
  //   突出 #00ff66 —— 反白徽章、行内高亮词、DOS 窗口标题栏
  //   重点 #b8f2cb —— 要点列表、关键数字、多空概率数值
  //   正文 #8fdca4 —— 字幕摘录
  //   说明 #63b47f —— 补充说明、来源标注、免责提示
  //   装饰层（非内容五档）：辅助 #3f8f5b 状态标签、元数据 #2c6742 日期/路径/EXIT 行
  const TIER = {
    title: 'color:#eafff0;font-weight:700;',
    accent: 'color:#00ff66;font-weight:700;',
    focus: 'color:#b8f2cb;font-weight:700;',
    body: 'color:#8fdca4;font-weight:400;',
    note: 'color:#63b47f;font-weight:400;',
    meta: 'color:#3f8f5b;font-weight:400;',
    dim: 'color:#2c6742;font-weight:400;'
  };
  // 字幕行首时间戳（00:12）压到最暗一层，只当锚点用
  const fmtPush = t => esc(t).replace(/(^|\n)(\d{1,2}:\d{2}(?::\d{2})?)/g, '$1<span style="color:#2c6742;font-size:10px;">$2</span>');
  // AI 多空概率（微信会剥离 class，全部 inline）：条形图 + 来源标注
  const lsBarPush = (v, w = 10) => {
    const k = Math.max(0, Math.min(w, Math.round(v / 100 * w)));
    return '█'.repeat(k) + '░'.repeat(w - k);
  };
  const lsBlockPush = x => {
    const bb = x.bullBear;
    if (!bb || typeof bb.bull !== 'number') return '';
    const src = bb.source === 'ai' ? 'DeepSeek 多空推理' : '本地规则推算（未配置 AI Key）';
    return `
        <div style="margin-top:8px;padding:8px 10px;background:#031203;border:1px solid #0d9b4c;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-family:'Courier New',Consolas,monospace;font-size:9px;flex-wrap:wrap;">
            <span style="background:#00ff66;color:#041404;padding:1px 5px;font-weight:700;letter-spacing:0.5px;">AI 多空概率</span>
            <span style="background:#041404;color:#b8f2cb;padding:1px 5px;font-weight:700;">多 ${bb.bull}% / 空 ${bb.bear}%</span>
          </div>
          <div style="margin-top:6px;font-family:'Courier New',Consolas,monospace;font-size:10.5px;color:#b8f2cb;font-weight:700;line-height:1.9;word-break:break-all;white-space:pre-wrap;">多 ${lsBarPush(bb.bull)} ${bb.bull}%
空 ${lsBarPush(bb.bear)} ${bb.bear}%</div>
          <div style="margin-top:4px;font-family:'Courier New',Consolas,monospace;font-size:9px;color:#63b47f;line-height:1.7;">${esc(bb.note || '')} · 模型：${src} · 仅供研究参考，不构成投资建议${x.transcript ? '' : '<br>未读取到公开中文字幕 · 概率由 AI 依据标题与频道推算'}</div>
        </div>`;
  };

  const items = freshItems.map((x, i) => x.error ?
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
        <div style="${TIER.dim}font-family:'Courier New',Consolas,monospace;font-size:9.5px;letter-spacing:0.5px;">C:\\BRIEF\\LOGS&gt; ${esc(x.publishedLabel || x.published || '')}${x.publishedMacau ? ` · ${esc(x.publishedMacau)}` : ''} · 时效验证 ✓ ${esc(FRESH_WINDOW_LABEL)}内</div>
        <h3 style="margin:6px 0 8px;">
          <a href="${esc(x.url)}" style="${TIER.title}font-size:13.5px;line-height:1.55;text-decoration:underline;text-decoration-color:#3f8f5b;text-underline-offset:3px;word-break:break-all;">&gt; ${esc(x.title)}</a>
        </h3>
        ${lsBlockPush(x)}
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

    <!-- 时效验证说明：仅保留最近 72 小时内发布的内容 -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px dashed #0d9b4c;background:#031203;font-family:'Courier New',Consolas,monospace;font-size:9.5px;margin-bottom:12px;letter-spacing:0.5px;flex-wrap:wrap;gap:4px;">
      <span style="color:#00ff66;font-weight:700;">FRESHNESS CHECK ▸ 只保留最近 ${FRESH_WINDOW_LABEL}内发布的内容</span>
      <span style="color:#63b47f;font-weight:400;">超时 / 无法验证发布时间的内容已隐藏 · 本次共 ${freshItems.length} 条</span>
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
      const sr = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: freshItems }) });
      const sd = await sr.json();
      if (sr.ok && sd && sd.ok && sd.summaryHtml) summaryHtml = sd.summaryHtml;
    } catch (_) { /* 降级：无总结 */ }
    // 新栏目：Seeking Alpha 最新分析块（仅真实读取成功时附加，绝不把示例数据当真实情报推送）
    let saHtml = '';
    try {
      const saRes = await fetch('/api/seekingalpha');
      const saD = await saRes.json();
      if (saRes.ok && saD && saD.ok && !saD.demo && saD.html) saHtml = saD.html;
    } catch (_) { /* 降级：无 SA 栏目 */ }
    const content = (summaryHtml + saHtml) ? (summaryHtml + saHtml + baseContent) : baseContent;
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
    alert(`✅ 推送成功！\n已推送到微信（PushPlus）—— DOS 复古终端全景简报已发送！\n${summaryHtml ? '🧠 已附加 AI 主题聚类总结\n' : ''}${saHtml ? '🌐 已附加 SEEKING ALPHA 最新分析栏目\n' : ''}发送 ${sent}/${total} 条` + (total > 1 ? `（超过限制自动分条发送）` : '') + (d.data ? `\n首条流水号：` + d.data : '') + `\n\n— 章鱼 AI 全景分析 —`);
    setPushStatus('PUSHED ' + sent + '/' + total);
  } catch (e) {
    alert('推送失败：' + e.message + '\n\n排查提示：\n1. Token 是否正确且已实名认证（2024-08-01 起需实名）\n2. 检查网络连接或 PushPlus 频率限制');
    setPushStatus('PUSH FAILED');
  } finally {
    b.disabled = false;
    if (!last.length) setPushStatus('STANDBY');
  }
};
