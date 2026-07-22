# ModLudus

ModLudus 是一个基于真实业务任务的多模型竞技与智能选型平台。

## 首版范围

- 单轮文本任务：文案、代码、总结、数据分析
- 用户可配置最多 6 个 OpenAI-compatible 网关，每个网关独立填写 Base URL、API Key 和模型
- 通过 `GET /v1/models` 发现模型，也支持手工填写 Model ID
- 读取到模型列表后可直接点击选择，无需复制 Model ID
- 跨网关选择 2–6 个候选模型并行生成；总候选上限为 6
- 单个候选调用失败不会终止整场竞技，失败项单独展示且不进入裁判
- 输出匿名化，使用 Fisher–Yates 洗牌生成 A/B/C 位置
- 独立裁判模型为必填，返回结构化评分；裁判失败不丢失候选答案
- 提供人工复核标记和低置信度提示；真实试点按 10%–20% 执行抽检
- 自动读取 OpenRouter 公开参考价，按运行时间冻结快照并估算成本
- 展示质量、成本、速度、失败率、Pareto 候选和三类选型建议
- 浏览器内导入 CSV/JSONL 测试集，单次最多 50 道题
- Rubric 名称、版本、权重、时间和指纹按运行冻结
- 批量评测支持逐题进度、失败题重试和分层人工抽检队列
- 批量任务可取消在途模型/裁判请求，题目并发可在 1–4 之间调整
- 刷新后可恢复脱敏进度；需重新导入原测试集并填写网关凭据，指纹不匹配时禁止续跑
- 内置标准赛季 `2026.1` 八道基准题，覆盖文案、代码、总结和数据分析
- 服务端可信赛季冻结测试集、Rubric、模型与价格配置，生成不可变证据哈希
- 完成报告使用 Ed25519 签名，并提供公钥验签与 append-only 审计哈希链；证据、复核和发布记录与对应审计事件原子提交
- 可信任务由独立持久 Worker 领取和续租，`attempt` fencing 阻止过期 Worker 写回，API 重启不会丢失排队任务
- 人工复核使用独立令牌并保存追加式决定；可信榜发布冻结复核快照和排名，发布后锁定复核
- 本地导出 JSON、CSV 和单文件 HTML 报告，不经过平台服务端
- 单机 Docker Compose 部署，先支持本地预览和内部试点

## 默认隐私模式

- API Key、Base URL、测评题、参考答案、候选答案和裁判原文只保存在当前页面内存
- M3.1 仅在当前标签页的 Session Storage 保存任务状态、Rubric 和脱敏后的评分/性能结果，用于刷新恢复
- 恢复点不写入 ModLudus API、数据库、日志、Cookie、Local Storage 或 IndexedDB，也不含题目或模型输出；网关一致性仅使用当前恢复点随机盐下的规范化 Base URL 哈希校验
- 目标网关必须允许浏览器 CORS
- 不支持 CORS 的网关后续使用用户本机临时代理，只转发、不持久化
- 天梯数据默认不上传；当前原型的贡献开关仅作交互演示，不会发送数据
- 后续接入贡献接口时，只允许发送模型、场景、胜负、评分和性能区间
- 天梯贡献不包含 Base URL、Key、题目或模型答案
- M3.2 可信赛季使用服务器管理员配置的独立模型凭据；不会读取或上传浏览器隐私模式中的用户 Key

## 天梯可信度

- 社区体验榜：用户主动贡献的匿名聚合结果，用于观察趋势
- 标准赛季榜：使用版本化测试集和固定规则运行，用于较可信的模型比较
- 客户端贡献可以被伪造，因此不能直接作为官方排名或采购结论

