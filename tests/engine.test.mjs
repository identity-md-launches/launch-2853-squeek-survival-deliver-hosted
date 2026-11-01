import { readFile, writeFile, mkdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
const js = await readFile("dist/index.html", "utf8");
const script = js
  .split("<script>")[1]
  .split("</script>")[0]
  .split("var SqueekApp;")[0];
const context = {};
runInNewContext(script, context);
const E = context.Squeek;
let passed = 0;
const results = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, passed: true });
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    console.error(name, e.message);
  }
}
const at = Date.UTC(2026, 9, 26, 12),
  sample = {
    schemaVersion: 1,
    installationId: E.PIN.installation,
    measurement: {
      freshness: "online",
      observedAt: new Date(at).toISOString(),
      staleAfterSeconds: 120,
      provenance: "hardware",
      coreStatus: "ACTIVE",
      rpmMilli: 60000,
      counterEpoch: "epoch-1",
      cumulativeWorkUnits: "123",
    },
  };
const env = E.telemetry(sample, at);
const fresh = () => E.initial(at);
function round(s, seed = "calib-0", call = "OVER", booster = null) {
  s.round = E.makeRound(s, "r-" + s.counts.participated, at, env, () => 0.5);
  s.round.call = call;
  s.round.booster = booster;
  E.lock(s, at);
  E.seedRound(s.round, seed, "LOCAL", at);
  return s.round;
}
test("60 RPM freezes exactly x1.125", () => assert.equal(env.M, 1.125));
test("moving damage capped x1.25", () => {
  const v = structuredClone(sample);
  v.measurement.rpmMilli = 900000;
  assert.equal(E.telemetry(v, at).M, 1.25);
});
test("still Shield cooldown two", () => {
  const v = structuredClone(sample);
  v.measurement.rpmMilli = 0;
  assert.equal(E.telemetry(v, at).cooldown, 2);
});
for (const [name, change] of Object.entries({
  schema: (s) => (s.schemaVersion = 2),
  installation: (s) => (s.installationId = "other"),
  stale: (s) =>
    (s.measurement.observedAt = new Date(at - 121000).toISOString()),
  future: (s) =>
    (s.measurement.observedAt = new Date(at + 31000).toISOString()),
  provenance: (s) => (s.measurement.provenance = "simulation"),
  offline: (s) => (s.measurement.freshness = "offline"),
  negativeRPM: (s) => (s.measurement.rpmMilli = -1),
  unsafeRPM: (s) => (s.measurement.rpmMilli = 2 ** 53),
  badEpoch: (s) => (s.measurement.counterEpoch = null),
  badWork: (s) => (s.measurement.cumulativeWorkUnits = "-1"),
  badStatus: (s) => (s.measurement.coreStatus = "ERROR"),
  nonpositiveStale: (s) => (s.measurement.staleAfterSeconds = 0),
})) {
  test("practice on " + name, () => {
    const s = structuredClone(sample);
    change(s);
    assert.equal(E.telemetry(s, at).mode, "PRACTICE");
  });
}
test("positive stale limit below120 is enforced", () => {
  const v = structuredClone(sample);
  v.measurement.staleAfterSeconds = 10;
  assert.equal(E.telemetry(v, at + 11000).mode, "PRACTICE");
});
test("future skew exactly30 accepted", () => {
  const v = structuredClone(sample);
  v.measurement.observedAt = new Date(at + 30000).toISOString();
  assert.equal(E.telemetry(v, at).mode, "LIVE MOVING");
});
const eco = {
  status: "available",
  schemaVersion: 2,
  installationId: E.PIN.installation,
  release: { id: E.PIN.release },
  chain: { chainId: E.PIN.chainId },
  identities: {
    token: E.PIN.token,
    core: E.PIN.core,
    mining: { proxy: E.PIN.mining },
  },
};
test("all economy identities match", () =>
  assert.equal(E.economy(eco), "match"));
for (const key of [
  "schema",
  "release",
  "chain",
  "token",
  "core",
  "mining",
  "installation",
])
  test("economy mismatch " + key, () => {
    const v = structuredClone(eco);
    if (key === "schema") v.schemaVersion = 1;
    if (key === "release") v.release.id = "x";
    if (key === "chain") v.chain.chainId = 11155111;
    if (key === "installation") v.installationId = "x";
    if (key === "token" || key === "core") v.identities[key] = "other";
    if (key === "mining") v.identities.mining.proxy = "other";
    assert.equal(E.economy(v), "mismatch");
  });
