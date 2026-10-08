// test/selftest.mjs — 章鱼 AI·全景分析 · 自测
// 覆盖：72 小时时效验证、AI 多空概率（规则降级路径）、总结块的 HTML 渲染。
// 运行：npm test
import assert from 'node:assert/strict';
import {
  FRESH_WINDOW_MS, parseRelativeAgeMs, parseAbsoluteTime, describeAgeMs, formatMacau,
  evaluateFreshness, isFreshItem
} from '../freshness.mjs';
import {
  ruleLongShort, normalizeProbability, probabilityLabel, bullBearBar, aggregateLongShort, probabilitySourceText
} from '../longshort.mjs';
import { analyzeLongShort, renderSummaryHtml } from '../ai.mjs';
import {
  parseSeekingAlphaList, parseSAPublished, normalizeSAItem,
  renderSeekingAlphaPush, buildDemoSeekingAlpha, SA_CHANNEL
} from '../seekingalpha.mjs';

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

console.log('· 时效验证（最近 72 小时）');
t('相对时间解析：中文', () => {
  assert.equal(parseRelativeAgeMs('刚刚'), 0);
  assert.equal(parseRelativeAgeMs('12 分钟前'), 12 * 60 * 1000);
  assert.equal(parseRelativeAgeMs('3小时前'), 3 * 3600 * 1000);
  assert.equal(parseRelativeAgeMs('2 天前'), 2 * 86400 * 1000);
  assert.equal(parseRelativeAgeMs('1 周前'), 7 * 86400 * 1000);
});
t('相对时间解析：英文（含 Streamed / Premiered 前缀）', () => {
  assert.equal(parseRelativeAgeMs('11 hours ago'), 11 * 3600 * 1000);
  assert.equal(parseRelativeAgeMs('Streamed 2 days ago'), 2 * 86400 * 1000);
  assert.equal(parseRelativeAgeMs('Premiered 5 hours ago'), 5 * 3600 * 1000);
  assert.equal(parseRelativeAgeMs('1 month ago'), 30 * 86400 * 1000);
});
t('无法识别的相对时间返回 null（不再默认“刚刚”）', () => {
  assert.equal(parseRelativeAgeMs(''), null);
  assert.equal(parseRelativeAgeMs('未知时间'), null);
  assert.equal(parseRelativeAgeMs('soon'), null);
});
t('绝对时间解析与澳门时间格式化（UTC+8）', () => {
  assert.equal(parseAbsoluteTime('2026-10-08T00:20:00Z'), '2026-10-08T00:20:00.000Z');
  assert.equal(parseAbsoluteTime('not-a-date'), null);
  assert.equal(formatMacau('2026-10-08T00:20:00Z'), '2026-10-08 08:20');
});
t('裁决：72 小时内 = fresh，超出 = stale', () => {
  const now = Date.now();
  assert.equal(evaluateFreshness({ published: '2 天前' }, now).status, 'fresh');   // 48h
  assert.equal(evaluateFreshness({ published: '3 天前' }, now).status, 'stale');   // 72h+
  assert.equal(evaluateFreshness({ published: '1 周前' }, now).status, 'stale');
  assert.equal(evaluateFreshness({ published: '11 小时前' }, now).status, 'fresh');
  assert.equal(evaluateFreshness({ publishedAt: new Date(now - 71 * 3600 * 1000).toISOString() }, now).status, 'fresh');
  assert.equal(evaluateFreshness({ publishedAt: new Date(now - 73 * 3600 * 1000).toISOString() }, now).status, 'stale');
});
t('裁决：无法解析发布时间 → unknown（上层将隐藏）', () => {
  const v = evaluateFreshness({ published: '' }, Date.now());
  assert.equal(v.status, 'unknown');
  assert.equal(v.ok, null);
});
t('年龄文案与窗口常量', () => {
  assert.equal(FRESH_WINDOW_MS, 72 * 3600 * 1000);
  assert.equal(describeAgeMs(30 * 1000), '刚刚');
  assert.equal(describeAgeMs(3 * 3600 * 1000), '3 小时前');
  assert.equal(describeAgeMs(2 * 86400 * 1000), '2 天前');
});
t('渲染兜底：缺少 / 过期 publishedAt 的条目不通过', () => {
  const now = Date.now();
  assert.equal(isFreshItem({ publishedAt: new Date(now - 3600 * 1000).toISOString() }, now), true);
  assert.equal(isFreshItem({ publishedAt: new Date(now - 80 * 3600 * 1000).toISOString() }, now), false);
  assert.equal(isFreshItem({ publishedAt: '' }, now), false);
  assert.equal(isFreshItem({ error: '扫描异常' }, now), true); // 异常卡片另走错误样式
});

