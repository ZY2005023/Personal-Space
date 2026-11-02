import { Nav, Footer } from "@/components/nav";
import { previewEnabled } from "@/lib/preview";
export const dynamic = "force-dynamic";
export default function PublicLayout({ children }: { children: React.ReactNode }) { return <><Nav />{previewEnabled() && <div className="preview-banner">只读设计预览 · 示例文字与插图均非正式发布内容</div>}{children}<Footer /></>; }
