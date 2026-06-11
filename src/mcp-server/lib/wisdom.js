/**
 * Wisdom file utilities (lite).
 *
 * Storage used by the anti-hallucination core:
 *   <project>/.wisdom/symbols.json     — symbol registry (indexer.js)
 *   <project>/.wisdom/index.json       — file list + lastIndexed
 *   <project>/.wisdom/scan-cache.json  — incremental scan cache
 *   <project>/.wisdom/hallucinations.json — cross-session watchlist
 *
 * The sidecar/sections/plans/patterns/search helpers from the full Wisdom
 * Store were removed with the lite server — they had no callers outside
 * their own smoke test (overlap with Serena MCP / GSD Skills).
 */

import fs from 'fs';
import path from 'path';

/**
 * Atomic JSON write: write to a temp file, then rename over the target.
 * Prevents a half-written file if the process dies mid-write — a corrupt
 * JSON file silently resets to empty on the next read, losing the registry,
 * the keyword index, or the cross-session hallucination watchlist.
 */
export function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    throw err;
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable — busy-wait briefly as a fallback.
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

/**
 * Run `fn` while holding a cross-process advisory lock on `targetPath`.
 *
 * Atomic writes already prevent file *corruption*; this prevents *lost updates*
 * when several agents share one repo and do read-modify-write on the same JSON
 * (hallucination log, etc.). Uses an atomic `mkdir` as the lock primitive.
 *
 * Crucially bounded and non-blocking: after a short retry budget it proceeds
 * WITHOUT the lock rather than ever hanging the caller (a write hook must never
 * stall). A lock older than `staleMs` is assumed orphaned and stolen.
 */
export function withFileLock(targetPath, fn, options = {}) {
  const lockPath = `${targetPath}.lock`;
  const retries = options.retries ?? 5;
  const retryMs = options.retryMs ?? 30;
  const staleMs = options.staleMs ?? 5000;
  let held = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.mkdirSync(lockPath);
      held = true;
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') break; // unexpected — give up the lock, still run fn
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          try { fs.rmdirSync(lockPath); } catch { /* someone else stole it */ }
          continue; // retry immediately
        }
      } catch { /* lock vanished — retry */ }
      if (attempt < retries) sleepSync(retryMs);
    }
  }

  try {
    return fn();
  } finally {
    if (held) { try { fs.rmdirSync(lockPath); } catch { /* best effort */ } }
  }
}

/**
 * Find the project root from a working directory.
 * Looks for .git, package.json, or .wisdom/ as indicators.
 */
export function findProjectRoot(cwd) {
  let dir = cwd || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) ||
        fs.existsSync(path.join(dir, 'package.json')) ||
        fs.existsSync(path.join(dir, '.wisdom'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return cwd || process.cwd();
}

/**
 * Get the .wisdom/ directory for a project, creating it if needed.
 */
export function getWisdomDir(projectRoot, create = false) {
  const wisdomDir = path.join(projectRoot, '.wisdom');
  if (create && !fs.existsSync(wisdomDir)) {
    fs.mkdirSync(wisdomDir, { recursive: true });
    writeIndex(wisdomDir, { files: [], keywords: {} });
  }
  return wisdomDir;
}

/**
 * Read the .wisdom/index.json file.
 */
export function readIndex(wisdomDir) {
  const indexPath = path.join(wisdomDir, 'index.json');
  if (!fs.existsSync(indexPath)) return { files: [], keywords: {} };
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return { files: [], keywords: {} };
  }
}

/**
 * Write the .wisdom/index.json file.
 */
export function writeIndex(wisdomDir, index) {
  writeJsonAtomic(path.join(wisdomDir, 'index.json'), index);
}
