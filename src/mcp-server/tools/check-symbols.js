/**
 * check_symbols tool
 *
 * Given a list of symbol names, cross-reference against the registry.
 * Reports:
 * - known: confirmed symbols with confidence score (skip in output for brevity)
 * - fuzzy: possible typos with confidence and suggestion (name + suggestion + distance)
 * - unknown: new or potentially hallucinated symbols
 *
 * v0.8.0: Added confidence scoring, hallucination tracking, and watchlist alerts.
 *
 * Context-efficient: only reports fuzzy matches and unknowns.
 * Known symbols are counted but not listed unless requested.
 */

import {
  findProjectRoot,
  getWisdomDir
} from '../lib/wisdom.js';

import {
  checkSymbols,
  readSymbolsResult
} from '../lib/indexer.js';

import {
  recordHallucinations,
  getWatchlist
} from '../lib/hallucination-tracker.js';

export async function handleCheckSymbols(args) {
  if (!args.symbols || !Array.isArray(args.symbols) || args.symbols.length === 0) {
    return {
      content: [{ type: 'text', text: 'Provide an array of symbol names to check.' }],
      isError: true
    };
  }

  const projectRoot = findProjectRoot(args.project_path);
  const wisdomDir = getWisdomDir(projectRoot);
  const { registry, status } = readSymbolsResult(wisdomDir);

  if (status === 'corrupt') {
    return {
      content: [{ type: 'text', text: '⚠️ Symbol registry (.wisdom/symbols.json) is corrupt or unreadable — not missing. Every symbol would be falsely reported as unknown. Run `reindex_project` with `force: true` to rebuild it.' }],
      isError: true
    };
  }

  if (status === 'missing' || !registry) {
    return {
      content: [{ type: 'text', text: 'No symbol registry found. Run `reindex_project` first.' }],
      isError: true
    };
  }

  // Strip _meta before checking
  const { _meta, ...symbolCategories } = registry;
  const result = checkSymbols(args.symbols, symbolCategories);

  // Staleness warning: a registry older than the freshness window (or one
  // predating files edited since the scan) flags legitimately-new symbols as
  // unknown. Surface it so the user reindexes instead of trusting stale data.
  const staleNote = registryStalenessNote(_meta);

  // Load watchlist for repeat-offender annotations
  let watchlist;
  try {
    watchlist = getWatchlist(wisdomDir);
  } catch {
    watchlist = new Map();
  }

  const lines = [];

  // Only report issues (context-efficient)
  if (result.fuzzy.length > 0) {
    lines.push(`### Possible Typos (${result.fuzzy.length})`);
    for (const f of result.fuzzy) {
      const usageNote = f.usages > 5 ? ' (well-established)' : f.usages === 1 ? ' (rarely used)' : '';
      const confidenceStr = ` (${Math.round(f.confidence * 100)}% confidence)`;
      const repeatNote = watchlist.has(f.queried) ? ` ⚠️ [REPEAT ×${watchlist.get(f.queried)}]` : '';
      const multiNote = f.locations && f.locations.length > 1 ? ` [defined in ${f.locations.length} files]` : '';
      lines.push(`- **${f.queried}** → did you mean **${f.suggestion}**?${confidenceStr} (${f.category}, ${f.file}:${f.line}${multiNote})${usageNote}${repeatNote}`);
    }
    lines.push('');
  }

  if (result.unknown.length > 0) {
    lines.push(`### Unknown Symbols (${result.unknown.length})`);
    lines.push(`These are not in the registry — could be new, renamed, or hallucinated:`);
    for (const u of result.unknown) {
      const repeatNote = watchlist.has(u.name) ? ` ⚠️ [REPEAT ×${watchlist.get(u.name)}]` : '';
      lines.push(`- **${u.name}**${repeatNote}`);
    }
    lines.push('');
  }

  if (result.fuzzy.length === 0 && result.unknown.length === 0) {
    const confidenceStr = ` (${Math.round(result.overallConfidence * 100)}% confidence)`;
    lines.push(`All ${result.known.length} symbols confirmed in registry.${confidenceStr}`);
  } else {
    const confidenceStr = `Overall confidence: ${Math.round(result.overallConfidence * 100)}%`;
    lines.push(`Summary: ${result.known.length} known, ${result.fuzzy.length} fuzzy, ${result.unknown.length} unknown | ${confidenceStr}`);

    if (result.overallConfidence < 0.7) {
      lines.push(`⚠️ Low confidence batch — consider running \`refresh_symbols\` to update the registry.`);
    }
  }

  // Surface staleness only when it could explain the result (unknowns present).
  if (staleNote && result.unknown.length > 0) {
    lines.push(staleNote);
  }

  // Optionally include known symbols if verbose
  if (args.verbose && result.known.length > 0) {
    lines.push('');
    lines.push(`### Known Symbols (${result.known.length})`);
    for (const k of result.known) {
      const established = k.established ? ' ✅' : '';
      const multiNote = k.locations && k.locations.length > 1 ? ` [+${k.locations.length - 1} more]` : '';
      lines.push(`- ${k.name} — ${k.category}, ${k.file}:${k.line}${multiNote}${established}`);
    }
  }

  // Record hallucinations for cross-session tracking (non-blocking).
  // check_symbols is not file-scoped (it checks a list of names), so there is
  // no per-symbol file to record — leave it blank rather than mislabeling the
  // event with the project root, which then shows up in the report's "Files".
  try {
    const events = [
      ...result.fuzzy.map((f) => ({ symbol: f.queried, type: 'fuzzy' })),
      ...result.unknown.map((u) => ({ symbol: u.name, type: 'unknown' }))
    ];
    recordHallucinations(wisdomDir, events);
  } catch {
    // Tracking is non-critical — never fail the check due to tracking errors
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}

// Registry is considered stale after this many days since the last scan.
const STALENESS_DAYS = 7;

/**
 * Build a staleness warning from registry _meta, or null if fresh/unknown.
 * Returns a hint to reindex when the registry is older than STALENESS_DAYS.
 */
function registryStalenessNote(meta) {
  const scanned = meta && meta.scanned;
  if (!scanned) return null;
  const scannedMs = Date.parse(scanned);
  if (Number.isNaN(scannedMs)) return null;
  const ageDays = (Date.now() - scannedMs) / (1000 * 60 * 60 * 24);
  if (ageDays < STALENESS_DAYS) return null;
  return `ℹ️ Registry last scanned ${Math.floor(ageDays)} days ago — new symbols may be wrongly flagged as unknown. Run \`refresh_symbols\` to update it.`;
}
