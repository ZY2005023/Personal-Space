"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef } from "react";
const links = [["/admin", "概览"], ["/admin/contents", "内容管理"], ["/admin/media", "媒体库"], ["/admin/taxonomy", "分类与标签"], ["/admin/trash", "回收站"], ["/admin/backups", "导出与备份"], ["/admin/security", "安全与设置"], ["/admin/audit", "审计记录"]];
export function AdminShell({ children }: { children: React.ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const path = usePathname(); const current = [...links].reverse().find(([url]) => path === url || path.startsWith(url + "/"))?.[1] || "管理空间";
  useEffect(() => { if (menu.current) menu.current.open = false; }, [path]);
  const nav = <nav className="admin-links" aria-label="后台导航">{links.map(([href, label]) => <Link key={href} href={href} className={current === label ? "active" : ""}>{label}</Link>)}</nav>;
  return <div className="admin-shell"><aside className="admin-sidebar"><Link href="/" className="brand">Personal Space</Link><p className="sidebar-subtitle">管理空间</p>{nav}<div className="sidebar-bottom">管理员 · 双因素认证</div></aside><div><header className="admin-header"><details ref={menu} className="admin-mobile-menu"><summary>☰ 菜单</summary>{nav}</details><h1>{current}</h1><div><Link href="/">查看网站 ↗</Link><button onClick={() => signOut({ callbackUrl: "/login" })}>退出</button></div></header><main id="main" className="admin-main">{children}</main></div></div>;
}
