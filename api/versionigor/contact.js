"use strict";
const { createHash } = require("node:crypto");
const catalog = require("../../versionigor/assets/data/catalog.json");
const { getRates } = require("./rates");
const RECIPIENT = "daria.mucha@gmail.com";
const WINDOW = 15 * 60 * 1000;
const limits = new Map();
const requests = new Map();
const allowedMethods = new Set([
  "email",
  "whatsapp",
  "telegram",
  "instagram",
  "phone",
]);
const allowedTypes = new Set([
  "general",
  "purchase",
  "custom",
  "collaboration",
]);
const allowedLanguages = new Set(["ru", "en"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function isContact(method, value) {
  if (method === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  if (["phone", "whatsapp"].includes(method))
    return (
      /^\+?[\d\s().-]+$/.test(value) &&
      value.replace(/\D/g, "").length >= 7 &&
      value.replace(/\D/g, "").length <= 15
    );
  if (method === "telegram")
    return (
      /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value) ||
      /^https:\/\/(t\.me|telegram\.me)\/[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(
        value,
      )
    );
  if (method === "instagram")
    return (
      /^@?[a-zA-Z0-9_.]{1,30}$/.test(value) ||
      /^https:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]{1,30}\/?$/.test(value)
    );
  return false;
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (
      Buffer.byteLength(
        typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      ) > 16384
    )
      throw new Error("body_too_large");
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  let data = "",
    size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 16384) throw new Error("body_too_large");
    data += chunk;
  }
  return JSON.parse(data);
}

function prune() {
  const now = Date.now();
  for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
  for (const [key, value] of requests)
    if (!value.pending && value.until <= now) requests.delete(key);
  // Bound memory even when many distinct clients arrive at one warm instance.
  while (limits.size > 5000) limits.delete(limits.keys().next().value);
  while (requests.size > 1000) {
    const key = [...requests.keys()].find((k) => !requests.get(k).pending);
    if (!key) break;
    requests.delete(key);
  }
}

function limited(req) {
  const address = String(
    req.headers["x-vercel-forwarded-for"] ??
      req.headers["x-forwarded-for"] ??
      req.socket?.remoteAddress ??
      "unknown",
  )
    .split(",")[0]
    .trim();
  const key = hash(address);
  const now = Date.now();
  let value = limits.get(key);
  if (!value || value.until <= now) {
    value = { count: 0, until: now + WINDOW };
    limits.set(key, value);
  }
  value.count++;
  return value.count > 5;
}

function validate(body, req) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.website) return null;
  const fields = [
    "name",
    "contact",
    "wishes",
    "method",
    "type",
    "language",
    "sourceURL",
  ];
  if (fields.some((key) => typeof body[key] !== "string")) return null;
  const data = Object.fromEntries(fields.map((key) => [key, body[key].trim()]));
  if (
    !data.name ||
    data.name.length > 100 ||
    /[\r\n\x00-\x1f]/.test(data.name) ||
    data.wishes.length > 3000 ||
    data.contact.length > 254 ||
    /[\r\n\x00-\x1f]/.test(data.contact)
  )
    return null;
  if (
    !allowedMethods.has(data.method) ||
    !isContact(data.method, data.contact) ||
    !allowedTypes.has(data.type) ||
    !allowedLanguages.has(data.language)
  )
    return null;
  const work =
    body.workId == null
      ? null
      : catalog.works.find((w) => w.id === body.workId);
  if (body.workId != null && !work) return null;
  if (data.type === "purchase" && work?.status === "sold") return null;
  try {
    const url = new URL(data.sourceURL);
    const allowedHosts = new Set([
      "darya-handmade.vercel.app",
      req.headers.host,
    ]);
    if (
      !allowedHosts.has(url.host) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/versionigor/contact" ||
      data.sourceURL.length > 2000
    )
      return null;
    // Exclude arbitrary query strings from outbound mail; only useful gallery context is kept.
    const safeQuery = new URLSearchParams();
    for (const key of ["lang", "view", "series", "category", "type", "work"])
      if (url.searchParams.has(key))
        safeQuery.set(key, url.searchParams.get(key).slice(0, 80));
    data.sourceURL = `${url.origin}${url.pathname}?${safeQuery}`;
  } catch {
    return null;
  }
  return { ...data, work };
}

async function deliver(data, key) {
  let rates = null;
  try {
    rates = await getRates();
  } catch {
    /* Base RUB price remains authoritative. */
  }
  const work = data.work;
  const series = work ? catalog.series.find((s) => s.id === work.series) : null;
  const context = work
    ? [
        `Work ID: ${work.id}`,
        `Title: ${work.title[data.language]}`,
        `Series: ${series?.title[data.language] ?? ""}`,
        `Base price: ${work.price} RUB`,
        `Original source price: ${work.originalPrice} RUB`,
        rates
          ? `Approximate price: ${Math.round(work.price / rates.EUR)} EUR / ${Math.round(work.price / rates.USD)} USD; CBR rate date ${rates.date}${rates.stale ? " (last successful rate)" : ""}`
          : "Currency conversion unavailable; no estimate supplied.",
      ]
    : [];
  const text = [
    `Enquiry: ${data.type}`,
    `Name: ${data.name}`,
    `Contact method: ${data.method}`,
    `Contact: ${data.contact}`,
    `Language: ${data.language}`,
    `Source: ${data.sourceURL}`,
    ...context,
    "",
    data.wishes || "(No additional wishes)",
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM,
      to: [RECIPIENT],
      ...(data.method === "email" ? { reply_to: data.contact } : {}),
      subject: `Darya Mucha / ${data.type}${work ? ` / ${work.title[data.language]}` : ""}`,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  let receipt;
  try {
    receipt = await response.json();
  } catch {}
  if (!response.ok || typeof receipt?.id !== "string" || !receipt.id)
    throw new Error("provider_unavailable");
  return { accepted: true };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    return res.status(415).json({ error: "json_required" });
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host)
        return res.status(403).json({ error: "origin_not_allowed" });
    } catch {
      return res.status(403).json({ error: "origin_not_allowed" });
    }
  }
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[-a-zA-Z0-9_]{16,100}$/.test(key))
    return res.status(400).json({ error: "invalid_idempotency_key" });
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return res
      .status(error.message === "body_too_large" ? 413 : 400)
      .json({ error: "invalid_body" });
  }
  const data = validate(body, req);
  if (!data) return res.status(400).json({ error: "invalid_fields" });
  prune();
  const fingerprint = hash(JSON.stringify(data));
  const previous = requests.get(key);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      return res.status(409).json({ error: "idempotency_conflict" });
    try {
      return res.status(200).json(previous.result ?? (await previous.pending));
    } catch {
      return res.status(502).json({ error: "delivery_unavailable" });
    }
  }
  if (limited(req)) {
    res.setHeader("Retry-After", "900");
    return res.status(429).json({ error: "too_many_requests" });
  }
  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_FROM)
    return res.status(503).json({ error: "mail_not_configured" });
  const entry = {
    fingerprint,
    until: Date.now() + 24 * 60 * 60 * 1000,
    pending: null,
  };
  entry.pending = deliver(data, key);
  requests.set(key, entry);
  try {
    const result = await entry.pending;
    entry.result = result;
    entry.pending = null;
    return res.status(200).json(result);
  } catch {
    requests.delete(key);
    return res.status(502).json({ error: "delivery_unavailable" });
  }
};
module.exports.isContact = isContact;
