import { z } from "zod";
const schema = z.object({ data: z.array(z.object({ id: z.uuid(), name: z.string(), module: z.enum(["LIFE", "KNOWLEDGE"]).optional(), parentId: z.uuid().nullable().optional() })).max(100), meta: z.object({ nextCursor: z.string().min(1).max(2048).nullable(), hasMore: z.boolean() }) });
export type CatalogOption = z.infer<typeof schema>["data"][number];
export type CatalogPage = z.infer<typeof schema>;
export function appendCatalogPage(current: CatalogPage, value: unknown): CatalogPage {
  const next = schema.parse(value);
  if (next.meta.hasMore !== Boolean(next.meta.nextCursor) || (next.meta.nextCursor && next.meta.nextCursor === current.meta.nextCursor)) throw new Error("Invalid directory pagination response");
  return { data: [...new Map([...current.data, ...next.data].map(item => [item.id, item])).values()], meta: next.meta };
}
