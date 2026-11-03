import { crc32 } from "node:zlib";
import { DomainError } from "./domain";
/** Stored ZIP32 entries; archive generation uses an explicit caller-supplied byte budget. */
export class ZipArchive {
  private entries: { name: Buffer; body: Buffer; crc: number; offset: number }[] = [];
  private names = new Set<string>();
  private localSize = 0;
  private centralSize = 0;
  constructor(private maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > 0xffffffff) throw new DomainError(422, "INVALID_INPUT", "导出大小配置不正确");
  }
  get remainingBytes() { return this.maxBytes - this.localSize - this.centralSize - 22; }
  add(path: string, body: Buffer) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..") || /[\u0000-\u001f]/.test(path) || this.names.has(path)) throw new DomainError(422, "INVALID_INPUT", "导出文件名无效或重复");
    const name = Buffer.from(path, "utf8"), local = 30 + name.length + body.length, central = 46 + name.length;
    if (name.length > 65535 || this.entries.length >= 65535 || body.length > 0xffffffff || local + central > this.remainingBytes) throw new DomainError(422, "INVALID_INPUT", "导出内容超过当前处理限额");
    this.entries.push({ name, body: Buffer.from(body), crc: crc32(body), offset: this.localSize }); this.names.add(path); this.localSize += local; this.centralSize += central;
  }
  finish() {
    const local: Buffer[] = [], central: Buffer[] = [];
    for (const entry of this.entries) {
      const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(entry.crc, 14); header.writeUInt32LE(entry.body.length, 18); header.writeUInt32LE(entry.body.length, 22); header.writeUInt16LE(entry.name.length, 26);
      local.push(header, entry.name, entry.body);
      const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(entry.crc, 16); directory.writeUInt32LE(entry.body.length, 20); directory.writeUInt32LE(entry.body.length, 24); directory.writeUInt16LE(entry.name.length, 28); directory.writeUInt32LE(entry.offset, 42);
      central.push(directory, entry.name);
    }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10); end.writeUInt32LE(this.centralSize, 12); end.writeUInt32LE(this.localSize, 16);
    return Buffer.concat([...local, ...central, end]);
  }
}
