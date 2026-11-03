import { ContentList } from "@/components/content-list";
import type { BrowseParams } from "@/lib/browse";
export const metadata = { title: "知识" };
export default function Knowledge({ searchParams }: { searchParams: Promise<BrowseParams> }) { return <ContentList module="KNOWLEDGE" searchParams={searchParams} />; }
