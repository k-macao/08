# 章鱼 AI·全景分析 // OCTOPUS AI PANORAMA

按频道抓取 YouTube 最新公开视频，提取可用中文字幕，汇总为情报简报并推送到微信（PushPlus）。

## 本地运行

```bash
npm install
npm run check # 语法检查
npm test      # 运行测试/语法检查
npm start     # 启动服务
# 打开 http://localhost:3000
```

## 推送到微信

项目使用 [PushPlus（推送加）](https://www.pushplus.plus/) 把简报推送到微信公众号。

### 获取 Token

1. 访问 https://www.pushplus.plus/ ，用微信扫码登录
2. 在「一对一消息」页面复制你的 token
3. **重要**：根据 PushPlus 规定，2024 年 8 月 1 日起未实名用户无法调用发送接口，请先完成实名认证

### 在网页中推送

1. 启动服务后打开页面
2. 选择频道 → 点击「开始扫描」
3. 在「PushPlus 推送设置」中粘贴 token（仅本次使用，不写入服务器）
4. 点击「推送当前情报页」

### 在 GitHub Actions 中自动推送

1. 仓库 → Settings → Secrets and variables → Actions → New repository secret
   - Name: `PUSHPLUS_TOKEN`
   - Secret: 你的 PushPlus token
   - Name: `DEEPSEEK_API_KEY`（**可选**）
   - Secret: 你的 DeepSeek API key（[获取地址](https://platform.deepseek.com/api_keys)）
2. 进入 Actions →「AI 扫描」→ Run workflow
3. 可选项：
   - `channels`：要扫描的频道，用 `|` 分隔，留空或填 `ALL` 则默认扫描全部 56 个频道
   - `push_to_wechat`：勾选即扫描完成后自动推送
   - `pushplus_token`：也可在此临时填入（会优先于 Secret）
   - `enable_ai_summary`：默认 `true`，扫描完成后会用 AI 对所有视频字幕做主题聚类总结，拼到推送内容顶部

工作流会先跑构建与测试（Node 18 / 20），通过后执行扫描、生成 HTML 简报并调用 PushPlus 推送到微信。

## 注意事项

- 默认扫描全部 56 个频道，每个频道抓取最新 3 条视频
- 仅读取 YouTube 公开搜索结果与公开中文字幕，无字幕视频保留链接并标注
- 出现「台湾／台灣」时统一显示为「中国台湾」
- 推送内容仅作研究参考，不构成投资建议

## 关于 10 万字限制

PushPlus 单条消息内容上限约 10 万字。本项目在 `server.js` 和 CI 工作流中都做了自动切分：

- 单条简报超过 **90,000 字节**（留 10% 余量）时，按 `<section>` 边界自动拆成多条
- 每条标题带 `(1/N) (2/N) …` 编号，便于在微信中按顺序阅读
- 每条都包含简报头部和免责声明，可独立阅读
- 若单个视频字幕自身超过 90KB，会在 `</p>`、句号、换行等自然边界处再切，必要时做字节级硬切
- 多条之间间隔 0.8 秒发送，避免触发 PushPlus 频率限制
- 任意一条发送失败会立即停止后续发送，防止半截轰炸

## 关于 AI 总结（DeepSeek）

抓取到的所有视频字幕会交给 DeepSeek（`deepseek-chat` 模型）做**主题聚类**总结，作为「AI 总结」块插到推送内容的最顶部，结构为：

- **今日主线**（80–150 字一段话概括市场/舆论最核心的故事）
- **热点话题**（3–6 条）
- **风险点**（2–5 条）
- **机会点**（2–5 条）

### 行为说明

- **未配置 `DEEPSEEK_API_KEY` / 前端未启用**：跳过总结，按原样推送
- **AI 调用失败 / 超时 / 返回非 JSON**：自动降级，按原样推送（不会阻断）
- **每条字幕最多取 4000 字喂给 AI**，避免 token 爆炸（56 频道 × 3 视频 ≈ 168 条安全可控）
- **任何 OpenAI 兼容 API 都可替换**（DeepSeek / OpenAI / 智谱 / 通义 / 任何 base_url），在环境变量里改 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` / `OPENAI_API_KEY` 即可

### 本地启用

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
npm start
# 打开页面 → 扫描 → 推送
```

或写入 `.env`（项目目前没装 dotenv，部署到 server 上时手动 export 即可）。

### 本地单独测试 AI 总结

```bash
DEEPSEEK_API_KEY=sk-xxx node -e "
import('./ai.mjs').then(async ({summarize, renderSummaryHtml}) => {
  const items = [{channel:'信報',title:'测试',published:'1天前',status:'字幕已读取',transcript:'美联储加息预期升温，美元走强，新兴市场承压。'},{channel:'FT中文网',title:'测试2',published:'2小时前',status:'字幕已读取',transcript:'A股三大指数集体上涨，券商板块领涨。'}];
  const s = await summarize(items);
  console.log('summary =', JSON.stringify(s, null, 2));
  console.log('html =', renderSummaryHtml(s, {itemCount: items.length}));
});
"
```

---

## ci.yml.new 说明

GitHub 机器人没有 `workflows` 权限，无法直接修改 `.github/workflows/oai.yml`。
需要更新工作流时：打开 GitHub 网页编辑器，把 `ci.yml.new` 的内容整体复制到 `.github/workflows/oai.yml` 并提交即可。