console.log('· AI 多空概率');
t('规则推算：偏多 / 偏空 / 中性', () => {
  const bull = ruleLongShort({ title: '港股创新高 反弹延续 利好频出' });
  assert.ok(bull.bull > 55 && bull.bull + bull.bear === 100, JSON.stringify(bull));
  const bear = ruleLongShort({ title: '美股暴跌 衰退风险升温 抛售加剧' });
  assert.ok(bear.bear > 55, JSON.stringify(bear));
  const neutral = ruleLongShort({ title: '美联储会议纪要公布' });
  assert.equal(neutral.bull, 50);
  assert.equal(neutral.source, 'rule');
});
t('规则推算：无字幕时仅依据标题并标注', () => {
  const r = ruleLongShort({ title: 'A股反弹 利好落地', transcript: '' });
  assert.match(r.note, /仅标题/);
});
t('概率归一化：整数、5–95、多 + 空 = 100', () => {
  assert.deepEqual(normalizeProbability({ bull: 58.4 }), { bull: 58, bear: 42 });
  assert.deepEqual(normalizeProbability(200), { bull: 95, bear: 5 });
  assert.deepEqual(normalizeProbability(-10), { bull: 5, bear: 95 });
  assert.equal(normalizeProbability('abc'), null);
  assert.equal(probabilityLabel({ bull: 62, bear: 38 }), '多 62% / 空 38%');
  assert.equal(bullBearBar({ bull: 50, bear: 50 }, 4), '多 ██░░ 50% ｜ 空 ██░░ 50%');
});
t('不输出个股买卖建议措辞', () => {
  const r = ruleLongShort({ title: '机构上调目标价 买入评级' });
  assert.ok(!/目标价|买入评级/.test(r.note), r.note);
});
t('全景汇总：按条目平均', () => {
  const agg = aggregateLongShort([{ bullBear: { bull: 60, bear: 40, source: 'ai' } }, { bullBear: { bull: 40, bear: 60, source: 'ai' } }]);
  assert.equal(agg.bull, 50);
  assert.equal(agg.count, 2);
  assert.equal(agg.source, 'ai');
  assert.equal(aggregateLongShort([{ error: 'x' }]), null);
});
t('来源标注：不冒充 AI', () => {
  assert.match(probabilitySourceText('ai'), /DeepSeek/);
  assert.match(probabilitySourceText('rule'), /本地规则/);
});
t('无 AI Key 时 analyzeLongShort 降级为规则推算（不联网）', async () => {
  const saved = { d: process.env.DEEPSEEK_API_KEY, o: process.env.OPENAI_API_KEY };
  delete process.env.DEEPSEEK_API_KEY; delete process.env.OPENAI_API_KEY;
  const items = [{ channel: '信報財經新聞', title: '恒指创新高 内房反弹' }, { channel: 'CNBC', title: 'Stocks fall as recession risk rises', transcript: '' }];
  const out = await analyzeLongShort(items, { onLog: () => {} });
  assert.equal(out.length, 2);
  assert.ok(out.every(x => x.source === 'rule' && x.bull + x.bear === 100), JSON.stringify(out));
  if (saved.d) process.env.DEEPSEEK_API_KEY = saved.d;
  if (saved.o) process.env.OPENAI_API_KEY = saved.o;
});

