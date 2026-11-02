"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main id="main" className="wrap empty-page"><h1>暂时无法读取。</h1><p>请稍后重试。</p><button className="button primary" onClick={reset}>重新尝试</button></main>; }
