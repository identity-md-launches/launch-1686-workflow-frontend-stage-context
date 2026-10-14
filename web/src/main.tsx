import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { loadConfig } from './config';
import App from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
class RecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="config-error"><h1>Daemon</h1><h2>The shop window needs a refresh.</h2><p>Your wallet connection could not be restored. Reload to try again.</p><button className="primary" onClick={() => location.reload()}>Reload the page</button></main> : this.props.children; }
}
loadConfig().then(rt => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, refetchIntervalInBackground: false, staleTime: 5000 } } });
  root.render(<RecoveryBoundary><WagmiProvider config={rt.wagmi}><QueryClientProvider client={queryClient}><App rt={rt}/></QueryClientProvider></WagmiProvider></RecoveryBoundary>);
}).catch(error => {
  root.render(<main className="config-error"><h1>Daemon</h1><h2>The shop window couldn’t open.</h2><p role="alert">{error instanceof Error ? error.message : 'Deployment configuration unavailable.'}</p><button className="primary" onClick={() => location.reload()}>Reload the page</button></main>);
});
