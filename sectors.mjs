// sectors.mjs — 标题词频 + 股票板块归类模块（单一职责）
//
// 职责：接收一批「内容标题」→ 统计高频词 → 归类股票板块热度。
//   · 词频统计：中英文混合分词（中文 bigram + 英文单词），繁体标题先转简体，过滤财经噪音词；
//   · 板块归类（本地规则）：板块关键词词典，按「覆盖标题数」去重计数排序，可核对、可离线运行；
//   · AI 增强（可选）：配置 DEEPSEEK_API_KEY / OPENAI_API_KEY 后，由大模型基于「高频词 + 标题样本」
//     给出板块研判主线（严格 JSON）；无 Key / 调用失败一律降级本地规则并如实标注，绝不伪造 AI 结果；
//   · 合规：只做「板块层面」热度归类，输出统一净除 目标价 / 买入评级 / 卖出评级 / 个股推荐，
//     报告固定附「仅供研究参考，不构成投资建议」。
//
// 入口：
//   toSimplified(text)                    繁体 → 简体（财经高频字映射，零依赖）
//   tokenizeTitle(title)                  标题分词（过滤噪音词）
//   wordFrequency(titles, opts)           词频统计 [{word, count, titles}]
//   matchSectors(titles)                  板块热度 [{sector, score, hitCount, keywords, ratio}]
//   analyzeTitles(titles, opts)           本地规则汇总 {total, topWords, words, sectors, source}
//   aiAnalyzeSectors(titles, local, opts) AI 增强（无 Key 自动降级为本地规则）
//   renderSectorReport(result, opts)      终端报告
//   renderSectorMarkdown(result, opts)    Markdown 简报（可留档 / 推送）
//   buildDemoTitles()                     内置示例标题（--demo 用）
//
// 命令行：
//   node sectors.mjs --demo              用内置示例标题跑一遍
//   node sectors.mjs titles.txt          从文件读取（每行一条，# 开头为注释；也支持 JSON 数组）
//   cat titles.txt | node sectors.mjs    从标准输入读取
//   选项：--top <N>（默认 20） --out <md 文件> --no-ai --json
//
// 环境变量（与 ai.mjs 一致）：DEEPSEEK_API_KEY / OPENAI_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL / DEEPSEEK_TIMEOUT_MS

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formatMacau } from './freshness.mjs';
import { buildDemoSeekingAlpha } from './seekingalpha.mjs';

export const DISCLAIMER = '免责声明：词频与板块热度仅描述舆情热度方向，仅供研究参考，不构成投资建议；不含目标价 / 买入评级 / 卖出评级 / 个股推荐。';

