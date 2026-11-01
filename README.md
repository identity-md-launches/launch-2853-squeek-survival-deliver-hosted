# Squeek Survival

**Beat Robo-Squeek. Keep the wheel alive.** A guest-first English prediction game with deterministic virtual races, a device-local weekly raid, learning AI and printable wheel art. No token rewards.

## Play and publish

- Serve `dist/` on any static host. `dist/index.html` contains the complete, unminified game: vanilla JavaScript, inline CSS/SVG, Canvas sprites and procedural Web Audio. No runtime dependencies or CDN.
- `dist/share.png` is the locally bundled social preview, not a game dependency. All metadata URLs are relative and work under a gateway subpath.
- `index.html` at the repository root is also a complete playable export, with its social image pointing to `dist/share.png`. Open/download this HTML for offline play. An already loaded game keeps playing without a network; fresh offline navigation to an uncached HTTP URL still depends on the browser's HTTP cache. No service worker is claimed.
- The contributor publisher assigns the public URL after submission. It was not available during implementation; `artifacts/delivery.json` records `url: null`. No hosted URL was invented.

## Install, rebuild, preview

Use Node.js 20 or newer.

```sh
npm ci
npm run build
npm run typecheck
npm run preview
```

Open `http://localhost:4173/preview/`. Stop preview with Ctrl+C. The production build has no server dependency. It compiles the typed source, inlines it with the HTML/CSS, enforces the 200,000-byte HTML budget, writes `dist/`, and refreshes the root standalone HTML. `test/scratch/` holds disposable compiler output and is recreated by the build.

Source of truth: `src/engine.ts` (pure rules), `src/app.ts` (UI, persistence, networking and wallet), `src/index.html` (template), `src/style.css` (tokens/layout). `src/share.svg` and `src/share.png` are the social-image sources. To regenerate the PNG, install a Playwright Chromium runtime and run `npm run share-image`.

## Playing

Choose Over, Under or a zone different from Robo's announced zone. Add one optional booster, then lock within 12 seconds. A skipped call costs nothing. The exact next Sepolia block after lock supplies the seed; after at most 45 visible seconds, cryptographic local randomness takes over. The fixed replay lasts six seconds, results four, then the next round begins. Three lost lives end the run.

Hardware data only changes the frozen damage multiplier and Shield cooldown. Virtual distance and virtual RPM come exclusively from the prescribed seeded physics. Current versus frozen telemetry, exact block target and full seed hash are available in **Under the wheel**. `distanceMm` is never race distance.

Keyboard: `1` / `2` choose Over / Under; `3` / `4` / `5` select Sprint / Cruise / Marathon; `Enter` locks; `P` pauses. Shortcuts keep working while a game button has focus (Enter on a focused button keeps its native activation); they are ignored inside the name field, open dialogs and modified keys. Switching between Over / Under and zones clears a call the new controls cannot show, so the lock button is disabled until a visible call is chosen; a saved zone call reopens on the zone tab. Native Tab, Space, Escape and dialog focus work too. Help includes the full tutorial and scoring rules. Sound starts only after a gesture; theme/mute persist. Hidden tabs pause timers, requests and audio; a tab reloaded while hidden stays paused until it becomes visible. Reload resumes the saved round, target, seed and result.

Scores, boss, art and records are cosmetic and local to this browser. The boss resets by ISO UTC week. A new run refreshes lives, boosters and canvas while retaining the raid and AI. Storage failure displays a session-only notice; corrupt sections recover independently. A saved round with any malformed field it needs (block target/base block, seed type, timers, frozen environment, race) is dropped and rebuilt with a recovery notice, keeping the valid AI, run, boss, art and records.

## Optional wallet

One explicit chooser discovers EIP-6963 wallets and falls back to `window.ethereum`. A phone user can open the page in their wallet browser. The task's vanilla, dependency-free connector requirement takes precedence over the general reference's React/SDK stack. No relay, WalletConnect project ID, remote SDK or passkey wallet is introduced.

Sepolia is chain **11155111 / 0xaa36a7**. The three contract pins and three RPC URLs are fixed in `Squeek.PIN`. The available economy document must match the installation, release, chain string and all pinned identities. A mismatch disables live effects and transactions. Unavailability is shown separately.

