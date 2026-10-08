// seekingalpha.mjs — 新栏目：Seeking Alpha 最新分析（读取 → 中文解析 → AI 多空概率）
//
// 职责（纯函数为主，可本地自测）：
//   parseSeekingAlphaList(html)   解析 seekingalpha.com/latest-articles 列表页 → 原始条目
//   parseSAPublished(text, now)   解析 SA 相对时间（Today, 5:28 PM / Yesterday / Oct. 7…）→ 时效证据
//   normalizeSAItem(raw)          统一条目结构（标题 / 译文 / 作者 / 标的 / 时效）
//   renderSeekingAlphaPush(items) 微信推送用 HTML 片段（五档色深 inline，class 会被剥离）
//   buildDemoSeekingAlpha(now)    离线示例数据（真实读取到的今日文章 + 中文解析 + 多空概率）
//
// 说明：SA 对机房 IP 常返回 403/空页，服务端抓取失败时上层降级为示例数据（网页端如实标注），
//       推送端仅在真实读取成功时附带该栏目，绝不把示例内容当真实情报推送。

import { FRESH_WINDOW_LABEL, formatMacau, evaluateFreshness } from './freshness.mjs';
import { ruleLongShort, normalizeProbability, aggregateLongShort, bullBearBar, probabilitySourceText } from './longshort.mjs';

export const SA_CHANNEL = 'Seeking Alpha · 最新分析';
export const SA_URL = 'https://seekingalpha.com/latest-articles';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripTags = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decodeEntities = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// ===================== 列表页解析 =====================
/**
 * 解析 seekingalpha.com/latest-articles（或其缓存/快照 HTML）中的文章列表。
 * 多策略容错：逐个 /article/<id>-<slug> 锚点切块，从块内提取标题、时间、作者、标的代码。
 * @param {string} html
 * @returns {Array<{title:string,url:string,published:string,author:string,ticker:string}>}
 */
