import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
const template = await readFile("src/index.html", "utf8");
const css = await readFile("src/style.css", "utf8");
const js = await readFile("test/scratch/compiled.js", "utf8");
const html = template
  .replace("/* INLINE_CSS */", css)
  .replace("/* INLINE_JS */", js);
if (Buffer.byteLength(html) >= 200000)
  throw Error("Single page exceeds 200 KB");
if (/<script[^>]+src=|<link[^>]+stylesheet/.test(html))
  throw Error("Runtime must be self-contained");
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", html);
await writeFile("dist/share.png", await readFile("src/share.png"));
await writeFile("index.html", html.replace("./share.png", "./dist/share.png"));
console.log(
  `Built dist/index.html: ${Buffer.byteLength(html)} bytes, unminified, zero runtime dependencies.`,
);
