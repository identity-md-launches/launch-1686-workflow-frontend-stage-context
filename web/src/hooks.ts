import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { createPublicClient, custom, fallback, http, type EIP1193Provider } from 'viem';
import type { Runtime } from './config';

export function useReadClient(rt: Runtime) {
  const { connector, chainId, status } = useAccount();
  const [provider, setProvider] = useState<EIP1193Provider>();
  useEffect(() => {
    let cancelled = false;
    setProvider(undefined);
    // During hydration wagmi exposes persisted connector metadata before its methods are restored.
    if (status === 'connected' && typeof connector?.getProvider === 'function' && chainId === rt.chain.id) connector.getProvider().then(p => { if (!cancelled) setProvider(p as EIP1193Provider); }).catch(() => {});
    return () => { cancelled = true; };
  }, [connector, chainId, status, rt]);
  return useMemo(() => provider ? createPublicClient({ chain: rt.chain, pollingInterval: 15000, transport: fallback([
    ...rt.deployment.network.rpcUrls.map(url => http(url, { timeout: 8000, retryCount: 1 })),
    custom(provider, { retryCount: 0 }),
  ], { rank: false, retryCount: 0 }) }) : rt.publicClient, [rt, provider]);
}
export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  return now;
}
