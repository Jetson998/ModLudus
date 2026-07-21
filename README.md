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
- 单机 Docker Compose 部署，先支持本地预览和内部试点

## 默认隐私模式

- API Key、测评题、候选答案和裁判结果只保存在浏览器当前页面内存
- 不写入 ModLudus API、数据库、日志、Cookie、Local Storage 或 IndexedDB
- 刷新或关闭页面即清空
- 目标网关必须允许浏览器 CORS
- 不支持 CORS 的网关后续使用用户本机临时代理，只转发、不持久化
- 天梯数据默认不上传；当前原型的贡献开关仅作交互演示，不会发送数据
- 后续接入贡献接口时，只允许发送模型、场景、胜负、评分和性能区间
- 天梯贡献不包含 Base URL、Key、题目或模型答案

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

开发服务使用 `.next`，生产构建使用 `.next-build`，两者可以并行运行。完整本地校验：

```bash
npm --prefix apps/web run verify
```

首版竞技流程不依赖 ModLudus API 服务；API 健康检查 <http://localhost:8000/health> 为后续可选服务端能力预留。

## 目录

```text
apps/web     Next.js 产品界面
apps/api     FastAPI 控制面与模型连接 API
apps/api/app/worker.py  异步任务 Worker 占位
docs/        产品、架构与执行记录
```

## 设计边界

EvalScope、LiteLLM、Promptfoo 和 Langfuse 通过 adapter 接入；Run、匿名盲测、裁判、人审、推荐和审计属于 ModLudus 自有领域，不把第三方项目作为业务真相源。
