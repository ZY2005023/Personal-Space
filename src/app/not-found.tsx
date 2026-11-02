import Link from "next/link";
import { Nav, Footer } from "@/components/nav";
export default function NotFound() { return <><Nav /><main id="main" className="wrap empty-page"><div className="eyebrow">404 / 暂未找到</div><h1>这条记录，暂不可见。</h1><p>它可能没有公开，或地址已经发生变化。</p><Link href="/" className="button primary">回到首页 ↗</Link></main><Footer /></>; }
