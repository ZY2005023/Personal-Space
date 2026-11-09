export default function AdminLoading() {
  return <section aria-busy="true"><p className="eyebrow">正在读取管理内容…</p><div className="panel"><div className="skeleton wide" /><div className="skeleton" /><div className="skeleton" /></div></section>;
}