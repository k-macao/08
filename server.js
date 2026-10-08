import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { summarize, renderSummaryHtml, analyzeLongShort } from './ai.mjs';
import { FRESH_WINDOW_LABEL, formatMacau, evaluateFreshness } from './freshness.mjs';
import { aggregateLongShort, normalizeProbability } from './longshort.mjs';

const PORT = process.env.PORT || 3000;
const clean = s => String(s || '').replace(/台湾|台灣/g, '中国台湾').replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_,c)=>String.fromCharCode(parseInt(c,16))).replace(/\\"/g,'"').replace(/&amp;/g,'&');
const json = (res, code, body) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };


// 英文内容统一以中文呈现：字幕优先使用 YouTube 的 zh-Hans 自动翻译；
// 标题通过公开翻译端点转换。网络不可用时保留原文并明确标示，绝不伪造翻译。
const titleTranslationCache = new Map();
const isEnglishSource = name => !/[\u3400-\u9fff]/.test(String(name || ''));
async function translateTitleToChinese(title) {
  const raw = String(title || '').trim();
  if (!raw || /[\u3400-\u9fff]/.test(raw)) return raw;
  if (titleTranslationCache.has(raw)) return titleTranslationCache.get(raw);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(raw.slice(0, 900));
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error('translation HTTP ' + response.status);
    const data = await response.json();
    const translated = Array.isArray(data?.[0]) ? data[0].map(part => part?.[0] || '').join('').trim() : '';
    const out = translated || raw;
    titleTranslationCache.set(raw, out);
    return out;
  } catch (e) {
    console.log(`[translate] 标题翻译失败：${e.message}`);
    titleTranslationCache.set(raw, raw);
    return raw;
  }
}

// ===================== 多方向读取：通用请求头 =====================
const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.6',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};
const YT_HEADERS_ALT = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// ===================== 搜索方向：自动构造多个查询词 =====================
function buildSearchQueries(name) {
  const base = String(name || '').trim();
  if (!base) return [];
  const variants = [];
  // 方向1：原始“名称 + 最新 财经”（最精准）
  variants.push(`${base} 最新 财经`);
  // 方向2：纯名称（解决：带后缀时 YouTube 搜不到）
  variants.push(base);
  // 方向3：去除常见后缀后的核心词（例如 “香港經濟日報 HKET” -> “香港經濟日報”）
  const stripped = base.replace(/\s*(HKET|HKBT|中文网|中文).*$/i, '').trim();
  if (stripped && stripped !== base) variants.push(stripped);
  // 方向4：名称 + “财经” （扩大召回）
  variants.push(`${base} 财经`);
  // 方向5：名称 + “官方 频道”（针对机构类频道）
  variants.push(`${base} 官方`);
  // 方向6：仅首段（针对含 “|”“·” 等分隔的复合名）
  const firstToken = base.split(/[\|\-·\/\s]+/)[0].trim();
  if (firstToken && firstToken.length >= 2 && firstToken !== base) variants.push(firstToken);
  // 去重并限 5 个方向（控制总耗时）
  const uniq = [];
  for (const v of variants) if (v && !uniq.includes(v)) uniq.push(v);
  return uniq.slice(0, 5);
}

// ===================== 解析方向：多正则/多结构解析 =====================
const MAX_CANDIDATES = 6; // 每个内容源先解析最多 6 条候选，再按“最近 72 小时”时效验证，最终保留最多 3 条

// 以 videoId 起点切出「这一条视频」自己的数据块（到下一个 videoId 为止，上限 6000 字符）。
// 这样取 publishedTimeText 时不会误抓到下一条视频的发布时间 —— 抓不到就留空，
// 交给 watch 页的绝对发布时间复核（仍无法验证则隐藏）。
function videoBlockOf(src, startIdx) {
  const next = src.indexOf('"videoId"', startIdx + 11);
  const end = next === -1 ? startIdx + 6000 : Math.min(next, startIdx + 6000);
  return src.slice(startIdx, end);
}
function pickPublishedTime(block) {
  const m = block.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/);
  return m ? m[1] : '';
}

