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

  const fixture = await client.json("/api/v1/admin/contents", "POST", { type: "ARTICLE", module: "KNOWLEDGE" }, 201, { "Idempotency-Key": crypto.randomUUID() });
  const contentId = fixture.value.data.state.id as string;
  const publicList = await (await fetch(base + "/api/v1/contents?type=ARTICLE&limit=1")).json();
  const publicPath = publicList.data[0]?.canonicalPath as string | undefined;
  const albums = await (await fetch(base + "/api/v1/contents?type=ALBUM&limit=1")).json();
  const albumPath = albums.data[0]?.canonicalPath as string | undefined;

  if (!publicPath || !albumPath) throw new Error("Browser checks require a published article and album. Seed the isolated environment first.");

  const pages = [
    { name: "home", url: "/", selector: '.hero' },
    { name: "life", url: "/life", selector: '.list-page .browse-filters' },
    { name: "knowledge", url: "/knowledge", selector: '.list-page .browse-filters' },
    { name: "albums", url: "/albums", selector: '.list-page .browse-filters' },
    { name: "search", url: "/search?q=" + encodeURIComponent("联调"), selector: '#browse-q' },
    ...(publicPath ? [{ name: "reading", url: publicPath, selector: '.reading-page .prose' }] : []),
    ...(albumPath ? [{ name: "album-detail", url: albumPath, selector: '.album-page .album-masonry' }] : []),
    { name: "admin-home", url: "/admin", selector: '.admin-grid' },
    { name: "admin-contents", url: "/admin/contents", selector: '.admin-filters' },
    ...(contentId ? [{ name: "admin-editor", url: `/admin/contents/${contentId}`, selector: '#content-title' }] : []),
    { name: "admin-media", url: "/admin/media", selector: '.admin-main input[type=file]' },
    { name: "admin-taxonomy", url: "/admin/taxonomy", selector: '.taxonomy-form' },
    { name: "admin-trash", url: "/admin/trash", selector: '.admin-filters' },
    { name: "admin-backups", url: "/admin/backups", selector: '.operation-grid' },
    { name: "admin-security", url: "/admin/security", selector: '.security-page' },
    { name: "admin-audit", url: "/admin/audit", selector: '#audit-action' },
  ];

  await mkdir(output, { recursive: true });
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 500, screenWidth: width, screenHeight: width < 500 ? 844 : 900 }, session);
    for (const page of pages) {
      const response = await client.raw(page.url, { redirect: "manual" });
      if (!response.ok) throw new Error('Page "' + page.name + '" returned HTTP ' + response.status);
      await navigate(base + page.url);
      const actualPath = await evaluate("location.pathname + location.search");
      if (actualPath !== page.url) throw new Error('Page "' + page.name + '" reached ' + actualPath);
      const rendered = await evaluate('!!document.querySelector(' + JSON.stringify(page.selector) + ')');
      if (!rendered) throw new Error('Page "' + page.name + '" did not render its expected content');
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
  await navigate(base + "/");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, session);
  const reducedMotion = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches &&
    getComputedStyle(document.documentElement).scrollBehavior === 'auto' &&
    parseFloat(getComputedStyle(document.querySelector('.desktop-nav a')).transitionDuration) < 0.01`);
  scenarios.push({ name: "reduced-motion", passed: !!reducedMotion, detail: "Chromium reduced-motion preference disables smooth scrolling and shortens transitions." });
  await send("Emulation.setEmulatedMedia", { features: [] }, session);

  for (const theme of ["light", "dark"]) {
    const ratios = await evaluate(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const css = getComputedStyle(document.documentElement);
      const luminance = name => {
        const channels = css.getPropertyValue(name).trim().slice(1).match(/../g);
        return channels.reduce((sum, hex, i) => {
          const value = parseInt(hex, 16) / 255;
          return sum + [0.2126, 0.7152, 0.0722][i] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        }, 0);
      };
      return ["--accent-text", "--ink-subtle"].map(text => {
        const [light, dark] = [luminance(text), luminance("--surface-muted")].sort((a, b) => b - a);
        return (light + 0.05) / (dark + 0.05);
      });
    })()`) as number[];
    scenarios.push({ name: `contrast-tokens-${theme}`, passed: ratios.every(ratio => ratio >= 4.5), detail: `Accent and secondary text against the muted surface: ${ratios.map(ratio => ratio.toFixed(2)).join(", ")}` });
  }

  await navigate(base + albumPath);
  await send("Page.bringToFront", {}, session);
  await evaluate(`document.querySelector('.image-button')?.focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }, session);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, session);
  await delay(200);
  const galleryOpened = await evaluate(`!!document.querySelector('.lightbox[open]')`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, session);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, session);
  await delay(200);
  const galleryFocus = await evaluate(`!document.querySelector('.lightbox[open]') && document.activeElement === document.querySelector('.image-button')`);
  scenarios.push({ name: "gallery-keyboard-focus", passed: !!galleryOpened && !!galleryFocus, detail: `openedByEnter=${galleryOpened} focusReturnedByEscape=${galleryFocus}` });

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
    const recoveryText = "back navigation " + Date.now();
    await setTitle(session, recoveryText);
    await evaluateIn(session, 'document.querySelector(\'.admin-sidebar a[href="/admin/contents"]\').click()');
    await delay(1000);
    const leftEditor = await evaluateIn(session, "location.pathname") === "/admin/contents";
    await evaluateIn(session, "history.back()");
    await delay(1000);
    const restoredTitle = await evaluateIn(session, "document.querySelector('#content-title')?.value");
    scenarios.push({ name: "back-navigation-recovers-draft", passed: leftEditor && restoredTitle === recoveryText, detail: "Checks the restored title after returning to the editor." });

    const failureFeedback = () => evaluateIn(session, `document.querySelector('[role="alert"]')?.textContent ?? ""`);
    const titleValue = () => evaluateIn(session, `document.querySelector('#content-title')?.value`);
    const waitForSave = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!await evaluateIn(session, `document.querySelector('#content-title')?.disabled`)) return;
        await delay(100);
      }
      throw new Error("Draft save did not finish");
    };

    const failureTitle = `network recovery ${Date.now()}`;
    await setTitle(session, failureTitle);
    const network = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    await send("Network.emulateNetworkConditions", { ...network, offline: true }, session);
    try {
      await clickSave(session);
      await waitForSave();
      const passed = String(await failureFeedback()).includes("网络已断开") && await titleValue() === failureTitle;
      scenarios.push({ name: "offline-save-preserves-input", passed, detail: "Offline save shows an error and retains the draft title." });
    } finally {
      await send("Network.emulateNetworkConditions", { ...network, offline: false }, session);
    }

    await evaluateIn(session, `(() => {
      const realFetch = window.fetch;
      window.fetch = (input, init) => {
        if (init?.method !== "PUT" || !String(input).endsWith("/draft")) return realFetch(input, init);
        window.fetch = realFetch;
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      };
    })()`);
    await clickSave(session);
    await waitForSave();
    scenarios.push({ name: "http-500-save-preserves-input", passed: String(await failureFeedback()).includes("服务暂时不可用") && await titleValue() === failureTitle, detail: "Injected HTTP 500 shows an error and retains the draft title." });

    await send("Network.emulateNetworkConditions", { offline: false, latency: 1300, downloadThroughput: 50_000, uploadThroughput: 25_000 }, session);
    try {
      await clickSave(session);
      await delay(200);
      const pending = await evaluateIn(session, `document.querySelector('.editor-status')?.textContent.includes('正在处理')`);
      await waitForSave();
      const saved = await evaluateIn(session, `document.body.innerText.includes('草稿已保存')`);
      scenarios.push({ name: "slow-network-retry-saves-draft", passed: !!pending && !!saved && await titleValue() === failureTitle, detail: "Throttled retry shows progress and then confirms the original draft was saved." });
    } finally {
      await send("Network.emulateNetworkConditions", { ...network, offline: false }, session);
    }

    const expiryText = `expiry ${Date.now()}`;
    await setTitle(session, expiryText); await delay(150);
    await db().adminUser.update({ where: { id: client.adminId }, data: { sessionVersion: { increment: 1 } } });
    await delay(150);
    await clickSave(session); await delay(900);
    const expiryBody = String(await evaluateIn(session, `document.body.innerText`));
    const expiryValue = await evaluateIn(session, `document.querySelector('#content-title').value`);
    const expired = expiryValue === expiryText && (expiryBody.includes("会话已失效") || expiryBody.includes("请重新登录") || expiryBody.includes("验证"));
    scenarios.push({ name: "session-expiry-keeps-input", passed: !!expired, detail: `inputPreserved=${expiryValue === expiryText} feedback=${expiryBody.includes("会话已失效") || expiryBody.includes("请重新登录") || expiryBody.includes("验证")}` });


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