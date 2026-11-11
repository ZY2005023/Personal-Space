"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiResponse, requestApi } from "./admin-client";
import type { TopicInput } from "@/lib/interest-topics";

type Item = { contentId: string; title: string; deleted?: boolean };
type Topic = Omit<TopicInput, "contentIds"> & { id: string; version: number; firstPublishedAt: string | null; items: Item[] };
type Candidate = { state: { id: string }; draftTitle: string };
const initial = { slug: "", title: "", intro: "", isPublic: false };

export function TopicManager() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [fields, setFields] = useState(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function request<T>(method = "GET", body?: unknown) {
    return (await requestApi<T>("/api/v2/admin/topics", method, body)).data;
  }
  async function refresh() {
    try { setTopics(await request<Topic[]>()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  function select(topic: Topic | null) {
    setEditing(topic);
    setFields(topic ? { slug: topic.slug, title: topic.title, intro: topic.intro, isPublic: topic.isPublic } : initial);
    setItems(topic?.items ?? []);
    setError("");
    setStatus("");
  }
  async function search(next?: string) {
    setBusy(true);
    setError("");
    const q = next ? activeQuery : query.trim();
    try {
      const params = new URLSearchParams({ q });
      if (next) params.set("cursor", next);
      const result = await apiResponse<Candidate[]>(`contents?${params}`);
      setCandidates(next ? [...candidates, ...result.data] : result.data);
      setCursor(result.meta?.nextCursor ?? null);
      setActiveQuery(q);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { id } = await request<{ id: string }>(editing ? "PUT" : "POST", {
        ...fields, contentIds: items.map(item => item.contentId),
        ...(editing ? { id: editing.id, version: editing.version } : {}),
      });
      const latest = await request<Topic[]>();
      setTopics(latest);
      select(latest.find(topic => topic.id === id) ?? null);
      setStatus("专题已保存。");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function move(index: number, delta: number) {
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setItems(next);
  }
  return <section>
    <h2>兴趣专题</h2>
    {error && <p role="alert" className="notice error">{error}</p>}
    {status && <p role="status" className="notice">{status}</p>}
    {loading && <p role="status">正在读取专题…</p>}
    <div className="admin-actions">
      <button className="button secondary" disabled={busy} onClick={() => select(null)}>新建专题</button>
      <button className="button secondary" disabled={busy} onClick={() => void refresh()}>刷新列表</button>
    </div>
    <ul>{topics.map(topic => <li key={topic.id}>
      <button className="button secondary" disabled={busy} onClick={() => select(topic)}>{topic.title} · {topic.isPublic ? "公开" : "私密"}</button>
      {topic.isPublic && <Link href={`/interests/${topic.slug}`}>查看专题</Link>}
    </li>)}</ul>
    <form className="panel" onSubmit={save}>
      <h3>{editing ? "编辑专题" : "新建专题"}</h3>
      <fieldset disabled={busy || loading} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <label className="form-field"><span>标题</span><input required maxLength={120} value={fields.title} onChange={e => setFields({ ...fields, title: e.target.value })}/></label>
        <label className="form-field"><span>地址标识</span><input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={!!editing?.firstPublishedAt} value={fields.slug} onChange={e => setFields({ ...fields, slug: e.target.value })}/></label>
        <label className="form-field"><span>简介</span><textarea maxLength={2000} value={fields.intro} onChange={e => setFields({ ...fields, intro: e.target.value })}/></label>
        {editing && <label className="form-field"><span>可见性</span><select value={fields.isPublic ? "public" : "private"} onChange={e => setFields({ ...fields, isPublic: e.target.value === "public" })}><option value="private">私密</option><option value="public">公开</option></select></label>}
        <h4>已选内容（{items.length}/50）</h4>
        <ol>{items.map((item, index) => <li key={item.contentId}>
          {item.title || "未命名内容"}{item.deleted && " · 回收站"}
          <div className="admin-actions">
            <button type="button" className="button secondary" disabled={!index} onClick={() => move(index, -1)}>上移</button>
            <button type="button" className="button secondary" disabled={index === items.length - 1} onClick={() => move(index, 1)}>下移</button>
            <button type="button" className="button secondary" onClick={() => setItems(items.filter(entry => entry.contentId !== item.contentId))}>移除</button>
          </div>
        </li>)}</ol>
        <label className="form-field"><span>查找现有内容</span><input maxLength={100} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}/></label>
        <button type="button" className="button secondary" onClick={() => void search()}>查找内容</button>
        <ul>{candidates.map(candidate => <li key={candidate.state.id}><button type="button" className="button secondary" disabled={items.length >= 50 || items.some(item => item.contentId === candidate.state.id)} onClick={() => setItems([...items, { contentId: candidate.state.id, title: candidate.draftTitle }])}>添加 {candidate.draftTitle || "未命名内容"}</button></li>)}</ul>
        {cursor && <button type="button" className="button secondary" onClick={() => void search(cursor)}>加载更多</button>}
        <button className="button primary" type="submit">保存专题</button>
      </fieldset>
    </form>
  </section>;
}