test("economy unavailable is not mismatch", () => {
  assert.equal(E.economy(null), "unavailable");
  assert.equal(E.economy({ status: "unavailable" }), "unavailable");
});
test("mismatch gates telemetry", () =>
  assert.equal(E.telemetry(sample, at, true).mode, "PRACTICE"));
test("race deterministic 24 ticks", () => {
  assert.equal(JSON.stringify(E.race("same")), JSON.stringify(E.race("same")));
  assert.equal(E.race("same").ticks.length, 24);
});
test("race formula from stored ticks", () => {
  const r = E.race("test");
  assert.equal(r.D, Math.round(r.ticks.reduce((s, t) => s + t.v, 0) * 5));
  assert.equal(
    r.peakRPM,
    Math.round(Math.max(...r.ticks.map((t) => t.v)) * 30),
  );
});
test("physics bounds", () => {
  for (let i = 0; i < 100; i++)
    for (const t of E.race("x" + i).ticks) assert.ok(t.v >= 0.6 && t.v <= 6);
});
test("zone boundaries", () =>
  assert.equal(
    [435, 436, 499, 500].map(E.zone).join(","),
    "Sprint,Cruise,Cruise,Marathon",
  ));
test("speed tier boundaries", () =>
  assert.equal([144, 145, 169, 170].map(E.tier).join(","), "LOW,MID,MID,HIGH"));
for (const [call, D, A, outcome] of [
  ["OVER", 500, 468, "WIN"],
  ["OVER", 450, 468, "LOSS"],
  ["OVER", 468, 468, "PUSH"],
  ["UNDER", 450, 468, "WIN"],
  ["UNDER", 500, 468, "LOSS"],
  ["UNDER", 468, 468, "PUSH"],
  ["Sprint", 420, 468, "WIN"],
  ["Sprint", 460, 468, "LOSS"],
  ["Sprint", 510, 468, "DRAW"],
  ["Cruise", 460, 468, "TIE"],
])
  test("resolve " + call + D + A + outcome, () =>
    assert.equal(E.resolve(call, D, A), outcome),
  );
