import { createContext, useContext, useState, type ReactNode } from 'react';
import { getConnection, getWalletClient } from 'wagmi/actions';
import type { Abi, Address, Hex } from 'viem';
import type { ReadClient, Runtime } from './config';
import { errorMessage } from './market';

type Request = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
export type Transaction = { action: string; status: 'signing' | 'confirming' | 'success' | 'error' | 'unconfirmed'; hash?: Hex; message: string };
const TransactionContext = createContext<{
  transaction?: Transaction; busy: boolean;
  send: (action: string, request: Request, account: Address, guard?: () => void) => Promise<void>;
  check: () => Promise<void>;
}>(null!);

export function TransactionProvider({ rt, client, children, onSuccess }: { rt: Runtime; client: ReadClient; children: ReactNode; onSuccess: () => void }) {
  const [transaction, setTransaction] = useState<Transaction>();
  // Also guard synchronously: React state does not prevent a second click in the same frame.
  const [lock] = useState(() => ({ busy: false }));
  const assertAccount = (account: Address) => {
    const current = getConnection(rt.wagmi);
    if (current.chainId !== rt.chain.id || current.address?.toLowerCase() !== account.toLowerCase()) throw new Error('Your wallet or network changed. Review the action again.');
  };
  const complete = (status: string, action: string, hash: Hex) => {
    if (status !== 'success') throw new Error('The transaction reverted on chain. No tokens were moved by this action; the network fee may still apply.');
    setTransaction({ action, hash, status: 'success', message: `${action} confirmed.` });
    onSuccess();
  };
  const send = async (action: string, request: Request, account: Address, guard?: () => void) => {
    if (lock.busy) throw new Error('Wait for the current transaction to finish.');
    lock.busy = true;
    let hash: Hex | undefined;
    let replacedByAnotherAction = false;
    setTransaction({ action, status: 'signing', message: `Checking ${action.toLowerCase()} before opening your wallet…` });
    try {
      assertAccount(account); guard?.();
      const simulation = await client.simulateContract({ ...request, account });
      assertAccount(account); guard?.();
      const wallet = await getWalletClient(rt.wagmi);
      // Query the provider too, including during delayed prompts or stale connector state.
      if (await wallet.getChainId() !== rt.chain.id || (await wallet.getAddresses())[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('Your wallet or network changed. Review the action again.');
      setTransaction({ action, status: 'signing', message: `Confirm ${action.toLowerCase()} in your wallet.` });
      hash = await wallet.writeContract({ ...simulation.request, chain: rt.chain, account });
      setTransaction({ action, hash, status: 'confirming', message: 'Submitted. Waiting for the network to confirm…' });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000, confirmations: 1, onReplaced: replacement => {
        hash = replacement.transaction.hash;
        setTransaction({ action, hash, status: 'confirming', message: 'Transaction replaced. Checking its confirmation…' });
        replacedByAnotherAction = replacement.reason !== 'repriced';
      } });
      if (replacedByAnotherAction) throw new Error('The transaction was cancelled or replaced by another action. Check its explorer record before trying again.');
      complete(receipt.status, action, hash);
    } catch (e) {
      const unconfirmed = Boolean(hash && /timeout|timed out|not found|network request|fetch|HTTP/i.test(String(e)));
      setTransaction({ action, hash, status: unconfirmed ? 'unconfirmed' : 'error', message: unconfirmed ? 'Confirmation is taking longer than expected. Check its status before trying again.' : errorMessage(e) });
      if (!unconfirmed) lock.busy = false;
      throw e;
    } finally {
      // An unknown onchain result stays locked until an explicit receipt check resolves it.
      if (!hash) lock.busy = false;
    }
    lock.busy = false;
  };
  const check = async () => {
    if (!transaction?.hash) return;
    try {
      const receipt = await client.getTransactionReceipt({ hash: transaction.hash });
      complete(receipt.status, transaction.action, transaction.hash);
      lock.busy = false;
    } catch (e) {
      if (/reverted on chain/i.test(String(e))) { setTransaction({ ...transaction, status: 'error', message: errorMessage(e) }); lock.busy = false; }
      else setTransaction({ ...transaction, message: 'No confirmed receipt yet. Check Etherscan or check again shortly.' });
    }
  };
  return <TransactionContext.Provider value={{ transaction, busy: lock.busy, send, check }}>{children}</TransactionContext.Provider>;
}
export const useTransaction = () => useContext(TransactionContext);
export function TransactionStatus({ rt, scope = 'trade' }: { rt: Runtime; scope?: 'trade' | 'token' }) {
  const { transaction, check } = useTransaction();
  const tokenAction = transaction && ['Send DAEMON', 'Set token allowance', 'Transfer with allowance'].includes(transaction.action);
  if (transaction && tokenAction !== (scope === 'token')) return null;
  return <div className="transaction-status" role="status" aria-live="polite">
    {transaction && <><p className={transaction.status === 'error' ? 'error' : ''}>{transaction.message}</p>
      {transaction.hash && <a href={`${rt.deployment.network.explorer}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">View transaction on Etherscan ↗</a>}
      {transaction.status === 'unconfirmed' && <button onClick={check}>Check confirmation</button>}
    </>}
  </div>;
}
