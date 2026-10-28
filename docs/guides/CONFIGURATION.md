# 配置说明：所有已有功能怎么配

本文档对应 `config.example.json` 和 `README.md`，目标是：第一次部署只改必填项就能跑，想调某个功能时能在这一篇里找到它、知道默认值、改哪里、改完要不要重启。

> 约定：下面写出的默认值以 `config.example.json` 为准（复制成 `config.json` 后就是你的初始值）。如果把某项删掉，桥接会用内置默认值，多数情况下和示例值接近，不会因为缺一项就起不来。
>
> 改法分两种，改前先看清：
>
> - **改 `config.json` 后重启桥接生效**：`config.json`、`roles/`、`state/current-role.json`。
> - **改 `dsh/agent-presets/` 后要先跑 `node scripts/build-agent-preset-patches.mjs` 重新生成 bundle patch，再重启 DSH**（不是重启桥接）。
> - **控制台里能改的项**：黑话、社交（一代 / 二代）、安全拦截通知等，在控制台保存后即时生效或下一条消息生效，具体以控制台页面的提示为准；控制台保存的值会覆盖文件里的对应项。

## 0. 最短路径：必填项

只改这几项就能跑起来，其他全部先留默认：

| 项 | 填什么 |
| --- | --- |
| `snowluma.wsUrl` | SnowLuma 的 OneBot WebSocket 地址，默认 `ws://127.0.0.1:3001` |
| `snowluma.httpUrl` | SnowLuma 的 HTTP 地址，默认 `http://127.0.0.1:3000` |
| `snowluma.accessToken` | SnowLuma 的接入令牌，留空就连不上 |
| `ownerQQ` | 机主自己的 QQ 号（数字，不是昵称） |
| `allow.private` | 允许私聊的 QQ 号列表，例如 `[123456789]` |
| `allow.groups` | 允许的群号列表，例如 `[987654321]` |

> **安全红线：`allowAllWhenEmpty` 必须保持 `false`。** 改成 `true` 时，白名单为空会放行所有私聊和群聊，等于把 agent 的操作权敞口给所有人，启动时也会打警告。不要开。

## 1. 接入层：DSH 与 SnowLuma

### `dsh`：DSH 怎么连

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `dsh.baseUrl` | `http://127.0.0.1:3080` | 本机 DSH Web 的地址，DSH 不在本机时改成实际地址 |
| `dsh.provider` | `deepseek-official` | DSH 的 provider 名称，一般不用改 |
| `dsh.model` | `deepseek-flash` | 每个 QQ 会话默认用的模型，控制台里也可以按会话改 |
| `dsh.reasoningEffort` | `max` | 思考强度档位，按 DSH 实际公布的能力选 `max` / `high` / `low` |
| `dsh.authToken` | 空 | DSH 升级后要求非浏览器客户端带 token 时才填；默认走浏览器会话签名密钥离线铸造 Cookie，不用填 |
| `dsh.authHeader` / `dsh.authPrefix` | `authorization` / `Bearer` | 填了 `authToken` 时的请求头名和前缀，一般不用改 |
| `dsh.allowRemote` | `false` | 是否允许把 DSH 的进程启动凭据发往非回环地址，默认 `false`，不要轻易开 |

DSH 本身的安装、启动、扫码、preset 与 MCP 配置见 [DSH_SETUP.md](DSH_SETUP.md)，本项目只连接 DSH，不部署 DSH。

### `snowluma`：QQ 怎么连

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `snowluma.wsUrl` / `snowluma.httpUrl` | 见上表 | SnowLuma 的 WebSocket / HTTP 地址 |
| `snowluma.accessToken` | 空 | 必填，SnowLuma 的接入令牌 |
| `snowluma.followDiscoveredEndpoint` | `true` | 跟随 SnowLuma 发现的实际端点，一般保持 `true` |
| `snowluma.silenceWarnMs` | `600000`（10 分钟） | 静默警告的间隔，调大可以少打扰，调小可以早发现断线 |
| `snowluma.launcherPath` / `snowluma.homeDir` | 空 | SnowLuma 启动器路径 / 家目录，留空即按默认探测；SnowLuma 的安装、启动与扫码始终由你自己完成，本项目只探测、不部署它 |

