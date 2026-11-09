# 正式上线运行手册

版本 1.0 · 2026-11-06 · 适用镜像 `Dockerfile` / `deploy/docker-compose.yml`

本手册描述 Linux x86_64 上使用 Docker Compose、PostgreSQL 18、Caddy、私有 S3 兼容存储的正式运行方式。它不代替真实服务器、域名、存储、恢复演练和冻结 48 条验收；执行结果必须逐项记录。

## 1. 上线前必须由使用者提供或确认

| 项目 | 说明 |
|---|---|
| 服务器 | Linux x86_64，建议至少 2 vCPU / 4 GiB 内存 / 40 GiB 系统盘，Docker Engine 与 Compose v2；实际规格需按本机 Web/Worker 峰值测量调整。 |
| 域名与 DNS | `SITE_DOMAIN` 的 A/AAAA 记录指向服务器，80/443 可入站；Caddy 自动签发证书依赖这些条件。 |
| PostgreSQL | 使用 Compose 内置实例，或提供外部 PostgreSQL 18；外部实例须预先创建 owner 与应用角色，并按第 4 节授权。 |
| 私有 S3 | 已有的私有桶、region、HTTPS endpoint 与专用凭据；应用不会创建桶或修改桶策略。 |
| 异地 restic 仓库 | 已初始化且与媒体桶分离的加密仓库，独立凭据与密码文件；应用不会执行 `restic init`。 |
| 保留与恢复目标 | 日/周/月/年保留数量、GC 宽限期、RPO/RTO 必须由使用者确认。默认只创建分级备份，不自动删除。 |
| 管理员凭据 | 交互式初始化时由使用者输入用户名和密码；TOTP 密钥与恢复码只展示一次，须离线保存。 |
| 监控接收方 | 健康检查、日志、磁盘、备份年龄的告警接收方式。应用只输出结构化日志和健康端点，不内置监控服务。 |

## 2. 服务与端口

```
Internet ── 80/443 ──> caddy ──> web:3000
                                  │
                        media/outbox/export/backup/gc workers
                                  │
                         PostgreSQL 18  私有 S3 / restic 异地仓库
```

- 只公开 Caddy 的 80/443；PostgreSQL、Web 与 Worker 不映射主机端口。
- Web 与 Worker 使用同一个镜像、同一份环境配置。
- Web 处理页面与 API；媒体处理、Outbox、导出、备份、GC 各自独立进程，崩溃由 Compose 重启。

## 3. 密钥与配置

复制模板到未跟踪文件：

```bash
cp .env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

必须分别生成，不要复用：

```bash
openssl rand -hex 32     # AUTH_SECRET
openssl rand -hex 32     # CURSOR_SECRET
openssl rand -base64 32  # TOTP_ENCRYPTION_KEY（必须恰好 32 字节 base64）
openssl rand -hex 24     # 数据库密码（建议十六进制，避免 URL 转义问题）
openssl rand -hex 32     # restic 密码，写入 secrets/restic-password
```

要求：

- `AUTH_URL` 必须与浏览器实际访问的 origin 完全一致，包括 `https://`。
- `DATABASE_URL` 使用低权限 `ps_app`；`MIGRATION_DATABASE_URL` 使用 owner，仅迁移容器读取。
- `AUTH_SECRET`、`CURSOR_SECRET`、`TOTP_ENCRYPTION_KEY`、S3 凭据、restic 密码、管理员恢复码和备份加密材料分别保管；遗失 `TOTP_ENCRYPTION_KEY` 将无法解密验证器密钥。
- restic 密码文件放在 `secrets/restic-password`（未跟踪），Compose 只读挂载。
- 不要把 `deploy/.env.production`、`secrets/`、`work/`、备份或媒体原图提交到 Git。

## 4. 首次部署

```bash
# 1. 构建应用镜像（APP_VERSION 同时作为镜像标签）
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml build web

# 2. 启动数据库（首次空数据目录会创建 ps_app 角色）
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml up -d db

# 3. 执行三份迁移并刷新运行时授权
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  run --rm migrate

# 4. 交互式初始化唯一管理员（会要求密码、TOTP 确认和再次确认）
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  run --rm admin-init

# 5. 启动 Web、媒体、Outbox、导出与备份 Worker
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  up -d web media-worker outbox-worker export-worker backup-worker

# 6. 启动 Caddy（域名与 DNS 就绪后）
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  up -d caddy
```

