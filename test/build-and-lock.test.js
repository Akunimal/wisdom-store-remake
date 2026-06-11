import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { filterBuildOutput } from '../src/mcp-server/tools/strategies/build-filter.js';
import { compressOutput } from '../src/mcp-server/tools/token-compressor.js';
import { withFileLock, writeJsonAtomic } from '../src/mcp-server/lib/wisdom.js';

test('build filter surfaces errors and warnings, drops progress', () => {
  const out = [
    '[1/4] Resolving packages...',
    '[2/4] Fetching packages...',
    'progress 45%',
    'src/app.ts:12:3 - error TS2322: Type string is not assignable to number',
    'Note: some files were skipped',
    'warning: deprecated API used in module foo',
    '[4/4] Done',
  ].join('\n');
  const r = filterBuildOutput(out);
  assert.match(r.compressed, /error TS2322/);
  assert.match(r.compressed, /deprecated API/);
  assert.ok(!r.compressed.includes('progress 45%'));
});

test('build commands route to the build category', () => {
  const stats = compressOutput('docker build -t app .', 'Step 1/5\nerror: build failed at line 3\nStep 2/5\n');
  assert.equal(stats.category, 'build');
  assert.match(stats.output, /build failed/);

  assert.equal(compressOutput('vite build', 'transforming...\n✓ built in 2s\n').category, 'build');
  assert.equal(compressOutput('gradle assemble', 'BUILD SUCCESSFUL\n').category, 'build');
});

test('clean build keeps a short status tail', () => {
  const r = filterBuildOutput('compiling...\nlinking...\nBuild complete: 0 errors\n');
  assert.match(r.compressed, /Build complete/);
});

test('withFileLock serializes concurrent appends without lost updates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-lock-'));
  const target = path.join(dir, 'log.json');
  writeJsonAtomic(target, []);

  // Simulate N sequential locked read-modify-writes; each must see the prior.
  for (let i = 0; i < 20; i++) {
    withFileLock(target, () => {
      const arr = JSON.parse(fs.readFileSync(target, 'utf8'));
      arr.push(i);
      writeJsonAtomic(target, arr);
    });
  }
  const final = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(final.length, 20);
  // Lock directory must be released.
  assert.ok(!fs.existsSync(`${target}.lock`));
});

test('withFileLock still runs fn and returns its value when uncontended', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-lock2-'));
  const target = path.join(dir, 'x.json');
  const result = withFileLock(target, () => 42);
  assert.equal(result, 42);
});
