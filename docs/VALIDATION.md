# Frontend validation

Validated on 14 October 2026. This report records worker checks, not an independent audit or proof of live transaction execution. Source is under `web/`, the complete static export is under `dist/`, and evidence is under `docs/evidence/`.

## Result and deployment binding

The production build, typecheck, 12 unit tests, 19 browser interaction checks and all 16 checks in the pinned design probe passed. Chromium and WebKit rendered the export. Mainnet reads and a read-only quote also succeeded. No funded transaction was signed or broadcast.

The app loads `dist/imd-deployment.json` at runtime, then fetches and verifies its referenced implementation ABI. The manifest preserves the exact handoff contract set, chain ID, source commit, attestation, pool key and network objects. The ABI was obtained with `git show f200e589cf5d53a52181945be58967533ef752d3:docs/abi/LaunchToken.json`; its canonical Keccak-256 hash is `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee`. The original contract source and ABI were not edited.

The export contains 15 declared assets totaling 999,048 bytes, excluding the manifest itself. Every exported file other than the manifest is inventoried with its final-byte SHA-256, including the entrypoint and raw ABI. No runtime font, artwork or wallet mark requires a CDN. A clean `npm ci` followed by rebuilding produced a byte-for-byte identical manifest and inventory. `submission-audit.json` records the final path and size check.

The source, lockfile, export and evidence are complete in the working tree. Creating the requested Git commit was blocked by the worker filesystem: `git add web dist docs` returned `fatal: Unable to create '.git/index.lock': Read-only file system`. No commit was created, and no attempt was made to bypass that mount. The candidate repository files occupy approximately 4.79 MB uncompressed, with approximately 103 KB of existing Git pack data, comfortably below the 8 MiB submission limit; the final committed Git bundle could not be produced or measured on this read-only Git mount. Publication still needs the worker's changed files to be collected and committed by the writable submission process.

Two assignment conflicts are resolved explicitly:

- The deployed pool pairs DAEMON with IMD, not ETH. Prices, valuation, direction and approvals use that attested pair. ETH/USD conversions are labeled unavailable because the supplied configuration contains neither a verified IMD/ETH route nor a Chainlink feed. The app does not invent an oracle or reinterpret an IMD value as ETH.
- The overriding write budget does not permit a root `DESIGN.md`. The complete implemented design documentation is at `docs/DESIGN.md`. Only the expressly permitted `web/.gitignore` ignore file was added.

## Commands and evidence

From the repository root:

```sh
npm ci --prefix web --cache /tmp/daemon-npm-cache
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run verify
PLAYWRIGHT_BROWSERS_PATH=/tmp/daemon-browsers npm --prefix web run test:browser
npm --prefix web run check:live
PLAYWRIGHT_BROWSERS_PATH=/tmp/daemon-browsers \
  IMD_PLAYWRIGHT="$PWD/web/node_modules/playwright/index.mjs" \
  node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The pinned probe is an assignment input and will not be included in the submission. Its final results are preserved in `evidence/design-probe.json` and `evidence/design-probe-log.txt`. Build, typecheck, unit-test, installation and manifest-check logs are also preserved. The development server was separately started and checked for the exact exported manifest, ABI and transformed React entrypoint, then closed.

The worker's minimal Linux image lacked WebKit native libraries. Playwright browsers, downloaded Debian libraries and the Mesa software renderer were installed only in `/tmp`; none is included in the submission. The successful worker invocation used:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/daemon-browsers \
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
LIBGL_DRIVERS_PATH=/tmp/daemon-webkit-libs/usr/lib/x86_64-linux-gnu/dri \
__EGL_VENDOR_LIBRARY_FILENAMES=/tmp/daemon-webkit-libs/usr/share/glvnd/egl_vendor.d/50_mesa.json \
MESA_SHADER_CACHE_DIR=/tmp/daemon-mesa-cache \
XDG_CACHE_HOME=/tmp/daemon-xdg-cache \
npm --prefix web run test:browser
```

Host validation was skipped because it checked unused headed GTK dependencies; the headless WebKit process and its tests actually ran. On a conventional development machine, install Playwright's native dependencies using its supported installation procedure instead of reproducing these worker-specific paths.

## Interaction coverage

