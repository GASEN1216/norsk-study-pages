# 免登录排行榜 · 现有服务器

正式 API：`https://event.ballplus.asia/api/community`。

七牛主站 `https://norsk.ballplus.asia/` 与 GitHub Pages 备用站 `https://gasen1216.github.io/norsk-study-pages/` 通过 `community-config.js` 连接同一服务。用户无需登录，在练习的排行榜中修改昵称。

设备身份为当前网站在浏览器中生成的随机 ID 和随机密钥，不读取硬件指纹。密钥保存在浏览器本地，服务端仅保存其哈希；榜单返回独立的公开 ID、昵称、积分和练词数。不同浏览器、不同网站入口以及清除本站数据后会形成不同身份。修改昵称不改变成绩。

复用 `D:/code/activity-planning-execution-platform` 对应的现有服务器及 HTTPS 域名。独立 Python 服务只监听 `127.0.0.1:4180`，Caddy 将 `/api/community/*` 转发到该端口。代码保存在 `/srv/norsk-community`，SQLite 数据保存在 `/var/lib/norsk-community/community.sqlite3`，与活动平台的数据库分离。

部署、自动备份与回滚说明见活动平台仓库 `infra/norsk-community/README.md`。更新服务时同步本项目 `scripts/community_api.py` 到该目录的 `community_api.py`，运行接口检查，再使用独立安装流程。活动平台的 Caddy 模板也保留此路由，以免其后续发布移除排行榜入口。

计分为每词 2 XP，首答正确再加 8 XP，每设备每天最多 5,000 XP；北京时间周一开始新周。结果按设备和练习 ID 去重，每日额度在数据库事务中计算，并发请求不会重复计分。前端仅上传新增客观练习的汇总结果，断网后保留待提交项，不上传历史答案明细。

API 仅允许主站、备用站及服务自身来源的浏览器请求。健康检查为 `GET /health`。本地 `localhost` 页面继续连接独立的 Python/SQLite 预览服务。Caddy 覆写 `X-Real-IP`，服务仅在显式启用回环代理信任时采用该地址，避免不同设备共用代理 IP 的限流额度。

2026-10-22 按用户要求停用新增 Sites 服务，已关闭它的公开访问；永久删除由用户自行处理。迁移前旧数据库无练习成绩，已有设备资料保留相同公开 ID、认证哈希和昵称。浏览器内尚未提交的成绩会继续幂等补交。

前端版本为 `20261022-community-server1`。本次仅需更新 `app.js`、`index.html`、`community-config.js`，并刷新这三个文件和首页的 CDN 缓存。教材、音频和既有练习界面无需重新发布。

接口检查覆盖注册鉴权、改名、跨设备计分、周榜与总榜、重复提交、每日额度、并发、持久化、CORS 与代理 IP 限流。部署后通过真实 HTTPS 接口验证两个独立设备，测试记录按其随机身份精确清理，不保留示例名次。公开接口不提供成绩清空或设备删除功能。

## 在线经验与等级 · 2026-10-22 晚

前端版本 `20261022-levels3`。网站任一页面在前台时，浏览器每分钟向 `POST /api/community/presence` 发送一次心跳，后台标签页和离线时不发送。服务端只在与上次心跳相隔 45–150 秒时记 1 分钟、+2 XP；更近的心跳（如同一浏览器的第二个标签页）既不加分也不移动计时，间隔过长则重新开始计时，不补发。在线经验按北京时间每天最多 240 XP，记在独立的 `online` 表，最后一次心跳记在 `presence` 表。

五种练习都计分：`cards`、`listen` 与原有的 `learn`、`quiz`、`match`。每词 2 XP，客观题首答答对再加 8 XP；`cards` 为自评，只计每词 2 XP。练习每天最多 5,000 XP，与在线经验分开计算。

等级 Lv.L 起点为 100×((L+1)²−4) XP，即 Lv.2 500、Lv.3 1,200、Lv.4 2,100、Lv.5 3,200、Lv.16 28,500、Lv.64 422,100。图标为 4 颗星 = 1 个月亮、4 个月亮 = 1 个太阳、4 个太阳 = 1 顶皇冠。`GET /profile`、`POST /results` 和 `POST /presence` 返回 `stats`（累计、本周、今日、今日在线 XP 与等级）；排行榜条目新增按累计 XP 计算的 `level`，本周榜和总榜的 XP 都包含在线经验。

旧数据库在服务启动时自动迁移：`results` 表按 SQLite 推荐方式重建，以放宽活动类型约束，原有成绩、索引和设备资料保持不变；新表按需创建。新增接口和字段向后兼容，旧前端仍可提交成绩。
