import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toSimplified, tokenizeTitle, wordFrequency, matchSectors,
  analyzeTitles, aiAnalyzeSectors, renderSectorReport, renderSectorMarkdown,
  SECTOR_KEYWORDS, DISCLAIMER
} from '../sectors.mjs';

test('繁体转简体覆盖财经高频字', () => {
  assert.equal(toSimplified('美聯儲議息紀錄 銀行 車電 馬錢'), '美联储议息纪录 银行 车电 马钱');
  assert.equal(toSimplified('內房板塊 反彈 恒指點數'), '内房板块 反弹 恒指点数');
  assert.equal(toSimplified('無人機'), '无人机');
  assert.equal(toSimplified(''), '');
  assert.equal(toSimplified(null), '');
});

test('分词：保留板块信号词，过滤噪音词与纯数字', () => {
  const toks = tokenizeTitle('英偉達發布新一代AI芯片 光刻機概念股大漲 恒指18000點');
  assert.ok(toks.includes('芯片'), '应含 芯片');
  assert.ok(toks.includes('光刻'), '应含 光刻');
  assert.ok(toks.includes('ai'), '应含 ai');
  assert.ok(toks.includes('英伟达') === false, 'bigram 不会拼出四字词，属正常');
  assert.ok(!toks.includes('概念'), '噪音词 概念 应被过滤');
  assert.ok(!toks.includes('大涨'), '噪音词 大涨 应被过滤');
  assert.ok(!toks.includes('18000'), '纯数字应被过滤');
  assert.ok(!toks.includes('今日'));
  // 弱字参与的 bigram 应被丢弃
  const t2 = tokenizeTitle('市场的机会与风险');
  assert.ok(!t2.includes('的机') && !t2.includes('场的'), '含弱字的 bigram 应被过滤');
  // 噪音词整词挖除后，不应残留「念股」「机概」这类跨词碎片
  const t3 = tokenizeTitle('光刻機概念股大漲 英偉達發布新款車型');
  assert.ok(!t3.includes('念股') && !t3.includes('机概'), '噪音词边界碎片应被清除');
  assert.ok(t3.includes('光刻') && t3.includes('车型'), '信号词仍保留');
});

test('词频统计：次数 + 覆盖标题数，按次数降序', () => {
  const r = wordFrequency(['AI芯片大涨 芯片板块走强', '芯片再创新高', '油价上涨']);
  const w = Object.fromEntries(r.map(x => [x.word, x]));
  assert.equal(w['芯片'].count, 3);
  assert.equal(w['芯片'].titles, 2);
  assert.equal(r[0].word, '芯片');
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].count >= x.count), '应按 count 降序');
});

test('板块匹配：按标题去重计数，可多板块命中，结果已排序', () => {
  const titles = ['英伟达发布新一代AI芯片', '光刻机概念股大涨 芯片板块走强', '宁德时代发布麒麟电池', '金价创出新高'];
  const sectors = matchSectors(titles);
  const byName = Object.fromEntries(sectors.map(s => [s.sector, s]));
  assert.equal(byName['半导体 / AI算力'].score, 2, '两条芯片标题应去重计为 2');
  assert.ok(byName['半导体 / AI算力'].keywords.includes('芯片'));
  assert.ok(byName['新能源 / 电池'].score >= 1);
  assert.ok(byName['能源 / 大宗商品'].score >= 1);
  assert.equal(sectors[0].sector, '半导体 / AI算力', '最高分板块应排第一');
  assert.ok(sectors[0].score >= sectors[sectors.length - 1].score);
  // 空输入不报错
  assert.deepEqual(matchSectors([]), []);
  assert.deepEqual(matchSectors(['今天天气不错']), []);
});

test('板块词典：关键词不含违规个股建议词', () => {
  const bad = /目标价|买入评级|卖出评级|个股推荐/;
  for (const kws of Object.values(SECTOR_KEYWORDS)) {
    for (const kw of kws) assert.ok(!bad.test(kw), `违规关键词：${kw}`);
  }
});

test('本地汇总 + 报告渲染：含词频、板块与免责声明', () => {
  const r = analyzeTitles(['英伟达AI芯片大涨', '宁德时代电池发布', '金价创新高'], { top: 10 });
  assert.equal(r.total, 3);
  assert.equal(r.source, 'rule');
  assert.ok(r.topWords.length > 0);
  assert.ok(r.sectors.length > 0);
  const txt = renderSectorReport(r, { top: 10 });
  assert.ok(txt.includes('高频词'));
  assert.ok(txt.includes('板块热度'));
  assert.ok(txt.includes(DISCLAIMER));
  const md = renderSectorMarkdown(r, { top: 10 });
  assert.ok(md.includes('| 排名 | 词 |'), 'Markdown 应含词频表');
  assert.ok(md.includes('| 排名 | 板块 |'), 'Markdown 应含板块表');
  assert.ok(md.includes(DISCLAIMER));
});

test('无 AI Key 时 aiAnalyzeSectors 降级本地规则且如实标注（不冒充 AI）', async () => {
  const saved = { ...process.env };
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const local = analyzeTitles(['芯片大涨', '光刻机龙头受益']);
    const r = await aiAnalyzeSectors(['芯片大涨', '光刻机龙头受益'], local, {});
    assert.equal(r.source, 'rule');
    assert.equal(r.ai, null);
    assert.ok(r.aiNote.includes('未配置'), '应如实标注未配置 Key');
    assert.ok(r.sectors.length > 0, '降级仍保留本地板块结果');
  } finally {
    process.env = saved;
  }
});
