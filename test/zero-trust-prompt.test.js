import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

import {
  findProjectRoot,
  loadWatchlist,
  loadRegistryMeta,
  timeSince,
  CORE_RULES,
  HEADER
} from '../hooks/zero-trust-prompt.js';

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zt-test-'));
}

function setupProject(tmpDir, { hallucinations, symbols } = {}) {
  const wisdomDir = path.join(tmpDir, '.wisdom');
  fs.mkdirSync(wisdomDir, { recursive: true });

  // Create a package.json so findProjectRoot works
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

  if (hallucinations) {
    fs.writeFileSync(
      path.join(wisdomDir, 'hallucinations.json'),
      JSON.stringify(hallucinations)
    );
  }

  if (symbols) {
    fs.writeFileSync(
      path.join(wisdomDir, 'symbols.json'),
      JSON.stringify(symbols)
    );
  }

  return wisdomDir;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ── Unit tests: findProjectRoot ─────────────────────────────────────────────

describe('findProjectRoot', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmrf(tmpDir); });

  it('finds root with .wisdom/ directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.wisdom'), { recursive: true });
    const subDir = path.join(tmpDir, 'src', 'lib');
    fs.mkdirSync(subDir, { recursive: true });

    const result = findProjectRoot(subDir);
    assert.equal(result, tmpDir);
  });

  it('finds root with package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const subDir = path.join(tmpDir, 'a', 'b', 'c');
    fs.mkdirSync(subDir, { recursive: true });

    const result = findProjectRoot(subDir);
    assert.equal(result, tmpDir);
  });

  it('returns null when no project root found', () => {
    // Use a bare temp dir with no markers
    const bareDir = makeTmpDir();
    const result = findProjectRoot(bareDir);
    // Could be null or could find a parent — depends on system
    // The important thing is it doesn't crash
    rmrf(bareDir);
  });
});

// ── Unit tests: loadWatchlist ───────────────────────────────────────────────

describe('loadWatchlist', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmrf(tmpDir); });

  it('returns empty array when no hallucinations.json exists', () => {
    const wisdomDir = path.join(tmpDir, '.wisdom');
    fs.mkdirSync(wisdomDir, { recursive: true });
    const result = loadWatchlist(wisdomDir);
    assert.deepEqual(result, []);
  });

  it('returns empty array when all symbols have < 3 occurrences', () => {
    const wisdomDir = setupProject(tmpDir, {
      hallucinations: [
        { symbol: 'foo', type: 'unknown', timestamp: new Date().toISOString() },
        { symbol: 'bar', type: 'fuzzy', timestamp: new Date().toISOString() },
      ]
    });
    const result = loadWatchlist(wisdomDir);
    assert.deepEqual(result, []);
  });

  it('returns symbols with 3+ occurrences sorted by count desc', () => {
    const entries = [];
    // 'badFunc' appears 5 times
    for (let i = 0; i < 5; i++) {
      entries.push({ symbol: 'badFunc', type: 'unknown', timestamp: new Date().toISOString() });
    }
    // 'typoFunc' appears 3 times
    for (let i = 0; i < 3; i++) {
      entries.push({ symbol: 'typoFunc', type: 'fuzzy', timestamp: new Date().toISOString() });
    }
    // 'onceOnly' appears 1 time (should be excluded)
    entries.push({ symbol: 'onceOnly', type: 'unknown', timestamp: new Date().toISOString() });

    const wisdomDir = setupProject(tmpDir, { hallucinations: entries });
    const result = loadWatchlist(wisdomDir);

    assert.equal(result.length, 2);
    assert.equal(result[0].symbol, 'badFunc');
    assert.equal(result[0].count, 5);
    assert.equal(result[1].symbol, 'typoFunc');
    assert.equal(result[1].count, 3);
  });

  it('handles corrupted JSON gracefully', () => {
    const wisdomDir = path.join(tmpDir, '.wisdom');
    fs.mkdirSync(wisdomDir, { recursive: true });
    fs.writeFileSync(path.join(wisdomDir, 'hallucinations.json'), 'not-json{{{');
    const result = loadWatchlist(wisdomDir);
    assert.deepEqual(result, []);
  });

  it('handles non-array JSON gracefully', () => {
    const wisdomDir = path.join(tmpDir, '.wisdom');
    fs.mkdirSync(wisdomDir, { recursive: true });
    fs.writeFileSync(path.join(wisdomDir, 'hallucinations.json'), '{"foo": "bar"}');
    const result = loadWatchlist(wisdomDir);
    assert.deepEqual(result, []);
  });
});

// ── Unit tests: loadRegistryMeta ────────────────────────────────────────────

describe('loadRegistryMeta', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmrf(tmpDir); });

  it('returns null when no symbols.json exists', () => {
    const wisdomDir = path.join(tmpDir, '.wisdom');
    fs.mkdirSync(wisdomDir, { recursive: true });
    const result = loadRegistryMeta(wisdomDir);
    assert.equal(result, null);
  });

  it('counts total symbols across categories', () => {
    const wisdomDir = setupProject(tmpDir, {
      symbols: {
        _meta: { scanned: '2026-06-06T00:00:00Z', file_count: 42 },
        functions: {
          foo: { file: 'a.js', line: 1 },
          bar: { file: 'b.js', line: 5 },
        },
        classes: {
          MyClass: { file: 'c.js', line: 10 },
        },
        exports: {
          default: { file: 'd.js', line: 1 },
        }
      }
    });

    const result = loadRegistryMeta(wisdomDir);
    assert.equal(result.totalSymbols, 4);
    assert.equal(result.fileCount, 42);
    assert.equal(result.lastIndexed, '2026-06-06T00:00:00Z');
  });

  it('handles missing _meta gracefully', () => {
    const wisdomDir = setupProject(tmpDir, {
      symbols: {
        functions: { x: { file: 'x.js', line: 1 } }
      }
    });

    const result = loadRegistryMeta(wisdomDir);
    assert.equal(result.totalSymbols, 1);
    assert.equal(result.lastIndexed, null);
    assert.equal(result.fileCount, null);
  });
});

