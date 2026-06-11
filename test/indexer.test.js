import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanProject, checkSymbols, readSymbols, writeSymbols } from '../src/mcp-server/lib/indexer.js';

function makeProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-indexer-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe('multi-location symbol tracking', () => {
  it('records additional definition sites in a locations array', () => {
    const root = makeProject({
      'src/a.js': 'export function shared(){}\n',
      'src/b.js': 'export function shared(){}\n',
      'src/c.js': 'export function shared(){}\n',
    });

    const scan = scanProject(root, { incremental: false });
    const entry = scan.symbols.functions.shared;
    assert.ok(entry);
    assert.equal(entry.usages, 3);
    assert.ok(Array.isArray(entry.locations));
    assert.equal(entry.locations.length, 3);
    const files = entry.locations.map(l => l.file).sort();
    assert.ok(files[0].endsWith('a.js'));
    assert.ok(files[2].endsWith('c.js'));
  });

  it('does not add locations for a symbol defined in a single file', () => {
    const root = makeProject({ 'src/a.js': 'export function solo(){}\nsolo();\n' });
    const scan = scanProject(root, { incremental: false });
    assert.equal(scan.symbols.functions.solo.locations, undefined);
  });
});

describe('fuzzy matching on short symbols', () => {
  it('skips fuzzy matching entirely for 1-2 char queries', () => {
    const root = makeProject({ 'src/a.js': 'export function abc(){}\n' });
    const scan = scanProject(root, { incremental: false });

    const result = checkSymbols(['ab'], scan.symbols);
    assert.equal(result.fuzzy.length, 0);
    assert.equal(result.unknown.length, 1);
  });

  it('allows distance 1 only for 3-4 char queries', () => {
    const root = makeProject({ 'src/a.js': 'export function food(){}\n' });
    const scan = scanProject(root, { incremental: false });

    // distance 1 → fuzzy match
    assert.equal(checkSymbols(['food'], scan.symbols).known.length, 1);
    assert.equal(checkSymbols(['foud'], scan.symbols).fuzzy.length, 1);
    // distance 2 on a 4-char query → no match
    assert.equal(checkSymbols(['fuud'], scan.symbols).unknown.length, 1);
  });

  it('still matches distance 2 on longer identifiers', () => {
    const root = makeProject({ 'src/a.js': 'export function calculateTotal(){}\n' });
    const scan = scanProject(root, { incremental: false });
    const result = checkSymbols(['calculateTotle'], scan.symbols);
    assert.equal(result.fuzzy.length, 1);
    assert.equal(result.fuzzy[0].suggestion, 'calculateTotal');
  });
});

describe('atomic symbol writes', () => {
  it('writes valid JSON and leaves no temp files behind', () => {
    const root = makeProject();
    const wisdomDir = path.join(root, '.wisdom');
    fs.mkdirSync(wisdomDir);

    writeSymbols(wisdomDir, { _meta: {}, functions: { foo: { file: 'a.js', line: 1 } } });
    assert.ok(readSymbols(wisdomDir).functions.foo);
    const leftovers = fs.readdirSync(wisdomDir).filter(f => f.includes('.tmp'));
    assert.equal(leftovers.length, 0);
  });
});

describe('scan truncation', () => {
  it('sets truncated flag when maxFiles limit is hit', () => {
    const root = makeProject({
      'src/a.js': 'function a(){}\n',
      'src/b.js': 'function b(){}\n',
      'src/c.js': 'function c(){}\n',
    });
    const scan = scanProject(root, { maxFiles: 2, incremental: false });
    assert.equal(scan.files.length, 2);
    assert.equal(scan.truncated, true);
  });

  it('does not set truncated when everything fits', () => {
    const root = makeProject({ 'src/a.js': 'function a(){}\n' });
    const scan = scanProject(root, { incremental: false });
    assert.equal(scan.truncated, false);
  });
});

describe('incremental scan cache', () => {
  it('reuses cached symbols for unchanged files and detects changes', () => {
    const root = makeProject({ 'src/a.js': 'export function first(){}\n' });
    fs.mkdirSync(path.join(root, '.wisdom'));

    const scan1 = scanProject(root);
    assert.equal(scan1.cacheHits, 0);
    assert.ok(scan1.symbols.functions.first);
    assert.ok(fs.existsSync(path.join(root, '.wisdom', 'scan-cache.json')));

    const scan2 = scanProject(root);
    assert.ok(scan2.cacheHits >= 1);
    assert.ok(scan2.symbols.functions.first);

    // Modify the file with a different mtime/size — must reparse
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export function second(){}\n// changed\n');
    const scan3 = scanProject(root);
    assert.ok(scan3.symbols.functions.second);
    assert.equal(scan3.symbols.functions.first, undefined);
  });

  it('does not create .wisdom/ when it does not exist', () => {
    const root = makeProject({ 'src/a.js': 'function a(){}\n' });
    scanProject(root);
    assert.equal(fs.existsSync(path.join(root, '.wisdom')), false);
  });

  it('bypasses cache when incremental is false', () => {
    const root = makeProject({ 'src/a.js': 'function a(){}\n' });
    fs.mkdirSync(path.join(root, '.wisdom'));
    scanProject(root);
    const scan = scanProject(root, { incremental: false });
    assert.equal(scan.cacheHits, 0);
  });
});

describe('skip directory configuration', () => {
  it('skips default dirs like data/ but indexes them when includeDirs overrides', () => {
    const files = { 'data/script.js': 'export function insideData(){}\n' };
    const root1 = makeProject(files);
    const scan1 = scanProject(root1, { incremental: false });
    assert.equal(scan1.symbols.functions.insideData, undefined);

    const root2 = makeProject(files);
    const scan2 = scanProject(root2, { incremental: false, includeDirs: ['data'] });
    assert.ok(scan2.symbols.functions.insideData);
  });

  it('never indexes node_modules even with includeDirs', () => {
    const root = makeProject({ 'node_modules/x/index.js': 'export function dep(){}\n' });
    const scan = scanProject(root, { incremental: false, includeDirs: ['node_modules'] });
    assert.equal(scan.symbols.functions.dep, undefined);
  });

  it('reads skipDirs and includeDirs from .wisdom/config.json', () => {
    const root = makeProject({
      'custom/skip-me.js': 'export function skipped(){}\n',
      'content/keep-me.js': 'export function kept(){}\n',
    });
    fs.mkdirSync(path.join(root, '.wisdom'));
    fs.writeFileSync(
      path.join(root, '.wisdom', 'config.json'),
      JSON.stringify({ skipDirs: ['custom'], includeDirs: ['content'] })
    );

    const scan = scanProject(root, { incremental: false });
    assert.equal(scan.symbols.functions.skipped, undefined);
    assert.ok(scan.symbols.functions.kept);
  });

  it('indexes migrations/ by default (SQL support)', () => {
    const root = makeProject({ 'migrations/001_init.sql': 'CREATE TABLE users (\n  id INT\n);\n' });
    const scan = scanProject(root, { incremental: false });
    assert.ok(scan.symbols.classes.users);
  });
});

describe('gitignore negation', () => {
  it('honors !dir to re-include a previously ignored directory', () => {
    const root = makeProject({ 'generated/code.js': 'export function gen(){}\n' });
    fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n!generated\n');
    const scan = scanProject(root, { incremental: false });
    assert.ok(scan.symbols.functions.gen);
  });

  it('still skips plain gitignored dirs', () => {
    const root = makeProject({ 'generated/code.js': 'export function gen(){}\n' });
    fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n');
    const scan = scanProject(root, { incremental: false });
    assert.equal(scan.symbols.functions.gen, undefined);
  });
});
