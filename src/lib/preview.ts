import { createContent, Payload, publish, draftEtag, stateEtag } from "./domain";
const make = (id: string, type: Payload["type"], module: Payload["module"], title: string, summary: string, body: string, path: string) => {
  const a = createContent(type, module, "2026-11-02T04:00:00.000Z"); a.state.id = id; a.draft.contentId = id;
  a.draft.payload = { ...a.draft.payload, title, summary, bodyMarkdown: body, desiredVisibility: "PUBLIC", desiredPath: path };
  if (type === "ALBUM") a.draft.payload.placements = [0, 1, 2].map((_, i) => ({ placementId: `20000000-0000-4000-8000-00000000000${i}`, mediaId: `30000000-0000-4000-8000-00000000000${i}`, role: "ALBUM_PHOTO", caption: ["出发时的山路", "清晨的雾", "日常的光"][i], altText: "矢量山景设计样片" }));
  return publish(a, draftEtag(a.draft), stateEtag(a.state), "2026-11-02T04:00:00.000Z");
};
export const previewEnabled = () => process.env.NODE_ENV !== "production" && process.env.PREVIEW_CONTENT === "true";
export function previewItems() { return [
  make("10000000-0000-4000-8000-000000000001", "ARTICLE", "KNOWLEDGE", "如何建立可回访的笔记", "让记录之间形成连接，而不只是存放。", "## 从记录到连接\n\n记录不是为了把每一件事保存下来，而是为下一次思考留一个入口。一条笔记可以很短，只要它能让未来的自己找到当时的问题。\n\n当两条原本独立的记录产生联系，知识就不再是一份静止的清单。\n\n> 先写下自己的问题，再决定需要保留什么。\n\n## 留下自己的问题\n\n每次回访时，允许笔记继续改变。新的经验也会让旧的问题有不同的答案。\n\n- 写下当时的问题\n- 留下自己的理解\n- 给下一次回访留一个入口\n\n## 定期回访\n\n不必追求每天整理。找到一个适合自己的节奏，让记录随着生活一起生长。", "/knowledge/notes"),
  make("10000000-0000-4000-8000-000000000002", "MOMENT", "LIFE", "在日常里留一点空白", "熟悉的街道，在不同的光线里也有新的样子。", "散步时发现，熟悉的街道在不同的光线里，也会有新的样子。\n\n把这些不经意的片刻，留给以后回看。", "/life/blank-space"),
  make("10000000-0000-4000-8000-000000000003", "ALBUM", "LIFE", "山里的清晨", "有雾的时候，山也变得柔软了。", "一次缓慢的出发。", "/life/morning-mountains"),
]; }
