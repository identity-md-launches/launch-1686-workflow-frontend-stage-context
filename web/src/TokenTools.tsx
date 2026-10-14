import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { getAddress, isAddress, type Address } from 'viem';
import type { Runtime, ReadClient } from './config';
import { errorMessage, parseAmount, units } from './market';
import { TransactionStatus, useTransaction } from './transactions';
import { useDialog, Icon } from './wallet';

export function TokenTools({ rt, client, ready, decimals, connect }: { rt: Runtime; client: ReadClient; ready: boolean; decimals: number; connect: () => void }) {
  const { address, chainId } = useAccount();
  const [mode, setMode] = useState<'transfer' | 'approve' | 'transferFrom'>('transfer');
  const [recipient, setRecipient] = useState('');
  const [owner, setOwner] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [pending, setPending] = useState(false);
  const { send, busy } = useTransaction();
  const close = () => setReview(false);
  const dialog = useDialog(review, close);
  const ownerAddress = mode === 'transferFrom' ? (isAddress(owner.trim()) ? getAddress(owner.trim()) : undefined) : address;
  const recipientAddress = isAddress(recipient.trim()) ? getAddress(recipient.trim()) : undefined;
  const state = useQuery({ queryKey: ['token-tools', mode, ownerAddress, recipientAddress, address], enabled: ready && !!ownerAddress && !!address && chainId === rt.chain.id,
    queryFn: async () => {
      const balance = await client.readContract({ address: rt.token.address, abi: rt.tokenAbi, functionName: 'balanceOf', args: [ownerAddress!] }) as bigint;
      const spender = mode === 'approve' ? recipientAddress : address;
      const allowance = spender ? await client.readContract({ address: rt.token.address, abi: rt.tokenAbi, functionName: 'allowance', args: [ownerAddress!, spender] }) as bigint : undefined;
      return { balance, allowance };
    }, refetchInterval: 15000, retry: false });
  useEffect(() => { setReview(false); setError(''); }, [mode, recipient, owner, amount, address, chainId]);
  const validate = () => {
    if (!recipientAddress || BigInt(recipientAddress) === 0n) throw new Error(`Enter a valid, nonzero ${mode === 'approve' ? 'spender' : 'recipient'} address. Mixed-case addresses must have a valid checksum.`);
    if (mode === 'transferFrom' && (!ownerAddress || BigInt(ownerAddress) === 0n)) throw new Error('Enter a valid, nonzero token holder address.');
    return mode === 'approve' && /^0(?:\.0+)?$/.test(amount.trim()) ? 0n : parseAmount(amount, decimals);
  };
  const title = mode === 'approve' ? 'Set token allowance' : mode === 'transferFrom' ? 'Transfer with allowance' : 'Send DAEMON';
  return <details className="tools" id="token-tools">
    <summary>Token controls <span className="small muted">Send, approve & delegated transfers</span></summary>
    <div className="tools-content">
      <p>These controls interact directly with the DAEMON token. Transfers cannot be reversed.</p>
      <label htmlFor="token-action">Action</label><select id="token-action" value={mode} onChange={e => setMode(e.target.value as typeof mode)} disabled={busy || pending}><option value="transfer">Send DAEMON</option><option value="approve">Set or revoke allowance</option><option value="transferFrom">Transfer with allowance</option></select>
      {mode === 'transferFrom' && <><label htmlFor="token-holder">Token holder address</label><input id="token-holder" value={owner} onChange={e => setOwner(e.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} disabled={busy || pending}/><p className="small muted">The holder must have approved your connected wallet.</p></>}
      <label htmlFor="token-recipient">{mode === 'approve' ? 'Spender address' : 'Recipient address'}</label><input id="token-recipient" value={recipient} onChange={e => setRecipient(e.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} disabled={busy || pending}/>
      <p className="small muted">Paste a full Ethereum address. ENS names are not resolved by this export.</p>
      <label htmlFor="token-amount">Amount in DAEMON{mode === 'approve' ? ' (0 revokes)' : ''}</label><input id="token-amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" disabled={busy || pending}/>
      <dl className="tool-state"><div><dt>Holder’s balance</dt><dd>{state.data && !state.isError ? `${units(state.data.balance, decimals)} DAEMON` : 'Unavailable'}</dd></div><div><dt>Current allowance</dt><dd>{state.data?.allowance !== undefined && !state.isError ? `${units(state.data.allowance, decimals)} DAEMON` : 'Unavailable'}</dd></div></dl>
      {mode === 'approve' && <p className="small muted">An allowance lets this spender move your tokens. This replaces the current allowance. Only approve a spender you trust.</p>}
      <button onClick={() => { if (!address) { connect(); return; } try { validate(); setError(''); setReview(true); } catch (e) { setError(errorMessage(e)); } }} disabled={Boolean(busy || pending || (address && (!ready || chainId !== rt.chain.id)))}>{!address ? 'Connect to use token controls' : pending ? 'Confirming…' : `Review ${mode === 'approve' ? 'allowance' : 'transfer'}`}</button>
      {address && chainId !== rt.chain.id && <p className="small">Switch to {rt.chain.name} using the wallet control.</p>}
      <p role="alert" className="error">{error || (state.isError ? 'Contract state unavailable. Try again when the network recovers.' : '')}</p>
      <TransactionStatus rt={rt} scope="token"/>
    </div>
    <dialog ref={dialog} className="review-dialog" aria-labelledby="token-review-title"><div className="sheet-content"><div className="section-heading"><h2 id="token-review-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close token action review" disabled={pending}><Icon name="close"/></button></div>
      <dl className="review-values"><div><dt>Amount</dt><dd>{amount} DAEMON</dd></div><div><dt>{mode === 'approve' ? 'Spender' : 'Recipient'}</dt><dd className="full-address">{recipientAddress}</dd></div>{mode === 'transferFrom' && <div><dt>Holder</dt><dd className="full-address">{ownerAddress}</dd></div>}</dl>
      <p className="small muted">Ethereum network fees apply. USD value is unavailable. Check every address before confirming.</p>
      <button className="primary wide" disabled={pending || busy || !ready || !address || chainId !== rt.chain.id} onClick={async () => {
        setPending(true); setError('');
        try {
          const value = validate();
          // Fresh reads and simulation happen for every write, including revoke and delegated transfer.
          await state.refetch({ throwOnError: true });
          const args = mode === 'transferFrom' ? [ownerAddress as Address, recipientAddress as Address, value] : [recipientAddress as Address, value];
          await send(title, { address: rt.token.address, abi: rt.tokenAbi, functionName: mode, args }, address!);
          setReview(false); setAmount(''); await state.refetch();
        } catch (e) { setError(errorMessage(e)); setReview(false); }
        finally { setPending(false); }
      }}>{pending ? 'Confirming…' : mode === 'approve' && Number(amount) === 0 ? 'Revoke allowance' : title}</button>
    </div></dialog>
  </details>;
}
