"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { MenuBackdrop, useMenuDialog } from "./menu-dialog";

export function Nav({ siteTitle = "Personal Space" }: { siteTitle?: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useMenuDialog(menu);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [path]);

  return (
    <header className="site-header">
      <div>
        <Link href="/" className="brand">
          {siteTitle}
          <span className="brand-dot" />
        </Link>
        <nav className="desktop-nav" aria-label="主导航">
          <Link href="/life">生活</Link>
          <Link href="/knowledge">知识</Link>
          <Link href="/albums">相册</Link>
          <Link href="/interests">兴趣</Link>
          <Link href="/search">
            搜索 <span aria-hidden>⌕</span>
          </Link>
        </nav>
        <details ref={menu} className="mobile-nav">
          <summary aria-controls="mobile-site-nav">菜单</summary>
          <MenuBackdrop menu={menu} />
          <nav id="mobile-site-nav" aria-label="手机主导航">
            <Link href="/life">生活</Link>
            <Link href="/knowledge">知识</Link>
            <Link href="/albums">相册</Link>
          <Link href="/interests">兴趣</Link>
            <Link href="/search">搜索</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function Footer({
  siteTitle = "Personal Space",
  siteIntro = "记录生活，也整理所知。"
}: {
  siteTitle?: string;
  siteIntro?: string;
}) {
  return (
    <footer className="site-footer wrap">
      <div>
        <b>{siteTitle}</b>
        <p>{siteIntro}</p>
      </div>
      <span>慢慢写，持续生长。</span>
      <Link href="/admin">管理空间 ↗</Link>
    </footer>
  );
}
