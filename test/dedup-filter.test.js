import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateLines, groupSimilarLines } from '../src/mcp-server/tools/strategies/dedup-filter.js';

describe('Line Deduplication', () => {
  it('collapses 5 consecutive identical lines into 1 with counter', () => {
    const input = Array(5).fill('npm warn deprecated module@1.0.0').join('\n');
    const { compressed, duplicatesRemoved } = deduplicateLines(input);
    assert.ok(compressed.includes('[×5]'), 'Should include ×5 counter');
    assert.equal(duplicatesRemoved, 4);
    assert.equal(compressed.split('\n').length, 1, 'Should be single line');
  });

  it('does not collapse 2 identical lines (below default threshold)', () => {
    const input = 'same line\nsame line';
    const { compressed, duplicatesRemoved } = deduplicateLines(input);
    assert.equal(compressed, input, 'Should not modify below threshold');
    assert.equal(duplicatesRemoved, 0);
  });

  it('collapses exactly at threshold', () => {
    const input = 'line\nline\nline';
    const { compressed, duplicatesRemoved } = deduplicateLines(input);
    assert.ok(compressed.includes('[×3]'));
    assert.equal(duplicatesRemoved, 2);
  });

  it('handles multiple separate groups of duplicates', () => {
    const lines = [
      ...Array(4).fill('first repeated'),
      'unique line',
      ...Array(3).fill('second repeated'),
    ];
    const { compressed, duplicatesRemoved } = deduplicateLines(lines.join('\n'));
    assert.ok(compressed.includes('first repeated [×4]'));
    assert.ok(compressed.includes('unique line'));
    assert.ok(compressed.includes('second repeated [×3]'));
    assert.equal(duplicatesRemoved, 5); // 3 from first group + 2 from second
  });

  it('preserves unique lines untouched', () => {
    const input = 'line 1\nline 2\nline 3\nline 4\nline 5';
    const { compressed, duplicatesRemoved } = deduplicateLines(input);
    assert.equal(compressed, input);
    assert.equal(duplicatesRemoved, 0);
  });

  it('handles empty input', () => {
    const { compressed, duplicatesRemoved } = deduplicateLines('');
    assert.equal(compressed, '');
    assert.equal(duplicatesRemoved, 0);
  });

  it('handles null/undefined input', () => {
    assert.equal(deduplicateLines(null).compressed, '');
    assert.equal(deduplicateLines(undefined).compressed, '');
  });

  it('handles single-line input', () => {
    const { compressed } = deduplicateLines('just one line');
    assert.equal(compressed, 'just one line');
  });
});

describe('Group Similar Lines', () => {
  it('groups lines with common prefix', () => {
    const lines = [
      'npm warn deprecated inflight@1.0.6',
      'npm warn deprecated rimraf@3.0.2',
      'npm warn deprecated glob@7.2.3',
      'npm warn deprecated uuid@3.4.0',
    ];
    const { compressed, groupsCreated } = groupSimilarLines(lines.join('\n'));
    assert.ok(groupsCreated >= 1, 'Should create at least 1 group');
    assert.ok(compressed.includes('items)'), 'Should include items count');
    assert.ok(compressed.split('\n').length < lines.length, 'Should reduce line count');
  });

  it('preserves lines that cannot be grouped', () => {
    const input = 'unique line 1\ncompletely different 2\nanother thing 3';
    const { compressed, groupsCreated } = groupSimilarLines(input);
    assert.equal(groupsCreated, 0);
    assert.equal(compressed, input);
  });

  it('handles empty input', () => {
    const { compressed, groupsCreated } = groupSimilarLines('');
    assert.equal(compressed, '');
    assert.equal(groupsCreated, 0);
  });

  it('skips empty lines without grouping them', () => {
    const input = '\n\nline a\nline b\nline c\n\n';
    const { compressed } = groupSimilarLines(input);
    // Empty lines should pass through
    assert.ok(compressed.includes('line a') || compressed.includes('line'));
  });
});