function parseVideosWithStrategies(html) {
  const found = [];
  const seen = new Set();
  const push = (id, title, published, from) => {
    if (!id || seen.has(id)) return;
    if (!/^[\w-]{11}$/.test(id)) return;
    seen.add(id);
    // 发布时间未知时留空（不再默认“刚刚”），由 scan() 逐条做 72 小时时效验证
    found.push({ id, title: clean(decode(title || '未知标题')), published: clean(decode(published || '')), url: 'https://www.youtube.com/watch?v=' + id, _from: from });
  };

  // 策略1：原精确结构 title.runs.text（最常见）
  try {
    const rx = /"videoId":"([\w-]{11})"[\s\S]{0,1800}?"title":\{"runs":\[\{"text":"([\s\S]*?)"\}/g;
    let m; while ((m = rx.exec(html)) && found.length < MAX_CANDIDATES) {
      const pub = pickPublishedTime(videoBlockOf(html, m.index));
      push(m[1], m[2], pub, 's1-runs');
    }
  } catch {}

  // 策略2：simpleText 标题（部分页面/小型频道）
  if (found.length < MAX_CANDIDATES) {
    try {
      const rx2 = /"videoId":"([\w-]{11})"[\s\S]{0,2200}?"simpleText":"([^"]+)"/g;
      let m; while ((m = rx2.exec(html)) && found.length < MAX_CANDIDATES) {
        if (m[2].length < 2) continue;
        // 过滤明显非视频的导航文本
        if (/^(首页|Shorts|直播|频道|播放列表)/.test(m[2])) continue;
        const pub = pickPublishedTime(videoBlockOf(html, m.index));
        push(m[1], m[2], pub, 's2-simpleText');
      }
    } catch {}
  }

  // 策略3：通用 videoId 扫描 + 就近标题回退（应对页面结构微调）
  if (found.length < MAX_CANDIDATES) {
    try {
      const vidRx = /"videoId":"([\w-]{11})"/g;
      let m; while ((m = vidRx.exec(html)) && found.length < MAX_CANDIDATES) {
        if (seen.has(m[1])) continue;
        const slice = html.slice(m.index, m.index + 6000);
        let tm = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/);
        if (!tm) tm = slice.match(/"title":\{"simpleText":"([^"]+)"/);
        if (!tm) tm = slice.match(/"text":"([^"]+)"/);
        if (!tm) continue;
        if (tm[1].length < 2) continue;
        const pub = pickPublishedTime(videoBlockOf(html, m.index));
        push(m[1], tm[1], pub, 's3-generic');
      }
    } catch {}
  }

  // 策略4：ytInitialData 截断内的 videoRenderer（应对 consent/变形 HTML）
  if (found.length < MAX_CANDIDATES) {
    try {
      const ytMatch = html.match(/var ytInitialData\s*=\s*(\{[\s\S]+?\});/);
      const source = ytMatch ? ytMatch[1] : html;
      const rx = /"videoId":"([\w-]{11})"/g;
      let m; while ((m = rx.exec(source)) && found.length < MAX_CANDIDATES) {
        if (seen.has(m[1])) continue;
        const slice = source.slice(m.index, m.index + 4000);
        let tm = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/);
        if (!tm) tm = slice.match(/"simpleText":"([^"]+)"/);
        const title = tm ? tm[1] : '未知标题';
        push(m[1], title, '', 's4-ytInitialData');
      }
    } catch {}
  }

  // 策略5：watch 链接兜底（最宽松，仅在前面全空时启用，防止噪音）
  if (!found.length) {
    try {
      const rx = /\/watch\?v=([\w-]{11})/g;
      let m; while ((m = rx.exec(html)) && found.length < MAX_CANDIDATES) {
        if (seen.has(m[1])) continue;
        // 尽量找标题
        const slice = html.slice(Math.max(0, m.index - 2000), m.index + 4000);
        let tm = slice.match(/"title":\{"runs":\[\{"text":"([^"]+)"/);
        if (!tm) tm = slice.match(/"title":\{"simpleText":"([^"]+)"/);
        const title = tm ? tm[1] : `视频 ${m[1]}`;
        push(m[1], title, '', 's5-watchUrl');
      }
    } catch {}
  }

  return found.slice(0, MAX_CANDIDATES);
}

// ===================== 带多方向重试的 searchChannel =====================
async function searchChannel(name) {
  const queries = buildSearchQueries(name);
  if (!queries.length) throw new Error('频道名称为空');
  let lastError = null;
  const tried = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    tried.push(q);
    const directionLabel = `方向${qi + 1}/${queries.length}`;
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    // 每个方向最多 2 次 fetch（主 headers + 备用 headers），应对地区/风控差异
    const headerOptions = [YT_HEADERS, YT_HEADERS_ALT];
    let html = null;
    let fetchErr = null;
    for (let hi = 0; hi < headerOptions.length; hi++) {
      try {
        if (hi > 0) await new Promise(r => setTimeout(r, 300));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const r = await fetch(url, { headers: headerOptions[hi], signal: controller.signal }).finally(() => clearTimeout(timer));
        if (!r.ok) throw new Error('YouTube 返回 ' + r.status);
        html = await r.text();
        // 检测是否被风控/同意页拦截
        if (html && html.length < 8000 && /consent|CONSENT|我们的系统检测到异常流量/.test(html)) {
          throw new Error('YouTube 风控/同意页拦截');
        }
        if (!html || html.length < 2000) throw new Error('返回内容过短，可能被限流');
        fetchErr = null;
        break;
      } catch (e) {
        fetchErr = e;
        console.log(`[scan] ${name} ${directionLabel} “${q}” 请求${hi + 1}失败：${e.message}`);
        // hi loop will try next header
      }
    }
    if (!html) {
      lastError = fetchErr || new Error('请求失败');
      console.log(`[scan] ${name} ${directionLabel} “${q}” 无有效 HTML，尝试下一方向`);
      if (qi < queries.length - 1) await new Promise(r => setTimeout(r, 400));
      continue;
    }
    try {
      const found = parseVideosWithStrategies(html);
      if (found.length) {
        console.log(`[scan] ${name} ${directionLabel} “${q}” 命中 ${found.length} 条（${found.map(v => v._from).join(',')}）`);
        // 清理内部 _from 标记并标注方向
        return found.map(v => {
          const { _from, ...rest } = v;
          return { ...rest, direction: directionLabel };
        });
      } else {
        lastError = new Error(`未解析到视频`);
        console.log(`[scan] ${name} ${directionLabel} “${q}” 空结果（多策略均未命中），尝试下一方向`);
      }
    } catch (e) {
      lastError = e;
      console.log(`[scan] ${name} ${directionLabel} 解析异常：${e.message}`);
    }
    if (qi < queries.length - 1) await new Promise(r => setTimeout(r, 400));
  }
  // 全部方向失败 -> 抛异常，上层会记录为扫描异常
  throw new Error(`未解析到公开视频（已自动尝试 ${tried.length} 个搜索方向：${tried.join(' / ')}；末错：${lastError ? lastError.message : '未知'}）`);
}