After a settled participated round, a connected wallet can optionally send **0 SQK to itself**. The exact four-field transaction is simulated, code/chain checked, gas estimated, and account/chain checked again. No approval, permit, message signing, deposit, fixed gas, game save or badge claim. Pending or unknown sends survive reload and disable a second send; receipts, explorer links, manual status checks and the 15-second terminal cooldown are implemented.

## Validation

Actual results and reproducible commands are in [`artifacts/validation.md`](artifacts/validation.md). Result JSON and screenshots accompany them.

```sh
npx playwright install chromium webkit
npm run build
npm run typecheck
npm test
npm run test:browser
npm run test:scenarios
npm run test:revision
node tests/supplemental.test.mjs
npm run check:live
node tests/live-game.mjs
```

Browser scripts manage and close their own bounded local test servers. Browser runtime libraries may need preparing on the developer's own platform. Development dependencies and test browser runtimes used for this submission were installed outside the repository; none are bundled. The pinned design probe is an input removed at submission, so its actual result is retained in `artifacts/design-probe.json`.

`window.__squeekTest` exposes pure mechanics, fresh in-memory sandboxes and a mock-only wallet path. These helpers do not save or send through a real wallet. `window.__calibrate()` evaluates exactly `calib-0` through `calib-9999`. `?debug=1` adds read-only diagnostics. Integration tests use isolated browser profiles and explicitly mocked providers; `artifacts/wheelprint-example.png` is from such a fixture. `artifacts/wheelprint-live.png` comes from the separately recorded real guest duel.

### Revision results (2026-11-01, this machine, Chromium headless shell 141)

- `npm run build`: dist/index.html 153,579 bytes (budget 200 KB), unminified, self-contained. `npm run typecheck`: no errors.
- `npm test`: 68/68 mechanics checks. These include a new one: twelve kinds of damaged round field (such as `target: "not-a-block"`) each recover only the round section. The 10,000-seed calibration is within target (Sprint 3319 / Cruise 3436 / Marathon 3245).
- `npm run test:browser`: 19/20. All Chromium checks pass. The WebKit check could not run because this machine lacks WebKit's host libraries (`playwright install webkit` refuses to validate them), so this round has no WebKit results.
- `npm run test:scenarios`: 20/20. `node tests/supplemental.test.mjs`: 6/6.
- `npm run test:revision`: 6/6. Each check covers one reviewer finding: corrupt saved round, 20-character record name at 320px, mode switch with a hidden call, shortcuts while a button has focus, expanded contract-link height, and reload in a hidden tab. Before the fix, the same script on the previous build reproduced every finding: a BigInt pageerror with a 900px canvas, scrollWidth 325 at 320, `OVER` locked from the zone tab, the `2`/`P` keys ignored, links 18/36/36px high, and the hidden reload skipping to RESULT. After the fix: no error, the recovery notice and a 356px canvas, scrollWidth 320, the lock disabled, the shortcuts work, links 44/52/52px high, and the round stays in PREDICT with about 11s left.
- Design probe (`taste.mjs`, 320/390/1440): render, layout, targets, contrast, tracking, eyebrows, type sizes/faces, glyphs, repetition, copy budget, chrome, motion and share pass. `casing` flags the brief's required `LIVE STILL` wheel status, and `slogans` flags the brief's tagline and LED dialogue lines. Both are kept because the brief's wording wins.

## Service results and limits

The supplied API was available and matched all pins. A real LIVE STILL guest duel used an exact future Sepolia block and settled successfully. PublicNode verified the Sepolia chain and code at all three addresses. The dRPC probe returned HTTP 400; 1RPC verified SQK before a later read returned HTTP 400. Failover/local fallback remain active; these errors are recorded in `artifacts/live-check.json`.

No real wallet transaction was broadcast. Wallet approvals, rejection paths and receipt states were checked with isolated mock providers. Physical mobile devices, screen-reader speech output, native browser zoom and subjective speaker listening were not tested. In the original round both Chromium and WebKit ran the primary interaction; this revision ran Chromium only (see above); gesture-created Web Audio, mute/pause, DPR, PNG export, keyboard, themes and offline behavior were checked programmatically. Nothing missing or unavailable was replaced with fabricated data, credentials, addresses, balances, results or a URL.
