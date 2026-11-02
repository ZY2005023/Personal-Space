import { ContentList } from "@/components/content-list";
export const metadata = { title: "生活" };
export default function Life({ searchParams }: { searchParams: Promise<{ type?: string; cursor?: string }> }) { return <ContentList module="LIFE" searchParams={searchParams} />; }
