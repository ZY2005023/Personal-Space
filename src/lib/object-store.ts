import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { DomainError } from "./domain";
export interface ObjectStore {
  get(key: string, maxBytes: number): Promise<Buffer>;
  putImmutable(key: string, bytes: Buffer, mimeType: string): Promise<void>;
}
export const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function assertObjectKey(key: string) {
  if (!/^(originals|variants)\/[a-f0-9-]{36}\/[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..") || key.includes("//")) throw new DomainError(500, "INTERNAL_ERROR", "无效的存储标识");
}
export async function collectBounded(body: AsyncIterable<Uint8Array>, maxBytes: number, expectedLength?: number, timeoutMs = 30_000) {
  if (expectedLength !== undefined && expectedLength > maxBytes) throw new DomainError(503, "SERVICE_UNAVAILABLE", "存储对象超过限额");
  const chunks: Buffer[] = []; let size = 0;
  const iterator = body[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DomainError(503, "SERVICE_UNAVAILABLE", "读取存储对象超时")), timeoutMs); });
  try {
    while (true) {
      const { done, value: chunk } = await Promise.race([iterator.next(), deadline]); if (done) break;
      size += chunk.byteLength; if (size > maxBytes) throw new DomainError(503, "SERVICE_UNAVAILABLE", "存储对象超过限额"); chunks.push(Buffer.from(chunk));
    }
  } finally { clearTimeout(timer!); if (iterator.return) void Promise.resolve(iterator.return()).catch(() => {}); }
  if (expectedLength !== undefined && size !== expectedLength) throw new DomainError(503, "SERVICE_UNAVAILABLE", "存储对象不完整");
  return Buffer.concat(chunks, size);
}
export class PrivateS3Store implements ObjectStore {
  constructor(private client: S3Client, private bucket: string) {}
  async get(key: string, maxBytes: number) {
    assertObjectKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
    if (!result.Body) throw new DomainError(503, "SERVICE_UNAVAILABLE", "存储对象不可用");
    try { return await collectBounded(result.Body as AsyncIterable<Uint8Array>, maxBytes, result.ContentLength); }
    finally { (result.Body as { destroy?: () => void }).destroy?.(); }
  }
  async delete(key: string) {
    assertObjectKey(key); await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
  }
  async putImmutable(key: string, bytes: Buffer, mimeType: string) {
    assertObjectKey(key);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mimeType, ContentLength: bytes.length, IfNoneMatch: "*", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"), CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(30_000) });
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw e;
      // A retry may encounter the completed original. Never overwrite different bytes.
      const existing = await this.get(key, bytes.length);
      if (existing.length !== bytes.length || checksum(existing) !== checksum(bytes)) throw new DomainError(409, "PATH_CONFLICT", "存储对象已存在且内容不同");
    }
  }
}
export interface RemovableObjectStore extends ObjectStore { delete(key: string): Promise<void> }
let singleton: PrivateS3Store | undefined;
export function objectStore(): RemovableObjectStore {
  if (singleton) return singleton;
  const { S3_BUCKET: bucket, S3_REGION: region, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey, S3_ENDPOINT: endpoint } = process.env;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new DomainError(503, "SERVICE_UNAVAILABLE", "私有图片存储尚未配置");
  if (endpoint && new URL(endpoint).protocol !== "https:") throw new DomainError(503, "SERVICE_UNAVAILABLE", "图片存储必须使用 HTTPS");
  singleton = new PrivateS3Store(new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 }), bucket);
  return singleton;
}
