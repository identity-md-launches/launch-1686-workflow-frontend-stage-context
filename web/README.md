# Daemon’s shop window

Daemon is the Pawn shop’s grey tabby. This one-page, static app shows his daily market mood and lets a visitor buy or sell DAEMON with their own wallet on Ethereum. The mood is cosmetic: no contract reads it and it never changes the token.

The launch terms are a fixed supply of 1 billion DAEMON, with 88% for the pool, 10% for the swarm and 2% for the creator. The launch policy routes 1% of every trade to the creator to help fund the Pawn shop. Allocations and fees belong to the launch factory/pool; `LaunchToken` itself is an ordinary fixed-supply ERC-20 without owner, mint, pause, blocklist, fee or upgrade functions.

## Run and rebuild

Use Node 24 and npm 11 or later. All frontend configuration, dependencies and the lockfile are here, under `web/`.

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run verify
npm run preview
```

`npm run build` typechecks, runs Vite with `base: './'`, writes the production files to repository-root `dist/`, exports the pinned ABI and generates `dist/imd-deployment.json` **last**. It requires Git access to the deployed source commit retained in this repository. The export is the deliverable; hosting does not rebuild it. Serve `dist/` as static files over HTTP(S), including from an IPFS gateway subpath. There are no server APIs, history routes or rewrite requirements. `npm run dev` builds once, then starts Vite with hot updates. Its development middleware serves the same deployment manifest and ABI files from `dist/`; it has no independent deployment map. Use the production preview for final validation.

`npx tsx scripts/art.tsx` regenerates the original SVG smug-face favicon and the PNG share image from `src/Cat.tsx`. Run it before building when the artwork changes. All fonts and wallet marks are local. Font, wallet mark and guide attribution is in `docs/THIRD_PARTY.md`.

## The configuration has one runtime source

The app fetches `./imd-deployment.json` and every ABI path named in that file. It verifies each implementation ABI’s canonical Keccak-256 hash before rendering wallet controls. Addresses, chain ID, public RPC URLs, pool key and Uniswap deployment addresses are read only from this manifest. `src/protocol.ts` contains protocol function/event interfaces, not deployment addresses. There is no private RPC credential, relay, WalletConnect project ID or signing key.

`deployment/handoff.json` and `deployment/network.json` are unchanged copies of the supplied build inputs. They are never imported into the browser. `scripts/export.mjs`:

1. Compares these inputs with `.imd/reads/` when that directory exists.
2. Obtains `docs/abi/LaunchToken.json` from the exact deployed commit using `git show` and verifies its canonical Keccak hash. Canonicalization recursively sorts object keys and preserves array order.
3. Copies the complete handoff contract set, identifiers and exact pool key, plus the unchanged network and wallet-add-chain objects.
4. Exports `history-start.json`, containing only the handoff’s deployment block as the lower bound for event scanning. It is not a second deployment/address map.
5. Inventories **every** other exported file, including the ABI, entrypoint, fonts, artwork and history bound, with lowercase SHA-256. The manifest excludes itself.

`npm run verify` checks the exact manifest schema, handoff equality, ABI binding, asset inventory and final-byte hashes without modifying the export. Never edit an exported file and leave its old manifest. Rebuild instead. `web/.gitignore` is the only changed ignore file, explicitly allowed by the assignment; it excludes dependency/cache directories at all nesting levels. No vendored npm registry or submodule is used.

## IMD pairing and daily moods

The approved prose originally assumed an ETH pair. The attested deployment overrides that assumption: **DAEMON is currency0 and IMD is currency1**, with a 1.25% pool fee, tick spacing 60 and the nonzero initialization guard supplied in `poolKey`. Buying spends IMD; neither direction sends native ETH. The app never substitutes another pool or router.

The pool price is `(sqrtPriceX96 / 2^96)^2`, adjusted for token decimals. That ratio is IMD per DAEMON in this deployed ordering. If DAEMON is currency1, the price is inverted instead. Price and market cap are therefore displayed in IMD. ETH and USD values are explicitly unavailable: the handoff has no verified IMD/ETH price route or Chainlink feed. Inventing a feed address or labeling an IMD value as ETH would be incorrect.

The app reads the attested pool’s `Swap` and `Initialize` events from the configured v4 PoolManager. Each day’s open is the last post-swap price before 00:00 UTC. If there was no previous swap, the `Initialize` price is the true pre-swap price, including when initialization and the first swap share a block. An unavailable opening reference stays unavailable. High and low include the opening point and every observed swap. The seven-day strip includes today, whose close is provisional.

| Change since open | Mood |
| --- | --- |
| ≤ −20% | Crying |
| > −20% and ≤ −5% | Grumpy |
| > −5% and < +5% | Smug |
| ≥ +5% and < +20% | Content |
| ≥ +20% | Grinning |

With no swaps today, the mood is Smug and the change is 0%. Before the pool existed, days show “No data,” not fabricated history. Without fresh data, the initial Smug or last known face is explicitly labeled; stale prices never authorize a trade. Five original inline SVG faces cross-fade only when motion is permitted.

Reads refresh every 15 seconds while the page is visible. Historical logs are fetched in at most 2,000-block ranges, with adaptive splitting for provider range limits. A visit-local cache retains closed history and re-reads the latest 12 blocks for reorgs. Backward discovery stops at the deployment block or a usable opening reference, with a 160-chunk budget per initial scan. A pool with extremely old inactive history may exceed this budget and report stale data instead of pretending its opening price is known. Cache loss on reload is intentional; there is no cross-visitor database.

## Wallets and transactions

The wallet sheet lists EIP-6963 providers by name and icon, offers Coinbase Wallet/Smart Wallet and, in a phone browser without a provider, offers MetaMask, Coinbase Wallet, Rabby and Phantom deep links to the current page. A missing Ethereum network triggers `wallet_addEthereumChain` with the exact handoff parameters after `wallet_switchEthereumChain` fails with an unknown-chain error, then switches again. The connection is restored through wagmi’s local storage. No analytics or application cookies are used; an external wallet remains responsible for its own services and privacy policy.

Public RPCs are tried in the supplied order, followed by the connected wallet provider only when it is on the right chain. Live chain ID, nonempty code at the token, pair, hook and configured Uniswap contracts, token metadata, pool initialization/liquidity and freshness gate transaction controls. A stale latest block, wrong wallet chain, failed read or mismatched ABI fails closed. No funds are held by the app.

The swap flow is:

1. Enter the amount to spend and a slippage limit (default 3%, allowed 0.1–5%). Max uses the live balance and each token’s decimals. Keep ETH for gas.
2. Read an estimate using the configured quoter’s `quoteExactInputSingle` through `simulateContract`, never a transaction.
3. If short, approve the input token to Permit2 for the exact amount, then separately approve Permit2’s router allowance for that amount for one hour. Both steps wait for a successful receipt, a four-second cache cooldown and a fresh allowance read.
4. Review the input, estimated output, minimum output and slippage. Quotes expire after 30 seconds. Changing the account, network, side, amount or slippage dismisses the review.
5. Recheck balances/allowances and simulate the router’s `execute` before requesting a wallet signature. The 10-minute deadline and output minimum are encoded on chain. A revert explains the failure and prevents signing.

The universal router receives command `0x10`, actions `0x060c0f` and the exact pool key. The optional six-field swap tuple is used only when `network.uniswapV4.extendedSwapParams` is true; this handoff uses the five-field tuple. Token amount approval and router addresses always come from the network block. Approval, signing, confirmation, rejection, reversion and uncertain receipt states are visible. Uncertain receipts keep writes locked and expose a confirmation check and Etherscan link. Repricing is tracked; cancellation or replacement by another action is not reported as a successful original action.

The lower “Token controls” panel exposes `transfer`, `approve` (including revocation with 0) and `transferFrom`, with current balances/allowances, address checks, reviews and simulations. Paste full Ethereum addresses; ENS resolution is not offered because the allowed network configuration contains no ENS resolver. No owner setup panel is needed for this token.

## Validation

```sh
# Install browser runtimes outside the repository.
PLAYWRIGHT_BROWSERS_PATH=/tmp/daemon-browsers npx playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH=/tmp/daemon-browsers npm run test:browser
# Read-only mainnet code, pool, history and quote check; never broadcasts.
npx tsx scripts/live-check.ts
```

Browser tests manage a local server for the production export at `/ipfs/daemon/`, mock RPC and EIP-1193 wallets, and close both server and browsers afterward. They write clearly labeled evidence under `docs/evidence/`. Linux WebKit needs its native libraries/software renderer; this worker installed those only under `/tmp`. The exact worker setup and outcomes are in `docs/VALIDATION.md`. Set `SKIP_WEBKIT=1` only to explicitly record an incomplete local WebKit run.

The pinned design probe is run from the repository root with `IMD_PLAYWRIGHT` pointing to `web/node_modules/playwright/index.mjs`. Its temporary output stays in `test/scratch/taste`; the final result is copied to the validation evidence directory. Screenshots labeled `mock-` show fixtures, not live market outcomes.

The app has a local relative `og:image` and favicon. A final domain/CID was not assigned; published absolute metadata and social crawler behavior remain publication checks. This worker does not pin to IPFS, publish a name, redeploy contracts or execute a funded transaction. The root `DESIGN.md` request conflicts with the overriding path budget, so the implemented design is documented at **`docs/DESIGN.md`**.
