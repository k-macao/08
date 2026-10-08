// longshort.mjs — AI 多空概率模块（单一职责）
//
// 简报里每条内容都带一个「AI 多空概率」：看多 bull% / 看空 bear%（两者相加 = 100）。
//  · 有 AI Key（DeepSeek / OpenAI 兼容）时，由大模型依据标题 + 字幕（若有）推算；
//  · 无 Key 或调用失败时，降级为本地规则推算（关键词计分），并明确标注来源，绝不伪造 AI 结果。
//  · 概率仅作研究参考，不构成投资建议，也不输出目标价、买卖评级等个股推荐内容。
//
// 纯函数（可本地自测）：
//   ruleLongShort(item)        关键词计分 → 多空概率
//   normalizeProbability(obj)  归一化任意输入（含 AI 输出）→ 合法概率
//   probabilityLabel(bb)       “多 62% / 空 38%”
//   bullBearBar(bb)            终端风格进度条（█ / ░），网页与推送共用文本形态
//   aggregateLongShort(items)  全景汇总概率

/** 看多（利多）关键词：标题命中权重更高 */
export const BULL_TERMS = [
  '上涨', '上漲', '上升', '走高', '涨', '漲', '拉升', '新高', '创新高', '創新高', '反弹', '反彈', '回升', '回暖',
  '利好', '利多', '超预期', '超預期', '增长', '增長', '突破', '走强', '走強', '牛市', '看多', '乐观', '樂觀',
  '降息', '降准', '降準', '宽松', '寬鬆', '刺激', '复苏', '復甦', '盈利', '上调', '上調', '增持',
  '净流入', '淨流入', '资金流入', '資金流入', '放量上攻', '红盘', '紅盤', 'record high', 'rally', 'surge', 'bullish'
];

/** 看空（利空）关键词 */
export const BEAR_TERMS = [
  '下跌', '下滑', '走低', '跌', '新低', '创新低', '創新低', '回落', '调整', '調整', '利空', '衰退', '暴跌', '崩盘', '崩盤',
  '熊市', '看空', '悲观', '悲觀', '加息', '收紧', '收緊', '通胀', '通脹', '滞胀', '滯脹', '违约', '違約', '裁员', '裁員',
  '亏损', '虧損', '风险', '風險', '危机', '危機', '下调', '下調', '抛售', '拋售', '承压', '承壓', '净流出', '淨流出',
  '资金流出', '資金流出', '不及预期', '不及預期', '利淡', '探底', 'bearish', 'selloff', 'crash', 'recession'
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 统计一段文本里命中的关键词（去重，同一关键词只记一次） */
function countTerms(text, terms) {
  const s = String(text || '');
  if (!s) return [];
  return terms.filter(t => s.includes(t));
}

/**
 * 本地规则推算多空概率（AI 不可用时的降级路径）。
 * 计分：标题命中 ×2、字幕命中 ×1；净分每分 ±7 个百分点，基准 50%，限制在 [10, 90]。
 * @param {{title?:string, originalTitle?:string, transcript?:string, channel?:string}} item
 * @returns {{bull:number, bear:number, note:string, source:'rule', hits:{bull:string[],bear:string[]}}}
 */
export function ruleLongShort(item = {}) {
  const titleText = `${item.title || ''} ${item.originalTitle || ''}`;
  const bodyText = String(item.transcript || '').slice(0, 4000);
  const bullHits = [...new Set([...countTerms(titleText, BULL_TERMS), ...countTerms(bodyText, BULL_TERMS)])];
  const bearHits = [...new Set([...countTerms(titleText, BEAR_TERMS), ...countTerms(bodyText, BEAR_TERMS)])];
  const titleBull = countTerms(titleText, BULL_TERMS).length;
  const titleBear = countTerms(titleText, BEAR_TERMS).length;
  const bodyBull = countTerms(bodyText, BULL_TERMS).length;
  const bodyBear = countTerms(bodyText, BEAR_TERMS).length;
  const score = (titleBull - titleBear) * 2 + (bodyBull - bodyBear);
  const bull = clamp(Math.round(50 + score * 7), 10, 90);
  const bear = 100 - bull;
  let note;
  if (bull > 55) note = `偏多：${(bullHits.slice(0, 3).join(' / ') || '情绪偏暖')}`;
  else if (bull < 45) note = `偏空：${(bearHits.slice(0, 3).join(' / ') || '情绪偏冷')}`;
  else note = '中性：未出现明确方向信号';
  if (!bodyText) note += '（仅标题）';
  return { bull, bear, note: sanitizeNote(note), source: 'rule', hits: { bull: bullHits, bear: bearHits } };
}

/**
 * 净化说明文案：禁止出现个股买卖建议类措辞（目标价 / 买入评级 / 卖出评级 / 个股推荐 等），
 * 概率只描述市场情绪方向，不构成投资建议。
 */
export function sanitizeNote(text) {
  let s = String(text || '').replace(/[\r\n\t]+/g, ' ').trim();
  s = s.replace(/(目标价|目標價|买入评级|買入評級|卖出评级|賣出評級|个股推荐|個股推薦|建议买入|建議買入|建议卖出|建議賣出)/g, '方向信号');
  return s.slice(0, 40);
}

/**
 * 归一化任意多空输入（含 AI 返回值）为合法概率：整数、5–95、多 + 空 = 100。
 * 非法输入返回 null。
 */
export function normalizeProbability(raw) {
  if (raw == null) return null;
  let bull = Number(typeof raw === 'object' ? raw.bull : raw);
  if (!Number.isFinite(bull)) return null;
  bull = clamp(Math.round(bull), 5, 95);
  return { bull, bear: 100 - bull };
}

/** “多 62% / 空 38%” */
export function probabilityLabel(bb) {
  const n = normalizeProbability(bb);
  if (!n) return '';
  return `多 ${n.bull}% / 空 ${n.bear}%`;
}

/** 终端风格条形图：多 ████████░░ 62% ｜ 空 ███░░░░░░░ 38% */
export function bullBearBar(bb, width = 10) {
  const n = normalizeProbability(bb);
  if (!n) return '';
  const fill = v => {
    const k = clamp(Math.round(v / 100 * width), 0, width);
    return '█'.repeat(k) + '░'.repeat(width - k);
  };
  return `多 ${fill(n.bull)} ${n.bull}% ｜ 空 ${fill(n.bear)} ${n.bear}%`;
}

/**
 * 全景汇总概率：对已带 bullBear 的条目取（按看多强度加权的）平均值。
 * @returns {{bull:number,bear:number,count:number,source:string}|null}
 */
export function aggregateLongShort(items = []) {
  const valid = items.filter(x => x && !x.error && normalizeProbability(x.bullBear));
  if (!valid.length) return null;
  const sum = valid.reduce((acc, x) => acc + normalizeProbability(x.bullBear).bull, 0);
  const bull = clamp(Math.round(sum / valid.length), 5, 95);
  const aiCount = valid.filter(x => x.bullBear && x.bullBear.source === 'ai').length;
  return {
    bull,
    bear: 100 - bull,
    count: valid.length,
    source: aiCount === valid.length ? 'ai' : aiCount > 0 ? 'mixed' : 'rule'
  };
}

/** 概率来源说明（用于反白徽章下方的小字，绝不冒充 AI） */
export function probabilitySourceText(source) {
  if (source === 'ai') return '模型：DeepSeek 多空推理';
  if (source === 'mixed') return '模型：DeepSeek + 本地规则';
  return '模型：本地规则（未配置 AI Key）';
}
