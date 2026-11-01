/** Browser adapter. Runtime is vanilla JS, Canvas and Web Audio; all resources are inline. */
namespace SqueekApp {
  const E = Squeek,
    P = E.PIN;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const text = (id: string, value: any) => {
    const el = $(id);
    const s = String(value);
    if (el.textContent !== s) el.textContent = s;
  };
  const show = (id: string, yes: boolean) => ($(id).hidden = !yes);
  const button = (id: string) => $<HTMLButtonElement>(id);
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  let sessionOnly = false;
  const ram: Record<string, string> = {};
  const storage = {
    get(key: string) {
      try {
        return localStorage.getItem(key) ?? ram[key] ?? null;
      } catch {
        sessionOnly = true;
        return ram[key] ?? null;
      }
    },
    set(key: string, value: string) {
      ram[key] = value;
      try {
        localStorage.setItem(key, value);
      } catch {
        sessionOnly = true;
      }
    },
  };
  const parse = (v: string | null) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const now = () => Date.now();
  const randomHex = () => {
    const a = new Uint8Array(32);
    crypto.getRandomValues(a);
    return (
      "0x" + Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("")
    );
  };
  const random = () => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  };
  const id = () => randomHex();
  const rawState = storage.get("squeek.state.v3");
  const parsedState = parse(rawState);
  const saved = E.recover(parsedState, now());
  if (rawState && !parsedState) saved.recovered.push("state (invalid JSON)");
  let state = saved.state;
  const returned = now() - state.counts.lastVisit > 86400000;
  state.counts.lastVisit = now();
  const rawSettings = parse(storage.get("squeek.settings.v3"));
  const settings = {
    theme: rawSettings?.theme === "charcoal" ? "charcoal" : "cream",
    mute: rawSettings?.mute !== false,
    tutorial: rawSettings?.tutorial === true,
  };
  let manuallyPaused = false,
    visibilityGeneration = 0,
    apiStatus: any = null,
    economyValue: any = null,
    economyCheck: "match" | "mismatch" | "unavailable" = "unavailable";
  let current = E.telemetry(null, now()),
    statusFailure = 0,
    economyFailure = 0,
    statusNext = 0,
    economyNext = 0,
    statusBusy = false,
    economyBusy = false;
  let seedBusy = false,
    seedNext = 0,
    seedFailures = 0,
    roundNumber = state.counts.participated + 1;
  let audio: AudioContext | null = null,
    pngURL: string | null = null,
    lastFrame = 0,
    lastScene = 0,
    // the visible call controls follow a saved call, so a restored zone call stays visible
    mode: "duel" | "zone" =
      state.round?.call && !["OVER", "UNDER"].includes(state.round.call)
        ? "zone"
        : "duel";
  let helpPaused = false,
    lastPhase = "",
    lastArt = "",
    lastRecords = "",
    lastRoundSaved = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const active = () => !document.hidden && !manuallyPaused && !helpPaused;
  function save() {
    state.counts.lastVisit = now();
    storage.set("squeek.state.v3", JSON.stringify(state));
    if (sessionOnly) {
      text(
        "storageNotice",
        "Session only: browser storage is unavailable. Keep this tab open to keep your run.",
      );
      show("storageNotice", true);
    }
  }
  function saveSettings() {
    storage.set("squeek.settings.v3", JSON.stringify(settings));
    if (sessionOnly) save();
  }
  function announce(message: string) {
    text("announcer", message);
  }
  function applyTheme() {
    document.documentElement.classList.add("theme-changing");
    document.documentElement.dataset.theme = settings.theme;
    button("themeBtn").setAttribute(
      "aria-label",
      settings.theme === "cream" ? "Use charcoal theme" : "Use cream theme",
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        settings.theme === "cream" ? "#f4f0e7" : "#222420",
      );
    requestAnimationFrame(() =>
      document.documentElement.classList.remove("theme-changing"),
    );
  }
  function sound(freq = 330, win = false) {
    if (settings.mute || !active()) return;
    try {
      if (!audio) return;
      const o = audio.createOscillator(),
        g = audio.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(freq, audio.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        win ? freq * 1.5 : freq * 0.7,
        audio.currentTime + 0.1,
      );
      g.gain.setValueAtTime(0.025, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.16);
    } catch {}
  }
  function audioGesture() {
    if (settings.mute || !active()) return;
    try {
      if (!audio) audio = new AudioContext();
      void audio.resume();
    } catch {}
  }
  document.addEventListener("pointerdown", audioGesture, { passive: true });
  document.addEventListener("keydown", audioGesture);
  function suspend() {
    visibilityGeneration++;
    E.pause(state.round, now());
    save();
    void audio?.suspend();
  }
  function resume() {
    if (!active()) return;
    E.resume(state.round, now());
    save();
    if (!settings.mute && audio) void audio.resume();
    statusNext = 0;
    seedNext = 0;
  }
  const lines: Record<string, string[]> = {
    first: [
      "One wheel. Three lives. Your call.",
      "Welcome to the tiny resistance.",
      "The wheel is small. Your nerve is not.",
      "Robo brought maths. You brought instincts.",
      "Pick a side. Give the wheel a reason.",
      "A fresh wheel is a beautiful thing.",
      "The robot has never met your kind of chaos.",
      "Three lives. Plenty of possibilities.",
      "Make yourself at home in the wheel.",
      "The hamster believes in beginners.",
      "A little courage goes a long way around.",
      "Your first call starts the story.",
    ],
    return: [
      "Back for another revolution?",
      "The wheel kept your seat warm.",
      "Robo missed being challenged. Allegedly.",
      "Your tiny rival has been waiting.",
      "Welcome back to the running business.",
      "The hamster remembers a good teammate.",
      "Another day, another robot to bother.",
      "Dust off those prediction skills.",
      "Fresh eyes. Same determined hamster.",
      "You and this wheel go way back.",
      "A familiar face, a new lap.",
      "The wheel turns better with you here.",
    ],
    streak: [
      "Three in a row. Robo is recalculating.",
      "Keep that lucky little wheel turning.",
      "A streak with teeth.",
      "Robo would like to file a complaint.",
      "You are becoming a statistical nuisance.",
      "Momentum looks good on you.",
      "That is a very confident hamster.",
      "A hot streak in a small wheel.",
      "Let the robot worry about the numbers.",
      "Your calls are finding their rhythm.",
      "Somebody tell Robo to keep up.",
      "This wheel runs on confidence.",
    ],
    twoLosses: [
      "Two bumps. Still a wheel.",
      "Take a breath. Read the call.",
      "Robo got a couple. You get the next choice.",
      "A pause can be part of the strategy.",
      "The wheel has room for a comeback.",
      "Even good instincts need a warm-up.",
      "Try another angle around the wheel.",
      "No shame in a slower lap.",
      "The next call is a fresh decision.",
      "The hamster is still on your side.",
      "A rough patch is not the whole road.",
      "Let the last two laps go.",
    ],
    favourite: [
      "You have a favourite call. Robo noticed.",
      "A familiar move. Will it land again?",
      "Your signature call is getting a reputation.",
      "Comfort can be a strategy. So can surprise.",
      "Robo has been counting your habits.",
      "Your favourite has seen plenty of laps.",
      "One call keeps finding its way back.",
      "A signature is only yours to change.",
      "Patterns make for interesting opponents.",
      "The wheel recognises your style.",
      "Robo thinks it knows your next move.",
      "A familiar path can still surprise.",
    ],
    close: [
      "That one was close enough to squeak.",
      "A whisker made the difference.",
      "The wheel barely had room to decide.",
      "A tiny margin. A very big feeling.",
      "Robo checked that number twice.",
      "A finish for the photo album.",
      "That was a whisker-width duel.",
      "Sometimes the small numbers matter most.",
      "The whole wheel held its breath.",
      "A close call makes a loud squeak.",
      "Almost side by side at the finish.",
      "Every little tick counted there.",
    ],
    preRound: [
      "Robo has a number. What is your move?",
      "Trust your whiskers. Then lock it in.",
      "Another lap, another little rebellion.",
      "Read the number. Find your angle.",
      "The next revolution is yours to call.",
      "A robot can count. Can it predict you?",
      "The wheel is ready when you are.",
      "Tiny feet. Big decisions.",
      "Place a prediction, not a bet.",
      "A new call is a clean slate.",
      "The finish line is still unwritten.",
      "What do your instincts say?",
    ],
    win: [
      "A clean hit. The wheel approves.",
      "Robo just lost a little composure.",
      "That is how you rattle a robot.",
      "Good call. Great little hamster.",
      "A win with a side of wheel dust.",
      "Your instincts just paid in pixels.",
      "That left a mark on Robo.",
      "The hamster takes a tiny victory lap.",
      "One more dent in the machine.",
      "Robo did not see that coming.",
      "A small wheel makes a big point.",
      "Chalk one up for the whiskers.",
    ],
    loss: [
      "A miss. The next call is still yours.",
      "Robo gets this one. Keep your whiskers up.",
      "Not every lap goes to plan.",
      "The wheel wobbles. It does not judge.",
      "A robot can get lucky too.",
      "Let that lap become a lesson.",
      "That one belongs to Robo.",
      "A little setback, a fresh decision.",
      "The hamster is rooting for your comeback.",
      "Read the next number with fresh eyes.",
      "The wheel keeps the good with the bad.",
      "Even a miss leaves an interesting mark.",
    ],
    lowLives: [
      "One life. Make it a thoughtful call.",
      "Shield might be a friend right now.",
      "A tiny heartbeat is still a heartbeat.",
      "The last life has plenty of courage.",
      "Stay calm. The wheel is still yours.",
      "One more chance to turn things around.",
      "A careful call can go a long way.",
      "Robo has not won this run yet.",
      "Last life. Same determined whiskers.",
      "You can pause and catch your breath.",
      "The smallest comeback starts here.",
      "One life is enough for the next lap.",
    ],
  };
  function say(category: string) {
    let used = state.dialogue[category] || [];
    const previous = used[used.length - 1];
    if (used.length >= 12) used = [];
    const choices = lines[category]
      .map((_, i) => i)
      .filter((i) => !used.includes(i) && i !== previous);
    const pick = choices[Math.floor(random() * choices.length)];
    used.push(pick);
    state.dialogue[category] = used;
    text("dialogue", lines[category][pick]);
  }
  function preDialogue() {
    if (state.run.lives === 1) return say("lowLives");
    if (state.run.streak >= 3) return say("streak");
    if (
      state.ai.history.slice(-2).length === 2 &&
      state.ai.history.slice(-2).every((h) => h.outcome === "LOSS")
    )
      return say("twoLosses");
    const total = Object.values(state.counts.calls).reduce((a, b) => a + b, 0);
    if (
      total >= 10 &&
      Object.values(state.counts.calls).some((n) => n / total > 0.5)
    )
      return say("favourite");
    say("preRound");
  }
  function refreshEnv() {
    current = E.telemetry(apiStatus, now(), economyCheck === "mismatch");
  }
  function beginRound() {
    if (!state.run.active) return;
    refreshEnv();
    state.round = E.makeRound(state, id(), now(), current, random);
    roundNumber = state.counts.participated + 1;
    seedNext = 0;
    seedFailures = 0;
    mode = "duel";
    preDialogue();
    save();
    render();
  }
  function choose(call: Squeek.Call) {
    const r = state.round;
    if (!r || r.phase !== "PREDICT" || !active() || !E.canCall(r, call)) return;
    r.call = call;
    save();
    sound(220);
    render();
  }
  function chooseBooster(b: Squeek.Booster) {
    const r = state.round;
    if (!r || r.phase !== "PREDICT" || !active() || !E.available(state, b))
      return;
    r.booster = r.booster === b ? null : b;
    save();
    render();
  }
  function lock() {
    if (!active()) return;
    const committed = E.lock(state, now());
    save();
    if (committed) {
      announce(
        "Call locked. Waiting for an exact future block, up to 45 seconds.",
      );
      sound(440);
      void seedPoll();
    }
    render();
  }
  async function fetchJSON(url: string, body?: any) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) {
        const e: any = Error("HTTP " + response.status);
        const retry = response.headers.get("Retry-After");
        const seconds = retry ? Number(retry) : NaN;
        e.retry = Number.isFinite(seconds)
          ? E.clamp(seconds * 1000, 2000, 30000)
          : retry
            ? E.clamp(Date.parse(retry) - now(), 2000, 30000)
            : 0;
        throw e;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
  function backoff(f: number, error?: any) {
    return Math.max(
      error?.retry || 0,
      Math.min(30000, 2000 * 2 ** Math.min(f, 4)),
    );
  }
  let rpcIndex = 0,
    rpcID = 0,
    rpcNotBefore = 0,
    rpcFailure = 0;
  const rpcChains: Record<string, number> = {};
  let publicCode: boolean | null = null,
    publicCodeBusy = false,
    publicCodeNext = 0;
  async function rpc(method: string, params: any[], guard = () => true) {
    if (now() < rpcNotBefore) throw Error("RPC backoff");
    let error: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!guard()) throw Error("Obsolete request");
      const endpoint = P.rpcs[(rpcIndex + attempt) % P.rpcs.length];
      try {
        if (!rpcChains[endpoint] || now() - rpcChains[endpoint] > 300000) {
          const chain = await fetchJSON(endpoint, {
            jsonrpc: "2.0",
            id: ++rpcID,
            method: "eth_chainId",
            params: [],
          });
          if (
            !guard() ||
            typeof chain?.result !== "string" ||
            chain.result.toLowerCase() !== P.chain
          )
            throw Error("RPC chain is not verified Sepolia");
          rpcChains[endpoint] = now();
        }
        const reply = await fetchJSON(endpoint, {
          jsonrpc: "2.0",
          id: ++rpcID,
          method,
          params,
        });
        if (!guard()) throw Error("Obsolete request");
        if (
          reply?.jsonrpc !== "2.0" ||
          reply.error ||
          !Object.prototype.hasOwnProperty.call(reply, "result")
        )
          throw Error("Unknown RPC response");
        rpcIndex = (rpcIndex + attempt) % P.rpcs.length;
        rpcFailure = 0;
        return reply.result;
      } catch (e) {
        error = e;
        if ((e as any)?.retry) {
          rpcNotBefore = now() + (e as any).retry;
          break;
        }
      }
    }
    rpcFailure++;
    rpcNotBefore = now() + backoff(rpcFailure, error);
    throw error || Error("RPC unavailable");
  }
  async function pollPublicCode() {
    if (
      publicCodeBusy ||
      !active() ||
      now() < publicCodeNext ||
      state.round?.phase === "WAIT"
    )
      return;
    publicCodeBusy = true;
    const generation = visibilityGeneration;
    try {
      const results: boolean[] = [];
      for (const address of [P.token, P.mining, P.core]) {
        const code = await rpc(
          "eth_getCode",
          [address, "latest"],
          () => active() && generation === visibilityGeneration,
        );
        results.push(isCode(code));
      }
      if (generation !== visibilityGeneration) return;
      publicCode = results.every(Boolean);
      publicCodeNext = now() + 300000;
    } catch {
      publicCode = null;
      publicCodeNext = now() + 30000;
    } finally {
      publicCodeBusy = false;
      renderWallet();
    }
  }
  async function pollStatus() {
    if (statusBusy || !active() || now() < statusNext) return;
    statusBusy = true;
    const generation = visibilityGeneration;
    try {
      const value = await fetchJSON(P.api + "/v1/status");
      if (generation !== visibilityGeneration || !active()) return;
      apiStatus = value;
      statusFailure = 0;
      statusNext = now() + 5000;
    } catch (e) {
      if (generation !== visibilityGeneration) return;
      apiStatus = null;
      statusFailure++;
      statusNext = now() + Math.max(5000, backoff(statusFailure, e));
    } finally {
      statusBusy = false;
      refreshEnv();
      render();
    }
  }
  async function pollEconomy() {
    if (economyBusy || !active() || now() < economyNext) return;
    economyBusy = true;
    const generation = visibilityGeneration;
    try {
      const value = await fetchJSON(P.api + "/v1/economy/state");
      if (generation !== visibilityGeneration || !active()) return;
      economyValue = value;
      economyCheck = E.economy(value);
      economyFailure = 0;
      economyNext = now() + 30000;
    } catch (e) {
      if (generation !== visibilityGeneration) return;
      economyValue = null;
      economyCheck = "unavailable";
      economyFailure++;
      economyNext = now() + backoff(economyFailure, e);
    } finally {
      economyBusy = false;
      refreshEnv();
      render();
    }
  }
  async function seedPoll() {
    const r = state.round;
    if (seedBusy || !active() || !r || r.phase !== "WAIT" || now() < seedNext)
      return;
    if (now() >= r.deadline) {
      seedLocal(r);
      return;
    }
    seedBusy = true;
    const rid = r.id,
      generation = visibilityGeneration;
    const guard = () =>
      state.round?.id === rid &&
      state.round.phase === "WAIT" &&
      state.round.seed === null &&
      active() &&
      generation === visibilityGeneration &&
      now() < r.deadline;
    try {
      if (r.target === null) {
        const latest = await rpc(
          "eth_getBlockByNumber",
          ["latest", false],
          guard,
        );
        if (!guard()) return;
        if (!latest || !/^0x[0-9a-f]+$/i.test(latest.number))
          throw Error("Latest block unknown");
        r.baseBlock = latest.number;
        r.target = "0x" + (BigInt(latest.number) + 1n).toString(16);
        save();
      }
      if (!guard()) return;
      const block = await rpc("eth_getBlockByNumber", [r.target, false], guard);
      if (!guard()) return;
      if (block === null) {
        seedNext = now() + 4000;
        return;
      }
      if (
        !block ||
        typeof block.number !== "string" ||
        BigInt(block.number) !== BigInt(r.target) ||
        !/^0x[0-9a-f]{64}$/i.test(block.hash)
      )
        throw Error("Target block unknown");
      if (E.seedRound(r, block.hash, "SEPOLIA", now())) {
        save();
        announce("Future block received. Race replay started.");
      }
      seedFailures = 0;
    } catch (e) {
      seedFailures++;
      seedNext = now() + Math.max(4000, backoff(seedFailures, e));
    } finally {
      seedBusy = false;
      render();
    }
  }
  function seedLocal(r: Squeek.Round) {
    if (state.round?.id !== r.id || r.phase !== "WAIT") return;
    E.seedRound(r, randomHex(), "LOCAL", now());
    save();
    announce("Local cryptographic seed selected. Race replay started.");
    render();
  }
  function tick() {
    if (!active()) return;
    refreshEnv();
    const r = state.round;
    if (r) {
      if (r.phase === "PREDICT" && now() >= r.deadline) lock();
      else if (r.phase === "WAIT") {
        if (now() >= r.deadline) seedLocal(r);
        else void seedPoll();
      } else if (r.phase === "REPLAY" && now() >= r.deadline) {
        if (E.settle(state, now())) {
          const close = r.race && Math.abs(r.race.D - r.A) <= 10;
          if (close) say("close");
          else if (r.outcome === "WIN")
            say(state.run.streak >= 3 ? "streak" : "win");
          else if (r.outcome === "LOSS")
            say(state.run.lives === 1 ? "lowLives" : "loss");
          else preDialogue();
          text(
            "dialogue",
            $("dialogue").textContent +
              " " +
              {
                LOW: "A steady little lap.",
                MID: "A brisk lap around.",
                HIGH: "Those feet found top gear.",
              }[r.race!.tier],
          );
          save();
          announce(
            `${r.outcome}. Distance ${r.race!.D}. ${r.damage} boss damage. ${state.run.lives} lives left.`,
          );
          sound(r.outcome === "WIN" ? 550 : 160, r.outcome === "WIN");
          void refreshWallet();
        }
      } else if (r.phase === "RESULT" && now() >= r.deadline) beginRound();
      if (now() - lastRoundSaved > 1000) {
        lastRoundSaved = now();
        save();
      }
    }
    void pollStatus();
    void pollEconomy();
    void pollPublicCode();
    void receiptPoll();
    render();
  }
  function render() {
    const r = state.round,
      run = state.run;
    text(
      "lives",
      Array.from({ length: 3 }, (_, i) => (i < run.lives ? "●" : "○")).join(
        " ",
      ),
    );
    $("lives").setAttribute("aria-label", run.lives + " lives remaining");
    text("streak", run.streak);
    text("score", E.score(run).toLocaleString("en-US"));
    text("pauseBtn", manuallyPaused ? "Resume" : "Pause");
    text("roundLabel", "Round " + String(roundNumber).padStart(2, "0"));
    text("wheelStatus", current.mode);
    $("wheelStatus").classList.toggle("live", current.mode !== "PRACTICE");
    text("seedBadge", "Seed · " + (r?.seedType || "WAITING"));
    if (r) {
      text("aiNumber", r.A);
      text("aiZone", r.aiZone + " zone");
      text("multiplier", "Damage ×" + r.env.M.toFixed(3));
      text(
        "timer",
        r.phase === "RUN_OVER"
          ? "End"
          : manuallyPaused || helpPaused
            ? "Paused"
            : Math.max(0, Math.ceil((r.deadline - now()) / 1000)) + "s",
      );
      $("timer").setAttribute(
        "aria-label",
        Math.max(0, Math.ceil((r.deadline - now()) / 1000)) +
          " seconds remaining",
      );
      const titles = {
        PREDICT: "Make your prediction",
        WAIT: "Finding your future block",
        REPLAY: "Let the wheel decide",
        RESULT: r.skipped
          ? "No call. Free skip."
          : r.outcome === "WIN"
            ? "Good call. Take the hit."
            : r.outcome === "LOSS"
              ? "Robo wins this one."
              : "A neutral finish.",
        RUN_OVER: "Run over. Wheelprint ready.",
      };
      text("phaseTitle", titles[r.phase]);
      const predicting = r.phase === "PREDICT" && active();
      for (const b of document.querySelectorAll<HTMLButtonElement>(
        "[data-call]",
      )) {
        const c = b.dataset.call as Squeek.Call;
        b.disabled = !predicting || !E.canCall(r, c);
        b.setAttribute("aria-pressed", String(r.call === c));
      }
      for (const b of document.querySelectorAll<HTMLButtonElement>(
        "[data-booster]",
      )) {
        const booster = b.dataset.booster as Squeek.Booster;
        b.disabled = !predicting || !E.available(state, booster);
        b.setAttribute("aria-pressed", String(r.booster === booster));
        const left = Math.max(
          0,
          run.ready[booster] - (state.counts.participated + 1),
        );
        b.title = left
          ? `Ready after ${left} more participated rounds`
          : booster === "Shield"
            ? `Save lives, not streak. Cooldown ${r.env.cooldown} rounds.`
            : booster === "Double Down"
              ? "Double damage or lose two lives. Cooldown 3 rounds."
              : "Historical spread and AI zone accuracy. Cooldown 3 rounds.";
        const small = b.querySelector("small");
        if (small)
          small.textContent = left
            ? `Resting ${left}`
            : booster === "Shield"
              ? "Save lives"
              : booster === "Double Down"
                ? "Double stakes"
                : "Read the odds";
      }
      show("duelCalls", mode === "duel");
      show("zoneCalls", mode === "zone");
      show("zoneHint", mode === "zone");
      button("duelMode").setAttribute("aria-pressed", String(mode === "duel"));
      button("zoneMode").setAttribute("aria-pressed", String(mode === "zone"));
      button("duelMode").disabled = !predicting;
      button("zoneMode").disabled = !predicting;
      button("lockBtn").disabled = !predicting || !r.call;
      text(
        "lockBtn",
        r.phase === "PREDICT"
          ? r.call
            ? `Lock ${r.call === "OVER" ? "Over" : r.call === "UNDER" ? "Under" : r.call} prediction →`
            : "Choose a call to lock in →"
          : r.phase === "WAIT"
            ? "Call locked · waiting for seed"
            : r.phase === "REPLAY"
              ? "Race in motion"
              : r.phase === "RUN_OVER"
                ? "Run complete"
                : "Next round in a moment",
      );
      const message =
        r.phase === "WAIT"
          ? r.target
            ? `Exact target ${BigInt(r.target)}. Local fallback in ${Math.max(0, Math.ceil((r.deadline - now()) / 1000))}s.`
            : "Reading the latest block after lock. Local fallback within 45s."
          : r.phase === "REPLAY"
            ? "24 fixed physics ticks. The outcome is already seeded."
            : r.phase === "PREDICT"
              ? "Virtual distance D decides the duel. Real RPM boosts damage."
              : r.skipped
                ? "Skips cost no lives or boosters and do not enter history."
                : "Lives, boss damage and your wheelprint are saved once.";
      text("roundMessage", message);
      show("insight", r.booster === "Insight");
      text(
        "insight",
        `Spread σ ${Math.round(r.sigma)} D · ` +
          (state.ai.seen
            ? `Robo zone-hit rate ${Math.round((state.ai.hits / state.ai.seen) * 100)}% (${state.ai.seen} races)`
            : "Robo zone-hit rate: no history yet."),
      );
      show("result", r.applied);
      if (r.applied)
        text(
          "result",
          `${r.outcome} · ${r.race!.D} D vs ${r.A} · ${r.race!.zone} · ${r.damage.toLocaleString("en-US")} damage`,
        );
      show("raceReadout", r.phase === "REPLAY" || r.applied);
      if (r.race && (r.phase === "REPLAY" || r.applied)) {
        const count =
          r.phase === "REPLAY"
            ? E.clamp(Math.floor((now() - r.replayStart) / 250), 0, 24)
            : 24;
        const distance =
          r.phase === "REPLAY"
            ? Math.round(
                r.race.ticks.slice(0, count).reduce((a, t) => a + t.v * 5, 0),
              )
            : r.race.D;
        text(
          "raceReadout",
          `${distance} D · ${r.phase === "REPLAY" ? Math.round((r.race.ticks[Math.max(0, count - 1)]?.v || 3) * 30) : r.race.peakRPM} RPM${r.phase === "REPLAY" ? "" : " peak"}`,
        );
      }
      if (lastPhase !== r.id + r.phase) {
        lastPhase = r.id + r.phase;
        drawArt();
      }
    }
    const bossWeek = r?.week || E.week(now()),
      hp = state.boss[bossWeek]?.hp ?? 50000;
    text("bossWeek", bossWeek);
    text("bossHP", hp.toLocaleString("en-US"));
    text("loot", "Loot ×" + E.loot(hp));
    $("hpFill").style.width = (hp / 50000) * 100 + "%";
    $("bossProgress").setAttribute("aria-valuenow", String(hp));
    text(
      "bossStage",
      hp === 0
        ? "Defeated. The duels keep going."
        : hp <= 12500
          ? "Final circuits. The robot is running hot."
          : hp <= 25000
            ? "Half the machine. Twice the attitude."
            : hp <= 37500
              ? "The armour is starting to crack."
              : "A fresh robot. A whole week of trouble.",
    );
    const sample = current.observedAt
      ? `${Math.max(0, Math.round((now() - Date.parse(current.observedAt)) / 1000))}s old`
      : "no verified sample";
    text(
      "telemetryCurrent",
      `Current: ${current.mode} · ${current.rpm.toFixed(3)} RPM · ${sample}. ${current.reason}`,
    );
    if (r) {
      const age = r.env.observedAt
        ? Math.round((now() - Date.parse(r.env.observedAt)) / 1000) +
          "s old now"
        : "practice sample";
      text(
        "telemetryFrozen",
        `Frozen for this round: ${r.env.mode} · ${r.env.rpm.toFixed(3)} RPM · ×${r.env.M.toFixed(3)} · ${age}. Frozen at ${new Date(r.env.frozenAt).toISOString()}.`,
      );
      text(
        "targetInfo",
        `Block target: ${r.target ? BigInt(r.target).toString() : "not selected"} · seed ${r.seedType}`,
      );
      text(
        "seedInfo",
        `Seed hash: ${r.seed || "waiting for lock and a future block"}`,
      );
    }
    text(
      "economyState",
      economyCheck === "match"
        ? "Economy: installation, release, chain and pinned identities match."
        : economyCheck === "mismatch"
          ? "Economy mismatch: live effects and transactions disabled. Pinned addresses unchanged."
          : "Economy unavailable or unknown. This is not an identity mismatch.",
    );
    const committed = r?.phase === "WAIT" || r?.phase === "REPLAY";
    button("endRun").disabled = !!committed || !run.active;
    button("endRun").title = committed
      ? "Finish the committed call first."
      : "";
    show("newRun", !run.active);
    button("newRun").disabled = !!committed;
    show("endRun", run.active);
    button("clearArt").disabled = r?.phase === "REPLAY";
    button("exportBtn").disabled =
      state.run.live + state.run.practice === 0 || r?.phase === "REPLAY";
    text(
      "artCount",
      state.art.length
        ? `${state.art.length} race${state.art.length === 1 ? "" : "s"} in this print`
        : "Waiting for your first mark",
    );
    renderRecords();
    renderWallet();
  }
  function renderRecords() {
    const key = JSON.stringify(state.top10);
    if (lastRecords === key) return;
    lastRecords = key;
    show("recordsTable", state.top10.length > 0);
    show("recordsEmpty", state.top10.length === 0);
    const body = $("recordsBody");
    body.replaceChildren();
    state.top10.forEach((r) => {
      const tr = document.createElement("tr");
      for (const value of [
        r.name + " · " + r.date.slice(0, 10),
        String(r.best),
        r.score.toLocaleString("en-US"),
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    });
  }
  const spriteCache = new Map<string, HTMLCanvasElement>();
  /** A 48×32 logical LED sprite. Four cached gait frames per mood. */
  function hamster(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    frame: number,
    mood: string,
  ) {
    const cacheKey = `${frame % 4}:${mood}`;
    const cached = spriteCache.get(cacheKey);
    ctx.imageSmoothingEnabled = false;
    if (cached) {
      ctx.drawImage(cached, x, y, 48 * scale, 32 * scale);
      return;
    }
    const sprite = document.createElement("canvas");
    sprite.width = 48;
    sprite.height = 32;
    const c = sprite.getContext("2d")!;
    const px = (a: number, b: number, w: number, h: number, color: string) => {
      c.fillStyle = color;
      c.fillRect(a, b, w, h);
    };
    px(5, 13, 3, 6, "#d58b4b");
    px(8, 10, 5, 14, "#e4ad6b");
    px(13, 7, 20, 19, "#edc18a");
    px(30, 5, 9, 18, "#f6d5a4");
    px(29, 2, 7, 6, "#d58b4b");
    px(31, 3, 3, 4, "#f4a38b");
    px(35, 9, 8, 11, "#f6d5a4");
    px(41, 14, 4, 4, "#cb754a");
    px(14, 17, 19, 9, "#f9e9c4");
    px(34, 10, 3, mood === "sleep" ? 1 : 3, "#292b27");
    if (mood === "win") px(34, 9, 3, 1, "#292b27");
    if (mood === "loss") {
      px(33, 9, 2, 1, "#292b27");
      px(35, 10, 2, 1, "#292b27");
    }
    px(40, 20, 3, 1, "#ad623d");
    const legs = [
      [11, 24, 26, 25],
      [14, 25, 30, 24],
      [18, 24, 32, 25],
      [12, 25, 29, 24],
    ][frame % 4];
    px(legs[0], legs[1], 7, 3, "#e4ad6b");
    px(legs[2], legs[3], 7, 3, "#e4ad6b");
    const led = document.createElement("canvas");
    led.width = 192;
    led.height = 128;
    const pixelsContext = led.getContext("2d")!;
    const pixels = c.getImageData(0, 0, 48, 32).data;
    for (let py = 0; py < 32; py++)
      for (let px = 0; px < 48; px++) {
        const j = (py * 48 + px) * 4;
        if (!pixels[j + 3]) continue;
        pixelsContext.fillStyle = `rgb(${pixels[j]},${pixels[j + 1]},${pixels[j + 2]})`;
        pixelsContext.fillRect(px * 4, py * 4, 3.48, 3.48);
      }
    spriteCache.set(cacheKey, led);
    ctx.drawImage(led, x, y, 48 * scale, 32 * scale);
  }
  function robot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    hit = false,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const block = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
    ) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    const body = hit ? "#f8b67e" : "#d57943";
    block(15, 0, 3, 7, body);
    block(13, 0, 7, 3, "#eebc82");
    block(5, 8, 24, 19, body);
    block(1, 12, 4, 11, body);
    block(29, 12, 4, 11, body);
    block(8, 26, 6, 5, body);
    block(21, 26, 6, 5, body);
    block(8, 12, 18, 10, "#383b32");
    block(10, 14, 5, 4, hit ? "#fff6da" : "#faac71");
    block(20, 14, 4, 4, "#faac71");
    block(13, 24, 8, 2, "#383b32");
    ctx.restore();
  }
  function drawArena(time: number) {
    const canvas = $<HTMLCanvasElement>("arena");
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width * dpr)),
      h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d")!;
    c.setTransform(w / 900, 0, 0, h / 400, 0, 0);
    c.fillStyle = "#292b27";
    c.fillRect(0, 0, 900, 400);
    c.fillStyle = "#484a3e";
    for (let x = 22; x < 900; x += 18)
      for (let y = 16; y < 400; y += 18) c.fillRect(x, y, 1, 1);
    const r = state.round;
    const replay = r?.phase === "REPLAY" && r.race;
    const motion = active() && !reduced.matches;
    const angle = motion ? time / (replay ? 850 : 7000) : 0;
    const cx = 265,
      cy = 190,
      R = 145;
    c.strokeStyle = "#77735b";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, R + 9, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "#cf8d50";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "#6b6a53";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, R - 13, 0, Math.PI * 2);
    c.stroke();
    c.save();
    c.translate(cx, cy);
    c.rotate(angle);
    for (let i = 0; i < 24; i++) {
      c.rotate(Math.PI / 12);
      c.strokeStyle = i % 3 === 0 ? "#a69268" : "#69674f";
      c.beginPath();
      c.moveTo(R - 14, 0);
      c.lineTo(R - 2, 0);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = "#77735b";
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(230, 340);
    c.lineTo(265, 280);
    c.lineTo(300, 340);
    c.stroke();
    c.fillStyle = "#a38b62";
    c.fillRect(212, 340, 110, 5);
    c.save();
    c.beginPath();
    c.arc(cx, cy, R - 17, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "#36392e";
    c.fillRect(125, 275, 280, 30);
    c.strokeStyle = "#645b42";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(140, 280);
    c.lineTo(390, 280);
    c.stroke();
    const frame = motion
      ? (replay
          ? Math.floor((now() - (r?.replayStart || 0)) / 100)
          : Math.floor(time / 260)) % 4
      : 0;
    hamster(
      c,
      190,
      173,
      3.25,
      frame,
      r?.outcome === "WIN"
        ? "win"
        : r?.outcome === "LOSS"
          ? "loss"
          : current.mode === "LIVE STILL"
            ? "sleep"
            : "normal",
    );
    c.restore();
    c.strokeStyle = "#8f886b";
    c.setLineDash([3, 9]);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(455, 210);
    c.lineTo(595, 210);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#c7b18d";
    c.font = "16px monospace";
    c.textAlign = "center";
    c.fillText("VS", 525, 190);
    const hit =
      r?.applied &&
      r.outcome === "WIN" &&
      motion &&
      now() - r.deadline + 4000 < 700;
    const bob = motion ? Math.floor(Math.sin(time / 800) * 2) : 0;
    robot(c, 650, 115 + bob, 5, !!hit);
    if (hit) {
      c.strokeStyle = "#f8bd7b";
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        c.beginPath();
        c.moveTo(730 + Math.cos(a) * 100, 200 + Math.sin(a) * 90);
        c.lineTo(730 + Math.cos(a) * 118, 200 + Math.sin(a) * 107);
        c.stroke();
      }
    }
    c.fillStyle = "#3a3d32";
    c.fillRect(625, 300, 220, 6);
    c.fillStyle = "#bcb08c";
    c.font = "12px monospace";
    c.textAlign = "center";
    c.fillText("VIRTUAL RACE / REAL NERVE", 450, 380);
  }
  function paintArt(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ) {
    c.save();
    c.translate(x, y);
    c.scale(size, size);
    c.fillStyle = "#e7d5b0";
    c.fillRect(0, 0, 1, 1);
    c.lineWidth = 0.0015;
    c.strokeStyle = "#bc9d70";
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.arc(0.5, 0.5, 0.08 + i * 0.057, 0, Math.PI * 2);
      c.stroke();
    }
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16;
      c.beginPath();
      c.moveTo(0.5 + Math.cos(a) * 0.07, 0.5 + Math.sin(a) * 0.07);
      c.lineTo(0.5 + Math.cos(a) * 0.425, 0.5 + Math.sin(a) * 0.425);
      c.stroke();
    }
    c.strokeStyle = "#514a38";
    c.lineWidth = 0.003;
    c.beginPath();
    c.arc(0.5, 0.5, 0.437, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#b4572c";
    c.beginPath();
    c.arc(0.5, 0.5, 0.025, 0, Math.PI * 2);
    c.fill();
    for (const group of state.art) {
      for (const p of group.primitives) {
        const [kind, px, py, s, a, hue, win, alpha] = p;
        c.globalAlpha = alpha;
        c.fillStyle = win ? "#b24f26" : hue > 0.5 ? "#403e31" : "#a07745";
        c.strokeStyle = c.fillStyle;
        c.lineWidth = 0.002 + Math.min(s / 8, 0.004);
        c.save();
        c.translate(px, py);
        c.rotate(a);
        if (kind === 0) {
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(s * 2, s);
          c.lineTo(s * 3, 0);
          c.stroke();
        } else if (kind === 1) {
          c.strokeRect(-s / 2, -s / 2, s, s);
        } else if (kind === 2) {
          c.beginPath();
          c.arc(0, 0, s, 0, Math.PI * 2);
          c.stroke();
        } else {
          c.beginPath();
          c.moveTo(0, -s);
          c.lineTo(s / 2, s);
          c.lineTo(-s / 2, s);
          c.closePath();
          c.fill();
        }
        c.restore();
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = "#594b37";
    if (!state.art.length) {
      c.fillStyle = "#e7d5b0";
      c.fillRect(0.2, 0.69, 0.6, 0.06);
      c.fillStyle = "#594b37";
    }
    c.restore();
    c.save();
    c.fillStyle = "#594b37";
    c.font = `${size * 0.018}px monospace`;
    c.textAlign = "left";
    c.fillText("SQK / WHEELPRINT", x + size * 0.04, y + size * 0.055);
    c.textAlign = "right";
    c.fillText(
      String(state.art.length).padStart(3, "0"),
      x + size * 0.96,
      y + size * 0.96,
    );
    if (!state.art.length) {
      c.font = `${size * 0.027}px Arial`;
      c.textAlign = "center";
      c.fillText("Your races leave a trace.", x + size * 0.5, y + size * 0.73);
    }
    c.restore();
  }
  function drawArt() {
    const key = JSON.stringify(state.art);
    if (lastArt === key) return;
    lastArt = key;
    const canvas = $<HTMLCanvasElement>("art");
    const dpr = Math.min(devicePixelRatio || 1, 3),
      size = Math.round(
        Math.max(300, canvas.getBoundingClientRect().width) * dpr,
      );
    canvas.width = size;
    canvas.height = size;
    paintArt(canvas.getContext("2d")!, 0, 0, size);
  }
  function animation(time: number) {
    if (!document.hidden && time - lastFrame >= (reduced.matches ? 500 : 50)) {
      if (active() || time - lastScene > 500) {
        drawArena(time);
        lastScene = time;
      }
      lastFrame = time;
    }
    requestAnimationFrame(animation);
  }
  async function exportPNG() {
    if (
      state.run.live + state.run.practice === 0 ||
      state.round?.phase === "REPLAY"
    )
      return;
    const c = document.createElement("canvas");
    c.width = c.height = 1080;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4f0e7";
    ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = "#2c2923";
    ctx.font = "600 32px Arial";
    ctx.fillText("Squeek Survival / Wheelprint", 48, 62);
    ctx.font = "20px Arial";
    ctx.fillText(state.name || wallet.account || "GUEST", 48, 96);
    ctx.textAlign = "right";
    ctx.fillText("Score " + E.score(state.run), 1032, 62);
    ctx.fillText(new Date().toISOString().slice(0, 10) + " UTC", 1032, 96);
    ctx.textAlign = "left";
    paintArt(ctx, 180, 118, 720);
    ctx.font = "600 24px Arial";
    ctx.fillStyle = "#2c2923";
    ctx.fillText(
      `Streak ${state.run.streak} / Best ${state.run.best} / Damage ${state.run.damage}`,
      48,
      883,
    );
    ctx.font = "20px Arial";
    ctx.fillText(
      `Live ${state.run.live} / Practice ${state.run.practice} / Seed ${state.run.lastSeedType}`,
      48,
      925,
    );
    ctx.font = "18px monospace";
    ctx.fillText(state.run.lastSeed || "No settled seed in this run.", 48, 960);
    ctx.font = "18px Arial";
    ctx.fillStyle = "#71695c";
    ctx.fillText(
      "Virtual races. Local cosmetic scores. No token rewards.",
      48,
      1024,
    );
    ctx.font = "16px Arial";
    ctx.fillText("squeek / Keep the wheel alive.", 48, 1053);
    button("exportBtn").disabled = true;
    try {
      const blob: Blob = await new Promise((resolve, reject) =>
        c.toBlob(
          (b) => (b ? resolve(b) : reject(Error("PNG encoding failed"))),
          "image/png",
        ),
      );
      if (pngURL) URL.revokeObjectURL(pngURL);
      pngURL = URL.createObjectURL(blob);
      $<HTMLImageElement>("pngPreview").src = pngURL;
      $<HTMLAnchorElement>("pngDownload").href = pngURL;
      openDialog("previewDialog");
      announce("Your 1080 by 1080 PNG is ready to download.");
    } catch {
      text(
        "storageNotice",
        "PNG export failed in this browser. Try again after the round settles.",
      );
      show("storageNotice", true);
    } finally {
      render();
    }
  }
  interface Provider {
    request(args: { method: string; params?: any[] }): Promise<any>;
    on?(name: string, callback: (v: any) => void): void;
    removeListener?(name: string, callback: (v: any) => void): void;
  }
  interface Pending {
    hash: string | null;
    sender: string;
    chain: string;
    status: "pending" | "confirmed" | "failed" | "unknown";
    visibleMs: number;
    terminalAt: number;
    lastCheck: number;
  }
  const savedTx = parse(storage.get("squeek.tx.v3"));
  const txValid =
    savedTx &&
    /^0x[0-9a-fA-F]{40}$/.test(savedTx.sender) &&
    savedTx.chain === P.chain &&
    ["pending", "confirmed", "failed", "unknown"].includes(savedTx.status) &&
    (savedTx.hash === null || /^0x[0-9a-fA-F]{64}$/.test(savedTx.hash));
  let tx: Pending | null = txValid
    ? {
        ...savedTx,
        visibleMs: Number.isFinite(savedTx.visibleMs) ? savedTx.visibleMs : 0,
        lastCheck: 0,
      }
    : null;
  let receiptBusy = false,
    receiptNext = 0,
    receiptFailure = 0,
    receiptClock = now();
  const wallet: {
    provider: Provider | null;
    account: string | null;
    chain: string | null;
    verified: boolean;
    balance: string;
    busy: boolean;
    sending: boolean;
    generation: number;
  } = {
    provider: null,
    account: null,
    chain: null,
    verified: false,
    balance: "Unknown",
    busy: false,
    sending: false,
    generation: 0,
  };
  const providers = new Map<
    string,
    { name: string; icon: string; provider: Provider }
  >();
  function saveTx() {
    storage.set("squeek.tx.v3", JSON.stringify(tx));
    if (sessionOnly) save();
  }
  const isCode = (c: any) =>
    typeof c === "string" && /^0x[0-9a-f]+$/i.test(c) && !/^0x0*$/i.test(c);
  const validWord = (v: any) =>
    typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
  /** Same guarded wallet path is used by isolated mock tests. Never retries a send. */
  async function performTransfer(
    provider: Provider,
    account: string,
    guard: () => boolean,
    onSending: () => void,
  ) {
    const transaction = E.transfer(account);
    const check = async () => {
      if (!guard()) throw Error("Account or chain changed");
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      if (
        !guard() ||
        !Array.isArray(accounts) ||
        accounts[0]?.toLowerCase() !== account.toLowerCase() ||
        chain?.toLowerCase() !== P.chain
      )
        throw Error("Account or chain changed");
    };
    await check();
    const codes = await Promise.all(
      [P.token, P.core, P.mining].map((address) =>
        provider.request({
          method: "eth_getCode",
          params: [address, "latest"],
        }),
      ),
    );
    if (!codes.every(isCode)) throw Error("Pinned contract code unavailable");
    if (!guard()) throw Error("Account or chain changed");
    const simulation = await provider.request({
      method: "eth_call",
      params: [transaction, "latest"],
    });
    if (simulation !== "0x" + "0".repeat(63) + "1")
      throw Error("Contract simulation returned false or unknown");
    if (!guard()) throw Error("Account or chain changed");
    const estimate = await provider.request({
      method: "eth_estimateGas",
      params: [transaction],
    });
    if (
      typeof estimate !== "string" ||
      !/^0x[0-9a-f]+$/i.test(estimate) ||
      BigInt(estimate) <= 0n
    )
      throw Error("Gas estimate unavailable");
    await check();
    if (!guard()) throw Error("Account or chain changed");
    onSending();
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [transaction],
    });
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw Object.assign(Error("Wallet returned unknown transaction hash"), {
        sendUnknown: true,
      });
    return hash;
  }
  function renderWallet() {
    const connectControl = button("connectBtn");
    if (wallet.account) {
      connectControl.dataset.guest = "false";
      connectControl.removeAttribute("aria-label");
      text(
        "connectBtn",
        wallet.chain !== P.chain
          ? "Switch to Sepolia"
          : wallet.account.slice(0, 6) + "…" + wallet.account.slice(-4),
      );
    } else if (connectControl.dataset.guest !== "true") {
      const desktopLabel = document.createElement("span");
      desktopLabel.className = "desktop-only";
      desktopLabel.textContent = " wallet";
      connectControl.replaceChildren(
        document.createTextNode("Connect"),
        desktopLabel,
      );
      connectControl.setAttribute("aria-label", "Connect wallet");
      connectControl.dataset.guest = "true";
    }
    text("walletAccount", wallet.account || "");
    text("walletBalance", "SQK balance · " + wallet.balance);
    text(
      "codeStatus",
      wallet.verified
        ? "Wallet verified Sepolia and code at all three pins. MINING / CORE are display-only."
        : publicCode === true
          ? "Public RPC verified Sepolia and code at all three pins. Connect to verify your wallet."
          : publicCode === false
            ? "Pinned contract code is missing. Transactions stay disabled."
            : "Pinned contract code is unverified. Transactions stay disabled.",
    );
    show("switchChain", !!wallet.account && wallet.chain !== P.chain);
    show("disconnectBtn", !!wallet.account);
    button("connectBtn").disabled = wallet.busy;
    const unresolved = tx?.status === "pending" || tx?.status === "unknown";
    const cooldown =
      tx &&
      (tx.status === "confirmed" || tx.status === "failed") &&
      now() - tx.terminalAt < 15000;
    button("sendBtn").disabled =
      state.counts.participated < 1 ||
      !wallet.account ||
      wallet.chain !== P.chain ||
      !wallet.verified ||
      economyCheck === "mismatch" ||
      wallet.sending ||
      !!unresolved ||
      !!cooldown;
    text(
      "txHint",
      state.counts.participated < 1
        ? "Unlocks after one settled participated round."
        : unresolved
          ? "A previous send is unresolved. Check its status before sending again."
          : cooldown
            ? "Please wait " +
              Math.ceil((15000 - (now() - tx!.terminalAt)) / 1000) +
              "s before another test."
            : !wallet.account
              ? "Connect a wallet to send this optional test."
              : wallet.chain !== P.chain
                ? "Switch explicitly to Sepolia to continue."
                : economyCheck === "mismatch"
                  ? "Disabled: economy identity mismatch."
                  : !wallet.verified
                    ? "Waiting for verified contract code."
                    : "Optional test only. Gameplay continues during confirmation.",
    );
    show("checkTx", !!unresolved);
    if (tx) {
      const node = $("txStatus");
      const key = [
        tx.status,
        tx.hash,
        Math.floor(tx.visibleMs / 1000 / 180),
        tx.sender,
      ].join("|");
      if (node.dataset.key !== key) {
        node.dataset.key = key;
        node.replaceChildren();
        const p = document.createElement("p");
        p.textContent = `${tx.status === "unknown" ? "Unknown send outcome" : tx.status === "pending" ? (tx.visibleMs >= 180000 ? "Still pending after 3 visible minutes" : "Transaction pending") : tx.status === "confirmed" ? "Transaction confirmed" : "Transaction failed"} · sender ${tx.sender}`;
        node.append(p);
        if (tx.hash) {
          const a = document.createElement("a");
          a.href = P.explorer + "/tx/" + tx.hash;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = tx.hash + " · View on Etherscan";
          node.append(a);
        } else {
          const p2 = document.createElement("p");
          p2.textContent =
            "No hash was returned. Inspect this sender’s Sepolia activity before any further test.";
          const a = document.createElement("a");
          a.href = P.explorer + "/address/" + tx.sender;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "Inspect sender on Etherscan";
          node.append(p2, a);
        }
      }
    }
  }
  async function providerRequest(
    provider: Provider,
    method: string,
    params?: any[],
  ) {
    return provider.request({ method, params });
  }
  async function refreshWallet() {
    const p = wallet.provider,
      account = wallet.account,
      generation = wallet.generation;
    if (!p || !account) return;
    const guard = () =>
      wallet.provider === p &&
      wallet.account === account &&
      wallet.generation === generation;
    try {
      const chain = await providerRequest(p, "eth_chainId");
      if (!guard()) return;
      wallet.chain = typeof chain === "string" ? chain.toLowerCase() : null;
      wallet.verified = false;
      wallet.balance = "Unknown";
      if (wallet.chain !== P.chain) return;
      const codes = await Promise.all(
        [P.token, P.mining, P.core].map((a) =>
          providerRequest(p, "eth_getCode", [a, "latest"]),
        ),
      );
      if (!guard()) return;
      wallet.verified = codes.every(isCode);
      let balance: any = null,
        decimals: number | null = null;
      const reads = await Promise.allSettled([
        providerRequest(p, "eth_call", [
          {
            to: P.token,
            data:
              "0x70a08231" + account.slice(2).toLowerCase().padStart(64, "0"),
          },
          "latest",
        ]),
        providerRequest(p, "eth_call", [
          { to: P.token, data: "0x313ce567" },
          "latest",
        ]),
      ]);
      if (!guard()) return;
      if (reads[0].status === "fulfilled" && validWord(reads[0].value))
        balance = reads[0].value;
      if (reads[1].status === "fulfilled" && validWord(reads[1].value)) {
        const d = BigInt(reads[1].value);
        if (d <= 255n) decimals = Number(d);
      }
      wallet.balance = balance ? E.formatUnits(balance, decimals) : "Unknown";
    } catch {
      if (guard()) {
        wallet.verified = false;
        wallet.balance = "Unknown";
      }
    } finally {
      renderWallet();
    }
  }
  const accountsChanged = (accounts: any) => {
    wallet.generation++;
    wallet.account =
      Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0])
        ? accounts[0]
        : null;
    wallet.verified = false;
    wallet.balance = "Unknown";
    if (wallet.account && $<HTMLDialogElement>("walletDialog").open)
      closeDialog("walletDialog");
    renderWallet();
    void refreshWallet();
  };
  const chainChanged = (chain: any) => {
    wallet.generation++;
    wallet.chain = typeof chain === "string" ? chain.toLowerCase() : null;
    wallet.verified = false;
    wallet.balance = "Unknown";
    renderWallet();
    void refreshWallet();
  };
  function attach(p: Provider) {
    if (wallet.provider) {
      wallet.provider.removeListener?.("accountsChanged", accountsChanged);
      wallet.provider.removeListener?.("chainChanged", chainChanged);
    }
    wallet.provider = p;
    wallet.generation++;
    p.on?.("accountsChanged", accountsChanged);
    p.on?.("chainChanged", chainChanged);
  }
  async function connect(p: Provider) {
    if (wallet.busy) return;
    wallet.busy = true;
    text("chooserMessage", "Check your wallet to connect.");
    renderWallet();
    try {
      attach(p);
      const generation = wallet.generation;
      const accounts = await p.request({ method: "eth_requestAccounts" });
      if (generation !== wallet.generation) return;
      if (!Array.isArray(accounts) || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))
        throw Error("No valid account");
      wallet.account = accounts[0];
      text("walletMessage", "Wallet connected. Guest run preserved.");
      closeDialog("walletDialog");
      await refreshWallet();
    } catch (e) {
      text("chooserMessage", E.classify(e));
      text("walletMessage", E.classify(e));
    } finally {
      wallet.busy = false;
      renderWallet();
    }
  }
  async function switchChain() {
    const p = wallet.provider;
    if (!p || wallet.busy) return;
    wallet.busy = true;
    renderWallet();
    try {
      try {
        await p.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: P.chain }],
        });
      } catch (e) {
        if ((e as any)?.code !== 4902) throw e;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: P.chain,
              chainName: "Sepolia",
              nativeCurrency: {
                name: "Sepolia ETH",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: [...P.rpcs],
              blockExplorerUrls: [P.explorer],
            },
          ],
        });
      }
      await refreshWallet();
    } catch (e) {
      text("walletMessage", E.classify(e));
    } finally {
      wallet.busy = false;
      renderWallet();
    }
  }
  function walletChooser() {
    const list = $("walletList");
    list.replaceChildren();
    const found = [...providers.values()];
    const fallback = (window as any).ethereum as Provider | undefined;
    if (!found.length && fallback?.request)
      found.push({ name: "Browser wallet", icon: "", provider: fallback });
    for (const entry of found) {
      const b = document.createElement("button");
      b.className = "wallet-row";
      if (entry.icon.startsWith("data:image/") && entry.icon.length < 100000) {
        const img = document.createElement("img");
        img.src = entry.icon;
        img.alt = "";
        img.width = img.height = 28;
        b.append(img);
      }
      const span = document.createElement("span");
      span.textContent = entry.name.slice(0, 80);
      b.append(span);
      b.onclick = () => void connect(entry.provider);
      list.append(b);
    }
    show("noWallet", !found.length);
    text("chooserMessage", "");
    openDialog("walletDialog");
  }
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const d = (event as CustomEvent).detail;
    if (
      d?.info &&
      typeof d.info.uuid === "string" &&
      typeof d.info.name === "string" &&
      d.provider?.request
    ) {
      providers.set(d.info.uuid, {
        name: d.info.name,
        icon: typeof d.info.icon === "string" ? d.info.icon : "",
        provider: d.provider,
      });
      if ($<HTMLDialogElement>("walletDialog").open) walletChooser();
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  async function sendTest() {
    if (button("sendBtn").disabled || wallet.sending) return;
    const p = wallet.provider,
      account = wallet.account;
    if (!p || !account) return;
    wallet.sending = true;
    const generation = wallet.generation;
    const guard = () =>
      wallet.provider === p &&
      wallet.account === account &&
      wallet.generation === generation &&
      economyCheck !== "mismatch" &&
      wallet.chain === P.chain;
    let crossedSend = false;
    renderWallet();
    text("walletMessage", "Simulating the exact zero SQK self-transfer…");
    try {
      const hash = await performTransfer(p, account, guard, () => {
        crossedSend = true;
        tx = {
          hash: null,
          sender: account,
          chain: P.chain,
          status: "unknown",
          visibleMs: 0,
          terminalAt: 0,
          lastCheck: 0,
        };
        saveTx();
        text("walletMessage", "Confirm the zero SQK test in your wallet.");
      });
      tx = {
        hash,
        sender: account,
        chain: P.chain,
        status: "pending",
        visibleMs: 0,
        terminalAt: 0,
        lastCheck: 0,
      };
      receiptClock = now();
      receiptNext = 0;
      saveTx();
      text("walletMessage", "Transaction sent. You can keep playing.");
      void receiptPoll();
    } catch (e) {
      if (crossedSend) {
        const code = (e as any)?.code;
        const msg = String((e as any)?.message || e);
        if (code === 4001 || /revert|insufficient funds/i.test(msg)) {
          tx = {
            hash: null,
            sender: account,
            chain: P.chain,
            status: "failed",
            visibleMs: 0,
            terminalAt: now(),
            lastCheck: 0,
          };
          saveTx();
        } else {
          text(
            "walletMessage",
            "Send outcome unknown. No automatic retry. Check this sender on Etherscan.",
          );
        }
      }
      if (!crossedSend || tx?.status === "failed")
        text("walletMessage", E.classify(e));
    } finally {
      wallet.sending = false;
      renderWallet();
      void refreshWallet();
    }
  }
  async function receiptPoll(force = false) {
    if (!tx || !active()) return;
    const t = now();
    if (tx.status === "pending") {
      tx.visibleMs += Math.min(1000, Math.max(0, t - receiptClock));
      receiptClock = t;
    } else receiptClock = t;
    if (
      receiptBusy ||
      !tx.hash ||
      !["pending", "unknown"].includes(tx.status) ||
      (!force && (now() < receiptNext || tx.visibleMs >= 180000))
    )
      return;
    receiptBusy = true;
    const hash = tx.hash;
    const generation = visibilityGeneration;
    try {
      const receipt = await rpc(
        "eth_getTransactionReceipt",
        [hash],
        () =>
          active() && tx?.hash === hash && generation === visibilityGeneration,
      );
      if (!active() || tx?.hash !== hash || generation !== visibilityGeneration)
        return;
      if (
        receipt !== null &&
        (!receipt ||
          !["0x1", "0x0"].includes(receipt.status) ||
          receipt.transactionHash?.toLowerCase() !== hash.toLowerCase())
      )
        throw Error("Unknown receipt");
      if (receipt) {
        tx.status = receipt.status === "0x1" ? "confirmed" : "failed";
        tx.terminalAt = now();
        announce("Test transaction " + tx.status);
        void refreshWallet();
      }
      tx.lastCheck = now();
      receiptFailure = 0;
      receiptNext = now() + 4000;
      saveTx();
    } catch (e) {
      receiptFailure++;
      receiptNext = now() + Math.max(4000, backoff(receiptFailure, e));
    } finally {
      receiptBusy = false;
      renderWallet();
    }
  }
  const triggers = new Map<string, HTMLElement>();
  function openDialog(name: string) {
    const d = $<HTMLDialogElement>(name);
    if (d.open) return;
    triggers.set(name, document.activeElement as HTMLElement);
    if (name === "helpDialog") {
      helpPaused = true;
      suspend();
    }
    d.showModal();
  }
  function closeDialog(name: string) {
    const d = $<HTMLDialogElement>(name);
    d.close();
  }
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach((d) => {
    d.querySelector(".close-dialog")?.addEventListener("click", () =>
      d.close(),
    );
    d.addEventListener("click", (e) => {
      if (e.target === d) {
        const rect = d.getBoundingClientRect();
        const m = e as MouseEvent;
        if (
          m.clientX < rect.left ||
          m.clientX > rect.right ||
          m.clientY < rect.top ||
          m.clientY > rect.bottom
        )
          d.close();
      }
    });
    d.addEventListener("close", () => {
      if (d.id === "helpDialog") {
        helpPaused = false;
        settings.tutorial = true;
        saveSettings();
        resume();
      }
      if (d.id === "previewDialog" && pngURL) {
        $<HTMLImageElement>("pngPreview").removeAttribute("src");
        URL.revokeObjectURL(pngURL);
        pngURL = null;
      }
      triggers.get(d.id)?.focus();
    });
  });
  function confirmAction(
    title: string,
    description: string,
    label: string,
    action: () => void,
  ) {
    text("confirmTitle", title);
    text("confirmText", description);
    text("confirmAction", label);
    button("confirmAction").onclick = () => {
      action();
      closeDialog("confirmDialog");
    };
    openDialog("confirmDialog");
  }
  button("helpBtn").onclick = () => openDialog("helpDialog");
  button("rulesBtn").onclick = () => openDialog("helpDialog");
  button("startPlaying").onclick = () => closeDialog("helpDialog");
  button("themeBtn").onclick = () => {
    settings.theme = settings.theme === "cream" ? "charcoal" : "cream";
    applyTheme();
    saveSettings();
  };
  button("soundBtn").onclick = () => {
    settings.mute = !settings.mute;
    button("soundBtn").setAttribute(
      "aria-label",
      settings.mute ? "Sound off" : "Sound on",
    );
    button("soundBtn").setAttribute("aria-pressed", String(!settings.mute));
    button("soundBtn").title = settings.mute ? "Sound off" : "Sound on";
    saveSettings();
    if (settings.mute) void audio?.suspend();
    else {
      audioGesture();
      sound(440, true);
    }
  };
  button("pauseBtn").onclick = () => {
    manuallyPaused = !manuallyPaused;
    if (manuallyPaused) suspend();
    else resume();
    render();
    announce(manuallyPaused ? "Game paused." : "Game resumed.");
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-call]")
    .forEach((b) => (b.onclick = () => choose(b.dataset.call as Squeek.Call)));
  document
    .querySelectorAll<HTMLButtonElement>("[data-booster]")
    .forEach(
      (b) =>
        (b.onclick = () => chooseBooster(b.dataset.booster as Squeek.Booster)),
    );
  /** Switching call type clears a call the new controls cannot show. */
  function setMode(next: "duel" | "zone") {
    mode = next;
    const r = state.round;
    if (r && r.phase === "PREDICT" && r.call) {
      const isDuel = r.call === "OVER" || r.call === "UNDER";
      if (isDuel !== (next === "duel")) {
        r.call = null;
        save();
      }
    }
    render();
  }
  button("duelMode").onclick = () => setMode("duel");
  button("zoneMode").onclick = () => setMode("zone");
  button("lockBtn").onclick = lock;
  button("retryNetwork").onclick = () => {
    statusNext = economyNext = publicCodeNext = rpcNotBefore = seedNext = 0;
    statusFailure = economyFailure = 0;
    void pollStatus();
    void pollEconomy();
    void seedPoll();
  };
  button("endRun").onclick = () => {
    if (state.round?.phase === "WAIT" || state.round?.phase === "REPLAY")
      return;
    confirmAction(
      "End this run?",
      "Your current score will be recorded on this device. The weekly boss and Robo’s memory carry on.",
      "End run & save record",
      () => {
        if (state.round?.phase === "WAIT" || state.round?.phase === "REPLAY")
          return;
        E.finishRun(state, now());
        if (state.round) state.round.phase = "RUN_OVER";
        save();
        render();
      },
    );
  };
  button("newRun").onclick = () => {
    if (state.round?.phase === "WAIT" || state.round?.phase === "REPLAY")
      return;
    state.run = E.newRun(
      id(),
      now(),
      E.loot(state.boss[E.week(now())]?.hp ?? 50000),
    );
    state.art = [];
    lastArt = "";
    manuallyPaused = false;
    beginRound();
    drawArt();
  };
  button("resetAI").onclick = () =>
    confirmAction(
      "Reset Robo’s memory?",
      "This clears learning and AI accuracy. Your current frozen call, committed result, lives, raid and records remain.",
      "Reset memory",
      () => {
        state.ai = {
          g: 0.5,
          history: [],
          decisions: [],
          hits: 0,
          seen: 0,
          best: state.ai.best,
        };
        save();
        render();
      },
    );
  button("clearArt").onclick = () => {
    if (state.round?.phase === "REPLAY") return;
    confirmAction(
      "Start a new canvas?",
      "This clears the wheelprint only. Your run, settled calls and records remain.",
      "Clear canvas",
      () => {
        if (state.round?.phase === "REPLAY") return;
        state.art = [];
        lastArt = "";
        save();
        drawArt();
        render();
      },
    );
  };
  $<HTMLInputElement>("playerName").value = state.name;
  $<HTMLInputElement>("playerName").addEventListener("input", (e) => {
    state.name = (e.target as HTMLInputElement).value.slice(0, 20);
    save();
  });
  button("exportBtn").onclick = () => void exportPNG();
  button("connectBtn").onclick = () => {
    if (wallet.account && wallet.chain !== P.chain) void switchChain();
    else walletChooser();
  };
  button("switchChain").onclick = () => void switchChain();
  button("disconnectBtn").onclick = () => {
    wallet.generation++;
    if (wallet.provider) {
      wallet.provider.removeListener?.("accountsChanged", accountsChanged);
      wallet.provider.removeListener?.("chainChanged", chainChanged);
    }
    wallet.provider = null;
    wallet.account = null;
    wallet.chain = null;
    wallet.verified = false;
    wallet.balance = "Unknown";
    text("walletMessage", "Disconnected. Your game continues.");
    renderWallet();
  };
  button("sendBtn").onclick = () => void sendTest();
  button("checkTx").onclick = () => {
    receiptNext = rpcNotBefore = 0;
    void receiptPoll(true);
  };
  for (const [name, address] of [
    ["SQK", P.token],
    ["MINING · display only", P.mining],
    ["CORE · display only", P.core],
  ]) {
    const a = document.createElement("a");
    a.href = P.explorer + "/address/" + address;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = name + " · " + address;
    $("contractLinks").append(a);
  }
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    // Game shortcuts work while a game control has focus; only editable
    // fields, open dialogs and modified keys are left alone.
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.repeat ||
      target.closest?.("input,textarea,select,[contenteditable]") ||
      document.querySelector("dialog[open]")
    )
      return;
    // Enter keeps its native activation on buttons, links and summaries.
    if (e.key === "Enter" && target.closest?.("button,a,summary")) return;
    const calls: Record<string, Squeek.Call> = {
      "1": "OVER",
      "2": "UNDER",
      "3": "Sprint",
      "4": "Cruise",
      "5": "Marathon",
    };
    if (calls[e.key]) {
      e.preventDefault();
      const r = state.round;
      // only switch controls when the call can actually be made
      if (r && r.phase === "PREDICT" && active() && E.canCall(r, calls[e.key])) {
        mode = ["1", "2"].includes(e.key) ? "duel" : "zone";
        choose(calls[e.key]);
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.round?.call) lock();
    }
    if (e.key.toLowerCase() === "p") {
      e.preventDefault();
      button("pauseBtn").click();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
    else {
      receiptClock = now();
      resume();
      tick();
    }
  });
  window.addEventListener("pagehide", () => {
    suspend();
    saveTx();
    if (pngURL) URL.revokeObjectURL(pngURL);
  });
  window.addEventListener("resize", () => {
    lastArt = "";
    drawArt();
    drawArena(performance.now());
  });
  /** Isolated test access: pure mechanics and fresh in-memory state only. Never uses app storage/provider. */
  (window as any).__squeekTest = Object.freeze({
    mechanics: Object.freeze({ ...E }),
    createSandbox(seed = "test", at = Date.UTC(2026, 9, 26)) {
      let clock = at;
      const sandbox = E.initial(clock);
      sandbox.run = E.newRun("test-run", clock);
      const fakeRandom = E.rng("ai|" + seed);
      return {
        state: sandbox,
        now: () => clock,
        advance: (ms: number) => (clock += ms),
        begin: (sample: any = null) => {
          sandbox.round = E.makeRound(
            sandbox,
            "test-" + clock,
            clock,
            E.telemetry(sample, clock),
            fakeRandom,
          );
          return sandbox.round;
        },
        lock: () => E.lock(sandbox, clock),
        seed: (hash = seed) =>
          sandbox.round && E.seedRound(sandbox.round, hash, "LOCAL", clock),
        settle: () => E.settle(sandbox, clock),
        reload: () => E.recover(clone(sandbox), clock).state,
      };
    },
    async mockWallet(script: Record<string, any> = {}, changeAt = "") {
      const calls: { method: string; params?: any[] }[] = [];
      const account = "0x" + "12".repeat(20);
      let valid = true;
      const provider: Provider = {
        async request(args) {
          calls.push(clone(args));
          if (args.method === changeAt) valid = false;
          if (args.method in script) {
            const v = script[args.method];
            if (v?.error) throw v.error;
            return v;
          }
          if (args.method === "eth_accounts") return [account];
          if (args.method === "eth_chainId") return P.chain;
          if (args.method === "eth_getCode") return "0x60016000";
          if (args.method === "eth_call") return "0x" + "0".repeat(63) + "1";
          if (args.method === "eth_estimateGas") return "0x1234";
          if (args.method === "eth_sendTransaction")
            return "0x" + "ab".repeat(32);
          throw Error("Unexpected mock request");
        },
      };
      try {
        return {
          hash: await performTransfer(
            provider,
            account,
            () => valid,
            () => {},
          ),
          calls,
          error: null,
        };
      } catch (error) {
        return {
          hash: null,
          calls,
          error: String((error as Error).message),
          classification: E.classify(error),
        };
      }
    },
    readSnapshot: () =>
      clone({
        phase: state.round?.phase,
        mode: current.mode,
        economy: economyCheck,
        round: state.round,
        run: state.run,
        counts: state.counts,
        art: state.art.length,
      }),
    sessionOnly: () => sessionOnly,
  });
  (window as any).__calibrate = () => E.calibrate();
  if (new URLSearchParams(location.search).get("debug") === "1") {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Debug · read-only state";
    const pre = document.createElement("pre");
    pre.style.cssText =
      "white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px";
    details.append(summary, pre);
    $("game").append(details);
    setInterval(() => {
      if (active() && details.open)
        pre.textContent = JSON.stringify(
          {
            phase: state.round?.phase,
            current,
            economy: economyCheck,
            seed: state.round?.seedType,
            target: state.round?.target,
            g: state.ai.g,
            storage: sessionOnly ? "RAM" : "local",
            roundApplied: state.round?.applied,
          },
          null,
          2,
        );
    }, 1000);
  }
  applyTheme();
  button("soundBtn").setAttribute(
    "aria-label",
    settings.mute ? "Sound off" : "Sound on",
  );
  button("soundBtn").setAttribute("aria-pressed", String(!settings.mute));
  // A restored round resumes only on a visible, unpaused page; a hidden reload
  // keeps (or starts) its pause so background time never consumes its timers.
  if (state.round && active()) E.resume(state.round, now());
  if (!state.round && state.run.active) beginRound();
  if (!active()) E.pause(state.round, now());
  if (state.counts.participated === 0) say("first");
  else if (returned) say("return");
  else preDialogue();
  if (saved.recovered.length) {
    text(
      "storageNotice",
      "Recovered damaged local sections: " +
        saved.recovered.join(", ") +
        ". Valid sections were preserved.",
    );
    show("storageNotice", true);
  }
  save();
  render();
  drawArena(0);
  drawArt();
  requestAnimationFrame(animation);
  setInterval(tick, 100);
  tick();
}
