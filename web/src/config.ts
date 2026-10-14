import { createConfig } from 'wagmi';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { createPublicClient, defineChain, fallback, http, isAddress, keccak256, toBytes, encodeAbiParameters, type Abi, type Address, type Hex, type PublicClient, type Transport } from 'viem';
import { poolKeyParams } from './protocol';

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type Deployment = {
  version: 1; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  poolKey: PoolKey; assets: { path: string; sha256: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address; extendedSwapParams?: boolean };
    pairToken: { address: Address; symbol: string; name: string; decimals: number };
    otherPairTokens?: { address: Address; symbol: string; decimals: number }[];
  };
  walletAddChain?: { chainId: Hex; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
};
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export const canonicalAbiHash = (abi: unknown) => keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
const safePath = (path: string) => /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
async function json(path: string) {
  if (!safePath(path)) throw new Error('Unsafe deployment asset path.');
  const response = await fetch(new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path}. Reload to try again.`);
  return response.json();
}
export async function loadConfig() {
  const deployment = await json('imd-deployment.json') as Deployment;
  const d = deployment;
  if (d.version !== 1 || d.chainId !== d.network?.chainId || !d.poolKey || !d.network.uniswapV4 || !d.network.rpcUrls.length) throw new Error('Deployment configuration is incomplete. Trading is disabled.');
  const allowed = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'poolKey', 'assets', 'network', 'walletAddChain'];
  if (Object.keys(d).some(k => !allowed.includes(k))) throw new Error('Unexpected deployment configuration.');
  const token = d.contracts.find(c => c.name === 'LaunchToken');
  if (!token || !isAddress(token.address) || ![d.poolKey.currency0, d.poolKey.currency1].some(a => a.toLowerCase() === token.address.toLowerCase())) throw new Error('Token is not in the attested pool.');
  const abiMap = new Map<string, Abi>();
  for (const c of d.contracts) {
    const abi = await json(c.abiPath);
    if (!Array.isArray(abi) || canonicalAbiHash(abi) !== c.abiHash) throw new Error(`ABI verification failed for ${c.name}.`);
    abiMap.set(c.name, abi as Abi);
  }
  const pairAddress = token.address.toLowerCase() === d.poolKey.currency0.toLowerCase() ? d.poolKey.currency1 : d.poolKey.currency0;
  const pair = [d.network.pairToken, ...(d.network.otherPairTokens ?? [])].find(t => t.address.toLowerCase() === pairAddress.toLowerCase());
  if (!pair) throw new Error('The pool’s paired currency is not in the network configuration.');
  const start = await json('history-start.json');
  if (!Number.isSafeInteger(start.blockNumber) || start.blockNumber <= 0) throw new Error('Pool history boundary is missing.');
  const chain = defineChain({
    id: d.chainId, name: d.network.name, nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: d.network.explorer } }, testnet: d.network.testnet,
  });
  const transport = fallback(d.network.rpcUrls.map(url => http(url, { timeout: 8000, retryCount: 1 })), { rank: false, retryCount: 0 });
  const publicClient = createPublicClient({ chain, transport, batch: { multicall: false }, pollingInterval: 15_000 });
  const wagmi = createConfig({ chains: [chain], multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: 'Daemon · The pawn shop cat', appLogoUrl: new URL('favicon.svg', document.baseURI).href })],
    transports: { [chain.id]: transport },
  });
  return { deployment, token, tokenAbi: abiMap.get('LaunchToken')!, pair, chain, publicClient, wagmi,
    poolId: keccak256(encodeAbiParameters(poolKeyParams, [d.poolKey])), startBlock: BigInt(start.blockNumber) };
}
export type Runtime = Awaited<ReturnType<typeof loadConfig>>;
export type ReadClient = PublicClient<Transport, Runtime['chain']>;
