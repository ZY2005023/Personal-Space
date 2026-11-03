# N19：第一版本机真实联调

日期：2026-11-03。用户明确授权后创建隔离测试基础设施、账号与迁移；没有生产部署或公开服务。该记录更新N18“仅源码闭环”的阶段结论。

## 环境与迁移

- PostgreSQL18容器，源库personal_space_test，隔离恢复库personal_space_restore；仅监听本机15432。
- 独立应用角色ps_app不具备超级用户、建库、建角色或维护角色权限；历史与审计禁止更新/删除。
- 三份迁移：initial、constraints、constraint_precision；实际migrate deploy成功，30模型。
- 本机S3兼容测试服务使用官方MinIO源码构建，HTTPS本机19000；Node通过NODE_EXTRA_CA_CERTS信任本机CA，没有禁用TLS验证。
- ps-media、ps-backup、ps-restore三个私有桶；restic仓库由测试初始化步骤单独建立，业务程序不自动初始化仓库。
- Next生产构建与4类Worker运行；GC测试宽限期1秒仅用于可丢弃测试数据，自动备份关闭。

## 通过的真实检查

integration/test-flow.ts：22项。实际密码/TOTP与会话、匿名拒绝、目录创建、条件保存、独立快照/发布编号、中文搜索、目录改名投影、草稿隔离、别名308、转私密404、回收站/历史恢复；真实S3与图片Worker、去EXIF派生、原图摘要与引用保护、站点设置、Outbox/GC；再次验证导出、幂等重放、ZIP下载/到期拒绝；pg_dump一致快照、restic上传/check、隔离恢复和审计。

integration/test-constraints.ts：22项。真实应用角色权限、单管理员约束、不可变历史/审计、根NULL唯一、最大两级、主路径唯一、发布指针/发布编号约束、引用资源软删除保护、搜索及草稿一致性、幂等/租约/再次验证负例、5个pg_trgm索引；实际EXPLAIN ANALYZE；同ETag两并发请求返回200/412；两个Worker仅一方认领同一任务。负例写入回滚。

integration/test-recovery.ts：12项。操作/会话绑定再次验证、一次性恢复码、错误用途不消费合法凭据、最后一枚恢复码登录/换绑重放、新验证器登录、恢复码轮换、改密及旧会话失效、真实失败限流。测试更新了本机测试账号，最终凭据写入私有login.json。

## 自动检查

- npm test：238/238通过，无跳过。
- npm run typecheck、npm run build、npm run db:validate通过。
- OpenAPI3.1.1业务契约：36路径、49操作、558处引用，无未解析引用。
- 安全扩展：8操作、80处引用，无未解析引用。
- 旧78项只读预览/认证拒绝检查属于N18历史；本轮56项成功登录与真实服务检查独立统计。

原始证据在未跟踪目录work/integration/evidence：main-flow.json、constraints.json（含查询计划）、security.json、unit-tests.log、build.log。日志不包含账号密码或TOTP密钥；私有配置和备份均未纳入Git。

## 结论与验证边界

第一版主要功能已具备本机实际使用条件。真实服务测试代替了此前仅有事务替身的证据，但小规模查询计划不证明大数据量性能，独立恢复库/桶也不证明地理异地容灾。生产部署、真实移动设备、无障碍、容量和故障专项、恢复时效及冻结48条逐项签收仍待后续阶段。没有自动forget/prune或备份保留删除。

## 浏览器补充

生产构建下已完成真实会话的后台概览/备份详情与390像素移动编辑页核对；通过页面保存草稿，版本由8推进至9，仍保持私密，显示“草稿已保存，线上内容未改变”。390与1280像素DOM宽度检查无横向溢出，首页图片加载无失败。响应式模拟不等同真实手机验收。媒体、Outbox、导出、备份4个持续Worker启动后无错误输出。