`web/tests/market.test.ts` passes 12 tests covering the implementation ABI hash, all mood boundaries, both pool orderings and decimal adjustments, UTC opens/highs/lows, initialization and a first swap in one block, no-swap and pre-launch days, input precision and limits, both five-field and six-field v4 encoding, unknown-chain add/switch behavior, mobile links, error messages, and adaptive log splitting/cache/reorg handling.

`web/tests/browser.mjs` serves the actual export at `/ipfs/daemon/`. RPC and EIP-1193 responses are fixtures; the nine transaction requests in this suite are intercepted, not broadcast. `evidence/interaction-results.json` records all 19 passing checks:

- Relative static hosting, runtime manifest loading and ABI binding; a tampered ABI fails closed.
- Disconnected browsing, EIP-6963 wallet names/icons, rejection recovery, keyboard dialog dismissal and focus return, reload/reconnection and account-change handling.
- Missing-chain switching, exact `wallet_addEthereumChain` settings and retry; subsequent wrong-chain changes gate transactions.
- Amount/precision/slippage validation, Max, large balances and full addresses, expired review disabling and review invalidation after an account change.
- Exact input-token approval to Permit2 and separate timed router allowance; rejected requests release pending state, delayed receipts keep the action disabled, and successful receipts require a cooldown plus fresh reads.
- Buy and sell simulations, exact router commands/actions, unchanged hook and pool key, output minimum and zero native value for this ERC-20 pair. A simulated slippage revert prevents signing.
- Token `transfer`, allowance/revocation and `transferFrom`, with reviews, simulations and live-state fixtures; `wallet_watchAsset` metadata.
- Public-RPC fallback, missing-code gating, reduced-motion behavior, four phone-wallet links and Coinbase Smart Wallet availability.
- Chromium at 320, 390, 768 and 1440 pixels, both themes, local fonts and axe checks; WebKit mobile rendering, quote, direction change and wallet sheet.

Screenshots beginning `mock-`, plus `webkit-mobile-wallets.png`, show these fixtures. They do not demonstrate successful mainnet swaps. Browser test results reported no missing local resources or unhandled application errors. The final manual browser session also reported zero console errors and warnings; public-RPC requests in that session returned HTTP 200. Earlier provider failures were observed during development and informed the visible retry/stale states.

## Better Interface review

The pinned Better Interface guide and its six domains informed implementation and final review. The pinned design-critic probe passed render, layout, targets, contrast, casing, tracking, eyebrows, type sizes, type faces, glyphs, slogans, repetition, copy budget, chrome, motion and sharing metadata. Manual screenshot review supplements these measurements; a probe pass is not a full accessibility certification.

| Domain | Coverage and result | Remaining limits |
| --- | --- | --- |
| Accessibility | Semantic headings/landmarks, named native controls, labeled amounts, textual mood/status, live transaction feedback, native modal focus trapping, Escape/return focus, visible keyboard focus, reduced motion and axe checks on page/wallet states. | No assistive-technology user session or full screen-reader audit. |
| Layout | Product, current mood, wallet control and main trade action visible at 390 × 844. Action bottom measured at 739.59px. No sideways scroll at 320/390/768/1440, including long values and open wallet sheets. Full desktop and mobile screenshots inspected. | Physical device/browser toolbar variations were not tested. |
| Writing | Amount units, approval scope, expected transaction, network fee, stale/failed states and recovery actions are adjacent to their controls. Copy names IMD accurately and explains unavailable conversions. | English only; no localization or right-to-left testing. |
| Typography | Local DM Sans and Fraunces; three weights, one six-token scale, five rendered sizes per measured width. Headline is the heaviest face. No tracked capital labels above headings. Root text enlarged to 200% at 1440 with no horizontal overflow. | Text enlargement is not a native browser-zoom test. |
| Colors | Light/dark semantic tokens, visible status labels independent of color, contrast probe passed. Resolved token measurements are saved for both themes. | Not every transient third-party wallet screen or every possible color adjacency was measured. |
| UI | Explicit buy/sell selection, exact approval checklist, review before signing, pending/confirmed/rejected/reverted/uncertain states, simulation gating, copy/explorer controls, mobile bottom sheet and measured targets. | Actual extension, passkey and phone-app authentication/signing remain untested. |