export function parseSeekingAlphaList(html) {
  const src = String(html || '');
  if (!src) return [];
  const out = [];
  const seen = new Set();
  // 锚点：href 形如 https://seekingalpha.com/article/4781234-slug-name（也可能相对路径）
  const anchorRe = /<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?seekingalpha\.com)?\/article\/(\d+)-([^"'?#]*)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(src))) {
    const id = m[1];
    if (seen.has(id)) continue;
    const href = `https://seekingalpha.com/article/${id}-${m[2] || ''}`;
    // 标题：优先锚点内 <h3>/<span data-test-id="post-list-item-title">，否则取锚点纯文本
    let title = stripTags(m[3]);
    const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(m[3]);
    if (h3) title = stripTags(h3[1]);
    if (!title || title.length < 8 || /^\d+\s*(comments?|评论)$/i.test(title)) continue;
    // 切块：限制在本卡片内（到下一个 /article/ 锚点为止），避免时间/作者/标的串到相邻卡片
    const afterStart = m.index + m[0].length;
    const nextRel = src.slice(afterStart).search(/\/article\/\d+-/);
    const chunk = src.slice(m.index, nextRel === -1 ? Math.min(src.length, afterStart + 1800) : afterStart + nextRel);
    const prevBoundary = src.lastIndexOf('/article/', Math.max(0, m.index - 1));
    const before = src.slice(prevBoundary === -1 ? Math.max(0, m.index - 400) : Math.max(prevBoundary, m.index - 400), m.index);
    // 时间：优先卡片内（data-date / <time datetime> / 显示文本），卡片无 meta 才回看标题前的小窗口
    let published = '';
    for (const ctx of [chunk, before]) {
      const tAttr = /data-date=["']([^"']+)["']/i.exec(ctx) || /<time[^>]*datetime=["']([^"']+)["']/i.exec(ctx);
      if (tAttr) { published = tAttr[1]; break; }
      const tText = /\b(Today,\s*\d{1,2}:\d{2}\s*[AP]M|Yesterday(?:,\s*\d{1,2}:\d{2}\s*[AP]M)?|[A-Z][a-z]{2}\.?\s+\d{1,2}(?:,\s*\d{4})?|\d+\s*(?:hours?|days?|minutes?)\s+ago)\b/i.exec(ctx);
      if (tText) { published = tText[1]; break; }
    }
    // 作者：/author/ 或 /analysis/（贡献者主页）链接文本（同样卡片内优先）
    let author = '';
    for (const ctx of [chunk, before]) {
      const aM = /<a\b[^>]*href=["'][^"']*\/(?:author|analysis)\/[^"']*["'][^>]*>([\s\S]{0,120}?)<\/a>/i.exec(ctx);
      if (aM) { author = stripTags(aM[1]); break; }
    }
    // 标的：/symbol/XXXX 链接（卡片内优先）
    let ticker = '';
    for (const ctx of [chunk, before]) {
      const sM = /\/symbol\/([A-Z][A-Z0-9.\-]{0,9})\b/i.exec(ctx);
      if (sM) { ticker = sM[1]; break; }
    }
    seen.add(id);
    out.push({ title: decodeEntities(title), url: href, published, author, ticker });
  }
  return out;
}

// ===================== 时效解析（SA 相对时间） =====================
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/**
 * 解析 SA 列表时间文案 → { publishedAt, ageMs, label } | null。
 * 支持：Today, 5:28 PM / Yesterday / Yesterday, 8:15 AM / Oct. 7 / Oct. 7, 2025 / 3 hours ago。
 * 「Today」按美东展示语义折算到 now 的同一天（误差远小于 72 小时窗口）。
 */
export function parseSAPublished(text, now = Date.now()) {
  const s = String(text || '').trim();
  if (!s) return null;
  const base = new Date(now);
  const label = s;
  const clock = /(\d{1,2}):(\d{2})\s*([AP])\.?M\.?/i.exec(s);
  const setClock = (date) => {
    if (!clock) return date;
    let h = Number(clock[1]) % 12;
    if (/p/i.test(clock[3])) h += 12;
    date.setHours(h, Number(clock[2]), 0, 0);
    return date;
  };
  // X minutes/hours/days ago
  const rel = /(\d+)\s*(minutes?|hours?|days?)\s+ago/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = /min/i.test(rel[2]) ? 60000 : /hour/i.test(rel[2]) ? 3600000 : 86400000;
    return { publishedAt: new Date(now - n * unit).toISOString(), ageMs: n * unit, label };
  }
  if (/today/i.test(s)) {
    const d = setClock(new Date(base));
    const ageMs = Math.max(0, now - d.getTime());
    return { publishedAt: d.toISOString(), ageMs, label };
  }
  if (/yesterday/i.test(s)) {
    const d = setClock(new Date(base));
    d.setDate(d.getDate() - 1);
    return { publishedAt: d.toISOString(), ageMs: Math.max(0, now - d.getTime()), label };
  }
  // Oct. 7 / Oct 7 / Oct. 7, 2025 / Tue, Oct 6
  const md = /(?:[A-Z][a-z]{2},?\s+)?([A-Z][a-z]{2})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(s);
  if (md) {
    const month = MONTHS[md[1].toLowerCase()];
    if (month) {
      const year = md[3] ? Number(md[3]) : base.getFullYear();
      const d = setClock(new Date(year, month - 1, Number(md[2])));
      return { publishedAt: d.toISOString(), ageMs: Math.max(0, now - d.getTime()), label };
    }
  }
  return null;
}

// ===================== 条目结构归一 =====================
/**
 * 把 SA 原始条目归一为简报条目（与扫描结果同构：时效字段 + 状态徽章）。
 * bullBear 由上层（AI / 本地规则）填充；此处先按标题走本地规则兜底。
 */
