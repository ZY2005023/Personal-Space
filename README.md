# Personal Space

个人数字花园，单管理员维护，访客浏览公开内容。

当前0.1.0第一版主要功能已完成本机真实服务联调（N19/N20）：内容编辑与发布、历史/回收站、目录/搜索、媒体处理、账号安全、站点设置、审计、导出、备份和隔离恢复。已准备生产镜像、Compose、Caddy、健康检查与上线手册，但没有生产部署；冻结48条中42条本机真实通过、6条部分通过，尚未全部签收。

## 本机使用

访问 http://127.0.0.1:3000 ，后台 http://127.0.0.1:3000/admin 。本机测试登录资料在未跟踪的work/integration/login.json；将其中totpSecret导入验证器，使用当前密码和验证码登录。测试账号不可作为生产凭据。

需要Node24.21及以上24系列、npm11和Docker Desktop。已初始化环境使用：

```powershell
node integration/setup-local.mjs
npm run build
node integration/run.mjs web-production
```

媒体、Outbox、导出、备份分别用node integration/run.mjs media/outbox/export/backup启动（每次选择一个模式，独立终端持续运行）。开发入口node integration/run.mjs web。完整首次初始化、工具和Worker说明见[运行说明](docs/OPERATIONS.md)。

## 验证与资料

240项单元/替身测试、56项原有真实服务检查、23项新增真实验收检查、6项恢复后应用检查、32个Chrome无头页面/视口组合与2个双标签/会话失效场景通过；类型、生产构建、Prisma及OpenAPI结构/引用校验通过。[真实联调证据](docs/verification/2026-11-03-real-integration.md)说明覆盖和边界；[48条工作验收记录](docs/acceptance/48-ACCEPTANCE.md)逐项列出通过/部分通过/缺口。

- [冻结范围完成情况](docs/acceptance/V1-COMPLETION.md)、[48条验收记录](docs/acceptance/48-ACCEPTANCE.md)
- [功能状态](docs/V1-MAIN-FEATURES.md)、[实现与历史批次](docs/IMPLEMENTATION.md)
- [技术架构](docs/ARCHITECTURE.md)、[技术修订](docs/architecture/CHANGES.md)
- [上线运行手册](docs/DEPLOYMENT.md)、[本机运行说明](docs/OPERATIONS.md)
- [冻结设计](docs/design-delivery/00-交付说明.md)、[业务契约](contracts/openapi.yaml)、[安全扩展](contracts/auth-security.yaml)
- [数据库约束](prisma/CONSTRAINTS.md)、[每日Git同步](docs/GIT-SYNC.md)

健康检查：`/health/live`（进程）与 `/health/ready`（配置、数据库、扩展、迁移与关键表；失败503）。

.env.local与work/中的凭据、私钥、备份及数据不提交Git。自动备份关闭；测试GC宽限期不是生产保留策略。生产配置、服务器/域名/存储、容量/设备/故障专项仍需实际执行。
