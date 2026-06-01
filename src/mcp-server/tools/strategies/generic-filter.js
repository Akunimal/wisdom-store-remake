/**
 * Generic filter strategies
 * Inspired by RTK's Truncation + Progress Filtering strategies.
 *
 * Strategies:
 * - ANSI escape stripping
 * - Progress bar removal
 * - Smart truncation with context preservation
 * - Whitespace normalization
 */

/**
 * Strip ANSI escape codes from output.
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Remove progress bars, spinners, and live-update lines.
 */
export function stripProgress(text) {
  const lines = text.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    // Skip progress bars (sequences of ═, ─, █, ▓, ▒, ░, ■, □, etc.)
    if (trimmed.match(/^[═─█▓▒░■□●○◉◎⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\-|/\\#.>[\]()%\s\d]+$/)) return false;
    // Skip percentage progress lines
    if (trimmed.match(/^\d+%/)) return false;
    // Skip npm/pip download progress
    if (trimmed.match(/^(Downloading|Collecting|Installing|Building|Resolving)/i) && trimmed.includes('...')) return false;
    // Skip lines that are just dots or hashes
    if (trimmed.match(/^[.#]+$/)) return false;
    // Skip carriage return overwrites (live updates)
    if (line.includes('\r') && !line.includes('\r\n')) return false;
    return true;
  });
  return filtered.join('\n');
}

/**
 * Smart truncation: keep the beginning and end of output,
 * preserving the most useful context.
 */
export function smartTruncate(text, maxTokens = 500) {
  const maxChars = maxTokens * 4; // ~4 chars per token
  if (text.length <= maxChars) return { compressed: text, savings: 0 };

  const headSize = Math.floor(maxChars * 0.6); // 60% from start
  const tailSize = Math.floor(maxChars * 0.3); // 30% from end
  // 10% reserved for the truncation notice

  const head = text.substring(0, headSize);
  const tail = text.substring(text.length - tailSize);
  const omittedChars = text.length - headSize - tailSize;
  const omittedTokens = Math.round(omittedChars / 4);

  const compressed = `${head}\n\n... [${omittedChars} chars / ~${omittedTokens} tokens omitted] ...\n\n${tail}`;
  const savings = Math.round((1 - compressed.length / text.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Normalize excessive whitespace and blank lines.
 */
export function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')        // Max 2 consecutive newlines
    .replace(/[ \t]+$/gm, '')          // Trailing whitespace
    .replace(/^[ \t]+$/gm, '')         // Lines of only whitespace
    .trim();
}

/**
 * Full generic filter pipeline:
 * 1. Strip ANSI
 * 2. Strip progress
 * 3. Normalize whitespace
 * 4. Smart truncate if needed
 */
export function filterGeneric(output, maxTokens = 500) {
  let result = stripAnsi(output);
  result = stripProgress(result);
  result = normalizeWhitespace(result);

  const estimatedTokens = Math.ceil(result.length / 4);
  if (estimatedTokens > maxTokens) {
    const truncated = smartTruncate(result, maxTokens);
    return truncated;
  }

  const savings = Math.round((1 - result.length / output.length) * 100);
  return { compressed: result, savings: Math.max(0, savings) };
}