SnowLuma 是专有组件，其许可不允许被打包分发，本项目只连接、不部署它。

## 2. 会话与权限：谁能进来

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `ownerQQ` | `null` | 机主 QQ 号。`closed-agent` 模式只认机主私聊，其他人进不来；没填时机主功能不可用 |
| `sessionCwd` | 空 | 会话默认工作目录，留空用 DSH 的默认工作区 |
| `agentPreset` | `qq-chat` | 普通会话（chat / reserved / reserved2 以外）默认用的 DSH agent preset |
| `workspaceTitle` | `QQ 聊天` | QQ 会话在 DSH 里归组的工作区标题 |
| `allow.private` / `allow.groups` | 空列表 | 白名单：允许的私聊 QQ 号 / 群号。deny 优先于 allow |
| `deny.private` / `deny.groups` | 空列表 | 黑名单：明确拒绝的私聊 QQ 号 / 群号，先于白名单判断 |
| `allowAllWhenEmpty` | `false` | 见第 0 节红线，保持 `false` |
| `ackMessage` | `🤔 收到，正在思考…` | 收到消息后先回的一句确认，留空则不发或用默认 |
| `sendDelayMs` | `300` | 发消息前的延迟（毫秒），防刷屏、让分段更像真人 |
| `questionTimeoutMs` | `300000`（5 分钟） | agent 向 QQ 提问、等审批确认的超时时间，超时按拒绝或继续处理 |

### 运行模式：控制台里切

模式在控制台里切换，不在 `config.json` 里写死（启动模式由 DSH 设置 / `state/mode.json` 驱动）：

- `chat`：白名单群 + 白名单私聊，走 `qq-chat` 安全聊天。
- `closed-agent`：仅机主私聊，完整工具，可以在 QQ 上直接给 DSH 派活；机主以外的会话在该模式下只走只聊天 preset 与限流。派活、审批、急停（说“别发了 / 停下 / 全部停”这类口语）都在这个模式下用。
- `reserved`（一代仿真）：仿真群友，观望 / 活跃 / 试探 / 退场状态机，选择性参与。
- `reserved2`（二代仿真）：AI 通过 `qq_get_unread_messages` / `qq_send_message` 等工具自主看消息、发言、等待、设置唤醒 / 潜水；DSH 端用 `qq-chat-v2` preset。

## 3. 人设与角色扮演：人设在哪设置

人设分两层，不要混在一起写：

| 层 | 在哪 | 管什么 | 改完生效 |
| --- | --- | --- | --- |
| 人格提示词（人设） | `roles/<角色名>.md`，文件名就是角色名 | 你是谁：身份、性格、说话风格、梗、雷点、和其他人的关系 | 控制台保存后下一条消息即生效；直接改文件后重启桥接生效 |
| 仿真提示词（怎么干活） | `dsh/agent-presets/qq-chat{,-v2}/agent.cordis.yml` 的 `persona.prefix` | 工具怎么调、怎么分条、怎么潜水 / 唤醒、怎么用表情包与记忆 | 改完跑 `node scripts/build-agent-preset-patches.mjs` 再重启 DSH |

设置方式有三种，任选其一：

1. **直接改文件**：新建或编辑 `roles/xxx.md`，一个角色一个文件。仓库自带 `roles/小鲸鱼.md` 是示例人设，部署时请把里面的名字、称呼换成自己的，不要直接用示例里的名字。
2. **控制台**：打开 `http://127.0.0.1:3100`（令牌访问）→「人格与角色」页，列表点选即可载入查看 / 编辑，支持新建、保存修改、改名（自动重命名文件）、另存为副本、删除；超过注入上限或含一代专用指令会实时提示。
3. **QQ 里切**：在群里对 QQ agent 说 `进入角色扮演：<角色名>`，说 `退出角色扮演` 恢复正常；也可以在控制台点「清除」临时关闭人格扮演，此时 AI 只按仿真提示词行动。

