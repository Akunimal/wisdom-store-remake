import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  recordHallucination,
  getHallucinationPatterns,
  getWatchlist,
  clearHallucinations
} from '../src/mcp-server/lib/hallucination-tracker.js';

describe('Hallucination Tracker', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahm-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('records a hallucination entry to JSON file', () => {
    recordHallucination(tmpDir, 'fakeFunction', 'src/index.js', 'unknown');

    const logPath = path.join(tmpDir, 'hallucinations.json');
    assert.ok(fs.existsSync(logPath), 'Should create hallucinations.json');

    const entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].symbol, 'fakeFunction');
    assert.equal(entries[0].type, 'unknown');
    assert.equal(entries[0].file, 'src/index.js');
    assert.ok(entries[0].timestamp, 'Should have timestamp');
    assert.ok(entries[0].session, 'Should have session');
  });

  it('reads back patterns correctly', () => {
    recordHallucination(tmpDir, 'foo', 'a.js', 'unknown');
    recordHallucination(tmpDir, 'bar', 'b.js', 'fuzzy');
    recordHallucination(tmpDir, 'foo', 'c.js', 'unknown');
    recordHallucination(tmpDir, 'foo', 'd.js', 'unknown');

    const patterns = getHallucinationPatterns(tmpDir);
    assert.equal(patterns.total, 4);
    assert.equal(patterns.frequent.length, 1, 'Only foo has 3+ occurrences');
    assert.equal(patterns.frequent[0].symbol, 'foo');
    assert.equal(patterns.frequent[0].count, 3);
    assert.equal(patterns.byType.unknown, 3);
    assert.equal(patterns.byType.fuzzy, 1);
    assert.ok(patterns.recent.length <= 10);
  });

  it('FIFO rotation at max entries', () => {
    // Write 505 entries
    for (let i = 0; i < 505; i++) {
      recordHallucination(tmpDir, `sym_${i}`, 'test.js', 'unknown');
    }

    const logPath = path.join(tmpDir, 'hallucinations.json');
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.ok(entries.length <= 500, `Should cap at 500 entries, got ${entries.length}`);
    // First entries should have been rotated out
    assert.equal(entries[0].symbol, 'sym_5');
  });

  it('watchlist returns symbols with 3+ occurrences', () => {
    recordHallucination(tmpDir, 'rare', 'a.js', 'unknown');
    recordHallucination(tmpDir, 'common', 'a.js', 'unknown');
    recordHallucination(tmpDir, 'common', 'b.js', 'unknown');
    recordHallucination(tmpDir, 'common', 'c.js', 'unknown');
    recordHallucination(tmpDir, 'moderate', 'a.js', 'fuzzy');
    recordHallucination(tmpDir, 'moderate', 'b.js', 'fuzzy');

    const watchlist = getWatchlist(tmpDir);
    assert.ok(watchlist.has('common'), 'common should be on watchlist');
    assert.ok(!watchlist.has('rare'), 'rare should NOT be on watchlist');
    assert.ok(!watchlist.has('moderate'), 'moderate (2x) should NOT be on watchlist');
    assert.equal(watchlist.get('common'), 3);
  });

  it('handles missing/corrupt file gracefully', () => {
    // No file exists
    const patterns = getHallucinationPatterns(tmpDir);
    assert.equal(patterns.total, 0);
    assert.deepEqual(patterns.frequent, []);

    // Corrupt file
    fs.writeFileSync(path.join(tmpDir, 'hallucinations.json'), 'not json!');
    const patterns2 = getHallucinationPatterns(tmpDir);
    assert.equal(patterns2.total, 0);
  });

  it('clearHallucinations removes the log file', () => {
    recordHallucination(tmpDir, 'test', 'a.js', 'unknown');
    assert.ok(fs.existsSync(path.join(tmpDir, 'hallucinations.json')));

    clearHallucinations(tmpDir);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'hallucinations.json')));
  });
});
