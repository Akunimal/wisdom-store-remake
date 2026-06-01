import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressOutput } from '../src/mcp-server/tools/token-compressor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Token Compressor Engine', () => {
  it('compresses git status output effectively', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'git-status.txt'), 'utf-8');
    const result = compressOutput('git status', raw);
    
    assert.strictEqual(result.category, 'git');
    assert.ok(result.savingsPercent > 50, 'Should save at least 50% on git status');
    assert.ok(result.output.includes('staged (3):'), 'Should extract staged counts');
    assert.ok(result.output.includes('modified (2):'), 'Should extract modified counts');
    assert.ok(result.output.includes('untracked (3):'), 'Should extract untracked counts');
  });

  it('compresses npm test output to focus on failures', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'npm-test.txt'), 'utf-8');
    const result = compressOutput('npm test', raw);
    
    assert.strictEqual(result.category, 'test');
    assert.ok(result.savingsPercent > 30, 'Should save tokens on test output');
    assert.ok(result.output.includes('FAILURES:'), 'Should highlight failures');
    assert.ok(result.output.includes('Token Compressor'), 'Should include failing test name');
    assert.ok(result.output.includes('3 tests: 1 failed, 2 passed'), 'Should include summary');
  });

  it('compresses tsc output by grouping errors', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, 'tsc-errors.txt'), 'utf-8');
    const result = compressOutput('tsc --noEmit', raw);
    
    assert.strictEqual(result.category, 'lint');
    assert.ok(result.output.includes('3 errors, 1 warnings (3 unique rules)'), 'Should summarize counts');
    assert.ok(result.output.includes('TS2322'), 'Should include grouped rule code');
    assert.ok(result.output.includes('TS2304'), 'Should include grouped rule code');
  });

  it('compresses simple directory listings', () => {
    const raw = `
total 16
drwxr-xr-x 1 user user   0 Jan 1 12:00 .
drwxr-xr-x 1 user user   0 Jan 1 12:00 ..
-rw-r--r-- 1 user user 100 Jan 1 12:00 file1.txt
-rw-r--r-- 1 user user 200 Jan 1 12:00 file2.txt
drwxr-xr-x 1 user user   0 Jan 1 12:00 src
`;
    const result = compressOutput('ls -la', raw);
    assert.strictEqual(result.category, 'file');
    assert.ok(result.output.includes('file1.txt'), 'Should list files');
    assert.ok(result.output.includes('file2.txt'), 'Should list files');
    assert.ok(result.output.includes('src/'), 'Should indicate directories');
  });

  it('compresses generic output using smart truncation if large', () => {
    // Generate a string that is roughly 3000 tokens (12000 chars)
    const raw = Array.from({ length: 300 }, (_, i) => `Line ${i}: this is some generic output that is quite long to force truncation.`).join('\n');
    const result = compressOutput('unknown-command', raw, { maxTokens: 500 });
    
    assert.strictEqual(result.category, 'unknown');
    assert.ok(result.compressedTokens <= 510, 'Should be truncated to near maxTokens');
    assert.ok(result.output.includes('omitted'), 'Should include omission notice');
    assert.ok(result.savingsPercent > 50, 'Should have high savings due to truncation');
  });
});
