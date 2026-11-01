# Implemented design system

## Overview

Squeek Survival is a compact arcade game for guests and optional Sepolia wallet users. The visual idea is a small LED hamster challenging a chunky robot inside a bronze wheel. Cream paper surrounds a charcoal playfield; races accumulate into a circular wheelprint. The active game leads the page, with the local raid, art, records and wallet alongside or below it.

The implemented system lives in `src/style.css`, `src/index.html` and the Canvas functions in `src/app.ts`. There are no external fonts or image services.

## Colors

These are the actual CSS custom properties, with cream and charcoal values respectively:

| Token | Cream | Charcoal | Role |
| --- | --- | --- | --- |
| `--bg` | `#f4f0e7` | `#222420` | Page |
| `--surface` | `#fffaf1` | `#2e302a` | Game, inputs, dialogs |
| `--ink` | `#2c2923` | `#f7eddb` | Main text, selected calls |
| `--muted` | `#71695c` | `#c1b6a3` | Supporting text |
| `--line` | `#d6cbb9` | `#56584c` | Structural borders |
| `--accent` | `#ae421a` | `#ff9b5e` | Raid health, links, active rules |
| `--button` | `#c34b1b` | `#f39a5f` | Primary action fill |
| `--button-ink` | `#fffaf1` | `#25261f` | Primary action text |
| `--focus` | `#98401b` | `#ffd3a4` | 3px keyboard ring, 4px offset |
| `--arena` | `#292b27` | Same | Canvas background |
| `--arena-ink` | `#f7e6c8` | Same | Arena metadata |
| `--art` | `#e7d5b0` | Same | Wheelprint paper |

The sprite and procedural art palettes deliberately remain bronze, amber and cream across themes. `--orange`, `--green` and spacing variables also exist at the root; status dots currently use the explicit arena colors in `.status-dot`, rather than these reserved color tokens. Contrast evidence, including both themes, is in `artifacts/supplemental-results.json`; the probe excludes text over Canvas and those exceptions are documented in validation.

## Typography

Arial, Helvetica, sans-serif is the local prose stack. Monospace is limited to the timer, changing numbers, key hints and pixel arena metadata. No font files are needed. The six-size scale is 12, 16, 20, 24, 32 and 40px, with no more than five sizes visible at one tested width. Weights are 400 and 600, with native heading defaults reaching 700 in the browser.

The main heading is 40px / 1.1 with -1.5px tracking on desktop, 32px / 1.1 with -1px on phones. Section headings are 20px / 1.3. Body copy is 16px / 1.5, labels and metadata 12px / 1.5. Mobile inputs stay 16px. Scores/timers use tabular numbers. Contract addresses, seeds and record player names (`.records-section td:first-child`) wrap with `overflow-wrap:anywhere`; they are not truncated, so a 20-character name fits the 320px table.

## Layout

The content container is at most 1320px (1440px above the 1500px breakpoint), with 40px desktop gutters. Header and main share the same alignment. The default game grid is `minmax(0,1.8fr) minmax(300px,1fr)` with a 32px gap. At 900px it narrows to a 1.5:1 split with a 24px gap. At 740px the game moves above the sidebar; raid/art temporarily share two columns. At 480px the sidebar becomes one column. At 359px gutters reduce to 10px and the brand icon hides to preserve utilities.

The spacing vocabulary is 4, 8, 12, 16, 24, 32 and 48px; variables `--s1` through `--s7` record it, with the current component declarations using these pixel values directly. Controls remain at least 44px. The mobile arena is shorter than desktop so the prediction and lock action remain on the first 390×844 screen. No fixed bottom bar obscures content. Both long data and labels wrap; grid columns use `minmax(0,...)`.

## Elevation & Depth

Surfaces are flat. Borders distinguish the game, controls and dialogs; there are no card shadows or cards nested inside cards. The modal backdrop is `#181a17aa` with 3px blur. Canvas contains its own wheel spokes, LED pixels and robot art. Theme changes suppress transitions for one frame.

## Shapes

Controls and inputs use `--radius:8px`; the game and dialogs use 12px; art and readouts use 4px. HP is a 10px strip with 2px corners. The wheel and print are circular; all other major surfaces retain straight shared edges.

## Components

- **Header utilities** (`.site-header`, `.brand`, `.icon-button`, `.wallet-button`): 44px targets, responsive connect label, explicit help/sound/theme names, account/switch states. The brand goes to the game.
- **Duel machine** (`.game-machine`, `.hud`, `.arena`, `.call-panel`): score/lives above a Canvas scene, then the current call and controls. The HUD and arena metadata reserve their structure as values update.
- **Calls and boosters** (`.calls`, `.mode-tabs`, `.boosters`): native buttons with `aria-pressed`; selected calls invert ink/paper; the AI zone and unavailable cooldowns are disabled. Rest, hover, pressed, focus and disabled states are implemented. Explanations and countdowns sit next to the relevant action.
- **Raid** (`.boss-section`, `.hp-track`): local/week labels and an accessible progressbar. Exact HP stays visible as text; stage/loot labels also communicate status.
- **Wheelprint** (`#art`, `.art-section`): normalized procedural primitives, persistent seeded groups, clear confirmation and 1080px PNG preview/download. The initial print is explicitly empty, not sample race data.
- **Disclosure and records** (`details`, `.records-section`): native keyboard disclosure, true empty state and a semantic table of completed local runs. Expanded pinned-contract links (`.contracts .details-body a`) are flex rows with a 44px minimum height and 8px block padding, 4px apart. No invented leaderboard entries.
- **Wallet status** (`.wallet-section`, `.wallet-row`): one EIP-6963 chooser, code/balance/chain states, explicit switch and a gated test action. Pending/unknown/confirmed/failed states are shown without displacing the game.
- **Dialogs** (`dialog`, `.dialog-heading`): native modal focus containment, Escape/backdrop/close control, focus return, scrolling content; the phone wallet chooser sits near the bottom. Help pauses the local game. Errors use persistent status regions.

All game results also go to the stable polite live region. User names/provider names/addresses are inserted with `textContent` or Canvas `fillText`. Motion is guarded by `prefers-reduced-motion`; paused/hidden sessions suspend local timers and audio. The Canvas uses capped device-pixel-ratio backing dimensions and cached 48×32 LED sprites with four gait frames per mood.

## Do's and Don'ts

Reuse the root role tokens, six-size type scale, native controls and shared alignment before adding a new treatment. Use `.primary` for the current action, `.quiet` for utility links, and visible status text alongside color. Start another surface with `.section-heading` and the existing spacing vocabulary. Keep the prediction first on phones.

Do not imply scores or raids are shared, add rewards/badge claims, obscure full contract data, add unseeded artwork during rendering, introduce a remote font/SDK, or put implementation details into the primary play flow. Retain the exact pins and transaction construction when making visual changes.
