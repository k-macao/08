import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptionText, parseWatchTracks, parseListTracks, readCaptions } from '../captions.mjs';

const id = 'abcdefghijk';
const track = (languageCode = 'zh-Hant', extra = {}) => ({
  baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=${languageCode}&signature=keep-me`,
  name: { runs: [{ text: 'nested [name] "quoted"' }] }, languageCode, ...extra
});
const watch = tracks => `var ytInitialPlayerResponse = ${JSON.stringify({ captions: { captionTracks: tracks } })};`;
const reply = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const xml = '<transcript><text start="0">今日市场上涨</text></transcript>';

test('解析 XML / srv3 / JSON3、数字实体与短字幕，拒绝 HTML 错误页', () => {
  assert.equal(parseCaptionText('<transcript><text>A &amp; B &#x4E2D;&#25991; &quot;好&quot;</text></transcript>'), 'A & B 中文 "好"');
  assert.equal(parseCaptionText('<timedtext><body><p><s>第一</s><s>句</s></p><p>下一句</p></body></timedtext>'), '第一句 下一句');
  assert.equal(parseCaptionText(JSON.stringify({ events: [{ segs: [{ utf8: '涨' }] }, {}] })), '涨');
  assert.equal(parseCaptionText('<html><p>Sign in to confirm you are not a bot</p></html>'), '');
  assert.equal(parseCaptionText('{"events":{}}'), '');
});

test('watch 轨道数组支持嵌套 runs、转义字符和多个语言', () => {
  const tracks = [track('en'), track('zh-Hant', { kind: 'asr' })];
  assert.deepEqual(parseWatchTracks(watch(tracks).replaceAll('&', '\\u0026')), tracks);
  assert.deepEqual(parseWatchTracks('"captionTracks":[{"broken":'), []);
});

test('list 保留 kind=asr 和 name，不能只取语言', () => {
  const [t] = parseListTracks('<transcript_list><track lang_code="zh" kind="asr" name="A &amp; B" /></transcript_list>', id);
  const url = new URL(t.baseUrl);
  assert.equal(url.searchParams.get('kind'), 'asr');
  assert.equal(url.searchParams.get('name'), 'A & B');
});

test('优先中文签名轨道，JSON3 正文无需超过十个字', async () => {
  const calls = [];
  const result = await readCaptions(id, { fetchImpl: async url => {
    calls.push(url);
    if (url.includes('/watch?')) return reply(watch([track('en'), track('zh-Hant', { kind: 'asr' })]));
    assert.equal(new URL(url).searchParams.get('signature'), 'keep-me');
    assert.equal(new URL(url).searchParams.get('lang'), 'zh-Hant');
    return reply(JSON.stringify({ events: [{ segs: [{ utf8: '上涨' }] }] }));
  } });
  assert.equal(result.text, '上涨');
  assert.equal(result.automatic, true);
  assert.equal(result.source, 'watch_track');
  assert.equal(result.translated, false);
  assert.equal(calls.length, 2);
});

test('非中文轨道先尝试翻译，失败保留原文并如实标记', async () => {
  const calls = [];
  const result = await readCaptions(id, { fetchImpl: async url => {
    if (url.includes('/watch?')) return reply(watch([track('en')]));
    calls.push(url);
    return reply(new URL(url).searchParams.has('tlang') ? '' : '<transcript><text>Market news</text></transcript>');
  } });
  assert.equal(new URL(calls[0]).searchParams.get('tlang'), 'zh-Hans');
  assert.equal(result.language, 'en');
  assert.equal(result.translated, false);
  assert.equal(result.status, '原文字幕（未翻译）');
});

test('翻译成功记录原文语言和翻译状态', async () => {
  const result = await readCaptions(id, { fetchImpl: async url => {
    if (url.includes('/watch?')) return reply(watch([track('en')]));
    assert.equal(new URL(url).searchParams.get('tlang'), 'zh-Hans');
    return reply(xml);
  } });
  assert.equal(result.translated, true);
  assert.equal(result.language, 'zh-Hans');
  assert.equal(result.originalLanguage, 'en');
});

test('list 自动字幕轨道可读取', async () => {
  const result = await readCaptions(id, { fetchImpl: async url => {
    if (url.includes('/watch?')) return reply('<html></html>');
    if (url.includes('type=list')) return reply('<track lang_code="zh" kind="asr" name="named"/>');
    const params = new URL(url).searchParams;
    assert.equal(params.get('kind'), 'asr');
    assert.equal(params.get('name'), 'named');
    return reply(xml);
  } });
  assert.equal(result.source, 'list_track');
});

test('无发现轨道时尝试直连自动字幕（确实发送 kind=asr）', async () => {
  const result = await readCaptions(id, { fetchImpl: async url => {
    return reply(new URL(url).searchParams.get('kind') === 'asr' ? xml : '');
  } });
  assert.equal(result.source, 'direct_track');
  assert.equal(result.automatic, true);
});

test('网络错误仅尝试两个发现入口，不冒充视频没有字幕', async () => {
  let calls = 0;
  const result = await readCaptions(id, { fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.equal(calls, 2);
  assert.equal(result.code, 'network_error');
  assert.equal(result.text, '');
  assert.match(result.status, /仅标题/);
});

test('429 停止重试；403 保留诊断状态码', async () => {
  const limited = await readCaptions(id, { fetchImpl: async () => reply('', 429) });
  assert.equal(limited.code, 'rate_limited');
  assert.equal(limited.attempts.length, 1);
  const denied = await readCaptions(id, { fetchImpl: async () => reply('', 403) });
  assert.equal(denied.code, 'http_error');
  assert.ok(denied.attempts.every(a => a.httpStatus === 403));
});

test('响应正文也有超时，总时间预算有效', async () => {
  const result = await readCaptions(id, { timeoutMs: 15, budgetMs: 25,
    fetchImpl: async (url, { signal }) => ({ ok: true, text: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('body stalled')), { once: true });
    }) })
  });
  assert.equal(result.code, 'timeout');
  assert.ok(result.attempts.length <= 2);
});

test('空响应/验证页与网络错误分开，不输出伪字幕', async () => {
  const result = await readCaptions(id, { fetchImpl: async () => reply('<html><p>Verify</p></html>') });
  assert.equal(result.code, 'unavailable');
  assert.equal(result.text, '');
  assert.match(result.message, /不能据此断定/);
  assert.ok(result.attempts.length <= 26);
});

test('拒绝外部/本地轨道 URL；非法视频 ID 不发送请求', async () => {
  const result = await readCaptions(id, { fetchImpl: async url => {
    assert.equal(new URL(url).hostname, 'www.youtube.com');
    if (url.includes('/watch?')) return reply(watch([track('zh', { baseUrl: 'http://127.0.0.1/api/timedtext' })]));
    return reply('');
  } });
  assert.equal(result.text, '');
  const bad = await readCaptions('../oops', { fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(bad.code, 'invalid_id');
});
