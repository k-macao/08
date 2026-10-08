// ai.mjs — 章鱼 AI·全景分析 · AI 总结模块
// 单一职责：接收扫描结果数组 → 输出"主题聚类"风格的总结 JSON。
// 提供方：DeepSeek（OpenAI 兼容协议）。也支持任意 OpenAI 兼容 base_url，通过环境变量切换。
//
// 入口：
//   summarize(items, opts)        → { main, hotTopics, risks, opportunities, perVideo } | null
//   analyzeLongShort(items, opts) → [{ bull, bear, note, source }]，逐条「AI 多空概率」
//   renderSummaryHtml(summary)    → AI 总结块的 HTML 片段（含全景多空概率）
//   - 失败一律降级（AI 多空概率降级为本地规则推算；总结降级为无总结推送），绝不伪造 AI 结果
//   - 通过 opts.onLog(...) 输出进度日志（CI 用 console.log，前端可注入）
//
// 环境变量：
//   DEEPSEEK_API_KEY    必填。也可改用 OPENAI_API_KEY。
//   DEEPSEEK_BASE_URL   可选，默认 https://api.deepseek.com/v1
//   DEEPSEEK_MODEL      可选，默认 deepseek-chat
//   DEEPSEEK_TIMEOUT_MS 可选，默认 50000
//
// 设计要点：
//   1) 严格 JSON 输出，提示词反复强调"只回 JSON，不要任何解释"；
//   2) 输出失败时尝试宽松正则抽取 {...}，仍失败则返回 null；
//   3) 每条字幕截断 4000 字、整体 prompt 控制在约 60k 字符以内；
//   4) perVideo 的 key 用 `${i}:${channel}` 形式，调用方可对齐回原数组；
//   5) 多空概率禁止输出个股买卖建议（目标价 / 买卖评级等一律净化）。

import { ruleLongShort, normalizeProbability, sanitizeNote, bullBearBar } from './longshort.mjs';


const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT = 50000;
const PER_VIDEO_TRANSCRIPT_CHARS = 4000; // 单条字幕喂给 AI 的上限
const MAX_ITEMS = 200;                   // 安全上限（56 频道 × 3 = 168，留余量）

function getConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || DEFAULT_TIMEOUT;
  return { apiKey, baseUrl, model, timeoutMs };
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…（已截断）' : s;
}

function buildPrompt(items) {
  // 构造输入：每条一行，编号 + 频道 + 标题 + 字幕
  const lines = [];
  lines.push('你是一名中文财经情报编辑，负责把多支 YouTube 财经频道的当日视频字幕汇总成一份"主题聚类"简报。');
  lines.push('');
  lines.push('【任务】');
  lines.push('1. 阅读下面所有视频的关键信息（标题 + 频道 + 字幕摘要）。');
  lines.push('2. 把内容按"主题"归类（板块与行业 / 宏观与利率 / 政策与监管 / 产业与公司 / 地缘与汇率 / 其他）。');
  lines.push('3. 输出严格的 JSON，不要任何额外解释、不要 Markdown 代码块、不要前后缀文字。');
  lines.push('3.5 重要：本简报为"全景汇总"，禁止输出任何"个股页"、按个股拆分的板块、单股分析或买卖建议（不得出现目标价、买入/卖出评级等个股推荐内容）；涉及个股的信息只作为全景叙述的一部分简要带过。');
  lines.push('4. JSON 字段：');
  lines.push('   {');
  lines.push('     "main": "今日主线",       // 80-150 字，一段话概括市场/舆论最核心的故事');
  lines.push('     "hotTopics": ["…"],     // 3-6 条热点话题，每条 ≤ 40 字');
  lines.push('     "risks": ["…"],         // 2-5 条风险点，每条 ≤ 40 字');
  lines.push('     "opportunities": ["…"], // 2-5 条机会点，每条 ≤ 40 字');
  lines.push('     "perVideo": {            // 可选：给每条视频一个 1-2 句核心要点');
  lines.push('       "<key>": "要点"       // key 用每条视频开头的编号 "i:channelName"');
  lines.push('     }');
  lines.push('   }');
  lines.push('5. 提示：每条视频前的编号是 "i:channelName" 形式（i 是从 0 开始的整数），perVideo 字段使用同样的 key。');
  lines.push('6. 重要：只基于下方提供的内容做总结，不要编造视频里没有的事实、数字、人名。');
  lines.push('7. 重要：仅作研究参考，不构成投资建议——这条规则也体现在 main 段落的语气里（中性、克制）。');
  lines.push('');
  lines.push('【视频清单】');
  items.forEach((x, i) => {
    if (x && x.error) {
      lines.push(`[${i}:${x.channel || '?'}] (扫描异常) ${String(x.error || '').slice(0, 200)}`);
      return;
    }
    const title = truncate(x.title || '(无标题)', 120);
    const channel = truncate(x.channel || '?', 60);
    const published = x.published || '';
    const status = x.status || '';
    const transcript = truncate(x.transcript || '(无字幕)', PER_VIDEO_TRANSCRIPT_CHARS);
    lines.push(`[${i}:${channel}] ${title}`);
    if (published) lines.push(`  · 发布：${published}`);
    if (status) lines.push(`  · 状态：${status}`);
    lines.push(`  · 字幕：${transcript}`);
    lines.push('');
  });
  return lines.join('\n');
}