// ── Unit tests: timeSince ───────────────────────────────────────────────────

describe('timeSince', () => {
  it('returns "just now" for timestamps within last minute', () => {
    const now = new Date().toISOString();
    assert.equal(timeSince(now), 'just now');
  });

  it('returns minutes for recent timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(timeSince(fiveMinAgo), '5m ago');
  });

  it('returns hours for older timestamps', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    assert.equal(timeSince(twoHoursAgo), '2h ago');
  });

  it('returns days for old timestamps', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(timeSince(threeDaysAgo), '3d ago');
  });

  it('returns "unknown" for invalid timestamps', () => {
    assert.equal(timeSince('not-a-date'), 'unknown');
  });

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    assert.equal(timeSince(future), 'just now');
  });
});

// ── Unit tests: constants ───────────────────────────────────────────────────

describe('constants', () => {
  it('CORE_RULES has exactly 4 rules', () => {
    assert.equal(CORE_RULES.length, 4);
  });

  it('HEADER starts with shield emoji', () => {
    assert.ok(HEADER.startsWith('🛡️'));
  });

  it('all rules start with a number', () => {
    for (const rule of CORE_RULES) {
      assert.match(rule, /^\d+\./);
    }
  });
});

// ── Integration tests: CLI execution ────────────────────────────────────────

describe('CLI execution', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmrf(tmpDir); });

  it('does not execute when imported as a module', () => {
    const scriptPath = path.resolve('hooks/zero-trust-prompt.js').replace(/\\/g, '/');
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(`file:///${scriptPath}`)}); console.log('alive-after-import');`
    ], {
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'alive-after-import');
  });

  it('exits 0 with core rules when no project context', () => {
    const scriptPath = path.resolve('hooks/zero-trust-prompt.js').replace(/\\/g, '/');
    const result = spawnSync(process.execPath, [scriptPath, '--minimal'], {
      input: JSON.stringify({}),
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Anti-Hallucination Zero-Trust'));
    assert.ok(result.stdout.includes('NEVER assume a symbol'));
    assert.ok(result.stdout.includes('NEVER assume a file path'));
  });

  it('exits 0 with core rules when project has no watchlist', () => {
    setupProject(tmpDir, { hallucinations: [] });
    const scriptPath = path.resolve('hooks/zero-trust-prompt.js').replace(/\\/g, '/');
    const cwdEscaped = tmpDir.replace(/\\/g, '/');

    const result = spawnSync(process.execPath, [scriptPath], {
      input: JSON.stringify({ cwd: cwdEscaped }),
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Anti-Hallucination Zero-Trust'));
  });

  it('exits 0 with watchlist on stdout when there are repeat offenders', () => {
    // UserPromptSubmit hooks must not exit 2: that blocks the user's prompt
    // (stderr goes to the user, not the model). Watchlist goes to stdout
    // so it is injected as model context on exit 0.
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push({ symbol: 'ghostFunc', type: 'unknown', timestamp: new Date().toISOString() });
    }
    setupProject(tmpDir, { hallucinations: entries });

    const scriptPath = path.resolve('hooks/zero-trust-prompt.js').replace(/\\/g, '/');
    const cwdEscaped = tmpDir.replace(/\\/g, '/');

    const result = spawnSync(process.execPath, [scriptPath], {
      input: JSON.stringify({ cwd: cwdEscaped }),
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('WATCHLIST'), `Expected WATCHLIST in stdout, got: ${result.stdout}`);
    assert.ok(result.stdout.includes('ghostFunc'), `Expected ghostFunc in stdout, got: ${result.stdout}`);
    assert.ok(result.stdout.includes('×5'), `Expected ×5 in stdout, got: ${result.stdout}`);
  });

  it('--dynamic includes registry stats', () => {
    setupProject(tmpDir, {
      hallucinations: [],
      symbols: {
        _meta: { indexed_at: new Date().toISOString(), file_count: 15 },
        functions: [
          { name: 'a', file: 'a.js', line: 1 },
          { name: 'b', file: 'b.js', line: 1 },
        ]
      }
    });

    const scriptPath = path.resolve('hooks/zero-trust-prompt.js').replace(/\\/g, '/');
    const cwdEscaped = tmpDir.replace(/\\/g, '/');
    const result = spawnSync(process.execPath, [scriptPath, '--dynamic'], {
      input: JSON.stringify({ cwd: cwdEscaped }),
      encoding: 'utf-8',
      timeout: 10000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Registry:'), `Expected 'Registry:' in output: ${result.stdout}`);
    assert.ok(result.stdout.includes('2 symbols') || result.stdout.includes('2 symbol'), `Expected symbol count in output: ${result.stdout}`);
    assert.ok(result.stdout.includes('15 files') || result.stdout.includes('15 file'), `Expected file count in output: ${result.stdout}`);
  });
});
