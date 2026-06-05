/**
 * Token Compressor Engine
 * Orchestrates the various filtering strategies based on the executed command.
 *
 * v0.8.0: Added secret redaction, threshold-based compression,
 * line deduplication, and compression analytics.
 */

import { filterGit } from './strategies/git-filter.js';
import { filterTest } from './strategies/test-filter.js';
import { filterLint } from './strategies/lint-filter.js';
import { filterFile } from './strategies/file-filter.js';
import { filterLog } from './strategies/log-filter.js';
import { filterJson } from './strategies/json-filter.js';
import { filterGeneric, stripAnsi } from './strategies/generic-filter.js';
import { redactSecrets } from './strategies/secret-redactor.js';
import { deduplicateLines, groupSimilarLines } from './strategies/dedup-filter.js';
import { recordCompression } from '../lib/compression-stats.js';

/**
 * Minimum savings percentage to justify returning compressed output.
 * Below this threshold, the cleaned (but uncompressed) output is returned.
 * Exception: 'git' category always compresses (even small savings preserve structure).
 */
const MIN_COMPRESSION_THRESHOLD = 10;

/**
 * Identify the category of the command to apply the right filter.
 */
function detectCommandCategory(commandStr) {
  const parts = commandStr.trim().split(/\s+/);
  if (!parts.length) return { category: 'unknown', base: '', args: [] };

  const base = parts[0].toLowerCase();
  const args = parts.slice(1);
  const fullArgs = args.join(' ').toLowerCase();

  // Handle environment variables at the start (e.g., NODE_ENV=test npm test)
  if (base.includes('=')) {
    return detectCommandCategory(args.join(' '));
  }

  // Git
  if (base === 'git' || base === 'gh' || base === 'hub') {
    return { category: 'git', base, args };
  }

  // Tests
  if (base === 'jest' || base === 'vitest' || base === 'pytest' || base === 'rspec' ||
      (base === 'npm' && args[0] === 'test') ||
      (base === 'cargo' && args[0] === 'test') ||
      (base === 'go' && args[0] === 'test')) {
    return { category: 'test', base, args };
  }

  // Lint / Compile
  if (base === 'tsc' || base === 'eslint' || base === 'ruff' || base === 'biome' || base === 'rubocop' ||
      (base === 'cargo' && args[0] === 'clippy') ||
      (base === 'golangci-lint')) {
    return { category: 'lint', base, args };
  }

  // Files / Directories
  if (base === 'ls' || base === 'dir' || base === 'tree' || base === 'cat' || base === 'type' || base === 'find') {
    return { category: 'file', base, args };
  }

  // Generic tools that might output JSON or structured data
  if (base === 'jq' || fullArgs.includes('--json') || fullArgs.includes('-o json')) {
    return { category: 'json', base, args };
  }

  // System/Logs
  if (base === 'tail' || base === 'head' || base === 'journalctl' || base === 'docker' && args[0] === 'logs') {
    return { category: 'log', base, args };
  }

  // Package managers
  if (base === 'npm' || base === 'yarn' || base === 'pnpm' || base === 'pip' || base === 'cargo') {
    return { category: 'package', base, args };
  }

  return { category: 'unknown', base, args };
}

/**
 * Main compression pipeline.
 * Routes raw output to the appropriate strategy based on the command.
 */
export function compressOutput(command, rawOutput, options = {}) {
  const { maxTokens = 500, level = 'normal', redact = true } = options;
  const { category, base, args } = detectCommandCategory(command);
  
  // Step 1: Strip ANSI to make parsing easier and save tokens immediately
  let cleanOutput = stripAnsi(rawOutput);

  // Step 2: Redact secrets (before any filtering to prevent leaks in compressed output)
  let redactedCount = 0;
  if (redact) {
    const before = cleanOutput;
    cleanOutput = redactSecrets(cleanOutput);
    // Count redactions by comparing (rough but cheap)
    const matches = before.match(/\[REDACTED:/g);
    const matchesAfter = cleanOutput.match(/\[REDACTED:/g);
    redactedCount = (matchesAfter?.length || 0) - (matches?.length || 0);
  }

  const estimatedTokens = Math.ceil(cleanOutput.length / 4);

  function buildStats(result) {
    const stats = {
      category,
      originalChars: rawOutput.length,
      originalTokens: estimatedTokens,
      compressedChars: result.compressed.length,
      compressedTokens: Math.ceil(result.compressed.length / 4),
      savingsPercent: result.savings,
      output: result.compressed,
      redactedCount
    };

    // Threshold check: if savings are below threshold, return cleaned output instead
    // Exception: 'git' category always compresses (structural value)
    if (category !== 'git' && stats.savingsPercent < MIN_COMPRESSION_THRESHOLD) {
      stats.output = cleanOutput;
      stats.compressedChars = cleanOutput.length;
      stats.compressedTokens = Math.ceil(cleanOutput.length / 4);
      stats.savingsPercent = 0;
      stats.skipped = true;
      stats.reason = 'below_threshold';
    }

    // Record analytics
    recordCompression(command, category, stats.originalTokens, stats.compressedTokens, stats.savingsPercent);

    return stats;
  }

  // If output is small enough, no complex filtering needed (just generic cleanup)
  if (estimatedTokens < 50 && category !== 'git') {
    return buildStats(filterGeneric(cleanOutput, maxTokens));
  }

  let result = null;

  try {
    switch (category) {
      case 'git':
        result = filterGit(cleanOutput, args);
        break;
      case 'test':
        result = filterTest(cleanOutput, args);
        break;
      case 'lint':
        result = filterLint(cleanOutput, args);
        break;
      case 'file':
        result = filterFile(cleanOutput, args, base);
        break;
      case 'log':
        result = filterLog(cleanOutput, args);
        break;
      case 'json':
        result = filterJson(cleanOutput, args);
        break;
      // 'package' and 'unknown' fall through to generic filter
    }
  } catch (error) {
    // If a specific filter crashes, fallback to generic
    console.error(`Filter crashed for category ${category}:`, error);
  }

  // If no specific result, or filter declined, use generic
  if (!result) {
    result = filterGeneric(cleanOutput, maxTokens);
  }

  // Step 3: Apply line deduplication as a universal post-processor
  // Catches redundancy that any specific filter might have missed
  try {
    const deduped = deduplicateLines(result.compressed);
    if (deduped.duplicatesRemoved > 0) {
      const newSavings = Math.round((1 - deduped.compressed.length / cleanOutput.length) * 100);
      result = {
        compressed: deduped.compressed,
        savings: Math.max(0, newSavings)
      };
    }
  } catch {
    // Dedup failure is non-critical, continue with undeduped result
  }

  // Step 4: Group similar lines (e.g., "npm warn deprecated X", "npm warn deprecated Y")
  // Collapses lines sharing a common prefix into a single grouped line
  try {
    const grouped = groupSimilarLines(result.compressed);
    if (grouped.groupsCreated > 0) {
      const newSavings = Math.round((1 - grouped.compressed.length / cleanOutput.length) * 100);
      result = {
        compressed: grouped.compressed,
        savings: Math.max(0, newSavings)
      };
    }
  } catch {
    // Grouping failure is non-critical
  }

  // NOTE: We no longer enforce maxTokens on results generated by specific filters
  // (like git diff, tests, etc.) because they are designed to preserve fidelity
  // where needed and self-truncate noise using domain knowledge (RTK philosophy).

  return buildStats(result);
}
