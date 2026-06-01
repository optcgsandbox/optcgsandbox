#!/usr/bin/env node
// F14: cards whose effectText has [DON!! x N] should gate effects via
// `if_attached_don_min` (attached to THIS card) not `if_don_min` (cost area).
// This script rewrites the type recursively for any spec on cards with
// matching text.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'data', 'cards.json');
const cards = JSON.parse(readFileSync(dataPath, 'utf8'));

function rewriteConditions(node) {
  if (Array.isArray(node)) {
    node.forEach(rewriteConditions);
    return;
  }
  if (node && typeof node === 'object') {
    if (node.type === 'if_don_min') {
      node.type = 'if_attached_don_min';
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      rewriteConditions(node[k]);
    }
  }
}

let fixed = 0;
for (const c of cards) {
  const spec = c.effectSpecV2;
  if (!spec) continue;
  const text = c.effectText || '';
  if (!/\[DON!! x\d+\]/.test(text)) continue;
  const before = JSON.stringify(spec);
  rewriteConditions(spec);
  const after = JSON.stringify(spec);
  if (before !== after) {
    fixed++;
  }
}

writeFileSync(dataPath, JSON.stringify(cards, null, 2));
console.log(`Cards fixed (if_don_min → if_attached_don_min for [DON!! x N] gates): ${fixed}`);
