import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const server = createServer(async (req, res) => {
  try {
    const path = req.url?.split("?")[0];
    const name = path?.endsWith("share.png") ? "share.png" : "index.html";
    res.setHeader(
      "Content-Type",
      name.endsWith(".png") ? "image/png" : "text/html",
    );
    res.end(await readFile("dist/" + name));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
server.listen(4173, "0.0.0.0", () =>
  console.log("Preview: http://localhost:4173"),
);
