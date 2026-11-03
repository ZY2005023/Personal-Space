import Link from "next/link";
export function BrowseFeedback({ base, cursor = false }: { base: string; cursor?: boolean }) {
  return <main id="main" className="wrap empty-page"><h1>{cursor ? "这一页已失效。" : "筛选条件无法识别。"}</h1><p>{cursor ? "列表可能已经更新，请从第一页继续浏览。" : "请返回列表，重新选择筛选条件。"}</p><Link className="button primary" href={base}>{cursor ? "返回筛选结果第一页" : "重新浏览"}</Link></main>;
}
