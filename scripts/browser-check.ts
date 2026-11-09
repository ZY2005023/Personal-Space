import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { AuthClient, base } from "../integration/http-client";
import { db } from "../src/lib/db";

loadEnvConfig(process.cwd());
if (process.env.PERSONAL_SPACE_INTEGRATION !== "true") throw new Error("Isolated integration environment required");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = Number(process.env.CHROME_DEBUG_PORT || 9223);
const profile = path.join(process.cwd(), "work", "integration", "chrome-profile");
const output = path.join(process.cwd(), "work", "integration", "browser");
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Result = { name: string; width: number; path: string; title: string; overflow: number; undersized: { tag: string; text: string; w: number; h: number }[]; controls: number };
const results: Result[] = [];

async function main() {
const browser = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--remote-allow-origins=*", "about:blank"], { windowsHide: true, stdio: "ignore" });
let ws: WebSocket | undefined;
try {
  let version: { webSocketDebuggerUrl?: string } | null = null;
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl?: string }; } catch { /* retry while Chrome starts */ }
    if (version?.webSocketDebuggerUrl) break;
    await delay(100);
  }
  const socketUrl = version?.webSocketDebuggerUrl;
  if (!socketUrl) throw new Error("Headless Chrome did not start");
  ws = new WebSocket(socketUrl);
  await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(new Error("CDP socket failed")); });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || "CDP command failed"));
    else waiter.resolve(message.result);
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await send("Target.createTarget", { url: "about:blank" });
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const session = attached.sessionId as string;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
  await send("Network.enable", {}, session);

  await db().loginThrottle.updateMany({ data: { attempts: 0, windowStart: new Date(Date.now() - 16 * 60000) } });
  const client = new AuthClient(); await client.login();
  const cookies = (client as unknown as { cookies: Map<string, string> }).cookies;
  for (const [name, value] of cookies) await send("Network.setCookie", { name, value, url: base, path: "/", httpOnly: true }, session);

  const evaluateIn = async (sessionId: string, expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const evaluate = async (expression: string) => evaluateIn(session, expression);
  const navigateIn = async (sessionId: string, url: string) => { await send("Page.navigate", { url }, sessionId); await delay(1200); };
  const navigate = async (url: string) => navigateIn(session, url);

  const list = await client.json("/api/v1/admin/contents?limit=1");
  const contentId = list.value.data[0]?.state.id as string | undefined;
  if (!contentId) throw new Error("No existing content found; browser check requires at least one content item to test the editor. Run integration tests first to seed data.");
  // Snapshot the existing draft so editor scenarios can restore it instead of leaving a test title behind.
  const draftSnapshot = await client.json(`/api/v1/admin/contents/${contentId}/draft`);
  const originalTitle = draftSnapshot.value.payload.title as string;
  const originalBody = draftSnapshot.value.payload.bodyMarkdown as string;
  const originalEtag = draftSnapshot.etag as string;
  const publicList = await (await fetch(base + "/api/v1/contents?limit=1")).json();
  const publicPath = publicList.data[0]?.canonicalPath as string | undefined;
  const albums = await (await fetch(base + "/api/v1/contents?type=ALBUM&limit=1")).json();
  const albumPath = albums.data[0]?.canonicalPath as string | undefined;

  const pages = [
    { name: "home", url: "/" },
    { name: "life", url: "/life" },
    { name: "knowledge", url: "/knowledge" },
    { name: "albums", url: "/albums" },
    { name: "search", url: "/search?q=" + encodeURIComponent("联调") },
    ...(publicPath ? [{ name: "reading", url: publicPath }] : []),
    ...(albumPath ? [{ name: "album-detail", url: albumPath }] : []),
    { name: "admin-home", url: "/admin" },
    { name: "admin-contents", url: "/admin/contents" },
    ...(contentId ? [{ name: "admin-editor", url: `/admin/contents/${contentId}` }] : []),
    { name: "admin-media", url: "/admin/media" },
    { name: "admin-taxonomy", url: "/admin/taxonomy" },
    { name: "admin-trash", url: "/admin/trash" },
    { name: "admin-backups", url: "/admin/backups" },
    { name: "admin-security", url: "/admin/security" },
    { name: "admin-audit", url: "/admin/audit" },
  ];

  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 500, screenWidth: width, screenHeight: width === 390 ? 844 : 900 }, session);
    for (const page of pages) {
      await navigate(base + page.url);
      const actualPath = await evaluate(`location.pathname + location.search`);
      // Detect error pages: login redirect or Next.js error boundary (h2 containing error text).
      if (actualPath.startsWith("/login")) throw new Error(`Page "${page.name}" redirected to login; session may have expired`);
      const errorHeading = await evaluate(`document.querySelector('h2')?.textContent?.trim() ?? ""`);
      if (/出错了|Something went wrong|500|Application error/i.test(String(errorHeading))) throw new Error(`Page "${page.name}" rendered an error page: "${errorHeading}"`);
      const metrics = await evaluate(`(() => {
        const width = document.documentElement.clientWidth;
        const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width;
        const nodes = [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=radio]), select, textarea, summary, .button, .admin-links a, .desktop-nav a, .mobile-nav nav a')];
        const visible = nodes.filter(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; });
        const undersized = visible.filter(node => { const rect = node.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map(node => { const rect = node.getBoundingClientRect(); return { tag: node.tagName, text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 40), w: Math.round(rect.width), h: Math.round(rect.height) }; });
        return { path: location.pathname + location.search, title: document.title, overflow, undersized: undersized.slice(0, 20), controls: visible.length };
      })()`);
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, session);
      await writeFile(path.join(output, `${page.name}-${width}.png`), Buffer.from(shot.data, "base64"));
      results.push({ name: page.name, width, ...metrics });
    }
  }
  const adminResult = results.find(result => result.name === "admin-home" && result.width === 1440);
  const authenticated = !!adminResult && !adminResult.path.startsWith("/login");
  const failed = results.filter(result => result.overflow > 1 || result.undersized.length > 0);

  const scenarios: { name: string; passed: boolean; detail: string }[] = [];
  if (contentId) {
    const editorUrl = `${base}/admin/contents/${contentId}`;
    const targetB = await send("Target.createTarget", { url: "about:blank" });
    const attachedB = await send("Target.attachToTarget", { targetId: targetB.targetId, flatten: true });
    const sessionB = attachedB.sessionId as string;
    await send("Page.enable", {}, sessionB); await send("Runtime.enable", {}, sessionB);
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionB);
    await navigateIn(session, editorUrl); await navigateIn(sessionB, editorUrl);
    const setTitle = async (sessionId: string, value: string) => {
      let next = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        await send("Page.bringToFront", {}, sessionId);
        await evaluateIn(sessionId, `(() => { const element = document.querySelector('#content-title'); element.focus(); element.select(); return true; })()`);
        await send("Input.insertText", { text: value }, sessionId);
        await delay(200);
        next = await evaluateIn(sessionId, `document.querySelector('#content-title').value`);
        if (next === value) break;
      }
      return next;
    };
    const clickSave = (sessionId: string) => evaluateIn(sessionId, `[...document.querySelectorAll('button')].find(button => button.textContent.includes('保存草稿'))?.click() ?? false`);
    const tabA = `tab A ${Date.now()}`;
    await setTitle(session, tabA); await delay(150); await clickSave(session); await delay(1000);
    const savedA = await evaluateIn(session, `document.body.innerText.includes('草稿已保存')`);
    const tabB = `tab B ${Date.now()}`;
    await setTitle(sessionB, tabB); await delay(150); await clickSave(sessionB); await delay(1000);
    const bodyB = await evaluateIn(sessionB, `document.body.innerText`);
    const valueB = await evaluateIn(sessionB, `document.querySelector('#content-title').value`);
    const conflict = savedA && String(bodyB).includes("内容已在另一处更新") && valueB === tabB;
    scenarios.push({ name: "two-tab-draft-conflict", passed: !!conflict, detail: `savedA=${savedA} conflict=${String(bodyB).includes("内容已在另一处更新")} inputPreserved=${valueB === tabB}` });
    await send("Target.closeTarget", { targetId: targetB.targetId });

    await navigateIn(session, editorUrl);
    const expiryText = `expiry ${Date.now()}`;
    await setTitle(session, expiryText); await delay(150);
    await db().adminUser.update({ where: { id: client.adminId }, data: { sessionVersion: { increment: 1 } } });
    await delay(150);
    await clickSave(session); await delay(900);
    const expiryBody = String(await evaluateIn(session, `document.body.innerText`));
    const expiryValue = await evaluateIn(session, `document.querySelector('#content-title').value`);
    const expired = expiryValue === expiryText && (expiryBody.includes("会话已失效") || expiryBody.includes("请重新登录") || expiryBody.includes("验证"));
    scenarios.push({ name: "session-expiry-keeps-input", passed: !!expired, detail: `inputPreserved=${expiryValue === expiryText} feedback=${expiryBody.includes("会话已失效") || expiryBody.includes("请重新登录") || expiryBody.includes("验证")}` });

    // Restore the draft to its original state so the check does not leave test titles behind.
    await client.login();
    const currentDraft = await client.json(`/api/v1/admin/contents/${contentId}/draft`);
    await client.json(`/api/v1/admin/contents/${contentId}/draft`, "PUT",
      { ...currentDraft.value.payload, title: originalTitle, bodyMarkdown: originalBody },
      200, { "If-Match": currentDraft.etag ?? originalEtag });
  }

  const failedScenarios = scenarios.filter(scenario => !scenario.passed);
  const report = { passed: authenticated && failed.length === 0 && failedScenarios.length === 0, authenticated, results, failed: failed.map(result => ({ name: result.name, width: result.width, overflow: result.overflow, undersized: result.undersized })), scenarios, completedAt: new Date().toISOString() };
  await writeFile(path.join(output, "browser.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, authenticated, pages: results.length, failed: report.failed, scenarios, screenshots: output }, null, 2));
  if (!report.passed) process.exitCode = 1;
  await send("Target.closeTarget", { targetId: target.targetId });
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  browser.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await db().$disconnect();
}
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "browser check failed"); process.exitCode = 1; });