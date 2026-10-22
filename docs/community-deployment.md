# 免登录排行榜上线 · 2026-10-22

正式 API：`https://norsk-community.beima.chatgpt.site/api/community`。

七牛主站 `https://norsk.ballplus.asia/` 与 GitHub Pages 备用站 `https://gasen1216.github.io/norsk-study-pages/` 通过 `community-config.js` 连接同一个 Sites Worker/D1 数据库。公开访问无需登录；用户在练习的排行榜中修改昵称。

设备身份为当前网站在浏览器中生成的随机 ID 和随机密钥，不读取硬件指纹。密钥保存在浏览器本地，服务端仅保存其哈希；榜单返回独立的公开 ID、昵称、积分和练词数。不同浏览器、不同网站入口以及清除本站数据后会形成不同身份。修改昵称不改变成绩。

云端源码保存在同级 `norsk-community-service` 项目。Sites 项目 ID 为 `appgprj_6ad9bcdf343c81919a5b9f87dc8b27d9`；发布版本 1，源码提交 `30da15cedd1ee476cfffc5bf8f4d8e786e7e244b`。`.openai/hosting.json` 声明 D1 绑定 `DB`，数据库迁移随发布应用，后续迁移只能新增。不要通过创建另一个 Site 来更新当前服务，否则会得到独立数据库。

计分与原 Python API 合同一致：每词 2 XP，首答正确再加 8 XP，每设备每天最多 5,000 XP；北京时间周一开始新周。结果按设备和练习 ID 去重，每日限额在同一条写入语句中计算；并发请求不会重复计分。前端仅上传新增客观练习的汇总结果，断网后保留待提交项，不上传历史答案明细。

API 仅允许主站、备用站及服务自身来源的浏览器请求。健康检查为 `GET /health`。本地 `localhost` 页面继续连接 Python/SQLite 预览服务，不写入正式排行榜。

云端验证覆盖 114 项 HTTP 断言与 D1 校验，包括设备鉴权、并发创建、昵称、请求体上限、跨域、并发每日上限、重复提交、前 100 名与本人名次、北京时间周界及重启后的数据保留。正式端点已验证两种独立匿名身份的注册、改名、重新读取，以及两个网站来源的 GET 与 PATCH 预检；正式榜单未加入测试积分。

网页发布只同步 `app.js`、`index.html`、`practice.js`、`practice.css`、`community.js`、`community.css`、`community-config.js`，保留已上线教材录音。七牛上传时覆盖这七个文件并刷新首页、`index.html` 及更新资源的 CDN 缓存；GitHub Pages 从当前远端 main 增量发布。

更新云端时，在原 Sites 项目上完成测试和构建，使用新的发布版本；不得修改已应用的 SQL 迁移。公开端点不提供成绩清空或设备删除接口。
