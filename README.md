# 章鱼 AI·全景分析 // OCTOPUS AI PANORAMA

按频道抓取 YouTube 最新公开视频，提取可用中文字幕，汇总为情报简报并推送到微信（PushPlus）。

## 本地运行

```bash
npm install
npm start
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
2. 进入 Actions → CI → Run workflow
3. 可选项：
   - `channels`：要扫描的频道，用 `|` 分隔，留空使用默认 4 个
   - `push_to_wechat`：勾选即扫描完成后自动推送
   - `pushplus_token`：也可在此临时填入（会优先于 Secret）

工作流会先跑 CI（Node 18 / 20），通过后执行扫描、生成 HTML 简报并调用 PushPlus 推送到微信。

## 注意事项

- 单次最多扫描 12 个频道，每个频道抓取最新 3 条视频
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

---

## 测试说明

本分支用于测试CI流程，包括：
- 语法检查
- 服务器启动验证
- GitHub Actions 工作流触发测试

## ci.yml.new 说明

GitHub 机器人没有 `workflows` 权限，无法直接修改 `.github/workflows/oai.yml`。
需要更新工作流时：打开 GitHub 网页编辑器，把 `ci.yml.new` 的内容整体复制到 `.github/workflows/oai.yml` 并提交即可。

