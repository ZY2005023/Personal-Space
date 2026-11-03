# Personal Space

个人数字花园，单管理员维护，访客浏览公开内容。

当前0.1.0第一版主要功能已完成本机真实服务联调（N19）：内容编辑与发布、历史/回收站、目录/搜索、媒体处理、账号安全、站点设置、审计、导出、备份和隔离恢复。没有生产部署，冻结48条完整工程验收尚未全部签收。

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

238项单元/替身测试、56项真实服务检查通过；类型、生产构建、Prisma及OpenAPI结构/引用校验通过。[真实联调证据](docs/verification/2026-11-03-real-integration.md)说明覆盖和边界。

- [功能状态](docs/V1-MAIN-FEATURES.md)、[实现与历史批次](docs/IMPLEMENTATION.md)
- [技术架构](docs/ARCHITECTURE.md)、[技术修订](docs/architecture/CHANGES.md)
- [冻结设计](docs/design-delivery/00-交付说明.md)、[业务契约](contracts/openapi.yaml)、[安全扩展](contracts/auth-security.yaml)
- [数据库约束](prisma/CONSTRAINTS.md)、[每日Git同步](docs/GIT-SYNC.md)

.env.local与work/中的凭据、私钥、备份及数据不提交Git。自动备份关闭；测试GC宽限期不是生产保留策略。生产配置、部署和容量/设备/故障专项在下一阶段完成。