详细写法见 [roles/README.md](../roles/README.md)：人格卡只写人设、不写工具用法；需要区分一代 / 二代时在标题里加 `〔一代〕` / `〔二代〕`（或 `[v1]` / `[v2]`）标记，桥接会只注入当前模式适用的小节，注入前标记会被去掉。

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `role.maxInjectChars` | `6000` | 每条消息最多注入的人格字符数（可设 1000~20000，约合 4~6k token）；建议把人格卡控制在 3000~5000 字符 |
| `state/current-role.json` | 由控制台 / 管理端写入 | 当前启用的人格，由控制台或管理端设置，群友无法更改；直接改这个文件后重启桥接生效 |

## 4. 本地控制台

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `consolePort` | `3100` | 本机控制台端口，访问 `http://127.0.0.1:3100` |
| `consoleToken` | 空 | 留空时启动会自动生成并打印在启动日志里，落盘在本地 `state/console-token`（靠文件权限保护）；填了就用你填的；控制台内也可以手动修改或重新生成 |

控制台左侧按操作任务分为「运行总览 / 会话与审批 / 人格与角色 / 二代仿真 / 一代仿真 / 黑话词库 / 令牌与花费 / 访问与安全 / 调试与运维 / 工具参考」十个页面：切模式、设角色、静默开关、看活动日志、改管理员 / 控制台令牌、改白名单与安全设置，全部即时生效；支持浅色 / 深色双主题。令牌与花费看板详见 [TOKEN_USAGE_CONSOLE.md](TOKEN_USAGE_CONSOLE.md)。

## 5. 画图与照片：怎么配

画图不是 `config.json` 里一个开关就能讲完的，它由三部分组成：

- **提交地址与模型**：`draw.baseUrl`（默认 `https://laneai.dev/v1`，不在 `config.example.json` 里，留空就用这个默认）、`draw.model`（默认 `gpt-image-2`）。部署时如果用自己的画图服务，把 `draw.baseUrl` 改成你自己的地址；模型名按服务方给的填。
- **尺寸与限额**：`draw.imageSize`（默认 `1K`）、`draw.dailyLimit`（默认 `20`）。限额只有在 `usageLimits` 开启时才生效（见第 9 节），没开时不设每日次数。
- **选路与投递**：提交前会先用探针测上传速度、按速度排线并缓存 10 分钟，线路全失败时不发付费请求；提交结果不明时不换 IP 重发，避免重复扣费；下载走分段续传、按速度测 IP，下载链接 404 / 410 时直接判为链接失效，不再反复续传。选路状态落在本地 `state/image-upload-routes.json` 和 `state/image-download-routes.json`，不用手动改。
- **照片状态查询**：QQ 里问“那张照片怎么还没发 / 发了没”这类话时，桥接会按任务实际状态回话（已发 / 还没拿到 / 还没完整传过来 / 发顺失败等），不用另外配。

## 6. 一代仿真 `social`：群聊怎么参与

