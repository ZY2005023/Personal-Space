"use client";
export default function AdminError({ reset }: { reset: () => void }) { return <section><h2>暂时无法读取管理内容</h2><p className="muted">请检查连接后重试。</p><button className="button primary" onClick={reset}>重新尝试</button></section>; }