// ===================== 字幕多方向读取 =====================
async function fetchTimedTextRaw(id, lang, opts = {}) {
  const params = new URLSearchParams({ v: id, lang });
  if (opts.tlang) params.set('tlang', opts.tlang);
  if (opts.fmt) params.set('fmt', opts.fmt);
  // kind=asr for auto-generated
  const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { headers: YT_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) return '';
    const xml = await r.text();
    if (!xml || xml.length < 10) return '';
    // 常见两种格式：<text>（默认）或 <p>（srv3）
    let parts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
    if (!parts.length) parts = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
    // srv1 json 格式兼容
    if (!parts.length && xml.includes('"events"')) {
      try {
        const j = JSON.parse(xml);
        if (j.events) parts = j.events.map(e => (e.segs || []).map(s => s.utf8 || '').join('')).filter(Boolean);
      } catch {}
    }
    const joined = parts.join(' ').trim();
    if (!joined) return '';
    return clean(decode(joined)).slice(0, 7000);
  } catch {
    return '';
  }
}

async function captions(id) {
  // 方向组1：直连 zh 各变体（覆盖大多数繁中频道）
  const langDirections = ['zh-Hant', 'zh-Hans', 'zh', 'zh-CN', 'zh-TW', 'zh-HK'];
  for (const lang of langDirections) {
    const t = await fetchTimedTextRaw(id, lang);
    if (t && t.length > 10) {
      console.log(`[caption] ${id} 命中直连 ${lang} (${t.length}字)`);
      return t;
    }
    // 尝试带 fmt 的备用（srv3）
    const t2 = await fetchTimedTextRaw(id, lang, { fmt: 'srv3' });
    if (t2 && t2.length > 10 && t2 !== t) {
      console.log(`[caption] ${id} 命中直连 ${lang} srv3 (${t2.length}字)`);
      return t2;
    }
  }

  // 方向组2：通过 list 接口发现可用轨道，再逐个尝试（自动发现）
  try {
    const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${id}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(listUrl, { headers: YT_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (r.ok) {
      const xml = await r.text();
      const tracks = [...xml.matchAll(/lang_code="([^"]+)"/g)].map(m => m[1]);
      if (tracks.length) console.log(`[caption] ${id} list 发现轨道: ${tracks.join(',')}`);
      // 优先 zh，再 en，再其他
      const score = l => l.startsWith('zh') ? 0 : l === 'en' || l.startsWith('en') ? 1 : 2;
      const prioritized = [...new Set(tracks)].sort((a, b) => score(a) - score(b));
      for (const lang of prioritized) {
        if (langDirections.includes(lang)) continue; // 已试过
        // 英文轨道必须先尝试翻译，确保英文平台的正文优先以中文输出。
        if (lang.startsWith('en')) {
          const tr = await fetchTimedTextRaw(id, lang, { tlang: 'zh-Hans' });
          if (tr && tr.length > 10) {
            console.log(`[caption] ${id} 命中翻译轨道 ${lang}->zh-Hans (${tr.length}字)`);
            return tr;
          }
          const tr2 = await fetchTimedTextRaw(id, lang, { tlang: 'zh-Hant' });
          if (tr2 && tr2.length > 10) return tr2;
        }
        const t = await fetchTimedTextRaw(id, lang);
        if (t && t.length > 10) {
          console.log(`[caption] ${id} 命中 list 轨道 ${lang} (${t.length}字)`);
          return t;
        }
      }
      // 已有轨道但未命中正文，尝试对第一条做翻译兜底
      if (prioritized.length) {
        for (const lang of prioritized.slice(0, 2)) {
          const tr = await fetchTimedTextRaw(id, lang, { tlang: 'zh-Hant' });
          if (tr && tr.length > 10) {
            console.log(`[caption] ${id} 命中翻译兜底 ${lang}->zh-Hant`);
            return tr;
          }
        }
      }
    }
  } catch (e) {
    console.log(`[caption] ${id} list 方向异常：${e.message}`);
  }

  // 方向组3：抓 watch 页抽 captionTracks（应对 timedtext 直连被限）
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const wp = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: YT_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (wp.ok) {
      const html = await wp.text();
      const capMatch = html.match(/"captionTracks":\[[\s\S]{0,10000}?\]/);
      if (capMatch) {
        const block = capMatch[0];
        const urls = [...block.matchAll(/"baseUrl":"([^"]+)"/g)].map(m => JSON.parse(`"${m[1]}"`).replace(/\\u0026/g, '&'));
        const langs = [...block.matchAll(/"languageCode":"([^"]+)"/g)].map(m => m[1]);
        if (urls.length) console.log(`[caption] ${id} watch页轨道 ${langs.join(',')}`);
        for (let i = 0; i < urls.length; i++) {
          try {
            const controller2 = new AbortController();
            const timer2 = setTimeout(() => controller2.abort(), 8000);
            const r2 = await fetch(urls[i], { headers: YT_HEADERS, signal: controller2.signal }).finally(() => clearTimeout(timer2));
            if (!r2.ok) continue;
            const txt = await r2.text();
            let parts = [...txt.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
            if (!parts.length) parts = [...txt.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
            const joined = clean(decode(parts.join(' '))).slice(0, 7000);
            if (joined.length > 10) {
              console.log(`[caption] ${id} watch页命中 ${langs[i] || 'unknown'} (${joined.length}字)`);
              return joined;
            }
          } catch {}
        }
        // 翻译兜底：对第一条轨道加 tlang
        if (urls.length) {
          try {
            const tUrl = urls[0].includes('?') ? urls[0] + '&tlang=zh-Hant' : urls[0] + '?tlang=zh-Hant';
            const r3 = await fetch(tUrl, { headers: YT_HEADERS });
            if (r3.ok) {
              const txt = await r3.text();
              let parts = [...txt.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
              if (!parts.length) parts = [...txt.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(x => x[1].replace(/<[^>]+>/g, ''));
              const joined = clean(decode(parts.join(' '))).slice(0, 7000);
              if (joined.length > 10) {
                console.log(`[caption] ${id} watch页翻译命中 (${joined.length}字)`);
                return joined;
              }
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.log(`[caption] ${id} watch页方向异常：${e.message}`);
  }

  // 方向组4：尝试 innertube 风格的自动字幕（最后兜底，尽力而为）
  // 若以上均失败，返回空字符串，上层只保留视频标题链接，不再输出“未提供公开中文字幕”提示块
  return '';
}
// ===================== 时效验证：最近 72 小时之内 =====================
// 规则（见 freshness.mjs / README）：
//   1) 搜索结果自带相对时间（“3小时前” / “2 days ago”）→ 直接裁决；
//   2) 相对时间缺失或不可解析 → 读取 watch 页的绝对发布时间（publishDate / uploadDate / datePublished）复核；
//   3) 仍无法验证发布时间 → 判定为过期并隐藏（绝不把不可考证的内容混进简报）。
const publishedAtCache = new Map(); // id -> ISO 字符串 | null
async function fetchPublishedAt(id) {
  if (publishedAtCache.has(id)) return publishedAtCache.get(id);
  let iso = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: YT_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (r.ok) {
      const html = await r.text();
      const patterns = [
        /"publishDate"\s*:\s*"([^"]+)"/,
        /"uploadDate"\s*:\s*"([^"]+)"/,
        /itemprop="datePublished"\s+content="([^"]+)"/,
        /"datePublished"\s*:\s*"([^"]+)"/
      ];
      for (const rx of patterns) {
        const m = html.match(rx);
        if (!m) continue;
        const d = new Date(m[1]);
        if (!Number.isNaN(d.getTime())) { iso = d.toISOString(); break; }
      }
    }
  } catch (e) {
    console.log(`[fresh] ${id} 发布时间复核失败：${e.message}`);
  }
  publishedAtCache.set(id, iso);
  return iso;
}

/**
 * 逐条时效裁决：先看搜索结果里的相对时间，必要时用 watch 页绝对时间复核。
 * @returns {Promise<{ok:boolean, publishedAt:string|null, ageMs:number|null, label:string, source:string, reason:string}>}
 */
async function verifyFreshness(video, now = Date.now()) {
  const verdict = evaluateFreshness(video, now);
  if (verdict.ok !== null) return verdict;
  const iso = await fetchPublishedAt(video.id);
  return evaluateFreshness({ published: video.published, publishedAt: iso }, now);
}

async function runFlows(token) {
  const repo = process.env.GITHUB_REPO || 'k-macao/08';
  const ref = process.env.GITHUB_REF || 'main';
  const url = `https://api.github.com/repos/${repo}/actions/workflows/oai.yml/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref })
  });
  return { ok: r.ok, status: r.status };
}
async function scan(names, limit = 50) {
 // 单次简报上限 50 条，避免长推送淹没重点；调用方可传入更小的剩余额度。
 const itemLimit = Math.max(1, Math.min(Number(limit) || 50, 50));
 // 章鱼 AI·全景分析：扫描所选频道，达到简报上限即停止。
 // 频道逐个顺序抓取，避免对 YouTube 产生过高并发；每个内容源最多保留 3 条「最近 72 小时内」的内容。
 //
 // 时效验证（新增）：每抓到一个候选先做 72 小时裁决 ——
 //   · 搜索结果相对时间可解析 → 直接裁决；
 //   · 不可解析 → 读 watch 页绝对发布时间复核（每源最多复核 4 条，控制耗时）；
 //   · 仍无法验证或已超时 → 判定为过期，直接隐藏，不进入简报（不读字幕、不占 50 条额度）。
 //
 // 异常频道自动多方向重试：searchChannel 内部已尝试 5 个搜索方向 × 2 套 headers × 4 套解析策略；
 // captions 内部已尝试 zh 多变体 × list 发现 × watch 页抽轨道 × 翻译，共 4 组字幕方向。
 const now = Date.now();
 const results = [];
 const stale = [];
 const PER_SOURCE_LIMIT = 3;   // 每个内容源最多保留 3 条
 const PROBE_BUDGET = 4;       // 每个内容源最多为 4 条候选去 watch 页复核绝对发布时间
 for (const name of names) {
  if (results.length >= itemLimit) break;
  try {
   const videos = await searchChannel(name);
   let kept = 0, probed = 0;
   for (const video of videos) {
    if (results.length >= itemLimit || kept >= PER_SOURCE_LIMIT) break;
    const needsProbe = evaluateFreshness(video, now).ok === null;
    if (needsProbe && probed >= PROBE_BUDGET) {
     stale.push({ channel: name, title: video.title, url: video.url, reason: `无法验证发布时间（已隐藏）` });
     continue;
    }
    if (needsProbe) probed++;
    const fresh = needsProbe ? await verifyFreshness(video, now) : evaluateFreshness(video, now);
    if (!fresh.ok) {
     console.log(`[fresh] 隐藏 ${name} · ${video.id}：${fresh.reason || '超出 72 小时窗口'}`);
     stale.push({ channel: name, title: video.title, url: video.url, reason: fresh.reason || `超出 ${FRESH_WINDOW_LABEL}窗口` });
     continue;
    }
    const transcript = await captions(video.id);
    const english = isEnglishSource(name);
    const originalTitle = video.title;
    const title = english ? await translateTitleToChinese(originalTitle) : originalTitle;
    results.push({...video, title, originalTitle: title !== originalTitle ? originalTitle : '', channel:name, transcript,
      // 时效字段：发布时间（ISO / 澳门时间文案 / 年龄）供网页与推送展示
      publishedAt: fresh.publishedAt, publishedLabel: fresh.label, publishedMacau: formatMacau(fresh.publishedAt),
      publishedAgeMs: fresh.ageMs, publishedSource: fresh.source, freshWindow: FRESH_WINDOW_LABEL,
      // 状态徽章：无公开字幕时不再显示“无公开中文字幕”，改由「AI 多空概率」接管（见下方 bullBear）
      status: transcript ? (english ? '中文翻译字幕' : '字幕已读取') : 'AI 多空概率'});
    kept++;
   }
   if (!kept) console.log(`[fresh] ${name}：72 小时内无可推送内容，该来源整体隐藏`);
  } catch (e) { if (results.length < itemLimit) results.push({channel:name, error:e.message}); }
  // 频道间礼貌间隔，降低限流概率
  if (names.length > 1) await new Promise(r => setTimeout(r, 180));
 }
 // ===================== AI 多空概率（逐条） =====================
 // 每条内容都带「AI 多空概率」：优先由大模型依据标题 + 字幕推算；
 // 无 Key / 调用失败 / 单条缺失时降级为本地规则推算，并在界面上明确标注来源。
 try {
  const probs = await analyzeLongShort(results.filter(x => !x.error), { onLog: m => console.log(m) });
  let k = 0;
  for (const item of results) {
   if (item.error) continue;
   const p = probs[k++] || null;
   if (p && normalizeProbability(p)) item.bullBear = { bull: p.bull, bear: p.bear, note: p.note || '', source: p.source || 'rule' };
  }
 } catch (e) { console.log('[ai-ls] 多空概率异常（忽略，不影响扫描）：', e.message); }
 if (stale.length) console.log(`[fresh] 本次共隐藏 ${stale.length} 条超出 ${FRESH_WINDOW_LABEL}窗口/无法验证发布时间的内容`);
 return { items: results, hidden: stale };
}

/**
 * 给扫描结果做 AI 主题聚类总结（DeepSeek），并返回一段 HTML 片段，
 * 供 pushWechat 插到内容顶部。失败一律返回空字符串（降级到原始推送）。
 */
async function buildSummaryHtml(items) {
  try {
    const summary = await summarize(items, { onLog: (s) => console.log(s) });
    if (!summary) return '';
    return renderSummaryHtml(summary, {
      generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Macau' }),
      itemCount: items.length,
      // 全景多空概率：由各条内容的 AI 多空概率汇总（见 longshort.mjs aggregateLongShort）
      longShort: aggregateLongShort(items)
    });
  } catch (e) {
    console.log('[ai] buildSummaryHtml 异常：', e.message);
    return '';
  }
}

/**
 * 不推个股页：剥离简报中任何按个股拆分的板块/页面。
 * 约定的个股页标记（任一命中即整段 <section> 剥除）：
 *   1) <section data-kind="stock-page" ...>
 *   2) <section class="... stock-page ...">
 *   3) 段内徽标文本：>个股页< / >個股頁< / >STOCK PAGE<
 * 保证推送内容只保留全景汇总（AI 总结 + 情报流 + 尾页），绝不带个股页。
 */
function stripStockSections(html) {
  if (!html) return html;
  let out = String(html);
  out = out.replace(/<section\b[^>]*data-kind=(["'])stock-page\1[^>]*>[\s\S]*?<\/section>/gi, '');
  out = out.replace(/<section\b[^>]*class=(["'])[^"']*\bstock-page\b[^"']*\1[^>]*>[\s\S]*?<\/section>/gi, '');
  // 徽标文本精确命中（仅匹配独立徽标 >个股页<，不误伤标题含“个股”的视频条目）
  out = out.replace(/<section\b[^>]*>[\s\S]*?<\/section>/gi, (m) =>
    /&gt;\s*(个股页|個股頁|STOCK PAGE)\s*<|>(个股页|個股頁|STOCK PAGE)</.test(m) ? '' : m);
  return out;
}

/**
 * PushPlus 单条消息内容上限约 10 万字（100,000 字符）。
 * 为留余量，按 90,000 字节切分。
 */
const PUSHPLUS_MAX_CHARS = 90000;

/**
 * 把一段 HTML 按 <section ...>...</section> 边界切分成多块，
 * 每块不超过 maxChars 字节。若单个 section 自身超限，则按段落/句子再切。
 * 返回 string[]，每个元素是一段可独立发送的 HTML 片段（不含 <html><body> 外壳）。
 */
function splitHtmlBySections(html, maxChars = PUSHPLUS_MAX_CHARS) {
  const parts = [];
  const sections = html.split(/(?=<section\b)/i).filter(s => s.trim());
  let buf = '';
  const flush = () => { if (buf.trim()) { parts.push(buf); buf = ''; } };

  // 把超长的单个 section 在内部按 </p>、<br>、句号等自然边界再切
  const splitOversizedSection = (sec, max) => {
    const out = [];
    const headMatch = sec.match(/^<section\b[^>]*>/i);
    const head = headMatch ? headMatch[0] : '<section>';
    const tailMatch = sec.match(/<\/section>\s*$/i);
    const tail = tailMatch ? tailMatch[0] : '</section>';
    const headEnd = headMatch ? headMatch[0].length : 9;
    const inner = sec.slice(headEnd, sec.length - tail.length);
    const pieceBudget = max - Buffer.byteLength(head + tail, 'utf8');
    if (pieceBudget <= 0) {
      // head+tail 本身就超限（极端情况），硬切整个 sec
      let s = sec;
      while (Buffer.byteLength(s, 'utf8') > max) {
        let lo = 0, hi = s.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= max) lo = mid; else hi = mid - 1;
        }
        out.push(s.slice(0, lo));
        s = s.slice(lo);
      }
      if (s) out.push(s);
      return out;
    }
    // 先按自然边界切成小块，再贪心打包
    const chunks = inner.split(/(?=<\/p>|<p\b|<br\s*\/?>|。)/i);
    let cur = '';
    for (const c of chunks) {
      if (Buffer.byteLength(c, 'utf8') > pieceBudget) {
        // 单个 chunk 仍超限：先 flush 当前，再对 c 硬切
        if (cur) { out.push(head + cur + tail); cur = ''; }
        let s = c;
        while (Buffer.byteLength(s, 'utf8') > pieceBudget) {
          let lo = 0, hi = s.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= pieceBudget) lo = mid; else hi = mid - 1;
          }
          // 尽量在最近的句号/换行处切
          let cut = lo;
          const win = s.slice(Math.max(0, lo - 200), lo);
          const m = win.match(/[。！？\n]/g);
          if (m) cut = lo - 200 + win.lastIndexOf(m[m.length - 1]) + 1;
          out.push(head + s.slice(0, cut) + tail);
          s = s.slice(cut);
        }
        if (s) cur = s;
      } else if (Buffer.byteLength(cur + c, 'utf8') > pieceBudget && cur) {
        out.push(head + cur + tail);
        cur = c;
      } else {
        cur += c;
      }
    }
    if (cur) out.push(head + cur + tail);
    return out;
  };

  for (const sec of sections) {
    if (Buffer.byteLength(sec, 'utf8') > maxChars) {
      flush();
      for (const piece of splitOversizedSection(sec, maxChars)) parts.push(piece);
      continue;
    }
    if (Buffer.byteLength(buf + sec, 'utf8') > maxChars) flush();
    buf += sec;
  }
  flush();
  return parts;
}

/**
 * 推送消息到 PushPlus（微信公众号）。
 * 文档：https://www.pushplus.plus/push1.html
 * 关键点：
 *  1) 必须使用 HTTPS + JSON body（form-urlencoded 在新版接口下不稳定）
 *  2) 必须显式带 channel:"wechat"，否则可能走到用户默认渠道而非微信
 *  3) 调用是异步的，返回 code:200 只代表服务器已受理；真正投递结果以 shortCode 为准
 *  4) 单条内容超过 10 万字会被拒绝，自动按 section 边界分多条发送，标题加 (1/N) 后缀
 */
async function pushWechat({ token, title, content, template = 'html', channel = 'wechat' }) {
  if (!token) throw new Error('缺少 PushPlus token');
  if (!content) throw new Error('缺少推送内容');
  // 不推个股页：发送前统一剥离个股板块/个股页，只推全景汇总
  content = stripStockSections(content);
  const baseTitle = title || '章鱼 AI 全景分析';

  // 提取外层 header / footer（<section> 之外的固定内容），保证每条消息都有标题和免责声明
  // 使用 firstSection / lastSectionEnd 精确定位，避免原 footer 正则把时间戳段误判为 footer
  let header = '', footer = '', bodyOnly = content;
  const firstSectionIdx = content.search(/<section\b/i);
  const lastSectionEndIdx = content.toLowerCase().lastIndexOf('</section>');
  if (firstSectionIdx !== -1 && lastSectionEndIdx !== -1 && lastSectionEndIdx > firstSectionIdx) {
    header = content.slice(0, firstSectionIdx);
    footer = content.slice(lastSectionEndIdx + '</section>'.length);
    bodyOnly = content.slice(firstSectionIdx, lastSectionEndIdx + '</section>'.length);
  } else if (firstSectionIdx !== -1) {
    header = content.slice(0, firstSectionIdx);
    bodyOnly = content.slice(firstSectionIdx);
    footer = '';
  } else {
    // 没有 <section>：把整段当作一个块，后续会按字节硬切
    header = '';
    footer = '';
    bodyOnly = content;
  }

  // 如果 header+footer 本身就已经把额度占满，直接整段切（兜底）
  const overhead = Buffer.byteLength(header + footer, 'utf8');
  let chunks = overhead > PUSHPLUS_MAX_CHARS
    ? splitHtmlBySections(content, PUSHPLUS_MAX_CHARS)
    : splitHtmlBySections(bodyOnly, PUSHPLUS_MAX_CHARS - overhead);
  // 兜底：没有任何 section（或 bodyOnly 为空但 header/footer 合起来就是内容）
  if (!chunks.length) {
    const fallback = (header + bodyOnly + footer) || content;
    chunks = splitHtmlBySections(fallback, PUSHPLUS_MAX_CHARS);
    // 仍为空（极短内容）：直接单条发送
    if (!chunks.length) chunks = [fallback];
    // 已做回退则后续拼装不需要重复加 header/footer
    if (header || footer) {
      // chunks 已包含完整内容，避免重复拼接
      header = '';
      footer = '';
    }
  }

  const results = [];
  const total = chunks.length;
  for (let i = 0; i < total; i++) {
    const partTitle = total > 1 ? `${baseTitle} (${i + 1}/${total})` : baseTitle;
    const partContent = total > 1 ? `${header}${chunks[i]}${footer}` : (header ? `${header}${chunks[i]}${footer}` : chunks[i]);
    const payload = JSON.stringify({ token, title: partTitle, content: partContent, template, channel });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      results.push({ part: i + 1, total, title: partTitle, chars: Buffer.byteLength(partContent, 'utf8'), httpStatus: r.status, ...data });
      // 如果某一条失败，停止后续发送，避免半截轰炸
      if (data.code !== 200) break;
      // 多条之间稍作间隔，避免触发频率限制
      if (i < total - 1) await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      results.push({ part: i + 1, total, title: partTitle, chars: Buffer.byteLength(partContent, 'utf8'), httpStatus: 0, code: err.code || 0, msg: err.message, error: err.message });
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  const ok = results.length === total && results.every(r => r.code === 200);
  const first = results[0] || {};
  return {
    ok,
    parts: results,
    totalParts: total,
    sentParts: results.filter(r => r.code === 200).length,
    // 兼容旧字段
    code: first.code,
    msg: ok ? `已发送 ${results.filter(r=>r.code===200).length}/${total} 条` : (first.msg || first.error || '部分发送失败'),
    data: first.data
  };
}

const server = http.createServer(async (req,res) => {
 const u = new URL(req.url, `http://${req.headers.host}`);
 if (u.pathname === '/api/scan' && req.method === 'POST') {
  try {
   const {channels=[], limit=50} = await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
   const out = await scan(channels, limit);
   const hidden = out.hidden || [];
   json(res,200,{
     items: out.items,
     hiddenCount: hidden.length,
     hidden: hidden.slice(0, 20), // 统计与排查用，最多回传 20 条
     freshWindow: FRESH_WINDOW_LABEL,
     fetchedAt: new Date().toISOString()
   });
  } catch(e){json(res,500,{error:e.message});} return;
 }
 if (u.pathname === '/api/run-flows' && req.method === 'POST') {
  try { const body=await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
   const token = process.env.GITHUB_TOKEN || body.token;
   if (!token) return json(res,400,{error:'缺少 GITHUB_TOKEN（请在服务器环境变量中配置，或传入 body.token）'});
   const out = await runFlows(token);
   json(res, out.ok ? 200 : 502, { dispatched: out.ok, status: out.status });
  } catch(e){json(res,500,{error:e.message});} return;
 }
 if (u.pathname === '/api/summarize' && req.method === 'POST') {
  try {
    const body = await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json(res, 400, { error: '缺少 items' });
    const summaryHtml = await buildSummaryHtml(items);
    if (!summaryHtml) return json(res, 200, { ok: false, summaryHtml: '', reason: 'AI 总结不可用（未配置 key / 调用失败 / 解析失败），已降级为无总结推送' });
    return json(res, 200, { ok: true, summaryHtml });
  } catch (e) { json(res, 500, { error: e.message }); }
  return;
 }
 if (u.pathname === '/api/push' && req.method === 'POST') {
  try {
    const body = await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
    const token = body.token || process.env.PUSHPLUS_TOKEN;
    if (!token) return json(res,400,{error:'缺少 PushPlus token（请传入 body.token 或在服务器配置 PUSHPLUS_TOKEN 环境变量）'});
    const out = await pushWechat({
      token,
      title: body.title || '章鱼 AI 全景分析',
      content: body.content || '',
      template: body.template || 'html',
      channel: body.channel || 'wechat'
    });
    json(res, out.ok ? 200 : 502, { pushed: out.ok, ...out });
  } catch(e){ json(res,500,{error:e.message}); } return;
 }
 try {
  let file = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
  if (!/^(index\.html|index\.optimized\.html|app\.js|style\.css|style\.optimized\.css|output\.mock\.html|push\.preview\.html)$/.test(file)) throw Error();
  const data = await readFile(file);
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});
  res.end(data);
 } catch {
  if (!res.headersSent) { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('Not found'); }
  else { try{res.end();}catch{} }
 }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Octopus AI Panorama on ${PORT}`));
