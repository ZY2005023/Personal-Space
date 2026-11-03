import { z } from "zod";
import { publicById, publicByPath, publicPage, publicTaxonomy } from "@/lib/public-data";
import { DomainError } from "@/lib/domain";
import { ok, problem } from "@/lib/http";
import type { State } from "@/lib/domain";
import { publicImage } from "@/lib/media-response";
import { Variant } from "@/lib/media";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  try {
    const { segments: s } = await context.params, url = new URL(request.url), q = url.searchParams;
    if (s[0] === "routes" && s[1] === "resolve" && s.length === 2) {
      const path = q.get("path"); if (!path || !path.startsWith("/")) throw new DomainError(400, "INVALID_INPUT", "请提供有效地址");
      const result = await publicByPath(path);
      return result.alias ? new Response(null, { status: 308, headers: { Location: result.content.canonicalPath, "Cache-Control": "private, no-store" } }) : ok({ contentId: result.content.id, canonicalPath: result.content.canonicalPath });
    }
    if (s[0] === "contents" && s.length >= 2) {
      if (!z.uuid().safeParse(s[1]).success) throw new DomainError(404, "NOT_FOUND", "内容不存在");
      if (s.length === 5 && s[2] === "placements" && s[4] === "image") {
        if (!z.uuid().safeParse(s[3]).success) throw new DomainError(404, "NOT_FOUND", "图片不存在");
        const variant = Variant.safeParse(q.get("variant")); if (!variant.success) throw new DomainError(400, "INVALID_INPUT", "请选择有效的图片版本");
        return await publicImage(s[1], s[3], variant.data);
      }
      if (s.length !== 2) throw new DomainError(404, "NOT_FOUND", "内容不存在");
      return ok(await publicById(s[1]));
    }
    if (s.length !== 1 || !["contents", "search", "categories", "tags"].includes(s[0])) throw new DomainError(404, "NOT_FOUND", "接口不存在");
    const limitRaw = q.get("limit"), limit = limitRaw === null ? 20 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
    const module = q.get("module"), type = q.get("type"), categoryId = q.get("categoryId"), tagId = q.get("tagId");
    if (module && !["LIFE", "KNOWLEDGE"].includes(module) || type && !["ARTICLE", "MOMENT", "ALBUM"].includes(type) || categoryId && !z.uuid().safeParse(categoryId).success || tagId && !z.uuid().safeParse(tagId).success) throw new DomainError(400, "INVALID_INPUT", "筛选条件不正确");
    const query = s[0] === "search" ? (q.get("q") || "").trim() : "";
    if (s[0] === "search" && (!query || query.length > 100)) throw new DomainError(400, "INVALID_INPUT", "请输入1至100字的搜索词");
    if (["categories", "tags"].includes(s[0])) return Response.json(await publicTaxonomy(s[0] as "categories" | "tags", { limit, cursor: q.get("cursor") }), { headers: { "Cache-Control": "private, no-store" } });
    const result = await publicPage({ module: module as State["module"] || undefined, type: type as State["type"] || undefined, categoryId: categoryId || undefined, tagId: tagId || undefined, q: query, limit, cursor: q.get("cursor") });
    return Response.json({ data: result.data.map(c => ({ id: c.id, type: c.payload.type, module: c.payload.module, title: c.payload.title, summary: c.payload.summary, canonicalPath: c.canonicalPath, publishedAt: c.publishedAt, cover: c.payload.coverMediaId ? { contentId: c.id, placementId: c.payload.placements.find(p => p.role === "COVER")!.placementId, altText: c.payload.placements.find(p => p.role === "COVER")!.altText } : null })), meta: result.meta }, { headers: { "Cache-Control": "private, no-store" } });
  } catch(e) { return problem(e); }
}
