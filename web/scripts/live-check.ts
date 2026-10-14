import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, defineChain, encodeAbiParameters, fallback, formatUnits, http, keccak256, type Abi } from 'viem';
import { poolKeyParams, quoter, stateView } from '../src/protocol';
import { PoolHistory, readMarket, verifyDeployment } from '../src/market';
import type { Runtime } from '../src/config';

// Read-only integration check. This script has no wallet, signing key or sendTransaction call.
const d = JSON.parse(await readFile(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
const abi: Abi = JSON.parse(await readFile(new URL(`../../dist/${d.contracts[0].abiPath}`, import.meta.url), 'utf8'));
const historyStart = JSON.parse(await readFile(new URL('../../dist/history-start.json', import.meta.url), 'utf8'));
const chain = defineChain({ id: d.chainId, name: d.network.name, nativeCurrency: d.network.nativeCurrency, rpcUrls: { default: { http: d.network.rpcUrls } } });
const client = createPublicClient({ chain, transport: fallback(d.network.rpcUrls.map((url: string) => http(url, { timeout: 10000, retryCount: 1 }))) });
const rt = { deployment: d, token: d.contracts.find((c: { name: string }) => c.name === 'LaunchToken'), tokenAbi: abi, pair: d.network.pairToken,
  chain, publicClient: client, poolId: keccak256(encodeAbiParameters(poolKeyParams, [d.poolKey])), startBlock: BigInt(historyStart.blockNumber) } as unknown as Runtime;
await verifyDeployment(rt);
const market = await readMarket(rt, new PoolHistory(rt));
const quote = await client.simulateContract({ address: d.network.uniswapV4.quoter, abi: quoter, functionName: 'quoteExactInputSingle', args: [{ poolKey: d.poolKey,
  zeroForOne: rt.pair.address.toLowerCase() === d.poolKey.currency0.toLowerCase(), exactAmount: 10n ** BigInt(rt.pair.decimals), hookData: '0x' }] });
const record = {
  checkedAt: new Date().toISOString(), mode: 'Read-only public RPC; no transaction signatures or broadcasts', chainId: await client.getChainId(), sourceCommit: d.sourceCommit,
  contractCode: await Promise.all(d.contracts.map(async (c: { name: string; address: `0x${string}` }) => { const code = await client.getCode({ address: c.address }); return { name: c.name, address: c.address, bytes: ((code?.length ?? 2) - 2) / 2 }; })),
  poolId: rt.poolId, poolKey: d.poolKey, name: market.name, symbol: market.symbol, decimals: market.decimals, totalSupply: formatUnits(market.supply, market.decimals),
  priceInIMD: market.price, liquidity: market.liquidity.toString(), block: market.block.toString(), days: market.days,
  quote: { input: '1 IMD', estimatedOutput: `${formatUnits(quote.result[0], market.decimals)} DAEMON`, gasEstimate: quote.result[1].toString(), method: 'eth_call / simulateContract(quoteExactInputSingle)' },
  limitations: ['No live wallet connection or signing', 'No live approvals, transfers or swaps', 'No ETH or USD conversion source in the handoff', 'Public RPC availability and rates may change'],
};
await writeFile(new URL('../../docs/evidence/live-rpc.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
