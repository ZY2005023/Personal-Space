# Personal Space V2.0 实现与验收

功能和验收范围以 [V2.0 PRD](V2-PRD.md) 为准。

## 页面和数据

- 访客使用「兴趣」导航进入 `/interests`。详情在 `/interests/<slug>`，只显示成员的当前公开版本。专题撤回后详情返回 404。
- 管理员在 `/admin/topics` 创建私密专题、按标题查找已有内容、添加和排序条目，并设置可见性。每专题最多 50 个不同条目，首次公开后地址固定。表单按版本检测并发改动。
- 文章编辑器的「发布设置」提供 AI 摘要建议。用户确认发送后生成，采用后只更新编辑器里的摘要，按第一版流程保存与发布。
- 第四份迁移新增 `interest_topics`、`interest_topic_items` 和 `ai_summary_usage`。专题成员引用已有内容，保存在 PostgreSQL 备份中。

## 接口

第二版接口继续使用现有管理员会话，写请求验证 Origin 与 CSRF。

- `GET /api/v2/admin/topics` 返回 `{ data: Topic[] }`，包含 id、slug、title、intro、isPublic、version、firstPublishedAt 和有序 items。
- `POST /api/v2/admin/topics` 接受 slug、title、intro、isPublic、contentIds，返回 201 和专题 id。新建一律为私密。
- `PUT /api/v2/admin/topics` 额外接受 id 和 version，返回更新后的专题 id。版本冲突返回 412，地址重复返回 409，修改已公开地址返回 422。
- `POST /api/v2/admin/summary` 接受 contentId、title、markdown，返回 `{ data: { summary } }`。要求该管理员持有未删除的文章。未配置、超时或上游失败返回 503，用尽额度返回 429。

## 摘要服务配置

`AI_SUMMARY_ENDPOINT` 指向部署方配置的 HTTPS 摘要适配器。本机隔离测试使用回环 HTTP。应用发送 JSON 字段 title、markdown、language 和 maxCharacters。适配器返回 `{ "summary": "不超过 500 字的中文摘要" }`，内部连接所选模型。可用 `AI_SUMMARY_TOKEN` 配置 Bearer 认证。只有明确点击发送才传输文章标题和 Markdown 文本。

应用限制输入 20,000 字符，超时 15 秒。默认按香港日期每天最多 20 次，可用 `AI_SUMMARY_DAILY_LIMIT` 修改。实际发起的请求计入用量。未配置摘要服务时，手写摘要继续可用。服务商与模型留待正式启用时确认。

## 隔离验证

应用第四份迁移后，在独立终端运行 `node integration/summary-stub.mjs`。为本机联调 Web 进程设置 `AI_SUMMARY_ENDPOINT=http://127.0.0.1:3011/summary`，再运行 `node integration/run.mjs v2`。脚本使用测试账号创建专用文章和专题，验证摘要采用后的保存与发布，以及专题排序、成员私密化和撤回。该适配器只用于隔离验收。

上线前仍需根据首发范围关闭第一版剩余验收，检查真实设备与恢复时效。启用 AI 前需要配置并验证实际摘要服务。
