# N20：体验补齐、验收自动化与上线准备证据

日期：2026-11-06（香港时间）
环境：Windows 11 开发机；Docker Desktop；隔离 PostgreSQL 18（127.0.0.1:15432）、隔离 HTTPS S3（127.0.0.1:19000）；生产构建运行于 127.0.0.1:3000。没有生产部署或公开服务。

## 1. 本轮改动摘要

- 公开详情页移除段级 `loading.tsx` 的流式边界，私密/删除/不存在页面返回真实 HTTP 404；生活/知识/相册/搜索保留各自加载骨架。
- 编辑器显示最后保存时间；发布确认展示媒体准备状态并阻止未就绪发布；同源链接离开前提示未保存输入。
- 后台内容列表增加分类/标签筛选；后台增加加载骨架；移动菜单增加遮罩关闭、ESC、焦点圈定与回归。
- 相册编辑支持多选新增，按可信拍摄时间升序、缺失或不可信按上传顺序追加；新增 2 项单元测试。
- 新增 `/health/live` 与 `/health/ready`；API/安全端点输出结构化请求日志，Worker 失败日志含任务标识；`instrumentation.onRequestError` 记录服务端渲染错误的路由/类型/摘要标识，不记录错误消息或请求体。
- 新增生产镜像、Compose、Caddy、数据库角色/迁移授权、环境模板与上线手册；新增浏览器模拟检查。
- 新增 `integration/test-acceptance.ts`（23 项检查）和隔离恢复目标重置 `reset-restore`；修正联调脚本在重复运行时的登录限流与 Outbox 积压问题。

## 2. 自动检查结果

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm test` | 240/240 通过，无跳过 | `work/integration/evidence/unit-tests-2026-11-06.log` |
| `npm run typecheck` | 通过 | 本轮终端输出 |
| `npm run build` | Next.js 16.4.4 生产构建通过 | `work/integration/evidence/build.log` |
| `npm run db:validate` | Prisma schema 有效 | 本轮终端输出 |
| `node integration/run.mjs test` | 22/22 通过 | `work/integration/evidence/main-flow.json` |
| `node integration/run.mjs constraints` | 22/22 通过 | `work/integration/evidence/constraints.json` |
| `node integration/run.mjs recovery` | 12/12 通过 | `work/integration/evidence/security.json` |
| `node integration/run.mjs acceptance` | 23/23 通过 | `work/integration/evidence/acceptance.json` |
| `node integration/run.mjs restored` | 6/6 通过：恢复库+独立桶第二实例、ps_app 权限、备份凭据登录、后台/公开/媒体读取、私密 404 | `work/integration/evidence/restored-app.json` |
| `npm run test:browser` | 32/32 页面/视口组合通过 | `work/integration/browser/browser.json` |
| `/health/live`、`/health/ready` | 200 `{"status":"ok"}` / `{"status":"ready"}` | 本轮终端输出 |
| `docker build` | 成功；镜像内 PostgreSQL 18.6、restic 0.19.1、Node 24.21.0 可用 | Docker 构建输出 |
| 镜像连接隔离数据库运行 | `/health/ready` 200、首页 200、`/admin` 307；Linux 容器内 Node 24.21.0 | 本轮终端输出 |
| `docker compose config -q` | 配置有效 | 本轮终端输出 |

## 3. 新增验收检查覆盖

`integration/test-acceptance.ts` 覆盖：

- T-01 匿名后台拒绝与 `no-store`；T-03 跨站写入 403 且无副作用；T-04 恢复码并发单次消费；T-05 导出/备份重新认证；T-06 私密/回收站/不存在的内容、搜索、旧路径 404。
- T-08 恶意 Markdown 消毒；T-09 三类内容创建与模块规则；T-10 保存不影响公开标题/路径/图片顺序；T-12 缺失/弱/通配 ETag；T-13 首次/更新发布编号；T-14 旧 state ETag 冲突；T-17/T-18 发布幂等重放与同键异参；T-19 不完整内容发布 422。
- T-20 转私密后派生图立即 404；T-22/T-23 回收站恢复默认私密与从未发布指针为空；T-25 并发分类冲突与三级拒绝；T-28 路径冲突、单次 308 与旧地址保留；T-29 非法路径；T-32 未 READY 媒体拒绝发布；T-33 被引用媒体不可删除；T-34 超限与伪造 MIME 上传。

## 4. 浏览器模拟检查

`scripts/browser-check.ts` 启动本机 Chrome 无头模式，通过真实 Auth.js 登录会话检查：

- 公开：首页、生活、知识、相册、搜索、当前公开详情、当前公开相册详情。
- 后台：概览、内容列表、编辑器、媒体库、分类标签、回收站、导出备份、安全与设置、审计。
- 视口：1440×900 与 390×844，共 32 个组合。
- 断言：无横向溢出；可见按钮/输入/选择框/摘要/导航目标不小于 44×44；后台会话未跳转登录页。
- 交互场景：两个标签页持同草稿 ETag，A 保存后 B 保存进入冲突且 B 输入保留；编辑器输入后使 sessionVersion 失效，保存显示重新登录反馈且输入保留。

结果：32/32 页面组合与 2/2 交互场景通过，截图保存在 `work/integration/browser/*.png`。该检查是桌面/移动视口模拟，不是真实手机、平板、读屏、200% 缩放或对比度测量。

## 5. 生产镜像与运行文件

- `Dockerfile` 多阶段构建；runner 安装 PostgreSQL 18 客户端，复制 restic 0.19.1；非 root `node` 用户；`/data/exports`、`/data/backups` 预创建并归 node。
- `deploy/docker-compose.yml`：web、media/outbox/export/backup 常驻 Worker，按 profile 启用的 GC/migrate/admin-init/restore-drill，Caddy 与 PostgreSQL；不映射数据库/应用主机端口。
- `deploy/Caddyfile`：自动 HTTPS、请求体 12MB 上限、HSTS、JSON 日志、`/health/ready` 主动健康检查。
- `deploy/postgres-init/01-app-role.sh` 与 `deploy/migrate.sh`：创建低权限 `ps_app`，迁移后刷新表/序列权限并撤销不可变表更新/删除权限。
- `.env.production.example`、`docs/DEPLOYMENT.md`：密钥生成、首次部署、健康核对、备份/恢复、更新/回退、监控、GC 与灾难恢复、上线边界。
- 未创建服务器、域名、证书、正式数据库/S3/restic 仓库或任何付费资源。

## 6. 验证边界

本轮证据证明当前代码在本机隔离服务与 Chrome 模拟视口上可运行；不证明：

- 真实手机/平板、读屏、200% 缩放、对比度、慢网/断网；
- 生产服务器权限、域名/HTTPS、正式 PostgreSQL/S3、异地 restic 与恢复时效；
- 发布事务每一步故障注入、删除与新引用并发、真实异地失败；
- 大数据量中文搜索性能和长期资源占用；
- 冻结 48 条全部签收。当前为 42 条本机真实通过、6 条部分通过。