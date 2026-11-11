import { createServer } from "node:http";
createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const fields = Object.keys(data).sort().join(",");
    if (request.method !== "POST" || request.url !== "/summary" || fields !== "language,markdown,maxCharacters,title") {
      response.writeHead(422).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ summary: "隔离测试摘要建议" }));
  } catch { response.writeHead(422).end(); }
}).listen(3011, "127.0.0.1", () => console.log("Local summary test adapter ready"));