如果使用外部 PostgreSQL，不要启动 `db` 服务；先在外部实例创建 owner 与 `ps_app` 角色，再执行：

```sql
GRANT CONNECT ON DATABASE personal_space TO ps_app;
GRANT USAGE ON SCHEMA public TO ps_app;
```

随后执行第 3 步 `migrate`，它会补齐表与序列权限并撤销不可变表的更新/删除权限。连接外部数据库时请在 URL 中使用 `?sslmode=require`（或供应商要求的模式）。

媒体 GC 默认不启动。确认宽限期后才启用：

```bash
# 在 deploy/.env.production 设置 MEDIA_GC_GRACE_SECONDS=86400（示例）
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  --profile gc up -d media-gc-worker
```

自动备份默认关闭。确认保留策略后设置 `BACKUP_AUTOMATIC=true` 与 `BACKUP_TIME=03:00`，并重启 `backup-worker`。应用只创建分级备份，不自动 forget/prune。

## 5. 上线核对

```bash
curl -fsS https://$SITE_DOMAIN/health/live      # {"status":"ok"}
curl -fsS https://$SITE_DOMAIN/health/ready     # {"status":"ready"}
curl -fsS https://$SITE_DOMAIN/                 # 首页
curl -fsS -o /dev/null -w '%{http_code}\n' https://$SITE_DOMAIN/admin  # 302/307 到登录
```

`/health/ready` 会检查必要配置、数据库连接、`pg_trgm`、三份迁移与关键表；失败只返回 503，不暴露细节，原因写入结构化日志。

首次上线必须完成：

- 管理员密码 + TOTP 登录、恢复码登录与受控换绑、改密后旧会话失效；
- 上传图片 → 媒体 Worker 处理 → 发布 → 匿名读取派生图；匿名读取原图必须失败；
- 公开/私密/撤回/回收站四种状态的列表、详情、搜索、旧地址检查；
- 创建导出并下载；创建备份，确认本地/完整性/异地三项独立状态；
- 在独立空数据库与独立桶执行一次完整恢复演练并核对内容、引用与权限；
- 逐项签署 [冻结 48 条验收记录](acceptance/48-ACCEPTANCE.md)；
- 真实手机、桌面、键盘/读屏与 200% 缩放检查；
- 确认域名证书、备份保留、GC 宽限期、RPO/RTO 与告警接收方。

## 6. 日常运行与监控

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml logs -f --tail=100 web media-worker outbox-worker export-worker backup-worker
```

应用日志为每行一个 JSON 对象，包含 `time`、`level`、`event`、`requestId`、`method`、`path`、`status`、`durationMs`；Worker 日志包含 `jobId`/`eventId`/`attempts`。日志不记录密码、验证码、恢复码、正文、Cookie、请求体或带凭据的 URL。

建议外部监控至少覆盖：

- `/health/live` 与 `/health/ready` 可用性和延迟；
- Web/Worker 容器重启次数；
- PostgreSQL 连接数、磁盘、慢查询；
- `exports`、`backups` 卷剩余空间；
- 最近备份年龄与三项状态；失败任务和 Outbox 积压。

可直接查询：

```sql
SELECT id, backup_type, status, local_status, integrity_status, offsite_status, started_at, completed_at
FROM backup_runs ORDER BY started_at DESC NULLS LAST LIMIT 20;

SELECT job_type, status, count(*) FROM operation_jobs GROUP BY 1,2 ORDER BY 1,2;

SELECT event_type, status, count(*) FROM outbox_events GROUP BY 1,2 ORDER BY 1,2;
```

## 7. 备份与恢复

- 备份使用 `pg_dump` 一致快照、必要媒体清单、逐文件 SHA-256，并上传到独立 restic 仓库后执行 `check --read-data`。本地、完整性、异地三项状态独立显示，异地失败不会伪装成全绿。
- 备份目录按 `backupId/leaseToken` 隔离；失败目标保留供排查，不自动清空。
- 恢复演练只读校验：

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  run --rm restore-drill npm run backup:drill -- --bundle /data/backups/<backupId>/<token>
```