console.log('· 总结块渲染（含全景多空概率）');
t('renderSummaryHtml 输出多空概率面板与风险/机会', () => {
  const html = renderSummaryHtml(
    { main: '主线', hotTopics: ['热点A'], risks: ['风险A'], opportunities: ['机会A'], perVideo: {} },
    { itemCount: 2, longShort: { bull: 58, bear: 42, count: 2, source: 'ai' } }
  );
  assert.match(html, /AI 多空概率/);
  assert.ok(!/LONG_SHORT\.PROB/.test(html));
  assert.match(html, /多 58% \/ 空 42%/);
  assert.match(html, /DeepSeek 多空推理/);
  assert.match(html, /HOT_TOPICS\.DAT/);
});
t('无多空概率数据时不渲染该面板', () => {
  const html = renderSummaryHtml({ main: '主线', hotTopics: [], risks: [], opportunities: [] }, { itemCount: 0 });
  assert.ok(!/LONG_SHORT\.PROB/.test(html));
});
t('五档色深：标题 / 突出 / 重点 / 正文 / 说明 互不相同', () => {
  // 五类文字各占一档色深：#eafff0 / #00ff66 / #b8f2cb / #8fdca4 / #63b47f
  const ramp = ['#eafff0', '#00ff66', '#b8f2cb', '#8fdca4', '#63b47f'];
  assert.equal(new Set(ramp).size, 5);
  const html = renderSummaryHtml(
    { main: '主线结论', hotTopics: ['热点A'], risks: ['风险A'], opportunities: ['机会A'] },
    { itemCount: 1, longShort: { bull: 58, bear: 42, count: 1, source: 'rule' } }
  );
  assert.match(html, /color:#eafff0[^>]*>主线结论/);            // 标题：今日主线最亮
  assert.match(html, /background:#00ff66/);                     // 突出：反白徽章 / 标题栏
  assert.match(html, /color:#b8f2cb;font-weight:700;font-size:9.5px/); // 重点：要点列表
  assert.match(html, /color:#b8f2cb;font-weight:700;line-height:1.7/);  // 重点：多空概率数值
  assert.match(html, /color:#63b47f/);                          // 说明：来源与免责
});

console.log('· 新栏目：Seeking Alpha 最新分析');
t('SA 列表解析：标题 / 链接 / 时间 / 作者 / 标的', () => {
  const html = `
    <div><a href="https://seekingalpha.com/article/4781111-annaly-better-pick"><h3>Annaly A Better Pick Here Relative To AGNC</h3></a>
    <span data-date="2026-10-09T21:28:00Z"></span><a href="/symbol/NLY">NLY</a><a href="/author/c-jessen">C Jessen</a></div>
    <div><a href="/article/4781112-novavax-sell-false-breakout">Novavax: Sell The False Plague Breakout</a>
    Today, 5:24 PM <a href="/symbol/NVAX">NVAX</a></div>`;
  const items = parseSeekingAlphaList(html);
  assert.equal(items.length, 2);
  assert.match(items[0].title, /Annaly A Better Pick/);
  assert.match(items[0].url, /article\/4781111/);
  assert.equal(items[0].ticker, 'NLY');
  assert.equal(items[0].author, 'C Jessen');
  assert.match(items[1].published, /Today,\s*5:24\s*PM/i);
  assert.equal(items[1].ticker, 'NVAX');
});
t('SA 时效解析：Today / Yesterday / 日期 / 相对时间', () => {
  const now = new Date('2026-10-09T10:00:00').getTime();
  const today = parseSAPublished('Today, 5:28 PM', now);
  assert.ok(today && today.ageMs >= 0 && today.ageMs <= 24 * 3600 * 1000, JSON.stringify(today));
  const yst = parseSAPublished('Yesterday, 8:15 AM', now);
  assert.ok(yst && yst.ageMs > 12 * 3600 * 1000 && yst.ageMs <= 48 * 3600 * 1000, JSON.stringify(yst));
  const dated = parseSAPublished('Oct. 7', now);
  assert.ok(dated && dated.ageMs > 24 * 3600 * 1000 && dated.ageMs <= 72 * 3600 * 1000, JSON.stringify(dated));
  const rel = parseSAPublished('3 hours ago', now);
  assert.equal(rel.ageMs, 3 * 3600 * 1000);
  assert.equal(parseSAPublished('', now), null);
});
t('SA 条目归一：72 小时裁决 + 中文解析状态 + 本地规则兜底', () => {
  const now = Date.now();
  const fresh = normalizeSAItem({ title: 'Novavax: Sell The False Plague Breakout', published: 'Today, 5:24 PM', url: 'https://seekingalpha.com/article/1-x', summaryZh: '假突破，逢高了结' }, now);
  assert.equal(fresh.channel, SA_CHANNEL);
  assert.equal(fresh.status, '全文中文解析');
  assert.ok(fresh.bullBear && fresh.bullBear.bull + fresh.bullBear.bear === 100);
  const stale = normalizeSAItem({ title: 'Old Story', published: 'Oct. 1, 2025', url: 'https://seekingalpha.com/article/2-y' }, now);
  assert.equal(stale._fresh.ok, false);
});
t('SA 推送块：五档色深 + 空列表不输出', () => {
  assert.equal(renderSeekingAlphaPush([]), '');
  const { items } = buildDemoSeekingAlpha();
  const html = renderSeekingAlphaPush(items);
  assert.match(html, /SEEKING ALPHA · 最新分析/);
  assert.match(html, /color:#eafff0/);   // 标题
  assert.match(html, /background:#00ff66/); // 突出（标题栏）
  assert.match(html, /color:#b8f2cb/);   // 重点（多空概率数值）
  assert.match(html, /color:#8fdca4/);   // 正文（中文解析）
  assert.match(html, /color:#63b47f/);   // 说明（英文原题 / 来源标注）
});

await Promise.resolve();
console.log(`\n${passed} 项自测通过${process.exitCode ? '（存在失败项）' : ' ✅'}`);
