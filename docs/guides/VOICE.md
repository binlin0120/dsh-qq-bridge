# 语音配置

AI 发语音默认是关的：`socialV2.tools.sendVoice=false` 和 `socialV2.voice.enabled=false`。启用前配置本地语音库目录，并确认 OneBot 网关支持语音消息。

本仓库提供 `node scripts/send-voice.mjs`，使用 `--help` 查看参数。语音处理需要 FFmpeg；测试中的时长探测额外使用可选 FFprobe（`FFPROBE_PATH`）。

独立图形界面属于可选的同级 `voice-tool/` 项目，入口为 `voice-gui.mjs`、`voice-cli.mjs` 和 `发语音-图形界面.cmd`，没有随本仓库分发。可用 `QQ_BRIDGE_VOICE_TOOL_DIR` 指向自行安装的工具目录；缺少时相关检查明确跳过。

请将个人音频放在被 Git 忽略的 `audio/` 中，通过配置指定；公开仓库不包含私人音频、账号或运行配置。

本仓库不提供 `npm run voice-gui` 或 `npm run voice-cli`；独立工具需另外安装并从其目录启动。桥接内置语音发送仍使用 `npm run send-voice`。
