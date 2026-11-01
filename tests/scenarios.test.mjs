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
await new Promise((r) => server.listen(4174, "127.0.0.1", r));
const browser = await chromium.launch();
const results = [];
const P = {
  token: "0x5501e1fa81be1c3f49225fa7668da0245d07db60",
  core: "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44",
  mining: "0xcd46990f8349057335289ef282c276204b6cdc62",
  installation: "stream-game-sepolia-test-20261025-01",
  release: "stream-game-sepolia-test-20261026-01",
};
const eco = {
  schemaVersion: 2,
  installationId: P.installation,
  status: "available",
  release: { id: P.release },
  chain: { chainId: "11155111" },
  identities: { token: P.token, core: P.core, mining: { proxy: P.mining } },
};
const account = "0x" + "12".repeat(20),
  hash = "0x" + "ab".repeat(32);
async function scenario(name, fn) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p = await context.newPage();
  let requests = [],
    options = { economy: eco, telemetry: true, block: true, receipt: null };
  await p.route("**/*", async (r) => {
    const u = r.request().url();
    if (!u.startsWith("https://")) return r.continue();
    requests.push({ url: u, body: r.request().postDataJSON() });
    if (u.includes("/v1/status"))
      return r.fulfill({
        json: options.telemetry
          ? {
              schemaVersion: 1,
              installationId: P.installation,
              measurement: {
                freshness: "online",
                provenance: "hardware",
                coreStatus: "IDLE",
                observedAt: new Date().toISOString(),
                staleAfterSeconds: 120,
                rpmMilli: 60000,
                counterEpoch: "qa",
                cumulativeWorkUnits: "45",
              },
            }
          : {},
      });
    if (u.includes("/v1/economy/state"))
      return r.fulfill({ json: options.economy });
    const b = r.request().postDataJSON();
    let result = null;
    if (b.method === "eth_chainId") result = "0xaa36a7";
    if (b.method === "eth_getCode") result = "0x6001";
    if (b.method === "eth_getBlockByNumber" && options.block)
      result =
        b.params[0] === "latest"
          ? { number: "0x100" }
          : { number: "0x101", hash };
    if (b.method === "eth_getTransactionReceipt") result = options.receipt;
    return r.fulfill({ json: { jsonrpc: "2.0", id: b.id, result } });
  });
  try {
    await fn(p, options, requests, context);
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.error("FAIL " + name + " " + e.message);
  } finally {
    await context.close();
  }
}
async function load(p) {
  await p.clock.install();
  await p.goto("http://localhost:4174/preview/");
  await p.waitForFunction(() => !!window.__squeekTest);
}
async function pick(p) {
  await p.locator("[data-call=OVER]").click();
  await p.locator("#lockBtn").click();
  await p.waitForFunction(
    () => window.__squeekTest.readSnapshot().phase === "REPLAY",
  );
}
async function settle(p) {
  await p.clock.runFor(6100);
  await p.waitForFunction(
    () => window.__squeekTest.readSnapshot().counts.participated === 1,
  );
}
async function wallet(p, variant = {}) {
  await p.evaluate(
    ({ account, hash, variant }) => {
      window.walletCalls = [];
      window.walletEvents = {};
      window.mockChain = variant.chain || "0xaa36a7";
      window.mockAccount = account;
      const provider = {
        request: async (args) => {
          window.walletCalls.push(args);
          if (variant.reject === args.method)
            throw {
              code: variant.code || 4001,
              message: variant.message || "rejected",
            };
          if (
            args.method === "eth_requestAccounts" ||
            args.method === "eth_accounts"
          )
            return [window.mockAccount];
          if (args.method === "eth_chainId") return window.mockChain;
          if (args.method === "eth_getCode")
            return variant.noCode ? "0x" : "0x6001";
          if (args.method === "wallet_switchEthereumChain") {
            if (variant.unknownChain) throw { code: 4902, message: "unknown" };
            window.mockChain = "0xaa36a7";
            window.walletEvents.chainChanged?.(window.mockChain);
            return null;
          }
          if (args.method === "wallet_addEthereumChain") {
            window.mockChain = "0xaa36a7";
            window.walletEvents.chainChanged?.(window.mockChain);
            return null;
          }
          if (args.method === "eth_call") {
            if (args.params[0].data === "0x313ce567") {
              if (variant.badDecimals) throw Error("decimals failed");
              return "0x" + (18).toString(16).padStart(64, "0");
            }
            if (args.params[0].data.startsWith("0x70a08231")) {
              if (variant.badBalance) throw Error("balance failed");
              return "0x" + 1234567891234567890n.toString(16).padStart(64, "0");
            }
            return variant.falseCall
              ? "0x" + "0".repeat(64)
              : "0x" + "0".repeat(63) + "1";
          }
          if (args.method === "eth_estimateGas") return "0x1234";
          if (args.method === "eth_sendTransaction")
            return variant.unknownHash ? "bad" : hash;
          throw Error("unexpected method " + args.method);
        },
        on: (name, cb) => (window.walletEvents[name] = cb),
        removeListener: (name) => delete window.walletEvents[name],
      };
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "test-wallet",
              name: "QA wallet",
              icon: "",
              rdns: "qa.wallet",
            },
            provider,
          },
        }),
      );
    },
    { account, hash, variant },
  );
  await p.locator("#connectBtn").click();
  await p.locator("#walletList button").click();
  await p.waitForFunction(
    () => document.getElementById("disconnectBtn").hidden === false,
  );
}
await scenario("12s timeout without pick skips without costs", async (p) => {
  await load(p);
  await p.clock.runFor(12100);
  const s = await p.evaluate(() => window.__squeekTest.readSnapshot());
  assert.equal(s.round.skipped, true);
  assert.equal(s.counts.participated, 0);
  assert.equal(s.run.lives, 3);
  assert.equal(s.run.ready.Shield, 0);
  assert.equal(await p.locator("#sendBtn").isDisabled(), true);
});
await scenario(
  "selected call locks at timeout and exact L+1 requested",
  async (p, o, requests) => {
    await load(p);
    await p.locator("[data-call=UNDER]").click();
    await p.clock.runFor(12100);
    await p.waitForFunction(
      () => window.__squeekTest.readSnapshot().phase === "REPLAY",
    );
    assert.ok(
      requests.some(
        (r) =>
          r.body?.method === "eth_getBlockByNumber" &&
          r.body.params[0] === "0x101",
      ),
    );
    assert.equal(
      requests.some(
        (r) =>
          r.body?.method === "eth_getBlockByNumber" &&
          r.body.params[0] === "0x102",
      ),
      false,
    );
  },
);
await scenario(
  "identity mismatch disables live effects with pins unchanged",
  async (p, o) => {
    o.economy = { ...eco, release: { id: "different" } };
    await load(p);
    await p.waitForFunction(
      () => window.__squeekTest.readSnapshot().economy === "mismatch",
    );
    const s = await p.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(s.mode, "PRACTICE");
    assert.equal(await p.locator("#sendBtn").isDisabled(), true);
    assert.equal(
      await p.locator("#contractLinks a").first().getAttribute("href"),
      "https://sepolia.etherscan.io/address/" + P.token,
    );
  },
);
await scenario(
  "invalid available 200 responses become unknown practice",
  async (p, o) => {
    o.telemetry = false;
    o.economy = {};
    await load(p);
    await p.waitForFunction(
      () => window.__squeekTest.readSnapshot().economy === "unavailable",
    );
    assert.equal(
      (await p.evaluate(() => window.__squeekTest.readSnapshot())).mode,
      "PRACTICE",
    );
  },
);
await scenario(
  "public Sepolia chain and all pin code reads occur",
  async (p, o, requests) => {
    await load(p);
    await p.waitForFunction(() =>
      document
        .getElementById("codeStatus")
        .textContent.includes("Public RPC verified"),
    );
    for (const pin of [P.token, P.core, P.mining])
      assert.ok(
        requests.some(
          (r) => r.body?.method === "eth_getCode" && r.body.params[0] === pin,
        ),
      );
    assert.ok(requests.some((r) => r.body?.method === "eth_chainId"));
  },
);
await scenario("end/new run cannot cancel committed call", async (p) => {
  await load(p);
  await pick(p);
  const before = await p.evaluate(() => window.__squeekTest.readSnapshot());
  assert.equal(await p.locator("#endRun").isDisabled(), true);
  assert.equal(await p.locator("#newRun").isDisabled(), true);
  assert.equal(await p.locator("#clearArt").isDisabled(), true);
  await p.reload();
  assert.equal(
    (await p.evaluate(() => window.__squeekTest.readSnapshot())).round.id,
    before.round.id,
  );
});
await scenario(
  "AI reset during replay preserves frozen call and settlement",
  async (p) => {
    await load(p);
    await pick(p);
    const before = await p.evaluate(() => window.__squeekTest.readSnapshot());
    await p.locator("#resetAI").click();
    await p.locator("#confirmAction").click();
    const after = await p.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(after.round.A, before.round.A);
    assert.equal(after.round.seed, before.round.seed);
    await settle(p);
    assert.equal(
      (await p.evaluate(() => window.__squeekTest.readSnapshot())).counts
        .participated,
      1,
    );
  },
);
await scenario(
  "pause reload preserves exact target seed and remaining timer",
  async (p) => {
    await load(p);
    await pick(p);
    await p.locator("#pauseBtn").click();
    const a = await p.evaluate(() => window.__squeekTest.readSnapshot());
    await p.reload();
    const b = await p.evaluate(() => window.__squeekTest.readSnapshot());
    assert.equal(a.round.seed, b.round.seed);
    assert.equal(a.round.target, b.round.target);
    assert.equal(a.round.phase, b.round.phase);
    assert.ok(b.round.deadline >= a.round.deadline);
  },
);
await scenario("settled seed survives next predict for PNG", async (p) => {
  await load(p);
  await pick(p);
  await settle(p);
  await p.clock.runFor(4100);
  const s = await p.evaluate(() => window.__squeekTest.readSnapshot());
  assert.equal(s.phase, "PREDICT");
  assert.equal(s.run.lastSeed, hash);
  assert.equal(s.run.lastSeedType, "SEPOLIA");
});
await scenario(
  "EIP6963 chooser connect balance and accounts change preserve game",
  async (p) => {
    await load(p);
    const id = (await p.evaluate(() => window.__squeekTest.readSnapshot()))
      .round.id;
    await wallet(p);
    await p.waitForFunction(() =>
      document
        .getElementById("walletBalance")
        .textContent.includes("1.2345 SQK"),
    );
    await p.evaluate(() => {
      window.mockAccount = "0x" + "34".repeat(20);
      window.walletEvents.accountsChanged([window.mockAccount]);
    });
    await p.waitForFunction(() =>
      document.getElementById("walletAccount").textContent.includes("3434"),
    );
    assert.equal(
      (await p.evaluate(() => window.__squeekTest.readSnapshot())).round.id,
      id,
    );
  },
);
await scenario(
  "wrong-chain connect never automatically switches",
  async (p) => {
    await load(p);
    await wallet(p, { chain: "0x1" });
    assert.equal(await p.locator("#switchChain").isVisible(), true);
    assert.equal(
      await p.evaluate(() =>
        window.walletCalls.some(
          (c) => c.method === "wallet_switchEthereumChain",
        ),
      ),
      false,
    );
    await p.locator("#switchChain").click();
    await p.waitForFunction(
      () => document.getElementById("switchChain").hidden,
    );
    assert.equal(
      await p.evaluate(
        () =>
          window.walletCalls.filter(
            (c) => c.method === "wallet_addEthereumChain",
          ).length,
      ),
      0,
    );
  },
);
await scenario("unknown Sepolia chain adds only after 4902", async (p) => {
  await load(p);
  await wallet(p, { chain: "0x1", unknownChain: true });
  await p.locator("#switchChain").click();
  await p.waitForFunction(() =>
    window.walletCalls.some((c) => c.method === "wallet_addEthereumChain"),
  );
  assert.equal(
    await p.evaluate(
      () =>
        window.walletCalls.find((c) => c.method === "wallet_addEthereumChain")
          .params[0].chainId,
    ),
    "0xaa36a7",
  );
});
await scenario(
  "wallet rejection and already-pending errors remain recoverable",
  async (p) => {
    await load(p);
    await p.evaluate(() => {
      window.ethereum = {
        request: async () => {
          throw { code: -32002, message: "pending" };
        },
      };
    });
    await p.locator("#connectBtn").click();
    await p.locator("#walletList button").click();
    await p.waitForFunction(() =>
      document
        .getElementById("chooserMessage")
        .textContent.includes("already open"),
    );
    assert.equal(await p.locator("#connectBtn").isDisabled(), false);
  },
);
await scenario(
  "failed decimals show raw units, failed balance unknown",
  async (p) => {
    await load(p);
    await wallet(p, { badDecimals: true });
    await p.waitForFunction(() =>
      document
        .getElementById("walletBalance")
        .textContent.includes("raw units"),
    );
    await p.locator("#disconnectBtn").click();
    await wallet(p, { badBalance: true });
    await p.waitForFunction(() =>
      document.getElementById("walletBalance").textContent.includes("Unknown"),
    );
  },
);
await scenario(
  "one settled round enables exact send and confirmed receipt",
  async (p, o) => {
    await load(p);
    await pick(p);
    await settle(p);
    await wallet(p);
    await p.waitForFunction(
      () => document.getElementById("sendBtn").disabled === false,
    );
    o.receipt = { status: "0x1", transactionHash: hash };
    await p.locator("#sendBtn").click();
    await p.waitForFunction(() =>
      document.getElementById("txStatus").textContent.includes("confirmed"),
    );
    const send = await p.evaluate(() =>
      window.walletCalls.filter((c) => c.method === "eth_sendTransaction"),
    );
    assert.equal(send.length, 1);
    assert.equal(send[0].params[0].value, "0x0");
    assert.equal(send[0].params[0].to, P.token);
    assert.equal(send[0].params[0].data.length, 138);
    assert.deepEqual(Object.keys(send[0].params[0]).sort(), [
      "data",
      "from",
      "to",
      "value",
    ]);
    assert.equal(await p.locator("#sendBtn").isDisabled(), true);
    await p.clock.runFor(15100);
    assert.equal(await p.locator("#sendBtn").isDisabled(), false);
  },
);
await scenario(
  "pending persists reload and account switch, failed receipt terminal",
  async (p, o) => {
    await load(p);
    await pick(p);
    await settle(p);
    await wallet(p);
    await p.waitForFunction(() => !document.getElementById("sendBtn").disabled);
    await p.locator("#sendBtn").click();
    await p.waitForFunction(
      (h) => document.getElementById("txStatus").textContent.includes(h),
      hash,
    );
    await p.reload();
    assert.ok((await p.locator("#txStatus").innerText()).includes(account));
    assert.equal(await p.locator("#sendBtn").isDisabled(), true);
    o.receipt = { status: "0x0", transactionHash: hash };
    await p.locator("#checkTx").click();
    await p.waitForFunction(() =>
      document.getElementById("txStatus").textContent.includes("failed"),
    );
  },
);
await scenario(
  "3 visible minute receipt timeout remains pending with check status",
  async (p) => {
    await load(p);
    await pick(p);
    await settle(p);
    await wallet(p);
    await p.waitForFunction(() => !document.getElementById("sendBtn").disabled);
    await p.locator("#sendBtn").click();
    await p.waitForFunction(() =>
      document.getElementById("txStatus").textContent.includes("pending"),
    );
    await p.clock.runFor(182000);
    assert.equal(await p.locator("#sendBtn").isDisabled(), true);
    assert.equal(await p.locator("#checkTx").isVisible(), true);
    assert.ok(
      (await p.locator("#txStatus").innerText()).includes("Still pending"),
    );
  },
);
await scenario(
  "unknown hash disables repeat sends without auto retry",
  async (p) => {
    await load(p);
    await pick(p);
    await settle(p);
    await wallet(p, { unknownHash: true });
    await p.waitForFunction(() => !document.getElementById("sendBtn").disabled);
    await p.locator("#sendBtn").click();
    await p.waitForFunction(() =>
      document
        .getElementById("txStatus")
        .textContent.includes("Unknown send outcome"),
    );
    assert.equal(await p.locator("#sendBtn").isDisabled(), true);
    assert.equal(
      await p.evaluate(
        () =>
          window.walletCalls.filter((c) => c.method === "eth_sendTransaction")
            .length,
      ),
      1,
    );
  },
);
await scenario(
  "new run resets lives boosters art but keeps boss and memory",
  async (p) => {
    await load(p);
    await pick(p);
    await settle(p);
    await p.clock.runFor(4100);
    await p.locator("#pauseBtn").click();
    const before = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("squeek.state.v3")),
    );
    await p.locator("#endRun").click();
    await p.locator("#confirmAction").click();
    assert.equal(await p.locator("#recordsTable").isVisible(), true);
    await p.locator("#newRun").click();
    const s = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("squeek.state.v3")),
    );
    assert.equal(s.run.lives, 3);
    assert.equal(s.art.length, 0);
    assert.equal(s.ai.history.length, before.ai.history.length);
    assert.deepEqual(s.boss, before.boss);
    assert.equal(await p.locator("#exportBtn").isDisabled(), true);
  },
);
await scenario("whole JSON corruption recovers honestly", async (p) => {
  await p.addInitScript(() =>
    localStorage.setItem("squeek.state.v3", "{bad json"),
  );
  await load(p);
  assert.ok(
    (await p.locator("#storageNotice").innerText()).includes("invalid JSON"),
  );
  assert.equal(
    (await p.evaluate(() => window.__squeekTest.readSnapshot())).run.lives,
    3,
  );
});
await browser.close();
server.close();
const passed = results.filter((r) => r.passed).length;
await writeFile(
  "artifacts/scenario-results.json",
  JSON.stringify({ passed, total: results.length, results }, null, 2),
);
console.log(`${passed}/${results.length} integration scenarios passed`);
if (passed !== results.length) process.exitCode = 1;
