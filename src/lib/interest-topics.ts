import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { publishedByIds } from "./public-store";

const slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const topicInput = z.strictObject({
  slug, title: z.string().trim().min(1).max(120), intro: z.string().trim().max(2000),
  isPublic: z.boolean(), contentIds: z.array(z.uuid().transform(id => id.toLowerCase())).max(50)
    .refine(ids => new Set(ids).size === ids.length, "专题条目不能重复"),
});
export const topicUpdate = topicInput.extend({ id: z.uuid(), version: z.number().int().positive() });
export type TopicInput = z.infer<typeof topicInput>;
export type Topic = { id: string; slug: string; title: string; intro: string; isPublic: boolean; version: number; firstPublishedAt: Date | null };
const fields = Prisma.sql`id, slug, title, intro, is_public AS "isPublic", version, first_published_at AS "firstPublishedAt"`;

export async function publicTopics() {
  if (!process.env.DATABASE_URL) return [];
  return db().$queryRaw<Pick<Topic, "slug" | "title" | "intro">[]>`
    SELECT slug, title, intro FROM interest_topics WHERE is_public ORDER BY title, id`;
}
export async function publicTopic(value: string) {
  if (!process.env.DATABASE_URL || !slug.safeParse(value).success) return null;
  return db().$transaction(async tx => {
    const [topic] = await tx.$queryRaw<Pick<Topic, "id" | "title" | "intro">[]>`
      SELECT id, title, intro FROM interest_topics WHERE slug = ${value} AND is_public`;
    if (!topic) return null;
    const items = await tx.$queryRaw<{ contentId: string }[]>`
      SELECT content_id AS "contentId" FROM interest_topic_items WHERE topic_id = ${topic.id}::uuid ORDER BY position`;
    return { title: topic.title, intro: topic.intro, contents: await publishedByIds(items.map(item => item.contentId), tx) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function adminTopics() {
  const topics = await db().$queryRaw<Topic[]>`SELECT ${fields} FROM interest_topics ORDER BY title, id`;
  const items = await db().$queryRaw<{ topicId: string; contentId: string; title: string; deleted: boolean }[]>`
    SELECT i.topic_id AS "topicId", i.content_id AS "contentId", d.draft_payload->>'title' AS title,
      c.deleted_at IS NOT NULL AS deleted
    FROM interest_topic_items i JOIN contents c ON c.id = i.content_id
    JOIN content_drafts d ON d.content_id = c.id ORDER BY i.topic_id, i.position`;
  return topics.map(topic => ({ ...topic, items: items.filter(item => item.topicId === topic.id) }));
}
export async function saveTopic(input: TopicInput, identity?: { id: string; version: number }) {
  return db().$transaction(async tx => {
    const id = identity?.id ?? randomUUID();
    const [current] = identity ? await tx.$queryRaw<Topic[]>`
      SELECT ${fields} FROM interest_topics WHERE id = ${id}::uuid FOR UPDATE` : [];
    if (identity && !current) throw new DomainError(404, "NOT_FOUND", "专题不存在");
    if (identity && current.version !== identity.version) throw new DomainError(412, "PRECONDITION_FAILED", "专题已在另一处修改，请重新打开");
    if (current?.firstPublishedAt && current.slug !== input.slug) throw new DomainError(422, "INVALID_INPUT", "已公开过的专题地址不能修改");
    const firstPublishedAt = current?.firstPublishedAt ?? (identity && input.isPublic ? new Date() : null);
    if (current) {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM interest_topics WHERE slug = ${input.slug} AND id <> ${id}::uuid`;
      if (row) throw new DomainError(409, "CONFLICT", "专题地址已使用");
      await tx.$executeRaw`UPDATE interest_topics SET slug = ${input.slug}, title = ${input.title}, intro = ${input.intro},
        is_public = ${input.isPublic}, first_published_at = ${firstPublishedAt}, version = version + 1 WHERE id = ${id}::uuid`;
    } else {
      const count = await tx.$executeRaw`INSERT INTO interest_topics (id, slug, title, intro)
        VALUES (${id}::uuid, ${input.slug}, ${input.title}, ${input.intro}) ON CONFLICT (slug) DO NOTHING`;
      if (!count) throw new DomainError(409, "CONFLICT", "专题地址已使用");
    }
    if (input.contentIds.length) {
      const available = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM contents WHERE id IN (${Prisma.join(input.contentIds.map(contentId => Prisma.sql`${contentId}::uuid`))})`;
      if (available.length !== input.contentIds.length) throw new DomainError(422, "INVALID_INPUT", "部分内容不存在");
    }
    await tx.$executeRaw`DELETE FROM interest_topic_items WHERE topic_id = ${id}::uuid`;
    if (input.contentIds.length) {
      await tx.$executeRaw`INSERT INTO interest_topic_items (topic_id, content_id, position) VALUES
        ${Prisma.join(input.contentIds.map((contentId, position) => Prisma.sql`(${id}::uuid, ${contentId}::uuid, ${position})`))}`;
    }
    return { id };
  });
}
