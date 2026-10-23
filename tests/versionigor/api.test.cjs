"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const catalog = require("../../versionigor/assets/data/catalog.json");
const root = path.resolve(__dirname, "../..");
test("direct work page has server-rendered localized title, canonical, noindex and a real 404", () => {
  const handler = require("../../api/versionigor/work");
  const invoke = (slug) => {
    const result = { headers: {} };
    const res = {
      setHeader: (key, value) => (result.headers[key] = value),
      status: (code) => {
        result.status = code;
        return res;
      },
      end: (value) => (result.html = value),
    };
    handler(
      {
        method: "GET",
        url: `/versionigor/work/${slug}?lang=en`,
        query: { slug, lang: "en" },
      },
      res,
    );
    return result;
  };
  const page = invoke("hare-and-oni");
  assert.equal(page.status, 200);
  assert.match(page.html, /<title>The Hare and the Oni/);
  assert.match(
    page.html,
    /href="https:\/\/darya-handmade.vercel.app\/versionigor\/work\/hare-and-oni"/,
  );
  assert.equal(page.headers["X-Robots-Tag"], "noindex, follow");
  assert.equal(invoke("unknown-work").status, 404);
});
const sampleRates = {
  EUR: 100,
  USD: 90,
  date: "2026-10-23",
  source: "https://www.cbr.ru/scripts/XML_daily.asp",
};

function contactHarness({
  configured = true,
  fetcher = async () => ({
    ok: true,
    json: async () => ({ id: "test-provider-receipt" }),
  }),
} = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "api/versionigor/contact.js"), "utf8"),
    {
      module,
      require: (name) =>
        name === "./rates"
          ? { getRates: async () => sampleRates }
          : name.includes("catalog.json")
            ? catalog
            : require(name),
      process: {
        env: configured
          ? {
              RESEND_API_KEY: "test-only-not-a-real-key",
              CONTACT_FROM: "Gallery <gallery@example.test>",
            }
          : {},
      },
      fetch: fetcher,
      URL,
      URLSearchParams,
      Buffer,
      AbortSignal,
      Date,
    },
  );
  return module.exports;
}
const body = (overrides = {}) => ({
  name: "Test visitor",
  method: "telegram",
  contact: "@test_visitor",
  wishes: "A quiet little world",
  type: "purchase",
  workId: "k4",
  language: "ru",
  sourceURL:
    "https://darya-handmade.vercel.app/versionigor/contact?type=purchase&work=k4",
  website: "",
  ...overrides,
});
async function invoke(
  handler,
  data = body(),
  {
    key = "test-idempotency-key-001",
    ip = "127.0.0.1",
    method = "POST",
    headers = {},
  } = {},
) {
  const req = {
    method,
    body: data,
    headers: {
      host: "darya-handmade.vercel.app",
      "content-type": "application/json",
      "idempotency-key": key,
      "x-forwarded-for": ip,
      ...headers,
    },
  };
  const result = { status: 200, headers: {} };
  const res = {
    setHeader: (k, v) => (result.headers[k] = v),
    status: (code) => {
      result.status = code;
      return res;
    },
    json: (value) => {
      result.body = value;
      return res;
    },
  };
  await handler(req, res);
  return result;
}

