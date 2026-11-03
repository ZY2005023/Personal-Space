import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./domain";
import type { ExportArchiveStore } from "./export-worker";
import { checksum } from "./object-store";
export class LocalExportArchiveStore implements ExportArchiveStore {
  constructor(private root: string) { if (!path.isAbsolute(root)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出目录必须为绝对路径"); }
  private file(key: string) {
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.zip$/.test(key)) throw new DomainError(404, "NOT_FOUND", "导出文件不存在");
    return path.join(this.root, ...key.split("/"));
  }
  async put(exportId: string, token: string, bytes: Buffer) {
    const key = `${exportId}/${token}.zip`, file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; const prior = await this.get(key, bytes.length); if (checksum(prior) !== checksum(bytes)) throw new Error("Archive collision"); }
    return key;
  }
  async get(key: string, maxBytes: number) {
    try {
      const file = this.file(key), info = await stat(file);
      if (!info.isFile() || info.size > maxBytes) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出文件超过读取限额");
      const bytes = await readFile(file, { signal: AbortSignal.timeout(30000) });
      if (bytes.length > maxBytes) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出文件超过读取限额"); return bytes;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DomainError(404, "NOT_FOUND", "导出文件不存在或已清理"); throw error; }
  }
}
export function exportRuntime() {
  const root = process.env.EXPORT_DIRECTORY;
  if (!root) throw new DomainError(503, "SERVICE_UNAVAILABLE", "请先配置私有导出目录和导出Worker");
  const maxBytes = Number(process.env.EXPORT_MAX_BYTES || 64 * 1024 * 1024), ttlMs = Number(process.env.EXPORT_TTL_SECONDS || 86400) * 1000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > 0xffffffff || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isFinite(new Date(Date.now() + ttlMs).getTime())) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出配置不正确");
  return { store: new LocalExportArchiveStore(root), config: { maxBytes, ttlMs } };
}
