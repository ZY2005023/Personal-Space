import Link from "next/link";
import type { BackupSummary } from "@/lib/backup-read-store";
const names: Record<string, string> = { PENDING: "等待中", RUNNING: "执行中", VERIFYING: "校验中", SUCCEEDED: "成功", FAILED: "失败", PASSED: "通过", DAILY: "每日", WEEKLY: "每周", MONTHLY: "每月", YEARLY: "每年", MANUAL: "手动" };
export const recordLabel = (value: string) => names[value] || value;
export function RecordStatus({ status }: { status: string }) { return <span className={`record-status ${["SUCCEEDED", "PASSED"].includes(status) ? "record-success" : status === "FAILED" ? "record-failed" : "record-pending"}`}>{recordLabel(status)}</span>; }
export function RecordTime({ value }: { value: string | null }) { return value ? <time dateTime={value}>{new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false })}</time> : <>—</>; }
export function BackupRecords({ rows }: { rows: BackupSummary[] }) {
  return <table className="admin-table backup-table"><thead><tr><th>备份</th><th>本地副本</th><th>完整性校验</th><th>异地副本</th><th>开始时间</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><Link href={`/admin/backups/${row.id}`}>{recordLabel(row.backupType)}备份</Link><div className="small muted">任务：{recordLabel(row.status)}</div></td><td><span className="mobile-record-label">本地副本：</span><RecordStatus status={row.localStatus}/></td><td><span className="mobile-record-label">完整性校验：</span><RecordStatus status={row.integrityStatus}/></td><td><span className="mobile-record-label">异地副本：</span><RecordStatus status={row.offsiteStatus}/></td><td><RecordTime value={row.startedAt}/></td></tr>)}</tbody></table>;
}
