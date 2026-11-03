# 第一版运行入口

本机隔离测试环境已经获授权并完成真实初始化及执行。生产环境仍须使用对应的现有私有服务配置。所有--help都不会连接服务。

## 已初始化的本机环境

当前项目.env.local由integration/setup-local.mjs生成并带隔离标记。私有凭据、证书、归档和证据均位于未跟踪的work/integration；不要提交这些文件。测试登录资料为work/integration/login.json，包含username/password/totpSecret，可把totpSecret导入验证器用于本机登录。

Docker Desktop运行后，现有环境可直接启动：

```powershell
node integration/setup-local.mjs
node integration/run.mjs web-production
# 以下每条在独立终端运行
node integration/run.mjs media
node integration/run.mjs outbox
node integration/run.mjs export
node integration/run.mjs backup
```

修改代码后先npm run build再启动web-production；开发使用node integration/run.mjs web。run包装器在Node启动前载入环境与本机CA，不能以禁用证书校验替代。Windows的pg_dump/pg_restore/restic包装脚本在隔离数据库容器内执行工具。

新机器需先构建integration/Dockerfile.storage和integration/Dockerfile.database，镜像名分别personal-space-integration-storage:local、personal-space-integration-database:local，再执行setup-local、npx prisma migrate deploy、node integration/run.mjs initialize。仅用于明确授权的本机隔离环境，初始化脚本会建立测试角色/恢复目标/私有桶及测试账号。生产账号继续使用交互式npm run admin:init。

真实测试命令为node integration/run.mjs test、constraints、recovery。会创建和修改测试数据/凭据；并发认领测试需先停止其他Worker。请勿对生产配置运行。自动备份保持false，GC可使用node integration/run.mjs gc --once；当前1秒宽限期仅适用于可丢弃测试数据。

## Web与Worker

Web运行npm run dev或生产构建后npm start。媒体处理为npm run worker:media，Outbox为npm run worker:outbox，内容导出为npm run worker:export，数据库/媒体备份为npm run worker:backup，媒体物理清理为npm run worker:gc。每个Worker支持--once；--help只显示用法。Web与Worker需使用同一数据库和配置。

导出私有文件根目录EXPORT_DIRECTORY必须是绝对路径，位于Web静态目录之外；默认工程预算64MiB、下载24小时，可用EXPORT_MAX_BYTES/EXPORT_TTL_SECONDS调整。这些不是冻结设计中的备份保留政策。后台“导出与备份”输入当前密码与验证器/恢复码后创建，保存任务链接可继续查看。ZIP保存在任务/执行token独立目录，下载过期后HTTP404；本轮不自动删除过期归档文件。

## 备份

BACKUP_DIRECTORY指定私有绝对路径；安装PostgreSQL18 pg_dump/pg_restore，必要时配置PG_DUMP_PATH/PG_RESTORE_PATH。备份持有导出的数据库快照期间调用pg_dump --snapshot，并复制该快照所需的原图和活动派生，逐文件SHA-256校验及pg_restore --list后完成本地/完整性阶段。实现依据见[PostgreSQL18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)。

RESTIC_REPOSITORY/RESTIC_PASSWORD_FILE必须指向已经初始化的独立加密仓库；应用不执行restic init。仓库供应商所需环境凭据也需独立配置，如S3仓库使用AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY。restic backup成功后执行check --read-data，均成功才记录异地成功。工具语义见[restic脚本输出](https://restic.readthedocs.io/en/stable/075_scripting.html)和[仓库检查](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)。实际是否异地及恢复目标要由部署环境验证。

异地失败保留已验证的本地bundle；重试先核对本地manifest和文件，再续传异地，最多3次。备份不把整体成功覆盖三个独立状态。

BACKUP_AUTOMATIC默认false；显式true后以Asia/Hong_Kong和BACKUP_TIME（默认03:00）生成最近到期的日/周/月/年周期任务，每个周期只建一次，可补当前周期最近一次漏跑。没有自动forget/prune或本地备份删除，保留数量、RPO/RTO尚待实际部署确认。

## 媒体清理

MEDIA_GC_GRACE_SECONDS没有默认值；只有显式配置后GC入口才运行。仅处理软删除、三层引用均为0、过宽限期的媒体及已登记派生，不删数据库记录。导出/备份先持有media:gc共享事务锁，GC持有独占事务锁，避免清理正在复制的对象；连接池至少需支持外层保护事务与内层快照事务两条连接。孤立未登记对象扫描及过期归档文件清理另属维护工作。

## 隔离恢复演练

npm run backup:drill -- --bundle ABSOLUTE_DIRECTORY默认只核验manifest与本地文件，不连接数据库。增加--execute才执行隔离演练；需要独立现有空PostgreSQL18 RESTORE_DATABASE_URL及独立现有私有RESTORE_S3_*。目标不得等同源数据库/存储桶；工具不会建库或建桶，不提供在线恢复HTTP接口。

实际执行使用单事务pg_restore恢复到空目标，按manifest把媒体以不可覆盖方式写入目标存储，读回校验，核对六张核心表行数与内容/草稿/当前版本引用，在源库写入PASSED/FAILED演练记录。这个结果不替代角色/权限、密钥保管、全应用浏览器及全部工程验收；需要匹配的独立认证/加密材料才能验证恢复后的真实登录。失败目标保留供排查，不自动清空。
