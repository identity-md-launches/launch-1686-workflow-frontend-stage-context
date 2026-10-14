import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { keccak256, toBytes } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'dist');
const read = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));
const handoff = await read('web/deployment/handoff.json');
const network = await read('web/deployment/network.json');
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const abiHash = (abi) => keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, text) => { if (!ok) throw new Error(text); };
for (const [name, value] of [['deployment', handoff], ['network', network]]) {
  try {
    const pinned = await read(`.imd/reads/${name}.json`);
    assert(JSON.stringify(canonical(pinned)) === JSON.stringify(canonical(value)), `${name} differs from pinned input`);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
assert(handoff.chainId === network.network.chainId, 'Network chain mismatch');
const contracts = [];
for (const contract of handoff.contracts) {
  const sourcePath = `docs/abi/${contract.name}.json`;
  let raw;
  try { raw = execFileSync('git', ['show', `${handoff.sourceCommit}:${sourcePath}`], { cwd: root }); }
  catch { throw new Error(`Pinned ABI is unavailable: ${handoff.sourceCommit}:${sourcePath}`); }
  const abi = JSON.parse(raw);
  assert(Array.isArray(abi) && abiHash(abi) === contract.abiHash, `ABI hash mismatch: ${contract.name}`);
  assert(abiHash(await read(sourcePath)) === contract.abiHash, `Working ABI differs: ${sourcePath}`);
  const abiPath = `abi/${contract.name}.json`;
  contracts.push({ name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath });
  if (!process.argv.includes('--check')) {
    await mkdir(resolve(out, 'abi'), { recursive: true });
    await writeFile(resolve(out, abiPath), raw);
  }
}
const expected = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, poolKey: handoff.poolKey, network: network.network, walletAddChain: network.walletAddChain,
};
const historyStart = { blockNumber: Math.min(...handoff.contracts.map(c => c.blockNumber)) };
assert(Number.isSafeInteger(historyStart.blockNumber) && historyStart.blockNumber > 0, 'Missing history start block');
if (!process.argv.includes('--check')) await writeFile(resolve(out, 'history-start.json'), JSON.stringify(historyStart) + '\n');
async function walk(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Symlinks not allowed in export');
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await walk(target));
    else if (entry.name !== 'imd-deployment.json') result.push(target);
  }
  return result;
}
const files = (await walk(out)).sort();
assert(files.length <= 128, 'More than 128 export assets');
let total = 0;
const assets = await Promise.all(files.map(async file => {
  const size = (await stat(file)).size; total += size;
  assert(size <= 8388608, `Asset too large: ${file}`);
  return { path: relative(out, file).split('\\').join('/'), sha256: sha(await readFile(file)) };
}));
assert(total < 8 * 1024 * 1024, 'Export alone exceeds submission budget');
if (process.argv.includes('--check')) {
  const manifest = await read('dist/imd-deployment.json');
  const { assets: listed, ...config } = manifest;
  assert(JSON.stringify(canonical(config)) === JSON.stringify(canonical(expected)), 'Manifest schema or deployment mismatch');
  assert(JSON.stringify(listed) === JSON.stringify(assets), 'Asset inventory/hash mismatch');
  assert(JSON.stringify(await read('dist/history-start.json')) === JSON.stringify(historyStart), 'History start differs');
  for (const c of contracts) assert(abiHash(await read(`dist/${c.abiPath}`)) === c.abiHash, `Export ABI hash mismatch: ${c.name}`);
} else await writeFile(resolve(out, 'imd-deployment.json'), JSON.stringify({ ...expected, assets }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', mode: process.argv.includes('--check') ? 'verify' : 'export', assets: files.length, bytes: total, sourceCommit: handoff.sourceCommit, abiHashes: contracts.map(c => c.abiHash) }, null, 2));
