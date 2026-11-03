"use client";
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel"><h2>暂时无法读取管理内容</h2><p role="alert">请确认服务就绪后重试；如刚执行过保存或恢复，请重新读取以确认最新状态。</p><button className="button secondary" onClick={reset}>重新读取</button></section>;
}
