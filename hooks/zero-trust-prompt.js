#!/usr/bin/env node

/**
 * Zero-Trust Anti-Drift Prompt Hook
 *
 * Fires on UserPromptSubmit — re-injects anti-hallucination rules every turn
 * to combat context drift. The model receives these deterministically,
 * regardless of how long the conversation has been running.
 *
 * Strategy: "0 trust — always read before assuming anything"
 *
 * Usage in ~/.claude/settings.json:
 *   "hooks": {
 *     "UserPromptSubmit": [{
 *       "hooks": [{
 *         "type": "command",
 *         "command": "node /path/to/hooks/zero-trust-prompt.js",
 *         "timeout": 5
 *       }]
 *     }]
 *   }
 *
 * Flags:
 *   --dynamic    Include registry stats + recent hallucinations in output
 *   --minimal    Only emit the core rules (~50 tokens, no watchlist)
 *
 * Exit codes:
 *   0  — Rules injected via stdout (soft context)
 *   2  — Warning injected via stderr (repeat offenders detected, forces attention)
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// ── Config ──────────────────────────────────────────────────────────────────

const CORE_RULES = [
  '1. NEVER assume a symbol exists — verify with check_symbols or read the file first.',
  '2. NEVER assume a file path — use list_dir or find to confirm it exists.',
  '3. NEVER assume API routes — check the actual router/handler files.',
  '4. If unsure, READ the source. Reading is always cheaper than hallucinating.'
];

const HEADER = '🛡️ Anti-Hallucination Zero-Trust (re-injected every turn):';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read JSON from stdin (Claude Code sends hook context here).
 * Returns parsed object or empty object on failure.
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    // Handle case where stdin is a TTY (Windows edge case) or empty
    if (process.stdin.isTTY) {
      resolve({});
      return;
    }

    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners();
      resolve(data ? safeParse(data) : {});
    }, 2000);

    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(safeParse(data));
    });
    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve({});
    });
  });
}

function safeParse(str) {
  try {
    return JSON.parse(str || '{}');
  } catch {
    return {};
  }
}

/**
 * Walk up from `startDir` to find a directory containing .wisdom/ or package.json.
 */
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.wisdom')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Load hallucination watchlist from .wisdom/hallucinations.json.
 * Returns array of { symbol, count } for symbols with 3+ occurrences.
 */
function loadWatchlist(wisdomDir) {
  const logPath = path.join(wisdomDir, 'hallucinations.json');
  try {
    if (!fs.existsSync(logPath)) return [];
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (!Array.isArray(entries)) return [];

    // Count by symbol
    const counts = {};
    for (const entry of entries) {
      counts[entry.symbol] = (counts[entry.symbol] || 0) + 1;
    }

    // Return symbols with 3+ occurrences, sorted by count desc
    return Object.entries(counts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, count]) => ({ symbol, count }));
  } catch {
    return [];
  }
}

/**
 * Load registry metadata from .wisdom/symbols.json.
 * Returns { totalSymbols, lastIndexed } or null.
 */
function loadRegistryMeta(wisdomDir) {
  const symbolsPath = path.join(wisdomDir, 'symbols.json');
  try {
    if (!fs.existsSync(symbolsPath)) return null;
    const registry = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
    const meta = registry._meta || {};

    // Count total symbols across all categories. Registries produced by the
    // indexer store categories as objects keyed by symbol name; keep array
    // support for older fixtures/registries.
    let totalSymbols = 0;
    for (const [key, value] of Object.entries(registry)) {
      if (key === '_meta') continue;
      if (Array.isArray(value)) {
        totalSymbols += value.length;
      } else if (value && typeof value === 'object') {
        totalSymbols += Object.keys(value).length;
      }
    }

    return {
      totalSymbols,
      lastIndexed: meta.indexed_at || meta.timestamp || meta.scanned || null,
      fileCount: meta.file_count || meta.files || null
    };
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isDynamic = args.includes('--dynamic');
  const isMinimal = args.includes('--minimal');

  // Read stdin for context (cwd, session_id, etc.)
  const input = await readStdin();
  const cwd = input.cwd || process.cwd();

  // Build the output message
  const lines = [HEADER, ...CORE_RULES];

  if (isMinimal) {
    // Minimal mode: just the core rules, exit 0
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0);
  }

  // Standard mode: try to load watchlist
  const projectRoot = findProjectRoot(cwd);
  let watchlist = [];
  let registryMeta = null;

  if (projectRoot) {
    const wisdomDir = path.join(projectRoot, '.wisdom');

    if (fs.existsSync(wisdomDir)) {
      watchlist = loadWatchlist(wisdomDir);

      if (isDynamic) {
        registryMeta = loadRegistryMeta(wisdomDir);
      }
    }
  }

  // Add dynamic registry info if requested
  if (isDynamic && registryMeta) {
    const age = registryMeta.lastIndexed
      ? timeSince(registryMeta.lastIndexed)
      : 'unknown';
    lines.push('');
    lines.push(`📊 Registry: ${registryMeta.totalSymbols} symbols from ${registryMeta.fileCount || '?'} files (indexed ${age})`);
  }

  // Add watchlist if there are repeat offenders
  if (watchlist.length > 0) {
    const watchItems = watchlist
      .slice(0, 10) // Cap at 10 to avoid token bloat
      .map(w => `${w.symbol} (×${w.count})`)
      .join(', ');

    lines.push('');
    lines.push(`⚠️ WATCHLIST — previously hallucinated symbols (DO NOT use without verifying):`);
    lines.push(`   ${watchItems}`);

    // Repeat offenders → stderr + exit 2 to force model attention
    process.stderr.write(lines.join('\n') + '\n');
    process.exit(2);
  }

  // No repeat offenders → stdout + exit 0 (soft context injection)
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

/**
 * Human-readable time since a given ISO timestamp.
 */
function timeSince(isoStr) {
  try {
    const then = new Date(isoStr);
    const now = new Date();
    const diffMs = now - then;

    if (isNaN(diffMs)) return 'unknown';
    if (diffMs < 0) return 'just now';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return 'unknown';
  }
}

// ── Exports for testing ─────────────────────────────────────────────────────

export { findProjectRoot, loadWatchlist, loadRegistryMeta, timeSince, CORE_RULES, HEADER };

// Run if executed directly
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    // Fail open — never break the user's workflow
    process.stderr.write(`[zero-trust-prompt] Error: ${err.message}\n`);
    process.exit(0);
  });
}
