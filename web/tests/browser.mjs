import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseAbiParameters, parseAbi, keccak256, toHex, decodeAbiParameters, encodeErrorResult } from 'viem';

// All wallets, balances, swaps and receipts in this suite are fixtures. No live signing or broadcast.
const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, 'dist');
const evidence = resolve(root, 'docs/evidence');
await mkdir(evidence, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(dist, 'imd-deployment.json'), 'utf8'));
const token = manifest.contracts[0].address;
const pair = manifest.network.pairToken.address;
const v4 = manifest.network.uniswapV4;
const abi = JSON.parse(await readFile(resolve(dist, manifest.contracts[0].abiPath), 'utf8'));
const poolTuple = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const poolId = keccak256(encodeAbiParameters(parseAbiParameters(poolTuple), [manifest.poolKey]));
const protocol = parseAbi([
  `function quoteExactInputSingle((${poolTuple} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
  'function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
  'error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)',
]);
const permitAbi = parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const eventAbi = parseAbi(['event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)', 'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const account = '0x52908400098527886E0F7030069857D2E4169EE7'; // EIP-55 public example, no key.
const other = '0x5A384227B65FA093DEC03Ec34e111Db80A040615';
const start = BigInt(JSON.parse(await readFile(resolve(dist, 'history-start.json'), 'utf8')).blockNumber);
let head = start + 40n;
const hash = n => `0x${BigInt(n).toString(16).padStart(64, 'a')}`;
const fixture = {
  chain: '0xaa36a7', connected: false, unknownChain: true, rejected: true, rejectWrite: false,
  noCode: false, rpcFail: false, firstRpcFail: false, stale: false, revertSwap: false, quoteFail: false, holdReceipts: false,
  accounts: [account], approvals: new Map(), permits: new Map(), transactions: [], requests: [], calls: [], pendingPolls: 0,
};
const allowKey = (currency, spender) => `${currency.toLowerCase()}:${spender.toLowerCase()}`;
const allowance = (currency, spender) => fixture.approvals.get(allowKey(currency, spender)) ?? 0n;
const permit = currency => fixture.permits.get(currency.toLowerCase()) ?? [0n, 0, 0];
const getAbi = address => address.toLowerCase() === v4.permit2.toLowerCase() ? permitAbi : [token, pair].some(a => a.toLowerCase() === address.toLowerCase()) ? abi : protocol;
const latestTimestamp = () => Math.floor(Date.now() / 1000) - (fixture.stale ? 3600 : 0);
function block(number) {
  return { number: toHex(number), hash: hash(number), parentHash: hash(number - 1n), timestamp: toHex(latestTimestamp() - Number(head - number) * 12), nonce: '0x0000000000000000', difficulty: '0x0', totalDifficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x5208', miner: account, extraData: '0x', logsBloom: `0x${'00'.repeat(256)}`, mixHash: hash(2), receiptsRoot: hash(3), sha3Uncles: hash(4), size: '0x100', stateRoot: hash(5), transactionsRoot: hash(6), transactions: [], uncles: [], baseFeePerGas: '0x3b9aca00' };
}
function log(kind, number, sqrt, index) {
  const args = kind === 'Initialize' ? { id: poolId, currency0: manifest.poolKey.currency0, currency1: manifest.poolKey.currency1 } : { id: poolId, sender: account };
  const topics = encodeEventTopics({ abi: eventAbi, eventName: kind, args });
  const data = kind === 'Initialize' ? encodeAbiParameters(parseAbiParameters('uint24,int24,address,uint160,int24'), [manifest.poolKey.fee, manifest.poolKey.tickSpacing, manifest.poolKey.hooks, sqrt, 0]) : encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'), [-100n, 100n, sqrt, 10n ** 25n, 0, manifest.poolKey.fee]);
  return { address: v4.poolManager, blockNumber: toHex(number), blockHash: hash(number), transactionHash: hash(number + 2n), transactionIndex: '0x0', logIndex: toHex(index), removed: false, topics, data };
}
const logs = () => [log('Initialize', start, 2n ** 96n, 1), log('Swap', start + 10n, 2n ** 96n * 105n / 100n, 2), log('Swap', start + 25n, 2n ** 96n * 110n / 100n, 3)];
const rpcError = (message, code = -32000, data) => { throw { message, code, ...(data ? { data } : {}) }; };
async function rpc(method, params = []) {
  fixture.calls.push({ method, params });
  if (fixture.rpcFail) return rpcError('RPC unavailable');
  if (method === 'eth_chainId') return toHex(manifest.chainId);
  if (method === 'eth_blockNumber') return toHex(head);
  if (method === 'eth_getCode') return fixture.noCode ? '0x' : '0x60006000';
  if (method === 'eth_getBlockByNumber') return block(params[0] === 'latest' ? head : BigInt(params[0]));
  if (method === 'eth_getBalance') return toHex(2n * 10n ** 18n);
  if (method === 'eth_getLogs') {
    const filter = params[0];
    assert.equal(filter.address.toLowerCase(), v4.poolManager);
    assert.equal(filter.topics[1].toLowerCase(), poolId.toLowerCase());
    assert.ok(BigInt(filter.toBlock) - BigInt(filter.fromBlock) <= 1999n, 'RPC logs must be chunked');
    return logs().filter(l => l.topics[0] === filter.topics[0] && BigInt(l.blockNumber) >= BigInt(filter.fromBlock) && BigInt(l.blockNumber) <= BigInt(filter.toBlock));
  }
  if (method === 'eth_call') {
    const request = params[0];
    const address = request.to.toLowerCase();
    const selected = getAbi(address);
    const { functionName, args = [] } = decodeFunctionData({ abi: selected, data: request.data });
    let result;
    switch (functionName) {
      case 'name': result = 'Daemon'; break;
      case 'symbol': result = address === token ? 'DAEMON' : manifest.network.pairToken.symbol; break;
      case 'decimals': result = 18; break;
      case 'totalSupply': result = 10n ** 27n; break;
      case 'balanceOf': result = 123456789012345678901234567890n; break;
      case 'allowance': result = address === v4.permit2 ? permit(args[1]) : allowance(address, args[1]); break;
      case 'getSlot0': assert.equal(args[0], poolId); result = [2n ** 96n * 110n / 100n, 0, 0, 12500]; break;
      case 'getLiquidity': result = 10n ** 25n; break;
      case 'quoteExactInputSingle': {
        if (fixture.quoteFail) return rpcError('execution reverted: NotEnoughLiquidity');
        const q = args[0];
        assert.equal(address, v4.quoter); assert.equal(q.poolKey.hooks.toLowerCase(), manifest.poolKey.hooks);
        result = [q.zeroForOne ? q.exactAmount / 2n : q.exactAmount * 2n, 180000n]; break;
      }
      case 'execute':
        assert.equal(address, v4.universalRouter);
        if (fixture.revertSwap) return rpcError('execution reverted', 3, encodeErrorResult({ abi: protocol, errorName: 'V4TooLittleReceived', args: [100n, 50n] }));
        return '0x';
      case 'approve': if (address === v4.permit2) return '0x'; result = true; break;
      case 'transfer': case 'transferFrom': result = true; break;
      default: return rpcError(`Unexpected call ${functionName}`);
    }
    return encodeFunctionResult({ abi: selected, functionName, result });
  }
  if (method === 'eth_getTransactionReceipt') {
    const tx = fixture.transactions.find(t => t.hash === params[0]);
    if (!tx) return null;
    if (fixture.holdReceipts || fixture.pendingPolls-- > 0) return null;
    if (!tx.applied) {
      const decoded = decodeFunctionData({ abi: getAbi(tx.to), data: tx.data });
      if (decoded.functionName === 'approve') {
        if (tx.to.toLowerCase() === v4.permit2) fixture.permits.set(decoded.args[0].toLowerCase(), [decoded.args[2], decoded.args[3], 0]);
        else fixture.approvals.set(allowKey(tx.to, decoded.args[0]), decoded.args[1]);
      }
      tx.applied = true;
    }
    return { transactionHash: tx.hash, transactionIndex: '0x0', blockHash: hash(head), blockNumber: toHex(head), from: account, to: tx.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' };
  }
  if (method === 'eth_getTransactionByHash') { const tx = fixture.transactions.find(t => t.hash === params[0]); return tx ? { ...tx, blockNumber: toHex(head), blockHash: hash(head), transactionIndex: '0x0', nonce: '0x1', from: account, input: tx.data, value: tx.value ?? '0x0', gas: '0x493e0', gasPrice: '0x3b9aca00', type: '0x2', chainId: '0x1', r: hash(1), s: hash(2), v: '0x1' } : null; }
  if (method === 'eth_estimateGas') return '0x493e0';
  if (method === 'eth_gasPrice') return '0x3b9aca00';
  if (method === 'eth_getTransactionCount') return '0x0';
  return rpcError(`Unsupported mock RPC method: ${method}`);
}
async function walletRpc(method, params = []) {
  fixture.requests.push({ method, params });
  if (method === 'eth_requestAccounts') { if (fixture.rejected) return rpcError('User rejected the request', 4001); fixture.connected = true; return fixture.accounts; }
  if (method === 'eth_accounts') return fixture.connected ? fixture.accounts : [];
  if (method === 'eth_chainId') return fixture.chain;
  if (method === 'wallet_switchEthereumChain') {
    if (fixture.unknownChain) return rpcError('Unknown chain', 4902);
    fixture.chain = params[0].chainId; return null;
  }
  if (method === 'wallet_addEthereumChain') { assert.deepEqual(params, [manifest.walletAddChain]); fixture.unknownChain = false; return null; }
  if (method === 'wallet_watchAsset') { assert.equal(params.type, 'ERC20'); assert.equal(params.options.address, token); return true; }
  if (method === 'wallet_revokePermissions') { fixture.connected = false; return null; }
  if (method === 'eth_sendTransaction') {
    if (fixture.rejectWrite) return rpcError('User rejected transaction', 4001);
    const tx = { ...params[0], hash: hash(fixture.transactions.length + 100) };
    fixture.transactions.push(tx); return tx.hash;
  }
  return rpc(method, params);
}
const types = { '.html':'text/html', '.json':'application/json', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith('/ipfs/daemon/') || path.includes('..')) { res.writeHead(404); return res.end(); }
  const file = resolve(dist, path.slice('/ipfs/daemon/'.length) || 'index.html');
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(bytes); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/ipfs/daemon/`;
const results = [];
const browsers = [];
const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
async function makeContext(browser, mobile = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1', isMobile: true, hasTouch: true } : {}) });
  await context.route('https://**/*', async route => {
    const request = route.request();
    if (manifest.network.rpcUrls.some(u => request.url().startsWith(u))) {
      if (fixture.firstRpcFail && request.url().startsWith(manifest.network.rpcUrls[0])) return route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      const data = request.postDataJSON();
      const one = async q => { try { return { jsonrpc: '2.0', id: q.id, result: await rpc(q.method, q.params) }; } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: e.code ?? -32000, message: e.message ?? String(e), data: e.data } }; } };
      const body = Array.isArray(data) ? await Promise.all(data.map(one)) : await one(data);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.abort();
  });
  if (!mobile) {
    await context.exposeBinding('mockWalletRpc', async (_, method, params) => { try { return { result: await walletRpc(method, params) }; } catch (e) { return { error: { message: e.message, code: e.code } }; } });
    await context.addInitScript(() => {
      const listeners = new Map();
      const provider = {
        on(event, handler) { const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event, set); },
        removeListener(event, handler) { listeners.get(event)?.delete(handler); },
        emit(event, value) { for (const handler of listeners.get(event) ?? []) handler(value); },
        async request({ method, params }) {
          const response = await window.mockWalletRpc(method, params);
          if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
          if (method === 'wallet_switchEthereumChain') this.emit('chainChanged', params[0].chainId);
          return response.result;
        },
      };
      window.testWallet = provider; window.ethereum = provider;
      const announce = () => {
        for (const [uuid, name, rdns] of [['d58281ee-15e0-4450-bdc6-564323cece2d','Browser test wallet','org.example.test'], ['b915f25d-892e-492a-9f88-8f8e7a2188d2','Second test wallet','org.example.second']]) dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid, name, rdns, icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="blue"/></svg>' }, provider } }));
      };
      addEventListener('eip6963:requestProvider', announce); announce();
    });
  }
  return context;
}
let browser;
let activePage;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); browsers.push(browser);
  const context = await makeContext(browser);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  activePage = page;
  await page.clock.install();
  const errors = []; const missing = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER ERROR', e.stack); });
  page.on('response', r => { if (r.url().startsWith(url) && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(url);
  await page.getByText('Live pool ·', { exact: false }).waitFor();
  await check('static gateway subpath, runtime manifest, verified live-state fixtures and first-screen action', async () => {
    assert.equal(await page.title(), 'Daemon · The pawn shop cat');
    const box = await page.locator('.trade-action').boundingBox(); assert.ok(box.y + box.height <= 844);
    assert.equal(await page.getByRole('heading', { name: 'Grinning today.' }).count(), 1);
    assert.ok(await page.getByRole('button', { name: 'Max', exact: true }).isDisabled());
    assert.equal(errors.length, 0); assert.equal(missing.length, 0);
  });
  await check('320, 390, 768 and 1440 reflow, light and dark themes, local fonts, accessible default page', async () => {
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false, `Overflow at ${width}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: resolve(evidence, `mock-${width}-dark.png`), fullPage: width === 1440 });
    }
    assert.ok(await page.evaluate(() => document.fonts.check('700 28px Fraunces') && document.fonts.check('400 16px "DM Sans"')));
    let axe = await new AxeBuilder({ page }).analyze(); assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations.map(v => ({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
    await page.getByRole('button', { name: 'Use light theme' }).click();
    axe = await new AxeBuilder({ page }).analyze(); assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations.map(v => v.id)));
    await page.screenshot({ path: resolve(evidence, 'mock-1440-light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Use dark theme' }).click();
    await page.setViewportSize({width:390,height:844});
  });
  await check('EIP-6963 wallet names, keyboard dialog dismissal and focus return', async () => {
    await page.getByRole('button', {name:'Connect', exact:true}).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', {name:'Browser test wallet',exact:true}).count(),1);
    assert.equal(await page.getByRole('button', {name:'Second test wallet',exact:true}).count(),1);
    assert.equal(await page.getByRole('button', {name:'Browser wallet',exact:true}).count(),0);
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(()=>!!document.activeElement.closest('dialog')));
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Connect');
  });
  await check('wallet rejection is recoverable; missing chain adds exact handoff settings and switches again', async () => {
    await page.getByRole('button', {name:'Connect',exact:true}).click();
    await page.getByRole('button', {name:'Browser test wallet',exact:true}).click();
    await page.getByText('Request declined in your wallet. You can try again.',{exact:true}).waitFor();
    fixture.rejected = false;
    await page.getByRole('button', {name:'Browser test wallet',exact:true}).click();
    await page.getByRole('dialog').waitFor({ state:'hidden' });
    assert.equal(fixture.chain,'0x1');
    assert.deepEqual(fixture.requests.filter(r=>/wallet_(switchEthereumChain|addEthereumChain)/.test(r.method)).map(r=>r.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);
  });
  await check('amount, decimal precision and slippage validation; large values cannot overflow', async () => {
    await page.locator('#amount').fill('-1'); await page.getByText('Enter a positive amount using numbers and a decimal point.').waitFor();
    assert.ok(await page.locator('.trade-action').isDisabled());
    await page.locator('#amount').fill('9999999999999999999999999999999999999999999999999999999.1');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
    await page.locator('#amount').fill('1.0000000000000000001'); await page.getByText('Use at most 18 decimal places.').waitFor();
    await page.locator('#slippage').fill('10'); await page.getByText('Set slippage between 0.1% and 5%.').waitFor();
    await page.locator('#slippage').fill('3');
    await page.getByRole('button',{name:'Max',exact:true}).click(); assert.ok((await page.locator('#amount').inputValue()).length > 25);
    await page.locator('#amount').fill('10');
    await page.getByRole('button',{name:'1. Approve IMD',exact:true}).waitFor();
  });
  await check('approval rejection releases pending state; exact IMD approval and confirmed Permit2 steps', async () => {
    fixture.rejectWrite = true;
    await page.getByRole('button',{name:'1. Approve IMD',exact:true}).click();
    await page.locator('#amount-help').getByText('Request declined in your wallet. You can try again.').waitFor();
    assert.equal(fixture.transactions.length,0); fixture.rejectWrite = false;
    fixture.holdReceipts=true;
    await page.getByRole('button',{name:'1. Approve IMD',exact:true}).click();
    await page.getByText('Submitted. Waiting for the network to confirm…',{exact:true}).waitFor();
    assert.ok(await page.locator('.trade-action').isDisabled());assert.equal(fixture.transactions.length,1);
    fixture.holdReceipts=false;
    head += 1n;
    await page.clock.fastForward(16_000);
    await page.getByRole('button',{name:'2. Approve router',exact:true}).waitFor();
    assert.equal(fixture.transactions.length,1);
    const approval = decodeFunctionData({abi,data:fixture.transactions[0].data});
    assert.equal(fixture.transactions[0].to.toLowerCase(),pair); assert.equal(approval.args[0].toLowerCase(),v4.permit2); assert.equal(approval.args[1],10n**19n);
    await page.getByRole('button',{name:'2. Approve router',exact:true}).click();
    await page.getByRole('button',{name:'Review buy',exact:true}).waitFor();
    const permission = decodeFunctionData({abi:permitAbi,data:fixture.transactions[1].data});
    assert.equal(fixture.transactions[1].to.toLowerCase(),v4.permit2); assert.equal(permission.args[0].toLowerCase(),pair); assert.equal(permission.args[1].toLowerCase(),v4.universalRouter); assert.equal(permission.args[2],10n**19n);
    const walletTime=await page.evaluate(()=>Date.now()/1000);
    assert.ok(permission.args[3] > walletTime+3500 && permission.args[3] <= walletTime+3600);
  });
  await check('reverted simulation prevents the swap signature and explains slippage', async () => {
    fixture.revertSwap = true;
    await page.getByRole('button',{name:'Review buy',exact:true}).click();
    await page.getByRole('button',{name:'Confirm buy',exact:true}).click();
    await page.locator('#amount-help').getByText('The price moved beyond your slippage limit. Get a fresh estimate.').waitFor();
    assert.equal(fixture.transactions.length,2); fixture.revertSwap = false;
  });
  await check('expired review cannot be submitted; current estimates do not silently alter its minimum', async () => {
    await page.getByRole('button',{name:'Review buy',exact:true}).click();
    await page.clock.fastForward(31_000);
    await page.getByText('Estimate expired. Close this review for a fresh estimate.').waitFor();
    assert.ok(await page.getByRole('button',{name:'Confirm buy',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Close trade review',exact:true}).click();
    assert.equal(fixture.transactions.length,2);
    // Return to real-time passage while retaining the clock's offset for this page.
    await page.clock.resume();
  });
  await check('reviewed buy sends exact v4 command/actions, preserved hook, 3% minimum and no ETH value', async () => {
    await page.getByRole('button',{name:'Review buy',exact:true}).click();
    await page.screenshot({path:resolve(evidence,'mock-buy-review.png')});
    await page.getByRole('button',{name:'Confirm buy',exact:true}).click();
    await page.getByText('Buy DAEMON confirmed.',{exact:true}).waitFor();
    const tx = fixture.transactions.at(-1); assert.equal(tx.to.toLowerCase(),v4.universalRouter); assert.equal(BigInt(tx.value ?? 0),0n);
    const execute = decodeFunctionData({abi:protocol,data:tx.data}); assert.equal(execute.args[0],'0x10');
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),execute.args[1][0]); assert.equal(actions,'0x060c0f');
    const [swap] = decodeAbiParameters(parseAbiParameters(`(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`),params[0]);
    assert.equal(swap.zeroForOne,false); assert.equal(swap.poolKey.hooks.toLowerCase(),manifest.poolKey.hooks); assert.equal(swap.amountOutMinimum,194n*10n**17n);
  });
  await check('sell changes spend token, requires independent approvals, and settles DAEMON to IMD', async () => {
    await page.getByRole('button',{name:'Sell DAEMON',exact:true}).click(); await page.locator('#amount').fill('10');
    await page.getByRole('button',{name:'1. Approve DAEMON',exact:true}).click();
    await page.getByRole('button',{name:'2. Approve router',exact:true}).click();
    await page.getByRole('button',{name:'Review sell',exact:true}).click();
    await page.getByRole('button',{name:'Confirm sell',exact:true}).click();
    await page.getByText('Sell DAEMON confirmed.',{exact:true}).waitFor();
    const tx = fixture.transactions.at(-1); const execute = decodeFunctionData({abi:protocol,data:tx.data});
    const [,params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),execute.args[1][0]);
    const [swap] = decodeAbiParameters(parseAbiParameters(`(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`),params[0]);
    assert.equal(swap.zeroForOne,true); assert.equal(swap.amountOutMinimum,485n*10n**16n);
    assert.equal(decodeAbiParameters(parseAbiParameters('address,uint256'),params[1])[0].toLowerCase(),token);
    assert.equal(decodeAbiParameters(parseAbiParameters('address,uint256'),params[2])[0].toLowerCase(),pair);
  });
  await check('watchAsset requests deployed token metadata', async () => {
    await page.getByRole('button',{name:'Add DAEMON to wallet',exact:true}).click();
    assert.ok(fixture.requests.some(r=>r.method==='wallet_watchAsset'));
  });
  await check('all token writes: transfer, allowance/revoke and transferFrom are reviewed and simulated', async () => {
    await page.locator('#token-tools > summary').click();
    for (const mode of ['transfer','approve','transferFrom']) {
      await page.locator('#token-action').selectOption(mode);
      await page.locator('#token-recipient').fill(other); if (mode==='transferFrom') await page.locator('#token-holder').fill(other);
      await page.locator('#token-amount').fill(mode==='approve'?'0':'3');
      await page.getByRole('button',{name:mode==='approve'?'Review allowance':'Review transfer',exact:true}).click();
      const name = mode==='approve'?'Revoke allowance':mode==='transferFrom'?'Transfer with allowance':'Send DAEMON';
      await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
      const tx = fixture.transactions.at(-1); const decoded = decodeFunctionData({abi,data:tx.data}); assert.equal(decoded.functionName,mode);
      assert.equal(decoded.args.at(-1),mode==='approve'?0n:3n*10n**18n);
      assert.ok(fixture.calls.some(r=>r.method==='eth_call' && r.params[0].data===tx.data));
    }
  });
  await check('wrong-network change visibly gates trades and preserves one switch action in the flow', async () => {
    fixture.chain='0xaa36a7'; await page.evaluate(()=>window.testWallet.emit('chainChanged','0xaa36a7'));
    await page.locator('.trade-action').getByText('Switch to Ethereum',{exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Add DAEMON to wallet',exact:true}).isDisabled());
    await page.locator('.trade-action').click(); assert.equal(fixture.chain,'0x1');
  });
  await check('reduced motion disables cross-fades and animations', async () => {
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.coin-layer').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
  });
  await check('account changes dismiss an existing review and clear account-scoped balance state', async () => {
    await page.getByRole('button',{name:'Buy DAEMON',exact:true}).click();await page.locator('#amount').fill('1');
    await page.getByRole('button',{name:'Review buy',exact:true}).click();
    fixture.accounts=[other]; await page.evaluate(address=>window.testWallet.emit('accountsChanged',[address]),other);
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.ok(await page.locator('.wallet-control').textContent().then(t=>t.includes('0x5A38')));
    fixture.accounts=[account]; await page.evaluate(address=>window.testWallet.emit('accountsChanged',[address]),account);
  });
  await check('configured public RPC fallback recovers; missing code disables transactions', async () => {
    fixture.firstRpcFail=true;
    await page.reload(); await page.getByText('Live pool ·',{exact:false}).waitFor({timeout:45000}); fixture.firstRpcFail=false;
    fixture.noCode=true;
    await page.reload(); await page.getByText('A configured contract has no code.',{exact:false}).waitFor();
    assert.ok(await page.locator('.trade-action').isDisabled()); fixture.noCode=false;
  });
  await check('mobile picker provides four open-in links and Coinbase Smart Wallet with no relay', async () => {
    const mobile = await makeContext(browser,true); const p = await mobile.newPage(); await p.goto(url);
    await p.getByRole('button',{name:'Connect',exact:true}).click();
    for (const name of ['MetaMask','Coinbase Wallet','Rabby','Phantom']) assert.equal(await p.getByRole('link',{name:`Open in ${name}`,exact:true}).count(),1);
    assert.equal(await p.getByRole('button',{name:'Coinbase Smart Wallet',exact:true}).count(),1);
    assert.equal(await p.getByText('WalletConnect',{exact:true}).count(),0);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const axe=await new AxeBuilder({page:p}).analyze();assert.equal(axe.violations.length,0,JSON.stringify(axe.violations.map(v=>v.id)));
    await p.screenshot({path:resolve(evidence,'mock-mobile-wallets.png')}); await mobile.close();
  });
  await check('tampered implementation ABI fails closed before any wallet action', async () => {
    const ctx=await browser.newContext();const p=await ctx.newPage();
    await p.route('**/abi/LaunchToken.json',route=>route.fulfill({contentType:'application/json',body:'[]'}));
    await p.goto(url); await p.getByText('ABI verification failed for LaunchToken.').waitFor(); assert.equal(await p.getByRole('button',{name:'Connect',exact:true}).count(),0);await ctx.close();
  });
  assert.equal(errors.length,0,errors.join('\n')); assert.equal(missing.length,0,missing.join('\n'));
  await context.close();
  if (!process.env.SKIP_WEBKIT) {
    const wk=await webkit.launch({headless:true});browsers.push(wk); const ctx=await makeContext(wk,true);const p=await ctx.newPage();
    await check('WebKit mobile render, quote, direction change and wallet sheet',async()=>{
      await p.goto(url);await p.getByText('Live pool ·',{exact:false}).waitFor();
      await p.locator('#amount').fill('10');await p.getByText('20 DAEMON',{exact:false}).waitFor();
      await p.getByRole('button',{name:'Sell DAEMON',exact:true}).click();await p.locator('#amount').fill('10');
      await p.getByRole('button',{name:'Connect to trade',exact:true}).click();await p.getByRole('button',{name:'Coinbase Smart Wallet',exact:true}).waitFor();
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:resolve(evidence,'webkit-mobile-wallets.png')});
    });await ctx.close();
  }
  await writeFile(resolve(evidence,'interaction-results.json'),JSON.stringify({date:new Date().toISOString(),mode:'Mock wallets and RPC; no broadcasts',exportPath:'/ipfs/daemon/',checks:results,transactionsSimulated:fixture.transactions.length,rpcCalls:fixture.calls.length,limitations:process.env.SKIP_WEBKIT?['WebKit skipped by environment']:[]},null,2)+'\n');
  console.log(`Passed ${results.length} browser checks; ${fixture.transactions.length} mocked writes.`);
} catch (error) {
  await activePage?.screenshot({path:resolve(evidence,'interaction-failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(resolve(evidence,'interaction-failure.json'),JSON.stringify({date:new Date().toISOString(),completed:results,error:String(error),page:await activePage?.locator('body').innerText().catch(()=>''),recentCalls:fixture.calls.slice(-12)},null,2));
  throw error;
} finally {
  for (const b of browsers) await b.close();
  await new Promise(resolve=>server.close(resolve));
}
