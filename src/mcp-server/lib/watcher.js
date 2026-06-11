/**
 * Project file watcher.
 *
 * Keeps the symbol registry fresh automatically so the agent never queries a
 * stale registry (the #1 source of false "unknown symbol" reports). Watches
 * the project's source directories and fires a debounced callback when a code
 * file changes; the caller runs an incremental rescan (cheap — unchanged files
 * are served from the mtime cache).
 *
 * Portable by design: instead of relying on `fs.watch(dir, { recursive })`
 * (unsupported on Linux before Node 20), it watches each directory explicitly
 * and starts watching newly-created subdirectories as they appear.
 */

import fs from 'fs';
import path from 'path';
import { CODE_EXTENSIONS } from './indexer.js';

// Directories never worth watching (mirrors the scanner's ALWAYS_SKIP).
const WATCH_SKIP = new Set([
  'node_modules', '.git', '.wisdom', '.claude', 'dist', 'build',
  'coverage', '.next', '__pycache__', '.tox', '.venv', 'venv',
  'vendor', 'target', '.cache', '.turbo',
]);

const MAX_WATCH_DEPTH = 12;

/**
 * Start watching a project tree.
 * @param {string} projectRoot
 * @param {(changedFiles: string[]) => void} onChange - called (debounced) with
 *   absolute paths of code files that changed since the last flush.
 * @param {{ debounceMs?: number }} [options]
 * @returns {{ close: () => void, watchedDirs: number }}
 */
export function createProjectWatcher(projectRoot, onChange, options = {}) {
  const debounceMs = options.debounceMs ?? 600;
  const watchers = new Map(); // dir -> FSWatcher
  const pending = new Set();
  let timer = null;
  let closed = false;

  function schedule(file) {
    if (file) pending.add(file);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    timer.unref?.();
  }

  function flush() {
    timer = null;
    if (closed) return;
    const files = [...pending];
    pending.clear();
    try { onChange(files); } catch { /* rescan errors are non-fatal */ }
  }

  function watchDir(dir) {
    if (closed || watchers.has(dir)) return;
    let w;
    try {
      w = fs.watch(dir, (_eventType, filename) => {
        if (closed || !filename) return;
        const full = path.join(dir, filename);

        let stat = null;
        try { stat = fs.statSync(full); } catch { /* deleted/renamed */ }

        if (stat && stat.isDirectory()) {
          if (!WATCH_SKIP.has(filename) && !filename.startsWith('.')) {
            walkAndWatch(full, depthOf(dir) + 1);
          }
          return;
        }

        if (CODE_EXTENSIONS.has(path.extname(filename))) {
          schedule(full);
        }
      });
    } catch {
      return; // directory vanished or permission denied — skip it
    }
    w.on('error', () => { /* best-effort */ });
    watchers.set(dir, w);
  }

  function depthOf(dir) {
    const rel = path.relative(projectRoot, dir);
    if (!rel || rel.startsWith('..')) return 0;
    return rel.split(path.sep).length;
  }

  function walkAndWatch(dir, depth = 0) {
    if (closed || depth > MAX_WATCH_DEPTH) return;
    watchDir(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (WATCH_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      walkAndWatch(path.join(dir, entry.name), depth + 1);
    }
  }

  walkAndWatch(projectRoot);

  return {
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      for (const w of watchers.values()) {
        try { w.close(); } catch { /* best-effort */ }
      }
      watchers.clear();
    },
    get watchedDirs() { return watchers.size; }
  };
}