一代仿真（`reserved`）由状态机驱动：观望 → 活跃 → 试探 → 退场。默认开启，关掉就把 `social.enabled` 设为 `false`。

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `social.enabled` | `true` | 一代仿真总开关 |
| `social.maxReplyChars` | `500` | 单条回复的最大字符数，超了会截断或分条 |
| `social.mustReplyKeywords` | 6 个关键词（见示例文件） | 出现这些词时必须回复，不受触发概率影响 |
| `social.contextWindow` | `20` | 触发 / 活跃回复时附带的上下文条数 |
| `social.triggerProbability` | `0.1` | 普通消息触发进入活跃的概率，调高会更爱接话、也更容易被当成刷屏 |
| `social.activeCheckMinMs` / `social.activeCheckMaxMs` | `8000` / `30000` | 活跃期检测间隔范围（毫秒） |
| `social.activeReplyDelayMinMs` / `social.activeReplyDelayMaxMs` | `1000` / `5000` | 活跃期回复延迟范围，模拟真人打字停顿 |
| `social.idleWindowMs` | `360000`（6 分钟） | 空闲窗口：超过这个时间没人说话就可能退场 |
| `social.idleRetryProbability` | `0.4` | 空闲时重试参与的概率 |
| `social.idleRetryWaitMs` | `120000`（2 分钟） | 空闲重试前的等待时间 |
| `social.proactiveEnabled` | `true` | 是否允许主动分享 / 主动开口 |
| `social.proactiveIdleThresholdMs` | `1800000`（30 分钟） | 群里安静超过这个时间才考虑主动开口 |
| `social.proactiveCheckMinMs` / `social.proactiveCheckMaxMs` | `2700000` / `5400000` | 主动检查的时间间隔范围 |
| `social.proactiveProbability` | `0.2` | 主动开口的概率 |
| `social.activeDurationEnabled` | `true` | 活跃时长是否受限 |
| `social.activeDurationMinMs` / `social.activeDurationMaxMs` | `1200000` / `3000000` | 单次活跃的最短 / 最长持续时间 |
| `social.skipProbability` | `0.05` | 跳过某条消息的概率（模拟真人漏看） |
| `social.surrenderProbability` | `0` | 退场概率，默认不主动退场 |
| `social.burstEnabled` | `true` | 是否允许连续分条发送 |
| `social.burstIntervalMinMs` / `social.burstIntervalMaxMs` | `1000` / `3000` | 分条之间的间隔范围 |
| `social.longGapProbability` / `social.longGapMinMs` / `social.longGapMaxMs` | `0.2` / `5000` / `10000` | 长间隔的概率与范围，讲故事 / 回忆时用较长间隔 |

调这些时注意 QQ 风控：概率、频率、单条字数调得越激进，越容易被平台限流，默认是偏保守的。

## 7. 二代仿真 `socialV2`：AI 自己看消息、自己发言

二代仿真（`reserved2`）默认开启，AI 通过 MCP 工具自主决定看不看、回不回、什么时候回、什么时候潜水。

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `socialV2.enabled` | `true` | 二代仿真总开关，关掉后二代工具调用一律拒绝 |
| `socialV2.autoReplyCheckMs` | `30000` | 自动回复检查间隔（毫秒） |
| `socialV2.agentPreset` | `qq-chat-v2` | 二代用的 DSH agent preset |
| `socialV2.provideRecommendations` | `true` | 是否给 AI 推荐的唤醒 / 发送 / 等待 / 主动策略提示 |
| `socialV2.initialPromptMaxChars` | `2000` | 会话初始提示词（控制台「二代仿真 → 初始提示词」里给某个群 / 私聊预写的环境说明）的字数上限；只在该会话第一次唤醒时注入一次，重置会话后下次首次唤醒会重新带上 |

### `socialV2.tools`：AI 能用哪些 QQ 工具

每个键 `true` = 允许 AI 用，`false` = 不给。默认全部 `true`，除了下面两个：

- `sendVoice` 默认 `false`：AI 不能发语音，想开语音时把这项改 `true`，并同时配好 `socialV2.voice`。
- `setStickerRemark` 默认 `false`：AI 不能给表情写备注。

