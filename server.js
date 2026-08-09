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
  const blocks = html.match(/\{"videoRenderer":\{.{0,12000?}\}\}/g) || [];
  // Video renderers are nested; this lighter extraction remains resilient to YouTube layout changes.
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
  try { const body=await new Promise((ok,bad)=>{let s='';req.on('data',x=>s+=x);req.on('end',()=>{try{ok(JSON.parse(s))}catch(e){bad(e)}})});
   if (!body.token) return json(res,400,{error:'缺少 PushPlus token'});
   const form=new URLSearchParams({token:body.token,title:body.title||'SIGNAL ARCADE 情报简报',content:body.content||'',template:'html'});
   const r=await fetch('https://www.pushplus.plus/send',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
   json(res,r.ok?200:502,await r.json());
  } catch(e){json(res,500,{error:e.message});} return;
 }
 try { let file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1); if (!/^(index\.html|app\.js|style\.css)$/.test(file)) throw Error(); const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(file)); } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Signal Arcade on ${PORT}`));
