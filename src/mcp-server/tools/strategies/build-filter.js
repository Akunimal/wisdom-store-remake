/**
 * Build-tool output filter.
 *
 * Covers docker build, webpack/vite/esbuild/rollup, gradle/maven, dotnet,
 * make/cmake, bazel, turbo/nx, terraform, prisma — verbose build logs whose
 * signal is a handful of errors/warnings buried in progress noise.
 *
 * Strategy: keep errors and warnings (deduped), drop progress; on a clean
 * build, keep only the last few status lines.
 */

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!seen.has(item)) { seen.add(item); out.push(item); }
  }
  return out;
}

export function filterBuildOutput(output) {
  if (!output.trim()) return { compressed: 'no output', savings: 100 };

  const lines = output.split('\n');
  const errors = [];
  const warnings = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/(^|\s)(?:error|ERROR|FAILED|Build FAILED|error\[)\b/.test(line) || /\berror\s*:/i.test(line) || /^[✖×✗]/.test(line)) {
      errors.push(line);
    } else if (/(^|\s)(?:warning|WARN(?:ING)?)\b/i.test(line) || /\bwarning\s*:/i.test(line)) {
      warnings.push(line);
    }
  }

  const parts = [];
  if (errors.length) {
    const u = uniq(errors);
    parts.push(`${errors.length} error line(s)${u.length < errors.length ? ` (${u.length} unique)` : ''}:`);
    parts.push(...u.slice(0, 12));
    if (u.length > 12) parts.push(`... +${u.length - 12} more unique errors`);
  }
  if (warnings.length) {
    const u = uniq(warnings);
    parts.push(`${warnings.length} warning line(s)${u.length < warnings.length ? ` (${u.length} unique)` : ''}:`);
    parts.push(...u.slice(0, 6));
    if (u.length > 6) parts.push(`... +${u.length - 6} more unique warnings`);
  }
  if (!errors.length && !warnings.length) {
    // Clean build — keep the last few meaningful lines as the result.
    const tail = lines.map((l) => l.trim()).filter(Boolean).slice(-4);
    parts.push(...tail);
  }

  const compressed = parts.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

export function filterBuild(output, _args) {
  return filterBuildOutput(output);
}
