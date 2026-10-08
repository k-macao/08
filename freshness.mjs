// freshness.mjs — 时效验证模块（单一职责）
//
// 规则：简报只保留「发布时间在最近 72 小时之内」的内容；
//       无法验证发布时间的内容一律隐藏（宁可少推，也不推过期/不可考证的内容）。
//
// 提供纯函数，便于本地自测与在 server.js / 工作流中复用：
//   FRESH_WINDOW_MS / FRESH_WINDOW_LABEL  窗口常量
//   parseRelativeAgeMs(text)              把 YouTube 的相对时间（“3小时前” / “2 days ago”）转成毫秒
//   parseAbsoluteTime(text)               把绝对时间字符串（publishDate / datePublished）转成 ISO
//   describeAgeMs(ageMs)                  毫秒 → 中文年龄文案（“3 小时前”）
//   formatMacau(isoOrDate)                ISO → 澳门时间（UTC+8）文案 “2026-10-08 07:20”
//   evaluateFreshness(video, now)         综合裁决：fresh / stale / unknown
//   isFreshItem(item, now)                对扫描结果条目（含 publishedAt）做兜底判定

export const FRESH_WINDOW_MS = 72 * 60 * 60 * 1000;
export const FRESH_WINDOW_LABEL = '72 小时';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * YouTube 的相对发布时间文案 → 时间区间。
 * 覆盖中文（刚刚 / 12分钟前 / 3小时前 / 2天前 / 1周前 / 1个月前）
 * 与英文（just now / 12 minutes ago / 3 hours ago / 2 days ago / Streamed 2 days ago / Premiered 5 hours ago）。
 *
 * 关键：相对时间是「向上取整」的展示值，因此真实年龄落在 [minAgeMs, maxAgeMs) 区间内：
 *   “2 天前” → 实际 48–72 小时；“3 天前” → 实际 72–96 小时（按 72 小时规则必须隐藏）。
 * @returns {{minAgeMs:number, maxAgeMs:number}|null} 无法识别返回 null
 */
export function parseRelativeAgeRange(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // “刚刚 / 直播中 / just now / now streaming” 视为 1 分钟内
  if (/(刚刚|剛剛|直播中|正在直播|首播|just now|streaming now|live now|now)/i.test(s)) return { minAgeMs: 0, maxAgeMs: MINUTE };
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(秒|分钟|分鐘|小时|小時|天|日|周|週|个月|個月|年|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s*(?:前|ago|before)/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2].toLowerCase();
  const unitMs = /秒|second|sec/.test(unit) ? 1000
    : /分|min/.test(unit) ? MINUTE
    : /小时|小時|hour|hr/.test(unit) ? HOUR
    : /天|日|day/.test(unit) ? DAY
    : /周|週|week/.test(unit) ? WEEK
    : /个月|個月|month/.test(unit) ? MONTH
    : /年|year/.test(unit) ? YEAR
    : 0;
  if (!unitMs) return null;
  const minAgeMs = Math.round(n * unitMs);
  return { minAgeMs, maxAgeMs: Math.round((n + 1) * unitMs) };
}

/**
 * 相对发布时间文案 → 展示年龄（区间下界，毫秒）。
 * @returns {number|null}
 */
export function parseRelativeAgeMs(text) {
  const r = parseRelativeAgeRange(text);
  return r ? r.minAgeMs : null;
}

/**
 * 绝对时间字符串 → ISO 字符串（校验合法性）。
 * 支持 "2026-10-08"、"2026-10-08T07:20:11-07:00"、"2026-10-08 07:20:11 UTC" 等可被 Date 解析的形式。
 * @returns {string|null}
 */
export function parseAbsoluteTime(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // 合理区间保护：2005-01-01 ~ 未来 1 天
  const t = d.getTime();
  if (t < Date.UTC(2005, 0, 1) || t > Date.now() + DAY) return null;
  return d.toISOString();
}

/** 毫秒年龄 → 中文文案（“刚刚” / “3 分钟前” / “5 小时前” / “2 天前”） */
export function describeAgeMs(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs)) return '';
  if (ageMs < MINUTE) return '刚刚';
  if (ageMs < HOUR) return `${Math.round(ageMs / MINUTE)} 分钟前`;
  if (ageMs < DAY) return `${Math.round(ageMs / HOUR)} 小时前`;
  return `${Math.round(ageMs / DAY)} 天前`;
}

/** ISO / Date → 澳门时间（UTC+8，无夏令时）文案 “2026-10-08 07:20” */
export function formatMacau(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date(d.getTime() + 8 * HOUR);
  const p = n => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/**
 * 综合裁决一条搜索结果的时间是否落在 72 小时窗口内。
 * - 相对时间可解析：直接裁决（YouTube 的相对时间按“向上取整”展示，故 2 天前 ≤ 72 小时，3 天前视为超时）
 * - 不可解析：返回 unknown，由上层去 watch 页取绝对发布时间复核
 * @param {{published?:string, publishedAt?:string}} video
 * @param {number} now
 * @returns {{status:'fresh'|'stale'|'unknown', ok:boolean|null, ageMs:number|null, publishedAt:string|null, label:string, source:'relative'|'absolute'|'unknown', reason:string}}
 */
export function evaluateFreshness(video = {}, now = Date.now()) {
  const range = parseRelativeAgeRange(video.published);
  if (range) {
    // 严格判定：以区间上界（最坏情况）比较 72 小时 —— “3 天前”按 72–96 小时处理，必须隐藏
    const relMs = range.minAgeMs;
    const fresh = range.maxAgeMs <= FRESH_WINDOW_MS;
    const publishedAt = new Date(now - relMs).toISOString();
    return {
      status: fresh ? 'fresh' : 'stale',
      ok: fresh,
      ageMs: relMs,
      publishedAt,
      label: describeAgeMs(relMs),
      source: 'relative',
      reason: fresh ? '' : `发布时间为 ${describeAgeMs(relMs)}，超出 ${FRESH_WINDOW_LABEL}窗口`
    };
  }
  const absIso = parseAbsoluteTime(video.publishedAt);
  if (absIso) {
    const ageMs = Math.max(0, now - new Date(absIso).getTime());
    const fresh = ageMs <= FRESH_WINDOW_MS;
    return {
      status: fresh ? 'fresh' : 'stale',
      ok: fresh,
      ageMs,
      publishedAt: absIso,
      label: describeAgeMs(ageMs),
      source: 'absolute',
      reason: fresh ? '' : `发布于 ${formatMacau(absIso)}（澳门时间），超出 ${FRESH_WINDOW_LABEL}窗口`
    };
  }
  return {
    status: 'unknown',
    ok: null,
    ageMs: null,
    publishedAt: null,
    label: '',
    source: 'unknown',
    reason: '搜索结果未提供可解析的发布时间'
  };
}

/**
 * 对已经过服务端过滤的扫描条目做兜底判定（前端渲染 / 工作流发送前再次校验）。
 * 缺少 publishedAt 视为不可验证 → 判定为不通过（隐藏）。
 */
export function isFreshItem(item = {}, now = Date.now()) {
  if (!item || item.error) return true; // 异常条目单独走错误卡片，不参与时效裁剪
  const iso = parseAbsoluteTime(item.publishedAt);
  if (!iso) return false;
  const ageMs = now - new Date(iso).getTime();
  return ageMs >= -DAY && ageMs <= FRESH_WINDOW_MS;
}

/** 隐藏原因文案（用于前端 / 日志统计） */
export function staleReason(item = {}) {
  if (item.staleReason) return item.staleReason;
  return `超出 ${FRESH_WINDOW_LABEL}窗口`;
}
