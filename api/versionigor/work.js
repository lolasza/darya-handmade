"use strict";
// Render the shared page shell with work metadata for direct links/social crawlers.
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../../versionigor/assets/data/catalog.json");
const media = require("../../versionigor/assets/data/media.json");
const site = require("../../versionigor/assets/data/site.json");
const template = fs.readFileSync(
  path.join(__dirname, "../../versionigor/index.html"),
  "utf8",
);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

module.exports = function handler(req, res) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  const query = new URL(req.url, site.canonicalOrigin).searchParams;
  const slug = req.query?.slug ?? query.get("slug");
  const language =
    (req.query?.lang ?? query.get("lang")) === "en" ? "en" : "ru";
  const work = catalog.works.find((item) => item.slug === slug);
  const title = work
    ? `${work.title[language]}\u00a0— Darya Mucha`
    : language === "ru"
      ? "Работа не найдена — Darya Mucha"
      : "Work not found — Darya Mucha";
  const description = work?.line[language] ?? "Darya Mucha";
  const canonical = `${site.canonicalOrigin}/versionigor${work ? `/work/${work.slug}` : ""}`;
  const robots = site.noindex || !work ? "noindex, follow" : "index, follow";
  let html = template
    .replace(/<html lang="[^"]*"/, `<html lang="${language}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      (_, a, b) => a + escape(description) + b,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      (_, a, b) => a + escape(title) + b,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      (_, a, b) => a + escape(description) + b,
    )
    .replace(
      /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
      (_, a, b) => a + escape(canonical) + b,
    )
    .replace(
      /(<meta\s+name="robots"\s+content=")[^"]*(")/,
      (_, a, b) => a + robots + b,
    );
  const picture = work && media.products?.[work.id]?.[0];
  const socialMeta = `<meta property="og:url" content="${escape(canonical)}">${typeof picture === "string" && picture.startsWith("/versionigor/assets/media/") && !picture.includes("..") ? `<meta property="og:image" content="${escape(site.canonicalOrigin + picture)}">` : ""}`;
  html = html.replace("</head>", socialMeta + "</head>");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", robots);
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=3600",
  );
  res.status(work ? 200 : 404);
  return res.end(req.method === "HEAD" ? undefined : html);
};
