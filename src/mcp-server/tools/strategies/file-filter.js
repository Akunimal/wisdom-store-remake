/**
 * File/directory listing filter strategies
 * Inspired by RTK's Tree Compression + Code Filtering strategies.
 *
 * Supports: ls, dir, cat, tree, find
 * Strategies:
 * - Tree Compression: hierarchy with counts instead of flat lists
 * - Code Filtering: strip comments, boilerplate from file reads
 */

/**
 * Compress directory listing into a tree with file counts.
 */
export function filterDirListing(output) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: 'empty directory', savings: 100 };

  // Group files by directory
  const dirs = new Map();
  const rootFiles = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header/footer lines from ls -la
    if (trimmed.startsWith('total ')) continue;
    if (trimmed.startsWith('d') || trimmed.startsWith('-') || trimmed.startsWith('l')) {
      // ls -la format: permissions ... filename
      const parts = trimmed.split(/\s+/);
      const name = parts.slice(8).join(' ') || parts[parts.length - 1];
      if (name === '.' || name === '..') continue;
      if (trimmed.startsWith('d')) {
        if (!dirs.has(name)) dirs.set(name, 0);
      } else {
        rootFiles.push(name);
      }
    } else if (trimmed.includes('/') || trimmed.includes('\\')) {
      // find output or path-like
      const sep = trimmed.includes('/') ? '/' : '\\';
      const parts = trimmed.split(sep);
      if (parts.length > 1) {
        const dir = parts[0];
        if (!dirs.has(dir)) dirs.set(dir, 0);
        dirs.set(dir, dirs.get(dir) + 1);
      } else {
        rootFiles.push(trimmed);
      }
    } else {
      // Simple filename
      rootFiles.push(trimmed);
    }
  }

  const result = [];
  // Directories first
  for (const [dir, count] of [...dirs.entries()].sort()) {
    result.push(`📁 ${dir}/${count > 0 ? ` (${count} files)` : ''}`);
  }
  // Then files (capped at 20)
  const shownFiles = rootFiles.slice(0, 20);
  for (const file of shownFiles) {
    result.push(`  ${file}`);
  }
  if (rootFiles.length > 20) {
    result.push(`  ... +${rootFiles.length - 20} more files`);
  }

  const summary = `${dirs.size} dirs, ${rootFiles.length} files`;
  const compressed = `${summary}\n${result.join('\n')}`;
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Compress tree command output by collapsing deep structures.
 */
export function filterTreeOutput(output) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: 'empty tree', savings: 100 };

  // Keep only first 3 levels of depth
  const maxDepth = 3;
  const filtered = [];
  let collapsed = 0;

  for (const line of lines) {
    // Estimate depth by counting leading tree chars
    const leadingChars = line.match(/^[\s│├└─┬┤]+/);
    const depth = leadingChars ? Math.floor(leadingChars[0].length / 4) : 0;

    if (depth <= maxDepth) {
      filtered.push(line);
    } else {
      collapsed++;
    }
  }

  if (collapsed > 0) {
    filtered.push(`... ${collapsed} deeper entries collapsed`);
  }

  const compressed = filtered.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Compress file content by stripping comments and blank lines.
 * Levels: minimal (comments only), aggressive (comments + function bodies).
 */
export function filterFileContent(output, level = 'minimal') {
  const lines = output.split('\n');
  if (!lines.length) return { compressed: '', savings: 100 };

  const filtered = [];
  let inBlockComment = false;
  let braceDepth = 0;
  let skippingBody = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Block comment tracking
    if (trimmed.includes('/*') && !trimmed.includes('*/')) {
      inBlockComment = true;
      continue;
    }
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }

    // Single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
      continue;
    }

    // Skip blank lines
    if (!trimmed) continue;

    // Aggressive mode: skip function bodies (keep signatures only)
    if (level === 'aggressive') {
      if (trimmed.match(/^(function|def|fn|func|pub fn|async fn|export function|export async function|const \w+ = (?:async )?\()/)) {
        filtered.push(line);
        if (trimmed.includes('{')) {
          skippingBody = true;
          braceDepth = 1;
        }
        continue;
      }

      if (skippingBody) {
        for (const ch of trimmed) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        if (braceDepth <= 0) {
          skippingBody = false;
          braceDepth = 0;
        }
        continue;
      }
    }

    filtered.push(line);
  }

  const compressed = filtered.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Route file command output to the appropriate filter.
 */
export function filterFile(output, args, command) {
  if (command === 'tree') return filterTreeOutput(output);
  if (command === 'cat' || command === 'type') return filterFileContent(output, 'minimal');
  return filterDirListing(output);
}
