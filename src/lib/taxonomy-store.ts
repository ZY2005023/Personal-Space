import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError, requestHash } from "./domain";
import { assertTaxonomyCanDelete, lockRows } from "./reference-store";
import { CategoryInput, TagInput, matchTaxonomy, normalizedName, taxonomyEtag, validateCategory, type CategoryNode } from "./taxonomy";
import { z } from "zod";
type Kind = "categories" | "tags";
const categorySelect = { id: true, module: true, parentId: true, name: true, slug: true, sortOrder: true, isSystem: true, updatedAt: true } as const;
const tagSelect = { id: true, name: true, slug: true, updatedAt: true } as const;
const serial = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function readTaxonomy(kind: Kind, id: string) {
  const row = kind === "categories" ? await db().category.findFirst({ where: { id, deletedAt: null }, select: categorySelect }) : await db().tag.findFirst({ where: { id, deletedAt: null }, select: tagSelect });
  if (!row) throw new DomainError(404, "NOT_FOUND", "分类或标签不存在");
  const data = serial(row); return { data, etag: taxonomyEtag(data) };
}
export async function listTaxonomy(kind: Kind, limit: number, after: { id: string; publishedAt: string } | null) {
  const where = { deletedAt: null, ...(after ? { OR: [{ createdAt: { lt: new Date(after.publishedAt) } }, { createdAt: new Date(after.publishedAt), id: { lt: z.uuid().parse(after.id) } }] } : {}) };
  const rows = kind === "categories" ? await db().category.findMany({ where, select: { ...categorySelect, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }) : await db().tag.findMany({ where, select: { ...tagSelect, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
  return rows.map(row => ({ ...row, publishedAt: row.createdAt.toISOString() }));
}
export async function writeTaxonomy(options: { kind: Kind; adminId: string; id?: string; method: string; body: unknown; match: string | null; key?: string }, client: Pick<ReturnType<typeof db>, "$transaction"> = db()) {
  const { kind, adminId, id, method, match } = options;
  const input = method === "DELETE" ? null : kind === "categories" ? CategoryInput.parse(options.body) : TagInput.parse(options.body);
  const scope = `${kind}:${id || "create"}:${method}`, hash = requestHash({ input, match });
  try {
    return await client.$transaction(async tx => {
      if (options.key) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${adminId + ":" + scope + ":" + options.key}, 0))::text`;
        const previous = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId, operationScope: scope, idempotencyKey: options.key } } });
        if (previous && previous.expiresAt > new Date()) {
          if (previous.requestHash !== hash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "请求标识已用于其他参数");
          return previous.responseReference as { data: Prisma.JsonValue; etag: string; status: number };
        }
        if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
      }
      // Tree/name changes serialize within this catalog, never across unrelated content writes.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"taxonomy:" + kind}, 0))::text`;
      if (id) await lockRows(tx, kind, [id]);
      const current = id ? kind === "categories" ? await tx.category.findFirst({ where: { id, deletedAt: null }, select: categorySelect }) : await tx.tag.findFirst({ where: { id, deletedAt: null }, select: tagSelect }) : null;
      if (id && !current) throw new DomainError(404, "NOT_FOUND", "分类或标签不存在");
      if (current) matchTaxonomy(match, serial(current));
      if (current && "isSystem" in current && current.isSystem) throw new DomainError(409, "RESOURCE_REFERENCED", "系统分类不可修改或删除");
      let result: { data: Prisma.InputJsonValue | null; etag: string; status: number };
      if (method === "DELETE") {
        await assertTaxonomyCanDelete(tx, kind === "categories" ? "category" : "tag", id!);
        if (kind === "categories") await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
        else await tx.tag.update({ where: { id }, data: { deletedAt: new Date() } });
        result = { data: null, etag: "", status: 204 };
      } else {
        let row;
        if (kind === "categories") {
          const value = CategoryInput.parse(input);
          const nodes = await tx.category.findMany();
          const old = id ? nodes.find(n => n.id === id) : undefined;
          if (old && old.module !== value.module) {
            await assertTaxonomyCanDelete(tx, "category", old.id);
            if (nodes.some(n => n.parentId === old.id)) throw new DomainError(409, "RESOURCE_REFERENCED", "有子分类记录时不能改变所属模块");
          }
          validateCategory(value, nodes as CategoryNode[], id ? nodes.find(n => n.id === id) as CategoryNode : undefined);
          const data = { ...value, normalizedName: normalizedName(value.name) };
          row = id ? await tx.category.update({ where: { id }, data, select: categorySelect }) : await tx.category.create({ data, select: categorySelect });
        } else {
          const value = TagInput.parse(input), data = { ...value, normalizedName: normalizedName(value.name) };
          row = id ? await tx.tag.update({ where: { id }, data, select: tagSelect }) : await tx.tag.create({ data, select: tagSelect });
        }
        result = { data: serial(row), etag: taxonomyEtag(serial(row)), status: id ? 200 : 201 };
        if (id) {
          const affected = kind === "categories" ? Prisma.sql`p.category_id = ${id}::uuid` : Prisma.sql`EXISTS (SELECT 1 FROM content_tags ct WHERE ct.content_id = p.content_id AND ct.tag_id = ${id}::uuid)`;
          // Never acquire content locks here: publishers lock content -> taxonomy -> search.
          // Lock documents first, then read labels in a fresh statement after any wait.
          const documents = await tx.$queryRaw<{ content_id: string }[]>(Prisma.sql`SELECT d.content_id FROM content_search_documents d JOIN content_publications p ON p.content_id = d.content_id AND p.revision_id = d.revision_id WHERE ${affected} ORDER BY d.content_id FOR UPDATE OF d`);
          for (const document of documents) {
            const p = await tx.contentPublication.findUnique({ where: { contentId: document.content_id } });
            if (!p) continue;
            const category = p.categoryId ? await tx.category.findUnique({ where: { id: p.categoryId } }) : null;
            const links = await tx.contentTag.findMany({ where: { contentId: p.contentId }, orderBy: { tagId: "asc" } });
            const tags = await tx.tag.findMany({ where: { id: { in: links.map(t => t.tagId) } }, orderBy: { id: "asc" } });
            await tx.contentSearchDocument.updateMany({ where: { contentId: p.contentId, revisionId: p.revisionId }, data: { categoryText: (category?.name || "").normalize("NFKC"), tagsText: tags.map(t => t.name.normalize("NFKC")).join(" ") } });
          }
        }
      }
      await tx.auditLog.create({ data: { actorId: adminId, action: scope, targetType: kind === "categories" ? "CATEGORY" : "TAG", targetId: id || (result.data as { id: string }).id, metadata: {} } });
      if (options.key) await tx.idempotencyRecord.create({ data: { adminId, operationScope: scope, idempotencyKey: options.key, requestHash: hash, status: "COMPLETED", responseStatus: result.status, responseReference: serial(result), expiresAt: new Date(Date.now() + 86400000) } });
      return result;
    }, { isolationLevel: "ReadCommitted", timeout: 15000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError(409, "PATH_CONFLICT", "名称或地址已存在（已删除的条目仍保留名称）");
    throw e;
  }
}