export function normalizeSAItem(raw = {}, now = Date.now()) {
  const pub = parseSAPublished(raw.published, now) || (raw.publishedAt ? { publishedAt: raw.publishedAt, ageMs: Math.max(0, now - new Date(raw.publishedAt).getTime()), label: raw.published } : null);
  const item = {
    id: raw.id || (raw.url || '').match(/\/article\/(\d+)/)?.[1] || `sa-${Math.random().toString(36).slice(2, 9)}`,
    channel: SA_CHANNEL,
    title: raw.titleZh || raw.title,
    originalTitle: raw.titleZh ? raw.title : '',
    summaryZh: raw.summaryZh || '',
    author: raw.author || '',
    ticker: raw.ticker || '',
    url: raw.url || SA_URL,
    published: pub ? pub.label : (raw.published || ''),
    publishedLabel: pub ? pub.label : (raw.published || ''),
    publishedAt: pub ? pub.publishedAt : '',
    publishedAgeMs: pub ? pub.ageMs : null,
    publishedSource: 'relative',
    freshWindow: FRESH_WINDOW_LABEL,
    status: raw.summaryZh ? '全文中文解析' : '标题中文解析'
  };
  if (item.publishedAt) item.publishedMacau = formatMacau(item.publishedAt);
  const fresh = evaluateFreshness({ published: item.publishedLabel, publishedAt: item.publishedAt }, now);
  item._fresh = fresh;
  // 兜底多空概率：本地规则（上层有 AI 时会覆盖）
  const guess = ruleLongShort({ title: `${item.title} ${item.originalTitle}`, transcript: item.summaryZh });
  item.bullBear = raw.bullBear && normalizeProbability(raw.bullBear)
    ? { bull: normalizeProbability(raw.bullBear).bull, bear: normalizeProbability(raw.bullBear).bear, note: raw.bullBear.note || guess.note, source: raw.bullBear.source || 'rule' }
    : { bull: guess.bull, bear: guess.bear, note: guess.note, source: 'rule' };
  return item;
}

// ===================== 微信推送 HTML（五档色深 inline） =====================
/**
 * 生成「Seeking Alpha · 最新分析」推送块（微信会剥离 class，全部 inline）。
 * 色深五档：标题 #eafff0 · 突出 #00ff66 · 重点 #b8f2cb · 正文 #8fdca4 · 说明 #63b47f。
 */
