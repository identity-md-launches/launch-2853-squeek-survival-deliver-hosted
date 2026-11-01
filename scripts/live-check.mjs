/** Read-only probes against the brief's configured services. No wallet/account access. */
import { writeFile, mkdir } from "node:fs/promises";
const pins = {
  token: "0x5501e1fa81be1c3f49225fa7668da0245d07db60",
  mining: "0xcd46990f8349057335289ef282c276204b6cdc62",
  core: "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44",
};
const rpcs = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
];
async function get(url, body) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!r.ok) throw Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}
const report = { checkedAt: new Date().toISOString(), api: {}, rpcs: [] };
for (const path of ["/v1/status", "/v1/economy/state"]) {
  try {
    const v = await get("https://api.squeekchain.com" + path);
    report.api[path] = path.includes("economy")
      ? {
          schemaVersion: v.schemaVersion,
          status: v.status,
          installationId: v.installationId,
          releaseId: v.release?.id,
          chainId: v.chain?.chainId,
          pinnedIdentitiesMatch: Object.entries(pins).every(
            ([k, a]) =>
              (k === "mining"
                ? v.identities?.mining?.proxy
                : v.identities?.[k]
              )?.toLowerCase() === a,
          ),
        }
      : {
          schemaVersion: v.schemaVersion,
          installationId: v.installationId,
          measurement: v.measurement,
        };
  } catch (e) {
    report.api[path] = {
      available: false,
      error: e.name === "AbortError" ? "4 second timeout" : e.message,
    };
  }
}
for (const url of rpcs) {
  const result = { url };
  try {
    const call = async (method, params = []) => {
      const v = await get(url, { jsonrpc: "2.0", id: 1, method, params });
      if (v.error || !("result" in v)) throw Error("Invalid RPC result");
      return v.result;
    };
    result.chainId = await call("eth_chainId");
    result.code = {};
    for (const [name, address] of Object.entries(pins)) {
      const code = await call("eth_getCode", [address, "latest"]);
      result.code[name] = {
        present:
          typeof code === "string" &&
          /^0x[0-9a-f]+$/i.test(code) &&
          !/^0x0*$/i.test(code),
        bytes: typeof code === "string" ? (code.length - 2) / 2 : null,
      };
    }
    const block = await call("eth_getBlockByNumber", ["latest", false]);
    result.latest = {
      number: BigInt(block.number).toString(),
      hash: block.hash,
    };
  } catch (e) {
    result.error = e.name === "AbortError" ? "4 second timeout" : e.message;
  }
  report.rpcs.push(result);
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/live-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
