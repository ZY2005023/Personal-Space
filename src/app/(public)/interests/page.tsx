import Link from "next/link";
import { publicTopics } from "@/lib/interest-topics";

export const dynamic = "force-dynamic";
export const metadata = { title: "兴趣专题" };
export default async function InterestsPage() {
  const topics = await publicTopics();
  return <main id="main" className="wrap list-page">
    <h1>兴趣专题</h1>
    {topics.length ? <div className="latest-grid">{topics.map(topic => <article className="content-card" key={topic.slug}>
      <h2><Link href={`/interests/${topic.slug}`}>{topic.title}</Link></h2>
      {topic.intro && <p>{topic.intro}</p>}
    </article>)}</div> : <p>还没有公开的专题。</p>}
  </main>;
}
