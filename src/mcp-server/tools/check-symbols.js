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
  readSymbols
} from '../lib/indexer.js';

import {
  recordHallucination,
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
  const registry = readSymbols(wisdomDir);

  if (!registry) {
    return {
      content: [{ type: 'text', text: 'No symbol registry found. Run `reindex_project` first.' }],
      isError: true
    };
  }

  // Strip _meta before checking
  const { _meta, ...symbolCategories } = registry;
  const result = checkSymbols(args.symbols, symbolCategories);

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

  // Record hallucinations for cross-session tracking (non-blocking)
  try {
    for (const f of result.fuzzy) {
      recordHallucination(wisdomDir, f.queried, args.project_path || '', 'fuzzy');
    }
    for (const u of result.unknown) {
      recordHallucination(wisdomDir, u.name, args.project_path || '', 'unknown');
    }
  } catch {
    // Tracking is non-critical — never fail the check due to tracking errors
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
