import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import handler from "./api/service.mjs";
const root = path.resolve("public");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/service") {
      let body = "";
      for await (const b of req) {
        body += b;
        if (body.length > 64000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      req.body = body;
      req.query = Object.fromEntries(url.searchParams);
      res.status = (n) => {
        res.statusCode = n;
        return res;
      };
      res.json = (x) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(x));
      };
      return handler(req, res);
    }
    let name = path.resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!name.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const data = await fs.readFile(name);
      res.setHeader(
        "Content-Type",
        types[path.extname(name)] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 5179), "127.0.0.1", () =>
    console.log(
      "HP Studio mobile http://127.0.0.1:" + (process.env.PORT || 5179),
    ),
  );
