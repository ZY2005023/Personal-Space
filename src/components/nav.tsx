"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
export function Nav() {
  const menu = useRef<HTMLDetailsElement>(null); const path = usePathname();
  useEffect(() => { if (menu.current) menu.current.open = false; }, [path]);
  return <header className="site-header"><Link href="/" className="brand">Personal Space<span className="brand-dot" /></Link><nav className="desktop-nav" aria-label="主导航"><Link href="/life">生活</Link><Link href="/knowledge">知识</Link><Link href="/albums">相册</Link><Link href="/search">搜索 <span aria-hidden>⌕</span></Link></nav><details ref={menu} className="mobile-nav" onKeyDown={e => { if (e.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}><summary>菜单</summary><nav aria-label="手机主导航"><Link href="/life">生活</Link><Link href="/knowledge">知识</Link><Link href="/albums">相册</Link><Link href="/search">搜索</Link></nav></details></header>;
}
export function Footer() { return <footer className="site-footer"><div><b>Personal Space</b><p>记录生活，也整理所知。</p></div><span>慢慢写，持续生长。</span><Link href="/admin">管理空间 ↗</Link></footer>; }