test("AI zone UI handler disabled but TIE resolver retained", () => {
  const s = fresh();
  round(s);
  assert.equal(E.canCall(s.round, s.round.aiZone), false);
  assert.equal(E.resolve("Cruise", 460, 468), "TIE");
});
test("AI exact baseline and injectable draws", () => {
  const s = fresh();
  const p = E.predict(s.ai, () => 0.5);
  assert.equal(p.A, 468);
  assert.equal(p.sigma, 67);
  let calls = 0;
  E.predict(s.ai, () => {
    calls++;
    return 0.2;
  });
  assert.equal(calls, 3);
});
test("weighted mean newest age0 and population SD floor", () => {
  const s = fresh();
  s.ai.history = [400, 450, 480, 510, 550].map((D, i) => ({
    D,
    call: "OVER",
    outcome: "WIN",
    id: "" + i,
  }));
  const p = E.stats(s.ai);
  const weights = s.ai.history.map((h, i) => 0.5 ** ((4 - i) / 6));
  assert.ok(
    Math.abs(
      p.baseline -
        s.ai.history.reduce((v, h, i) => v + h.D * weights[i], 0) /
          weights.reduce((a, b) => a + b, 0),
    ) < 1e-9,
  );
  assert.ok(p.sigma >= 40);
});
test("g clamps and only decided rounds used", () => {
  const s = fresh();
  s.ai.decisions = Array(20).fill("WIN");
  for (let i = 0; i < 30; i++) E.adapt(s.ai);
  assert.equal(s.ai.g, 0.9);
  s.ai.decisions = Array(20).fill("LOSS");
  for (let i = 0; i < 30; i++) E.adapt(s.ai);
  assert.equal(s.ai.g, 0.2);
});
test("round freezes env and AI before seed", () => {
  const s = fresh();
  round(s);
  env.rpm = 99;
  assert.equal(s.round.env.rpm, 60);
  env.rpm = 60;
  assert.equal(s.round.A, 468);
});
test("skip no history lives cooldown participation", () => {
  const s = fresh();
  s.round = E.makeRound(s, "skip", at, env, () => 0.5);
  s.round.booster = "Shield";
  assert.equal(E.lock(s, at), false);
  assert.equal(s.round.skipped, true);
  assert.equal(s.counts.participated, 0);
  assert.equal(s.run.lives, 3);
  assert.equal(s.run.ready.Shield, 0);
  assert.equal(s.ai.history.length, 0);
});
test("atomic settlement applies once across reload", () => {
  const s = fresh();
  const r = round(s);
  r.A = r.race.D - 1;
  assert.equal(E.settle(s, at), true);
  const snapshot = JSON.stringify(s);
  assert.equal(E.settle(s, at), false);
  assert.equal(JSON.stringify(s), snapshot);
  const re = E.recover(JSON.parse(snapshot), at).state;
  assert.equal(E.settle(re, at), false);
  assert.equal(JSON.stringify(re), snapshot);
});
test("win damage formula and boss applied cap", () => {
  const s = fresh();
  const r = round(s);
  r.A = r.race.D - 1;
  s.boss[r.week].hp = 12;
  E.settle(s, at);
  assert.equal(r.damage, 12);
  assert.equal(s.run.damage, 12);
  assert.equal(s.boss[r.week].hp, 0);
  assert.equal(s.run.multiplier, 2);
});
test("streak damage grows from incremented streak", () => {
  const s = fresh();
  const r = round(s);
  r.A = r.race.D - 1;
  E.settle(s, at);
  assert.equal(r.damage, Math.round(r.race.D * 1.1 * 1.125));
  assert.equal(s.run.streak, 1);
  assert.equal(s.run.best, 1);
});
test("Shield preserves lives resets streak", () => {
  const s = fresh();
  s.run.streak = 4;
  const r = round(s, "calib-0", "OVER", "Shield");
  r.A = r.race.D + 1;
  E.settle(s, at);
  assert.equal(s.run.lives, 3);
  assert.equal(s.run.streak, 0);
});
test("Double Down doubles life loss", () => {
  const s = fresh();
  const r = round(s, "calib-0", "OVER", "Double Down");
  r.A = r.race.D + 1;
  E.settle(s, at);
  assert.equal(s.run.lives, 1);
});
test("Double Down doubles win damage", () => {
  const s = fresh();
  const r = round(s, "calib-0", "OVER", "Double Down");
  r.A = r.race.D - 1;
  E.settle(s, at);
  assert.equal(r.damage, Math.round(r.race.D * 1.1 * 1.125 * 2));
});
test("neutral spends booster advances participation keeps streak lives damage", () => {
  const s = fresh();
  s.run.streak = 3;
  const r = round(s, "calib-0", "OVER", "Insight");
  r.A = r.race.D;
  E.settle(s, at);
  assert.equal(r.outcome, "PUSH");
  assert.equal(s.counts.participated, 1);
  assert.equal(s.run.streak, 3);
  assert.equal(s.run.lives, 3);
  assert.equal(s.run.damage, 0);
  assert.equal(s.run.ready.Insight, 5);
  assert.equal(s.ai.decisions.length, 0);
});
test("cooldown n+c+1 excludes skips", () => {
  const s = fresh();
  round(s, "a", "OVER", "Shield");
  assert.equal(s.run.ready.Shield, 5);
  s.counts.participated = 3;
  assert.equal(E.available(s, "Shield"), false);
  s.counts.participated = 4;
  assert.equal(E.available(s, "Shield"), true);
});
test("run over logs once and new run preserves raid and AI", () => {
  const s = fresh();
  s.run.lives = 1;
  const r = round(s);
  r.A = r.race.D + 1;
  E.settle(s, at);
  assert.equal(r.phase, "RUN_OVER");
  assert.equal(s.top10.length, 1);
  E.finishRun(s, at);
  assert.equal(s.top10.length, 1);
  const boss = JSON.stringify(s.boss),
    ai = JSON.stringify(s.ai);
  s.run = E.newRun("new", at);
  assert.equal(JSON.stringify(s.boss), boss);
  assert.equal(JSON.stringify(s.ai), ai);
  assert.equal(s.run.lives, 3);
  assert.equal(s.run.ready.Shield, 0);
});
test("ISO week year and Monday boundary UTC", () => {
  assert.equal(E.week(Date.UTC(2021, 0, 1)), "2020-W53");
  assert.equal(E.week(Date.UTC(2026, 9, 25, 23, 59)), "2026-W43");
  assert.equal(E.week(Date.UTC(2026, 9, 26)), "2026-W44");
});
test("cross-boundary damage hits frozen old boss", () => {
  const s = fresh();
  const r = round(s);
  r.week = "2026-W43";
  s.boss[r.week] = { hp: 50000 };
  r.A = r.race.D - 1;
  E.settle(s, at);
  assert.ok(s.boss["2026-W43"].hp < 50000);
  assert.equal(s.boss["2026-W44"].hp, 50000);
});
test("loot threshold exact boundaries", () =>
  assert.equal(
    [50000, 37500, 25000, 12500, 0].map(E.loot).join(","),
    "1,1.1,1.25,1.5,2",
  ));