## 本地预览

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
```

打开 <http://localhost:3000>。页面已经支持浏览器直连 OpenAI-compatible 网关、读取模型、并行生成和独立裁判。

M3.1 批量实验室复用快速竞技区的网关和裁判配置。测试集文件通过浏览器读取，支持取消、题目并发 1–4 和脱敏检查点恢复。恢复后仍需重新提供测试集、Base URL 和 Key。

M3.2 可信赛季控制台调用 ModLudus API，由服务器使用部署时配置的模型凭据执行固定赛季。运行证据保存在挂载的 `evidence_data` 卷；模型输出与 Prompt 原文不进入签名报告，只记录哈希、评分、Token、延迟、成本和失败类型。

M3.3 中 API 只负责冻结运行并写入持久任务，`apps/api/app/worker.py` 从同一证据卷领取任务。Worker 使用租约和心跳恢复中断任务，并以 `attempt` 作为 fencing token；证据、Run 和 Job 完成状态事务化封存，重复封存幂等返回。这是单机 Docker Compose 的 SQLite/WAL 持久队列，不宣称为分布式 Redis/PostgreSQL 队列。

服务器配置示例（实际 Key 只放服务器环境或 Secret 管理器，不提交仓库）：

```json
{
  "providers": [{"id":"official","base_url":"https://gateway.example.com/v1","api_key":"SERVER_SECRET"}],
  "candidates": [
    {"provider_id":"official","model":"model-a","input_usd_per_token":0.000001,"output_usd_per_token":0.000002},
    {"provider_id":"official","model":"model-b","input_usd_per_token":0.000001,"output_usd_per_token":0.000002}
  ],
  "judge": {"provider_id":"official","model":"judge-model"},
  "concurrency": 1
}
```

将压缩后的单行 JSON 写入 `MODLUDUS_TRUSTED_CONFIG_JSON`，然后启动服务端 profile：

同时用 `MODLUDUS_TRUSTED_ENVIRONMENT` 标记 `local-e2e`、`staging` 或 `official`，并用 `MODLUDUS_TRUSTED_SIMULATED` 冻结是否为模拟运行。两者都会进入签名 Manifest 和运行记录，历史报告不会随服务器当前环境变化而改名。

启动可信赛季属于付费写操作，默认必须设置 `MODLUDUS_ADMIN_TOKEN`，管理员在页面内存中临时输入令牌。只有本机验收可同时设置 `MODLUDUS_TRUSTED_ENVIRONMENT=local-e2e` 与 `MODLUDUS_LOCAL_E2E_BYPASS=true`；绕过仅接受来自回环地址的请求。不得在 staging/official 或公网代理环境开启该开关。

人工复核写操作使用 `MODLUDUS_REVIEWER_TOKEN`。若未单独设置，管理员令牌可兼任复核令牌。赛季榜发布始终要求管理员令牌，并拒绝 local-e2e、staging、simulated、验签失败或强制复核未完成的运行。当前 `overturned` 只标记异议并保持未闭环；发布会冻结 `review_snapshot_hash` 和实际排名，此后禁止追加复核。

Web 与 API 分离部署时，用逗号分隔的 `MODLUDUS_WEB_ORIGINS` 明确列出允许访问 API 的页面来源。CORS 只控制浏览器互操作，不能替代管理员或复核令牌鉴权。

```bash
docker compose --profile server up --build
```

开发服务使用 `.next`，生产构建使用 `.next-build`，两者可以并行运行。完整本地校验：

```bash
npm --prefix apps/web run verify
PYTHONPATH=apps/api python3 -m unittest discover -s apps/api/tests -v
```

首版竞技流程不依赖 ModLudus API 服务；API 健康检查 <http://localhost:8000/health> 为后续可选服务端能力预留。

## 目录

```text
apps/web     Next.js 产品界面
apps/api     FastAPI 控制面、可信赛季执行、签名证据与审计 API
apps/api/app/worker.py  异步任务 Worker 占位
docs/        产品、架构与执行记录
```

## 设计边界

EvalScope、LiteLLM、Promptfoo 和 Langfuse 通过 adapter 接入；Run、匿名盲测、裁判、人审、推荐和审计属于 ModLudus 自有领域，不把第三方项目作为业务真相源。
