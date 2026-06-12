/**
 * watch_project tool
 *
 * Starts (or stops) a background watcher that keeps .wisdom/symbols.json fresh
 * as files change — eliminating the stale-registry false positives that make
 * check_symbols flag legitimately-new symbols as hallucinations. Once watching,
 * the agent never needs to call refresh_symbols manually.
 */

import {
  findProjectRoot,
  getWisdomDir,
  readIndex,
  writeIndex
} from '../lib/wisdom.js';

import { scanProject, writeSymbols } from '../lib/indexer.js';
import { createProjectWatcher } from '../lib/watcher.js';

const AUTO_HEAL_RETRY_MS = 1000;

/**
 * @typedef {{ maxDepth: number, maxFiles: number }} ScanOptions
 * @typedef {{ close: () => void, watchedDirs: number }} ProjectWatcher
 * @typedef {{
 *   watcher: ProjectWatcher | null,
 *   scanOptions: ScanOptions,
 *   since: string,
 *   rescans: number,
 *   failures: number,
 *   recoveries: number,
 *   lastError: string | null,
 *   lastWarning: string | null,
 *   recoveryTimer: ReturnType<typeof setTimeout> | null
 * }} WatcherEntry
 */

// projectRoot -> { watcher, scanOptions, rescans, failures, recoveries, lastError, lastWarning, recoveryTimer }
/** @type {Map<string, WatcherEntry>} */
const activeWatchers = new Map();

function scanWarning(result, scanOptions) {
  /** @type {string[]} */
  const warnings = [];
  if (result.truncated) warnings.push(`file limit reached (${scanOptions.maxFiles})`);
  if (result.depthTruncated) warnings.push(`depth limit reached (${scanOptions.maxDepth})`);
  return warnings.length ? `registry incomplete: ${warnings.join('; ')}` : null;
}

function rescan(projectRoot, wisdomDir, scanOptions) {
  const start = Date.now();
  const result = scanProject(projectRoot, scanOptions);
  const symbolData = {
    _meta: {
      project: projectRoot,
      scanned: new Date().toISOString(),
      elapsed_ms: Date.now() - start,
      file_count: result.files.length,
      incomplete: result.truncated || result.depthTruncated,
      truncated: result.truncated,
      depth_truncated: result.depthTruncated,
      max_files: scanOptions.maxFiles,
      max_depth: scanOptions.maxDepth
    },
    ...result.symbols
  };
  writeSymbols(wisdomDir, symbolData);

  const index = readIndex(wisdomDir);
  index.files = result.files.map((f) => ({ path: f.path, lang: f.lang, lines: f.lines, modified: f.modified }));
  index.lastIndexed = new Date().toISOString();
  writeIndex(wisdomDir, index);
  return result;
}

export const watchProjectDefinition = {
  name: 'watch_project',
  description: 'Start (or stop) a background watcher that keeps the symbol registry fresh automatically as files change. While active, check_symbols never reports stale-registry false positives and you do not need to call refresh_symbols. Pass enable:false to stop. Ideal at the start of a long editing session.',
  inputSchema: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: 'Project root directory. If omitted, auto-detects from the current working directory.'
      },
      enable: {
        type: 'boolean',
        description: 'true (default) to start watching, false to stop.',
        default: true
      },
      debounce_ms: {
        type: 'integer',
        description: 'Milliseconds to coalesce rapid changes before rescanning. Default: 600.',
        default: 600,
        minimum: 0
      },
      max_depth: {
        type: 'integer',
        description: 'Maximum directory depth to scan. Default: 8.',
        default: 8,
        minimum: 1
      },
      max_files: {
        type: 'integer',
        description: 'Maximum number of files to scan. Default: 2000.',
        default: 2000,
        minimum: 1
      }
    },
    required: []
  }
};

function text(message) {
  return { content: [{ type: 'text', text: message }] };
}

function clearRecoveryTimer(entry) {
  if (!entry.recoveryTimer) return;
  clearTimeout(entry.recoveryTimer);
  entry.recoveryTimer = null;
}

function closeEntry(entry) {
  clearRecoveryTimer(entry);
  entry.watcher.close();
}

function attemptRescan(entry, projectRoot, wisdomDir) {
  try {
    const result = rescan(projectRoot, wisdomDir, entry.scanOptions);
    entry.rescans++;
    if (entry.lastError) entry.recoveries++;
    entry.lastError = null;
    entry.lastWarning = scanWarning(result, entry.scanOptions);
    clearRecoveryTimer(entry);
    return true;
  } catch (error) {
    entry.failures++;
    entry.lastError = error.message;
    return false;
  }
}

