import sharp from "sharp";
import { createHash } from "node:crypto";
import { DomainError } from "./domain";
export const imageLimits = { bytes: 10 * 1024 * 1024, pixels: 24_000_000 } as const;
const decoderOptions = { limitInputPixels: imageLimits.pixels, failOn: "warning" as const, animated: true };
function formatOf(bytes: Buffer) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "仅支持静态 JPEG、PNG 和 WebP 图片");
}
function rejectAnimation(bytes: Buffer, format: string) {
  // libvips builds may read only the first APNG frame, so do not rely solely on metadata.pages.
  let offset = format === "png" ? 8 : 12;
  while ((format === "png" || format === "webp") && offset + 8 <= bytes.length) {
    const length = format === "png" ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const type = format === "png" ? bytes.toString("ascii", offset + 4, offset + 8) : bytes.toString("ascii", offset, offset + 4);
    if (type === "acTL" || type === "ANIM" || type === "ANMF") throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "暂不支持动画图片");
    const next = offset + length + (format === "png" ? 12 : 8 + (length % 2));
    if (next > bytes.length || next <= offset) break;
    offset = next;
  }
}
export async function inspectImage(bytes: Buffer, claimedMime: string) {
  if (!bytes.length || bytes.length > imageLimits.bytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "单张图片须在 10 MiB 以内");
  const format = formatOf(bytes), mimeType = `image/${format}`;
  if (claimedMime.toLowerCase() !== mimeType) throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "图片类型与实际内容不一致");
  rejectAnimation(bytes, format);
  try {
    const metadata = await sharp(bytes, decoderOptions).metadata();
    if (metadata.format !== format || (metadata.pages || 1) !== 1) throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "暂不支持动画或多页图片");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > imageLimits.pixels) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "图片像素超出限制");
    return { mimeType, width: metadata.width, height: metadata.height, checksumSha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(422, "INVALID_INPUT", "图片损坏或无法安全读取");
  }
}
/** Worker building block only; never call within a database transaction. Original bytes stay untouched. */
export async function processImage(bytes: Buffer, claimedMime: string) {
  const original = await inspectImage(bytes, claimedMime);
  try {
    const variants = [];
    for (const [variantType, size] of [["THUMBNAIL", 480], ["DISPLAY", 2560]] as const) {
      const { data, info } = await sharp(bytes, decoderOptions).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).timeout({ seconds: 20 }).toBuffer({ resolveWithObject: true });
      if (!data.length || data.length > imageLimits.bytes) throw new Error("Derived image size exceeds response limit");
      const metadata = await sharp(data).metadata();
      if (metadata.exif || metadata.xmp || metadata.iptc || metadata.icc || metadata.orientation) throw new Error("Unexpected metadata");
      variants.push({ variantType, bytes: data, width: info.width, height: info.height, mimeType: "image/webp", sizeBytes: data.length, checksumSha256: createHash("sha256").update(data).digest("hex"), metadataSanitized: true });
    }
    return { original, variants };
  } catch { throw new DomainError(422, "INVALID_INPUT", "图片处理失败，不能用于发布"); }
}
