# Personal Space

个人数字花园，单管理员维护，访客浏览公开内容。

当前为 **0.1.0 预发布实现（N2数据层批次）**，不是 V1.0 完整交付或上线版本。先读[技术方案与架构决策](docs/ARCHITECTURE.md)。冻结设计资料在 [docs/design-delivery](docs/design-delivery/00-交付说明.md)，实现进度及未闭合项见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。目标工作契约为 [contracts/openapi.yaml](contracts/openapi.yaml)，与冻结稿的技术差异见[修订记录](docs/architecture/CHANGES.md)。

## 已写入代码

- 响应式首页、生活/知识列表、Markdown 阅读、手机目录、阅读进度、搜索、相册与大图浏览。
- 后台文章/生活记录编辑、双栏预览、手机切换、发布设置、显式发布确认、冲突比较、手动快照、历史恢复、回收站。
- 草稿/快照/正式发布编号分离、线上状态版本、ETag 双条件发布、事务内幂等结果、路径注册与旧路径解析、操作审计。
- Auth.js 唯一会话，Argon2 口令校验、TOTP/一次性恢复码、会话版本检查、业务 CSRF/Origin 校验。无演示管理员、注册或认证绕过。
- 认证已收敛为 next-auth 4.24.15 稳定版；所有直接依赖固定精确版本。媒体、队列、搜索、备份和目标运行方式已在架构决策中选定，尚未全部实现。
- 29个Prisma数据模型、三层引用同步/删除保护服务、公开版本独立查询及数据库分页；仅生成类型和静态验证，**没有创建数据库、迁移、管理员或部署**。

## 本地启动

需要 Node.js 22.12+（本次使用 24.21.0）与 npm。依赖由 package-lock.json 锁定。

```powershell
npm ci
npm run db:generate
npm run dev
```

访问 http://127.0.0.1:3000 。没有数据库配置时，前台呈现真实空内容状态，后台显示尚未初始化。

如需查看与设计对应的示例文字和矢量插图，可启动**仅本地、只读**的预览：

```powershell
$env:PREVIEW_CONTENT = 'true'
npm run dev
```

预览不会创建任何持久化内容或账号，不会开启后台；生产环境无视该开关。示例内容仅用于布局和浏览验证，不是正式发布数据。

## 配置与数据库边界

参考 `.env.example`，自行在未跟踪的 `.env.local` 中配置。不要把密钥贴到聊天或提交进源码。

- `DATABASE_URL`：未来明确创建/接入 PostgreSQL 后设置。
- `AUTH_SECRET`：Auth.js 会话与 CSRF签名密钥。
- `CURSOR_SECRET`：独立的生产分页签名密钥，游标绑定筛选与排序版本。
- `TOTP_ENCRYPTION_KEY`：32 字节 base64 AES-256-GCM 密钥；需要独立备份。
- `AUTH_URL`：与浏览器实际使用的同源地址一致。

**不要直接将当前 Prisma 模型推入生产数据库。** 三层媒体/分类引用的模型和事务同步已补齐；物理设计要求的 CHECK、部分唯一索引、延迟约束、快照不可变权限等尚未完成真实实施与验证，须先完成下一批数据库实现和审查。项目刻意没有提供 migrate/db push/账号初始化脚本，以免误建库或误迁移。

管理员授权初始化与 MFA 恢复流程尚未编写，因此此版本没有可登录账号。Auth.js 集成和 PostgreSQL 事务代码已写，但尚未以真实数据库做联调验证。

## 检查

```powershell
npm run db:validate
npm test
npm run typecheck
npm run build
```

可选：在开启只读预览的开发服务器运行期间执行 `npm run test:smoke`，验证页面、公开搜索、分页及匿名拒绝路径。该检查不写数据库。

`npm run test:auth`仅用于**未初始化的本机测试实例**，需由测试进程临时设置AUTH_SECRET和AUTH_URL；它验证提供方接口/CSRF及错误凭据拒绝，不尝试创建真实账号，也不替代成功登录测试。

## 尚未完成

媒体上传/派生/元数据清理及管理入口、分类标签管理、PostgreSQL 中文搜索索引与性能、任务执行器、导出、分级备份/异地副本/完整恢复、安全设置与重新认证、完整生产物理约束与运行验收。已有合法媒体/分类引用的服务端同步已写入；上传和分类管理入口尚未接通，相册创建暂不在常规UI开放；对应管理入口如实说明状态，不返回虚假的保存或备份成功。

所有 48 条 V1.0 工程验收仍需按冻结设计收集真实证据，不能用当前单元测试或只读预览替代。

本批验证：40项测试、类型/模型检查与构建通过；数据层测试使用替身，真实SQL/锁/触发器/回滚尚未运行。详见[N2验证记录](docs/verification/2026-11-02-data-layer.md)。