其他默认 `true` 的工具：`getPrompt`（取提示词）、`getUnread`（取未读）、`getRecent`（取最近消息）、`socialState`（取仿真状态）、`sendGroup` / `sendPrivate`（发群 / 私聊）、`reply`（引用回复）、`sendBurst`（分条发送）、`sendMessage`（通用发送）、`waitMessages`（等消息）、`feedback`（反馈）、`getMyRecent`（取自己的最近消息）、`getMessageDetail`（取消息详情）、`getActiveMembers`（取活跃成员）、`setWakeConfig`（设唤醒配置）、`markRead`（标已读）、`memory`（记忆）、`slangQuery` / `slangSubmit`（查 / 交黑话）、`getImages`（取图片）、`getForwardMsg`（取合并转发）、`sendPoke`（戳一戳）、`listStickers` / `getStickerImage` / `sendSticker`（表情列表 / 取图 / 发送）、`stickerNote`（表情备注读取）、`collectSticker`（收藏表情）、`getSelfImage`（取自己的形象图）。

### `socialV2.wake`：什么时候醒、什么时候潜水

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `socialV2.wake.defaultMode` | `diving` | 默认唤醒模式：`diving`（潜水，默认不主动参与） |
| `socialV2.wake.preSleepWaitEnabled` / `socialV2.wake.preSleepWaitMs` | `true` / `300000`（5 分钟） | 沉睡前是否先观察一段时间，默认先观察 5 分钟没人说话再睡 |
| `socialV2.wake.recommendedDefaultInfinite` | `true` | 推荐的默认潜水是否不限时长 |
| `socialV2.wake.sleepMinMs` / `socialV2.wake.sleepMaxMs` | `60000` / `0`（0 = 不限） | 潜水时长的下限 / 上限 |
| `socialV2.wake.recommendedSleepMinMs` / `socialV2.wake.recommendedSleepMaxMs` | `300000` / `7200000` | 推荐的潜水时长范围（5~120 分钟） |
| `socialV2.wake.recommendedProbability` | `0.05` | 普通消息唤醒的推荐概率 |
| `socialV2.wake.recommendedKeywords` | 16 个关键词（见示例文件） | 出现这些词时建议唤醒 |
| `socialV2.wake.recommendedAtMention` / `recommendedNameMention` / `recommendedQuestion` / `recommendedPoke` | 均为 `true` | @ / 叫名字 / 提问 / 戳一戳时建议唤醒 |
| `socialV2.wake.batchWindowMs` | `8000` | 批量处理消息的时间窗口 |
| `socialV2.wake.maxWakePerMinute` / `maxWakePerHour` | `1` / `12` | 每分钟 / 每小时最多唤醒次数，防刷屏 |
| `socialV2.wake.noActionLimit` | `3` | 连续无行动的上限，超了会提醒 AI 设唤醒配置 |
| `socialV2.wake.maxWakeConfigReminders` | `2` | 唤醒配置提醒的最大次数 |

`socialV2.wake.recommendedHint` 是给 AI 的提示文本，一般不用改，改了会影响 AI 对潜水规则的理解。

### `socialV2.send` / `wait` / `proactive` / `feedback` / `context` / `media`

