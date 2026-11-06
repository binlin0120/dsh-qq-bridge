# 运行结构与维护入口

`src/bridge.js` 仅启动 `bridge-runtime.mjs`。组合层保留启动顺序与共享状态，按领域组装 `src/features/`，通过明确的实时读取与写入接口传递依赖，避免复制会话状态或创建第二套发送权限。

- 进程：runtime-lifecycle、operation-deadline，负责最小状态落盘、故障退出、超时撤销与晚到结果抑制。
- 权限：access-policy、features/roster、session-policy，空名单不放行，拒绝名单优先，配置和热更新都校验。
- 传输和送达：connections、events、delivery、input-media、approvals；维持原来的鉴权、取消、审计和回执边界。
- 会话：sessions、incoming、social-state-v2、social-wake-v2、social-v1，分别处理重置、输入、状态和唤醒。
- 功能：memory、reminders、owner-tasks、owner-controls、media、stickers、voice、diary 等；不改变既有持久化格式，不增加向量模型。
- 管理界面：console-server 保留原 HTTP 路由实现，通过相同服务接口操作。此模块仍约 4300 行；后续新增路由应优先按资源拆分，避免重新堆回入口。

功能模块中的 `deps` 是组合层提供的显式接口；可变项用访问器保持实时值，写入项显式提供 setter。禁止再引入跨模块隐式全局或绕过 delivery 直接向 QQ 发送。测试夹具将同一套功能函数装载在隔离环境中，仍使用假 QQ/DSH 和临时目录。

`npm test` 验证源码清洁、测试登记、离线行为、发布隐私；`test-module-boundaries.mjs` 比较本次抽取前后的函数 AST，保证条件分支和副作用没有被批量迁移改写。以后有意修改函数行为时，应先增加对应行为回归，再同步其契约基线并解释原因。

## 群聊唤醒

`group-mention.mjs` 仅接受结构化 `at` 段与当前登录 QQ 号严格匹配；只有真实 @ 才能开启新的有限群活跃期，昵称与引用不授予入场权限。活跃期内，无 @ 文字会作为话题相关性候选交给模型判断，不延长活跃期；该回合只允许读取当前群上下文、确认已读水位或在当前群发送单条纯文本回复。恢复队列重新验证相同来源。二代群唤醒还要求本次真实 @ 的内存凭证，旧未读与社交定时器不能重建凭证；私聊及已有授权任务的结果交付仍走原流程。

## 共同人格与场景

`conversation-persona.mjs` 组合可公开角色卡、共同表达、可信场景和可公开运行事实。主人私聊保留私人人格输入；群聊和访客组合时不引入该输入。角色文案不授予权限，发言者核验、群策略、额度和发送守卫仍由原模块执行。默认共享角色卡为 `roles/共享人格.md`，需随代码部署；生产个性化文本与公开示例分开维护。`audienceGreetingIntent` 仅识别明确的当前观众问候，带其他聊天目标或实际操作的请求仍走既有动作路径。

## 图片计划与交付

`image-plan.mjs` 统一解释图片意图、作品类型及同会话来源，`short-chain.mjs` 依据真实状态校正回复。上下文只使用同一用户、同一会话的请求和已确认出站回执；角色日常提到画画不能授予执行权限。`photo-execution.mjs` 提供执行事实与状态表达辅助，`photo-continuation.mjs` 保留兼容的指代处理；最终图片动作以统一计划为准。

`features/media.mjs` 分开构建角色照片与海报/插画输入，按请求键去重；`bridge-runtime.mjs` 验证目标、群授权和原图文件边界。`photo-delivery.mjs` 区分永久查询失败、原任务暂态重试和未知提交，未知结果不会创建第二笔付费请求。已完成原图复用不新建生成任务，也不改变旧任务所属请求。

主动分享通过 `auditAndSend(..., {chatSegments:true})` 在完整审计后分段，整批发送复用最初的会话与急停世代守卫；每段仍经过原发送与回执路径。
