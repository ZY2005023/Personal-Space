# 技术选型收敛与认证兼容验证

日期：2026-11-02。仅限本地代码/文档与测试，未创建数据库、迁移、管理员或部署。

## 变更

- 完成ARCHITECTURE.md：模块化单体、独立Node Worker、PostgreSQL18、私有S3、Sharp、pg_trgm、pg_dump/restic、Linux Compose/Caddy目标方案；列明工程初值与仍需运行确认的参数。
- next-auth从5.0.0-beta.32改为4.24.15；src/auth.ts使用稳定版getServerSession/NextAuth Handler，保留唯一认证与现有MFA/会话撤销规则；AUTH_URL映射提供方规范地址。
- 应用直接依赖精确锁定到当前已安装版本；没有借选型批量升级其他库。
- contracts/openapi.yaml为工作契约1.0.1，仅补503/两个错误code、cookie逻辑映射和实现状态说明。原五份冻结资料完整保留。

## 已通过

- 官方资料12项读取成功，保存来源URL/摘要与SHA256清单；对稳定认证包读取真实发布源码并核对Next.js16/React19 peer范围。
- TypeScript检查与Next.js生产构建通过。
- 原18项领域、Markdown及安全边界测试通过。
- 原本地只读预览16项HTTP检查通过，无数据库变更。
- 稳定认证提供方的本地兼容检查通过：credentials提供方发现、CSRF响应及cookie、异步params/cookies/headers调用下的错误凭据回调、拒绝时不发session cookie、匿名session无user、受保护API仍401。使用固定虚构输入和进程内临时测试签名材料，没有真实账号或持久密钥。
- 工作OpenAPI的结构、引用以及与冻结稿的语义差异检查结果见architecture/contract-validation.json。
- 原冻结交付SHA256清单137项核对一致，未覆盖或重写原始设计稿/ZIP。

## 不能据此声明

没有验证真实账号成功登录、MFA首次绑定/恢复、session撤销和重新认证；没有实际PG事务/迁移/高级约束、媒体处理/S3、Worker重试、中文搜索计划、备份完整恢复、Linux容器或公网HTTPS验证。新方案中的未安装工具仅为选型，不算已完成模块。IV-01～08保持待实现/验证。