- **发送**：`send.burstEnabled`（默认 `true`，允许分条）、`send.burstMaxMessages`（默认 `8`，一次最多分几条）、`send.burstIntervalMinMs` / `send.burstIntervalMaxMs`（默认 `1000` / `3000`，分条间隔）、`send.longGapProbability` / `send.longGapMinMs` / `send.longGapMaxMs`（默认 `0.2` / `5000` / `10000`，长间隔概率与范围）、`send.maxSendPerMinute` / `send.maxSendPerHour`（默认 `8` / `60`，限流）、`send.maxMessageChars`（默认 `500`，单条上限）、`send.maxGapMs`（默认 `10000`，最大间隔）、`send.gapBaseMs` / `send.gapPerCharMs`（默认 `800` / `20`，按字数算间隔的基数与每字增量）。`send.recommendedHint` 是给 AI 的分条提示，一般不用改。
- **等待**：`wait.defaultMs`（默认 `30000`）、`wait.minMs`（默认 `5000`）、`wait.maxMs`（默认 `600000`）、`wait.defaultQuietMs`（默认 `8000`，安静多久算没人说话）、`wait.minQuietAfterNewMs`（默认 `10000`，新消息后最少再安静多久）。
- **主动**：`proactive.enabled`（默认 `true`）、`proactive.checkIntervalMinMs` / `proactive.checkIntervalMaxMs`（默认 `1800000` / `5400000`，主动检查间隔）、`proactive.idleThresholdMs`（默认 `900000`，15 分钟没人说话才考虑主动）、`proactive.probability`（默认 `0.3`）。
- **反馈**：`feedback.maxLength`（默认 `500`，反馈文本上限）、`feedback.notifyOwnerOnError`（默认 `false`，出错时是否通知机主）。
- **上下文**：`context.recentLimit`（默认 `100`，最近消息条数）、`context.unreadLimit`（默认 `30`，未读条数）、`context.contextWindow`（默认 `20`，上下文窗口）、`context.inlineWakeMessages`（默认 `true`，唤醒消息是否内联进上下文）、`context.wakeMessageLimit`（默认 `12`）、`context.wakeRecentLimit`（默认 `4`）、`context.wakeMaxChars`（默认 `6000`，唤醒上下文字符上限）。
- **图片**：`media.maxBytes`（默认 `8388608`，8 MB）、`media.maxPixels`（默认 `64000000`）、`media.maxCount`（默认 `5`，一次最多几张）。

### 表情 `socialV2.sticker` 与语音 `socialV2.voice`

- **表情**：`sticker.enabled`（默认 `true`）、`sticker.syncTtlMs`（默认 `60000`，同步缓存有效期）、`sticker.maxListCount`（默认 `100`，列表上限）、`sticker.includeInPrompt`（默认 `true`，是否把表情写进提示词）、`sticker.promptMaxStickers`（默认 `8`，提示词里最多带几个表情）、`sticker.collect.enabled`（默认 `true`，是否允许收藏表情）、`sticker.collect.maxPerMinute` / `maxPerHour`（默认 `2` / `10`，收藏限流）、`sticker.collect.maxRemarkChars`（默认 `20`，备注字数上限）。
- **语音**：`voice.enabled`（默认 `false`，想用语音时先改 `true`，并把 `socialV2.tools.sendVoice` 也改 `true`）、`voice.dir`（默认 `audio`，语音文件目录）、`voice.maxSeconds`（默认 `300`，单条最长秒数）、`voice.maxBytes`（默认 `20971520`，20 MB）、`voice.maxPerMinute` / `voice.maxPerHour`（默认 `2` / `10`，发送限流）、`voice.allowAbsolutePath`（默认 `false`，不允许绝对路径，安全起见不要开）、`voice.defaultVolume`（默认 `1`）、`voice.loudness`（默认 `normal`）、`voice.ffmpegPath`（默认空，ffmpeg 不在 PATH 时填实际路径）、`voice.autoReadback`（默认 `true`，自动回读）。

## 8. 黑话学习 `slang`

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `slang.enabled` | `true` | 黑话学习总开关，关掉后控制台黑话页也会报错 |
| `slang.extractMinMessages` | `10`（示例值；内置默认 `30`） | 提取黑话前最少需要多少条消息 |
| `slang.extractCooldownMs` | `300000`（5 分钟；内置默认 30 分钟） | 两次提取之间的冷却时间 |
| `slang.inferenceThresholds` | `[2, 4, 8]` | 推断阈值：出现几次才算一个词条 |
| `slang.injectMax` | `8` | 每次注入提示词的黑话条数上限 |
| `slang.learnerPreset` | `qq-chat` | 黑话学习用的 DSH preset |
| `slang.workspaceTitle` | `QQ 黑话学习` | 黑话学习在 DSH 里的工作区标题 |
| `slang.autoResearch` | `true` | 是否自动联网考证新词条；不需要就关掉，或把 `webSearch.provider` 改成 `bing`（默认复用 DSH 的联网搜索，不默认把群聊关键词发给 Bing） |

