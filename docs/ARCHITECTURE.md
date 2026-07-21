# ModLudus 技术架构

## 首期边界

MVP 默认采用 Web Privacy Mode：浏览器直接调用用户配置的 OpenAI-compatible 网关，Key、测试集和输出仅保留在页面内存。

每个浏览器会话可以创建最多 6 个 Provider Connection；每个连接拥有独立的 Base URL 和 Key。快速竞技跨连接聚合候选模型，总候选模型上限为 6。裁判选择一个连接及独立 Model ID。

模块化单体 API + 异步 Worker + PostgreSQL + Redis + MinIO 作为后续专业测评与可选持久化模式，使用 Docker Compose 单机部署，但不进入默认隐私链路。

## 领域对象

`Workspace`、`Project`、`ProviderEndpoint`、`ModelSnapshot`、`TestCase`、`Run`、`CandidateAttempt`、`BlindAssignment`、`JudgeTask`、`JudgeVerdict`、`HumanReview`、`MetricSample`、`Recommendation`、`AuditEvent`。

所有 Run 冻结模型、参数、Prompt、Rubric 和价格快照；重试创建新 Attempt，不覆盖原始证据。

M2 浏览器批量模式将 `BatchTestCase`、`RubricSnapshot`、候选 Attempt、结构化 JudgeVerdict 和 HumanReview 状态保存在 React 内存。CSV/JSONL 最大 50 题，题目串行执行、题内候选并行。导出器直接在浏览器生成 JSON、CSV 或单文件 HTML，不经过 API。

裁判 JSON 必须满足：winner 属于成功候选；scores 完整且仅覆盖全部成功候选；置信度和分数均限制在合法区间。不满足时进入人工抽检队列，不作为可信质量分。

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
