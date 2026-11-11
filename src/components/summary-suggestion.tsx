"use client";
import { useEffect, useRef, useState } from "react";
import { requestApi } from "./admin-client";

export function SummarySuggestion({ contentId, title, markdown, apply }: {
  contentId: string; title: string; markdown: string; apply: (summary: string) => void;
}) {
  const [showConsent, setShowConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function generate() {
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setShowConsent(false);
    setError("");
    try {
      const { data } = await requestApi<{ summary: string }>("/api/v2/admin/summary", "POST", { contentId, title, markdown }, {}, controller.signal);
      if (!controller.signal.aborted) setSuggestion(data.summary);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setShowConsent(false);
  }
  return <section aria-label="AI 摘要建议">
    <button type="button" className="button secondary" disabled={pending || showConsent || !title.trim() || !markdown.trim()} onClick={() => setShowConsent(true)}>生成摘要建议</button>
    {showConsent && <div className="notice">
      <p>将把当前文章的标题和正文发送给已配置的 AI 服务。</p>
      <div className="admin-actions">
        <button type="button" className="button primary" onClick={() => void generate()}>发送并生成</button>
        <button type="button" className="button secondary" onClick={cancel}>取消</button>
      </div>
    </div>}
    {pending && <p role="status">正在生成… <button type="button" className="button secondary" onClick={cancel}>取消生成</button></p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {suggestion !== null && <div>
      <label className="form-field"><span>摘要建议</span><textarea maxLength={500} value={suggestion} onChange={e => setSuggestion(e.target.value)}/></label>
      <div className="admin-actions">
        <button type="button" className="button primary" disabled={pending || !suggestion.trim()} onClick={() => { apply(suggestion.trim()); setSuggestion(null); }}>采用到草稿</button>
        <button type="button" className="button secondary" onClick={() => setSuggestion(null)}>丢弃建议</button>
      </div>
    </div>}
  </section>;
}
