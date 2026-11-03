import { ensureAdmin } from "@/lib/admin";
import { MediaManager } from "@/components/media-manager";
export default async function MediaPage() { await ensureAdmin(); return <MediaManager/>; }
