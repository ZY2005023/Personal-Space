import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentCard } from "@/components/content-card";
import { publicTopic } from "@/lib/interest-topics";

export const dynamic = "force-dynamic";
export default async function InterestPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = await publicTopic((await params).slug);
  if (!topic) notFound();
  return <main id="main" className="wrap list-page">
    <Link href="/interests">返回兴趣专题</Link>
    <h1>{topic.title}</h1>
    {topic.intro && <p className="page-intro">{topic.intro}</p>}
    {topic.contents.length ? <div className="latest-grid">{topic.contents.map(content => <ContentCard key={content.id} content={content}/>)}</div>
      : <p>这个专题暂时没有公开内容。</p>}
  </main>;
}