test("Telegram enquiry needs no email; context and fixed recipient come from server data", async () => {
  let sent;
  const handler = contactHarness({
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      sent = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: "receipt" }) };
    },
  });
  const response = await invoke(handler);
  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, true);
  assert.deepEqual(sent.to, ["daria.mucha@gmail.com"]);
  assert.equal(sent.reply_to, undefined);
  assert.match(sent.text, /Base price: 24900 RUB/);
  assert.match(sent.text, /CBR rate date 2026-10-23/);
  assert.match(sent.text, /Work ID: k4/);
});
test("missing mail configuration returns 503 without a fake success", async () => {
  const response = await invoke(contactHarness({ configured: false }));
  assert.equal(response.status, 503);
  assert.equal(response.body.accepted, undefined);
});
test("bad contact, unknown work, bot, oversize and cross-origin requests are rejected before delivery", async () => {
  let calls = 0;
  const handler = contactHarness({
    fetcher: async () => {
      calls++;
      throw new Error("must not send");
    },
  });
  for (const values of [
    { contact: "bad" },
    { workId: "made-up" },
    { website: "bot.example" },
    { name: "x\nHeader: injection" },
    { type: "made-up" },
    { method: "email", contact: "not-an-email" },
  ])
    assert.equal((await invoke(handler, body(values))).status, 400);
  assert.equal(
    (await invoke(handler, body({ wishes: "x".repeat(18000) }))).status,
    413,
  );
  assert.equal(
    (
      await invoke(handler, body(), {
        headers: { origin: "https://unrelated.example" },
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("a repeated or simultaneous click causes one provider call and body reuse is checked", async () => {
  let calls = 0;
  let finish;
  const delivered = new Promise((resolve) => (finish = resolve));
  const handler = contactHarness({
    fetcher: async () => {
      calls++;
      await delivered;
      return { ok: true, json: async () => ({ id: "receipt" }) };
    },
  });
  const first = invoke(handler),
    second = invoke(handler);
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await invoke(handler)).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (await invoke(handler, body({ wishes: "Changed text" }))).status,
    409,
  );
});
test("provider rejection never shows success and may be retried with the same key", async () => {
  let calls = 0;
  const handler = contactHarness({
    fetcher: async () => {
      calls++;
      return calls === 1
        ? { ok: false, json: async () => ({ error: "unavailable" }) }
        : { ok: true, json: async () => ({ id: "receipt" }) };
    },
  });
  assert.equal((await invoke(handler)).status, 502);
  assert.equal((await invoke(handler)).status, 200);
  assert.equal(calls, 2);
});
test("provider HTTP 200 without a receipt is an error", async () => {
  const response = await invoke(
    contactHarness({
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
    }),
  );
  assert.equal(response.status, 502);
});
test("rate limiting rejects the sixth new enquiry per warm instance", async () => {
  const handler = contactHarness();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await invoke(handler, body(), { key: `rate-test-unique-key-${i}` }))
        .status,
      200,
    );
  const blocked = await invoke(handler, body(), {
    key: "rate-test-unique-key-sixth",
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["Retry-After"], "900");
});
test("all contact methods validate their own format", () => {
  const { isContact } = contactHarness();
  for (const [method, value] of [
    ["email", "person@example.test"],
    ["phone", "+7 (999) 123-45-67"],
    ["whatsapp", "+447700900123"],
    ["telegram", "https://t.me/test_person"],
    ["instagram", "@art.person"],
  ])
    assert.equal(isContact(method, value), true);
  for (const [method, value] of [
    ["email", "@test_person"],
    ["phone", "phone me"],
    ["telegram", "https://other.example/user"],
    ["instagram", "@contains space"],
  ])
    assert.equal(isContact(method, value), false);
});
test("CBR parser handles nominal units, real dates and rejects missing rates", () => {
  const { parseRates } = require("../../api/versionigor/rates");
  const xml =
    '<ValCurs Date="23.10.2026"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>91,2500</Value></Valute><Valute><CharCode>EUR</CharCode><Nominal>10</Nominal><Value>1001,5000</Value></Valute></ValCurs>';
  assert.deepEqual(parseRates(xml), {
    date: "2026-10-23",
    source: "https://www.cbr.ru/scripts/XML_daily.asp",
    EUR: 100.15,
    USD: 91.25,
  });
  assert.throws(() => parseRates(xml.replace("EUR", "AAA")));
});
test("catalog retains original data, editorial IDs, populated series and honest unknown fields", () => {
  const source = require("../../versionigor/assets/data/source-catalog.json");
  assert.equal(catalog.works.length, 14);
  assert.equal(new Set(catalog.works.map((w) => w.slug)).size, 14);
  for (const work of catalog.works) {
    const original = source.products.find((w) => w.id === work.id);
    assert.equal(work.originalPrice, original.price);
    assert.equal(
      work.price,
      original.price >= 1000 && original.price % 1000 === 0
        ? original.price - 100
        : original.price,
    );
    assert.equal(work.year, null);
    for (const language of ["ru", "en"]) {
      const count = work.story[language].split(/\s+/).filter(Boolean).length;
      assert.ok(
        count >= 60 && count <= 110,
        `${work.id} ${language}: ${count} story words`,
      );
      const line = work.line[language].split(/\s+/).filter(Boolean).length;
      assert.ok(
        line >= 12 && line <= 25,
        `${work.id} ${language}: ${line} line words`,
      );
      assert.equal(work.keywords[language].length, 3);
    }
  }
  for (const series of catalog.series)
    assert.ok(catalog.works.some((w) => w.series === series.id));
  assert.notEqual(catalog.works.find((w) => w.id === "k1").series, "japan");
});
