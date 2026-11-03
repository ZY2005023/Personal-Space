import { z } from "zod";
import { DomainError, requestHash, requireMatch } from "./domain";

const name = z.string().transform(v => v.normalize("NFKC").trim().replace(/\s+/gu, " ")).pipe(z.string().min(1).max(100).refine(v => !/[\p{Cc}\p{Cf}]/u.test(v)));
const slug = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const TagInput = z.strictObject({ name, slug });
export const CategoryInput = TagInput.extend({ module: z.enum(["LIFE", "KNOWLEDGE"]), parentId: z.uuid().transform(v => v.toLowerCase()).nullable(), sortOrder: z.number().int().min(0).max(2147483647) });
export type CategoryValue = z.infer<typeof CategoryInput>;
export type CategoryNode = CategoryValue & { id: string; isSystem: boolean; deletedAt: Date | null };
export const normalizedName = (value: string) => value.normalize("NFKC").toLowerCase();
export const taxonomyEtag = (value: unknown) => `"taxonomy-${requestHash(value)}"`;
export function matchTaxonomy(match: string | null, value: unknown) { requireMatch(taxonomyEtag(value), match, "STATE_CONFLICT"); }
/** All rows, including tombstones, reserve their names and slugs until physical retention is implemented. */
export function validateCategory(value: CategoryValue, nodes: CategoryNode[], current?: CategoryNode) {
  if (current?.isSystem) throw new DomainError(409, "RESOURCE_REFERENCED", "系统分类不可修改或删除");
  if (value.parentId) {
    const parent = nodes.find(n => n.id === value.parentId && !n.deletedAt);
    if (!parent || parent.module !== value.module || parent.parentId || parent.id === current?.id) throw new DomainError(422, "INVALID_INPUT", "请选择同一模块下的一级分类");
    if (current && nodes.some(n => n.parentId === current.id)) throw new DomainError(409, "RESOURCE_REFERENCED", "有子分类（包括已删除记录）的分类不能移到二级");
  }
  if (nodes.some(n => n.id !== current?.id && n.module === value.module && n.parentId === value.parentId && (n.slug === value.slug || normalizedName(n.name) === normalizedName(value.name)))) throw new DomainError(409, "PATH_CONFLICT", "同级分类名称或地址已存在");
}
