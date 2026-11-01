/** One real guest duel against configured services. Never connects a wallet. */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
const path =
  process.argv.find((a) => a.startsWith("--playwright="))?.slice(13) ||
  "playwright";
const { chromium } = await import(path);
const server = createServer(async (q, r) => {
  r.setHeader(
    "Content-Type",
    q.url?.includes(".png") ? "image/png" : "text/html",
  );
  r.end(
    await readFile(
      q.url?.includes(".png") ? "dist/share.png" : "dist/index.html",
    ),
  );
});
await new Promise((r) => server.listen(4175, "127.0.0.1", r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const report = {
  checkedAt: new Date().toISOString(),
  synthetic: false,
  walletUsed: false,
  services: [],
};
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().startsWith("https://"))
    report.services.push({ url: r.url(), status: r.status() });
});
try {
  await page.goto("http://localhost:4175/preview/");
  await page.waitForFunction(
    () =>
      window.__squeekTest.readSnapshot().phase === "PREDICT" &&
      window.__squeekTest.readSnapshot().round.env.mode !== "PRACTICE",
    {},
    { timeout: 35000 },
  );
  await page.locator("[data-call=OVER]").click();
  await page.locator("#lockBtn").click();
  await page.waitForFunction(
    () => window.__squeekTest.readSnapshot().counts.participated === 1,
    {},
    { timeout: 60000 },
  );
  await page.locator("#pauseBtn").click();
  const s = await page.evaluate(() => window.__squeekTest.readSnapshot());
  report.result = s;
  report.passed = s.round.applied && s.counts.participated === 1;
  await page.screenshot({
    path: "artifacts/screenshots/live-play-390.png",
    fullPage: true,
  });
  await page.locator("#exportBtn").click();
  await page.waitForFunction(
    () => document.getElementById("pngPreview").naturalWidth === 1080,
  );
  const png = await page
    .locator("#pngPreview")
    .evaluate(async (e) =>
      Array.from(new Uint8Array(await (await fetch(e.src)).arrayBuffer())),
    );
  await writeFile("artifacts/wheelprint-live.png", Buffer.from(png));
  console.log(
    JSON.stringify({
      passed: report.passed,
      phase: s.phase,
      env: s.round.env.mode,
      seed: s.round.seedType,
      target: s.round.target,
      hash: s.round.seed,
      D: s.round.race.D,
      A: s.round.A,
      outcome: s.round.outcome,
      damage: s.round.damage,
      lives: s.run.lives,
    }),
  );
} catch (e) {
  report.passed = false;
  report.limitation =
    e.name === "TimeoutError"
      ? "No verified live prediction/settlement within the bounded check. No result invented."
      : e.message;
  console.log(report.limitation);
} finally {
  report.scriptErrors = errors;
  await writeFile(
    "artifacts/live-game-results.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  server.close();
}
