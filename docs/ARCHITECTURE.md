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
