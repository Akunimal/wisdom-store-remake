/**
 * JSON output filter strategy
 * Inspired by RTK's Structure Only strategy.
 *
 * Strategy: Extract schema (keys + types) from JSON, strip large values.
 */

/**
 * Extract the structure/schema of a JSON value.
 * Replaces values with type indicators and truncates arrays.
 */
function extractSchema(value, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return '...';

  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.length > 50) return `"${value.substring(0, 30)}..." (${value.length} chars)`;
    return `"${value}"`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // Show first element structure + count
    const firstSchema = extractSchema(value[0], depth + 1, maxDepth);
    if (value.length === 1) return `[${firstSchema}]`;
    return `[${firstSchema}, ... (${value.length} items)]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';

    const entries = keys.slice(0, 10).map(k => {
      const schema = extractSchema(value[k], depth + 1, maxDepth);
      return `${k}: ${schema}`;
    });

    const more = keys.length > 10 ? `, ... +${keys.length - 10} keys` : '';
    return `{ ${entries.join(', ')}${more} }`;
  }

  return typeof value;
}

/**
 * Compress JSON output by extracting its schema/structure.
 */
export function filterJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return { compressed: 'empty', savings: 100 };

  try {
    const parsed = JSON.parse(trimmed);
    const schema = extractSchema(parsed);

    // Format nicely if it's an object
    let compressed;
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      const lines = keys.slice(0, 15).map(k => {
        const val = extractSchema(parsed[k], 1, 2);
        return `  ${k}: ${val}`;
      });
      const more = keys.length > 15 ? `\n  ... +${keys.length - 15} more keys` : '';
      compressed = `{${keys.length} keys}\n${lines.join('\n')}${more}`;
    } else if (Array.isArray(parsed)) {
      compressed = `[${parsed.length} items] first: ${extractSchema(parsed[0], 0, 2)}`;
    } else {
      compressed = schema;
    }

    const savings = Math.round((1 - compressed.length / output.length) * 100);
    return { compressed, savings: Math.max(0, savings) };
  } catch {
    // Not valid JSON — try to detect JSON-like content and truncate
    if (trimmed.length > 500) {
      const truncated = trimmed.substring(0, 400) + `\n... (${trimmed.length} chars total, truncated)`;
      const savings = Math.round((1 - truncated.length / output.length) * 100);
      return { compressed: truncated, savings: Math.max(0, savings) };
    }
    return { compressed: trimmed, savings: 0 };
  }
}

export function filterJson(output, _args) {
  return filterJsonOutput(output);
}
