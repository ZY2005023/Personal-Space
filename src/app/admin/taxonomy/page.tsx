import { ensureAdmin } from "@/lib/admin";
import { TaxonomyManager } from "@/components/taxonomy-manager";
export default async function TaxonomyPage() { await ensureAdmin(); return <TaxonomyManager/>; }
