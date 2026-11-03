import Link from "next/link";
import type { Payload } from "@/lib/domain";
export function ContentTaxonomy({ payload }: { payload: Payload }) {
  const base = payload.module === "LIFE" ? "/life" : "/knowledge", taxonomy = payload.taxonomySnapshot;
  if (!taxonomy.category && !taxonomy.tags.length) return null;
  return <nav className="content-taxonomy" aria-label="分类和标签">{taxonomy.category && <Link href={`${base}?categoryId=${taxonomy.category.id}`}>{taxonomy.category.name}</Link>}{taxonomy.tags.map(tag => <Link key={tag.id} href={`${base}?tagId=${tag.id}`}>#{tag.name}</Link>)}</nav>;
}
