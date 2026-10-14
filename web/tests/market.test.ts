import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAbiParameters, parseAbiParameters, keccak256, encodeAbiParameters } from 'viem';
import { canonicalAbiHash, type Runtime, type ReadClient } from '../src/config';
import { moodFor, pairedPrice, summarizeDays, parseAmount, encodeSwap, errorMessage, PoolHistory, type PriceEvent, type Quote } from '../src/market';
import { swapParams, extendedSwapParams, poolKeyParams, swapEvent, initializeEvent } from '../src/protocol';
import { switchNetwork, OPEN_IN } from '../src/wallet';

const handoff = JSON.parse(readFileSync(new URL('../deployment/handoff.json', import.meta.url), 'utf8'));
const network = JSON.parse(readFileSync(new URL('../deployment/network.json', import.meta.url), 'utf8'));
const abi = JSON.parse(readFileSync(new URL('../../docs/abi/LaunchToken.json', import.meta.url), 'utf8'));
const pool = handoff.poolKey;
const rt = { deployment: { ...handoff, ...network }, chain: { id: handoff.chainId }, poolId: keccak256(encodeAbiParameters(poolKeyParams, [pool])), startBlock: 100n } as Runtime;

test('implementation ABI matches the handoff canonical Keccak hash', () => {
  assert.equal(canonicalAbiHash(abi), handoff.contracts[0].abiHash);
  assert.notEqual(canonicalAbiHash(abi.slice(1)), handoff.contracts[0].abiHash);
});
test('every exact mood boundary and the inside bands', () => {
  assert.deepEqual([-40, -20, -19.99, -5, -4.99, 0, 4.99, 5, 19.99, 20, 40].map(moodFor), ['Crying', 'Crying', 'Grumpy', 'Grumpy', 'Smug', 'Smug', 'Smug', 'Content', 'Content', 'Grinning', 'Grinning']);
});
test('price orientation follows the token position and decimals', () => {
  assert.equal(pairedPrice(2n * 2n ** 96n, true, 18, 18), 4);
  assert.equal(pairedPrice(2n * 2n ** 96n, false, 18, 18), .25);
  assert.equal(pairedPrice(2n * 2n ** 96n, true, 6, 18), 4e-12);
});
test('UTC open uses last pre-midnight event, with intraday high and low', () => {
  const day = 86400 * 20000;
  const events: PriceEvent[] = [
    { block: 1n, index: 0, timestamp: day - 1, sqrtPrice: 100n, kind: 'swap' },
    { block: 2n, index: 0, timestamp: day, sqrtPrice: 125n, kind: 'swap' },
    { block: 3n, index: 0, timestamp: day + 1, sqrtPrice: 80n, kind: 'swap' },
    { block: 4n, index: 0, timestamp: day + 2, sqrtPrice: 106n, kind: 'swap' },
  ];
  const today = summarizeDays(events.reverse(), day + 3, Number).at(-1)!;
  assert.equal(today.mood, 'Content'); assert.ok(Math.abs(today.change! - 6) < 1e-10);
  assert.equal(today.high, 25); assert.ok(Math.abs(today.low! + 20) < 1e-10);
});
test('first ever swap uses Initialize as pre-swap price, even in the same block', () => {
  const day = 86400 * 20000;
  const events: PriceEvent[] = [
    { block: 100n, index: 5, timestamp: day + 1, sqrtPrice: 50n, kind: 'swap' },
    { block: 100n, index: 2, timestamp: day + 1, sqrtPrice: 100n, kind: 'initialize' },
  ];
  const today = summarizeDays(events, day + 5, Number).at(-1)!;
  assert.equal(today.change, -50); assert.equal(today.mood, 'Crying');
  assert.equal(summarizeDays(events.slice(0, 1), day + 5, Number).at(-1)!.available, false);
});
test('no swaps today is Smug with 0%; pre-launch days remain unavailable', () => {
  const day = 86400 * 20000;
  const events: PriceEvent[] = [{ block: 100n, index: 2, timestamp: day - 4, sqrtPrice: 100n, kind: 'initialize' }];
  const days = summarizeDays(events, day + 5, Number);
  assert.equal(days.length, 7); assert.equal(days[0].available, false);
  assert.deepEqual([days[6].mood, days[6].change, days[6].swaps, days[6].available], ['Smug', 0, 0, true]);
});
test('amount parsing prevents negative, exponent, excess precision, zero and uint128 overflow', () => {
  assert.equal(parseAmount('1.250', 6), 1250000n);
  assert.equal(parseAmount('.5', 18), 500000000000000000n);
  for (const value of ['-1', '1e3', 'abc', '0', '0.0000001', '1,000', (2n ** 128n).toString()]) assert.throws(() => parseAmount(value, 6));
});
test('buy and sell encode the exact pool, direction, output floor and Permit2 settlement', () => {
  for (const input of [pool.currency0, pool.currency1]) for (const extended of [false, true]) {
    const quote: Quote = { input, amount: 100n, output: 200n, minimum: 194n, created: Date.now(), gasEstimate: 100000n, slippageBps: 300 };
    const swap = encodeSwap(pool, quote, extended);
    assert.equal(swap.commands, '0x10'); assert.equal(swap.value, 0n);
    const [actions, parameters] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), swap.inputs[0]);
    assert.equal(actions, '0x060c0f');
    const [single] = decodeAbiParameters(extended ? extendedSwapParams : swapParams, parameters[0]);
    assert.equal(single.poolKey.hooks.toLowerCase(), pool.hooks); assert.equal(single.poolKey.fee, pool.fee);
    assert.equal(single.zeroForOne, input === pool.currency0); assert.equal(single.amountOutMinimum, 194n);
    if ('minHopPriceX36' in single) assert.equal(single.minHopPriceX36, 0n);
    const [settle, amount] = decodeAbiParameters(parseAbiParameters('address,uint256'), parameters[1]);
    assert.equal(settle.toLowerCase(), input); assert.equal(amount, 100n);
    const [take, minimum] = decodeAbiParameters(parseAbiParameters('address,uint256'), parameters[2]);
    assert.equal(take.toLowerCase(), input === pool.currency0 ? pool.currency1 : pool.currency0); assert.equal(minimum, 194n);
  }
});
test('unknown wallet chain adds exact supplied settings then retries; rejection does not add', async () => {
  const calls: { method: string; params?: unknown }[] = [];
  let first = true;
  await switchNetwork({ request: async request => { calls.push(request); if (first) { first = false; throw { code: 4902 }; } return null; } }, rt);
  assert.deepEqual(calls.map(c => c.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  assert.deepEqual(calls[1].params, [network.walletAddChain]);
  let count = 0;
  await assert.rejects(() => switchNetwork({ request: async () => { count++; throw { code: 4001 }; } }, rt));
  assert.equal(count, 1);
});
test('mobile deep links retain IPFS subpath and encode query/hash correctly', () => {
  const url = 'https://example.org/ipfs/content-id/?a=1&b=2#trade';
  assert.equal(OPEN_IN.length, 4);
  assert.equal(new URL(OPEN_IN.find(w => w.id === 'rabby')!.href(url)).searchParams.get('_cmd'), 'open-dapp');
  assert.equal(new URL(OPEN_IN.find(w => w.id === 'rabby')!.href(url)).searchParams.get('dapp'), url);
  assert.equal(new URL(OPEN_IN.find(w => w.id === 'coinbase')!.href(url)).searchParams.get('cb_url'), url);
});
test('errors are translated without opaque selectors', () => {
  assert.match(errorMessage({ code: 4001 }), /declined/);
  assert.match(errorMessage(new Error('ERC20InsufficientBalance')), /balance is too low/);
  assert.match(errorMessage(new Error('V4TooLittleReceived')), /slippage/);
  assert.doesNotMatch(errorMessage(new Error('execution reverted: 0x12345678')), /0x12345678/);
});
test('history splits provider-limited ranges, retains visit cache and rereads the reorg tail', async () => {
  const requests: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getLogs: async (request: { fromBlock: bigint; toBlock: bigint; event: { name: string } }) => {
      requests.push(request);
      if (request.toBlock - request.fromBlock > 500n) throw new Error('block range limit');
      if (request.event.name === initializeEvent.name && request.fromBlock <= 100n && request.toBlock >= 100n) return [{ blockNumber: 100n, logIndex: 1, args: { sqrtPriceX96: 2n ** 96n } }];
      if (request.event.name === swapEvent.name && request.fromBlock <= 2100n && request.toBlock >= 2100n) return [{ blockNumber: 2100n, logIndex: 2, args: { sqrtPriceX96: 2n ** 96n } }];
      return [];
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1800000000n + blockNumber }),
  } as unknown as ReadClient;
  const history = new PoolHistory(rt);
  const events = await history.read(2200n, 1800002200, client);
  assert.equal(events.length, 2);
  const previous = requests.length;
  await history.read(2201n, 1800002201, client);
  assert.equal(requests.length - previous, 2);
  assert.equal(requests.at(-1)!.fromBlock, 2189n);
});
