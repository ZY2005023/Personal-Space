# Personal Space 的 Codex 技能

从 Personal Space 项目目录打开 Codex。在输入框输入 `$` 并选择技能，或直接复制下面的示例。技能文件位于 `.agents/skills/`，来自 [mattpocock/skills](https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d) 的固定提交。需要升级时先核对上游变更，再更新项目中的副本。

- `$grill-with-docs 对照 docs/V2-PRD.md，把首次上线是否包含 V2 的范围和验收条件定下来。`
- `$diagnosing-bugs 复现 Docker Linux 引擎启动失败，先区分前端、数据库和引擎，再给出能重复的检查。`
- `$tdd 给公开专题补回归测试。文章转私密后，用匿名请求验证专题不再显示它。`
- `$code-review 审查从 be186be 到 HEAD 的 V2 改动，按 docs/V2-PRD.md 核对功能，再按 AGENTS.md 核对工程规则。`
- `$handoff 为另一位开发者整理交接，说明 V2 当前状态、已验证内容、联调命令和上线前缺口。`

当前验收记录集中在 docs/acceptance 与 docs/verification，V2 实现和验收步骤见 [V2 实现](../V2-IMPLEMENTATION.md)。先读取冻结设计和现有证据，再执行技能步骤。外部工单、公开部署和真实 AI 调用依各自的任务授权处理。

## 本次应用

按诊断技能的最小复现思路，在同一轮检查前端、引擎和数据服务。11 月 11 日，`/interests` 返回 HTTP 200，Docker 客户端找不到 Linux 引擎管道，15432 和 19000 没有监听。因此当前卡点是隔离服务启动。引擎恢复后，按 V2 实现说明运行迁移和联调脚本。前端 200 仅作为排除预览故障的证据。
