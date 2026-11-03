import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationManager } from "../src/components/operation-manager";
test("export, backup, GC and drill help never opens deliberately invalid service configuration", () => {
  for (const script of ["export-worker", "backup-worker", "media-gc-worker", "restore-drill"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, "--help"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "deliberately-invalid" } }); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Usage:/); assert.doesNotMatch(result.stderr, /deliberately-invalid/);
  }
});
test("operation forms expose actual creation and media options with same-auth credentials", () => {
  const html = renderToStaticMarkup(<OperationManager mode="EXPORT"/>); assert.match(html, /验证并创建内容导出/); assert.match(html, /包含未删除媒体的原图/); assert.match(html, /type="password"/); assert.doesNotMatch(html, /下载 ZIP/);
  const backup = renderToStaticMarkup(<OperationManager mode="BACKUP"/>); assert.match(backup, /验证并创建手动备份/); assert.doesNotMatch(backup, /包含未删除媒体的原图/);
});
