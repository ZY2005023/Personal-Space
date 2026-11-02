import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, headings } from "../src/components/markdown";
test("Markdown never renders raw scripts, event handlers, dangerous URLs or untrusted remote images", () => {
  const html = renderToStaticMarkup(<Markdown body={'<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[bad](javascript:alert(3))\n\n![remote](https://tracker.example/pixel.png)'}/>);
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:|<img|src="https:/); assert.match(html, /remote/);
});
test("reading headings ignore fenced code blocks and assign stable duplicate anchors", () => {
  const body = "## 标题\n\n```md\n## 代码\n```\n\n## 标题";
  assert.deepEqual(headings(body).map(h => h.id), ["section-标题", "section-标题-1"]);
  const html = renderToStaticMarkup(<Markdown body={body}/>); assert.match(html, /id="section-标题"/); assert.match(html, /id="section-标题-1"/);
});
