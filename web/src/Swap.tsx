import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import type { ReadClient, Runtime } from './config';
import { encodeSwap, errorMessage, getQuote, parseAmount, readWallet, units, type Market, type Quote } from './market';
import { erc20, permit2, router } from './protocol';
import { Icon, switchNetwork, useDialog, type Provider } from './wallet';
import { useNow } from './hooks';
import { TransactionStatus, useTransaction } from './transactions';

export function Swap({ rt, client, market, ready, connect }: { rt: Runtime; client: ReadClient; market?: Market; ready: boolean; connect: () => void }) {
  const { address, chainId, isConnected, connector } = useAccount();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('3');
  const [error, setError] = useState('');
  const [watchStatus, setWatchStatus] = useState('');
  const [actionPending, setActionPending] = useState<'token' | 'permit' | 'swap' | 'switch' | 'watch'>();
  const [review, setReview] = useState<Quote>();
  const [debounced, setDebounced] = useState(amount);
  const { busy, send, transaction } = useTransaction();
  const now = useNow();
  const input = side === 'buy' ? rt.pair.address : rt.token.address;
  const inputSymbol = side === 'buy' ? rt.pair.symbol : 'DAEMON';
  const outputSymbol = side === 'buy' ? 'DAEMON' : rt.pair.symbol;
  const inputDecimals = side === 'buy' ? rt.pair.decimals : market?.decimals ?? 18;
  const outputDecimals = side === 'buy' ? market?.decimals ?? 18 : rt.pair.decimals;
  const wrongChain = isConnected && chainId !== rt.chain.id;
  const slippageBps = Math.round(Number(slippage) * 100);
  let parsed: bigint | undefined;
  let validation = '';
  try { if (amount) parsed = parseAmount(amount, inputDecimals); } catch (e) { validation = errorMessage(e); }
  if (!Number.isFinite(slippageBps) || slippageBps < 10 || slippageBps > 500) validation = 'Set slippage between 0.1% and 5%.';
  useEffect(() => { const t = setTimeout(() => setDebounced(amount), 350); return () => clearTimeout(t); }, [amount]);
  useEffect(() => { setReview(undefined); setError(''); }, [address, chainId, side, amount, slippage]);
  const wallet = useQuery({ queryKey: ['wallet', address, input], queryFn: () => readWallet(rt, address!, input, client), enabled: Boolean(address && !wrongChain && ready), refetchInterval: 15_000, retry: 1 });
  const quote = useQuery({ queryKey: ['quote', input, debounced, slippageBps], queryFn: () => getQuote(rt, input, parseAmount(debounced, inputDecimals), slippageBps, client),
    enabled: ready && Boolean(parsed) && debounced === amount && !validation, retry: false, refetchInterval: 15_000 });
  const freshQuote = quote.data && !quote.isError && quote.data.amount === parsed && quote.data.input === input && quote.data.slippageBps === slippageBps && debounced === amount && now - quote.data.created < 30_000 ? quote.data : undefined;
  const rate = freshQuote ? Number(formatUnits(freshQuote.output, outputDecimals)) / Number(formatUnits(freshQuote.amount, inputDecimals)) : undefined;
  const balances = wallet.data && wallet.data.account === address && wallet.data.input === input && !wallet.isError && now - wallet.data.updated < 30_000 ? wallet.data : undefined;
  const tokenApproved = Boolean(parsed && balances && balances.tokenAllowance >= parsed);
  const permitApproved = Boolean(parsed && balances && balances.routerAllowance >= parsed && balances.expiration > now / 1000 + 600);
  const insufficient = parsed && balances && parsed > balances.balance;
  const gasMissing = balances?.nativeBalance === 0n;
  const pending = Boolean(actionPending || busy);
  const canAct = ready && !wrongChain && Boolean(parsed && freshQuote && balances) && !validation && !insufficient && !gasMissing && !pending;
  const closeReview = () => setReview(undefined);
  const dialog = useDialog(Boolean(review), closeReview);

  const approve = async (step: 'token' | 'permit') => {
    if (!canAct || !address || !parsed) return;
    setActionPending(step); setError('');
    try {
      const state = await readWallet(rt, address, input, client);
      const v4 = rt.deployment.network.uniswapV4;
      if (step === 'token' && state.tokenAllowance < parsed) await send(`Approve ${inputSymbol} to Permit2`, {
        address: input, abi: side === 'sell' ? rt.tokenAbi : erc20, functionName: 'approve', args: [v4.permit2, parsed],
      }, address);
      if (step === 'permit' && (state.routerAllowance < parsed || state.expiration <= Date.now() / 1000 + 600)) await send('Approve router allowance', {
        address: v4.permit2, abi: permit2, functionName: 'approve', args: [input, v4.universalRouter, parsed, Math.floor(Date.now() / 1000) + 3600],
      }, address);
      // Keep the action locked through the receipt/cache gap and fresh allowance reads.
      await new Promise(resolve => setTimeout(resolve, 4000));
      await wallet.refetch();
    } catch (e) { setError(errorMessage(e)); }
    finally { setActionPending(undefined); }
  };
  const execute = async () => {
    if (!review || !address || !canAct) return;
    setActionPending('swap'); setError('');
    const snapshot = review;
    const guard = () => { if (Date.now() - snapshot.created >= 30_000) throw new Error('This estimate expired. Get a fresh estimate and review again.'); };
    try {
      guard();
      const state = await readWallet(rt, address, input, client);
      if (state.balance < snapshot.amount || state.tokenAllowance < snapshot.amount || state.routerAllowance < snapshot.amount || state.expiration <= Date.now() / 1000 + 600) throw new Error('Your balance or approval changed. Refresh and review the trade again.');
      const encoded = encodeSwap(rt.deployment.poolKey, snapshot, rt.deployment.network.uniswapV4.extendedSwapParams);
      await send(`${side === 'buy' ? 'Buy' : 'Sell'} DAEMON`, { address: rt.deployment.network.uniswapV4.universalRouter, abi: router,
        functionName: 'execute', args: [encoded.commands, encoded.inputs, BigInt(Math.floor(Date.now() / 1000) + 600)], value: encoded.value }, address, guard);
      setReview(undefined); setAmount(''); await wallet.refetch();
    } catch (e) { setError(errorMessage(e)); setReview(undefined); }
    finally { setActionPending(undefined); }
  };
  const onPrimary = async () => {
    setError('');
    if (!isConnected) { connect(); return; }
    if (wrongChain) {
      setActionPending('switch');
      try { await switchNetwork(await connector!.getProvider() as Provider, rt); } catch (e) { setError(errorMessage(e)); }
      finally { setActionPending(undefined); }
      return;
    }
    if (!tokenApproved) await approve('token');
    else if (!permitApproved) await approve('permit');
    else if (freshQuote) setReview(freshQuote);
  };
  const label = actionPending === 'switch' ? 'Switching…' : actionPending === 'token' ? 'Approving token…' : actionPending === 'permit' ? 'Approving router…' : busy ? 'Transaction pending…' : !isConnected ? 'Connect to trade' : wrongChain ? `Switch to ${rt.chain.name}` : !ready ? 'Waiting for live pool' : !amount ? 'Enter an amount' : validation ? 'Check the amount' : !balances ? 'Reading your balance…' : insufficient ? `Not enough ${inputSymbol}` : gasMissing ? 'ETH needed for network fees' : !freshQuote ? 'Waiting for estimate' : !tokenApproved ? `1. Approve ${inputSymbol}` : !permitApproved ? '2. Approve router' : `Review ${side}`;
  return <section className="trade-panel" id="trade" aria-labelledby="trade-title">
    <div className="section-heading"><h2 id="trade-title">Trade DAEMON</h2><span className="network-label"><span className="network-dot"/>Ethereum</span></div>
    <div className="trade-tabs" aria-label="Trade direction"><button aria-pressed={side === 'buy'} onClick={() => { setSide('buy'); setAmount(''); }} disabled={pending}>Buy DAEMON</button><button aria-pressed={side === 'sell'} onClick={() => { setSide('sell'); setAmount(''); }} disabled={pending}>Sell DAEMON</button></div>
    <div className="amount-field">
      <div className="field-heading"><label htmlFor="amount">You pay</label><button className="text-button" disabled={!balances || pending} onClick={() => setAmount(formatUnits(balances!.balance, inputDecimals))}>Max</button></div>
      <div className="amount-row"><input id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} disabled={pending} aria-invalid={Boolean(validation)} aria-describedby="amount-help"/><span className="token-name">{inputSymbol}</span></div>
      <p className="small muted balance">Balance: {balances ? `${units(balances.balance, inputDecimals)} ${inputSymbol}` : isConnected ? 'Unavailable' : 'Connect to view'}</p>
    </div>
    <div className="receive-row"><div><span className="small muted">You receive, estimated</span><p className="receive-amount">{quote.isFetching && !freshQuote ? 'Estimating…' : freshQuote ? units(freshQuote.output, outputDecimals) : '—'} <span>{outputSymbol}</span></p></div><span className="direction-mark" aria-hidden="true">↓</span></div>
    <div className="trade-settings"><label htmlFor="slippage">Slippage limit</label><div><input id="slippage" name="slippage" inputMode="decimal" value={slippage} onChange={e => setSlippage(e.target.value)} disabled={pending}/><span>%</span></div></div>
    <button className="primary wide trade-action" onClick={onPrimary} disabled={pending || (isConnected && !wrongChain && !canAct)}>{pending && <span className="spinner" aria-hidden="true"/>}{label}{!pending && <Icon name="arrow"/>}</button>
    <p id="amount-help" className="error" role="alert">{validation || (insufficient ? `Enter no more than your ${inputSymbol} balance.` : '') || error || (quote.isError && amount ? errorMessage(quote.error) : '') || (wallet.isError ? 'Balance unavailable. Retry the network read.' : '')}</p>
    {(quote.isError || wallet.isError) && <button className="text-button" onClick={() => { void quote.refetch(); void wallet.refetch(); }}>Retry estimate and balance</button>}
    <p className="trade-note small muted">Pay with {rt.pair.symbol} to buy. Keep ETH for network fees.</p>
    {isConnected && <ol className="approval-list" aria-label="Trade approval checklist">
      <li><span className={tokenApproved ? 'step done' : 'step'}>{tokenApproved ? <Icon name="check" size={14}/> : '1'}</span>Allow Permit2 to spend {inputSymbol}<span>{tokenApproved ? 'Ready' : 'Needed'}</span></li>
      <li><span className={permitApproved ? 'step done' : 'step'}>{permitApproved ? <Icon name="check" size={14}/> : '2'}</span>Allow router for one hour<span>{permitApproved ? 'Ready' : 'Needed'}</span></li>
      <li><span className="step">3</span>Review and confirm {side}</li>
    </ol>}
    <details className="trade-details"><summary>Trade details</summary>
      <dl><div><dt>Quote rate</dt><dd>{rate === undefined ? 'Unavailable' : `1 ${inputSymbol} ≈ ${new Intl.NumberFormat('en', { maximumSignificantDigits: 6 }).format(rate)} ${outputSymbol}`}</dd></div></dl>
      <dl><div><dt>Minimum received</dt><dd>{freshQuote ? units(freshQuote.minimum, outputDecimals) : 'Unavailable'} {outputSymbol}</dd></div><div><dt>Pool fee</dt><dd>{rt.deployment.poolKey.fee / 10000}%</dd></div><div><dt>Estimate refresh</dt><dd>Every 15 seconds</dd></div><div><dt>USD value</dt><dd>Unavailable</dd></div></dl>
      <p className="small muted">Approvals cover this amount only. The price can move by up to your slippage limit. The pool fee is included in the estimate.</p>
      <a href={`${rt.deployment.network.explorer}/address/${rt.deployment.network.uniswapV4.universalRouter}`} target="_blank" rel="noreferrer">View the router on Etherscan ↗</a>
    </details>
    <TransactionStatus rt={rt}/>
    <button className="text-button add-token" disabled={!address || wrongChain || !market || pending} onClick={async () => {
      setActionPending('watch'); setError(''); setWatchStatus('');
      try { const provider = await connector!.getProvider() as Provider; const added = await provider.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: rt.token.address, symbol: market!.symbol, decimals: market!.decimals, image: new URL('favicon.svg', document.baseURI).href } } }); if (!added) throw new Error('The token was not added. You can try again in your wallet.'); setWatchStatus('DAEMON was added in your wallet.'); }
      catch (e) { setError(errorMessage(e)); } finally { setActionPending(undefined); }
    }}>{actionPending === 'watch' ? 'Opening wallet…' : 'Add DAEMON to wallet'} <Icon name="wallet" size={16}/></button>
    <div className="small muted" role="status">{watchStatus}</div>
    <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title" onClick={e => { if (e.target === e.currentTarget && !pending) closeReview(); }}>
      <div className="sheet-content"><div className="section-heading"><h2 id="review-title">Review your {side}</h2><button className="icon-button" aria-label="Close trade review" onClick={closeReview} disabled={pending}><Icon name="close"/></button></div>
        {review && <><dl className="review-values"><div><dt>You pay</dt><dd>{formatUnits(review.amount, inputDecimals)} {inputSymbol}</dd></div><div><dt>You receive, estimated</dt><dd>{units(review.output, outputDecimals)} {outputSymbol}</dd></div><div><dt>At least</dt><dd>{formatUnits(review.minimum, outputDecimals)} {outputSymbol}</dd></div><div><dt>Slippage limit</dt><dd>{review.slippageBps / 100}%</dd></div><div><dt>Network fee</dt><dd>Shown in ETH by your wallet</dd></div></dl>
          <p className="small muted">The swap is simulated before your wallet opens. USD value is unavailable.</p>
          <button className="primary wide" disabled={pending || !canAct || now - review.created >= 30_000} onClick={execute}>{actionPending === 'swap' ? 'Confirming trade…' : `Confirm ${side}`}</button>
          {now - review.created >= 30_000 && <p className="error">Estimate expired. Close this review for a fresh estimate.</p>}
          {transaction && <p role="status">{transaction.message}</p>}
        </>}
      </div>
    </dialog>
  </section>;
}
