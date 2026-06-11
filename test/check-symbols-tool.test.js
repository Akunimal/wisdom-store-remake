import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { handleCheckSymbols } from '../src/mcp-server/tools/check-symbols.js';
import { writeSymbols } from '../src/mcp-server/lib/indexer.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-checktool-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.mkdirSync(path.join(root, '.wisdom'));
  return root;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('check_symbols tool error and staleness handling', () => {
  it('reports a corrupt registry distinctly from a missing one', async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, '.wisdom', 'symbols.json'), '{ not valid json');

    const res = await handleCheckSymbols({ project_path: root, symbols: ['foo'] });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /corrupt/i);
  });

  it('reports missing registry with the reindex hint', async () => {
    const root = makeProject();
    const res = await handleCheckSymbols({ project_path: root, symbols: ['foo'] });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No symbol registry found/);
  });

  it('warns about a stale registry when unknowns are present', async () => {
    const root = makeProject();
    writeSymbols(path.join(root, '.wisdom'), {
      _meta: { scanned: isoDaysAgo(30) },
      functions: { knownFn: { file: 'a.js', line: 1, usages: 1 } },
      classes: {}, variables: {}, exports: {}, apiRoutes: {}, htmlPages: {}
    });

    const res = await handleCheckSymbols({ project_path: root, symbols: ['totallyNewSymbol'] });
    assert.match(res.content[0].text, /last scanned/i);
  });

  it('does not warn about staleness for a fresh registry', async () => {
    const root = makeProject();
    writeSymbols(path.join(root, '.wisdom'), {
      _meta: { scanned: isoDaysAgo(1) },
      functions: { knownFn: { file: 'a.js', line: 1, usages: 1 } },
      classes: {}, variables: {}, exports: {}, apiRoutes: {}, htmlPages: {}
    });

    const res = await handleCheckSymbols({ project_path: root, symbols: ['anotherNewSymbol'] });
    assert.doesNotMatch(res.content[0].text, /last scanned/i);
  });
});