function scheduleRecovery(entry, projectRoot, wisdomDir) {
  if (entry.recoveryTimer) return;
  entry.recoveryTimer = setTimeout(() => {
    entry.recoveryTimer = null;
    attemptRescan(entry, projectRoot, wisdomDir);
  }, AUTO_HEAL_RETRY_MS);
  entry.recoveryTimer.unref?.();
}

function statusSuffix(entry) {
  /** @type {string[]} */
  const parts = [];
  if (entry.failures) parts.push(`${entry.failures} failed`);
  if (entry.recoveries) parts.push(`${entry.recoveries} auto-healed`);
  if (entry.recoveryTimer) parts.push('auto-heal pending');
  if (entry.lastError) parts.push(`last error: ${entry.lastError}`);
  if (entry.lastWarning) parts.push(`WARNING: ${entry.lastWarning}`);
  return parts.length ? `, ${parts.join(', ')}` : '';
}

/**
 * @param {{ project_path?: string, enable?: boolean, debounce_ms?: number, max_depth?: number, max_files?: number }} [args]
 */
export async function handleWatchProject(args = {}) {
  const projectRoot = findProjectRoot(args.project_path);
  const enable = args.enable !== false;

  if (!enable) {
    const entry = activeWatchers.get(projectRoot);
    if (!entry) return text(`No active watcher for ${projectRoot}.`);
    closeEntry(entry);
    activeWatchers.delete(projectRoot);
    return text(`Stopped watching ${projectRoot} (${entry.rescans} successful incremental rescans${statusSuffix(entry)}).`);
  }

  if (activeWatchers.has(projectRoot)) {
    const entry = activeWatchers.get(projectRoot);
    return text(`Already watching ${projectRoot} (${entry.watcher.watchedDirs} dirs, ${entry.rescans} successful rescans${statusSuffix(entry)}). Pass enable:false to stop.`);
  }

  const wisdomDir = getWisdomDir(projectRoot, true);
  const scanOptions = {
    maxDepth: Number.isInteger(args.max_depth) && args.max_depth > 0 ? args.max_depth : 8,
    maxFiles: Number.isInteger(args.max_files) && args.max_files > 0 ? args.max_files : 2000
  };
  /** @type {WatcherEntry} */
  const entry = {
    watcher: null,
    scanOptions,
    since: new Date().toISOString(),
    rescans: 0,
    failures: 0,
    recoveries: 0,
    lastError: null,
    lastWarning: null,
    recoveryTimer: null
  };
  entry.watcher = createProjectWatcher(
    projectRoot,
    () => {
      if (!attemptRescan(entry, projectRoot, wisdomDir)) {
        scheduleRecovery(entry, projectRoot, wisdomDir);
      }
    },
    {
      debounceMs: Number.isInteger(args.debounce_ms) && args.debounce_ms >= 0 ? args.debounce_ms : 600,
      onError: (error) => {
        entry.failures++;
        entry.lastError = error.message;
        scheduleRecovery(entry, projectRoot, wisdomDir);
      }
    }
  );

  if (entry.watcher.watchedDirs === 0) {
    closeEntry(entry);
    throw new Error(`Unable to watch ${projectRoot}${entry.lastError ? `: ${entry.lastError}` : ''}`);
  }
  activeWatchers.set(projectRoot, entry);

  // Establish a fresh baseline immediately.
  let baseline;
  try {
    baseline = rescan(projectRoot, wisdomDir, scanOptions);
    entry.lastWarning = scanWarning(baseline, scanOptions);
  } catch (error) {
    closeEntry(entry);
    activeWatchers.delete(projectRoot);
    throw error;
  }

  const warning = entry.lastWarning ? ` WARNING: ${entry.lastWarning}.` : '';
  return text(`Watching ${projectRoot} — ${entry.watcher.watchedDirs} dirs, baseline ${baseline.files.length} files indexed.${warning} The registry now auto-updates on every change; refresh_symbols is no longer needed for this project.`);
}

// Exposed for tests / graceful shutdown.
export function _stopAllWatchers() {
  for (const entry of activeWatchers.values()) {
    try { closeEntry(entry); } catch { /* best-effort */ }
  }
  activeWatchers.clear();
}

export function _activeWatcherCount() {
  return activeWatchers.size;
}

export function getWatcherHealth(projectRoot) {
  const entry = activeWatchers.get(projectRoot);
  if (!entry) return null;
  return {
    active: true,
    since: entry.since,
    watchedDirs: entry.watcher.watchedDirs,
    rescans: entry.rescans,
    failures: entry.failures,
    recoveries: entry.recoveries,
    recoveryPending: !!entry.recoveryTimer,
    lastError: entry.lastError,
    lastWarning: entry.lastWarning,
    scanOptions: { ...entry.scanOptions }
  };
}
