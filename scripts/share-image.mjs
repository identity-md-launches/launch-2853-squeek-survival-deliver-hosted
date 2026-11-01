import { readFile } from "node:fs/promises";
const modulePath =
  process.argv.find((a) => a.startsWith("--playwright="))?.slice(13) ||
  "playwright";
const { chromium } = await import(modulePath);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    "<style>body{margin:0}svg{display:block}</style>" +
      (await readFile("src/share.svg", "utf8")),
  );
  await page.screenshot({ path: "src/share.png" });
  console.log("Rendered local 1200×630 social image.");
} finally {
  await browser.close();
}
