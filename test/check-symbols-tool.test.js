import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { handleCheckSymbols } from '../src/mcp-server/tools/check-symbols.js';
import { handleReindexProject } from '../src/mcp-server/tools/reindex-project.js';
import { writeSymbols } from '../src/mcp-server/lib/indexer.js';
import { handleWatchProject, _stopAllWatchers, getWatcherHealth } from '../src/mcp-server/tools/watch-project.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-checktool-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.mkdirSync(path.join(root, '.wisdom'));
  return root;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

afterEach(() => {
  _stopAllWatchers();
});

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

  it('warns when the active project watcher is unhealthy', async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, 'a.js'), 'export function alpha(){}\n');
    await handleWatchProject({ project_path: root, debounce_ms: 50 });

    const indexPath = path.join(root, '.wisdom', 'index.json');
    fs.rmSync(indexPath);
    fs.mkdirSync(indexPath);
    fs.writeFileSync(path.join(root, 'b.js'), 'export function beta(){}\n');

    for (let i = 0; i < 60 && !getWatcherHealth(root)?.recoveryPending; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const res = await handleCheckSymbols({ project_path: root, symbols: ['alpha'] });
    assert.match(res.content[0].text, /watcher is unhealthy/i);
    assert.match(res.content[0].text, /auto-heal retry pending/i);

    await handleWatchProject({ project_path: root, enable: false });
    _stopAllWatchers();
  });

  it('warns when unknowns come from an incomplete registry', async () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, 'a.js'), 'export function alpha(){}\n');
    fs.writeFileSync(path.join(root, 'b.js'), 'export function beta(){}\n');
    await handleReindexProject({ project_path: root, max_files: 1 });

    const res = await handleCheckSymbols({ project_path: root, symbols: ['beta'] });
    assert.match(res.content[0].text, /Registry is incomplete/);
    assert.match(res.content[0].text, /Unknown symbols may be false positives/);
  });
});