黑话词库在控制台「黑话词库」页可查看 / 编辑，数据出机清单见 [LICENSE](../LICENSE) 的「数据出机清单」。

## 9. 限额与分享：`usageLimits`、`draw`、`qzone`、`status`、`guestPhotos`、`quietHours`、`work`

这组键不在 `config.example.json` 里，写在 `config.json` 里同样生效，默认都是“不限”或下面这个默认值：

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `usageLimits` | `false` | 总开关：没开时不设每日次数、费用、token 额度；开了之后下面各项限额才生效 |
| `draw.dailyLimit` | `20` | 开启限额后，每天最多画几张图；访客照片会再受 `guestPhotos.ownerReserve` 影响（机主预留额度） |
| `guestPhotos.enabled` / `guestPhotos.perDay` / `guestPhotos.ownerReserve` | `true` / `3` / `5` | 访客每天最多拍几张、机主预留几张；访客额度用完会回“今天先不拍了” |
| `qzone.dailyLimit` / `qzone.rollingHours` / `qzone.rollingMax` / `qzone.minIntervalHours` | `2` / `72` / `4` / `12` | 说说：每天最多 2 次，滚动 72 小时最多 4 次、最少间隔 12 小时；这条独立于通用 `usageLimits`，不另设轮询或模型任务 |
| `status.dailyLimit` | `3` | 签名状态每天最多分享几次 |
| `quietHours.from` / `quietHours.to` | `23` / `8` | 夜间安静时段（23 点到次日 8 点），该时段内主动分享会受限 |
| `work.enabled` | `true` | 后台宿主任务（在 QQ 上派活）是否启用；只在 `closed-agent` 模式、机主私聊时可用 |

## 10. 联网搜索 `webSearch` 与花费 `pricing`

