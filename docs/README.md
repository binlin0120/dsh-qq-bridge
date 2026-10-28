# 文档索引（docs/README.md）

> 根目录只留 `README.md` / `README.en.md` / `RULES.md` 三个文档，其余全部在本目录下。
> 仓库目录结构与 `scripts/` 命名约定见 **[FOLDER_MAP.md](FOLDER_MAP.md)**。
>
> **状态标记**：✅ 仍然有效（按它做就对） · ⚠️ 部分过时（见备注）

---

## guides/ —— 面向使用者 / 运维

| 文档 | 一句话说明 | 状态 |
| --- | --- | --- |
| [guides/CONFIGURATION.md](guides/CONFIGURATION.md) | **配置全解**：`config.json` 所有已有功能怎么配，必填项 / 人设 / 模式 / 一代与二代仿真 / 黑话 / 画图 / 限额 / 搜索 / 花费 / 安全，默认值与改完要不要重启 | ✅ |
| [guides/DSH_SETUP.md](guides/DSH_SETUP.md) | DSH 端安装说明：`qq-chat` / `qq-chat-v2` preset 与三个 MCP server 怎么挂到目标设备的 DSH 上 | ✅ |
| [guides/TOKEN_USAGE_CONSOLE.md](guides/TOKEN_USAGE_CONSOLE.md) | 控制台「令牌与花费」看板：数据来源、计价口径（峰谷分时）、API、配置 | ✅ |
| [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) | 控制台离线预览（`npm run preview:console`）与离线浏览器回归（`npm run test:console-ui`）怎么用 | ✅ 2026 整理时自 `scripts/` 移入 |
| [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) | **安全基线与威胁模型**：威胁主体、已实现的边界（准入/工具面/出站/控制台/落盘/网络）、已知残余风险、发布前回归清单、改动检查单 | ✅ **改动安全相关代码前必读**（2026-09-20 新增） |
| [guides/DSH_020_ADAPTATION.md](guides/DSH_020_ADAPTATION.md) | **DSH 0.2.0 适配改动记录**（v0.1.7 → v0.2.0）：逐条列出为适配 0.2.0-rc.2 做的改动（现象/为什么必须改/证据/怎么验证），并单独列出「复核后判定兼容、因此没改」的部分与「同批但不属于适配」的改动 | ✅ **最新**；升级 DSH 前先读 §10 的操作清单 |

> 说明：原索引里 design / research / audits / legacy 下的其他文档不在公开仓库内（未随仓库发布），已从本索引中移除，不再列为可点开的文档；配置与架构以 [guides/CONFIGURATION.md](guides/CONFIGURATION.md) 与根目录 [README.md](../README.md) 为准。语音发送配置见 [guides/CONFIGURATION.md](guides/CONFIGURATION.md) 第 7 节，独立的语音工具在仓库上一级 `../voice-tool/`，不在本仓库内。

---

## 想找什么 → 去哪看

| 我想…… | 看这个 |
| --- | --- |
| 搞懂整体架构 / 全部配置项 | [guides/CONFIGURATION.md](guides/CONFIGURATION.md)、根目录 [README.md](../README.md) |
| 在新设备上把 qq-bridge 接进 DSH | [guides/DSH_SETUP.md](guides/DSH_SETUP.md) |
| 发语音 / 换 QQ 账号后语音工具 401 | [guides/CONFIGURATION.md](guides/CONFIGURATION.md) 第 7 节（语音配置）；独立工具在仓库上一级 `../voice-tool/`，不在本仓库内 |
| 看 AI 烧了多少钱 / 计价口径 | [guides/TOKEN_USAGE_CONSOLE.md](guides/TOKEN_USAGE_CONSOLE.md) |
| 改控制台界面并做离线回归 | [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) |
| 改代码前先知道有哪些坑 | [guides/DSH_020_ADAPTATION.md](guides/DSH_020_ADAPTATION.md)（最新，DSH 适配）、[guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) |
| 动安全相关代码 / 做发布前检查 | [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) |
| 知道某个目录/脚本是干什么的 | [FOLDER_MAP.md](FOLDER_MAP.md) |
| 权限边界与安全承诺 | [../RULES.md](../RULES.md) |
