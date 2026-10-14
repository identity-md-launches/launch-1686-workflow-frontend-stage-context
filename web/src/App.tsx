import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUnits, getAddress } from 'viem';
import type { Runtime } from './config';
import { Cat } from './Cat';
import { CAPTIONS, MOODS, PoolHistory, errorMessage, number, pct, readMarket, verifyDeployment, type Mood } from './market';
import { useNow, useReadClient } from './hooks';
import { Icon, WalletSheet, short, switchNetwork, type Provider } from './wallet';
import { Swap } from './Swap';
import { TokenTools } from './TokenTools';
import { TransactionProvider } from './transactions';

function Copy({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState('');
  return <><button className="icon-button" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setStatus('Copied'); } catch { setStatus('Select the value to copy'); } }}><Icon name={status === 'Copied' ? 'check' : 'copy'}/></button><span className="sr-only" role="status">{status}</span></>;
}
function MoodCoin({ mood }: { mood: Mood }) {
  return <div className="mood-coin" role="img" aria-label={`Daemon is ${mood.toLowerCase()} today`}>
    {MOODS.map(m => <div key={m} className={`coin-layer ${mood === m ? 'visible' : ''}`} aria-hidden="true"><Cat mood={m} decorative/></div>)}
  </div>;
}
export default function App({ rt }: { rt: Runtime }) {
  const { address, chainId, connector } = useAccount();
  const client = useReadClient(rt);
  const queryClient = useQueryClient();
  const history = useMemo(() => new PoolHistory(rt), [rt]);
  const now = useNow();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [theme, setTheme] = useState(() => matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const verification = useQuery({ queryKey: ['verification'], queryFn: () => verifyDeployment(rt, client), refetchInterval: 60000, retry: 1 });
  const market = useQuery({ queryKey: ['market'], queryFn: () => readMarket(rt, history, client), enabled: verification.isSuccess, refetchInterval: 15000, retry: 1 });
  const data = market.data;
  const stale = !data || market.isError || verification.isError || now - data.updated > 45000;
  const today = data?.days.at(-1);
  const mood = today?.mood ?? 'Smug';
  const ready = verification.isSuccess && !stale && Boolean(data?.liquidity);
  const openWallet = () => setWalletOpen(true);
  const closeWallet = useCallback(() => setWalletOpen(false), []);
  const retry = () => { void verification.refetch(); void market.refetch(); };
  const connectedWrong = address && chainId !== rt.chain.id;
  const connectControl = async () => {
    if (!connectedWrong) { openWallet(); return; }
    setSwitching(true); setWalletError('');
    try { await switchNetwork(await connector!.getProvider() as Provider, rt); }
    catch (e) { setWalletError(errorMessage(e)); }
    finally { setSwitching(false); }
  };
  const liveStatus = verification.isError ? 'Verification unavailable' : market.isError || (data && stale) ? 'Stale' : data ? 'Live pool' : 'Reading the pool…';
  const share = `Daemon is ${mood.toLowerCase()} today (${today?.change !== undefined && !stale ? pct(today.change) : 'price unavailable'}). Every pawn shop has a cat.`;
  const days = data?.days ?? Array.from({ length: 7 }, (_, i) => ({ utc: Math.floor(now / 86400000) * 86400 - (6 - i) * 86400, mood: 'Smug' as Mood, change: undefined, available: false, swaps: 0 }));
  return <TransactionProvider rt={rt} client={client} onSuccess={() => { void queryClient.invalidateQueries({ queryKey: ['wallet'] }); void queryClient.invalidateQueries({ queryKey: ['token-tools'] }); void queryClient.invalidateQueries({ queryKey: ['market'] }); }}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><a className="brand" href="#main" aria-label="Daemon home"><Cat decorative/><span>Daemon<span className="brand-sub">The pawn shop cat</span></span></a><nav aria-label="Main navigation"><a className="desktop-link" href="#how-it-works">His story</a><button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/></button><button className="wallet-control" onClick={connectControl} disabled={switching}><Icon name="wallet"/><span>{switching ? 'Switching…' : connectedWrong ? `Switch to ${rt.chain.name}` : address ? short(getAddress(address)) : 'Connect'}</span></button></nav></header>
    {walletError && <p role="alert" className="error page-error">{walletError}</p>}
    <main id="main" className="page-shell">
      <div className="shop-window">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-heading"><h1 id="hero-title">Daemon</h1><p className="hero-description">Every pawn shop has a cat.</p></div>
          <MoodCoin mood={mood}/>
          <div className="mood-copy"><div className="mood-heading"><h2>{mood} today.</h2><span className={`daily-change ${today?.change !== undefined && today.change < 0 ? 'negative' : ''}`}>{today?.change !== undefined ? pct(today.change) : 'Price pending'}</span></div><p className="cat-caption">“{CAPTIONS[mood]}”</p><span className="small muted">{stale ? 'Default or last known mood' : today?.swaps === 0 ? 'No swaps today. He’s keeping watch.' : 'His face follows the DAEMON / IMD pool.'}</span></div>
        </section>
        <Swap rt={rt} client={client} market={data} ready={ready} connect={openWallet}/>
      </div>
      <div className="data-status"><span className={`status-dot ${stale ? 'stale' : ''}`}/><span>{liveStatus}{data ? ` · ${new Date(data.updated).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span><span className="status-detail">Refreshes every 15 seconds · UTC days</span><button className="text-button" onClick={retry} disabled={verification.isFetching || market.isFetching} aria-label="Refresh pool data"><Icon name="refresh" size={16}/><span>{market.isFetching || verification.isFetching ? 'Reading…' : 'Refresh'}</span></button></div>
      {(verification.isError || market.isError) && <p className="data-error" role="status">{errorMessage(verification.error ?? market.error)} Last known values, if any, are stale.</p>}
      <section className="mood-section" aria-labelledby="mood-title"><div className="section-heading"><h2 id="mood-title">A face for every day.</h2><p className="small muted">Five moods, one daily change.</p></div><div className="mood-strip">{MOODS.map((m, i) => <div key={m} className={`mood-item ${mood === m ? 'current' : ''}`} aria-current={mood === m ? 'true' : undefined}><Cat mood={m}/><span className="mood-name">{m}</span><span className="small muted">{['≤ −20%', '−20% to −5%', '−5% to +5%', '+5% to +20%', '≥ +20%'][i]}</span><span className="current-label">{m === mood ? 'Today' : ' '}</span></div>)}</div></section>
      <section className="numbers-section" aria-labelledby="numbers-title"><div className="section-heading"><h2 id="numbers-title">The shop window</h2><span className="small muted">{stale ? 'Awaiting fresh data' : `Block ${data?.block.toString()}`}</span></div><dl className="numbers-grid">
        <div><dt>Price per 1M DAEMON</dt><dd>{data ? number(data.price * 1e6) : 'Unavailable'}<span>{rt.pair.symbol}</span></dd></div>
        <div><dt>Market cap</dt><dd>{data ? number(data.price * Number(formatUnits(data.supply, data.decimals)), 0) : 'Unavailable'}<span>{rt.pair.symbol}</span></dd></div>
        <div><dt>Today’s high</dt><dd>{pct(today?.high)}</dd></div><div><dt>Today’s low</dt><dd>{pct(today?.low)}</dd></div>
      </dl><p className="small muted price-context">Prices are in IMD, the currency used by this pool. ETH and USD conversions are unavailable.</p></section>
      <section className="week-section" aria-labelledby="week-title"><div className="section-heading"><h2 id="week-title">A week behind the counter.</h2><span className="small muted">Last 7 UTC days</span></div><div className="week-strip">{days.map((day, i) => <div key={day.utc} className="week-day"><time dateTime={new Date(day.utc * 1000).toISOString().slice(0, 10)}>{i === 6 ? 'Today' : new Date(day.utc * 1000).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })}</time><Cat mood={day.mood} decorative/><span className="sr-only">{day.available ? day.mood : 'History unavailable'}</span><span className={day.change !== undefined && day.change < 0 ? 'negative' : ''}>{day.change === undefined ? 'No data' : pct(day.change)}</span></div>)}</div><p className="small muted">Each face compares that day’s close with its opening price. Today is still unfolding.</p></section>
      <section className="story-section" id="how-it-works" aria-labelledby="story-title"><div><h2 id="story-title">He minds the counter.<br/>You mind the market.</h2><p>Daemon sleeps in the Pawn shop window. His face follows the pool’s price from midnight UTC: a good day brings a grin, a rough one brings tears. The mood is cosmetic. It never changes the token.</p><a className="button share-button" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(share)}&url=${encodeURIComponent(location.href.split('#')[0])}`} target="_blank" rel="noreferrer">Share today’s mood <Icon name="external" size={16}/></a></div><div className="launch-terms"><h3>A cat with a shop to keep.</h3><p>1% of every trade goes to the creator’s wallet to help fund the Pawn shop, under the launch policy.</p><dl><div><dt>Fixed supply</dt><dd>1 billion DAEMON</dd></div><div><dt>Pool allocation</dt><dd>88%</dd></div><div><dt>Swarm allocation</dt><dd>10%</dd></div><div><dt>Creator allocation</dt><dd>2%</dd></div></dl><p className="small muted">Allocations and trade fees are handled by the launch factory and pool. The token has no owner, mint, pause or upgrade controls.</p></div></section>
      <section className="contracts-section" aria-labelledby="contracts-title"><div className="section-heading"><h2 id="contracts-title">Check the provenance</h2><span className="small muted">Ethereum · Uniswap v4</span></div><div className="contract-row"><div><span className="small muted">DAEMON token</span><a className="full-address" href={`${rt.deployment.network.explorer}/address/${rt.token.address}`} target="_blank" rel="noreferrer">{getAddress(rt.token.address)}</a></div><Copy value={getAddress(rt.token.address)} label="token address"/></div><div className="contract-row"><div><span className="small muted">Daemon / {rt.pair.symbol} pool ID</span><a className="full-address" href={`${rt.deployment.network.explorer}/address/${rt.deployment.network.uniswapV4.poolManager}#events`} target="_blank" rel="noreferrer">{rt.poolId}</a></div><Copy value={rt.poolId} label="pool ID"/></div><details className="deployment-details"><summary>Deployment & pool settings</summary><dl><div><dt>Pool fee</dt><dd>{rt.deployment.poolKey.fee / 10000}%</dd></div><div><dt>Tick spacing</dt><dd>{rt.deployment.poolKey.tickSpacing}</dd></div><div><dt>Initialization guard</dt><dd><a className="full-address" href={`${rt.deployment.network.explorer}/address/${rt.deployment.poolKey.hooks}`} target="_blank" rel="noreferrer">{getAddress(rt.deployment.poolKey.hooks)}</a></dd></div><div><dt>Source commit</dt><dd className="full-address">{rt.deployment.sourceCommit}</dd></div></dl><a href="./imd-deployment.json" target="_blank" rel="noreferrer">View attested deployment configuration ↗</a></details></section>
      <TokenTools rt={rt} client={client} ready={ready} decimals={data?.decimals ?? 18} connect={openWallet}/>
    </main>
    <footer className="site-footer"><a href="https://x.com/PawnIMD" target="_blank" rel="noreferrer">Find the Pawn shop ↗</a><span>No analytics. No cookies. Just a cat.</span><span>Not financial advice.</span></footer>
    <WalletSheet rt={rt} open={walletOpen} onClose={closeWallet}/>
  </TransactionProvider>;
}
