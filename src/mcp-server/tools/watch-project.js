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

// projectRoot -> { watcher, since, rescans, failures, lastError }
const activeWatchers = new Map();

function rescan(projectRoot, wisdomDir) {
  const start = Date.now();
  const result = scanProject(projectRoot); // incremental — cheap on small deltas
  const symbolData = {
    _meta: {
      project: projectRoot,
      scanned: new Date().toISOString(),
      elapsed_ms: Date.now() - start,
      file_count: result.files.length
    },
    ...result.symbols
  };
  writeSymbols(wisdomDir, symbolData);

  const index = readIndex(wisdomDir);
  index.files = result.files.map((f) => ({ path: f.path, lang: f.lang, lines: f.lines, modified: f.modified }));
  index.lastIndexed = new Date().toISOString();
  writeIndex(wisdomDir, index);
  return result.files.length;
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
      }
    },
    required: []
  }
};

function text(message) {
  return { content: [{ type: 'text', text: message }] };
}

function statusSuffix(entry) {
  if (!entry.failures) return '';
  return `, ${entry.failures} failed${entry.lastError ? ` (last: ${entry.lastError})` : ''}`;
}

export async function handleWatchProject(args = {}) {
  const projectRoot = findProjectRoot(args.project_path);
  const enable = args.enable !== false;

  if (!enable) {
    const entry = activeWatchers.get(projectRoot);
    if (!entry) return text(`No active watcher for ${projectRoot}.`);
    entry.watcher.close();
    activeWatchers.delete(projectRoot);
    return text(`Stopped watching ${projectRoot} (${entry.rescans} successful incremental rescans${statusSuffix(entry)}).`);
  }

  if (activeWatchers.has(projectRoot)) {
    const entry = activeWatchers.get(projectRoot);
    return text(`Already watching ${projectRoot} (${entry.watcher.watchedDirs} dirs, ${entry.rescans} successful rescans${statusSuffix(entry)}). Pass enable:false to stop.`);
  }

  const wisdomDir = getWisdomDir(projectRoot, true);
  const entry = { watcher: null, since: new Date().toISOString(), rescans: 0, failures: 0, lastError: null };
  entry.watcher = createProjectWatcher(
    projectRoot,
    () => {
      try {
        rescan(projectRoot, wisdomDir);
        entry.rescans++;
        entry.lastError = null;
      } catch (error) {
        entry.failures++;
        entry.lastError = error.message;
      }
    },
    {
      debounceMs: Number.isInteger(args.debounce_ms) && args.debounce_ms >= 0 ? args.debounce_ms : 600,
      onError: (error) => {
        entry.failures++;
        entry.lastError = error.message;
      }
    }
  );

  if (entry.watcher.watchedDirs === 0) {
    entry.watcher.close();
    throw new Error(`Unable to watch ${projectRoot}${entry.lastError ? `: ${entry.lastError}` : ''}`);
  }
  activeWatchers.set(projectRoot, entry);

  // Establish a fresh baseline immediately.
  let fileCount;
  try {
    fileCount = rescan(projectRoot, wisdomDir);
  } catch (error) {
    entry.watcher.close();
    activeWatchers.delete(projectRoot);
    throw error;
  }

  return text(`Watching ${projectRoot} — ${entry.watcher.watchedDirs} dirs, baseline ${fileCount} files indexed. The registry now auto-updates on every change; refresh_symbols is no longer needed for this project.`);
}

// Exposed for tests / graceful shutdown.
export function _stopAllWatchers() {
  for (const entry of activeWatchers.values()) {
    try { entry.watcher.close(); } catch { /* best-effort */ }
  }
  activeWatchers.clear();
}

export function _activeWatcherCount() {
  return activeWatchers.size;
}