// ===================== 繁体 → 简体（财经标题高频字，零依赖手工映射） =====================
// 只收财经标题高频繁体字；未收录的字原样保留，不影响分词与板块匹配。
const TRAD2SIMP = {
  // 金融 / 交易
  銀: '银', 匯: '汇', 滙: '汇', 幣: '币', 換: '换', 賬: '账', 據: '据', 憑: '凭', 殼: '壳',
  質: '质', 貨: '货', 資: '资', 產: '产', 財: '财', 貿: '贸', 倉: '仓', 儲: '储', 責: '责',
  費: '费', 價: '价', 買: '买', 賣: '卖', 購: '购', 銷: '销', 賺: '赚', 虧: '亏', 損: '损',
  債: '债', 證: '证', 券: '券', 險: '险', 壽: '寿', 稅: '税', 潤: '润', 淨: '净', 帳: '账',
  單: '单', 冊: '册', 書: '书', 籍: '籍', 閱: '阅', 紙: '纸', 報: '报', 業: '业', 績: '绩',
  效: '效', 益: '益', 員: '员', 闆: '板', 職: '职', 崗: '岗', 聘: '聘', 請: '请', 薪: '薪',
  獎: '奖', 齊: '齐', 團: '团', 東: '东', 廠: '厂', 務: '务', 標: '标', 準: '准', 規: '规',
  範: '范', 條: '条', 聞: '闻', 記: '记', 社: '社', 評: '评', 論: '论', 網: '网', 線: '线',
  數: '数', 預: '预', 權: '权', 選: '选', 錄: '录', 題: '题', 認: '认', 識: '识', 議: '议',
  決: '决', 設: '设', 備: '备', 舊: '旧', 複: '复', 復: '复', 甦: '苏', 壓: '压', 轉: '转',
  輔: '辅', 輪: '轮', 連: '连', 續: '续', 較: '较', 須: '须', 項: '项', 監: '监', 罰: '罚',
  號: '号', 葉: '叶', 監: '监', 闢: '辟', 謠: '谣', 闔: '阖', 闖: '闯', 閉: '闭',
  齒: '齿', 齲: '龋', 齷: '龌', 齪: '龊', 齬: '龉', 齧: '啮', 齣: '出', 齶: '腭',
  齡: '龄', 齋: '斋', 齌: '齑', 聯: '联', 紀: '纪', 塊: '块', 彈: '弹', 藍: '蓝',
  籌: '筹', 蝕: '蚀', 傭: '佣', 離: '离', 結: '结', 顯: '显', 場: '场', 徑: '径',
  偉: '伟', 寧: '宁', 鐘: '钟', 紐: '纽', 約: '约', 蘭: '兰', 異: '异', 創: '创',
  體: '体', 強: '强',
  // 语言 / 常用虚词
  馬: '马', 車: '车', 電: '电', 話: '话', 說: '说', 見: '见', 長: '长', 時: '时', 間: '间',
  發: '发', 興: '兴', 軍: '军', 華: '华', 語: '语', 錢: '钱', 對: '对', 導: '导', 試: '试',
  漲: '涨', 億: '亿', 萬: '万', 點: '点', 們: '们', 個: '个', 這: '这', 為: '为', 與: '与',
  將: '将', 會: '会', 應: '应', 該: '该', 讓: '让', 進: '进', 過: '过', 還: '还', 沒: '没',
  現: '现', 實: '实', 裡: '里', 裏: '里', 邊: '边', 後: '后', 麼: '么', 嗎: '吗', 呢: '呢',
  吧: '吧', 啊: '啊', 嘛: '嘛', 喲: '哟', 誒: '诶', 唄: '呗', 囉: '啰', 倆: '俩', 兒: '儿',
  誰: '谁', 什: '什', 哪: '哪', 瞭: '了', 纔: '才', 內: '内', 講: '讲', 訴: '诉', 無: '无',
  齡: '龄', 歲: '岁', 術: '术', 來: '来', 豐: '丰', 廣: '广', 鮑: '鲍', 擴: '扩', 寬: '宽',
  鬆: '松', 緊: '紧', 軋: '轧', 澤: '泽', 確: '确', 軟: '软', 昇: '升', 騰: '腾',
  // 产业 / 商品
  鈷: '钴', 鎳: '镍', 銅: '铜', 鋁: '铝', 錫: '锡', 鉛: '铅', 鋅: '锌', 鐵: '铁', 鋼: '钢',
  礦: '矿', 氣: '气', 風: '风', 陽: '阳', 樁: '桩', 變: '变', 機: '机', 龍: '龙', 頭: '头',
  鏈: '链', 達: '达', 針: '针', 劑: '剂', 疫: '疫', 苗: '苗', 檢: '检', 測: '测', 島: '岛',
  減: '减', 雞: '鸡', 豬: '猪', 飯: '饭', 麵: '面', 糖: '糖', 鹽: '盐', 醬: '酱', 煙: '烟',
  糧: '粮', 飲: '饮', 鋪: '铺', 灣: '湾', 臺: '台', 韓: '韩', 門: '门', 開: '开', 關: '关',
  鍵: '键', 鎖: '锁', 戶: '户', 樓: '楼', 層: '层', 盤: '盘', 軌: '轨', 賽: '赛', 隊: '队',
  輸: '输', 贏: '赢', 橋: '桥', 醫: '医', 藥: '药', 輛: '辆', 駕: '驾', 駛: '驶', 飛: '飞',
  構: '构', 運: '运', 櫃: '柜', 貴: '贵', 賤: '贱', 飢: '饥', 養: '养', 飼: '饲', 噸: '吨',
  鈉: '钠', 鋰: '锂', 氫: '氢'
};
const TRAD_RE = new RegExp('[' + Object.keys(TRAD2SIMP).join('') + ']', 'g');

/** 繁体 → 简体（仅映射财经高频字，其余原样返回） */
export function toSimplified(text) {
  return String(text || '').replace(TRAD_RE, ch => TRAD2SIMP[ch] || ch);
}

