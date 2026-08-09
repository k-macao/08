import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const PORT = process.env.PORT || 3000;
const clean = s => String(s || '').replace(/台湾|台灣/g, '中国台湾').replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_,c)=>String.fromCharCode(parseInt(c,16))).replace(/\\"/g,'"').replace(/&amp;/g,'&');
const json = (res, code, body) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); };

async function searchChannel(name) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' 最新 财经');
  const r = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
  if (!r.ok) throw new Error('YouTube 返回 ' + r.status);
  const html = await r.text();
  const found = [], seen = new Set();
  const rx = /"videoId":"([\w-]{11})"[\s\S]{0,1800}?"title":\{"runs":\[\{"text":"([\s\S]*?)"\}/g;
  let m;
  while ((m = rx.exec(html)) && found.length < 3) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const tail = html.slice(m.index, m.index + 5000);
    const published = (tail.match(/"publishedTimeText":\{"simpleText":"([^"]+)/) || [,'刚刚'])[1];
    found.push({ id:m[1], title:clean(decode(m[2])), published:clean(decode(published)), url:'https://www.youtube.com/watch?v='+m[1] });
  }
  if (!found.length) throw new Error('未解析到公开视频（可能受地区、频道命名或 YouTube 页面变动影响）');
  return found;
}
async function captions(id) {
  const r = await fetch(`https://www.youtube.com/api/timedtext?v=${id}&lang=zh-Hant`, {headers:{'User-Agent':'Mozilla/5.0'}});
  if (!r.ok) return '';
  const xml = await r.text();
  return clean(decode([...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x=>x[1].replace(/<[^>]+>/g,'')).join(' '))).slice(0, 7000);
}
async function runFlows(token) {
  const repo = process.env.GITHUB_REPO || 'k-macao/08';
  const ref = process.env.GITHUB_REF || 'main';
  const url = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/dispatches`;
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
async function scan(names) {
 const results = [];
 for (const name of names.slice(0, 12)) {
  try {
   const videos = await searchChannel(name);
   for (const video of videos) {
    const transcript = await captions(video.id);
    results.push({...video, channel:name, transcript, status:transcript ? '字幕已读取' : '未提供公开中文字幕'});
   }
  } catch (e) { results.push({channel:name, error:e.message}); }
 }
 return results;
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
  const baseTitle = title || 'SIGNAL ARCADE 情报简报';

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
  try { const {channels=[]} = await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})}); json(res,200,{items:await scan(channels), fetchedAt:new Date().toISOString()}); } catch(e){json(res,500,{error:e.message});} return;
 }
 if (u.pathname === '/api/run-flows' && req.method === 'POST') {
  try { const body=await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
   const token = process.env.GITHUB_TOKEN || body.token;
   if (!token) return json(res,400,{error:'缺少 GITHUB_TOKEN（请在服务器环境变量中配置，或传入 body.token）'});
   const out = await runFlows(token);
   json(res, out.ok ? 200 : 502, { dispatched: out.ok, status: out.status });
  } catch(e){json(res,500,{error:e.message});} return;
 }
 if (u.pathname === '/api/push' && req.method === 'POST') {
  try {
    const body = await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})});
    const token = body.token || process.env.PUSHPLUS_TOKEN;
    if (!token) return json(res,400,{error:'缺少 PushPlus token（请传入 body.token 或在服务器配置 PUSHPLUS_TOKEN 环境变量）'});
    const out = await pushWechat({
      token,
      title: body.title || 'SIGNAL ARCADE 情报简报',
      content: body.content || '',
      template: body.template || 'html',
      channel: body.channel || 'wechat'
    });
    json(res, out.ok ? 200 : 502, { pushed: out.ok, ...out });
  } catch(e){ json(res,500,{error:e.message}); } return;
 }
 try { let file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1); if (!/^(index\.html|app\.js|style\.css)$/.test(file)) throw Error(); const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(file)); } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Signal Arcade on ${PORT}`));