test("top10 sorted score streak then earliest date", () => {
  const s = fresh();
  for (let i = 11; i >= 0; i--) {
    s.run = E.newRun("run" + i, at + i);
    s.run.best = i % 3;
    E.finishRun(s, at + i);
  }
  assert.equal(s.top10.length, 10);
  assert.equal(s.top10[0].best, 2);
});
test("bounded art deterministic separate RNG", () => {
  const s = fresh();
  const r = round(s);
  r.outcome = "WIN";
  assert.equal(JSON.stringify(E.artGroup(r)), JSON.stringify(E.artGroup(r)));
  const before = JSON.stringify(E.race("a"));
  E.artGroup(r);
  assert.equal(JSON.stringify(E.race("a")), before);
  for (let i = 0; i < 120; i++) {
    const r = round(s, "x" + i);
    r.id = "r" + i;
    r.A = r.race.D - 1;
    E.settle(s, at + i);
  }
  assert.ok(s.art.reduce((a, g) => a + g.primitives.length, 0) <= 2000);
  assert.ok(s.art.length <= 100);
  assert.ok(s.ai.history.length <= 20);
});
test("corrupt-section recovery preserves other sections", () => {
  const s = fresh();
  s.run.lives = 99;
  s.name = "Test";
  const result = E.recover(s, at);
  assert.equal(result.state.run.lives, 3);
  assert.equal(result.state.name, "Test");
  assert.ok(result.recovered.includes("run"));
});
test("damaged round fields recover only the round section", () => {
  const corruptions = [
    (r) => (r.target = "not-a-block"),
    (r) => (r.baseBlock = 42),
    (r) => (r.seedType = "MAINNET"),
    (r) => (r.pausedAt = "soon"),
    (r) => (r.replayStart = null),
    (r) => (r.env.frozenAt = "x"),
    (r) => (r.env.observedAt = "not a date"),
    (r) => (r.env.cooldown = undefined),
    (r) => (r.sigma = NaN),
    (r) => (r.aiZone = "Moon"),
    (r) => (r.race = { ...r.race, zone: undefined }),
    (r) => (r.n = 0),
  ];
  for (const corrupt of corruptions) {
    const s = fresh();
    round(s);
    s.run.streak = 4;
    s.name = "Keep";
    const raw = JSON.parse(JSON.stringify(s));
    corrupt(raw.round);
    const result = E.recover(JSON.parse(JSON.stringify(raw)), at);
    assert.deepEqual([...result.recovered], ["round"], String(corrupt));
    assert.equal(result.state.round, null);
    assert.equal(result.state.run.streak, 4);
    assert.equal(result.state.name, "Keep");
  }
  const ok = fresh();
  round(ok);
  ok.round.target = "0x10";
  ok.round.baseBlock = "0xf";
  assert.equal(E.recover(JSON.parse(JSON.stringify(ok)), at).recovered.length, 0);
});
test("pause/resume persists same seed target and extends timer", () => {
  const s = fresh();
  const r = round(s);
  r.target = "0x123";
  const hash = r.seed;
  E.pause(r, at + 500);
  const copy = E.recover(JSON.parse(JSON.stringify(s)), at + 10000).state;
  E.resume(copy.round, at + 10000);
  assert.equal(copy.round.seed, hash);
  assert.equal(copy.round.target, "0x123");
  assert.equal(copy.round.deadline, r.deadline + 9500);
});
test("balance BigInt four decimals raw fallback", () => {
  const word = "0x" + 1234567891234567890n.toString(16).padStart(64, "0");
  assert.equal(E.formatUnits(word, 18), "1.2345 SQK");
  assert.equal(E.formatUnits(word, null), "1234567891234567890 raw units");
  assert.throws(() => E.formatUnits("0x0", 18));
  assert.throws(() => E.formatUnits(word, 256));
});
test("exact zero transfer ABI only four fields", () => {
  const account = "0x" + "aB".repeat(20),
    tx = E.transfer(account);
  assert.equal(tx.data.length, 138);
  assert.equal(Object.keys(tx).sort().join(","), "data,from,to,value");
  assert.equal(tx.data.slice(10, 74), "ab".repeat(20).padStart(64, "0"));
  assert.equal(tx.data.slice(74), "0".repeat(64));
  assert.equal(tx.value, "0x0");
  assert.throws(() => E.transfer("0x0"));
});
const calibration = E.calibrate();
test("10,000-seed calibration target without retuning", () =>
  assert.equal(calibration.withinTarget, true));
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/engine-results.json",
  JSON.stringify(
    { passed, total: results.length, results, calibration },
    null,
    2,
  ),
);
console.log(`${passed}/${results.length} mechanics checks passed`);
console.log(JSON.stringify(calibration));
if (passed !== results.length) process.exitCode = 1;