// ===================== 噪音词（高频但不代表板块信号） =====================
/** 中文 bigram 噪音词：行情播报类、情绪类、栏目包装类（板块匹配不走分词，不受影响） */
const ZH_NOISE = new Set([
  '市场', '行情', '走势', '大盘', '指数', '恒指', '恒生', '科指', '创业板', '港股', '美股',
  '沪深', '股市', '股票', '股价', '公司', '集团', '板块', '概念', '题材', '主力', '资金',
  '北向', '外资', '龙虎榜', '财报', '业绩', '盈利', '营收', '净利', '利润', '增速', '预期',
  '利好', '利空', '看多', '看空', '牛市', '熊市', '震荡', '放量', '缩量', '新高', '新低',
  '突破', '压力', '支撑', '风险', '机会', '关注', '精选', '干货', '一文', '梳理', '深度',
  '速览', '必看', '视频', '直播', '更新', '上车', '布局', '复盘', '早盘', '尾盘', '收盘',
  '开盘', '午后', '夜盘', '隔夜', '昨夜', '盘中', '涨了', '跌了', '大涨', '大跌', '暴涨',
  '暴跌', '涨停', '跌停', '涨幅', '跌幅', '涨跌', '上涨', '下跌', '反弹', '回调', '调整',
  '观望', '持有', '卖出', '买入', '操作', '策略', '今日', '昨日', '今早', '今晚', '明日',
  '近期', '今年', '去年', '本周', '上周', '下周', '月度', '年度', '季度', '综述', '点评',
  '解读', '分析', '重磅', '突发', '炒作', '热点', '个股', '推荐', '建仓', '清仓', '仓位',
  '发布',
  '情绪', '市值', '换手', '龙头', '强势', '弱势', '横盘', '波动', '区间', '箱体', '趋势',
  '方向', '逻辑', '分化', '轮动', '周期', '成长', '价值', '白马', '题材', '短线', '中线',
  '长线', '波段', '游资', '散户', '庄家', '做多', '做空', '多头', '空头', '轧空', '逼空',
  '踩踏', '护盘', '救市', '维稳', '托市', '熔断', '复牌', '停牌', '摘牌', '退市', '爆仓',
  '爆雷', '踩雷', '埋雷', '炸雷', '违约', '逾期', '展期', '发行', '增发', '定增', '配股',
  '配售', '借钱', '还钱', '欠债', '债务', '杠杆', '配资', '融资', '募资', '圈钱', '抽血',
  '吸金', '捞金', '加仓', '减仓', '底仓', '重仓', '满仓', '空仓', '半仓', '轻仓', '试仓',
  '潜伏', '埋伏', '伏击', '偷袭', '突袭', '奇袭', '出逃', '撤退', '撤离', '离场', '出局',
  '出清', '甩卖', '贱卖', '抛售', '抛盘', '砸盘', '拉升', '拉抬', '拉高', '出货', '派发',
  '天量', '地量', '量柱', '量比', '量峰', '量能', '单量', '均线', '金叉', '死叉', '开口',
  '缩口', '背离', '共振', '站上', '跌破', '失守', '收复', '企稳', '回暖', '升温', '降温',
  '过热', '遇冷', '火热', '冰火', '沸点', '冰点', '高潮', '低迷', '麻木', '钝化', '敏感',
  '淡化', '恐慌', '贪婪', '疯狂', '分歧', '一致', '看好', '看淡', '悲观', '乐观', '割肉',
  '抄底', '逃顶', '摸顶', '探底', '筑底', '底部', '顶部', '半山', '山腰', '高位', '低位',
  '超跌', '超买', '超卖', '修复', '泡沫', '破裂', '分化', '回流', '流入', '流出', '抽水',
  '吸血', '弹药', '位阶', '台阶', '梯度', '层级', '档次', '水准', '水平', '级别', '等级',
  '排名', '居前', '靠前', '领先', '落后', '垫底', '倒数', '榜首', '冠军', '满分', '零分',
  '高分', '低分', '及格', '亏损', '赚钱', '蚀本', '蚀钱', '花钱', '省钱', '存钱', '取钱',
  '印钞', '放水', '收水', '大水', '漫灌', '滴灌', '稳市', '救市', '托盘', '护盘', '维稳',
  '一字', '天地', '地天', '核按钮', '秒板', '翘尾', '异动', '异动拉升', '直线', '快速拉升',
  '放量拉升', '缩量回调', '无量阴跌', '温和放量', '力度', '强度', '烈度', '贡献', '阻力',
  '分红', '派息', '股息', '送股', '转增', '填权', '贴权', '除权', '除息', '复权', '前复权',
  '后复权', '年报', '中报', '季报', '快报', '预告', '预披', '更正', '补充', '延期', '立案',
  '调查', '质询', '函询', '监管函', '警示函', '处罚', '罚款', '预期差', '黑天鹅', '灰犀牛',
  '明斯基', '去中心', '中心化', '脱钩', '断链', '保链', '稳链', '强链', '补链', '延链',
  '卡脖子', '自主可控', '国产替代', '进口替代', '内循环', '外循环', '双循环'
]);

/** 英文停用词 + 财经泛噪音词 */
const EN_NOISE = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'by', 'at', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'and', 'or',
  'but', 'not', 'from', 'will', 'would', 'may', 'can', 'could', 'should', 'shall', 'after',
  'before', 'amid', 'vs', 'versus', 'into', 'onto', 'upon', 'about', 'above', 'below', 'between',
  'through', 'during', 'since', 'until', 'while', 'because', 'though', 'although', 'however',
  'therefore', 'thus', 'hence', 'still', 'yet', 'already', 'also', 'just', 'now', 'new', 'one',
  'two', 'per', 'via', 'out', 'up', 'down', 'over', 'under', 'again', 'once', 'here', 'there',
  'when', 'where', 'what', 'which', 'who', 'whom', 'how', 'why', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only', 'own', 'same', 'too',
  'very', 'get', 'got', 'make', 'makes', 'take', 'takes', 'see', 'saw', 'said', 'says',
  'stock', 'stocks', 'share', 'shares', 'market', 'markets', 'rally', 'rallies', 'selloff',
  'crash', 'surge', 'plunge', 'gain', 'gains', 'loss', 'losses', 'index', 'indexes', 'etf',
  'investor', 'investors', 'trader', 'traders', 'trading', 'price', 'prices', 'watch', 'today',
  'latest', 'news', 'video', 'videos', 'update', 'updates', 'beat', 'beats', 'miss', 'misses',
  'earnings', 'revenue', 'growth', 'company', 'companies', 'firm', 'firms', 'sector', 'sectors',
  'board', 'boards', 'close', 'closed', 'opening', 'closing', 'premarket', 'afterhours',
  'wallstreet', 'street', 'dow', 'nasdaq', 'snp', 'sp500'
]);