Measured contrast ratios from the final browser-rendered tokens:

| Pair | Dark | Light |
| --- | --- | --- |
| Body / page | 14.50:1 | 13.28:1 |
| Muted / surface | 8.10:1 | 6.25:1 |
| Primary button text / button | 7.10:1 | 8.12:1 |
| Focus / page | 12.41:1 | 6.98:1 |
| Focus / surface | 10.74:1 | 7.77:1 |

All 20 controls measured by the probe met its 24px-or-spacing rule. Nine supporting controls/links were below the preferred 44px comfortable size; principal wallet, trade and dialog controls use at least 44px, with the main trade action at 52px. This advisory remains documented rather than represented as a failed check.

Applicable findings were repaired before the final build:

| Finding | Final source location and fix | Recheck |
| --- | --- | --- |
| High: 320px hero exceeded the viewport by 7px. | `web/src/styles.css:296`: narrow-screen coin column reduced to 94px; text retains its intended scale. | Probe and browser measurements report scroll width 320 at width 320. |
| High: persisted connector metadata could lack methods during reload and crash reads. | `web/src/hooks.ts:13`: wait for connected status and a callable provider method; `web/src/main.tsx` adds visible recovery. | Reload/reconnection and fallback browser check passes. |
| High: successful deployment verification returned undefined, rejected by React Query. | `web/src/market.ts:59`: return an explicit successful verification value. | Live reads and all guarded interaction paths pass. |
| Medium: allowance UI could briefly reuse an old cache after a receipt. | `web/src/Swap.tsx:64`: hold the action lock through four seconds and a fresh allowance read. | Delayed receipt, rejection and sequential approvals pass. |
| Medium: nested field borders added unnecessary card chrome. | `web/src/styles.css:123`: use a simple amount field and divider inside the trade panel. | Probe reports zero cards inside cards and zero border-plus-shadow elements. |
| Medium: repeated promotional headings and excess introductory copy weakened the main control. | `web/src/App.tsx`: shortened the opening and supporting headings; directions stay with the trade panel. | Probe: 31 prose words on the mobile first screen, no repeated lines or kicker labels. |
| Medium: transaction replacement must not falsely confirm the original action. | `web/src/transactions.tsx:44`: distinguish repricing from cancellation/other replacement. | Source reviewed; replacement/cancellation is not claimed as a live or dedicated browser test. |

Final live screenshots: `mobile-live-dark.png`, `mobile-320.png`, `desktop-live-dark.png`, `desktop-live-light.png` and `mobile-keyboard-focus.png`. `mobile-live-measurement.json`, `mobile-320-measurement.json`, both contrast files and `text-enlargement.json` retain the corresponding measurements.

## Read-only mainnet check and limitations

At 04:27:43 UTC, block 26,188,344, the configured RPC returned Ethereum chain ID 1, 1,709 bytes of LaunchToken code, name Daemon, symbol DAEMON, 18 decimals and supply 1 billion. The attested pool returned nonzero liquidity. Two swaps today produced Smug at approximately +1.1202%; the prior six days correctly showed no data for this newly deployed pool. The configured quoter simulated 1 IMD to approximately 390,450.54869 DAEMON. Exact observations and the pool key are in `evidence/live-rpc.json`. These values are a timestamped observation, not a current price promise.

Public endpoints can fail or rate-limit. The app retains labeled stale data, offers retry and disables trading until deployment/pool/balance prerequisites are fresh. History has a 160-chunk initial scan budget and may report unavailable data for sufficiently old inactive pools. Display prices use floating-point formatting; transaction amounts, approvals and minimum outputs use integer arithmetic. ENS names are not resolved because the allowed configuration supplies no resolver. No ownership setup is applicable to this fixed-supply token.

Unperformed checks: funded wallet approvals/swaps/transfers; actual Coinbase passkey flow and extension or phone-app signing; native mobile deep-link invocation; screen-reader use; native browser 200% zoom; live transaction repricing/cancellation; IPFS pinning, named-site resolution, social crawler unfurl and publication checks. Publication was expressly outside this worker assignment. Relative Open Graph assets are ready; an absolute published URL cannot be asserted before a host is assigned.
