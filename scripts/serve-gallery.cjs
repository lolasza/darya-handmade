#!/usr/bin/env node
"use strict";
// Local static + Vercel-function adapter. No production dependency or build step.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] ?? 8002);
const handlers = {
  "/versionigor/api/contact": require("../api/versionigor/contact"),
  "/versionigor/api/rates": require("../api/versionigor/rates"),
};
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const workMatch = url.pathname.match(/^\/versionigor\/work\/([^/]+)\/?$/);
      if (workMatch) {
        req.query = {
          slug: decodeURIComponent(workMatch[1]),
          lang: url.searchParams.get("lang"),
        };
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        require("../api/versionigor/work")(req, res);
        return;
      }
      if (handlers[url.pathname]) {
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (value) => res.end(JSON.stringify(value));
        await handlers[url.pathname](req, res);
        return;
      }
      let pathname = decodeURIComponent(url.pathname);
      if (/^\/versionigor(?:\/?|\/contact\/?|\/work\/[^/]+\/?)$/.test(pathname))
        pathname = "/versionigor/index.html";
      else if (pathname === "/") pathname = "/index.html";
      const file = path.resolve(root, "." + pathname);
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const payload = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(payload);
    } catch (error) {
      res.writeHead(
        error.code === "ENOENT" || error.code === "EISDIR" ? 404 : 500,
      );
      res.end("Not available");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Gallery development server: 127.0.0.1:${port}`),
  );
