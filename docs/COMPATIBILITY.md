# 运行与升级兼容性

- Node.js >=22.13，CI 在 Node 22/24、Windows/Linux 中从空目录执行 npm ci。
- 必须保留仓库 .npmrc（legacy-peer-deps=true）。锁文件和这一安装选项共同定义依赖树。
- 直接运行依赖采用确切版本；预发布 apiproxy 固定为 0.1.1-rc.2，不能用浮动范围更新。
- SnowLuma 1.14.20 发布包含缺失 ESM 扩展名的导入。postinstall 根据 snowluma-patches.json 的版本和逐文件 SHA-256 修复；重复执行幂等，未知版本或内容在写入前失败。
- npm run compat:verify 只核验，不修改。不要在正在运行的目录安装依赖；先在独立候选目录 npm ci、测试，再切换部署。
- DSH 采用 Cookie 鉴权、斜杠 RPC、args 包装、remote.mux/session-follow 协议。旧 apiproxy 仅作为传输基类，不能把其包版本当作服务协议版本。
- src/dsh-protocol.mjs 校验 RPC 关联号、结果信封、就绪探测；协议不匹配时拒绝就绪，不把 HTTP 200 当成调用成功。参数包装、inbox 投影和 mux 事件使用离线契约测试。服务升级前另外运行明确选择的 DSH 集成探测，不自动产生模型调用或 QQ 消息。

## 测试入口

`npm test` 只执行 registry 中 audit/features/release；外部集成探测列在 `npm run test:list`，明确标明前提，需人工选择脚本。新增或删除 test-*.mjs 未同步登记会直接失败。可选媒体工具不存在时测试输出 SKIP，不把跳过算作真实服务验收。
## 2026-10-29 安全锁文件更新

MCP SDK 固定 1.32.2，Zod 固定 4.6.7；锁文件同时更新 Hono、node-server、body-parser、fast-uri、ip-address、proxy-addr、qs，未使用 force 或改变 SnowLuma/DSH 版本。安装后执行 npm audit，当前结果为 0；这只是当前公告库检查，不代表未来没有漏洞。

上游公告：[MCP](https://github.com/advisories/GHSA-22jm-h49p-29qw)、[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)。
