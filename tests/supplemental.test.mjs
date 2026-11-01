import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const path =
  process.argv.find((a) => a.startsWith("--playwright="))?.slice(13) ||
  "playwright";
const { chromium } = await import(path);
const html = await readFile("dist/index.html");
const server = createServer((q, r) => {
  r.setHeader("Content-Type", "text/html");
  r.end(html);
});
await new Promise((r) => server.listen(4176, "127.0.0.1", r));
const browser = await chromium.launch();
const results = [];
const contrast = [];
async function test(name, f) {
  try {
    await f();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.log("FAIL " + name + " " + e.message);
  }
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
await context.addInitScript(() => {
  window.testAudio = [];
  window.testTones = 0;
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args);
      window.testAudio.push(this);
    }
    createOscillator() {
      const o = super.createOscillator();
      const start = o.start.bind(o);
      o.start = (...args) => {
        window.testTones++;
        return start(...args);
      };
      return o;
    }
  };
});
const p = await context.newPage();
await p.route("https://**", (r) => r.fulfill({ json: {} }));
await p.goto("http://localhost:4176/preview/");
await test("DPR2 arena backing pixels match CSS size", async () => {
  const v = await p
    .locator("#arena")
    .evaluate((c) => ({
      actual: c.width,
      expected: Math.round(c.getBoundingClientRect().width * 2),
    }));
  assert.equal(v.actual, v.expected);
});
await test("gesture starts real Web Audio, pause and mute suspend it", async () => {
  await p.locator("#soundBtn").click();
  await p.waitForFunction(
    () =>
      window.testAudio.length > 0 &&
      window.testTones > 0 &&
      window.testAudio[0].state === "running",
  );
  await p.locator("#pauseBtn").click();
  await p.waitForFunction(() => window.testAudio[0].state === "suspended");
  await p.locator("#pauseBtn").click();
  await p.waitForFunction(() => window.testAudio[0].state === "running");
  await p.locator("#soundBtn").click();
  await p.waitForFunction(() => window.testAudio[0].state === "suspended");
});
await test("keyboard focus ring visible and all utility buttons 44px", async () => {
  await p.locator("[data-call=OVER]").focus();
  await p.keyboard.press("Tab");
  const v = await p.evaluate(() => ({
    width: getComputedStyle(document.activeElement).outlineWidth,
    style: getComputedStyle(document.activeElement).outlineStyle,
  }));
  assert.equal(v.width, "3px");
  assert.equal(v.style, "solid");
  for (const id of [
    "helpBtn",
    "soundBtn",
    "themeBtn",
    "connectBtn",
    "pauseBtn",
  ]) {
    const b = await p.locator("#" + id).boundingBox();
    assert.ok(b.width >= 44 && b.height >= 44, id);
  }
  await p.screenshot({
    path: "artifacts/screenshots/keyboard-focus-390.png",
    fullPage: false,
  });
});
function rgb(value) {
  if (value.startsWith("#")) {
    const h = value.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return value
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
}
function lum(color) {
  const channels = rgb(color).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function ratio(a, b) {
  return (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
}
for (const theme of ["cream", "charcoal"])
  await test(theme + " actual token contrast for text and focus", async () => {
    if ((await p.locator("html").getAttribute("data-theme")) !== theme)
      await p.locator("#themeBtn").click();
    const colors = await p.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "bg",
          "surface",
          "ink",
          "muted",
          "accent",
          "button",
          "button-ink",
          "focus",
          "arena",
          "arena-ink",
        ].map((k) => [k, s.getPropertyValue("--" + k).trim()]),
      );
    });
    for (const [fg, bg, minimum] of [
      ["ink", "bg", 4.5],
      ["muted", "bg", 4.5],
      ["ink", "surface", 4.5],
      ["muted", "surface", 4.5],
      ["accent", "surface", 4.5],
      ["button-ink", "button", 4.5],
      ["arena-ink", "arena", 4.5],
      ["focus", "bg", 3],
      ["focus", "surface", 3],
    ]) {
      const value = ratio(colors[fg], colors[bg]);
      contrast.push({
        theme,
        foreground: colors[fg],
        background: colors[bg],
        role: fg + "/" + bg,
        ratio: Number(value.toFixed(2)),
        minimum,
      });
      assert.ok(value >= minimum, fg + "/" + bg + " " + value);
    }
  });
await test("text enlargement 200% still has no horizontal overflow", async () => {
  await p.addStyleTag({ content: "html{font-size:32px}" });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
});
await browser.close();
server.close();
const passed = results.filter((r) => r.passed).length;
await writeFile(
  "artifacts/supplemental-results.json",
  JSON.stringify({ passed, total: results.length, results, contrast }, null, 2),
);
console.log(`${passed}/${results.length} supplemental checks passed`);
if (passed !== results.length) process.exitCode = 1;
