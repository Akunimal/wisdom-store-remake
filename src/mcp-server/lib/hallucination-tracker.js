/**
 * Hallucination Tracker
 *
 * Persists hallucination events to .wisdom/hallucinations.json and provides
 * pattern analysis for cross-session learning.
 *
 * Design:
 * - FIFO log with max 500 entries (prevents unbounded growth)
 * - Watchlist: symbols flagged 3+ times become "repeat offenders"
 * - Session ID: process.pid (simple, unique per server instance)
 */

import fs from 'fs';
import path from 'path';
import { writeJsonAtomic } from './wisdom.js';

const MAX_ENTRIES = 500;
const WATCHLIST_THRESHOLD = 3;
const HALLUCINATIONS_FILE = 'hallucinations.json';

/**
 * Record a hallucination event.
 * @param {string} wisdomDir - Path to .wisdom/ directory
 * @param {string} symbol - The hallucinated symbol name
 * @param {string} filePath - File where it was found
 * @param {'unknown'|'fuzzy'|'bad_path'|'bad_route'} type - Type of hallucination
 */
export function recordHallucination(wisdomDir, symbol, filePath, type) {
  const logPath = path.join(wisdomDir, HALLUCINATIONS_FILE);

  let entries = [];
  try {
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      if (!Array.isArray(entries)) entries = [];
    }
  } catch {
    entries = [];
  }

  entries.push({
    symbol,
    file: filePath,
    type,
    timestamp: new Date().toISOString(),
    session: process.pid
  });

  // FIFO rotation: keep only the last MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  try {
    fs.mkdirSync(wisdomDir, { recursive: true });
    writeJsonAtomic(logPath, entries);
  } catch {
    // Fail silently — tracking is non-critical
  }
}

/**
 * Record multiple hallucination events in a single read+write.
 * check_symbols flags a whole batch at once; calling recordHallucination per
 * symbol re-reads and re-writes the JSON file N times (and racy under the
 * atomic-rename temp file). This reads once, appends all, and writes once.
 * @param {string} wisdomDir - Path to .wisdom/ directory
 * @param {Array<{symbol: string, type: string, file?: string}>} events
 */
export function recordHallucinations(wisdomDir, events) {
  if (!Array.isArray(events) || events.length === 0) return;

  const logPath = path.join(wisdomDir, HALLUCINATIONS_FILE);

  let entries = [];
  try {
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      if (!Array.isArray(entries)) entries = [];
    }
  } catch {
    entries = [];
  }

  const timestamp = new Date().toISOString();
  for (const e of events) {
    entries.push({
      symbol: e.symbol,
      file: e.file || '',
      type: e.type,
      timestamp,
      session: process.pid
    });
  }

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  try {
    fs.mkdirSync(wisdomDir, { recursive: true });
    writeJsonAtomic(logPath, entries);
  } catch {
    // Fail silently — tracking is non-critical
  }
}

/**
 * Analyze hallucination patterns from the log.
 * @param {string} wisdomDir - Path to .wisdom/ directory
 * @returns {{ frequent: Array, recent: Array, byType: Object, total: number }}
 */
export function getHallucinationPatterns(wisdomDir) {
  const logPath = path.join(wisdomDir, HALLUCINATIONS_FILE);

  let entries = [];
  try {
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      if (!Array.isArray(entries)) entries = [];
    }
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    return { frequent: [], recent: [], byType: {}, total: 0 };
  }

  // Count by symbol
  const symbolCounts = {};
  for (const entry of entries) {
    if (!symbolCounts[entry.symbol]) {
      symbolCounts[entry.symbol] = {
        symbol: entry.symbol,
        count: 0,
        type: entry.type,
        lastSeen: entry.timestamp,
        files: new Set()
      };
    }
    symbolCounts[entry.symbol].count++;
    symbolCounts[entry.symbol].lastSeen = entry.timestamp;
    if (entry.file) symbolCounts[entry.symbol].files.add(entry.file);
  }

  // Frequent: symbols with 3+ occurrences, sorted by count desc
  const frequent = Object.values(symbolCounts)
    .filter(s => s.count >= WATCHLIST_THRESHOLD)
    .sort((a, b) => b.count - a.count)
    .map(s => ({
      symbol: s.symbol,
      count: s.count,
      type: s.type,
      lastSeen: s.lastSeen,
      files: [...s.files]
    }));

  // Recent: last 10 entries
  const recent = entries.slice(-10).reverse();

  // By type
  const byType = {};
  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
  }

  return {
    frequent,
    recent,
    byType,
    total: entries.length
  };
}

/**
 * Get the watchlist of frequently hallucinated symbols (3+ times).
 * Returns a Map of symbol → count for quick lookup.
 * @param {string} wisdomDir - Path to .wisdom/ directory
 * @returns {Map<string, number>}
 */
export function getWatchlist(wisdomDir) {
  const { frequent } = getHallucinationPatterns(wisdomDir);
  const watchlist = new Map();
  for (const entry of frequent) {
    watchlist.set(entry.symbol, entry.count);
  }
  return watchlist;
}

/**
 * Clear the hallucination log (for testing).
 * @param {string} wisdomDir - Path to .wisdom/ directory
 */
export function clearHallucinations(wisdomDir) {
  const logPath = path.join(wisdomDir, HALLUCINATIONS_FILE);
  try {
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  } catch {
    // Fail silently
  }
}
