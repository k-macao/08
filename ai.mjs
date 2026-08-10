// ai.mjs — 章鱼 AI·全景分析 · AI 总结模块
// 单一职责：接收扫描结果数组 → 输出"主题聚类"风格的总结 JSON。
// 提供方：DeepSeek（OpenAI 兼容协议）。也支持任意 OpenAI 兼容 base_url，通过环境变量切换。
//
// 入口：summarize(items, opts) → { main, hotTopics, risks, opportunities, perVideo } | null
//   - 失败一律返回 null（调用方需自行降级到"无 AI 总结"的原始推送）
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
//   4) perVideo 的 key 用 `${i}:${channel}` 形式，调用方可对齐回原数组。

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
  lines.push('2. 把内容按"主题"归类（个股/板块 / 宏观与利率 / 政策与监管 / 产业与公司 / 地缘与汇率 / 其他）。');
  lines.push('3. 输出严格的 JSON，不要任何额外解释、不要 Markdown 代码块、不要前后缀文字。');
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
  const toArr = v => Array.isArray(v) ? v.filter(x => x && String(x).trim()).map(x => String(x).trim().slice(0, 200)) : [];
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
 * 把总结对象渲染成 HTML 片段（用于塞到推送 HTML 顶部）
 * @param {Object} summary  summarize() 的返回值
 * @param {Object} meta     { generatedAt: string, itemCount: number }
 */
export function renderSummaryHtml(summary, meta = {}) {
  if (!summary) return '';
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stamp = meta.generatedAt || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Macau' });
  const itemCount = meta.itemCount || 0;
  const li = (arr, color) => (arr && arr.length)
    ? `<ul style="margin:8px 0 0 18px;padding:0;color:#eef0ff;font-family:monospace,'Noto Sans SC',sans-serif;font-size:12px;line-height:1.7;">${arr.map(x => `<li style="margin:5px 0;padding:4px 8px;background:rgba(255,255,255,.04);border-left:3px solid ${color};list-style:none;box-shadow:1px 1px 0 rgba(0,0,0,.4);">${esc(x)}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 0;color:#6f77ad;font-family:monospace,sans-serif;font-size:12px;">（无） · NO DATA</p>';
  return [
    '<section style="margin:16px 0;padding:0;border:3px solid #00ffd1;background:#0a0a1f;box-shadow:4px 4px 0 #ff2e93,0 0 14px rgba(0,255,209,.22);overflow:hidden;">',
      '<div style="height:4px;background:repeating-linear-gradient(90deg,#00ffd1 0 12px,#ffe600 12px 24px,#ff2e93 24px 36px);box-shadow:0 0 8px #00ffd1;"></div>',
      '<div style="padding:14px 14px 8px;background:linear-gradient(180deg,rgba(0,255,209,.12) 0,transparent 85%);border-bottom:2px dashed #2a2a66;">',
        '<div style="font-family:monospace,sans-serif;font-size:11px;letter-spacing:1px;color:#ffe600;font-weight:800;">▸ TRANSMISSION DECK // AI BATTLE ANALYSIS // ARCADE LEAGUE</div>',
        `<div style="margin:6px 0 0;font-family:monospace,sans-serif;font-size:15px;font-weight:900;color:#fff;letter-spacing:.5px;text-shadow:2px 2px 0 #7b2cff;">🧠 章鱼 AI · 主题聚类总结 <span style="background:#ff2e93;color:#fff;padding:2px 6px;font-size:10px;vertical-align:middle;box-shadow:2px 2px 0 #000;letter-spacing:.5px;">STAGE BOSS</span></div>`,
        `<div style="margin:6px 0 0;color:#9aa0c7;font-family:monospace,sans-serif;font-size:11px;">生成时间：${esc(stamp)}（澳门时间）· 基于 ${itemCount} 条情报 · RANK SSS · HP 100%</div>`,
      '</div>',
      '<div style="padding:14px;">',
        '<div style="border:2px solid #ffe600;background:rgba(255,230,0,.08);padding:10px;box-shadow:2px 2px 0 #000;">',
          '<div style="font-family:monospace,sans-serif;font-size:11px;color:#ffe600;font-weight:800;letter-spacing:.8px;">▶ TODAY MAIN QUEST / 今日主线</div>',
          `<p style="margin:8px 0 0;color:#eef0ff;line-height:1.85;white-space:pre-wrap;word-break:break-word;font-family:sans-serif,'Noto Sans SC',sans-serif;font-size:13px;">${esc(summary.main)}</p>`,
        '</div>',
        '<div style="margin:14px 0 0;color:#00ffd1;font-family:monospace,sans-serif;font-size:13px;font-weight:800;letter-spacing:.5px;">▦ 热点话题 · HOT TOPICS <span style="color:#6f77ad;font-size:10px;font-weight:400;">HP 88%</span></div>',
        li(summary.hotTopics, '#00ffd1'),
        '<div style="margin:14px 0 0;color:#ff2e93;font-family:monospace,sans-serif;font-size:13px;font-weight:800;">⚠ 风险点 · RISKS <span style="background:#ff2e93;color:#fff;padding:1px 5px;font-size:10px;box-shadow:1px 1px 0 #000;">ALERT</span></div>',
        li(summary.risks, '#ff2e93'),
        '<div style="margin:14px 0 0;color:#00ffd1;font-family:monospace,sans-serif;font-size:13px;font-weight:800;">◆ 机会点 · OPPORTUNITIES <span style="color:#00ffd1;background:rgba(0,255,209,.15);padding:1px 5px;font-size:10px;border:1px solid #00ffd1;">BUFF</span></div>',
        li(summary.opportunities, '#7b2cff'),
      '</div>',
      '<div style="background:repeating-linear-gradient(90deg,#1a1500 0 8px,#0a0a1f 8px 16px);border-top:2px solid #ffe600;color:#ffe600;font-family:monospace,sans-serif;font-size:7px;padding:6px 8px;letter-spacing:1px;text-align:center;">▮▮▮ ARCADE LEAGUE · OCTOPUS AI PANORAMA · INSERT COIN TO CONTINUE ▮▮▮</div>',
    '</section>'
  ].join('');
}
