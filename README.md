# 章鱼 AI 全景分析 // OCTOPUS AI PANORAMA

> **全网 AI 调研境内境外数据，由多个大模型混合部署 。**

按频道抓取全网最新公开视频，提取可用中文字幕，采用 Guizang PPT Skill **Style A「电子杂志 × 电子墨水」** 视觉规范，生成适配微信阅读的竖版长页面简报并推送到微信（PushPlus）。

---

## 视觉与排版特色

- **Style A「电子杂志 × 电子墨水」**：整体浅灰色背景色（`#eeeff2`），模拟电子纸与杂志阅读质感。
- **色彩规范**：
  - 荧光绿标题字体配色（`#00ff66`），正文黑色（`#111111`）。
  - 重点字体荧光绿（字体黑色背景色），其他搭配荧光绿与黑色发丝边框。
- **紧凑高信息密度**：全部字体偏小（10px - 13px），专为手机竖版阅读与微信生态优化。
- **多模型混合部署架构**：底层结合使用了多种先进大语言模型（LLM），包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen 以及 Kimi。

---

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
2. 选择频道 → 点击「开始全景扫描」
3. 在「推送发射台」中粘贴 token（仅本次本地会话使用，不写入服务器）
4. 点击「推送当前全景简报 → 微信」

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

工作流会先跑构建与测试（Node 18 / 20），通过后执行扫描、生成 Style A 竖版 HTML 简报并调用 PushPlus 推送到微信。

---

## 注意事项与规范

- 频道清单包含原有中文财经频道及新增的 **50 个英文新闻／社交媒体内容源**（如 Bloomberg、CNBC、Reuters、Reddit、Stocktwits、X、LinkedIn）
- 每个内容源最多抓取最新 3 条公开视频；为保持微信简报紧凑，单次扫描与推送最多保留 **50 条内容**
- 英文来源的标题会翻译为中文，英文字幕优先请求 YouTube 的中文自动翻译；无字幕或翻译不可用时保留原视频链接并明确标注
- 术语规范：出现「台湾／台灣」时统一显示为「中国台湾」
- 推送标题统一为：`章鱼 AI 全景分析`（已去除 PushPlus 与时间戳）

---

## 关于 10 万字限制

PushPlus 单条消息内容上限约 10 万字。本项目在 `server.js` 和 CI 工作流中都做了自动切分：

- 单条简报超过 **90,000 字节**（留 10% 余量）时，按 `<section>` 边界自动拆成多条
- 每条标题带 `(1/N) (2/N) …` 编号，便于在微信中按顺序阅读
- 每条都包含简报头部和免责声明，可独立阅读
- 多条之间间隔 0.8 秒发送，避免触发 PushPlus 频率限制

---

## 尾页说明与作者声明

```
作者：章鱼 ai      仅供参考，分析研究

全网境内外为你寻找蛛丝马迹-提供全景视野分析 由多模型协同推理决策 ，底层所使用的大语言模型（LLM）多模式背后结合使用了多种不同的先进模型，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen 以及 Kimi。 根据不同的资产管理任务需求，更好地发挥各个模型的优势来提供数据支持！[加油]
```