export function renderSeekingAlphaPush(items = []) {
  const list = (items || []).filter(x => x && !x.error);
  if (!list.length) return '';
  const lsBarPush = (v, w = 10) => {
    const k = Math.max(0, Math.min(w, Math.round(v / 100 * w)));
    return '█'.repeat(k) + '░'.repeat(w - k);
  };
  const cards = list.map((x, i) => {
    const bb = normalizeProbability(x.bullBear) ? x.bullBear : null;
    const ls = bb ? `
        <div style="margin-top:6px;padding:6px 7.5px;background:#031203;border:1px solid #0d9b4c;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4.5px;font-family:'Courier New',Consolas,monospace;font-size:7px;flex-wrap:wrap;">
            <span style="background:#00ff66;color:#041404;padding:0.75px 3.75px;font-weight:700;letter-spacing:0.5px;">AI 多空概率</span>
            <span style="background:#041404;color:#b8f2cb;padding:0.75px 3.75px;font-weight:700;">多 ${bb.bull}% / 空 ${bb.bear}%</span>
          </div>
          <div style="margin-top:4.5px;font-family:'Courier New',Consolas,monospace;font-size:8.5px;color:#b8f2cb;font-weight:700;line-height:1.7;word-break:break-all;white-space:pre-wrap;">多 ${lsBarPush(bb.bull)} ${bb.bull}%
空 ${lsBarPush(bb.bear)} ${bb.bear}%</div>
          <div style="margin-top:3px;font-family:'Courier New',Consolas,monospace;font-size:7px;color:#63b47f;line-height:1.5;">${esc(bb.note || '')} · 模型：${esc(bb.source === 'ai' ? 'DeepSeek 多空推理' : '本地规则推算（未配置 AI Key）')} · 仅供研究参考，不构成投资建议</div>
        </div>` : '';
    return `
    <section style="margin:7.5px 0;border:1px solid #0d9b4c;background:#072007;box-shadow:0 0 6px rgba(0,255,102,0.15);font-family:'Courier New',Consolas,'SimSun',monospace;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:4.5px;background:#00ff66;color:#041404;padding:2.25px 6px;font-family:'Courier New',Consolas,monospace;font-size:8px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:4.5px;min-width:0;word-break:break-all;">
          <span style="background:#041404;color:#00ff66;padding:0.75px 3.75px;font-weight:400;">SA#${i + 1}</span>
          <span>SA ▸ ${esc(x.ticker || 'MARKET')}</span>
        </div>
        <span style="background:#041404;color:#8fdca4;padding:0.75px 3.75px;flex-shrink:0;font-weight:400;">${esc(x.status || '中文解析')}</span>
      </div>
      <div style="padding:7.5px 9px;">
        <div style="color:#2c6742;font-family:'Courier New',Consolas,monospace;font-size:7.5px;letter-spacing:0.5px;font-weight:400;">C:\\SA\\LOGS&gt; ${esc(x.publishedLabel || '')}${x.publishedMacau ? ' · ' + esc(x.publishedMacau) : ''}${x.author ? ' · ' + esc(x.author) : ''} · 时效验证 ✓ ${FRESH_WINDOW_LABEL}内</div>
        <h3 style="margin:4.5px 0 1.5px;">
          <a href="${esc(x.url)}" style="color:#eafff0;font-weight:700;font-size:11.5px;line-height:1.35;text-decoration:underline;text-decoration-color:#3f8f5b;text-underline-offset:3px;word-break:break-all;">&gt; ${esc(x.title)}</a>
        </h3>
        ${x.originalTitle ? `<div style="margin:0 0 6px;color:#63b47f;font-family:'Courier New',Consolas,monospace;font-size:8px;line-height:1.4;word-break:break-all;">EN ▸ ${esc(x.originalTitle)}</div>` : ''}
        ${x.summaryZh ? `<div style="margin-top:6px;padding:6px 7.5px;background:#031203;border-left:3px solid #0d9b4c;color:#8fdca4;white-space:pre-wrap;word-break:break-word;font-size:9.5px;line-height:1.55;font-weight:400;">${esc(x.summaryZh)}</div>` : ''}
        ${ls}
      </div>
    </section>`;
  }).join('');
  const agg = aggregateLongShort(list);
  const head = `
    <section style="margin:9px 0;border:1px solid #0d9b4c;background:#072007;box-shadow:0 0 8px rgba(0,255,102,0.18);font-family:'Courier New',Consolas,'SimSun',monospace;">
      <div style="display:flex;justify-content:space-between;align-items:center;background:#00ff66;color:#041404;padding:2.25px 6px;font-family:'Courier New',Consolas,monospace;font-size:8px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;gap:3px;">
        <div style="display:flex;align-items:center;gap:4.5px;">
          <span style="background:#041404;color:#00ff66;padding:0.75px 3.75px;">■</span>
          <span>C:\\SA\\LATEST.EXE</span>
        </div>
        <span style="background:#041404;color:#00ff66;padding:0.75px 4.5px;">SEEKING ALPHA · 最新分析 · ${list.length} 条</span>
      </div>
      <div style="padding:6px 9px;">
        <div style="font-family:'Courier New',Consolas,monospace;font-size:8px;color:#00ff66;font-weight:700;letter-spacing:1px;">▌GLOBAL ANALYSIS / 全球分析精选</div>
        ${agg ? `<div style="margin-top:4.5px;font-family:'Courier New',Consolas,monospace;font-size:8.5px;font-weight:700;color:#b8f2cb;">SA 全景：${bullBearBar(agg, 8)} <span style="color:#63b47f;font-weight:400;">· ${esc(probabilitySourceText(agg.source))}</span></div>` : ''}
        <div style="margin-top:3px;font-family:'Courier New',Consolas,monospace;font-size:7px;color:#63b47f;">来源：seekingalpha.com/latest-articles · 英文原文已逐条解析为中文 · 仅供研究参考，不构成投资建议</div>
      </div>
    </section>`;
  return head + cards;
}

