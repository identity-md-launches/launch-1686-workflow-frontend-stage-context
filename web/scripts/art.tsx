import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { Cat } from '../src/Cat';

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
const cat = renderToStaticMarkup(<Cat mood="Smug" />);
await writeFile(new URL('../public/favicon.svg', import.meta.url), cat);
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#101E19"/><rect x="22" y="22" width="1156" height="586" rx="20" fill="none" stroke="#D7A93A" stroke-width="2"/><g transform="translate(56 64) scale(1.25)">${cat}</g><text x="610" y="263" fill="#F4EBD7" font-family="Georgia,serif" font-weight="bold" font-size="90">Daemon</text><text x="616" y="330" fill="#D7A93A" font-family="sans-serif" font-size="30">The pawn shop cat.</text><text x="616" y="390" fill="#B8C6BA" font-family="sans-serif" font-size="24">One coin. Five moods.</text><text x="616" y="455" fill="#B8C6BA" font-family="sans-serif" font-size="24">DAEMON / IMD · Ethereum</text></svg>`;
await sharp(Buffer.from(card)).png().toFile(new URL('../public/share.png', import.meta.url).pathname);
console.log('Generated original SVG favicon and 1200 × 630 PNG share image.');
