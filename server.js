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
 * 推送消息到 PushPlus（微信公众号）。
 * 文档：https://www.pushplus.plus/push1.html
 * 关键点：
 *  1) 必须使用 HTTPS + JSON body（form-urlencoded 在新版接口下不稳定）
 *  2) 必须显式带 channel:"wechat"，否则可能走到用户默认渠道而非微信
 *  3) 调用是异步的，返回 code:200 只代表服务器已受理；真正投递结果以 shortCode 为准
 */
async function pushWechat({ token, title, content, template = 'html', channel = 'wechat' }) {
  if (!token) throw new Error('缺少 PushPlus token');
  if (!content) throw new Error('缺少推送内容');
  const payload = JSON.stringify({ token, title: title || 'SIGNAL ARCADE 情报简报', content, template, channel });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      body: payload,
      signal: controller.signal
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { httpStatus: r.status, ...data };
  } finally {
    clearTimeout(timer);
  }
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
    const ok = out.code === 200;
    json(res, ok ? 200 : 502, { pushed: ok, ...out });
  } catch(e){ json(res,500,{error:e.message}); } return;
 }
 try { let file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1); if (!/^(index\.html|app\.js|style\.css)$/.test(file)) throw Error(); const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(file)); } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Signal Arcade on ${PORT}`));
