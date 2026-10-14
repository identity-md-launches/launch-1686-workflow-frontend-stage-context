import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi';
import { getAddress, toHex } from 'viem';
import type { Runtime } from './config';
import { errorMessage } from './market';

export type Provider = { request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown> };
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export async function switchNetwork(provider: Provider, rt: Runtime) {
  const request = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(rt.deployment.chainId) }] });
  try { await request(); }
  catch (e) {
    const error = e as { code?: number; message?: string; cause?: { code?: number } };
    if (!(error.code === 4902 || error.cause?.code === 4902 || /unknown chain|unrecognized chain|not added/i.test(error.message ?? '')) || !rt.deployment.walletAddChain) throw e;
    await provider.request({ method: 'wallet_addEthereumChain', params: [rt.deployment.walletAddChain] });
    await request();
  }
}
export function useDialog(open: boolean, onClose: () => void): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    dialog?.addEventListener('cancel', cancel);
    return () => dialog?.removeEventListener('cancel', cancel);
  }, [onClose]);
  return ref;
}
export function Icon({ name, size = 20 }: { name: 'wallet' | 'arrow' | 'copy' | 'external' | 'sun' | 'moon' | 'close' | 'check' | 'refresh'; size?: number }) {
  const paths = {
    wallet: 'M3 6h17v14H3z M3 6V4h14v2 M15 11h5v5h-5z', arrow: 'M5 12h14m-5-5 5 5-5 5',
    copy: 'M8 8h12v13H8z M16 8V3H3v13h5', external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
    sun: 'M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
    moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11', close: 'm6 6 12 12M6 18 18 6',
    check: 'm5 12 4 4L19 6', refresh: 'M20 7V2m0 5h-5M4 17v5m0-5h5M5 7a8 8 0 0 1 14-1M19 17A8 8 0 0 1 5 18',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const coinbaseMark = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="5" fill="#2C5FF6"/><circle cx="14" cy="14" r="10" fill="white"/><rect x="10" y="10" width="8" height="8" rx="1" fill="#2C5FF6"/></svg>');
export const OPEN_IN = [
  { id: 'metamask', name: 'MetaMask', href: (url: string) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, '')}` },
  { id: 'coinbase', name: 'Coinbase Wallet', href: (url: string) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  { id: 'rabby', name: 'Rabby', href: (url: string) => `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}` },
  { id: 'phantom', name: 'Phantom', href: (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
];
export function WalletSheet({ rt, open, onClose }: { rt: Runtime; open: boolean; onClose: () => void }) {
  const { address, connector, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useDialog(open, onClose);
  const named = connectors.some(c => c.type === 'injected' && c.id !== 'injected');
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !named && !(window as unknown as { ethereum?: unknown }).ethereum;
  const listed = [...connectors.filter(c => c.type === 'injected'), ...connectors.filter(c => c.type !== 'injected')].filter(c => !(c.id === 'injected' && named) && !(mobile && c.type === 'injected'));
  const connect = async (c: Connector) => {
    setError('');
    try {
      const result = await connectAsync({ connector: c });
      if (result.chainId !== rt.chain.id) await switchNetwork(await c.getProvider() as Provider, rt);
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };
  return <dialog ref={dialog} className="wallet-sheet" aria-labelledby="wallet-title" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-content">
      <div className="section-heading"><h2 id="wallet-title">{isConnected ? 'Your wallet' : 'Connect a wallet'}</h2><button className="icon-button" onClick={onClose} aria-label="Close wallet menu"><Icon name="close"/></button></div>
      {isConnected && address ? <>
        <p className="full-address">{getAddress(address)}</p>
        <div className="inline-actions"><button onClick={async () => { try { await navigator.clipboard.writeText(getAddress(address)); setCopied(true); } catch { setError('Copy unavailable. Select the address above to copy it.'); } }}><Icon name="copy"/>{copied ? 'Copied' : 'Copy address'}</button><a className="button" href={`${rt.deployment.network.explorer}/address/${address}`} target="_blank" rel="noreferrer">Etherscan<Icon name="external"/></a></div>
        {chainId !== rt.chain.id && <button className="primary wide" disabled={switching} onClick={async () => { setSwitching(true); setError(''); try { await switchNetwork(await connector!.getProvider() as Provider, rt); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setSwitching(false); } }}>{switching ? 'Switching…' : `Switch to ${rt.chain.name}`}</button>}
        <button className="wide" onClick={() => { disconnect(); onClose(); }}>Disconnect</button>
      </> : <>
        <p className="muted">Connect to trade. Reading the shop window is free.</p>
        {mobile && <div className="wallet-list">{OPEN_IN.map(wallet => <a className="wallet-row" key={wallet.id} href={wallet.href(location.href)}><img width="28" height="28" alt="" src={wallet.id === 'coinbase' ? coinbaseMark : `./wallets/${wallet.id}.svg`}/><span>Open in {wallet.name}</span><Icon name="arrow"/></a>)}</div>}
        <div className="wallet-list">{listed.map(c => <button className="wallet-row" key={c.uid} onClick={() => connect(c)} disabled={isPending}>
          {c.icon || c.id === 'coinbaseWalletSDK' ? <img width="28" height="28" alt="" src={c.icon ?? coinbaseMark}/> : <Icon name="wallet" size={28}/>}
          <span>{c.id === 'injected' ? 'Browser wallet' : c.id === 'coinbaseWalletSDK' && mobile ? 'Coinbase Smart Wallet' : c.name}{isPending && variables?.connector === c ? ' · opening…' : ''}</span><Icon name="arrow"/>
        </button>)}</div>
        {!named && !mobile && <p className="small muted">No browser wallet found? Install a wallet extension, or choose Coinbase Wallet to use a passkey.</p>}
      </>}
      <p className="error" role="alert">{error}</p>
    </div>
  </dialog>;
}
