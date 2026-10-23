"use strict";
let cached = null;
let refreshedAt = 0;
let pending = null;
const MAX_AGE = 6 * 60 * 60 * 1000;

function parseRates(xml) {
  const date = xml.match(/<ValCurs\b[^>]*Date="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!date) throw new Error("Invalid rate date");
  const result = {
    date: `${date[3]}-${date[2]}-${date[1]}`,
    source: "https://www.cbr.ru/scripts/XML_daily.asp",
  };
  for (const currency of ["EUR", "USD"]) {
    const entry = [
      ...xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g),
    ].find((match) =>
      match[1].includes(`<CharCode>${currency}</CharCode>`),
    )?.[1];
    const nominal = Number(
      entry?.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]?.replace(",", "."),
    );
    const value = Number(
      entry?.match(/<Value>([^<]+)<\/Value>/)?.[1]?.replace(",", "."),
    );
    if (
      !Number.isFinite(nominal) ||
      nominal <= 0 ||
      !Number.isFinite(value) ||
      value <= 0
    )
      throw new Error("Invalid rate");
    result[currency] = value / nominal;
  }
  return result;
}

async function getRates() {
  if (cached && Date.now() - refreshedAt < MAX_AGE)
    return { ...cached, stale: false };
  if (!pending)
    pending = (async () => {
      try {
        const response = await fetch(
          "https://www.cbr.ru/scripts/XML_daily.asp",
          { signal: AbortSignal.timeout(7000) },
        );
        if (!response.ok) throw new Error("Rate provider unavailable");
        cached = parseRates(await response.text());
        refreshedAt = Date.now();
        return { ...cached, stale: false };
      } catch (error) {
        if (cached) return { ...cached, stale: true };
        throw error;
      } finally {
        pending = null;
      }
    })();
  return pending;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const result = await getRates();
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res.status(200).json(result);
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "rates_unavailable" });
  }
};
module.exports.getRates = getRates;
module.exports.parseRates = parseRates;
