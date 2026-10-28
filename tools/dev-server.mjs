// Local stand-in for `vercel dev`: serves the static files and routes POST /api/ask to the real handler.
// Reads keys from .env.local. Usage: npm run dev  (then open http://localhost:3000)
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(join(ROOT, ".env.local")); } catch { console.warn("No .env.local found: chat will say it isn't configured."); }
const { default: handler } = await import(join(ROOT, "api/ask.js"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".zip": "application/zip", ".csv": "text/csv", ".md": "text/markdown" };

http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/api/ask") {
    let raw = ""; for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : null; } catch { req.body = null; }
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  const file = resolve(ROOT, "." + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile() || file.includes("/.")) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("content-type", types[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
}).listen(process.env.PORT || 3000, () => console.log(`Ask the Brain running at http://localhost:${process.env.PORT || 3000}`));
