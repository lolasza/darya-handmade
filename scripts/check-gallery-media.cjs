#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const media = require("../versionigor/assets/data/media.json");
const catalog = require("../versionigor/assets/data/catalog.json");
const source = require("../versionigor/assets/data/source-catalog.json");
const missing = [];
const knownPaths = new Set((media.files ?? []).map((file) => file.path));
for (const name of [
  "medasha.png",
  "logodasha.png",
  "signdasha.png",
  "favidasha.jpg",
  "manuscript.ttf",
])
  if (!knownPaths.has(media.byName?.[name])) missing.push(name);
for (const work of catalog.works) {
  const expected =
    source.products.find((product) => product.id === work.id)?.imageHashes
      .length ?? 1;
  const photos = media.products?.[work.id] ?? [];
  if (
    photos.length < expected ||
    photos.some((photo) => !knownPaths.has(photo))
  )
    missing.push(`photos:${work.id} (needs ${expected})`);
}
for (const file of media.files ?? []) {
  const target = path.resolve(root, "." + file.path);
  if (
    !target.startsWith(path.join(root, "versionigor/assets") + path.sep) ||
    !fs.existsSync(target)
  ) {
    missing.push(file.path);
    continue;
  }
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(target))
    .digest("hex");
  if (hash !== file.sha256) missing.push(`hash:${file.path}`);
}
if (media.status !== "imported")
  missing.unshift(`store-status:${media.status}`);
if (missing.length) {
  console.error(
    "Gallery media is not ready:\n" +
      missing.map((value) => "  " + value).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    `Verified ${media.files.length} Blob files and ${catalog.works.length} illustrated works.`,
  );
