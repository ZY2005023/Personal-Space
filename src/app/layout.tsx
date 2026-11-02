import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Personal Space · 记录生活，也整理所知", template: "%s · Personal Space" }, description: "一个人的数字花园。把日常留下，把知识连接，在这里慢慢生长。" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body><a href="#main" className="skip-link">跳到正文</a>{children}</body></html>; }
