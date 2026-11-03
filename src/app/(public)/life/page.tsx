import { ContentList } from "@/components/content-list";
import type { BrowseParams } from "@/lib/browse";
export const metadata = { title: "生活" };
export default function Life({ searchParams }: { searchParams: Promise<BrowseParams> }) { return <ContentList module="LIFE" searchParams={searchParams} />; }
