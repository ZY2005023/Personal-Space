"use client";
import { useState } from "react";
export function SearchScope({ initialModule = "", initialType = "" }: { initialModule?: string; initialType?: string }) {
  const [module, setModule] = useState(initialModule), [type, setType] = useState(initialType);
  return <><div className="form-field"><label htmlFor="browse-module">模块</label><select id="browse-module" name="module" value={module} onChange={event => { const next = event.target.value; setModule(next); if (next === "KNOWLEDGE" && type && type !== "ARTICLE") setType(""); }}><option value="">全部模块</option><option value="LIFE">生活</option><option value="KNOWLEDGE">知识</option></select></div><div className="form-field"><label htmlFor="browse-type">类型</label><select id="browse-type" name="type" value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option><option value="ARTICLE">文章</option><option value="MOMENT" disabled={module === "KNOWLEDGE"}>生活记录</option><option value="ALBUM" disabled={module === "KNOWLEDGE"}>相册</option></select></div></>;
}
