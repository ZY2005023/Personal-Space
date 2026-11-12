# 冻结 48 条工程验收工作记录

记录日期：2026-11-06（香港时间）
冻结原稿：[05-测试验收标准.md](../design-delivery/05-测试验收标准.md)（保持不变）
本文件是工作验收记录，不覆盖、不改写冻结原稿。

## 1. 状态与证据规则

| 标记 | 含义 |
|---|---|
| ✅ 本机真实通过 | 在当前代码上，对隔离 PostgreSQL 18、私有 HTTPS S3、真实 Auth.js 会话执行，并有自动化输出；不等于生产环境、真实设备或全量故障注入。 |
| ◐ 部分通过 | 已有关键证据，但冻结用例要求的某个维度（真实浏览器/设备、故障注入、恢复后全应用、性能规模）尚未执行；缺口在行内写明。 |
| ○ 未执行 | 没有当前代码上的直接证据。 |

本轮当前证据：

- `npm test`：240/240 通过（新增相册照片初始排序 2 项）。
- `node integration/run.mjs test`：22/22 真实服务检查。
- `node integration/run.mjs constraints`：22/22 真实数据库约束/并发检查。
- `node integration/run.mjs recovery`：12/12 真实安全恢复检查。
- `node integration/run.mjs acceptance`：23/23 真实服务验收检查（覆盖下表 26 条）。
- `npm run typecheck`、`npm run build`、`npm run db:validate`、OpenAPI 结构/引用校验通过。
- 原始输出在未跟踪目录 `work/integration/evidence/`：`main-flow.json`、`constraints.json`、`security.json`、`acceptance.json`、`unit-tests.log`、`build.log`。

“构建成功”“HTTP 200”“测试数量”都不单独构成本表通过；每行仍需按冻结规则核对行为。

## 2. 逐项记录

