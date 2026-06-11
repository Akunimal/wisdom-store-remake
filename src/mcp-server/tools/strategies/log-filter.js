/**
 * Log output filter strategy
 * Inspired by RTK's Deduplication strategy.
 *
 * Strategy: Collapse repeated log lines with occurrence counts.
 */

/**
 * Deduplicate log lines by collapsing repeated patterns.
 * Strips timestamps for pattern matching, preserves first occurrence.
 */
export function filterLogOutput(output) {
  const lines = output.split('\n');
  if (!lines.length || !output.trim()) return { compressed: 'no output', savings: 100 };

  // Normalize lines: strip timestamps for grouping
  const timestampRegex = /^\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.Z:+-]*\]?\s*/;
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const unixTsRegex = /^\d{10,13}\s+/;

  const groups = new Map();
  const order = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Strip timestamp for grouping
    let normalized = trimmed
      .replace(timestampRegex, '')
      .replace(isoRegex, '')
      .replace(unixTsRegex, '')
      .trim();

    // Strip UUIDs, hex IDs, IP addresses for better grouping
    normalized = normalized
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>')
      .replace(/\b[0-9a-f]{24,}\b/gi, '<ID>');

    if (!groups.has(normalized)) {
      groups.set(normalized, { count: 0, firstLine: trimmed });
      order.push(normalized);
    }
    groups.get(normalized).count++;
  }

  // Build compressed output
  const result = [];
  let totalCollapsed = 0;

  for (const key of order) {
    const { count, firstLine } = groups.get(key);
    if (count > 1) {
      result.push(`${firstLine} (×${count})`);
      totalCollapsed += count - 1;
    } else {
      result.push(firstLine);
    }
  }

  // Cap output at 30 unique lines
  const shown = result.slice(0, 30);
  if (result.length > 30) {
    shown.push(`... +${result.length - 30} more unique lines`);
  }

  const header = totalCollapsed > 0
    ? `${lines.filter(l => l.trim()).length} lines → ${groups.size} unique (${totalCollapsed} duplicates collapsed)`
    : '';

  const compressed = [header, ...shown].filter(Boolean).join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

export function filterLog(output, _args) {
  return filterLogOutput(output);
}
