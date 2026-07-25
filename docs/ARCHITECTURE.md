# ModLudus 技术架构

## 首期边界

MVP 默认采用 Web Privacy Mode：浏览器直接调用用户配置的 OpenAI-compatible 网关，Key、测试集和输出仅保留在页面内存。

每个浏览器会话可以创建最多 6 个 Provider Connection；每个连接拥有独立的 Base URL 和 Key。快速竞技跨连接聚合候选模型，总候选模型上限为 6。裁判选择一个连接及独立 Model ID。

模块化单体 API + 异步 Worker + PostgreSQL + Redis + MinIO 作为后续专业测评与可选持久化模式，使用 Docker Compose 单机部署，但不进入默认隐私链路。

M3.2 新增 Trusted Season 服务端链路。它与 Web Privacy Mode 严格分离：浏览器中的用户 Base URL/Key 永不进入可信赛季 API；可信赛季只使用服务器部署环境中的管理员凭据。M3.3 将执行从 API 进程迁移到独立 Worker：API 只冻结 Manifest 并写入共享证据卷上的持久任务，Worker 使用租约、心跳和最大重试次数领取任务。`attempt` 同时作为 fencing token，所有运行进度、失败和封存写入都校验当前租约；证据、Run 与 Job 完成状态在同一事务中封存，重复封存幂等返回已有证据。API 重启不影响队列；Worker 异常后租约过期可由新 Worker 续跑。该实现是单机 SQLite/WAL 队列，不等同于 Redis/PostgreSQL 分布式任务系统。

M4.1 为共享证据卷增加离线恢复边界，但不开放公网备份 API。运维 CLI 使用 SQLite Online Backup API 创建一致快照，将数据库与 Ed25519 私钥封装为权限 `0600` 的敏感归档。归档 Manifest 冻结文件哈希、密钥指纹、表计数和创建时验证结果；独立验证重新执行 SQLite integrity check、全局审计链和全部证据签名校验。恢复只写入空目录，活动卷切换仍需停机、保留旧卷并由运维人员显式完成。

模型天梯外部数据由 API 侧 `ladder-cache.sqlite3` 统一维护，不由每个浏览器直接抓取。OpenRouter 快照作为模型主目录；Artificial Analysis 公共榜单快照作为外部质量与性能指标层。两个固定来源分别使用 24 小时成功更新间隔、5 分钟刷新租约、attempt fencing 和 15 分钟失败重试窗口。模型映射同时保留 OpenRouter Model ID、AA 原始行名、来源 URL、抓取时间和许可状态；含括号的推理/速度档位只有精确匹配或存在来源基准时才允许合并，避免把 `Fast` 错映射到 `max`。

## 领域对象

`Workspace`、`Project`、`ProviderEndpoint`、`ModelSnapshot`、`TestCase`、`Run`、`CandidateAttempt`、`BlindAssignment`、`JudgeTask`、`JudgeVerdict`、`HumanReview`、`MetricSample`、`Recommendation`、`AuditEvent`。

所有 Run 冻结模型、参数、Prompt、Rubric 和价格快照；重试创建新 Attempt，不覆盖原始证据。

M3.1 浏览器批量模式使用 `AbortController` 取消在途 fetch，使用有界 worker pool 将题目并发限制为 1–4，题内候选仍并行。实际瞬时压力约为“题目并发 × 候选模型数”，裁判在候选完成后调用。

跨刷新恢复点保存在当前标签页 Session Storage，只包含数据集/配置指纹、配置随机盐、Rubric、任务状态、评分、Token、延迟、参考成本和复核状态。配置指纹纳入规范化 Base URL 的加盐哈希，以识别同名模型更换网关的情况；恢复点不包含 API Key、Base URL 原文、题目、参考答案、候选输出或裁判原文。续跑前必须重新导入匹配数据集并提供连接凭据。导出器仍直接在浏览器生成 JSON、CSV 或单文件 HTML，不经过 API。

裁判 JSON 必须满足：winner 属于成功候选；scores 完整且仅覆盖全部成功候选；置信度和分数均限制在合法区间。不满足时进入人工抽检队列，不作为可信质量分。

可信赛季在开始时冻结 `dataset_hash`、Rubric 指纹、候选/裁判 Model ID、价格、并发策略、运行环境、模拟标识和包含加盐网关哈希的配置指纹。报告不保存 Prompt、候选输出、裁判原文、Base URL 或 Key，只保存内容哈希、结构化评分、Token、延迟、参考成本、失败类型和复核标记。历史环境从签名 Manifest 读取，不使用实时服务状态反向标注旧报告；升级前缺少环境字段的证据显示为 `legacy-unfrozen`。

可信赛季读接口公开用于报告验证，启动写接口要求 `X-ModLudus-Admin-Token`。CORS 只用于浏览器互操作，不作为安全边界。唯一免令牌路径要求显式 `MODLUDUS_LOCAL_E2E_BYPASS=true`、环境严格等于 `local-e2e` 且请求来源是回环地址。

人工复核写接口要求 `X-ModLudus-Reviewer-Token`，也可由部署时显式配置的管理员令牌接管。复核只保存决定、复核人加盐哈希和备注哈希，记录为 append-only。当前版本不具备修正分数结构，因此 `overturned` 保持未闭环，只有 `confirmed` 能解除必要复核门禁。赛季榜发布必须使用管理员令牌，并同时满足 official、非模拟、完整验签、审计链有效和强制复核闭环。发布事务冻结 `review_snapshot_hash` 和实际排名，发布后禁止继续追加复核；发布记录本身不可更新或删除。证据封存、复核决定和榜单发布均在各自业务事务内同步追加审计事件，任一写入失败会整体回滚，避免业务状态与审计链分叉。

完成报告按 canonical JSON 计算 SHA-256 证据哈希，再用服务端 Ed25519 私钥签名。私钥仅保存在证据卷且权限为 `0600`，API 暴露公钥、指纹和验签结果。`immutable_evidence` 与 `audit_events` 表由 SQLite trigger 禁止更新和删除；审计事件通过 `previous_hash` 形成 append-only 哈希链。

备份归档因包含 Ed25519 私钥而属于高敏恢复资产。ModLudus 只保证本地归档文件权限、内容完整性和安全恢复边界；外层加密、远端保管、密钥托管、保留周期和异地容灾由部署组织负责。

## 开源边界

- LiteLLM：统一 OpenAI-compatible 连接、重试、Token/价格统计
- EvalScope：专业批量评测和标准数据集 adapter
- Promptfoo：开发期 Prompt/模型对比
- Langfuse：脱敏后的 Trace 与成本观测
- vLLM：后续自托管模型基线

Run 编排、匿名盲测、裁判、人审、推荐和审计属于 ModLudus 自有领域。

## CORS 与本机代理

浏览器直连要求模型网关允许 CORS。对于不允许 CORS 的网关，后续提供只运行在用户本机的 ephemeral proxy：Key 随单次请求传入内存，不写磁盘、不写日志、不上传平台服务器。

## 天梯数据

社区天梯只接收用户明确同意贡献的最小化指标：模型 ID、场景、胜负、评分、Token/延迟区间和客户端版本。服务端拒绝 Base URL、Key、Prompt 和模型输出字段。社区数据不可完全信任，应做速率限制、异常检测，并与平台运行的标准赛季榜分开展示。
