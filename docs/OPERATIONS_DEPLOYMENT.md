# ModLudus 运维部署交接

本文用于将已验收的 ModLudus 代码交给运维。生产采用单机 Docker Compose，宿主机 Nginx 终止 HTTPS，Web 和 API 只绑定回环端口。

## 部署边界

- 生产编排文件：`docker-compose.prod.yml`。
- 启动服务：Web、API、Worker 和 `modludus_evidence_data` 持久卷。
- 普通模型评测由用户浏览器直连 OpenAI-compatible 网关；Base URL、Key、任务和答案不进入 ModLudus API。
- 服务端可信评测仅使用运维配置的独立凭据。
- 生产保持 `MODLUDUS_LOCAL_E2E_BYPASS=false` 和 `MODLUDUS_ENABLE_ANONYMOUS_CONTRIBUTIONS=false`。

## 上线前提

1. 目标版本已经提交并推送，本地 `HEAD` 与 `origin/main` 一致。
2. 工作区必须干净；发布校验会拒绝未提交改动。
3. 本地安装 Docker/Buildx、Node.js 和 Python；目标机安装 Docker Compose、Nginx 和 Certbot。
4. 目标机 `/opt` 至少有 5 GB 可用空间，3100/8100 端口没有被其他服务占用。
5. 使用 SSH 密钥访问目标机，不将密码或 API Key 写入命令、Git 或发布记录。

## 必须配置

生产示例在 `.env.production.example`。实际秘密由首次发布在服务器 `/opt/modludus/shared/secrets.env` 生成并以 `0600` 权限保存。

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `MODLUDUS_WEB_ORIGINS` | API 允许的 Web 来源 | 必须是实际 HTTPS 域名 |
| `MODLUDUS_EVIDENCE_SALT` | 证据与身份脱敏 | 随机强值，升级时保持稳定 |
| `MODLUDUS_ADMIN_TOKEN` | 付费赛季启动和发布 | 随机强值，不得公开 |
| `MODLUDUS_REVIEWER_TOKEN` | 人工复核写操作 | 随机强值，不得公开 |
| `MODLUDUS_TRUSTED_CONFIG_JSON` | 服务端候选与裁判模型 | 只写入服务器秘密文件 |
| `MODLUDUS_TRUSTED_ENVIRONMENT` | 冻结运行环境 | 默认 `staging`；仅正式证据使用 `official` |

如暂不运行服务端可信评测，可保持 `MODLUDUS_TRUSTED_CONFIG_JSON` 为空；这不影响普通用户在浏览器内完成单次模型对比。

## 标准发布顺序

以下命令在仓库根目录执行。如需替换目标机或域名，先显式设置 `MODLUDUS_DEPLOY_TARGET` 和 `MODLUDUS_DOMAIN`。

```bash
scripts/release-prepare.sh
scripts/release-verify.sh
scripts/release-package.sh
scripts/release-attest.sh
scripts/release-preflight.sh
MODLUDUS_DEPLOY_CONFIRM="$(git rev-parse HEAD)" scripts/release-deploy.sh
scripts/release-acceptance.sh
scripts/release-finalize.sh
```

流程会：

- 校验干净工作区、远端版本、Web/API 测试和 Compose 配置。
- 构建 `linux/amd64` Web/API 镜像，生成哈希证明，不在生产服务器现场编译源码。
- 升级前备份并验证可信证据卷。
- 仅在显式提供当前提交的 `MODLUDUS_DEPLOY_CONFIRM` 后写入目标机。

## 上线验收

自动验收至少包含：

- `https://<domain>/` 可访问。
- `https://<domain>/api/health` 返回 `{"status":"ok"}`。
- `/opt/modludus/current` 指向本次 release 目录。
- Web、API 和 Worker 容器处于运行/健康状态。

运维还应执行一次非计费的页面验收：

1. 首页、`/evaluations` 和 `/ladder` 正常打开，桌面端布局无明显溢出。
2. 刷新 `/evaluations` 后 Base URL、API Key、任务和结果为空。
3. 不输入用户 Key，不发起真实模型调用。
4. 浏览器控制台无新的前端错误。

真实模型链路验收会产生供应商费用，必须另行获得授权并使用测试专用 Key。

## 回滚与数据保护

- 部署脚本在应用阶段失败时会自动恢复上一 release 和 Nginx 配置。
- 如上线后业务验收失败，停止继续发布，保留当前证据卷与 `/opt/modludus/backups` 中的已验证备份，再由运维将上一 release 重新启动并恢复 `/opt/modludus/current` 指向。
- 备份归档含 Ed25519 私钥，必须在组织认可的加密存储中保管，不得上传公开对象存储或提交 Git。
- 当前仓库没有对已上线版本的一键手工回滚脚本；运维不应把“容器已启动”当作回滚完成，还需重跑 HTTPS/API 和受影响页面验收。

## 交付结论用语

- 只有源码测试通过：`开发完成，待打包代码`。
- 已构建并验证镜像，但未写入服务器：`候选版本已就绪，待上线`。
- 仅在部署、公网健康检查、受影响业务验收和发布记录都完成后，才能记录为`发布完成`。
