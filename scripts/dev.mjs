// Servidor local de desenvolvimento: arquivos estáticos + API sobre um Postgres local.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import pg from "pg";
import { handle } from "../lib/api.mjs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
http.createServer(async (rq, rs) => {
  try {
    if (rq.url.startsWith("/api/")) {
      const chunks = []; for await (const c of rq) chunks.push(c);
      const req = new Request("http://" + rq.headers.host + rq.url, { method: rq.method, headers: rq.headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : Buffer.concat(chunks) });
      const r = await handle(req, pool);
      const hd = Object.fromEntries(r.headers); if (hd["set-cookie"]) hd["set-cookie"] = hd["set-cookie"].replace("; Secure", "");
      rs.writeHead(r.status, hd); rs.end(await r.text()); return;
    }
    const p = normalize(rq.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
    const f = join(new URL("../public", import.meta.url).pathname, p === "/" ? "index.html" : p);
    rs.writeHead(200, { "content-type": tipos[extname(f)] || "application/octet-stream" }); rs.end(await readFile(f));
  } catch (e) { if (e.code !== "ENOENT") console.error(e); rs.writeHead(e.code === "ENOENT" ? 404 : 500); rs.end("erro"); }
}).listen(8787, () => console.log("http://localhost:8787"));
