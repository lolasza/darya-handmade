"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const origin = process.env.GALLERY_TEST_ORIGIN ?? "http://127.0.0.1:8002";
const screenshots =
  process.env.GALLERY_SCREENSHOTS ?? "/tmp/darya-versionigor-screenshots";
const base = "/versionigor";
const waitFor = async (page, fn) => page.waitForFunction(fn);

(async () => {
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const summary = [];
  try {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const touch = width < 768;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        isMobile: touch,
        hasTouch: touch,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Deliberately mocked, never represented as a live rate/provider test.
      await page.route("**/versionigor/api/rates", (route) =>
        route.fulfill({
          json: {
            EUR: 100,
            USD: 90,
            date: "2026-10-23",
            source: "test-fixture",
          },
        }),
      );
      await page.goto(origin + base);
      await page.waitForSelector(".work-card");
      await waitFor(page, () => document.querySelector(".approx-price"));
      assert.equal(await page.locator(".work-card").count(), 14);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow ${width}`,
      );
      assert.equal(
        await page.locator("meta[name=robots]").getAttribute("content"),
        "noindex, follow",
      );
      await page.screenshot({
        path: path.join(screenshots, `hero-${width}.png`),
      });
      await page
        .locator("#works")
        .evaluate((node) =>
          node.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      await page.screenshot({
        path: path.join(screenshots, `gallery-${width}.png`),
      });
      await page.selectOption("#view-filter", "series");
      await page.selectOption("#secondary-filter", "monarchs");
      assert.equal(await page.locator(".work-card").count(), 4);
      assert.match(page.url(), /series=monarchs/);
      await page.reload();
      await page.waitForSelector(".work-card");
      assert.equal(await page.locator(".work-card").count(), 4);
      await page.click("#reset-filter");
      assert.equal(await page.locator(".work-card").count(), 14);
      await page.selectOption("#view-filter", "category");
      await page.selectOption("#secondary-filter", "toon-art");
      assert.equal(await page.locator(".work-card").count(), 0);
      assert.ok(await page.locator(".gallery-empty").isVisible());
      await page.selectOption("#secondary-filter", "paintings");
      assert.equal(await page.locator(".work-card").count(), 8);
      const first = page.locator("#card-k4 .work-open");
      await first.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY);
      if (touch) {
        await first.tap();
        assert.ok(
          await page
            .locator("#card-k4")
            .evaluate((el) => el.classList.contains("is-revealed")),
        );
        assert.equal(
          await page.locator("#work-overlay").getAttribute("open"),
          null,
        );
        await first.tap();
      } else {
        await first.hover();
        assert.equal(
          await page
            .locator("#card-k4 .work-veil")
            .evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        await first.click();
      }
      await page.waitForSelector("#work-overlay[open]");
      assert.match(page.url(), /work\/hare-and-oni/);
      await page.locator("#work-overlay [data-lang=en]").click();
      assert.equal(
        await page.locator("#work-title").textContent(),
        "The Hare and the Oni",
      );
      assert.match(page.url(), /category=paintings/);
      await page.locator("#work-overlay [data-lang=ru]").click();
      await page.screenshot({
        path: path.join(screenshots, `work-${width}.png`),
      });
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector("#work-overlay").scrollWidth <= innerWidth,
        ),
        `work overflow ${width}`,
      );
      await page.keyboard.press("Escape");
      await page.waitForSelector("#work-overlay[open]", { state: "hidden" });
      await waitFor(
        page,
        () => document.activeElement?.closest("#card-k4") !== null,
      );
      assert.ok(
        Math.abs((await page.evaluate(() => scrollY)) - before) < 5,
        `scroll restored ${width}`,
      );
      await page.goForward();
      await page.waitForSelector("#work-overlay[open]");
      await page.locator("#work-overlay [data-contact=purchase]").click();
      await page.waitForSelector("#contact-overlay[open]");
      assert.match(await page.locator("#selected-work").textContent(), /Заяц/);
      await page.screenshot({
        path: path.join(screenshots, `contact-${width}.png`),
      });
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector("#contact-overlay").scrollWidth <=
            innerWidth,
        ),
        `contact overflow ${width}`,
      );
      await page.locator(".submit-button").click();
      assert.equal(
        await page.locator("#contact-name").getAttribute("aria-invalid"),
        "true",
      );
      await page.fill("#contact-name", "Анна");
      await page.selectOption("#contact-method", "telegram");
      await page.fill("#contact-value", "@test_visitor");
      await page.fill("#contact-wishes", "Сохраните мой текст");
      await page.route("**/versionigor/api/contact", (route) =>
        route.fulfill({ status: 503, json: { error: "mail_not_configured" } }),
      );
      await page.locator(".submit-button").click();
      await page.waitForSelector("#form-status.is-error");
      assert.equal(
        await page.inputValue("#contact-wishes"),
        "Сохраните мой текст",
      );
      await page.locator("#contact-overlay [data-lang=en]").click();
      assert.match(
        await page.locator("#form-status").textContent(),
        /could not be sent/,
      );
      assert.equal(
        await page.inputValue("#contact-wishes"),
        "Сохраните мой текст",
      );
      await page.locator("#contact-overlay [data-lang=ru]").click();
      assert.equal(
        await page.locator("#contact-value").getAttribute("aria-invalid"),
        "false",
      );
      await page.unroute("**/versionigor/api/contact");
      let calls = 0;
      await page.route("**/versionigor/api/contact", async (route) => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({ json: { accepted: true } });
      });
      await page.locator(".submit-button").click();
      assert.ok(await page.locator(".submit-button").isDisabled());
      await waitFor(page, () =>
        document
          .querySelector("#form-status")
          .textContent.includes("Почтовый сервис"),
      );
      assert.equal(calls, 1);
      await page.keyboard.press("Escape");
      await page.waitForSelector("#work-overlay[open]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#work-overlay[open]", { state: "hidden" });
      if (touch) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.click(".menu-toggle");
        assert.equal(
          await page.locator(".menu-toggle").getAttribute("aria-expanded"),
          "true",
        );
      }
      await page.locator("#navigation [data-lang=en]").click();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.match(page.url(), /category=paintings/);
      assert.doesNotMatch(
        await page.locator(".work-caption").first().textContent(),
        /RUB|USD/,
      );
      assert.match(
        await page.locator(".work-caption").first().textContent(),
        /EUR/,
      );
      if (touch) await page.click(".menu-toggle");
      await page.goto(
        origin + base + "/work/hare-and-oni?lang=en&view=series&series=japan",
      );
      await page.waitForSelector("#work-overlay[open]");
      await page.reload();
      await page.waitForSelector("#work-overlay[open]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#work-overlay[open]", { state: "hidden" });
      assert.match(page.url(), /view=series/);
      await page.evaluate(() => scrollTo(0, 200));
      assert.equal(
        await page
          .locator(".hero-portrait")
          .evaluate((el) => getComputedStyle(el).transform),
        "none",
      );
      assert.deepEqual(errors, []);
      summary.push({
        width,
        catalog: true,
        filters: true,
        routes: true,
        formMock: true,
        keyboard: true,
        overflow: false,
      });
      await context.close();
    }
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.route("**/versionigor/api/rates", (route) =>
      route.fulfill({ status: 503, json: { error: "rates_unavailable" } }),
    );
    await page.goto(origin + base + "?lang=en");
    await page.waitForSelector(".work-card");
    assert.match(
      await page.locator(".work-caption").first().textContent(),
      /Request a price/,
    );
    assert.equal(await page.locator(".approx-price").count(), 0);
    // Keyboard Enter opens directly without requiring a pointer hover/tap.
    const link = page.locator("#card-k4 .work-open");
    await link.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#work-overlay[open]");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#work-overlay[open]", { state: "hidden" });
    assert.ok(await link.evaluate((el) => el === document.activeElement));
    await context.close();
    await fs.writeFile(
      path.join(screenshots, "results.json"),
      JSON.stringify(
        {
          summary,
          limitations: [
            "No Blob media available: screenshots show honest missing-image states.",
            "Rates and mail responses are browser fixtures; no real email was sent.",
          ],
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: summary, screenshots }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
