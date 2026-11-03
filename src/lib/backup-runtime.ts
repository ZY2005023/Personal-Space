import path from "node:path";
import { DomainError } from "./domain";
import { runCommand } from "./process-runner";
import type { BackupTools } from "./backup-pipeline";
export function postgresToolEnv(connection: string) {
  const url = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("PostgreSQL connection required");
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: url.searchParams.get("sslmode") || "prefer", PGCONNECT_TIMEOUT: "10" };
}
export function backupRuntime() {
  const root = process.env.BACKUP_DIRECTORY; if (!root || !path.isAbsolute(root)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "请配置私有备份目录和备份Worker");
  const maxBytes = Number(process.env.BACKUP_MAX_BYTES || 10 * 1024 ** 3), timeoutMs = Number(process.env.BACKUP_TIMEOUT_SECONDS || 1800) * 1000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw new DomainError(503, "SERVICE_UNAVAILABLE", "备份限额配置不正确");
  const tools: BackupTools = {
    dump: async (snapshot, file) => {
      const executable = process.env.PG_DUMP_PATH || "pg_dump", version = await runCommand(executable, ["--version"], { timeoutMs: 10000 });
      if (!/PostgreSQL\) 18\./.test(version)) throw new Error("PostgreSQL 18 client tools required");
      await runCommand(executable, ["--format=custom", "--snapshot", snapshot, "--no-password", "--file", file], { env: postgresToolEnv(process.env.DATABASE_URL || ""), timeoutMs });
    },
    checkDump: async file => { await runCommand(process.env.PG_RESTORE_PATH || "pg_restore", ["--list", file], { timeoutMs }); },
    offsite: async (directory, backupId) => {
      if (!process.env.RESTIC_REPOSITORY || !process.env.RESTIC_PASSWORD_FILE) throw new Error("Offsite repository not configured");
      const binary = process.env.RESTIC_PATH || "restic";
      const output = await runCommand(binary, ["backup", directory, "--json", "--tag", `personal-space:${backupId}`], { timeoutMs });
      const summary = output.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(line => line.message_type === "summary" && line.snapshot_id);
      if (!summary?.snapshot_id) throw new Error("Offsite snapshot missing");
      await runCommand(binary, ["check", "--read-data"], { timeoutMs }); return String(summary.snapshot_id);
    },
  };
  return { config: { root, maxBytes, timeoutMs }, tools };
}
