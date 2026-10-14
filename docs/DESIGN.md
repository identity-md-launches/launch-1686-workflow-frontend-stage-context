# Daemon interface design

## Overview

Daemon is a small trading interface for visitors to the Pawn shop. Its original grey tabby coin is the main visual identity. A green-black shop window, warm gold headings, a royal blue primary button and cream type keep the market controls legible without turning the page into a dashboard. The current face and buy/sell control come first; mood history, provenance and token utilities follow.

This document is in `docs/` because the assignment expressly forbids root-file changes, despite also requesting root `DESIGN.md`.

## Colors

Semantic tokens are defined in `web/src/styles.css`. The dark theme is the base; `data-theme="light"` changes the same roles. The initial theme follows system preference and the header control changes it for the current visit. No theme cookie is written.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#101e19` | `#f3efdf` | Page |
| `--surface` | `#192b23` | `#fffbee` | Trade panel, dialogs |
| `--surface-raised` | `#21362b` | `#e4e9db` | Selected trade tab, hover |
| `--field` | `#11231b` | `#f1f1e7` | Inputs and tab track |
| `--ink` | `#f4ebd7` | `#17291e` | Primary text |
| `--muted` | `#b4c3b7` | `#4f6354` | Supporting text |
| `--line` | `#3b5142` | `#c3ccba` | Dividers and field boundaries |
| `--gold` | `#e9c368` | `#745216` | Identity, current mood |
| `--gold-soft` | `#263726` | `#eae4cc` | Current mood background |
| `--action` | `#2d4fbc` | `#2647ad` | Primary action |
| `--action-hover` | `#355dd8` | `#1d398c` | Primary hover |
| `--on-action` | `#ffffff` | `#ffffff` | Primary button text |
| `--positive` | `#acd7aa` | `#286237` | Positive changes/confirmed approval |
| `--negative` | `#ffa69d` | `#ac3026` | Negative changes/errors |
| `--focus` | `#f6da6b` | `#2447b1` | 3px keyboard outline, 4px offset |

Status always includes words or a symbol; color alone is insufficient. The cat’s authored palette is independent of UI theme and matches the supplied coin, fur, visor, clothes and ticket colors. Contrast evidence belongs in `VALIDATION.md`; decorative artwork is not interface text.

## Typography

`--font-heading` is locally bundled Fraunces 700, with Georgia/serif fallback. `--font-body` is locally bundled DM Sans 400 and 600, with sans-serif fallback. The WOFF2 declarations live in `web/src/styles.css`; the lockfile pins the Fontsource packages. These are the only two families and three weights. Font synthesis is disabled after rendered checks confirmed the required local fonts loaded.

The six token sizes are 14px supporting text (`--text-small`), 16px body, 24px values, 28px section headings, 48px compact display and 72px desktop display. A given viewport uses five sizes. H1 is the largest and uses the heaviest weight. Headings use 1.15 line height, balanced wrapping and −0.015 to −0.04em tracking; body uses 1.5 and natural tracking. Long prose is capped around 58 characters. Mobile inputs remain at least 16px. Changing values use tabular numbers. Addresses and unbounded values wrap rather than disappearing behind ellipses; the compact connected address opens a dialog with its complete value.

## Layout

The page shell is at most 1,160px wide with 24px desktop and 16px phone gutters. Spacing uses mostly 4/8/12/16/20/24/32px increments, with 44–72px between major sections. The top desktop grid has a 1.25:1 hero/trade split and 64px gap. It tightens at 58rem and becomes one column at 43rem. The mobile hero places the coin beside the heading so the main action stays on the first screen at 390×844.

At 390px, five mood thumbnails fit in one row. Below 23rem, they use a three-column grid, and the hero coin narrows to 94px to preserve the 48px heading without sideways overflow. The seven-day strip is seven columns on desktop and four columns with a second row on phones. Metrics become two columns; the story becomes one. Nothing essential is sticky or covers content. Widths 320, 390, 768 and 1440 were measured; validation lists separate text enlargement and browser limitations.

## Elevation & Depth

The trade surface is one quiet tonal layer with no box shadow. Form groups are separated by space and rules, not nested cards. The mood selection uses a gold border plus the explicit “Today” label. Native dialogs enter the top layer with a black 65% backdrop; they do not depend on arbitrary z-index values. The skip link alone uses z-index 100.

## Shapes

Buttons and fields use 8px radii, the tab track 10px, mood tiles 12px, and the trade panel/dialogs 16px (14px trade panel on phones). The coin itself is circular with 16 rim stars, black outlines, a gold rim and a royal blue disc. Avoid reusing the coin’s gradients for interface text or surfaces.

## Components

- `Cat` in `web/src/Cat.tsx`: `mood` selects Crying, Grumpy, Smug, Content or Grinning. `decorative` hides repeated artwork from assistive technology; the informative form labels the mood. All variants share the same bust and coin with distinct eyes, mouths, ears and visor placement.
- `MoodCoin` in `web/src/App.tsx`: five layered SVGs transition opacity over 300ms. The parent exposes one current-mood name. Reduced motion removes the transition entirely; there is no page-load animation.
- Buttons in `web/src/styles.css`: neutral outline, royal blue `.primary`, borderless `.text-button` and 44px `.icon-button`. Rest, hover, pressed, focus and disabled states are defined. Press scale is 0.96 for users permitting motion. Touch avoids sticky hover styles.
- `WalletSheet` in `web/src/wallet.tsx`: native modal dialog, provider marks/names, 52px rows, desktop centered panel and phone bottom sheet. Escape, backdrop and close button dismiss it; native dialog behavior traps and restores focus. A connected wallet has full-address copy, explorer and disconnect controls. Chain-switch failure has an actionable message.
- `Swap` in `web/src/Swap.tsx`: native pressed buttons for direction; labeled decimal amount/slippage fields; live balances; explicit approval checklist; quote and minimum-output review. Unavailable, stale, insufficient, pending, rejected, simulated-revert and confirmed states use persistent inline text. Primary action follows connection → chain → token approval → router approval → review.
- `TransactionProvider` / `TransactionStatus` in `web/src/transactions.tsx`: synchronous write lock plus action-specific status, simulation, account/chain rechecks, receipt tracking, replacement handling and explorer links. Trade and token panels show only their relevant transaction status.
- `TokenTools` in `web/src/TokenTools.tsx`: native disclosure, select and forms for transfer, allowance/revocation and delegated transfer. Live balances/allowances and a native review dialog precede writes.
- `Copy` in `web/src/App.tsx`: clipboard action with a polite success/fallback announcement. Full values remain visible if clipboard access is unavailable.
- `RecoveryBoundary` in `web/src/main.tsx`: catches unexpected rendering failures and presents a reload action. Configuration failures have a separate plain-language screen; they do not expose signing controls.

## Do’s and don’ts

Reuse semantic color tokens in both themes. Keep the coin artwork’s palette fixed. Use the primary fill for the next transaction step and neutral treatment for supporting controls. Keep long identifiers selectable and wrapping. Keep financial errors plain even though Daemon’s captions have personality. Show stale/unavailable data explicitly; do not draw a mood, price or balance from invented market data.

To add another section, place it in `.page-shell`, use a correctly nested heading and `.section-heading`, then use existing field/button/dialog primitives. Preserve the mobile order of the face, its state and the main action. Do not add a marketing hero above the controls, additional tracked uppercase labels, a second font system or new deployment constants.
