import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProjectWatcher } from '../src/mcp-server/lib/watcher.js';
import {
  handleWatchProject,
  _stopAllWatchers,
  _activeWatcherCount,
  getWatcherHealth
} from '../src/mcp-server/tools/watch-project.js';
import { readSymbols } from '../src/mcp-server/lib/indexer.js';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-watch-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.afterEach(() => {
  _stopAllWatchers();
});

test('createProjectWatcher fires onChange when a code file changes', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function foo(){}\n');

  let fired = 0;
  const changed = [];
  const watcher = createProjectWatcher(dir, (files) => { fired++; changed.push(...files); }, { debounceMs: 50 });
  assert.ok(watcher.watchedDirs >= 1);

  await sleep(100);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export function bar(){}\n');

  // Poll for the debounced callback (fs.watch timing varies by platform).
  for (let i = 0; i < 40 && fired === 0; i++) await sleep(50);
  watcher.close();

  assert.ok(fired > 0, 'onChange should fire after a file write');
});

test('createProjectWatcher re-watches a deleted and recreated directory', async () => {
  const dir = tmpProject();
  const sourceDir = path.join(dir, 'src');
  fs.mkdirSync(sourceDir);

  let fired = 0;
  const watcher = createProjectWatcher(dir, () => { fired++; }, { debounceMs: 50 });

  await sleep(100);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  await sleep(100);
  fs.mkdirSync(sourceDir);
  await sleep(100);
  fs.writeFileSync(path.join(sourceDir, 'new.js'), 'export function recreated(){}\n');

  for (let i = 0; i < 40 && fired === 0; i++) await sleep(50);
  watcher.close();

  assert.ok(fired > 0, 'changes inside a recreated directory should be detected');
});

test('watch_project tool establishes a baseline and stops cleanly', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');

  const start = await handleWatchProject({ project_path: dir, debounce_ms: 50 });
  assert.match(start.content[0].text, /Watching/);
  assert.equal(_activeWatcherCount(), 1);

  // Baseline registry written immediately.
  const reg = readSymbols(path.join(dir, '.wisdom'));
  assert.ok(reg.functions.alpha, 'baseline scan should record existing symbols');

  // Starting again is idempotent.
  const again = await handleWatchProject({ project_path: dir });
  assert.match(again.content[0].text, /Already watching/);
  assert.equal(_activeWatcherCount(), 1);

  const stop = await handleWatchProject({ project_path: dir, enable: false });
  assert.match(stop.content[0].text, /Stopped watching/);
  assert.equal(_activeWatcherCount(), 0);

  _stopAllWatchers();
});

test('watch_project reports a degraded registry when a scan limit is reached', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'export function beta(){}\n');

  const start = await handleWatchProject({ project_path: dir, max_files: 1 });
  const health = getWatcherHealth(dir);
  const status = await handleWatchProject({ project_path: dir });

  assert.match(start.content[0].text, /WARNING: registry incomplete/);
  assert.match(status.content[0].text, /WARNING: registry incomplete/);
  assert.match(health.lastWarning, /file limit reached \(1\)/);
  assert.equal(health.scanOptions.maxFiles, 1);

  await handleWatchProject({ project_path: dir, enable: false });
});

test('watch_project cleans up when its initial baseline fails', async () => {
  const dir = tmpProject();
  const wisdomDir = path.join(dir, '.wisdom');
  fs.mkdirSync(wisdomDir);
  fs.mkdirSync(path.join(wisdomDir, 'symbols.json'));

  await assert.rejects(
    handleWatchProject({ project_path: dir, debounce_ms: 50 }),
    /rename|symbols\.json|operation not permitted|directory/i
  );
  assert.equal(_activeWatcherCount(), 0);
});

test('watch_project auto-updates the registry on a new file', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');

  await handleWatchProject({ project_path: dir, debounce_ms: 50 });

  fs.writeFileSync(path.join(dir, 'b.js'), 'export function beta(){}\n');

  let found = false;
  for (let i = 0; i < 60; i++) {
    const reg = readSymbols(path.join(dir, '.wisdom'));
    if (reg?.functions?.beta) { found = true; break; }
    await sleep(50);
  }
  await handleWatchProject({ project_path: dir, enable: false });
  _stopAllWatchers();

  assert.ok(found, 'a newly created file should appear in the registry without a manual refresh');
});

test('watch_project reports failed incremental rescans instead of counting success', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');
  await handleWatchProject({ project_path: dir, debounce_ms: 50 });

  const symbolsPath = path.join(dir, '.wisdom', 'symbols.json');
  fs.rmSync(symbolsPath);
  fs.mkdirSync(symbolsPath);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export function beta(){}\n');

  let status = '';
  for (let i = 0; i < 60; i++) {
    const response = await handleWatchProject({ project_path: dir });
    status = response.content[0].text;
    if (/\d+ failed/.test(status)) break;
    await sleep(50);
  }

  await handleWatchProject({ project_path: dir, enable: false });
  _stopAllWatchers();

  assert.match(status, /0 successful rescans/);
  assert.match(status, /[1-9]\d* failed/);
  assert.match(status, /last error:/);
});

test('watch_project auto-heals one transient incremental rescan failure', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');
  await handleWatchProject({ project_path: dir, debounce_ms: 50 });

  const symbolsPath = path.join(dir, '.wisdom', 'symbols.json');
  fs.rmSync(symbolsPath);
  fs.mkdirSync(symbolsPath);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export function beta(){}\n');

  for (let i = 0; i < 60 && !getWatcherHealth(dir)?.recoveryPending; i++) await sleep(50);
  assert.equal(getWatcherHealth(dir)?.recoveryPending, true);

  fs.rmSync(symbolsPath, { recursive: true, force: true });

  let recovered = false;
  for (let i = 0; i < 80; i++) {
    const health = getWatcherHealth(dir);
    const registry = readSymbols(path.join(dir, '.wisdom'));
    if (health?.recoveries === 1 && !health.lastError && registry?.functions?.beta) {
      recovered = true;
      break;
    }
    await sleep(50);
  }

  const status = (await handleWatchProject({ project_path: dir })).content[0].text;
  await handleWatchProject({ project_path: dir, enable: false });
  _stopAllWatchers();

  assert.ok(recovered, 'a transient write failure should recover on the bounded retry');
  assert.match(status, /1 auto-healed/);
  assert.doesNotMatch(status, /auto-heal pending/);
});

test('stopping watch_project cancels a pending auto-heal retry', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export function alpha(){}\n');
  await handleWatchProject({ project_path: dir, debounce_ms: 50 });

  const symbolsPath = path.join(dir, '.wisdom', 'symbols.json');
  fs.rmSync(symbolsPath);
  fs.mkdirSync(symbolsPath);
  fs.writeFileSync(path.join(dir, 'b.js'), 'export function beta(){}\n');

  for (let i = 0; i < 60 && !getWatcherHealth(dir)?.recoveryPending; i++) await sleep(50);
  assert.equal(getWatcherHealth(dir)?.recoveryPending, true);

  await handleWatchProject({ project_path: dir, enable: false });
  fs.rmSync(symbolsPath, { recursive: true, force: true });
  await sleep(1200);

  assert.equal(_activeWatcherCount(), 0);
  assert.equal(fs.existsSync(symbolsPath), false, 'stopped watcher must not run its pending retry');
  _stopAllWatchers();
});
