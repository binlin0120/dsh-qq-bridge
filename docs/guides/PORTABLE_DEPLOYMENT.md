# 可迁移部署与本次开源整理

此目录以公开仓库为基线，合入当前部署中的提醒、停止任务、受控后台任务、角色照片及上传恢复功能。生产配置、会话、QQ 登录数据、私人记忆、参考图和运维记录没有随仓库分发。保留原上游版权与许可证；这是可自行配置的源码版本。

## 安装

需要 Node.js 22.13 或更新版本、npm、已安装的 DSH Web 与可用的 OneBot v11 网关。照片参考图处理额外需要 Python 3 和 Pillow；文档证据提取使用 Python 标准库。可用 `PYTHON_BIN` 指定 Python 可执行文件。

```sh
npm ci
cp config.example.json config.json
# Windows PowerShell 使用 Copy-Item config.example.json config.json
node scripts/setup-dsh.mjs
# 重启自行安装的 DSH，随后运行：
npm start
```

首次必须填写 `ownerQQ`、私聊及群白名单、网关地址/令牌和实际 DSH 模型。`allowAllWhenEmpty` 保持 false。`consoleToken` 留空时由桥接生成，配置和状态不会进入 Git。

机主能力需在控制台切到 `closed-agent` 模式，并使用 `dafeiyu` 预设。这些预设 ID 为兼容既有会话保留，名称不代表部署者的真实身份。角色示例位于 `roles/小鲸鱼.md`，可在控制台自行修改。

## 工作目录与记忆

`workspaceRoot` 默认为仓库下的 `workspace/`，相对路径以仓库根目录解析；`memoryFile` 留空时使用该工作目录的 `memory/AGENTS.md`。不会默认写入其他部署或个人的全局记忆。机主可取自己的工作产物；发给其他人只能从 `对外导出/` 子目录或系统临时导出目录取文件，仍须通过名单和授权检查。

`orchestration.enabled` 和 `orchestration.shortChain` 启用机主短链路与持久化提醒。已有 `state/orchestration-mode.json` 时以该运行状态为准。`work.enabled` 的示例默认值为 false；复杂文件任务需要先安装和验证 Docker 隔离执行环境，再显式启用。简单聊天、名单操作和定时提醒不要求启动工作容器。

提醒先持久保存并回读，再确认设置成功；没时间先询问。课表使用日期或有效期，换课表修改/取消对应计划。发送认领及回执保存在 `state/reminders.sqlite`，已发的一次不重复发送；结果不明时不自动重发，停机超过 15 分钟的旧提醒不集中补发。

## 群友图片额度

`groupPhotos.enabled` 默认开启，`groupPhotos.perDay` 默认 1。按真实发言者 QQ 号在已授权群之间共用每日额度，北京时间零点刷新；用量落盘，重启不清零。仅接受当前消息的明确图片请求，重放同一消息不重复提交或扣次；任务失败或结果不确定时不自动返还当天次数，避免重复付费。主人沿用原有权限，不占群友次数。访客私聊照片的 `guestPhotos.perDay` 独立配置。

## 可选角色照片

图片适配器使用异步任务协议：`POST <draw.baseUrl>/task/submit` 提交 `{model,input}`，以返回的任务 ID 查询 `GET <draw.baseUrl>/task/<id>`。需要选择支持该协议的服务；仅有标准 OpenAI 图片端点的服务需要另行适配。

在私有 `config.json` 配置 `draw.baseUrl`、`draw.model`，并把两张自行准备的角色参考图路径填入 `draw.referenceFiles`。密钥只从 `draw.apiKeyEnv` 指定的环境变量读取，默认变量名为 `IMAGE_API_KEY`。不要把密钥填进源码或公开文档。参考图应放在被忽略的 `workspace/` 内；处理依赖 Pillow。缺少配置会在提交付费任务之前停止。

参考图只生成缓存副本，原图不覆盖。上传结果不明确时保存待核实状态，避免再次付费提交。照片测试使用临时生成的红蓝色图片，不依赖私人形象素材。

## 发布前检查

```sh
python -m pip install -r requirements-test.txt
npm test
npm run privacy-scan
git status --short
```

基础审计和功能测试默认使用隔离文件及模拟 QQ/DSH。可选同级 `voice-tool/` 不属于本仓库；缺少 FFprobe 时跳过相关时长断言，其他 WAV/FFmpeg 检查仍执行。DSH 工具目录集成检查需要在匹配的 DSH 安装上设置 `QQ_BRIDGE_DSH_INTEGRATION=1` 后单独运行 `node scripts/test-preset-local-tools.mjs`，默认明确跳过。

隐私扫描检查 Git 跟踪及未忽略的新文件。强凭据规则覆盖测试文件和启发式豁免路径；报告不输出凭据正文。自动扫描不能替代对角色卡、截图和新增配置的人工审阅。

## 表情自主程度

`socialV2.sticker.autonomyLevel` 默认 0.7，表示让助手按语境自主选用收藏表情的倾向，不是每条消息固定 70% 的发送概率。普通聊天无需用户先要求，可自主选择当前会话的一张合适表情；认真或敏感话题不强配，每轮至多一张。跨聊天发送仍要求机主本次明确指定目标，群聊另受该群 `autoSticker` 控制。照片授权、名单和免打扰规则保持独立。

## 分层记忆

默认启用本地经历召回，配置与维护边界见 [MEMORY.md](MEMORY.md)。新增事实及经历保存在 `state/memory.sqlite`，保留原始归档和旧记忆本；运行数据不能提交到仓库。
