/** Pure mechanics. No network, DOM, storage, clock reads or wallet access. */
namespace Squeek {
  export const PIN = Object.freeze({
    chain: "0xaa36a7",
    chainId: "11155111",
    token: "0x5501e1fa81be1c3f49225fa7668da0245d07db60",
    mining: "0xcd46990f8349057335289ef282c276204b6cdc62",
    core: "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44",
    installation: "stream-game-sepolia-test-20261025-01",
    release: "stream-game-sepolia-test-20261026-01",
    api: "https://api.squeekchain.com",
    explorer: "https://sepolia.etherscan.io",
    rpcs: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://sepolia.drpc.org",
      "https://1rpc.io/sepolia",
    ],
  });
  export type Call = "OVER" | "UNDER" | "Sprint" | "Cruise" | "Marathon";
  export type Booster = "Shield" | "Double Down" | "Insight";
  export type Outcome = "WIN" | "LOSS" | "PUSH" | "DRAW" | "TIE";
  export type Phase = "PREDICT" | "WAIT" | "REPLAY" | "RESULT" | "RUN_OVER";
  export interface Env {
    mode: "LIVE MOVING" | "LIVE STILL" | "PRACTICE";
    rpm: number;
    M: number;
    cooldown: number;
    observedAt: string | null;
    epoch: string;
    work: string;
    reason: string;
    frozenAt: number;
  }
  export interface Race {
    D: number;
    peakRPM: number;
    zone: string;
    tier: string;
    ticks: { v: number; a: number; burst: boolean }[];
  }
  export interface History {
    id: string;
    D: number;
    call: Call;
    outcome: Outcome;
    aiHit: boolean;
    live: boolean;
    at: number;
    seedType: string;
  }
  export interface AI {
    g: number;
    history: History[];
    decisions: Outcome[];
    hits: number;
    seen: number;
    best: number;
  }
  export interface Run {
    id: string;
    active: boolean;
    lives: number;
    streak: number;
    best: number;
    damage: number;
    multiplier: number;
    live: number;
    practice: number;
    started: number;
    logged: boolean;
    ready: Record<Booster, number>;
    lastSeed: string | null;
    lastSeedType: "WAITING" | "LOCAL" | "SEPOLIA";
  }
  export interface ArtGroup {
    id: string;
    primitives: number[][];
  }
  export interface Round {
    id: string;
    phase: Phase;
    deadline: number;
    started: number;
    replayStart: number;
    pausedAt: number | null;
    call: Call | null;
    booster: Booster | null;
    A: number;
    aiZone: string;
    sigma: number;
    env: Env;
    week: string;
    target: string | null;
    baseBlock: string | null;
    seed: string | null;
    seedType: "WAITING" | "SEPOLIA" | "LOCAL";
    race: Race | null;
    applied: boolean;
    outcome: Outcome | null;
    damage: number;
    n: number;
    skipped: boolean;
  }
  export interface RecordEntry {
    id: string;
    score: number;
    date: string;
    name: string;
    best: number;
    damage: number;
  }
  export interface State {
    version: 3;
    ai: AI;
    counts: {
      participated: number;
      wins: number;
      losses: number;
      calls: Record<string, number>;
      runs: number;
      lastVisit: number;
    };
    run: Run;
    round: Round | null;
    applied: string[];
    boss: Record<string, { hp: number }>;
    art: ArtGroup[];
    top10: RecordEntry[];
    dialogue: Record<string, number[]>;
    name: string;
  }
  export const clamp = (x: number, a: number, b: number) =>
    Math.max(a, Math.min(b, x));
  export function xmur3(str: string) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  export function sfc32(a: number, b: number, c: number, d: number) {
    return () => {
      a >>>= 0;
      b >>>= 0;
      c >>>= 0;
      d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  export function rng(seed: string) {
    const h = xmur3(seed);
    return sfc32(h(), h(), h(), h());
  }
  export const zone = (D: number) =>
    D < 436 ? "Sprint" : D < 500 ? "Cruise" : "Marathon";
  export const tier = (rpm: number) =>
    rpm < 145 ? "LOW" : rpm < 170 ? "MID" : "HIGH";
  export function race(seed: string): Race {
    const random = rng(seed);
    let v = 3,
      sum = 0,
      peak = 0;
    const ticks: Race["ticks"] = [];
    for (let i = 0; i < 24; i++) {
      const r1 = random(),
        r2 = random();
      let a = (r1 - 0.5) * 0.6 + 0.1 * (3 - v);
      const burst = r2 < 0.12;
      if (burst) a += 0.8 + random() * 0.8;
      v = clamp(v + a, 0.6, 6);
      sum += v;
      peak = Math.max(peak, v);
      ticks.push({ v, a, burst });
    }
    const D = Math.round(sum * 5),
      peakRPM = Math.round(peak * 30);
    return { D, peakRPM, zone: zone(D), tier: tier(peakRPM), ticks };
  }
  export function stats(ai: AI) {
    const h = ai.history.slice(-20);
    if (h.length < 5) return { baseline: 468, sigma: 67 };
    let weighted = 0,
      weight = 0;
    h.forEach((r, i) => {
      const w = 0.5 ** ((h.length - 1 - i) / 6);
      weighted += r.D * w;
      weight += w;
    });
    const mean = h.reduce((s, r) => s + r.D, 0) / h.length;
    return {
      baseline: weighted / weight,
      sigma: Math.max(
        40,
        Math.sqrt(h.reduce((s, r) => s + (r.D - mean) ** 2, 0) / h.length),
      ),
    };
  }
  export function predict(ai: AI, random: () => number) {
    const { baseline, sigma } = stats(ai);
    const picks = ai.history
      .slice(-20)
      .filter((r) => r.call === "OVER" || r.call === "UNDER");
    const over = picks.length
        ? picks.filter((r) => r.call === "OVER").length / picks.length
        : 0,
      under = picks.length
        ? picks.filter((r) => r.call === "UNDER").length / picks.length
        : 0;
    const r1 = random(),
      r2 = random(),
      r3 = random();
    const A = Math.round(
      baseline +
        ai.g * 0.5 * sigma * (over - under) +
        (r1 + r2 + r3 - 1.5) * sigma * (1 - 0.6 * ai.g),
    );
    return { A, aiZone: zone(A), sigma };
  }
  export function adapt(ai: AI) {
    const decided = ai.decisions.slice(-20);
    if (!decided.length) return;
    const ratio = decided.filter((r) => r === "WIN").length / decided.length;
    if (ratio > 0.55) ai.g = clamp(ai.g + 0.05, 0.2, 0.9);
    else if (ratio < 0.4) ai.g = clamp(ai.g - 0.05, 0.2, 0.9);
  }
  export function resolve(call: Call, D: number, A: number): Outcome {
    if (call === "OVER") return D > A ? "WIN" : D < A ? "LOSS" : "PUSH";
    if (call === "UNDER") return D < A ? "WIN" : D > A ? "LOSS" : "PUSH";
    const p = zone(D) === call,
      a = zone(D) === zone(A);
    return p ? (a ? "TIE" : "WIN") : a ? "LOSS" : "DRAW";
  }
  export function economy(e: any): "match" | "mismatch" | "unavailable" {
    if (!e || e.status !== "available") return "unavailable";
    return e.schemaVersion === 2 &&
      e.installationId === PIN.installation &&
      e.release?.id === PIN.release &&
      e.chain?.chainId === PIN.chainId &&
      typeof e.identities?.token === "string" &&
      e.identities.token.toLowerCase() === PIN.token &&
      typeof e.identities?.core === "string" &&
      e.identities.core.toLowerCase() === PIN.core &&
      typeof e.identities?.mining?.proxy === "string" &&
      e.identities.mining.proxy.toLowerCase() === PIN.mining
      ? "match"
      : "mismatch";
  }
  export function telemetry(s: any, now: number, mismatch = false): Env {
    const practice = (reason: string): Env => ({
      mode: "PRACTICE",
      rpm: 0,
      M: 1,
      cooldown: 3,
      observedAt: null,
      epoch: "practice",
      work: "0",
      reason,
      frozenAt: now,
    });
    if (mismatch)
      return practice("Economy identity mismatch. Live effects disabled.");
    const m = s?.measurement;
    if (s?.schemaVersion !== 1 || s?.installationId !== PIN.installation || !m)
      return practice("Hardware telemetry unavailable.");
    const observed = Date.parse(m.observedAt),
      age = (now - observed) / 1000;
    const stale = m.staleAfterSeconds;
    if (
      m.freshness !== "online" ||
      m.provenance !== "hardware" ||
      !["IDLE", "ACTIVE"].includes(m.coreStatus) ||
      !Number.isFinite(stale) ||
      stale <= 0 ||
      !Number.isFinite(age) ||
      age > Math.min(120, stale) ||
      age < -30 ||
      !Number.isSafeInteger(m.rpmMilli) ||
      m.rpmMilli < 0 ||
      typeof m.counterEpoch !== "string" ||
      typeof m.cumulativeWorkUnits !== "string" ||
      !/^\d+$/.test(m.cumulativeWorkUnits)
    )
      return practice("Hardware sample is stale or unverified.");
    const rpm = m.rpmMilli / 1000;
    return {
      mode: rpm > 0 ? "LIVE MOVING" : "LIVE STILL",
      rpm,
      M: rpm > 0 ? 1 + 0.25 * Math.min(rpm / 120, 1) : 1,
      cooldown: rpm === 0 ? 2 : 3,
      observedAt: m.observedAt,
      epoch: m.counterEpoch,
      work: m.cumulativeWorkUnits,
      reason: "Verified hardware sample",
      frozenAt: now,
    };
  }
  export function week(now: number) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear(),
      start = new Date(Date.UTC(year, 0, 1));
    return `${year}-W${String(Math.ceil(((+d - +start) / 86400000 + 1) / 7)).padStart(2, "0")}`;
  }
  export const loot = (hp: number) =>
    hp > 37500 ? 1 : hp > 25000 ? 1.1 : hp > 12500 ? 1.25 : hp > 0 ? 1.5 : 2;
  export const score = (run: Run) =>
    Math.round((run.damage + 100 * run.best) * run.multiplier);
  export function newRun(id: string, now: number, multiplier = 1): Run {
    return {
      id,
      active: true,
      lives: 3,
      streak: 0,
      best: 0,
      damage: 0,
      multiplier,
      live: 0,
      practice: 0,
      started: now,
      logged: false,
      ready: { Shield: 0, "Double Down": 0, Insight: 0 },
      lastSeed: null,
      lastSeedType: "WAITING",
    };
  }
  export function initial(now: number): State {
    return {
      version: 3,
      ai: { g: 0.5, history: [], decisions: [], hits: 0, seen: 0, best: 0 },
      counts: {
        participated: 0,
        wins: 0,
        losses: 0,
        calls: {},
        runs: 0,
        lastVisit: now,
      },
      run: newRun("initial", now),
      round: null,
      applied: [],
      boss: { [week(now)]: { hp: 50000 } },
      art: [],
      top10: [],
      dialogue: {},
      name: "",
    };
  }
  /** Fields of a saved round consumed by render, seeding and settlement. */
  function validRoundDetail(v: any): boolean {
    const finite = (n: any) => typeof n === "number" && Number.isFinite(n);
    const hexBlock = (x: any) =>
      x === null || (typeof x === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(x));
    const e = v.env;
    return (
      hexBlock(v.target) &&
      hexBlock(v.baseBlock) &&
      ["WAITING", "SEPOLIA", "LOCAL"].includes(v.seedType) &&
      finite(v.replayStart) &&
      v.replayStart >= 0 &&
      (v.pausedAt === null || (finite(v.pausedAt) && v.pausedAt >= 0)) &&
      finite(v.sigma) &&
      v.sigma > 0 &&
      ["Sprint", "Cruise", "Marathon"].includes(v.aiZone) &&
      /^\d{4}-W\d{2}$/.test(v.week) &&
      (v.outcome === null ||
        ["WIN", "LOSS", "PUSH", "DRAW", "TIE"].includes(v.outcome)) &&
      finite(v.damage) &&
      v.damage >= 0 &&
      Number.isInteger(v.n) &&
      v.n >= 1 &&
      typeof v.skipped === "boolean" &&
      finite(e.cooldown) &&
      e.cooldown >= 0 &&
      finite(e.frozenAt) &&
      e.frozenAt >= 0 &&
      (e.observedAt === null ||
        (typeof e.observedAt === "string" &&
          Number.isFinite(Date.parse(e.observedAt)))) &&
      typeof e.epoch === "string" &&
      typeof e.work === "string" &&
      typeof e.reason === "string" &&
      // a seeded round must carry its seed and race; an unseeded one neither
      (v.seed === null) === (v.race === null) &&
      (v.seed === null || v.seedType !== "WAITING") &&
      (!v.applied || v.race !== null)
    );
  }
  export function recover(
    raw: any,
    now: number,
  ): { state: State; recovered: string[] } {
    const state = initial(now),
      recovered: string[] = [];
    if (!raw || raw.version !== 3)
      return { state, recovered: raw ? ["state"] : [] };
    const validNumber = (n: any) => Number.isFinite(n) && n >= 0;
    for (const key of [
      "ai",
      "counts",
      "run",
      "round",
      "applied",
      "boss",
      "art",
      "top10",
      "dialogue",
      "name",
    ] as const) {
      const v = raw[key];
      let ok = false;
      try {
        switch (key) {
          case "ai":
            if (!Array.isArray(v.decisions))
              v.decisions = (v.history || [])
                .filter((h) => h.outcome === "WIN" || h.outcome === "LOSS")
                .map((h) => h.outcome)
                .slice(-20);
            ok =
              Array.isArray(v.decisions) &&
              v.decisions.length <= 20 &&
              v.decisions.every((d) => d === "WIN" || d === "LOSS") &&
              validNumber(v.g) &&
              v.g >= 0.2 &&
              v.g <= 0.9 &&
              Array.isArray(v.history) &&
              v.history.length <= 20 &&
              v.history.every(
                (h) =>
                  validNumber(h.D) &&
                  typeof h.id === "string" &&
                  ["WIN", "LOSS", "PUSH", "DRAW", "TIE"].includes(h.outcome) &&
                  ["OVER", "UNDER", "Sprint", "Cruise", "Marathon"].includes(
                    h.call,
                  ),
              ) &&
              validNumber(v.hits) &&
              validNumber(v.seen) &&
              validNumber(v.best);
            break;
          case "counts":
            ok =
              validNumber(v.participated) &&
              validNumber(v.wins) &&
              validNumber(v.losses) &&
              validNumber(v.runs) &&
              validNumber(v.lastVisit) &&
              v.calls &&
              Object.values(v.calls).every(validNumber);
            break;
          case "run":
            if (v.lastSeed === undefined) {
              v.lastSeed = null;
              v.lastSeedType = "WAITING";
            }
            ok =
              (v.lastSeed === null || typeof v.lastSeed === "string") &&
              ["WAITING", "LOCAL", "SEPOLIA"].includes(v.lastSeedType) &&
              typeof v.id === "string" &&
              typeof v.active === "boolean" &&
              Number.isInteger(v.lives) &&
              v.lives >= 0 &&
              v.lives <= 3 &&
              [
                "streak",
                "best",
                "damage",
                "multiplier",
                "live",
                "practice",
                "started",
              ].every((k) => validNumber(v[k])) &&
              v.ready &&
              ["Shield", "Double Down", "Insight"].every((k) =>
                validNumber(v.ready[k]),
              );
            break;
          case "round":
            ok =
              v === null ||
              (typeof v.id === "string" &&
                ["PREDICT", "WAIT", "REPLAY", "RESULT", "RUN_OVER"].includes(
                  v.phase,
                ) &&
                validNumber(v.deadline) &&
                validNumber(v.started) &&
                Number.isInteger(v.A) &&
                v.env &&
                ["LIVE MOVING", "LIVE STILL", "PRACTICE"].includes(
                  v.env.mode,
                ) &&
                validNumber(v.env.rpm) &&
                validNumber(v.env.M) &&
                typeof v.week === "string" &&
                [
                  null,
                  "OVER",
                  "UNDER",
                  "Sprint",
                  "Cruise",
                  "Marathon",
                ].includes(v.call) &&
                [null, "Shield", "Double Down", "Insight"].includes(
                  v.booster,
                ) &&
                (v.seed === null || typeof v.seed === "string") &&
                (v.race === null ||
                  (validNumber(v.race.D) &&
                    validNumber(v.race.peakRPM) &&
                    ["Sprint", "Cruise", "Marathon"].includes(v.race.zone) &&
                    typeof v.race.tier === "string" &&
                    Array.isArray(v.race.ticks) &&
                    v.race.ticks.length === 24 &&
                    v.race.ticks.every(
                      (t) =>
                        t &&
                        Number.isFinite(t.v) &&
                        t.v >= 0.6 &&
                        t.v <= 6 &&
                        Number.isFinite(t.a) &&
                        typeof t.burst === "boolean",
                    ))) &&
                typeof v.applied === "boolean" &&
                validRoundDetail(v));
            break;
          case "applied":
            ok =
              Array.isArray(v) &&
              v.length <= 256 &&
              v.every((x) => typeof x === "string");
            break;
          case "boss":
            ok =
              v &&
              Object.keys(v).length <= 8 &&
              Object.entries(v).every(
                ([k, b]: [string, any]) =>
                  /^\d{4}-W\d{2}$/.test(k) &&
                  validNumber(b.hp) &&
                  b.hp <= 50000,
              );
            break;
          case "art":
            ok =
              Array.isArray(v) &&
              v.length <= 100 &&
              v.reduce((s, g) => s + g.primitives.length, 0) <= 2000 &&
              v.every(
                (g) =>
                  typeof g.id === "string" &&
                  g.primitives.every(
                    (p) =>
                      Array.isArray(p) &&
                      p.length === 8 &&
                      p.every(Number.isFinite),
                  ),
              );
            break;
          case "top10":
            ok =
              Array.isArray(v) &&
              v.length <= 10 &&
              v.every(
                (r) =>
                  validNumber(r.score) &&
                  validNumber(r.best) &&
                  typeof r.name === "string" &&
                  r.name.length <= 42 &&
                  typeof r.date === "string",
              );
            break;
          case "dialogue":
            ok =
              v &&
              typeof v === "object" &&
              Object.values(v).every(
                (x) =>
                  Array.isArray(x) &&
                  x.length <= 12 &&
                  x.every(Number.isInteger),
              );
            break;
          case "name":
            ok = typeof v === "string" && v.length <= 20;
        }
      } catch {
        ok = false;
      }
      if (ok) (state as any)[key] = v;
      else recovered.push(key);
    }
    if (recovered.includes("run")) state.round = null;
    return { state, recovered };
  }
  export function makeRound(
    state: State,
    id: string,
    now: number,
    env: Env,
    random: () => number,
  ): Round {
    const w = week(now);
    if (!state.boss[w]) state.boss[w] = { hp: 50000 };
    const keys = Object.keys(state.boss).sort();
    while (keys.length > 8) delete state.boss[keys.shift()!];
    state.run.multiplier = Math.max(
      state.run.multiplier,
      loot(state.boss[w].hp),
    );
    return {
      id,
      phase: "PREDICT",
      deadline: now + 12000,
      started: now,
      replayStart: 0,
      pausedAt: null,
      call: null,
      booster: null,
      ...predict(state.ai, random),
      env: { ...env },
      week: w,
      target: null,
      baseBlock: null,
      seed: null,
      seedType: "WAITING",
      race: null,
      applied: false,
      outcome: null,
      damage: 0,
      n: state.counts.participated + 1,
      skipped: false,
    };
  }
  export function canCall(r: Round, call: Call) {
    return (
      ["OVER", "UNDER", "Sprint", "Cruise", "Marathon"].includes(call) &&
      !(call === r.aiZone)
    );
  }
  export function available(state: State, b: Booster) {
    return state.counts.participated + 1 >= state.run.ready[b];
  }
  export function lock(state: State, now: number) {
    const r = state.round;
    if (!r || r.phase !== "PREDICT") return false;
    if (!r.call) {
      r.skipped = true;
      r.phase = "RESULT";
      r.deadline = now + 4000;
      return false;
    }
    if (!canCall(r, r.call)) return false;
    if (r.booster) {
      if (!available(state, r.booster)) {
        r.booster = null;
      } else {
        const c = r.booster === "Shield" ? r.env.cooldown : 3;
        state.run.ready[r.booster] = r.n + c + 1;
      }
    }
    r.phase = "WAIT";
    r.deadline = now + 45000;
    return true;
  }
  export function seedRound(
    r: Round,
    seed: string,
    type: "LOCAL" | "SEPOLIA",
    now: number,
  ) {
    if (r.phase !== "WAIT" || r.seed !== null) return false;
    r.seed = seed;
    r.seedType = type;
    r.race = race(seed);
    r.phase = "REPLAY";
    r.replayStart = now;
    r.deadline = now + 6000;
    return true;
  }
  export function artGroup(r: Round): ArtGroup {
    const random = rng("art|" + r.seed + "|" + r.env.epoch + "|" + r.env.work);
    const primitives: number[][] = [];
    const density = 10 + Math.round(Math.min(r.env.rpm, 180) / 3);
    const angle = random() * Math.PI * 2;
    for (let i = 0; i < density; i++) {
      const a = angle + i * 0.2,
        rad = 0.08 + random() * 0.38;
      const x = 0.5 + Math.cos(a) * rad,
        y = 0.5 + Math.sin(a) * rad;
      const mode = r.race?.ticks[i % 24]?.burst
        ? 2
        : r.env.mode === "PRACTICE"
          ? 2
          : r.env.mode === "LIVE STILL"
            ? 1
            : i % 4;
      primitives.push([
        mode,
        x,
        y,
        0.008 + random() * 0.04,
        a,
        random(),
        r.outcome === "WIN" ? 1 : 0,
        0.2 + random() * 0.6,
      ]);
    }
    return { id: r.id, primitives };
  }
  export function finishRun(state: State, now: number) {
    const run = state.run;
    if (run.logged) return;
    run.logged = true;
    run.active = false;
    state.counts.runs++;
    state.top10.push({
      id: run.id,
      score: score(run),
      date: new Date(now).toISOString(),
      name: state.name || "GUEST",
      best: run.best,
      damage: run.damage,
    });
    state.top10.sort(
      (a, b) =>
        b.score - a.score || b.best - a.best || a.date.localeCompare(b.date),
    );
    state.top10 = state.top10.slice(0, 10);
  }
  export function settle(state: State, now: number) {
    const r = state.round;
    if (!r?.race || !r.call || r.applied || state.applied.includes(r.id))
      return false;
    const run = state.run;
    run.lastSeed = r.seed;
    run.lastSeedType = r.seedType;
    r.outcome = resolve(r.call, r.race.D, r.A);
    r.applied = true;
    state.applied.push(r.id);
    state.applied = state.applied.slice(-256);
    const b = state.boss[r.week] || (state.boss[r.week] = { hp: 50000 });
    run.multiplier = Math.max(run.multiplier, loot(b.hp));
    if (r.outcome === "WIN") {
      run.streak++;
      run.best = Math.max(run.best, run.streak);
      state.ai.best = Math.max(state.ai.best, run.best);
      const damage = Math.round(
        r.race.D *
          (1 + 0.1 * Math.min(run.streak, 10)) *
          r.env.M *
          (r.booster === "Double Down" ? 2 : 1),
      );
      r.damage = Math.min(b.hp, damage);
      b.hp -= r.damage;
      run.damage += r.damage;
      state.counts.wins++;
    } else if (r.outcome === "LOSS") {
      run.streak = 0;
      run.lives = Math.max(
        0,
        run.lives -
          (r.booster === "Shield" ? 0 : r.booster === "Double Down" ? 2 : 1),
      );
      state.counts.losses++;
    }
    run.multiplier = Math.max(run.multiplier, loot(b.hp));
    if (r.env.mode === "PRACTICE") run.practice++;
    else run.live++;
    state.counts.participated++;
    state.counts.calls[r.call] = (state.counts.calls[r.call] || 0) + 1;
    const aiHit = r.race.zone === r.aiZone;
    state.ai.hits += aiHit ? 1 : 0;
    state.ai.seen++;
    state.ai.history.push({
      id: r.id,
      D: r.race.D,
      call: r.call,
      outcome: r.outcome,
      aiHit,
      live: r.env.mode !== "PRACTICE",
      at: now,
      seedType: r.seedType,
    });
    state.ai.history = state.ai.history.slice(-20);
    if (r.outcome === "WIN" || r.outcome === "LOSS") {
      state.ai.decisions.push(r.outcome);
      state.ai.decisions = state.ai.decisions.slice(-20);
      adapt(state.ai);
    }
    state.art.push(artGroup(r));
    while (
      state.art.reduce((s, g) => s + g.primitives.length, 0) > 2000 ||
      state.art.length > 100
    )
      state.art.shift();
    r.phase = "RESULT";
    r.deadline = now + 4000;
    if (run.lives === 0) {
      finishRun(state, now);
      r.phase = "RUN_OVER";
    }
    return true;
  }
  export function pause(r: Round | null, now: number) {
    if (r && r.pausedAt === null) r.pausedAt = now;
  }
  export function resume(r: Round | null, now: number) {
    if (r && r.pausedAt !== null) {
      const d = Math.max(0, now - r.pausedAt);
      r.deadline += d;
      r.started += d;
      if (r.replayStart) r.replayStart += d;
      r.pausedAt = null;
    }
  }
  export function formatUnits(hex: string, decimals: number | null) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw Error("Invalid balance");
    const v = BigInt(hex);
    if (decimals === null) return v.toString() + " raw units";
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
      throw Error("Invalid decimals");
    const div = 10n ** BigInt(decimals),
      whole = v / div;
    const frac = (v % div)
      .toString()
      .padStart(decimals, "0")
      .slice(0, 4)
      .replace(/0+$/, "");
    return whole.toString() + (frac ? "." + frac : "") + " SQK";
  }
  export function transfer(account: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw Error("Invalid sender");
    const data =
      "0xa9059cbb" +
      account.slice(2).toLowerCase().padStart(64, "0") +
      "0".repeat(64);
    if (data.length !== 138) throw Error("Invalid transfer length");
    return { from: account, to: PIN.token, data, value: "0x0" };
  }
  export function classify(error: any) {
    const code = error?.code,
      msg = String(error?.message || error);
    if (code === 4001) return "Request rejected. You can keep playing.";
    if (code === -32002)
      return "A wallet request is already open. Check your wallet.";
    if (/insufficient|funds/i.test(msg))
      return "Not enough test ETH for gas. Add Sepolia test ETH, then try again.";
    if (/revert|execution|false/i.test(msg))
      return "Contract simulation failed. Nothing was sent.";
    return "Network or wallet unavailable. Check your connection and try again.";
  }
  export function calibrate() {
    const zones = { Sprint: 0, Cruise: 0, Marathon: 0 },
      tiers = { LOW: 0, MID: 0, HIGH: 0 };
    let min = Infinity,
      max = 0;
    for (let i = 0; i < 10000; i++) {
      const r = race("calib-" + i);
      zones[r.zone]++;
      tiers[r.tier]++;
      min = Math.min(min, r.D);
      max = Math.max(max, r.D);
    }
    return {
      samples: 10000,
      zones,
      tiers,
      min,
      max,
      withinTarget: [...Object.values(zones), ...Object.values(tiers)].every(
        (n) => n >= 2500 && n <= 4000,
      ),
    };
  }
}
