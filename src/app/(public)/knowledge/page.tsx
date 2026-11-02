import { ContentList } from "@/components/content-list";
export const metadata = { title: "知识" };
export default function Knowledge({ searchParams }: { searchParams: Promise<{ type?: string; cursor?: string }> }) { return <ContentList module="KNOWLEDGE" searchParams={searchParams} />; }
