// YouTube 字幕读取：保留签名轨道 URL / 自动字幕参数，返回可解释的结果。
// 不下载视频，不执行 OCR/语音识别；空结果不等同于“视频没有文字”。
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
};

export function decodeCaptionEntities(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
    if (key.startsWith('#')) {
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[key.toLowerCase()];
  });
}

export function parseCaptionText(raw) {
  let parts = [];
  try {
    const data = JSON.parse(raw);
    parts = (Array.isArray(data.events) ? data.events : [])
      .map(e => (Array.isArray(e.segs) ? e.segs : []).map(s => s.utf8 || '').join(''));
  } catch {
    // XML timedtext / srv3，不能把 HTML 错误页当作字幕。
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<(?:transcript|timedtext)\b/.test(raw)) return '';
    parts = [...raw.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/g)]
      .map(m => decodeCaptionEntities(m[2].replace(/<[^>]*>/g, '')));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 7000);
}

export function parseWatchTracks(html) {
  // 平衡括号扫描：name.runs 也包含数组，不能在第一个 ] 处截断。
  const start = /"captionTracks"\s*:\s*\[/.exec(html);
  if (!start) return [];
  const from = start.index + start[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = from; i < Math.min(html.length, from + 200000); i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      try { return JSON.parse(html.slice(from, i + 1)).filter(t => t && typeof t.baseUrl === 'string'); }
      catch { return []; }
    }
  }
  return [];
}

export function parseListTracks(xml, id) {
  return [...xml.matchAll(/<track\b([^>]*)\/?\s*>/g)].flatMap(m => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w_]+)\s*=\s*(["'])(.*?)\2/g)]
      .map(a => [a[1], decodeCaptionEntities(a[3])]));
    if (!attrs.lang_code) return [];
    const params = new URLSearchParams({ v: id, lang: attrs.lang_code });
    // 自动字幕和命名轨道缺少这些参数时经常返回 200 + 空正文。
    for (const key of ['kind', 'name']) if (attrs[key]) params.set(key, attrs[key]);
    return [{ baseUrl: `https://www.youtube.com/api/timedtext?${params}`, languageCode: attrs.lang_code, kind: attrs.kind }];
  });
}

function safeTrackUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !['www.youtube.com', 'youtube.com', 'm.youtube.com', 'video.google.com'].includes(url.hostname) ||
        url.pathname !== '/api/timedtext') return null;
    return url;
  } catch { return null; }
}

export async function readCaptions(id, { fetchImpl = globalThis.fetch, timeoutMs = 8000, budgetMs = 25000 } = {}) {
  const attempts = [];
  const deadline = Date.now() + budgetMs;
  const empty = code => ({ text: '', source: 'none', language: '', translated: false,
    status: '未读取到字幕（仅标题）', code, message: captionMessage(code), attempts });
  if (!/^[\w-]{11}$/.test(id)) return empty('invalid_id');

  async function request(url, stage) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const response = await fetchImpl(url, { headers: HEADERS, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        attempts.push({ stage, code: response.status === 429 ? 'rate_limited' : 'http_error', httpStatus: response.status });
        return null;
      }
      // 定时器涵盖响应正文，而非只涵盖响应头。
      const body = await response.text();
      attempts.push({ stage, code: body.trim() ? 'received' : 'empty_response' });
      return body;
    } catch (e) {
      attempts.push({ stage, code: controller.signal.aborted || e.name === 'AbortError' ? 'timeout' : 'network_error' });
      return null;
    } finally { clearTimeout(timer); }
  }

  const rank = t => /^zh/i.test(t.languageCode) ? 0 : /^en/i.test(t.languageCode) ? 1 : 2;
  const tried = new Set();
  let trackRequests = 0;
  async function tryTracks(tracks, source) {
    for (const track of [...tracks].sort((a, b) => rank(a) - rank(b)).slice(0, 8)) {
      const base = safeTrackUrl(track.baseUrl);
      if (!base) continue;
      const language = track.languageCode || base.searchParams.get('lang') || 'unknown';
      const translations = /^zh/i.test(language) ? [''] : ['zh-Hans', ''];
      for (const target of translations) {
        const url = new URL(base);
        if (target) url.searchParams.set('tlang', target);
        else url.searchParams.delete('tlang');
        // 原 URL 优先，保留签名；再尝试 JSON3（XML 和 JSON 统一解析）。
        for (const fmt of ['', 'json3']) {
          if (fmt) url.searchParams.set('fmt', fmt);
          if (tried.has(url.href) || trackRequests >= 24 || Date.now() >= deadline) continue;
          tried.add(url.href);
          trackRequests++;
          const raw = await request(url.href, source);
          const text = raw ? parseCaptionText(raw) : '';
          if (raw && !text) attempts[attempts.length - 1].code = 'empty_or_unrecognized';
          if (text) return { text, source, language: target || language, translated: !!target,
            originalLanguage: language, automatic: track.kind === 'asr', code: 'ok',
            status: target ? '中文翻译字幕' : /^zh/i.test(language) ? '中文字幕已读取' : '原文字幕（未翻译）',
            message: target ? '已读取自动翻译字幕，翻译可能存在误差。' : '已读取字幕轨道；未识别视频画面文字。', attempts };
          if (attempts.at(-1)?.code === 'rate_limited') return null;
        }
      }
    }
    return null;
  }

  const watch = await request(`https://www.youtube.com/watch?v=${id}`, 'watch');
  const watchTracks = parseWatchTracks(watch || '');
  let result = await tryTracks(watchTracks, 'watch_track');
  if (result) return result;
  if (!attempts.some(a => a.code === 'rate_limited') && Date.now() < deadline) {
    const list = await request(`https://www.youtube.com/api/timedtext?type=list&v=${id}`, 'list');
    result = await tryTracks(parseListTracks(list || '', id), 'list_track');
    if (result) return result;
    // 两个发现接口都无法连接时，不再盲目重复几十次请求。
    if ((watch !== null || list !== null) && !attempts.some(a => a.code === 'rate_limited')) {
      const tracks = [];
      for (const lang of ['zh-Hant', 'zh-Hans', 'zh', 'en']) {
        for (const kind of ['', 'asr']) {
          const params = new URLSearchParams({ v: id, lang });
          if (kind) params.set('kind', kind);
          tracks.push({ baseUrl: `https://www.youtube.com/api/timedtext?${params}`, languageCode: lang, kind });
        }
      }
      result = await tryTracks(tracks, 'direct_track');
      if (result) return result;
    }
  }
  const code = attempts.some(a => a.code === 'rate_limited') ? 'rate_limited'
    : Date.now() >= deadline || attempts.some(a => a.code === 'timeout') ? 'timeout'
    : attempts.some(a => a.code === 'http_error') ? 'http_error'
    : attempts.some(a => a.code === 'network_error') ? 'network_error'
    : 'unavailable';
  return empty(code);
}

export function captionMessage(code) {
  return ({
    invalid_id: '视频 ID 无效，无法请求字幕。',
    rate_limited: '字幕请求被限流（HTTP 429）；请降低扫描频率并稍后重试。',
    timeout: '字幕读取超时；请检查部署环境能否访问 YouTube，或稍后重试。',
    http_error: '字幕接口返回 HTTP 错误；可能是访问限制，请查看读取诊断中的状态码。',
    network_error: '无法连接字幕服务；请检查部署环境的网络。可改用本地视频做 OCR 或语音转写。',
    unavailable: '未取得可读字幕：可能没有字幕轨道，或接口返回空内容/验证页；不能据此断定视频没有文字。画面文字请用 OCR，口述内容需语音转写。'
  })[code] || '字幕未读取。';
}
