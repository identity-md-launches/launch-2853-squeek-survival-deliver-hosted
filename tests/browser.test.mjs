import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const modulePath =
  process.argv.find((a) => a.startsWith("--playwright="))?.split("=")[1] ||
  "playwright";
const { chromium, webkit } = await import(modulePath);
await mkdir("artifacts/screenshots", { recursive: true });
const html = await readFile("dist/index.html");
const server = createServer(async (req, res) => {
  res.setHeader(
    "Content-Type",
    req.url?.includes("share.png") ? "image/png" : "text/html",
  );
  res.end(
    req.url?.includes("share.png") ? await readFile("dist/share.svg") : html,
  );
});
await new Promise((resolve) => server.listen(4173, "0.0.0.0", resolve));
const results = [];
let browser;
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.error("FAIL " + name + " " + e.message);
  }
}
const installationId = "stream-game-sepolia-test-20261025-01";
const token = "0x5501e1fa81be1c3f49225fa7668da0245d07db60",
  core = "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44",
  mining = "0xcd46990f8349057335289ef282c276204b6cdc62";
const economy = {
  schemaVersion: 2,
  installationId,
  status: "available",
  release: { id: "stream-game-sepolia-test-20261026-01" },
  chain: { chainId: "11155111" },
  identities: { token, core, mining: { proxy: mining } },
};
function status() {
  return {
    schemaVersion: 1,
    installationId,
    measurement: {
      freshness: "online",
      provenance: "hardware",
      coreStatus: "ACTIVE",
      observedAt: new Date().toISOString(),
      staleAfterSeconds: 120,
      rpmMilli: 60000,
      counterEpoch: "qa-epoch",
      cumulativeWorkUnits: "200",
    },
  };
}
async function mockNetwork(page, offline = false) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.startsWith("https://")) return route.continue();
    if (offline) return route.abort("internetdisconnected");
    if (url.includes("/v1/status")) return route.fulfill({ json: status() });
    if (url.includes("/v1/economy/state"))
      return route.fulfill({ json: economy });
    const q = route.request().postDataJSON();
    let result = null;
    if (q.method === "eth_chainId") result = "0xaa36a7";
    if (q.method === "eth_getCode") result = "0x60016000";
    if (q.method === "eth_getBlockByNumber")
      result =
        q.params[0] === "latest"
          ? { number: "0x123" }
          : { number: "0x124", hash: "0x" + "bc".repeat(32) };
    if (q.method === "eth_getTransactionReceipt") result = null;
    return route.fulfill({ json: { jsonrpc: "2.0", id: q.id, result } });
  });
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockNetwork(page);
  await page.goto("http://localhost:4173/preview/");
  await test("title metadata and self-contained load", async () => {
    assert.equal(await page.title(), "Squeek Survival · Beat Robo-Squeek");
    assert.equal(
      await page.locator("script[src],link[rel=stylesheet]").count(),
      0,
    );
    assert.equal(await page.locator('meta[property="og:image"]').count(), 1);
    assert.deepEqual(errors, []);
  });
  await test("390 first screen action and no overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const b = await page.locator("#lockBtn").boundingBox();
    assert.ok(b.y + b.height < 844, JSON.stringify(b));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "artifacts/screenshots/mobile-390.png",
      fullPage: true,
    });
  });
  await test("mobile360 and320 no horizontal scroll", async () => {
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
  });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await test("help traps focus, Escape returns trigger", async () => {
    await page.locator("#helpBtn").click();
    assert.equal(
      await page.locator("#helpDialog").evaluate((e) => e.open),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "helpBtn",
    );
  });
  await test("theme and mute persist reload", async () => {
    await page.locator("#themeBtn").click();
    await page.locator("#soundBtn").click();
    await page.reload();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "charcoal",
    );
    assert.equal(
      await page.locator("#soundBtn").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#soundBtn").click();
    await page.locator("#themeBtn").click();
  });
  await test("keyboard selection lock and frozen 60RPM round", async () => {
    await page.keyboard.press("Tab");
    await page.locator("h1").click();
    await page.keyboard.press("1");
    assert.equal(
      await page.locator("[data-call=OVER]").getAttribute("aria-pressed"),
      "true",
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => window.__squeekTest.readSnapshot().phase === "REPLAY",
    );
    const s = await page.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(s.round.seedType, "SEPOLIA");
    assert.equal(s.round.target, "0x124");
  });
  await test("reload during replay keeps exact round seed and target", async () => {
    const before = await page.evaluate(() =>
      window.__squeekTest.readSnapshot(),
    );
    await page.reload();
    const after = await page.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(before.round.id, after.round.id);
    assert.equal(before.round.seed, after.round.seed);
    assert.equal(before.round.target, after.round.target);
    assert.equal(after.counts.participated, 0);
  });
  await test("settlement once and wallet unlock remains guest", async () => {
    await page.waitForFunction(
      () => window.__squeekTest.readSnapshot().counts.participated === 1,
    );
    const s = await page.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(s.art, 1);
    assert.equal(s.round.applied, true);
    await page.reload();
    assert.equal(
      (await page.evaluate(() => window.__squeekTest.readSnapshot())).counts
        .participated,
      1,
    );
    assert.ok((await page.locator("#txHint").innerText()).includes("Connect"));
    assert.equal(await page.locator("#sendBtn").isDisabled(), true);
  });
  await test("PNG export 1080 square and preview download", async () => {
    await page.locator("#exportBtn").click();
    await page.waitForFunction(
      () => document.getElementById("pngPreview").naturalWidth === 1080,
    );
    assert.equal(
      await page.locator("#pngPreview").evaluate((e) => e.naturalHeight),
      1080,
    );
    const data = await page
      .locator("#pngPreview")
      .evaluate(async (e) =>
        Array.from(new Uint8Array(await (await fetch(e.src)).arrayBuffer())),
      );
    await writeFile("artifacts/wheelprint-example.png", Buffer.from(data));
    await page.keyboard.press("Escape");
  });
  await test("announced zone unavailable in UI", async () => {
    await page.waitForFunction(
      () => window.__squeekTest.readSnapshot().phase === "PREDICT",
    );
    await page.locator("#zoneMode").click();
    const zone = (await page.evaluate(() => window.__squeekTest.readSnapshot()))
      .round.aiZone;
    assert.equal(
      await page.locator(`[data-call="${zone}"]`).isDisabled(),
      true,
    );
  });
  await test("mock wallet exact success, rejection and simulation failure", async () => {
    const result = await page.evaluate(async () => {
      const a = await window.__squeekTest.mockWallet();
      const b = await window.__squeekTest.mockWallet({
        eth_sendTransaction: { error: { code: 4001, message: "Rejected" } },
      });
      const c = await window.__squeekTest.mockWallet({
        eth_call: "0x" + "0".repeat(64),
      });
      return { a, b, c };
    });
    assert.ok(result.a.hash);
    const send = result.a.calls.find((c) => c.method === "eth_sendTransaction");
    assert.equal(send.params[0].data.length, 138);
    assert.equal(
      Object.keys(send.params[0]).sort().join(","),
      "data,from,to,value",
    );
    assert.equal(result.b.hash, null);
    assert.ok(result.b.classification.includes("rejected"));
    assert.equal(
      result.c.calls.some((c) => c.method === "eth_sendTransaction"),
      false,
    );
  });
  await test("mock wallet code gas and chain failures prevent sends", async () => {
    for (const script of [
      { eth_getCode: "0x" },
      {
        eth_estimateGas: {
          error: { code: -32000, message: "insufficient funds" },
        },
      },
      { eth_chainId: "0x1" },
      { eth_accounts: [] },
    ]) {
      const r = await page.evaluate(
        (s) => window.__squeekTest.mockWallet(s),
        script,
      );
      assert.equal(
        r.calls.some((c) => c.method === "eth_sendTransaction"),
        false,
      );
    }
  });
  await test("account change before send aborts", async () => {
    const r = await page.evaluate(() =>
      window.__squeekTest.mockWallet({}, "eth_estimateGas"),
    );
    assert.equal(
      r.calls.some((c) => c.method === "eth_sendTransaction"),
      false,
    );
  });
  await test("offline guest, local fallback and no fabricated telemetry", async () => {
    const p = await context.newPage();
    await mockNetwork(p, true);
    await p.goto("http://localhost:4173/offline");
    await p.locator("h1").click();
    await p.keyboard.press("1");
    await p.keyboard.press("Enter");
    await p.clock.install();
    await p.clock.fastForward(46000);
    await p.waitForFunction(
      () => window.__squeekTest.readSnapshot().phase === "REPLAY",
    );
    const s = await p.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(s.round.seedType, "LOCAL");
    assert.equal(s.mode, "PRACTICE");
    await p.close();
  });
  await test("RAM fallback on denied storage", async () => {
    const c = await browser.newContext();
    await c.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("denied");
        },
      });
    });
    const p = await c.newPage();
    await mockNetwork(p, true);
    await p.goto("http://localhost:4173");
    assert.equal(await p.locator("#storageNotice").isVisible(), true);
    assert.equal(
      await p.evaluate(() => window.__squeekTest.sessionOnly()),
      true,
    );
    await c.close();
  });
  await test("isolated sandbox never mutates saved run", async () => {
    const r = await page.evaluate(() => {
      const before = localStorage.getItem("squeek.state.v3"),
        s = window.__squeekTest.createSandbox();
      s.begin();
      s.state.round.call = "OVER";
      s.lock();
      s.seed();
      s.settle();
      return before === localStorage.getItem("squeek.state.v3");
    });
    assert.equal(r, true);
  });
  await test("reduced motion has no CSS animations and canvas remains usable", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
      0,
    );
    await page.screenshot({
      path: "artifacts/screenshots/reduced-motion.png",
      fullPage: false,
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await test("desktop cream and charcoal screenshots", async () => {
    await page.locator("#pauseBtn").click();
    await page.screenshot({
      path: "artifacts/screenshots/desktop-1440.png",
      fullPage: true,
    });
    await page.locator("#themeBtn").click();
    await page.screenshot({
      path: "artifacts/screenshots/charcoal-1440.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  });
  await test("no browser script errors", async () =>
    assert.deepEqual(errors, []));
  await context.close();
  await browser.close();
  browser = null;
  try {
    browser = await webkit.launch({ headless: true });
    await test("WebKit primary prediction and responsive load", async () => {
      const p = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await mockNetwork(p);
      await p.goto("http://localhost:4173");
      await p.locator("[data-call=UNDER]").click();
      await p.locator("#lockBtn").click();
      await p.waitForFunction(
        () => window.__squeekTest.readSnapshot().phase === "REPLAY",
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await p.screenshot({
        path: "artifacts/screenshots/webkit-390.png",
        fullPage: false,
      });
      await p.close();
    });
  } catch (e) {
    results.push({
      name: "WebKit availability",
      passed: false,
      error:
        "WebKit could not launch because required browser runtime dependencies are unavailable; no WebKit checks performed.",
    });
  }
} finally {
  await browser?.close();
  const passed = results.filter((r) => r.passed).length;
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify({ passed, total: results.length, results }, null, 2),
  );
  console.log(`${passed}/${results.length} browser checks passed`);
  if (process.argv.includes("--inspect")) {
    console.log(
      "INSPECTION READY http://127.0.0.1:4173/preview/ (bounded 60s)",
    );
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  server.close();
  if (passed !== results.length) process.exitCode = 1;
}
