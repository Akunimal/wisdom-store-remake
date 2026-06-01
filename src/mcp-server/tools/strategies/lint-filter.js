/**
 * Lint/compiler output filter strategies
 * Inspired by RTK's Grouping by Pattern strategy.
 *
 * Supports: tsc, eslint, ruff, clippy, biome
 * Strategy: Group errors by rule/code, count occurrences.
 */

/**
 * Group lint/compiler errors by rule or error code.
 */
export function filterLintOutput(output) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: 'no errors', savings: 100 };

  const errorsByRule = new Map();
  const errorsByFile = new Map();
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // TSC format: file.ts(line,col): error TS2345: message
    const tscMatch = trimmed.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/);
    if (tscMatch) {
      const [, file, , , severity, code, message] = tscMatch;
      const key = `${code}: ${message}`;
      if (!errorsByRule.has(key)) errorsByRule.set(key, { count: 0, files: new Set() });
      errorsByRule.get(key).count++;
      errorsByRule.get(key).files.add(file);
      if (severity === 'error') totalErrors++;
      else totalWarnings++;
      continue;
    }

    // ESLint format: file.js:line:col: message (rule-name)
    const eslintMatch = trimmed.match(/^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+?)\s+(\S+)$/);
    if (eslintMatch) {
      const [, file, , , severity, message, rule] = eslintMatch;
      const key = `${rule}: ${message}`;
      if (!errorsByRule.has(key)) errorsByRule.set(key, { count: 0, files: new Set() });
      errorsByRule.get(key).count++;
      errorsByRule.get(key).files.add(file);
      if (severity === 'error') totalErrors++;
      else totalWarnings++;
      continue;
    }

    // Ruff/generic format: file.py:line:col: CODE message
    const ruffMatch = trimmed.match(/^(.+?):(\d+):(\d+):\s*([A-Z]\d+)\s+(.+)/);
    if (ruffMatch) {
      const [, file, , , code, message] = ruffMatch;
      const key = `${code}: ${message}`;
      if (!errorsByRule.has(key)) errorsByRule.set(key, { count: 0, files: new Set() });
      errorsByRule.get(key).count++;
      errorsByRule.get(key).files.add(file);
      totalErrors++;
      continue;
    }

    // Clippy format: warning: message --> file.rs:line:col
    const clippyMatch = trimmed.match(/^(warning|error)(?:\[(.+?)\])?:\s*(.+)/);
    if (clippyMatch) {
      const [, severity, code, message] = clippyMatch;
      const key = code ? `${code}: ${message}` : message;
      if (!errorsByRule.has(key)) errorsByRule.set(key, { count: 0, files: new Set() });
      errorsByRule.get(key).count++;
      if (severity === 'error') totalErrors++;
      else totalWarnings++;
      continue;
    }

    // Generic error/warning line
    const genericMatch = trimmed.match(/^(error|warning|Error|Warning):\s*(.+)/i);
    if (genericMatch) {
      const [, severity, message] = genericMatch;
      const key = message.substring(0, 80);
      if (!errorsByRule.has(key)) errorsByRule.set(key, { count: 0, files: new Set() });
      errorsByRule.get(key).count++;
      if (severity.toLowerCase() === 'error') totalErrors++;
      else totalWarnings++;
    }
  }

  if (!errorsByRule.size) {
    // No structured errors found — truncate raw output
    const truncated = lines.slice(0, 15).join('\n');
    const more = lines.length > 15 ? `\n... +${lines.length - 15} more lines` : '';
    const compressed = truncated + more;
    const savings = Math.round((1 - compressed.length / output.length) * 100);
    return { compressed, savings: Math.max(0, savings) };
  }

  // Sort by count descending
  const sorted = [...errorsByRule.entries()].sort((a, b) => b[1].count - a[1].count);

  const parts = [];
  parts.push(`${totalErrors} errors, ${totalWarnings} warnings (${errorsByRule.size} unique rules)`);
  parts.push('');

  // Show top 10 rules
  const shown = sorted.slice(0, 10);
  for (const [rule, info] of shown) {
    const fileCount = info.files.size;
    const fileInfo = fileCount > 0 ? ` in ${fileCount} file${fileCount > 1 ? 's' : ''}` : '';
    parts.push(`  ${rule} (×${info.count}${fileInfo})`);
  }
  if (sorted.length > 10) {
    parts.push(`  ... +${sorted.length - 10} more rules`);
  }

  const compressed = parts.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Route lint command output to filter.
 */
export function filterLint(output, args) {
  return filterLintOutput(output);
}
