# PostgreSQL 物理约束实施清单

2026-11-02 · 数据模型阶段，**不是迁移文件，也没有在数据库执行**。

schema.prisma现在包含29个模型及可由Prisma表达的外键/组合唯一约束。以下PostgreSQL高级机制仍须在获准准备迁移时写入受审查的SQL，并在真实PostgreSQL18上验证。`prisma validate`不会证明它们已经生效，禁止直接以db push替代这些约束。

## 已表达的结构

- 当前发布指针、草稿基线、历史恢复来源、发布投影、搜索投影通过content_id+revision_id组合FK约束所属内容；所有外键删除/更新为RESTRICT。
- categories使用(module,parent_id)→(module,id)组合FK；同父级的slug和标准化名称唯一。根NULL唯一仍需下列部分索引。
- 草稿/历史/当前三张媒体引用表分别按所属对象+placement_id唯一，按所属对象+sort_order唯一；允许重复media_id。分类/标签三层引用均有FK及反查索引。
- 媒体派生按media/type/processing_version唯一；路由path全局唯一；幂等请求按admin/scope/key唯一；任务、Outbox、备份副本和恢复演练模型已补齐。
- 日期统一TIMESTAMPTZ(3)。毫秒精度与Node Date及游标序列化一致，避免数据库微秒精度在游标转换时丢失排序边界。这是本轮物理精度细化，原设计的绝对时间语义不变。

## 必须补入的数据库机制

| 编号 | 对象 | 机制及预期 |
|---|---|---|
| PC-01 | admin_users | singleton_key=1 CHECK及唯一；session_version>0；MFA启用时加密密钥非空 |
| PC-02 | contents | type/module组合CHECK；publication_state/effective_visibility枚举；NEVER/PUBLISHED/UNPUBLISHED的指针、时间及私密规则；state_version>0 |
| PC-03 | content_revisions | version_number>0；kind与published_edition_number的空值/正数关系；发布指针只能指向PUBLISHED快照 |
| PC-04 | 指针与投影 | 循环版本FK按事务需要可延迟；延迟约束触发器校验发布投影/搜索revision与权威指针一致。普通CHECK不能跨表实现 |
| PC-05 | 历史快照及revision_*引用 | 普通业务角色只INSERT/SELECT，拒绝UPDATE/DELETE；不可变保护触发器及专用维护角色分离 |
| PC-06 | categories | parent_id为空时分别按(module,slug)/(module,normalized_name)建立根唯一部分索引；两级深度、禁止环、自指与跨模块规则，在统一锁序下用触发器验证 |
| PC-07 | 分类标签 | 标准化名/slug规则、sort_order>=0；软删除前检查草稿/历史/发布引用和子节点。代码删除保护服务必须在同一事务和资源锁内调用 |
| PC-08 | content_routes | 每content至多一个CANONICAL部分唯一索引；TOMBSTONE的content_id为空，其他kind非空；path标准化与系统路径约束 |
| PC-09 | media | 字节/尺寸为正、宽高同时为空或同时有效、SHA256格式、状态/存储类型枚举、可信拍摄时间必须非空 |
| PC-10 | media_variants | 每media/type至多一个active部分唯一；尺寸/字节/processing_version为正；类型枚举与元数据清理标识 |
| PC-11 | 三层媒体引用 | sort_order>=0、role枚举、每所属对象至多一个COVER部分唯一；发布引用只能使用READY且非删除媒体；JSON中placement/cover与关系表一致 |
| PC-12 | JSONB草稿/快照 | object与schemaVersion CHECK；完整形状/类型组合由应用Zod校验，不能假设JSONB本身保证字段完整 |
| PC-13 | 幂等记录 | status枚举；COMPLETED必须有响应状态及结果；摘要格式与有效期合理；过期清理和真实副作用保留策略分开 |
| PC-14 | jobs/outbox | 状态枚举、attempts>=0、租约token/时间配对；完成提交匹配token。认领/续租/超时恢复属于后续Worker实现 |
| PC-15 | backups/copies/drills | 三项备份状态独立；大小/摘要校验；成功或PASSED要求完成时间与验证证据；副本与演练FK保留 |
| PC-16 | audit/settings | 审计追加权限；target_id不随业务清理级联；设置仅服务端白名单，密钥不进入普通设置 |
| PC-17 | 搜索索引 | pg_trgm扩展及适当GIN索引；短词单独执行计划与预算验证。当前已写数据库包含匹配和相关性分页，但未安装扩展或验证执行计划 |

## 本轮事务代码与仍待证明的性质

content-store在事务内按幂等键锁→内容行→草稿行→分类/标签（各按ID）→媒体（按ID）→路由（按path）加锁；保存同步draft_*，新快照只追加revision_*，发布切换content_*与公开搜索，访问限制同时清除搜索。幂等锁只串行化相同scope/key，不再以一个全局锁阻塞所有内容。

reference-store提供媒体及分类标签删除前检查函数，使用与引用创建相同资源行锁，检查历史等全部引用后才允许后续软删除。**删除管理路由尚未接通**；物理对象GC不在本轮执行，仍需备份保护租约和清理宽限期。

目前对这些代码只做了测试替身的行为验证。真实数据库的阻塞、唯一冲突、死锁、回滚、触发器与角色权限尚未运行。通过对应IV-02/06之前，不得把本清单视为已实施、可迁移或已通过工程验收。
