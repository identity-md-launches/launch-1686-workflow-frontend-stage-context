import { encodeAbiParameters, formatUnits, parseAbiParameters, parseUnits, type Address, type Hex } from 'viem';
import type { PoolKey, ReadClient, Runtime } from './config';
import { erc20, extendedSwapParams, initializeEvent, permit2, quoter, stateView, swapEvent, swapParams } from './protocol';

export const MOODS = ['Crying', 'Grumpy', 'Smug', 'Content', 'Grinning'] as const;
export type Mood = typeof MOODS[number];
export const CAPTIONS: Record<Mood, string> = {
  Crying: 'Who sold the fish.', Grumpy: 'Shop’s closed. Go away.', Smug: 'I see everything that comes through that door.',
  Content: 'Good customers today.', Grinning: 'Best day in the shop. Don’t touch the counter.',
};
export const moodFor = (change: number): Mood => change <= -20 ? 'Crying' : change <= -5 ? 'Grumpy' : change >= 20 ? 'Grinning' : change >= 5 ? 'Content' : 'Smug';
export const pct = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? 'Unavailable' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;
export const number = (value: number, digits = 4) => new Intl.NumberFormat('en', { maximumFractionDigits: digits, notation: Math.abs(value) >= 1e9 ? 'compact' : 'standard' }).format(value);
export const units = (value: bigint, decimals: number, digits = 6) => {
  const n = Number(formatUnits(value, decimals));
  return n > 0 && n < 10 ** -digits ? `<${10 ** -digits}` : number(n, digits);
};
export function parseAmount(input: string, decimals: number): bigint {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input.trim())) throw new Error('Enter a positive amount using numbers and a decimal point.');
  if ((input.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const amount = parseUnits(input.trim(), decimals);
  if (amount <= 0n || amount >= 2n ** 128n) throw new Error('Enter an amount greater than zero and within the swap limit.');
  return amount;
}
export const changeFrom = (value: number, open: number) => (value / open - 1) * 100;
export function pairedPrice(sqrt: bigint, tokenIs0: boolean, tokenDecimals: number, pairDecimals: number) {
  const ratio = (Number(sqrt) / 2 ** 96) ** 2;
  return (tokenIs0 ? ratio : 1 / ratio) * 10 ** (tokenDecimals - pairDecimals);
}
export type PriceEvent = { block: bigint; index: number; timestamp: number; sqrtPrice: bigint; kind: 'swap' | 'initialize' };
export type Day = { utc: number; change?: number; high?: number; low?: number; mood: Mood; swaps: number; available: boolean };
export function summarizeDays(events: PriceEvent[], now: number, price: (sqrt: bigint) => number): Day[] {
  const midnight = Math.floor(now / 86400) * 86400;
  const ordered = [...events].sort((a, b) => a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1);
  return Array.from({ length: 7 }, (_, i) => {
    const utc = midnight - (6 - i) * 86400;
    const before = ordered.filter(e => e.timestamp < utc).at(-1);
    const inside = ordered.filter(e => e.timestamp >= utc && e.timestamp < utc + 86400);
    const swaps = inside.filter(e => e.kind === 'swap');
    // Initialize gives the true pre-swap price when the first-ever swap is today's.
    const initial = before ?? inside.find(e => e.kind === 'initialize');
    if (!initial) return { utc, mood: 'Smug', swaps: swaps.length, available: false };
    if (!swaps.length) return { utc, mood: 'Smug', swaps: 0, change: 0, high: 0, low: 0, available: true };
    const open = price(initial.sqrtPrice);
    const changes = [0, ...swaps.map(s => changeFrom(price(s.sqrtPrice), open))];
    const change = changes.at(-1)!;
    return { utc, mood: moodFor(change), swaps: swaps.length, change, high: Math.max(...changes), low: Math.min(...changes), available: true };
  });
}
export type Market = { name: string; symbol: string; decimals: number; supply: bigint; price: number; liquidity: bigint; days: Day[]; block: bigint; updated: number; chainTime: number };
export async function verifyDeployment(rt: Runtime, client: ReadClient = rt.publicClient) {
  const chainId = await client.getChainId();
  if (chainId !== rt.deployment.chainId) throw new Error('The RPC returned the wrong network. Trading is disabled.');
  const addresses = [...new Set([...rt.deployment.contracts.map(c => c.address), rt.pair.address, rt.deployment.poolKey.hooks, ...Object.entries(rt.deployment.network.uniswapV4).filter(([k]) => k !== 'extendedSwapParams').map(([,v]) => v as Address)])];
  await Promise.all(addresses.map(async address => {
    const code = await client.getCode({ address });
    if (!code || code === '0x') throw new Error('A configured contract has no code. Trading is disabled.');
  }));
  return true;
}

// Visit-local cache: closed chunks are retained; the last 12 blocks are re-read for reorgs.
export class PoolHistory {
  private events: PriceEvent[] = [];
  private scanned?: bigint;
  private timestamps = new Map<bigint, number>();
  constructor(private rt: Runtime) {}
  private async timestamp(block: bigint, client: ReadClient) {
    if (!this.timestamps.has(block)) this.timestamps.set(block, Number((await client.getBlock({ blockNumber: block })).timestamp));
    return this.timestamps.get(block)!;
  }
  private async logs(from: bigint, to: bigint, client: ReadClient): Promise<PriceEvent[]> {
    try {
      const [swaps, initializations] = await Promise.all([
        client.getLogs({ address: this.rt.deployment.network.uniswapV4.poolManager, event: swapEvent, args: { id: this.rt.poolId }, fromBlock: from, toBlock: to, strict: true }),
        client.getLogs({ address: this.rt.deployment.network.uniswapV4.poolManager, event: initializeEvent, args: { id: this.rt.poolId }, fromBlock: from, toBlock: to, strict: true }),
      ]);
      const result: PriceEvent[] = [];
      for (const [logs, kind] of [[swaps, 'swap'], [initializations, 'initialize']] as const) {
        for (const log of logs) result.push({ block: log.blockNumber, index: log.logIndex, timestamp: await this.timestamp(log.blockNumber, client), sqrtPrice: log.args.sqrtPriceX96, kind });
      }
      return result;
    } catch (e) {
      // Providers impose different range limits. Split only range/size errors, never retry every network failure recursively.
      if (to > from && /range|limit|too many|size|10,000|10000/i.test(String(e))) {
        const mid = (from + to) / 2n;
        return [...await this.logs(from, mid, client), ...await this.logs(mid + 1n, to, client)];
      }
      throw e;
    }
  }
  async read(latest: bigint, now: number, client: ReadClient = this.rt.publicClient) {
    const earliest = Math.floor(now / 86400) * 86400 - 6 * 86400;
    if (this.scanned === undefined || latest < this.scanned) {
      const collected: PriceEvent[] = [];
      let to = latest;
      // Walk backwards until we have an opening price before the displayed week, or the attested launch boundary.
      // A bounded budget avoids runaway calls for old, inactive pools; insufficient history is explicitly stale.
      for (let chunk = 0; ; chunk++) {
        if (chunk >= 160) throw new Error('Pool history exceeded this visit’s read budget. History is stale; try again later.');
        const from = to - 1999n > this.rt.startBlock ? to - 1999n : this.rt.startBlock;
        if (from > to) throw new Error('The RPC has not reached the deployment block yet.');
        collected.push(...await this.logs(from, to, client));
        if (from === this.rt.startBlock || collected.some(e => e.timestamp < earliest)) break;
        to = from - 1n;
      }
      this.events = collected;
    } else {
      const from = this.scanned - 11n > this.rt.startBlock ? this.scanned - 11n : this.rt.startBlock;
      for (const block of this.timestamps.keys()) if (block >= from) this.timestamps.delete(block);
      const refreshed: PriceEvent[] = [];
      for (let start = from; start <= latest; start += 2000n) refreshed.push(...await this.logs(start, start + 1999n < latest ? start + 1999n : latest, client));
      this.events = [...this.events.filter(e => e.block < from), ...refreshed];
    }
    this.scanned = latest;
    // Retain the last event before the week as its opening reference.
    this.events.sort((a, b) => a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1);
    const before = this.events.filter(e => e.timestamp < earliest).at(-1);
    this.events = [...(before ? [before] : []), ...this.events.filter(e => e.timestamp >= earliest)];
    return this.events;
  }
}

export async function readMarket(rt: Runtime, history: PoolHistory, client: ReadClient = rt.publicClient): Promise<Market> {
  const block = await client.getBlock();
  const chainTime = Number(block.timestamp);
  if (Math.abs(Date.now() / 1000 - chainTime) > 180) throw new Error('The latest RPC block is stale. Trading is disabled until it catches up.');
  const base = { address: rt.token.address, abi: rt.tokenAbi, blockNumber: block.number };
  const [name, symbol, decimals, supply, slot, liquidity, pairSymbol, pairDecimals] = await Promise.all([
    client.readContract({ ...base, functionName: 'name' }) as Promise<string>,
    client.readContract({ ...base, functionName: 'symbol' }) as Promise<string>,
    client.readContract({ ...base, functionName: 'decimals' }) as Promise<number>,
    client.readContract({ ...base, functionName: 'totalSupply' }) as Promise<bigint>,
    client.readContract({ address: rt.deployment.network.uniswapV4.stateView, abi: stateView, functionName: 'getSlot0', args: [rt.poolId], blockNumber: block.number }),
    client.readContract({ address: rt.deployment.network.uniswapV4.stateView, abi: stateView, functionName: 'getLiquidity', args: [rt.poolId], blockNumber: block.number }),
    client.readContract({ address: rt.pair.address, abi: erc20, functionName: 'symbol' }),
    client.readContract({ address: rt.pair.address, abi: erc20, functionName: 'decimals' }),
  ]);
  if (symbol !== 'DAEMON' || name !== 'Daemon' || decimals !== 18 || pairSymbol !== rt.pair.symbol || pairDecimals !== rt.pair.decimals) throw new Error('Token metadata differs from the handoff. Trading is disabled.');
  if (slot[0] === 0n) throw new Error('The attested pool is not initialized yet.');
  const events = await history.read(block.number, chainTime, client);
  const price = (sqrt: bigint) => pairedPrice(sqrt, rt.token.address.toLowerCase() === rt.deployment.poolKey.currency0.toLowerCase(), decimals, rt.pair.decimals);
  return { name, symbol, decimals, supply, price: price(slot[0]), liquidity, days: summarizeDays(events, chainTime, price), block: block.number, updated: Date.now(), chainTime };
}
export type WalletState = { account: Address; input: Address; balance: bigint; tokenAllowance: bigint; routerAllowance: bigint; expiration: number; nativeBalance: bigint; updated: number };
export async function readWallet(rt: Runtime, account: Address, input: Address, client: ReadClient = rt.publicClient): Promise<WalletState> {
  const v4 = rt.deployment.network.uniswapV4;
  const abi = input.toLowerCase() === rt.token.address.toLowerCase() ? rt.tokenAbi : erc20;
  const [balance, tokenAllowance, allowance, nativeBalance] = await Promise.all([
    client.readContract({ address: input, abi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
    client.readContract({ address: input, abi, functionName: 'allowance', args: [account, v4.permit2] }) as Promise<bigint>,
    client.readContract({ address: v4.permit2, abi: permit2, functionName: 'allowance', args: [account, input, v4.universalRouter] }),
    client.getBalance({ address: account }),
  ]);
  return { account, input, balance, tokenAllowance, routerAllowance: allowance[0], expiration: allowance[1], nativeBalance, updated: Date.now() };
}
export type Quote = { input: Address; amount: bigint; output: bigint; minimum: bigint; created: number; slippageBps: number; gasEstimate: bigint };
export async function getQuote(rt: Runtime, input: Address, amount: bigint, slippageBps: number, client: ReadClient = rt.publicClient): Promise<Quote> {
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error('Slippage must be between 0.1% and 5%.');
  const result = await client.simulateContract({ address: rt.deployment.network.uniswapV4.quoter, abi: quoter,
    functionName: 'quoteExactInputSingle', args: [{ poolKey: rt.deployment.poolKey, zeroForOne: input.toLowerCase() === rt.deployment.poolKey.currency0.toLowerCase(), exactAmount: amount, hookData: '0x' }] });
  const output = result.result[0];
  const minimum = output * BigInt(10000 - slippageBps) / 10000n;
  if (minimum <= 0n || output >= 2n ** 128n) throw new Error('No usable quote for this amount. Try a different amount.');
  return { input, amount, output, minimum, created: Date.now(), slippageBps, gasEstimate: result.result[1] };
}
export function encodeSwap(poolKey: PoolKey, quote: Quote, extended = false): { commands: Hex; inputs: Hex[]; value: bigint } {
  const zeroForOne = quote.input.toLowerCase() === poolKey.currency0.toLowerCase();
  const output = zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const common = { poolKey, zeroForOne, amountIn: quote.amount, amountOutMinimum: quote.minimum, hookData: '0x' as Hex };
  const single = extended ? encodeAbiParameters(extendedSwapParams, [{ ...common, minHopPriceX36: 0n }]) : encodeAbiParameters(swapParams, [common]);
  return { commands: '0x10', inputs: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', [single,
    encodeAbiParameters(parseAbiParameters('address,uint256'), [quote.input, quote.amount]),
    encodeAbiParameters(parseAbiParameters('address,uint256'), [output, quote.minimum]),
  ]])], value: BigInt(quote.input) === 0n ? quote.amount : 0n };
}
export function errorMessage(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; cause?: unknown; code?: number };
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''} ${e?.cause ? errorMessage(e.cause) : ''}`;
  if (e?.code === 4001 || /reject|denied/i.test(text)) return 'Request declined in your wallet. You can try again.';
  if (/ProviderNotFound|provider was not found|no provider/i.test(text)) return 'No browser wallet was found. Install an extension, open this page in a wallet app, or choose Coinbase Wallet.';
  if (/insufficient.*balance|ERC20InsufficientBalance/i.test(text)) return 'Your token balance is too low for this amount.';
  if (/insufficient funds|gas/i.test(text) && !/gasEstimate/.test(text)) return 'Keep some ETH in your wallet to pay the network fee.';
  if (/TooLittleReceived|slippage/i.test(text)) return 'The price moved beyond your slippage limit. Get a fresh estimate.';
  if (/InsufficientAllowance|ERC20InsufficientAllowance|AllowanceExpired/i.test(text)) return 'An approval is missing or expired. Refresh the allowance and try again.';
  if (/NotEnoughLiquidity|PoolNotInitialized/i.test(text)) return 'The pool has no available liquidity for this trade.';
  if (/deadline/i.test(text)) return 'This trade expired. Get a fresh estimate and try again.';
  if (/4902|unknown chain|unrecognized chain/i.test(text)) return 'Your wallet does not know this network yet. Add Ethereum and try again.';
  if (error instanceof Error && !/0x[a-f\d]{8}|Request Arguments|Docs:|Version:|HTTP request failed|fetch failed/i.test(error.message) && error.message.length < 220) return error.message;
  if (/revert|ExecutionFailed/i.test(text)) return 'The transaction simulation reverted. Refresh the estimate and check your balances and approvals.';
  return 'The network request failed. Try again, or reconnect your wallet.';
}