// 从模型可能"夹带"解释文字的输出里抽 JSON
function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  // 1) 直接 parse
  try { return JSON.parse(trimmed); } catch {}
  // 2) 抽 ```json ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  // 3) 抽第一个 {...} 顶层对象
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

// 归一化模型输出
function normalize(raw, items) {
  if (!raw || typeof raw !== 'object') return null;
  // 全景汇总策略：个股页/个股推荐类条目一律剔除（不推个股页）
  const STOCK_ENTRY_RE = /个股页|個股頁|STOCK PAGE|个股推荐|個股推薦|目标价|目標價|买入评级|買入評級|卖出评级|賣出評級/;
  const toArr = v => Array.isArray(v) ? v.filter(x => x && String(x).trim() && !STOCK_ENTRY_RE.test(String(x))).map(x => String(x).trim().slice(0, 200)) : [];
  const main = typeof raw.main === 'string' ? raw.main.trim().slice(0, 800) : '';
  const hotTopics = toArr(raw.hotTopics).slice(0, 6);
  const risks = toArr(raw.risks).slice(0, 5);
  const opportunities = toArr(raw.opportunities).slice(0, 5);
  let perVideo = {};
  if (raw.perVideo && typeof raw.perVideo === 'object') {
    for (const [k, v] of Object.entries(raw.perVideo)) {
      if (typeof v === 'string' && v.trim()) perVideo[String(k)] = v.trim().slice(0, 240);
    }
  }
  // 兜底：模型没回 main 时，临时拼一句
  if (!main) {
    const ok = items.filter(x => x && !x.error).length;
    return { main: `本次汇总 ${items.length} 条情报，其中 ${ok} 条已读取字幕。AI 总结未给出主线段。`, hotTopics, risks, opportunities, perVideo };
  }
  return { main, hotTopics, risks, opportunities, perVideo };
}

/**
 * 调 DeepSeek 总结
 * @param {Array} items  扫描结果（与 /api/scan 返回的 items 形状一致）
 * @param {Object} opts  { onLog?: (s)=>void, signal?: AbortSignal }
 * @returns {Promise<Object|null>}
 */
