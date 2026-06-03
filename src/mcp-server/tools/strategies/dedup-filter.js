/**
 * Line Deduplication Strategy
 * Inspired by RTK's Deduplication strategy.
 *
 * Collapses consecutive identical or similar lines with counters.
 * Extremely effective for build/install output (npm warn, compile messages).
 */

/**
 * Collapse consecutive identical lines into a single line with a counter.
 * Only collapses groups of `threshold` or more lines (default: 3).
 *
 * Example:
 *   "npm warn deprecated module-a"
 *   "npm warn deprecated module-a"
 *   "npm warn deprecated module-a"
 * Becomes:
 *   "npm warn deprecated module-a [×3]"
 */
export function deduplicateLines(text, threshold = 3) {
  if (!text) return { compressed: text || '', duplicatesRemoved: 0 };

  const lines = text.split('\n');
  if (lines.length < threshold) return { compressed: text, duplicatesRemoved: 0 };

  const result = [];
  let duplicatesRemoved = 0;
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    let count = 1;

    // Count consecutive identical lines
    while (i + count < lines.length && lines[i + count] === current) {
      count++;
    }

    if (count >= threshold) {
      result.push(`${current} [×${count}]`);
      duplicatesRemoved += count - 1;
    } else {
      // Push all lines in this group (below threshold)
      for (let j = 0; j < count; j++) {
        result.push(current);
      }
    }

    i += count;
  }

  return {
    compressed: result.join('\n'),
    duplicatesRemoved
  };
}

/**
 * Group consecutive lines that match a common pattern and differ only
 * in a variable part (e.g., module name, file path).
 *
 * Detects lines like:
 *   "npm warn deprecated module-a@1.0.0"
 *   "npm warn deprecated module-b@2.0.0"
 *   "npm warn deprecated module-c@3.0.0"
 * And collapses them into:
 *   "npm warn deprecated: module-a@1.0.0, module-b@2.0.0, module-c@3.0.0 (3 items)"
 *
 * Uses a prefix-matching heuristic: if consecutive lines share the same
 * first N words (N >= 2), they are grouped.
 */
export function groupSimilarLines(text, minGroupSize = 3) {
  if (!text) return { compressed: text || '', groupsCreated: 0 };

  const lines = text.split('\n');
  if (lines.length < minGroupSize) return { compressed: text, groupsCreated: 0 };

  const result = [];
  let groupsCreated = 0;
  let i = 0;

  while (i < lines.length) {
    const currentTrimmed = lines[i].trim();

    // Skip empty lines
    if (!currentTrimmed) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const words = currentTrimmed.split(/\s+/);
    if (words.length < 2) {
      result.push(lines[i]);
      i++;
      continue;
    }

    // Find common prefix with following lines (at least 2 words)
    const prefix = words.slice(0, Math.min(3, words.length - 1)).join(' ');
    const group = [currentTrimmed];
    let j = i + 1;

    while (j < lines.length) {
      const nextTrimmed = lines[j].trim();
      if (nextTrimmed.startsWith(prefix) && nextTrimmed !== currentTrimmed) {
        group.push(nextTrimmed);
        j++;
      } else {
        break;
      }
    }

    if (group.length >= minGroupSize) {
      // Extract the varying parts (everything after the prefix)
      const suffixes = group.map(line => line.substring(prefix.length).trim()).filter(Boolean);
      if (suffixes.length > 0) {
        // Show first 5 suffixes, then count remaining
        const shown = suffixes.slice(0, 5).join(', ');
        const remaining = suffixes.length > 5 ? `, ... +${suffixes.length - 5} more` : '';
        result.push(`${prefix}: ${shown}${remaining} (${group.length} items)`);
      } else {
        result.push(`${currentTrimmed} [×${group.length}]`);
      }
      groupsCreated++;
      i = j;
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return {
    compressed: result.join('\n'),
    groupsCreated
  };
}