// ===================== 离线示例数据（真实读取的今日文章） =====================
// 2026-10-09 读取 seekingalpha.com/latest-articles「ALL ANALYSIS ARTICLES」当日列表，
// 逐条译为中文并给出多空概率（章鱼 AI 混合推理）；用于无外网/被限流时的栏目预览。
export function buildDemoSeekingAlpha(now = Date.now()) {
  const raws = [
    { hoursAgo: 3, published: 'Today, 5:28 PM', ticker: 'NLY', author: 'C Jessen',
      title: 'Annaly A Better Pick Here Relative To AGNC', titleZh: 'Annaly 相对 AGNC 是当下更好的选择',
      summaryZh: 'mREIT 双雄对比：Annaly 在利差空间、久期管理与股息可持续性上相对 AGNC 更占优，作者倾向 NLY。',
      bullBear: { bull: 58, bear: 42, note: '偏多：利差与股息相对占优', source: 'ai' } },
    { hoursAgo: 3, published: 'Today, 5:24 PM', ticker: 'NVAX', author: 'Trapping Value',
      title: 'Novavax: Sell The False Plague Breakout', titleZh: 'Novavax：卖出虚假的疫情突破行情',
      summaryZh: '疫情概念脉冲缺乏基本面支撑，突破或为假突破，作者提示逢高了结、警惕回落。',
      bullBear: { bull: 22, bear: 78, note: '偏空：题材脉冲 / 假突破', source: 'ai' } },
    { hoursAgo: 4, published: 'Today, 4:55 PM', ticker: 'LITE', author: 'Stone Fox Capital',
      title: 'Lumentum: Conquering Connectivity Is Critical In Artificial Intelligence', titleZh: 'Lumentum：攻克互连是人工智能的关键',
      summaryZh: 'AI 算力扩张带动光互连需求，Lumentum 在激光器与光模块环节卡位关键，景气度向上。',
      bullBear: { bull: 72, bear: 28, note: '偏多：AI 光互连 / 算力需求', source: 'ai' } },
    { hoursAgo: 4, published: 'Today, 4:32 PM', ticker: 'US10Y', author: 'Stanford Chemist',
      title: 'The 10-Year Treasury Yield May Be About To Hit 6%', titleZh: '10 年期美债收益率或即将触及 6%',
      summaryZh: '财政供给与通胀黏性推升长端利率，若逼近 6%，股票估值与融资成本将双双承压。',
      bullBear: { bull: 32, bear: 68, note: '偏空：长端利率上行 / 估值压力', source: 'ai' } },
    { hoursAgo: 5, published: 'Today, 4:00 PM', ticker: 'VPL', author: 'Eugenio Catone',
      title: 'VPL: Pacific Stocks Sport Big EPS Growth And A Low P/E', titleZh: 'VPL：亚太股票盈利增速可观且市盈率低',
      summaryZh: '亚太市场盈利上修与低估值并存，风险收益比优于美股大盘，分散化配置价值凸显。',
      bullBear: { bull: 64, bear: 36, note: '偏多：盈利增长 / 低估值', source: 'ai' } },
    { hoursAgo: 5, published: 'Today, 3:38 PM', ticker: 'SNPS', author: 'Mike Zaccardi, CFA, CMT',
      title: 'Synopsys: A Low-Risk, High-Reward Play On The AI Chip Design Market', titleZh: 'Synopsys：AI 芯片设计市场的低风险高回报之选',
      summaryZh: 'EDA 寡头格局稳固，AI 芯片设计浪潮推升订单能见度，确定性溢价合理。',
      bullBear: { bull: 70, bear: 30, note: '偏多：EDA 订单 / AI 设计需求', source: 'ai' } },
    { hoursAgo: 5, published: 'Today, 3:35 PM', ticker: 'REET', author: 'The Asian Investor',
      title: 'REET: The Two Enemies I Can\'t Ignore', titleZh: 'REET：两个无法忽视的敌人',
      summaryZh: '全球地产 REIT 同时面对利率高企与办公物业空置两大逆风，估值修复受限。',
      bullBear: { bull: 36, bear: 64, note: '偏空：利率逆风 / 空置压力', source: 'ai' } },
    { hoursAgo: 5, published: 'Today, 3:32 PM', ticker: 'AAII', author: 'Financial Serenity',
      title: 'AAII Sentiment Survey: Pessimism Plummets', titleZh: 'AAII 情绪调查：悲观情绪骤降',
      summaryZh: '散户看空比例大降、乐观情绪回升；情绪回暖利好短期，但反向指标提示交易拥挤风险。',
      bullBear: { bull: 52, bear: 48, note: '中性：情绪回暖但反向指标警示', source: 'ai' } },
    { hoursAgo: 6, published: 'Today, 3:21 PM', ticker: 'ITRG', author: 'The Bullionaire',
      title: 'Integra Resources: The Market Pays For One Mine, And I Get The Second For Free', titleZh: 'Integra Resources：市场只给一座矿定价，第二座矿免费送',
      summaryZh: '两座金矿资产仅其一被计入市值，第二座构成隐含期权，资源价值存在折价。',
      bullBear: { bull: 66, bear: 34, note: '偏多：资产折价 / 隐含期权', source: 'ai' } },
    { hoursAgo: 6, published: 'Today, 3:18 PM', ticker: 'TECK', author: 'CAN Analyst',
      title: 'Teck Resources: Lower Risk, But Valuation Still Looks Full', titleZh: 'Teck Resources：风险下降，但估值依然偏高',
      summaryZh: '转型纯铜矿后执行力改善、经营风险回落，但盈利改善已部分透支，上行空间受限。',
      bullBear: { bull: 45, bear: 55, note: '中性偏空：估值偏高 / 风险回落', source: 'ai' } },
    { hoursAgo: 6, published: 'Today, 3:16 PM', ticker: 'FLIN', author: 'Multiplo Invest',
      title: 'FLIN: Economy Growing At A Fast Pace And Valuation Becoming Cheaper (Rating Upgrade)', titleZh: 'FLIN：经济高速增长、估值渐趋便宜（评级上调）',
      summaryZh: '印度经济增速领先且估值回落至合理区间，作者由中性上调至积极。',
      bullBear: { bull: 68, bear: 32, note: '偏多：增长强劲 / 估值回落', source: 'ai' } },
    { hoursAgo: 7, published: 'Today, 2:00 PM', ticker: 'SPY', author: 'Bret Jensen',
      title: 'AI: More Off-Balance Sheet Shenanigans', titleZh: 'AI：更多表外财技',
      summaryZh: '警示 AI 巨头以表外结构隐藏资本开支与债务，盈利质量存疑，泡沫争论升温。',
      bullBear: { bull: 34, bear: 66, note: '偏空：表外风险 / 盈利质量', source: 'ai' } }
  ];
  const items = [], hidden = [];
  for (const r of raws) {
    // 时效统一按 hoursAgo 回推，publishedLabel 保留 SA 原文相对时间
    const iso = new Date(now - r.hoursAgo * 3600 * 1000).toISOString();
    const it = normalizeSAItem({ ...r, published: '', publishedAt: iso }, now);
    it.publishedLabel = r.published;
    it.publishedMacau = formatMacau(it.publishedAt);
    it.publishedAgeMs = r.hoursAgo * 3600 * 1000;
    const fresh = evaluateFreshness({ publishedAt: it.publishedAt }, now);
    if (fresh.ok) items.push(it);
    else hidden.push({ channel: SA_CHANNEL, title: it.title, url: it.url, reason: fresh.reason || `超出 ${FRESH_WINDOW_LABEL}窗口` });
  }
  return { items, hidden };
}