export async function summarize(items, opts = {}) {
  const onLog = opts.onLog || (() => {});
  if (!Array.isArray(items) || !items.length) {
    onLog('[ai] 无可总结内容，跳过');
    return null;
  }
  const cfg = getConfig();
  if (!cfg.apiKey) {
    onLog('[ai] 未配置 DEEPSEEK_API_KEY / OPENAI_API_KEY，跳过 AI 总结');
    return null;
  }

  const safeItems = items.slice(0, MAX_ITEMS);
  const prompt = buildPrompt(safeItems);
  onLog(`[ai] 调用 ${cfg.model}，输入 ${items.length} 条，prompt ${prompt.length} 字符`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const signal = opts.signal || controller.signal;

  let resp;
  try {
    resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是严谨的中文财经情报编辑。严格只回 JSON，不要任何解释。' },
          { role: 'user', content: prompt }
        ]
      }),
      signal
    });
  } catch (e) {
    clearTimeout(timer);
    onLog(`[ai] 网络异常：${e.message || e}`);
    return null;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    onLog(`[ai] HTTP ${resp.status}：${t.slice(0, 300)}`);
    return null;
  }

  let data;
  try { data = await resp.json(); }
  catch (e) { onLog(`[ai] 响应非 JSON：${e.message}`); return null; }

  const text = data?.choices?.[0]?.message?.content || '';
  onLog(`[ai] 模型返回 ${text.length} 字符`);
  if (data?.usage) onLog(`[ai] token usage: ${JSON.stringify(data.usage)}`);

  const parsed = extractJson(text);
  if (!parsed) {
    onLog(`[ai] 无法解析 JSON，输出前 300 字：${text.slice(0, 300)}`);
    return null;
  }
  const norm = normalize(parsed, safeItems);
  onLog(`[ai] 总结完成：main ${norm.main.length} 字 / 热点 ${norm.hotTopics.length} / 风险 ${norm.risks.length} / 机会 ${norm.opportunities.length}`);
  return norm;
}


/**
 * 逐条推算「AI 多空概率」（看多 bull% / 看空 bear%，相加 = 100）。
 * - 有 AI Key：一次调用覆盖本批全部条目，严格 JSON；
 * - 无 Key / 调用失败 / 单条缺失：该条降级为本地规则推算（source:'rule'，界面上明确标注）。
 * @param {Array} items 扫描结果（形状同 /api/scan 的 items）
 * @param {Object} opts { onLog?: (s)=>void, signal?: AbortSignal, maxTranscriptChars?: number }
 * @returns {Promise<Array<{bull:number,bear:number,note:string,source:'ai'|'rule'}>>} 与 items 等长
 */
export async function analyzeLongShort(items, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const list = Array.isArray(items) ? items : [];
  const results = list.map(x => ruleLongShort(x || {}));
  if (!list.length) return results;

  const cfg = getConfig();
  if (!cfg.apiKey) {
    onLog('[ai-ls] 未配置 DEEPSEEK_API_KEY / OPENAI_API_KEY，多空概率降级为本地规则推算');
    return results;
  }

  const maxChars = Number(opts.maxTranscriptChars) || 800;
  const lines = [];
  lines.push('你是一名中文财经情绪量化分析师。阅读下面每条内容（频道 + 标题 + 字幕摘录），');
  lines.push('为每条给出「看多概率 bull」与「看空概率 bear」，二者相加必须等于 100，整数，范围 5-95。');
  lines.push('要求：');
  lines.push('1. 只回严格 JSON，不要任何解释、不要 Markdown 代码块。');
  lines.push('2. 只能依据给定内容判断，不得编造事实、数字或人名。');
  lines.push('3. 禁止输出目标价、买入/卖出评级、个股推荐等任何投资建议；note 只描述情绪方向与驱动因素（≤ 24 字）。');
  lines.push('4. 若内容无明显方向（如纯资讯、无字幕且标题中性），bull/bear 给接近 50/50 的中性值，note 写“中性”。');
  lines.push('5. 返回格式：{"longShort":{"<key>":{"bull":58,"bear":42,"note":"..."}}}，key 使用每条开头的编号。');
  lines.push('');
  lines.push('【内容清单】');
  list.forEach((x, i) => {
    if (x && x.error) { lines.push(`[${i}:${x.channel || '?'}] (扫描异常，跳过)`); return; }
    lines.push(`[${i}:${String(x.channel || '?')}] ${truncate(x.title || '(无标题)', 120)}`);
    const t = truncate(x.transcript || '', maxChars);
    lines.push(`  · 字幕：${t || '(无字幕，仅依据标题判断)'}`);
  });
  const prompt = lines.join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const signal = opts.signal || controller.signal;
  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是严谨的中文财经情绪量化分析师。严格只回 JSON，不要任何解释。' },
          { role: 'user', content: prompt }
        ]
      }),
      signal
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      onLog(`[ai-ls] HTTP ${resp.status}：${t.slice(0, 200)}，多空概率降级为本地规则推算`);
      return results;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text);
    const blocks = parsed && typeof parsed === 'object'
      ? [parsed.longShort, parsed.多空概率, parsed.bullBear, parsed.data].find(b => b && typeof b === 'object' && !Array.isArray(b))
      : null;
    if (!blocks) {
      onLog(`[ai-ls] 无法解析多空概率 JSON，降级为本地规则推算：${text.slice(0, 160)}`);
      return results;
    }
    let hit = 0;
    list.forEach((x, i) => {
      const key = `${i}:${String((x && x.channel) || '?')}`;
      const raw = blocks[key] ?? blocks[String(i)] ?? Object.entries(blocks).find(([k]) => k.startsWith(`${i}:`))?.[1];
      const prob = normalizeProbability(raw);
      if (!prob) return;
      const note = sanitizeNote((raw && typeof raw === 'object' && raw.note) || '');
      results[i] = { bull: prob.bull, bear: prob.bear, note, source: 'ai' };
      hit++;
    });
    onLog(`[ai-ls] 多空概率：AI 命中 ${hit}/${list.length} 条，其余按本地规则推算`);
  } catch (e) {
    onLog(`[ai-ls] 网络/解析异常：${e.message || e}，多空概率降级为本地规则推算`);
  } finally {
    clearTimeout(timer);
  }
  return results;
}