| 用例 | 优先级/IV | 状态 | 当前证据与缺口 |
|---|---|---|---|
| T-01 | P0 / IV-01 | ✅ | `acceptance T-01`：匿名后台 API 401、`/admin` 重定向、`no-store`；`request-security` 单元测试。 |
| T-02 | P0 / IV-01 | ✅ | `recovery`：改密、恢复码轮换、MFA 换绑后旧会话 401。`test:browser` 场景 `session-expiry-keeps-input`：在真实 Chrome 编辑器输入后使 sessionVersion 失效，点击保存显示重新登录反馈且输入仍保留。 |
| T-03 | P0 / IV-01 | ✅ | `acceptance T-03`：跨站 Origin 写入 403 且草稿版本不变；同源写入 200；`request-security` 单元测试。 |
| T-04 | P0 / IV-01 | ✅ | `acceptance T-04`：两个真实会话并发消费同一恢复码，恰一次成功；`recovery` 顺序消费负例。 |
| T-05 | P0 / IV-01 | ✅ | `acceptance T-05`：无重新认证证明创建导出/手动备份均为 403 `REAUTH_REQUIRED`；`recovery` 与 `test-flow` 真实完成证明后 202。 |
| T-06 | P0 / IV-04 | ✅ | `acceptance T-06`：公开、转私密、回收站、随机 ID 的详情/搜索/旧路径/解析接口均按预期 200/404；页面 404 状态已修正为真实 404（移除段级 loading 边界导致的流式 200）。 |
| T-07 | P0 / IV-04 | ✅ | `test-flow`：管理员原图 200 且校验摘要；匿名原图 401；`media-response` 单元测试拒绝原图/存储地址泄露。 |
| T-08 | P0 / IV-04 | ✅ | `acceptance T-08`：恶意 Markdown 发布后页面无脚本、事件属性或 `javascript:` 链接，正常文字仍渲染；`markdown` 单元测试。 |
| T-09 | P1 / IV-02 | ✅ | `acceptance T-09`：ARTICLE/MOMENT/ALBUM 创建为 PRIVATE + NEVER_PUBLISHED、草稿版本 1；MOMENT/KNOWLEDGE 被 422 拒绝。 |
| T-10 | P0 / IV-06 | ✅ | `acceptance T-10`：相册草稿改标题/正文/路径/图片顺序后，公开标题、规范路径和 placement 顺序不变；`test-flow` 覆盖文章。 |
| T-11 | P0 / IV-06 | ✅ | `constraints` 并发同 ETag 返回 200/412；`test:browser` 场景 `two-tab-draft-conflict`：两个真实 Chrome 标签页持有同草稿，A 保存后 B 保存进入“内容已在另一处更新”，B 的本地标题仍保留。 |
| T-12 | P1 / IV-06 | ✅ | `acceptance T-12`：缺 `If-Match` 428、弱 ETag 400、`*` 400，草稿版本未推进；`domain` 单元测试。 |
| T-13 | P0 / IV-06 | ✅ | `acceptance T-13`：首次发布 `firstPublication=true`、版本 1/1；更新发布 `false`、版本 2/2；`test-flow` 覆盖快照与发布编号独立。 |
| T-14 | P0 / IV-06 | ✅ | `acceptance T-14`：发布面板打开后另一端转私密，旧 state ETag 发布返回 412 `STATE_CONFLICT`，内容保持私密。 |
| T-15 | P0 / IV-06 | ✅ | `test-flow` 旧草稿 ETag 412；`domain` 单元测试确认线上指针和草稿均不变；`acceptance T-12` 确认无写入。 |
| T-16 | P0 / IV-06 | ✅ | `acceptance T-16` 逐项在快照（content_revisions）、媒体引用（content_media）、主指针/状态（contents）、发布投影（content_publications）、路由（content_routes）、搜索（content_search_documents）、outbox 注入失败：发布返回 503，内容保持 NEVER_PUBLISHED、无指针/版本/路由/投影/新增事件；移除注入后发布 200。审计失败回滚另有单元测试。 |
| T-17 | P0 / IV-06 | ✅ | `acceptance T-17`：同键同条件重放返回同一 revision，历史数量不增加；`export`/`domain` 单元测试。 |
| T-18 | P1 / IV-06 | ✅ | `acceptance T-18`：同键异参 409 `IDEMPOTENCY_MISMATCH`；`recovery` 验证跨会话/用途证明拒绝；媒体上传 `PROCESSING` 重放由 `media-flow` 单元覆盖。 |
| T-19 | P1 / IV-06 | ✅ | `acceptance T-19`：空标题/空正文发布 422，保存允许；补齐后发布 200。 |
| T-20 | P0 / IV-04 | ✅ | `acceptance T-20`：公开派生图 200，转私密后同一 URL 404；`test-flow` 覆盖旧别名与详情。 |
| T-21 | P0 / IV-06 | ✅ | `test-flow` 历史恢复只改草稿、线上仍 UNPUBLISHED；`domain`/`content-write-context` 单元覆盖媒体、顺序、分类标签完整复制。 |
| T-22 | P0 / IV-06 | ✅ | `acceptance T-22` + `test-flow`：回收站恢复为 UNPUBLISHED + PRIVATE，指针保留，草稿期望权限改 PRIVATE。 |
| T-23 | P1 / IV-06 | ✅ | `acceptance T-23`：从未发布草稿删除后恢复仍 NEVER_PUBLISHED，指针为空。 |
| T-24 | P0 / IV-02 | ✅ | `constraints`：普通应用角色 UPDATE 历史/审计被 42501 拒绝。 |
| T-25 | P1 / IV-02 | ✅ | `acceptance T-25`：并发同根名 201/409，三级分类 422；`taxonomy` 单元覆盖环、跨模块、系统项。 |
| T-26 | P0 / IV-02 | ✅ | `acceptance T-26` 进行 3 轮真实并发：分类删除与新草稿引用同时提交，结果只能是 204+422 或 409+200；数据库复核删除后引用为 0、未删除时引用为 1；`constraints` 拒绝被引用分类/媒体软删除，`references` 单元覆盖三层引用。 |
| T-27 | P1 / IV-03 | ✅ | `test-flow`：标签改名后公开搜索投影立即命中新名；历史快照保留原名由 `references` 单元覆盖。 |
| T-28 | P0 / IV-06 | ✅ | `acceptance T-28` + `test-flow`：B 发布到 A 地址 409；A 改址后旧地址单次 308；旧地址继续保留，B 仍不能占用；转私密后 404。 |
| T-29 | P1 / IV-06 | ✅ | `acceptance T-29`：大写/下划线、系统前缀、尾斜线、`..`、超长路径均 422 且无写入。 |
| T-30 | P1 / IV-06 | ✅ | `test-flow` 同一媒体同时作为封面与相册照片，placementId 不同；`references` 单元覆盖说明/替代文本/顺序随快照保存。 |
| T-31 | P1 / IV-05 | ◐ | 多选追加排序已有 `photo-order` 单元覆盖。上移、下移和拖动共用排序逻辑，并新增位置状态播报。待在真实手机复验触屏排序、保存后顺序和读屏播报。 |
| T-32 | P0 / IV-04 | ✅ | `acceptance T-32`：未 READY 媒体发布 422 `MEDIA_NOT_READY`；Worker 处理后可发布，匿名读取成功。 |
| T-33 | P0 / IV-06 | ✅ | `acceptance T-33` + `test-flow`：有草稿/历史/发布引用时删除媒体 409；其他内容仍可读。 |
| T-34 | P1 / IV-08 | ✅ | `acceptance T-34`：10 MiB+1 上传 413、PNG 冒充 JPEG 415；`image-processing`/`media` 单元覆盖 SVG、动画、损坏、像素上限。 |
| T-35 | P0 / IV-03 | ✅ | `test-flow` 中文搜索；`acceptance T-06` 转私密后不再命中；`public-store`/搜索投影单元覆盖权限实时过滤。 |
| T-36 | P1 / IV-03 | ✅ | `pagination` 单元覆盖相同排序键、过滤绑定、游标篡改；`smoke` 验证非法游标 400；`public-taxonomy` 单元。缺口：大规模中文数据集的执行计划/预算仍属 IV-03 性能专项。 |
| T-37 | P0 / IV-06 | ✅ | `constraints`：SKIP LOCKED 两 Worker 仅一方认领；`outbox-worker`/`media-gc`/`export-worker` 单元覆盖租约 fencing、重试上限、事件去重。 |
| T-38 | P0 / IV-04 | ✅ | `test-flow`：匿名/无证明/有效/过期下载，ZIP 含清单、无认证秘密；`content-export` 单元。 |
| T-39 | P0 / IV-07 | ✅ | `acceptance T-39`：真实 pg_dump 本地 bundle 与完整性校验成功，注入异地阶段失败后 API 仍显示 local/integrity SUCCEEDED、offsite FAILED、整体 FAILED；后台备份页显示“失败”且三项分开。真实供应商断网/凭据失效仍属生产环境演练。 |
| T-40 | P0 / IV-07 | ◐ | 2026-11-12：真实 pg_dump、restic S3 校验、隔离库和私有桶恢复通过。恢复耗时 1.390 秒，到恢复实例通过 6 项检查耗时 16.628 秒，演练开始时快照距捕获 4.266 秒。待确认正式 RPO/RTO 并验证实际异地副本取回、密钥轮换和生产规模恢复。 |
| T-41 | P1 / IV-05 | ◐ | Chrome 以真实管理员会话检查 16 个页面 × 6 个断点，96 个组合均无主体横向溢出。待实测手机和平板的字体回退、长文滚动、触屏与发布交互。 |
| T-42 | P1 / IV-05 | ✅ | 既有加载、空数据与失败状态证据，补测 Chrome 断网及注入 HTTP 500，草稿保留且显示对应错误。1.3 秒延迟和限速下重试先显示处理中，随后保存成功。并发 412、返回导航草稿恢复、会话过期也通过。 |
| T-43 | P1 / IV-08 | ◐ | Chrome 验证减少动画偏好生效，灯箱可用 Enter 打开、Escape 关闭并回归触发焦点。具备键盘焦点样式、排序按钮和位置状态播报，待用真实设备读屏并复核菜单、发布确认、灯箱焦点与关闭行为。 |
| T-44 | P1 / IV-05/08 | ◐ | Chrome 在 360/390/430/768/1024/1440 宽度复测，96 个组合的已测控件尺寸均达到 44×44，页面无主体横向溢出。明暗主题代表性普通文字对比度 5.20–7.07。待实测 200% 浏览器缩放、真实触屏与其余颜色状态。 |
| T-45 | P0 / IV-07 | ✅ | 恢复演练实现要求真实 pg_restore/计数/引用检查，checksum-only 不能标记 PASSED；`test-flow` 真实演练通过。 |
| T-46 | P0 / IV-02 | ✅ | `constraints`：手工快照不能成为公开指针、发布快照必须有 edition、投影漂移/搜索漂移触发器拒绝；`domain` 单元。 |
| T-47 | P1 / IV-05 | ✅ | `smoke` 验证生活/知识入口、类型筛选、目录/标签筛选和空/错误恢复；`browse` 单元。 |
| T-48 | P0 / IV-02 | ✅ | `constraints`：singleton CHECK/唯一约束拒绝第二管理员；无注册路由，`smoke` 验证匿名后台拒绝。 |

## 3. 尚未关闭的 5 条

- **T-31、T-41、T-43、T-44**：真实手机和平板触控、字体和长文、读屏、200% 缩放与其余颜色状态。
- **T-40**：确认正式 RPO/RTO，在目标环境实测异地副本取回、密钥轮换与恢复时效。

本轮证据与真机操作步骤见[首发收尾验收](../verification/2026-11-12-first-release.md)。

## 4. 签收

| 角色 | 结论 | 日期 |
|---|---|---|
| 开发（本机） | 43 条本机真实通过，5 条部分通过，0 条未执行；待完成首发签收 | 2026-11-12 |
| 使用者/验收人 | 待逐项确认 | 待填 |

正式发布判定仍按冻结第 4 节：所有 P0/P1 通过并有证据，IV-01～08 关闭或给出不降低要求的已验证替代方案；当前**不满足**全部条件。