/** 中文单字白名单（独立成词才计入词频，避免单字噪音） */
const ZH_SINGLE_OK = new Set('金银油铜锂镍锡锌煤钢猪牛羊鸡鸭鱼虾蟹糖盐茶棉麦豆酒药车船票债汇贷'.split(''));

/** 中文 bigram 的「弱字」表：含这些字的 bigram 一律丢弃（虚词/方位词/代词等） */
const ZH_WEAK_CHAR = new Set('的了和与及在对是将被把向从到又也都还就不个中内外前后间其各每本该这那哪里边着过们或而但呢吗啊吧嘛么什幺之乎者也矣焉哉凡且乃若则因为所以才再很最更太真没无非可可以能得地让应给跟同往朝自从她他它'.split(''));

// 分词前先把噪音词整体挖掉（避免「概念股」切成「念股」这类跨词碎片）
const ZH_NOISE_RE = new RegExp([...ZH_NOISE].sort((a, b) => b.length - a.length).join('|'), 'g');

/** 标题预处理：去 URL、去多余空白 */
function cleanTitle(title) {
  return String(title || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 标题分词：中文连续字串切 bigram（过滤弱字/噪音词）+ 英文单词（小写、过滤停用词）。
 * 标点、纯数字代码自动跳过；单个汉字只在白名单内才保留。
 * @returns {string[]}
 */
export function tokenizeTitle(title) {
  const raw = cleanTitle(toSimplified(title)).replace(ZH_NOISE_RE, ' ');
  if (!raw) return [];
  const words = [];
  // 英文 / 数字代码片段
  const enRe = /[A-Za-z0-9][A-Za-z0-9+#.]*/g;
  let m;
  while ((m = enRe.exec(raw))) {
    const w = m[0].toLowerCase();
    if (/^[0-9.]+$/.test(w)) continue;   // 纯数字 / 指数点数
    if (!/[a-z]/.test(w)) continue;      // 无字母（纯数字代码）
    if (w.length < 2 || w.length > 15) continue;
    if (EN_NOISE.has(w)) continue;
    words.push(w);
  }
  // 中文：连续汉字串 → bigram + 白名单单字
  const zhRe = /[\u4e00-\u9fff]+/g;
  while ((m = zhRe.exec(raw))) {
    const run = m[0];
    if (run.length === 1) {
      if (ZH_SINGLE_OK.has(run)) words.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const g = run.slice(i, i + 2);
      if (ZH_WEAK_CHAR.has(g[0]) || ZH_WEAK_CHAR.has(g[1])) continue;
      if (ZH_NOISE.has(g)) continue;
      words.push(g);
    }
  }
  return words;
}

/**
 * 词频统计：count = 总出现次数，titles = 覆盖的不同标题数。
 * @returns {Array<{word:string, count:number, titles:number}>} 按 count 降序
 */
export function wordFrequency(titles = [], opts = {}) {
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : Infinity;
  const map = new Map();
  for (const t of titles || []) {
    const seen = new Set();
    for (const w of tokenizeTitle(t)) {
      if (!map.has(w)) map.set(w, { word: w, count: 0, titles: 0 });
      const e = map.get(w);
      e.count++;
      if (!seen.has(w)) { seen.add(w); e.titles++; }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.titles - a.titles || (a.word < b.word ? -1 : 1))
    .slice(0, limit);
}

// ===================== 板块关键词词典（板块层面，公司/商品名仅作板块信号词） =====================
export const SECTOR_KEYWORDS = {
  '半导体 / AI算力': ['芯片', '半导体', '晶圆', '光刻', '刻蚀', '封测', '先进制程', '台积电', 'tsmc', '三星电子', '英伟达', 'nvidia', '英特尔', 'intel', 'amd', '博通', 'avgo', '高通', '联发科', '美光', '海力士', 'hbm', 'dram', '存储', '光模块', '光互连', 'cpo', '算力', '人工智能', '大模型', 'eda', '华为', '鸿蒙', '昇腾', '寒武纪', '中芯国际', '华虹', 'pcb', 'ai'],
  '新能源 / 电池': ['锂电', '电池', '宁德时代', '比亚迪', '固态电池', '钠电', '碳酸锂', '正极', '负极', '隔膜', '电解液', '锂', '钴', '镍', '充电桩', '充电', '超充', '补能', '光伏', '硅料', '硅片', '逆变器', '风电', '储能', '氢能', '新能源车', '电动车'],
  '汽车 / 智驾': ['汽车', '整车', '智驾', '智能驾驶', '自动驾驶', '辅助驾驶', '特斯拉', 'tesla', '蔚来', '小鹏', '理想', '问界', '小米汽车', '汽车链', '零部件', '轮胎', '智能座舱', '车企'],
  '医药 / 生物科技': ['医药', '创新药', '生物医药', '生物药', '疫苗', '医疗器械', '医疗', '药企', 'pd-1', 'pd1', 'glp-1', '减肥药', '司美格鲁肽', '医保', '集采', '仿制药', 'cro'],
  '金融 / 地产': ['银行', '券商', '保险', '信托', '基金', '证券', '地产', '房地产', '内房', '楼市', '房贷', '按揭', '物业', 'reits', 'mreit', '房企', '信贷', '杠杆'],
  '宏观 / 利率 / 政策': ['美联储', '鲍威尔', '加息', '降息', '降准', '利率', '国债', '收益率', '通胀', 'cpi', 'pmi', '汇率', '人民币', '美元', '美债', '财政', '关税', '贸易', '地缘', '刺激', '央行', '息口', '议息', '复苏'],
  '消费 / 白酒': ['白酒', '茅台', '五粮液', '消费', '免税', '旅游', '出行', '零售', '超市', '食品饮料', '乳制品', '啤酒', '预制菜', '电商', '餐饮', '奢侈品'],
  '能源 / 大宗商品': ['石油', '原油', '油价', '天然气', '煤炭', '黄金', '金价', '白银', '铜', '铜价', '有色', '铝', '锡', '锌', '铁矿石', '欧佩克', '页岩油', '大宗'],
  '军工 / 航天': ['军工', '国防', '导弹', '无人机', '战机', '航母', '航天', '卫星', '北斗', '商业航天', '火箭', '军费'],
  '科技 / 互联网': ['互联网', '平台', '云计算', '云服务', 'saas', '游戏', '手游', '网游', '广告', '直播', '短视频', '社交', '出海', '腾讯', '阿里', '百度', '字节', '美团', '京东', '拼多多', '小米'],
  '通信 / 运营商': ['通信', '5g', '6g', '运营商', '基站', '光纤', '光缆', '卫星通信', '星链'],
  '农林牧渔': ['农业', '猪肉', '猪周期', '饲料', '种业', '粮食', '大豆', '玉米', '农产品', '禽流感', '生猪', '养殖'],
  '航运 / 贸易': ['航运', '集运', '集装箱', '运价', '油运', '散货', '港口', '波罗的海', 'bdi'],
  '基建 / 建材 / 家电': ['基建', '水利', '一带一路', '建材', '水泥', '钢铁', '钢材', '玻璃', '家居', '家电', '空调', '冰箱', '洗衣机', '白电'],
  '传媒 / 影视': ['电影', '票房', '影视', '传媒', '院线']
};

/**
 * 板块匹配：每条标题对每个板块只计一次（覆盖标题数 = score），同时累计命中关键词。
 * 标题先转简体再匹配（英文关键词统一小写比较）。
 * @returns {Array<{sector:string, score:number, hitCount:number, keywords:string[], ratio:number}>}
 */
export function matchSectors(titles = []) {
  const list = (titles || []).map(t => cleanTitle(toSimplified(t)).toLowerCase()).filter(Boolean);
  const total = list.length || 1;
  const out = [];
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    const kwLower = kws.map(k => k.toLowerCase());
    let score = 0;
    let hitCount = 0;
    const kwHits = new Map();
    for (const t of list) {
      let hit = false;
      kwLower.forEach((kw, ki) => {
        if (t.includes(kw)) {
          hit = true;
          hitCount++;
          kwHits.set(kws[ki], (kwHits.get(kws[ki]) || 0) + 1);
        }
      });
      if (hit) score++;
    }
    if (score === 0) continue;
    const keywords = [...kwHits.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([k]) => k);
    out.push({ sector, score, hitCount, keywords, ratio: score / total });
  }
  out.sort((a, b) => b.score - a.score || b.hitCount - a.hitCount || (a.sector < b.sector ? -1 : 1));
  return out;
}

/**
 * 本地规则汇总：词频 + 板块热度。
 * @returns {{total:number, topWords:Array, words:Array, sectors:Array, source:'rule', generatedAt:number}}
 */
export function analyzeTitles(titles = [], opts = {}) {
  const top = Number(opts.top) > 0 ? Number(opts.top) : 20;
  const clean = (titles || []).map(cleanTitle).filter(Boolean);
  const words = wordFrequency(clean);
  return {
    total: clean.length,
    topWords: words.slice(0, top),
    words,
    sectors: matchSectors(clean),
    source: 'rule',
    generatedAt: Date.now()
  };
}

// ===================== AI 增强（可选，失败降级本地规则） =====================
const AI_DEFAULT_BASE = 'https://api.deepseek.com/v1';
const AI_DEFAULT_MODEL = 'deepseek-chat';
const AI_DEFAULT_TIMEOUT = 50000;
const STOCK_ENTRY_RE = /个股页|個股頁|STOCK PAGE|个股推荐|個股推薦|目标价|目標價|买入评级|買入評級|卖出评级|賣出評級|建议买入|建議買入|建议卖出|建議賣出/;

function getAiConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || AI_DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL || AI_DEFAULT_MODEL;
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || AI_DEFAULT_TIMEOUT;
  return { apiKey, baseUrl, model, timeoutMs };
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  return null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function buildSectorPrompt(titles, local) {
  const lines = [];
  lines.push('你是一名中文财经情报编辑。下面是一批内容标题的「高频词统计」和「标题原文样本」。');
  lines.push('');
  lines.push('【任务】');
  lines.push('1. 只依据给定材料，判断舆情热度最高的股票板块（板块层面，不要拆到个股）。');
  lines.push('2. 输出严格的 JSON，不要任何额外解释、不要 Markdown 代码块、不要前后缀文字。');
  lines.push('3. 禁止输出目标价、买入/卖出评级、个股推荐；板块名称用中文，如「半导体/AI算力」「新能源/锂电」「医药/创新药」。');
  lines.push('4. JSON 字段：');
  lines.push('   {');
  lines.push('     "main": "今日主线",        // 80-150 字，一段话概括舆情最核心的板块故事');
  lines.push('     "sectors": [               // 3-8 个板块，按热度降序');
  lines.push('       {"name": "板块名", "weight": 1-100, "reason": "不超过 20 字"} ]');
  lines.push('     "topWords": [             // 点评高频词的板块含义');
  lines.push('       {"word": "高频词", "why": "不超过 15 字"} ]');
  lines.push('   }');
  lines.push('5. 重要：只基于下方提供的内容做判断，不要编造材料里没有的事实、数字、人名。');
  lines.push('6. 重要：仅作研究参考，不构成投资建议——main 段落保持中性、克制的语气。');
  lines.push('');
  lines.push('【高频词 TOP 25】');
  for (const w of (local.topWords || []).slice(0, 25)) {
    lines.push(`${w.word}: ${w.count} 次 / ${w.titles} 条标题`);
  }
  lines.push('');
  lines.push('【本地规则板块热度（供核对）】');
  for (const s of (local.sectors || []).slice(0, 10)) {
    lines.push(`${s.sector}: 覆盖 ${s.score}/${local.total} 条（命中词：${s.keywords.slice(0, 5).join('、')}）`);
  }
  lines.push('');
  lines.push('【标题样本】');
  titles.slice(0, 30).forEach((t, i) => lines.push(`${i + 1}. ${String(t).slice(0, 120)}`));
  return lines.join('\n');
}

function normalizeAiOutput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const main = typeof raw.main === 'string' && !STOCK_ENTRY_RE.test(raw.main)
    ? raw.main.trim().slice(0, 800) : '';
  const sectors = Array.isArray(raw.sectors)
    ? raw.sectors
        .filter(x => x && typeof x.name === 'string' && x.name.trim() && !STOCK_ENTRY_RE.test(x.name))
        .map(x => ({
          name: x.name.trim().slice(0, 40),
          weight: clamp(Math.round(Number(x.weight) || 0), 1, 100),
          reason: String(x.reason || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200)
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 10)
    : [];
  const topWords = Array.isArray(raw.topWords)
    ? raw.topWords
        .filter(x => x && typeof x.word === 'string' && x.word.trim() && !STOCK_ENTRY_RE.test(x.word))
        .map(x => ({ word: x.word.trim().slice(0, 40), why: String(x.why || '').trim().slice(0, 100) }))
        .slice(0, 15)
    : [];
  if (!main && !sectors.length) return null;
  return { main, sectors, topWords };
}

/**
 * AI 板块研判（可选）。无 Key / 调用失败 / 返回无法解析 → 降级本地规则并如实标注。
 * @param {string[]} titles
 * @param {object} local  analyzeTitles 的结果
 * @returns {Promise<object>} {...local, source:'ai'|'rule', ai: object|null, aiNote: string}
 */
export async function aiAnalyzeSectors(titles, local, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const cfg = getAiConfig();
  if (!cfg.apiKey) {
    return { ...local, source: 'rule', ai: null, aiNote: '未配置 DEEPSEEK_API_KEY / OPENAI_API_KEY，仅本地规则（词频 + 板块词典可核对）' };
  }
  const clean = (titles || []).map(cleanTitle).filter(Boolean);
  if (!clean.length) return { ...local, source: 'rule', ai: null, aiNote: '无标题可分析' };
  const prompt = buildSectorPrompt(clean, local);
  onLog(`[ai] 调用 ${cfg.model}，输入 ${clean.length} 条标题，prompt ${prompt.length} 字符`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let resp;
  try {
    resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是严谨的中文财经情报编辑。严格只回 JSON，不要任何解释。' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    onLog(`[ai] 网络异常：${e.message || e}`);
    return { ...local, source: 'rule', ai: null, aiNote: `AI 调用失败（${e.message || e}），已降级本地规则` };
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    onLog(`[ai] HTTP ${resp.status}：${t.slice(0, 300)}`);
    return { ...local, source: 'rule', ai: null, aiNote: `AI 返回 HTTP ${resp.status}，已降级本地规则` };
  }
  let data;
  try { data = await resp.json(); } catch (e) {
    return { ...local, source: 'rule', ai: null, aiNote: `AI 响应非 JSON（${e.message}），已降级本地规则` };
  }
  const text = data?.choices?.[0]?.message?.content || '';
  onLog(`[ai] 模型返回 ${text.length} 字符`);
  const parsed = normalizeAiOutput(extractJson(text));
  if (!parsed) {
    onLog('[ai] 无法解析模型输出，降级本地规则');
    return { ...local, source: 'rule', ai: null, aiNote: 'AI 返回无法解析，已降级本地规则' };
  }
  onLog(`[ai] 板块研判完成：${parsed.sectors.length} 个板块`);
  return { ...local, source: 'ai', ai: parsed, aiNote: `模型：${cfg.model} 板块研判` };
}

// ===================== 报告渲染 =====================
const bar = (ratio, width = 16) => {
  const n = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(n) + '░'.repeat(width - n);
};

const pct = n => `${Math.round(n * 100)}%`;

function sourceText(result) {
  if (result.source === 'ai') return `模型：${result.aiNote || 'AI'}（本地词频 / 板块热度供核对）`;
  return `模型：本地规则（${result.aiNote || '未配置 AI Key'}）`;
}

/** 终端报告 */
export function renderSectorReport(result, opts = {}) {
  const top = Number(opts.top) > 0 ? Number(opts.top) : 20;
  const lines = [];
  const total = result.total || 0;
  const maxWord = (result.topWords && result.topWords[0] && result.topWords[0].count) || 1;
  const maxScore = (result.sectors && result.sectors[0] && result.sectors[0].score) || 1;
  lines.push('='.repeat(64));
  lines.push(`标题词频 · 板块归类（共 ${total} 条标题${result.demo ? ' · 示例数据' : ''}）`);
  lines.push(sourceText(result));
  lines.push(`生成时间：${formatMacau(result.generatedAt || Date.now())}`);
  lines.push('='.repeat(64));
  lines.push('');
  lines.push(`【高频词 TOP ${Math.min(top, (result.topWords || []).length)}】共 ${(result.words || []).length} 个词条`);
  if (!result.topWords || !result.topWords.length) {
    lines.push('  （未统计到有效词条）');
  }
  (result.topWords || []).slice(0, top).forEach((w, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. ${w.word.padEnd(12)} ${bar(w.count / maxWord, 12)} ${String(w.count).padStart(3)} 次 · ${w.titles} 条`);
  });
  lines.push('');
  lines.push('【板块热度】按覆盖标题数排序（本地规则，可核对）');
  if (!result.sectors || !result.sectors.length) {
    lines.push('  （未匹配到明确板块信号）');
  }
  (result.sectors || []).forEach((s, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. ${s.sector.padEnd(18)} ${bar(s.score / maxScore, 12)} ${String(s.score).padStart(2)}/${total} 条（${pct(s.ratio)}）`);
    if (s.keywords.length) lines.push(`      命中词：${s.keywords.slice(0, 8).join('、')}`);
  });
  if (result.ai) {
    lines.push('');
    lines.push(`【AI 板块研判】${result.aiNote || ''}`);
    if (result.ai.main) lines.push(`  主线：${result.ai.main}`);
    result.ai.sectors.forEach((s, i) => {
      lines.push(`  ${String(i + 1).padStart(2)}. ${s.name}  权重 ${s.weight}  ${bar(s.weight / 100, 10)}  ${s.reason ? '— ' + s.reason : ''}`);
    });
    if (result.ai.topWords && result.ai.topWords.length) {
      lines.push('  高频词解读：');
      result.ai.topWords.slice(0, 8).forEach(w => lines.push(`    · ${w.word}：${w.why}`));
    }
  }
  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/** Markdown 简报 */
export function renderSectorMarkdown(result, opts = {}) {
  const top = Number(opts.top) > 0 ? Number(opts.top) : 20;
  const total = result.total || 0;
  const lines = [];
  lines.push('# 标题词频 · 板块归类简报');
  lines.push('');
  lines.push(`> 共 **${total}** 条标题${result.demo ? '（示例数据）' : ''} · ${sourceText(result)} · 生成时间 ${formatMacau(result.generatedAt || Date.now())}`);
  lines.push('');
  lines.push(`## 高频词 TOP ${Math.min(top, (result.topWords || []).length)}`);
  lines.push('');
  lines.push('| 排名 | 词 | 出现次数 | 覆盖标题数 | 热度 |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  const maxWord = (result.topWords && result.topWords[0] && result.topWords[0].count) || 1;
  (result.topWords || []).slice(0, top).forEach((w, i) => {
    lines.push(`| ${i + 1} | ${w.word} | ${w.count} | ${w.titles} | ${bar(w.count / maxWord, 10)} |`);
  });
  if (!result.topWords || !result.topWords.length) lines.push('| — | （未统计到有效词条） | — | — | — |');
  lines.push('');
  lines.push('## 板块热度（本地规则 · 按覆盖标题数排序）');
  lines.push('');
  lines.push('| 排名 | 板块 | 覆盖标题数 | 占比 | 命中关键词 |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  if (!result.sectors || !result.sectors.length) lines.push('| — | （未匹配到明确板块信号） | — | — | — |');
  (result.sectors || []).forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s.sector} | ${s.score}/${total} | ${pct(s.ratio)} | ${s.keywords.slice(0, 8).join('、')} |`);
  });
  if (result.ai) {
    lines.push('');
    lines.push(`## AI 板块研判（${result.aiNote || ''}）`);
    lines.push('');
    if (result.ai.main) lines.push(`> **今日主线**：${result.ai.main}`);
    lines.push('');
    lines.push('| 排名 | 板块 | 权重 | 依据 |');
    lines.push('| --- | --- | ---: | --- |');
    result.ai.sectors.forEach((s, i) => lines.push(`| ${i + 1} | ${s.name} | ${s.weight} | ${s.reason || '—'} |`));
    if (result.ai.topWords && result.ai.topWords.length) {
      lines.push('');
      lines.push('### 高频词解读');
      result.ai.topWords.forEach(w => lines.push(`- **${w.word}**：${w.why}`));
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

// ===================== 命令行入口 =====================
/** 内置示例标题（--demo）：Seeking Alpha 示例文章 + 频道风格示例（繁体/简体/英文混合） */
export function buildDemoTitles() {
  const titles = [];
  try {
    const { items } = buildDemoSeekingAlpha(Date.now());
    for (const it of items) {
      if (it.titleZh) titles.push(it.titleZh);
      if (it.title && it.title !== it.titleZh) titles.push(it.title);
    }
  } catch { /* 示例数据不可用时跳过 */ }
  titles.push(
    '港股午後跌幅收窄 恒指重上18000點 內房板塊反彈',
    '美聯儲議息紀錄顯示官員分歧擴大 市場押注年內路徑',
    'Stocks rally as inflation data cools 美股通胀数据降温带动反弹',
    '英偉達發布新一代AI芯片 光刻機概念股大漲',
    '寧德時代發布麒麟電池 充電五分鐘續航四百公里',
    '金價創新高 紐約期金升穿每盎司2100美元',
    '創新藥板塊集體走強 中藥概念受政策關注',
    '油價反彈 布蘭特原油重上每桶85美元',
    '無人機概念股異動 軍工板塊再度拉升',
    '特斯拉發布新款車型 智能駕駛概念股上漲'
  );
  return titles;
}

function parseTitlesText(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  // JSON 数组（字符串或 {title} 对象）
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const arr = JSON.parse(s);
      const list = Array.isArray(arr) ? arr : [arr];
      return list
        .map(x => (typeof x === 'string' ? x : (x && (x.title || x.titleZh || x.name)) || ''))
        .map(x => String(x).trim())
        .filter(Boolean);
    } catch { /* 落回按行解析 */ }
  }
  return s.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

function printHelp() {
  console.log(`用法：
  node sectors.mjs --demo                 用内置示例标题跑一遍
  node sectors.mjs <文件>                 从文件读取标题（每行一条，# 注释；支持 JSON 数组）
  cat titles.txt | node sectors.mjs       从标准输入读取
选项：
  --top <N>     词频榜展示条数（默认 20）
  --out <文件>  另存 Markdown 简报
  --no-ai       跳过 AI 研判（只跑本地规则）
  --json        输出完整 JSON（含词频明细）
  --help        显示本帮助
环境变量（与 ai.mjs 一致）：DEEPSEEK_API_KEY / OPENAI_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
合规：${DISCLAIMER}`);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  let inputFile = null, demo = false, top = 20, out = null, noAi = false, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--demo') demo = true;
    else if (a === '--no-ai') noAi = true;
    else if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') { printHelp(); return; }
    else if (a === '--top') top = Number(args[++i]) || 20;
    else if (a === '--out') out = args[++i] || null;
    else if (a === '--input') inputFile = args[++i] || null;
    else if (!a.startsWith('--') && !inputFile) inputFile = a;
    else { console.error(`未知参数：${a}（--help 查看用法）`); process.exitCode = 1; return; }
  }

  let titles = [];
  if (demo) {
    titles = buildDemoTitles();
  } else if (inputFile && inputFile !== '-') {
    titles = parseTitlesText(readFileSync(inputFile, 'utf8'));
  } else if (inputFile === '-' || (!inputFile && !process.stdin.isTTY)) {
    titles = parseTitlesText(await readStdin());
  } else {
    printHelp();
    return;
  }
  if (!titles.length) {
    console.error('没有读到任何标题。把标题存成 txt（每行一条）或直接管道传入，例如：cat titles.txt | node sectors.mjs');
    process.exitCode = 1;
    return;
  }

  const local = analyzeTitles(titles, { top });
  let result;
  if (!noAi) {
    result = { ...(await aiAnalyzeSectors(titles, local, { onLog: s => console.error(s) })), demo };
  } else {
    result = { ...local, demo, ai: null, aiNote: '已跳过 AI（--no-ai），仅本地规则' };
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderSectorReport(result, { top }));
  }
  if (out) {
    writeFileSync(out, renderSectorMarkdown(result, { top }) + '\n', 'utf8');
    console.error(`Markdown 简报已写入：${out}`);
  }
}

const isMain = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch { return false; }
})();
if (isMain) main();
