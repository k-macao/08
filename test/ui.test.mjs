import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const item = () => ({ channel: 'Test', title: '市场新闻', url: 'https://example.com/video',
  publishedAt: new Date().toISOString(), transcript: '00:00 测试正文', status: '字幕已读取' });

// Run the real browser event handlers with a minimal DOM and isolated network.
// Never contact PushPlus or use real tokens in tests.
function harness({ token = '', configured = false, auto = true, items = [item()], pushFails = false, scanFails = false, holdPush } = {}) {
  const nodes = new Map();
  const selected = [{ value: 'Test', checked: true }];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      style: {}, value: '', checked: false, disabled: false, innerHTML: '', textContent: '',
      addEventListener() {}, querySelectorAll() { return selected; }
    });
    return nodes.get(selector);
  };
  node('#token').value = token;
  node('#auto-push-wechat').checked = auto;
  const calls = [], alerts = [];
  const context = vm.createContext({
    document: { querySelector: node }, console, AbortSignal,
    alert: message => alerts.push(message), confirm: () => false,
    setTimeout: fn => { fn(); return 0; },
    fetch: async (url, options) => {
      calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      let data = {};
      if (url === '/api/push-config') data = { wechatConfigured: configured };
      else if (url === '/api/scan') {
        if (scanFails) throw new Error('scan offline');
        data = { items, hiddenCount: 0 };
      } else if (url === '/api/demo') data = { items: [item()], demo: true };
      else if (url === '/api/summarize') data = { ok: false };
      else if (url.startsWith('/api/seekingalpha')) data = { ok: true, items: [], html: '' };
      else if (url === '/api/push') {
        if (holdPush) await holdPush;
        data = pushFails ? { ok: false, msg: 'send rejected' } : { ok: true, sentParts: 1, totalParts: 1 };
      } else throw new Error('Unexpected URL ' + url);
      return { ok: true, json: async () => data };
    }
  });
  vm.runInContext(source, context);
  return { node, calls, alerts, run: script => vm.runInContext(script, context),
    pushes: () => calls.filter(c => c.url === '/api/push') };
}

test('网页和工作流默认勾选微信；工作流镜像一致', async () => {
  assert.match(index, /id="auto-push-wechat"[^>]*checked/);
  const workflow = await readFile(new URL('../.github/workflows/oai.yml', import.meta.url), 'utf8');
  assert.match(workflow, /push_to_wechat:\s+description:[^\n]+\s+required: false\s+default: true/);
  assert.equal(workflow, await readFile(new URL('../ci.yml.new', import.meta.url), 'utf8'));
});

test('成功扫描默认只推送一次到微信，使用紧凑内联字号', async () => {
  const h = harness({ token: 'test-only' });
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 1);
  const payload = h.pushes()[0].body;
  assert.equal(payload.channel, 'wechat');
  assert.equal(payload.template, 'html');
  assert.match(payload.content, /font-size:11.5px/);
  assert.match(payload.content, /font-size:9.5px;line-height:1.55/);
  assert.equal(h.alerts.length, 0);
  assert.match(h.node('#pushStatus').textContent, /PUSHED/);
  assert.equal(h.node('#scan').disabled, false);
});

test('服务端已配置 Token 时浏览器可以留空，且不读取密钥', async () => {
  const h = harness({ configured: true });
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 1);
  assert.equal(h.pushes()[0].body.token, '');
});

test('取消自动推送只扫描，手动按钮仍可发送', async () => {
  const h = harness({ auto: false, token: 'test-only' });
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 0);
  await h.node('#push').onclick();
  assert.equal(h.pushes().length, 1);
});

test('未配置 Token 不发送，也不提前请求总结', async () => {
  const h = harness();
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 0);
  assert.ok(!h.calls.some(c => c.url === '/api/summarize'));
  assert.match(h.node('#pushStatus').textContent, /微信待配置/);
  assert.equal(h.node('#scan').disabled, false);
});

test('空结果、仅错误、过期内容、扫描失败均不自动发送', async () => {
  for (const options of [
    { items: [] }, { items: [{ channel: 'Test', error: 'offline' }] },
    { items: [{ ...item(), publishedAt: '2020-01-01' }] }, { scanFails: true }
  ]) {
    const h = harness({ ...options, token: 'test-only' });
    await h.node('#scan').onclick();
    assert.equal(h.pushes().length, 0);
    assert.equal(h.node('#push').disabled, true);
  }
});

test('示例数据不自动发送；手动示例确认取消也不发送', async () => {
  const h = harness({ token: 'test-only' });
  await h.node('#demo').onclick();
  assert.equal(h.pushes().length, 0);
  await h.run('pushCurrentReport({ automatic: true })');
  await h.node('#push').onclick();
  assert.equal(h.pushes().length, 0);
});

test('发送失败可手动重试，不自动重复发送', async () => {
  const h = harness({ token: 'test-only', pushFails: true });
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 1);
  assert.match(h.node('#pushStatus').textContent, /send rejected/);
  assert.equal(h.node('#push').disabled, false);
  assert.equal(h.node('#scan').disabled, false);
});

test('发送中禁止重复推送和新扫描', async () => {
  let release;
  const holdPush = new Promise(resolve => { release = resolve; });
  const h = harness({ token: 'test-only', holdPush });
  const first = h.node('#scan').onclick();
  // Flush the short chain of mocked async requests until send is in flight.
  for (let i = 0; i < 50 && !h.pushes().length; i++) await Promise.resolve();
  assert.equal(h.pushes().length, 1);
  assert.equal(h.node('#push').disabled, true);
  await h.node('#push').onclick();
  await h.node('#scan').onclick();
  assert.equal(h.pushes().length, 1);
  release();
  await first;
});

test('网页字号、行距、卡片留白均已收紧', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /body\s*\{[^}]*font-size: 10px;\s+line-height: 1.45;/);
  assert.match(css, /\.section-panel\s*\{[^}]*padding: 9px;\s+margin-bottom: 10.5px;/);
  assert.match(css, /\.item h3\s*\{[^}]*font-size: 11.5px;/);
});

test('AI、SA、微信预览、手动和定时推送模板没有遗留大字号', async () => {
  for (const name of ['ai.mjs', 'seekingalpha.mjs', 'app.js', 'push.preview.html', '.github/workflows/oai.yml']) {
    const content = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    const sizes = [...content.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    assert.ok(sizes.length > 0, name);
    assert.ok(sizes.every(size => size >= 7 && size <= 11.5), name);
  }
});