### `webSearch`

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `webSearch.provider` | `auto` | 搜索后端：`auto` = 优先复用 DSH 原本的联网搜索（同一个 DeepSeek 端点 + 服务端 `web_search` 工具），DeepSeek 不可用时兜底 Bing RSS；想固定用 Bing 就改 `bing` |
| `webSearch.apiKey` | 空 | 留空时按 `webSearch.apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）的环境变量解析，再按 DSH 的 `.credentials.yaml` 顺序解析；不要把真实密钥写进仓库，只写在本地 `config.json` 或环境变量里 |
| `webSearch.apiKeyEnv` | `DEEPSEEK_API_KEY` | 读取密钥的环境变量名 |
| `webSearch.baseURL` | 空 | 自定义搜索端点，留空用默认 |
| `webSearch.model` | `deepseek-v4-flash` | 搜索用的模型 |
| `webSearch.maxUses` | `5` | 每轮最多用几次搜索 |
| `webSearch.maxTokens` | `4096` | 搜索结果最多用多少 token |
| `webSearch.maxResults` | `8` | 每次最多返回几条结果 |
| `webSearch.timeoutMs` | `35000` | 搜索超时（毫秒） |

抓取仍由桥接自己做 SSRF 校验并限制正文大小，见 [SECURITY_BASELINE.md](SECURITY_BASELINE.md)。

### `pricing`

`pricing.models` 是价目表覆盖项，留空即用 `src/model-prices.js` 的官方默认价。示例里 `my-relay-model` 只是一个占位标签（“我的中转模型”），按你自己的中转模型改标签和单价：`off.cacheHit` / `off.cacheMiss` / `off.output` 分别是闲时缓存命中 / 未命中输入 / 输出的单价（示例值 `0.5` / `3` / `9`，单位按官方价目表）。控制台「令牌与花费」页按这个表折算金额，区分高峰 / 空闲时段（高峰单价为空闲的 2 倍，已内置中国法定节假日），详见 [TOKEN_USAGE_CONSOLE.md](TOKEN_USAGE_CONSOLE.md)。

## 11. 安全 `security` 与出站审计

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| `security.interceptNotify` | `true` | 出站敏感审计拦住内容时是否通知机主；建议保持 `true`，不要关 |

其他安全行为不需要逐项配，但部署前要知道：

- 工具白名单：QQ 会话拿不到本地执行工具，普通会话只有聊天 + 受限 QQ 工具 + 联网搜索；`closed-agent` 下机主可用完整工具，等于在服务器上以运行账号操作，机主 QQ 被盗 = 操作权敞口，所以白名单是 fail-closed 默认。
- 出站审计：本机路径 / 凭据形态整条拦截，是启发式 + 本地信任模型，拦不住所有形态的秘密；`state/` 中的令牌在本地明文落盘，靠系统文件权限 / ACL 保护。
- 派活 = 交出机器操作权：`closed-agent` 下 agent 的工具权限等同于在服务器上以运行账号操作。
- 完整残余风险清单见 [SECURITY_BASELINE.md](SECURITY_BASELINE.md)，隐私承诺见 [PRIVACY.md](PRIVACY.md)。

## 12. 其他功能：一句话怎么配

- **提问与审批转发**：不需要配，agent 需要确认时问题和工具审批会自动转发到 QQ，回「通过 / 拒绝」即可决策；超时时间见 `questionTimeoutMs`。
- **口语急停**：不需要配，机主私聊说“不要给我发了 / 别发了 / 停下 / 全部停”这类口语即可触发，正在跑的任务被停、排队未发的消息全部作废；已经发出去的消息无法撤回。
- **进度播报与多任务编排**：不需要配，控制台「运行总览」里看状态；问一句进度，就会收到整理好的进度播报。
- **表情、图片与语音**：表情见第 7 节 `sticker`，图片见第 7 节 `media` 与第 5 节画图，语音见第 7 节 `voice`（默认关）。
- **花费看板**：不需要配，控制台「令牌与花费」页按群 / 好友 / 每一轮对话统计 token 与折算金额，详见 [TOKEN_USAGE_CONSOLE.md](TOKEN_USAGE_CONSOLE.md)。
- **会话初始提示词**：控制台「二代仿真 → 初始提示词」里给某个群 / 私聊预写环境说明，字数上限见 `socialV2.initialPromptMaxChars`。
- **仿真提示词（怎么干活）**：改 `dsh/agent-presets/` 后跑 `node scripts/build-agent-preset-patches.mjs` 再重启 DSH；不要把工具用法写进人格卡（见第 3 节）。

## 13. 改完怎么验证

1. 改 `config.json` 后重启桥接，看启动日志有没有报错、SnowLuma 是否连接、DSH 是否就绪。
2. 在白名单私聊里发一句话，确认能收到回复；再在白名单群里发一句话，确认群聊也通。
3. 想验证画图时，在私聊里让它画一张，确认能拿到图、能发回 QQ；如果提交失败，先看桥接日志里的上传选路与提交状态，不要反复重发（提交结果不明时桥接不会自动换 IP 重发，是有意防重复扣费的）。
4. 想验证人设时，改完 `roles/` 后在控制台「人格与角色」页点选该角色，再发一句话，确认语气变了；没变时先确认角色名和文件名一致、且没有被模式标记过滤掉。

---

相关文档：[README.md](../README.md)（一键部署与项目流程）、[DSH_SETUP.md](DSH_SETUP.md)（DSH 端完整启动流程）、[roles/README.md](../roles/README.md)（人格卡写法）、[TOKEN_USAGE_CONSOLE.md](TOKEN_USAGE_CONSOLE.md)（花费看板）、[SECURITY_BASELINE.md](SECURITY_BASELINE.md)（安全基线与残余风险）、[PRIVACY.md](PRIVACY.md)（隐私承诺）。