/**
 * 把总结对象渲染成 HTML 片段（DOS 监视器 · 复古终端视觉风格）
 * @param {Object} summary  summarize() 的返回值
 * @param {Object} meta     { generatedAt: string, itemCount: number, longShort?: {bull,bear,count,source} }
 */
export function renderSummaryHtml(summary, meta = {}) {
  if (!summary) return '';
  const esc = s => String(s || '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
  const itemCount = meta.itemCount || 0;
  // 全景多空概率：由各条目的 AI 多空概率汇总而来（见 longshort.mjs aggregateLongShort）
  const ls = meta.longShort && normalizeProbability(meta.longShort) ? meta.longShort : null;
  const lsSource = ls ? (meta.longShort.source === 'ai' ? 'DeepSeek 多空推理' : meta.longShort.source === 'mixed' ? 'DeepSeek + 本地规则' : '本地规则推算') : '';
  const lsBar = ls ? bullBearBar(ls, 16) : '';

  const li = (arr, badgeText = '::') => (arr && arr.length)
    ? `<ul style="margin:6px 0 0 0;padding:0;list-style:none;font-family:'Courier New',Consolas,'SimSun',monospace;">${arr.map(x => `
        <li style="margin:4px 0;padding:5px 8px;background:#031203;border-left:3px solid #0d9b4c;color:#8fdca4;font-weight:400;font-size:11.5px;line-height:1.7;">
          <span style="color:#00ff66;font-weight:700;margin-right:6px;">${esc(badgeText)}</span>${esc(x)}
        </li>`).join('')}</ul>`
    : '<p style="margin:6px 0 0;color:#3f8f5b;font-size:10.5px;font-family:\'Courier New\',Consolas,monospace;">（无相关要点）</p>';

  return [
    '<section style="margin:12px 0;border:1px solid #0d9b4c;background:#072007;box-shadow:0 0 8px rgba(0,255,102,0.18);font-family:\'Courier New\',Consolas,\'SimSun\',monospace;">',
      // ── DOS 窗口标题栏 ──
      '<div style="display:flex;justify-content:space-between;align-items:center;background:#00ff66;color:#041404;padding:3px 8px;font-family:\'Courier New\',Consolas,monospace;font-size:10px;font-weight:700;letter-spacing:1px;flex-wrap:wrap;gap:4px;">',
        '<div style="display:flex;align-items:center;gap:6px;">',
          '<span style="background:#041404;color:#00ff66;padding:1px 5px;">■</span>',
          '<span>C:\\AI\\SUMMARY.EXE</span>',
        '</div>',
        `<span style="background:#041404;color:#00ff66;padding:1px 6px;">AI SUMMARY · 基于 ${itemCount} 条情报</span>`,
      '</div>',
      '<div style="padding:10px 12px;">',
        // ── 今日主线：黑屏看板 ──
        '<div style="background:#031203;border:1px solid #0d9b4c;padding:10px 12px;margin-bottom:10px;">',
          '<div style="font-family:\'Courier New\',Consolas,monospace;font-size:10px;color:#00ff66;font-weight:700;letter-spacing:1px;margin-bottom:6px;">',
            '▌TODAY MAIN QUEST / 今日主线',
          '</div>',
          `<p style="margin:0;color:#eafff0;font-weight:700;line-height:1.85;white-space:pre-wrap;word-break:break-word;font-size:12px;">${esc(summary.main)}</p>`,
          '<div style="margin-top:6px;font-family:\'Courier New\',Consolas,monospace;font-size:10px;color:#2c6742;">C:\\&gt; MAIN.TXT █</div>',
        '</div>',
        // ── 全景多空概率（AI 多空概率汇总） ──
        ls ? (
          '<div style="margin-top:10px;background:#031203;border:1px solid #0d9b4c;padding:8px 10px;">' +
            '<div style="display:flex;align-items:center;gap:6px;font-family:\'Courier New\',Consolas,monospace;font-size:10.5px;font-weight:700;color:#00ff66;letter-spacing:0.5px;margin-bottom:6px;">' +
              '<span style="background:#00ff66;color:#041404;padding:1px 5px;font-size:9px;">L/S</span>' +
              '<span>&gt; AI 多空概率 · LONG_SHORT.PROB</span>' +
              '<span style="margin-left:auto;background:#041404;color:#8fdca4;padding:1px 5px;font-size:9px;font-weight:400;">多 ' + ls.bull + '% / 空 ' + ls.bear + '%</span>' +
            '</div>' +
            '<div style="font-family:\'Courier New\',Consolas,monospace;font-size:10.5px;color:#8fdca4;line-height:1.9;word-break:break-all;">' + esc(lsBar) + '</div>' +
            '<div style="margin-top:4px;font-family:\'Courier New\',Consolas,monospace;font-size:9px;color:#3f8f5b;">基于 ' + Number(meta.longShort.count || itemCount) + ' 条内容 · ' + esc(lsSource) + ' · 仅供研究参考，不构成投资建议</div>' +
          '</div>'
        ) : '',
        // ── 热点 ──
        '<div style="margin-top:10px;">',
          '<div style="font-family:\'Courier New\',Consolas,monospace;font-size:10.5px;font-weight:700;color:#00ff66;display:flex;align-items:center;gap:6px;letter-spacing:0.5px;">',
            '<span style="background:#00ff66;color:#041404;padding:1px 5px;font-size:9px;">HOT</span>',
            '<span>&gt; 热点话题 · HOT_TOPICS.DAT</span>',
          '</div>',
          li(summary.hotTopics, '*'),
        '</div>',
        // ── 风险 ──
        '<div style="margin-top:10px;">',
          '<div style="font-family:\'Courier New\',Consolas,monospace;font-size:10.5px;font-weight:700;color:#ffb000;display:flex;align-items:center;gap:6px;letter-spacing:0.5px;">',
            '<span style="background:#ffb000;color:#041404;padding:1px 5px;font-size:9px;">RISK</span>',
            '<span>&gt; 风险点 · RISKS.DAT</span>',
          '</div>',
          li(summary.risks, '!'),
        '</div>',
        // ── 机会 ──
        '<div style="margin-top:10px;">',
          '<div style="font-family:\'Courier New\',Consolas,monospace;font-size:10.5px;font-weight:700;color:#00ff66;display:flex;align-items:center;gap:6px;letter-spacing:0.5px;">',
            '<span style="background:#00ff66;color:#041404;padding:1px 5px;font-size:9px;">OPS</span>',
            '<span>&gt; 机会点 · OPPORTUNITIES.DAT</span>',
          '</div>',
          li(summary.opportunities, '+'),
        '</div>',
      '</div>',
    '</section>'
  ].join('');
}