- 完整隔离恢复：先准备独立的空 PostgreSQL 18 数据库与独立私有桶，配置 `RESTORE_*`，再执行：

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml \
  run --rm restore-drill npm run backup:drill -- \
  --bundle /data/backups/<backupId>/<token> --execute
```

- 从异地仓库恢复时，先用 restic 将对应快照恢复到临时目录，再把该目录作为 `--bundle`；不要把 restic 仓库直接当作在线恢复目标。
- 完整恢复还要恢复角色/权限、扩展、密钥材料和全应用登录验证；演练脚本不替代这些步骤。
- 首次公网前和每季度执行完整恢复演练，记录耗时、数据量、校验结果与 RPO/RTO 是否满足。

## 8. 更新与回退

更新顺序：

1. 在旧版本上完成一次备份并确认三项状态；
2. 构建新镜像：`APP_VERSION=<新版本> docker compose ... build web`；
3. 执行迁移：`docker compose ... run --rm migrate`；
4. 滚动重启：`docker compose ... up -d web media-worker outbox-worker export-worker backup-worker`；
5. 检查 `/health/ready`、登录、发布、上传、导出、备份与管理页。

回退：

- 应用回退：把 `APP_VERSION` 改回上一个已知镜像标签，重新 `up -d`。镜像必须保留在服务器或镜像仓库。
- 数据库只做向前迁移，不提供自动降级脚本。若新版本迁移造成不兼容，只能用更新前的备份在独立环境恢复并切换，不能直接删除迁移记录。
- 任何迁移前都必须确认备份成功；没有可恢复备份时不得升级。

## 9. GC、保留与容量

- `media-gc-worker` 仅在显式设置 `MEDIA_GC_GRACE_SECONDS` 后运行；它只删除已软删除、三层引用均为零且超过宽限期的对象，不删除数据库记录。
- 导出 ZIP 在有效期后拒绝下载，但不会自动删除磁盘文件；需要运维定期清理 `exports` 卷中过期目录。
- 备份不会自动 forget/prune。保留数量必须在 `deploy/.env.production` 之外形成运维决策并记录；在实现并演练自动清理前，由运维按策略手动删除旧 bundle 与 restic 快照。
- 上线前测量数据库、媒体、导出的实际增长速度，并据此设置磁盘告警阈值。

## 10. 故障与灾难恢复

- **数据库不可用**：`/health/ready` 返回 503，Caddy 主动健康检查会暂时摘除 Web；恢复数据库后自动恢复。不要在此期间强制重启并清空卷。
- **S3 不可用**：公开页面仍可读数据库内容，但图片请求失败；上传/媒体 Worker 会有限重试并标记失败。恢复存储后检查失败任务并按需重新上传。
- **异地备份失败**：本地 bundle 与完整性结果保留，页面显示异地失败；恢复网络后重试任务，不要删除本地 bundle。
- **密钥丢失**：`AUTH_SECRET`、`TOTP_ENCRYPTION_KEY`、restic 密码必须有离线副本。`TOTP_ENCRYPTION_KEY` 丢失会导致现有验证器无法解密；`AUTH_SECRET` 变化会使现有会话失效。
- **管理员全部因素丢失**：先确认是否还有未使用的恢复码。若验证器、恢复码和密码全部丢失，当前**没有**自动绕过 MFA 的脚本或 HTTP 入口。只能在受控离线环境用备份恢复到独立实例，由维护者按审计要求直接执行数据库维护并重新建立唯一管理员，随后轮换 `AUTH_SECRET`/`TOTP_ENCRYPTION_KEY`、完整演练登录并重新部署。该流程必须在首次上线前由使用者确认并记录；不要把明文凭据发到聊天或工单。
- **误删内容**：回收站恢复默认私密且不自动重新发布；历史快照和审计不可由普通应用角色修改或删除。

## 11. 明确的上线边界

- 本手册不创建服务器、DNS、桶、restic 仓库、证书或付费资源；这些需要在获得具体信息后执行并确认。
- Windows 开发环境和本机隔离服务不等于 Linux 生产验收；`Dockerfile` 已在 Linux 容器中验证 Node、PostgreSQL 18 客户端与 restic 可用。
- 本机备份源与目标同机，不代表地理容灾；真实异地目标、带宽和恢复时效必须实测。
- 未完成第 5 节清单与冻结 48 条逐项签收前，不应对外开放。