import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { AuthClient, base } from "./http-client";
import { db } from "../src/lib/db";

async function main() {
  if (process.env.PERSONAL_SPACE_INTEGRATION !== "true") throw new Error("Isolated integration environment required");
  const checks: string[] = [];
  const pass = (name: string) => { checks.push(name); console.log(`PASS ${checks.length}: ${name}`); };

  const client = new AuthClient();
  await client.login();
  pass("restored administrator signs in with the backed-up password and TOTP");
  const security = await client.json("/api/v1/admin/security");
  assert.equal(security.value.data.mfaEnabled, true);
  pass("restored administrator has MFA enabled and an authenticated session");

  const admin = await client.json("/api/v1/admin/contents?limit=5");
  assert.ok(Array.isArray(admin.value.data));
  pass("restored administrator API reads content");

  const publicList = await (await fetch(base + "/api/v1/contents?limit=5")).json();
  assert.ok(Array.isArray(publicList.data) && publicList.data.length > 0);
  const publicItem = publicList.data[0];
  const detail = await fetch(base + "/api/v1/contents/" + publicItem.id);
  assert.equal(detail.status, 200);
  const page = await fetch(base + publicItem.canonicalPath);
  assert.equal(page.status, 200);
  pass("restored public list, detail and canonical page are readable");

  const [image] = await db().$queryRaw<{ content_id: string; placement_id: string }[]>`
    SELECT cm.content_id, cm.placement_id FROM content_media cm
    JOIN contents c ON c.id = cm.content_id
    WHERE c.publication_state = 'PUBLISHED' AND c.effective_visibility = 'PUBLIC' AND c.deleted_at IS NULL
    LIMIT 1`;
  if (image) {
    const response = await fetch(base + `/api/v1/contents/${image.content_id}/placements/${image.placement_id}/image?variant=DISPLAY`);
    assert.equal(response.status, 200);
    pass("restored published media is readable from the independent bucket");
  } else pass("restored published media check skipped: no public placement in fixture");

  const [hidden] = await db().$queryRaw<{ id: string }[]>`
    SELECT id FROM contents WHERE publication_state <> 'PUBLISHED' OR effective_visibility <> 'PUBLIC' OR deleted_at IS NOT NULL LIMIT 1`;
  assert.ok(hidden);
  assert.equal((await fetch(base + "/api/v1/contents/" + hidden.id)).status, 404);
  pass("restored private, unpublished or deleted content stays inaccessible to anonymous readers");

  await mkdir("work/integration/evidence", { recursive: true });
  await writeFile("work/integration/evidence/restored-app.json", JSON.stringify({ passed: true, checks, completedAt: new Date().toISOString() }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "restored app test failed"); process.exitCode = 1; }).finally(async () => { await db().$disconnect(); });