import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
// Regression checks for the revision findings: corrupt round recovery, 320px
// records, prediction mode switching, focused-button shortcuts, contract link
// targets and hidden-tab reload. Every external request is blocked.
const server = createServer(async (req, res) => {
  const f = req.url.includes("share.png") ? "dist/share.png" : "dist/index.html";
  res.writeHead(200, { "content-type": f.endsWith("png") ? "image/png" : "text/html" });
  res.end(await readFile(f));
}).listen(4191);
const URL = "http://127.0.0.1:4191/";
const b = await chromium.launch();
const out = {};
async function page(w, h = 844) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.route("https://**", (r) => r.abort("internetdisconnected"));
  await ctx.addInitScript(() => localStorage.setItem("squeek.settings.v3", JSON.stringify({ theme: "cream", mute: true, tutorial: true })));
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const snap = (p) => p.evaluate(() => window.__squeekTest.readSnapshot());
// F1 corrupt round
{
  const { ctx, p, errors } = await page(390);
  await p.goto(URL); await p.waitForTimeout(500);
  await ctx.addInitScript(() => { if (sessionStorage.getItem("done")) return; sessionStorage.setItem("done", "1"); const s = JSON.parse(localStorage.getItem("squeek.state.v3")); s.round.target = "not-a-block"; s.run.streak = 7; localStorage.setItem("squeek.state.v3", JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(800);
  const s = await snap(p);
  out.f1 = { errors, notice: await p.textContent("#storageNotice"), canvasW: await p.$eval("#arena", (c) => c.width), target: s.round?.target, phase: s.phase, streakKept: s.run.streak, deadlineSec: Math.round((s.round.deadline - Date.now()) / 1000) };
  await ctx.close();
}
// F2 records 320
{
  const { ctx, p } = await page(320);
  await p.goto(URL); await p.waitForTimeout(400);
  await p.fill("input", "WWWWWWWWWWWWWWWWWWWW");
  await p.click("#endRun"); await p.click("#confirmAction"); await p.waitForTimeout(400);
  out.f2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, table: document.getElementById("recordsTable").getBoundingClientRect().right, name: document.querySelector("#recordsBody td").textContent }));
  await ctx.close();
}
// F3 mode switch
{
  const { ctx, p } = await page(390);
  await p.goto(URL); await p.waitForTimeout(400);
  await p.click('[data-call="OVER"]'); await p.click("#zoneMode");
  const lockDisabled = await p.$eval("#lockBtn", (x) => x.disabled);
  const call = (await snap(p)).round.call;
  const enabled = await p.$$eval("#zoneCalls [data-call]", (bs) => bs.filter((b) => !b.disabled).map((b) => b.dataset.call));
  await p.click(`[data-call="${enabled[0]}"]`);
  await p.reload(); await p.waitForTimeout(400);
  out.f3 = { lockDisabledAfterSwitch: lockDisabled, callAfterSwitch: call, chosen: enabled[0], callAfterReload: (await snap(p)).round.call, zoneVisible: await p.isVisible("#zoneCalls"), zonePressed: await p.$eval("#zoneMode", (x) => x.getAttribute("aria-pressed")) };
  await ctx.close();
}
// F4 shortcuts with focused button
{
  const { ctx, p } = await page(390);
  await p.goto(URL); await p.waitForTimeout(400);
  await p.click('[data-call="OVER"]');
  const focused = await p.evaluate(() => document.activeElement.dataset.call);
  await p.keyboard.press("2");
  const c2 = (await snap(p)).round.call;
  await p.keyboard.press("p");
  const pauseText = await p.textContent("#pauseBtn"); const pausedAt = (await snap(p)).round.pausedAt;
  await p.keyboard.press("p");
  await p.focus("input"); await p.keyboard.press("1");
  const inInput = (await snap(p)).round.call;
  // Enter on a focused call button: native activation only, no double
  await p.focus('[data-call="UNDER"]'); await p.keyboard.press("Enter");
  out.f4 = { focused, callAfter2: c2, pauseText, pausedAt: pausedAt !== null, callAfterTyping1InInput: inInput, phaseAfterEnterOnButton: (await snap(p)).phase };
  await ctx.close();
}
// F5 contract links
{
  const { ctx, p } = await page(390);
  await p.goto(URL); await p.waitForTimeout(400);
  await p.click(".contracts summary");
  out.f5 = await p.$$eval("#contractLinks a", (as) => as.map((a) => Math.round(a.getBoundingClientRect().height)));
  await ctx.close();
}
// F6 hidden reload
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("https://**", (r) => r.abort("internetdisconnected"));
  await ctx.addInitScript(() => localStorage.setItem("squeek.settings.v3", JSON.stringify({ theme: "cream", mute: true, tutorial: true })));
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(URL); await p.clock.runFor(500);
  const before = (await snap(p)).round;
  await ctx.addInitScript(() => { window.reviewHidden = true; Object.defineProperty(document, "hidden", { configurable: true, get: () => window.reviewHidden }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.reviewHidden ? "hidden" : "visible") }); });
  await p.reload(); await p.clock.runFor(200);
  const restored = (await snap(p)).round;
  await p.clock.runFor(20000);
  await p.evaluate(() => { window.reviewHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await p.clock.runFor(200);
  const after = await snap(p);
  out.f6 = { sameRound: before.id === after.round.id, restoredPausedAt: restored.pausedAt !== null, phase: after.phase, skipped: after.round.skipped, remainingSec: Math.round((after.round.deadline - (await p.evaluate(() => Date.now()))) / 1000) };
  await ctx.close();
}
const checks = [
  ["corrupt round recovers with notice and starts", () => { assert.deepEqual(out.f1.errors, []); assert.match(out.f1.notice, /round/); assert.equal(out.f1.canvasW, 356); assert.equal(out.f1.target, null); assert.equal(out.f1.streakKept, 7); }],
  ["20-character record name wraps at 320px", () => { assert.equal(out.f2.sw, 320); assert.ok(out.f2.table <= 320); assert.match(out.f2.name, /^W{20} /); }],
  ["mode switch clears hidden call; zone call restores zone tab", () => { assert.equal(out.f3.lockDisabledAfterSwitch, true); assert.equal(out.f3.callAfterSwitch, null); assert.equal(out.f3.callAfterReload, out.f3.chosen); assert.equal(out.f3.zoneVisible, true); }],
  ["1-5 and P work while a game button has focus, not in inputs", () => { assert.equal(out.f4.callAfter2, "UNDER"); assert.equal(out.f4.pauseText, "Resume"); assert.equal(out.f4.pausedAt, true); assert.equal(out.f4.callAfterTyping1InInput, "UNDER"); }],
  ["expanded contract links are at least 44px high", () => { assert.equal(out.f5.length, 3); assert.ok(out.f5.every((h) => h >= 44)); }],
  ["hidden-tab reload stays paused until visible", () => { assert.equal(out.f6.restoredPausedAt, true); assert.equal(out.f6.phase, "PREDICT"); assert.equal(out.f6.skipped, false); assert.ok(out.f6.remainingSec >= 10); }],
];
let passed = 0;
for (const [name, f] of checks) {
  try { f(); passed++; console.log("PASS " + name); } catch (e) { console.error("FAIL " + name + " " + e.message); }
}
console.log(`${passed}/${checks.length} revision checks passed`);
if (passed !== checks.length) { console.log(JSON.stringify(out, null, 1)); process.exitCode = 1; }
await b.close(); server.close();
