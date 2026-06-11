/**
 * Git output filter strategies
 * Inspired by RTK's stats extraction approach for git commands.
 * Licensed under MIT (Anti-Hallucination-MCP project license).
 *
 * Strategies implemented:
 * - git status: Compact summary (staged/modified/untracked counts)
 * - git diff: Stats-only summary with file changes
 * - git log: One-line format with commit count
 * - git push/pull/commit: Single-line confirmation
 */

/**
 * Compress git status output into a compact summary.
 * Reduces ~2000 tokens to ~50-100 tokens.
 */
export function filterGitStatus(output) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: 'clean working tree', savings: 100 };

  const staged = [];
  const modified = [];
  const untracked = [];
  const conflicts = [];
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('On branch')) continue;
    if (trimmed.startsWith('Your branch')) continue;
    if (trimmed.startsWith('Changes to be committed')) { currentSection = 'staged'; continue; }
    if (trimmed.startsWith('Changes not staged')) { currentSection = 'modified'; continue; }
    if (trimmed.startsWith('Untracked files')) { currentSection = 'untracked'; continue; }
    if (trimmed.startsWith('Unmerged paths')) { currentSection = 'conflicts'; continue; }
    if (trimmed.startsWith('(use ')) continue;
    if (trimmed === '') continue;

    // Extract file info
    const fileMatch = trimmed.match(/^(new file|modified|deleted|renamed|both modified|both added):\s+(.+)/);
    if (fileMatch) {
      const [, action, file] = fileMatch;
      const entry = `${action}: ${file}`;
      if (currentSection === 'staged') staged.push(entry);
      else if (currentSection === 'modified') modified.push(entry);
      else if (currentSection === 'conflicts') conflicts.push(entry);
    } else if (currentSection === 'untracked') {
      untracked.push(trimmed);
    }
  }

  const parts = [];
  if (conflicts.length) parts.push(`⚠️ CONFLICTS (${conflicts.length}): ${conflicts.join(', ')}`);
  if (staged.length) parts.push(`staged (${staged.length}): ${staged.join(', ')}`);
  if (modified.length) parts.push(`modified (${modified.length}): ${modified.join(', ')}`);
  if (untracked.length) {
    const shown = untracked.slice(0, 5);
    const more = untracked.length > 5 ? ` +${untracked.length - 5} more` : '';
    parts.push(`untracked (${untracked.length}): ${shown.join(', ')}${more}`);
  }

  if (!parts.length) {
    return { compressed: 'clean working tree', savings: 100 };
  }

  const compressed = parts.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Compress git diff output while preserving fidelity.
 * RTK philosophy: strip noise (index lines), but keep the actual diff content.
 * If args indicate a summary format (--stat, --name-only), pass through.
 */
export function filterGitDiff(output, args = []) {
  if (!output.trim()) return { compressed: 'no changes', savings: 100 };

  const isSummary = args.some(a => 
    a === '--stat' || a === '--shortstat' || a === '--numstat' || 
    a === '--name-only' || a === '--name-status' || a === '--summary'
  );

  if (isSummary) {
    // Already a summarized format, just pass through
    return { compressed: output.trim(), savings: 0 };
  }

  // Normal diff: nearly lossless. We only strip useless metadata like index hashes
  const lines = output.split('\n');
  const kept = [];
  
  for (const line of lines) {
    // Skip noisy git index hashes that AIs don't need: 'index 85057a5..3c73eac 100644'
    if (line.startsWith('index ') && line.match(/^index [a-f0-9]+\.\.[a-f0-9]+/)) {
      continue;
    }
    kept.push(line);
  }

  const compressed = kept.join('\n').trim();
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Compress git log output into compact one-line-per-commit format.
 */
export function filterGitLog(output) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: 'no commits', savings: 100 };

  // If already in oneline format, just count and truncate
  const commits = [];
  let i = 0;
  while (i < lines.length) {
    const commitMatch = lines[i].match(/^commit\s+([a-f0-9]+)/);
    if (commitMatch) {
      const hash = commitMatch[1].substring(0, 7);
      let message = '';
      i++;
      while (i < lines.length && !lines[i].match(/^commit\s+[a-f0-9]+/)) {
        const line = lines[i].trim();
        // Author/Date lines are dropped — only hash + message survive compression
        if (line.startsWith('Author:') || line.startsWith('Date:')) { /* skip */ }
        else if (line && !message) message = line;
        i++;
      }
      commits.push(`${hash} ${message}`);
    } else {
      // Already oneline format: hash message
      const onelineMatch = lines[i].match(/^([a-f0-9]{7,})\s+(.+)/);
      if (onelineMatch) {
        commits.push(`${onelineMatch[1].substring(0, 7)} ${onelineMatch[2]}`);
      }
      i++;
    }
  }

  const shown = commits.slice(0, 20);
  const more = commits.length > 20 ? `\n... +${commits.length - 20} more commits` : '';
  const compressed = `${commits.length} commits\n${shown.join('\n')}${more}`;
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Compress git push/pull/commit output to a single confirmation line.
 */
export function filterGitAction(output, subcommand) {
  const lines = output.split('\n').filter(l => l.trim());
  if (!lines.length) return { compressed: `ok`, savings: 100 };

  if (subcommand === 'push') {
    const branchMatch = output.match(/(\S+)\s*->\s*(\S+)/);
    const branch = branchMatch ? branchMatch[2] : 'unknown';
    return { compressed: `ok ${branch}`, savings: Math.round((1 - 10 / output.length) * 100) };
  }

  if (subcommand === 'pull') {
    const fileChanges = output.match(/(\d+)\s+files?\s+changed/);
    const insertions = output.match(/(\d+)\s+insertions?/);
    const deletions = output.match(/(\d+)\s+deletions?/);
    const stats = [];
    if (fileChanges) stats.push(`${fileChanges[1]} files`);
    if (insertions) stats.push(`+${insertions[1]}`);
    if (deletions) stats.push(`-${deletions[1]}`);
    const compressed = stats.length ? `ok ${stats.join(' ')}` : 'ok (up to date)';
    return { compressed, savings: Math.round((1 - compressed.length / output.length) * 100) };
  }

  if (subcommand === 'commit') {
    const hashMatch = output.match(/\[[\w/]+\s+([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : '';
    return { compressed: `ok ${hash}`, savings: Math.round((1 - 10 / output.length) * 100) };
  }

  if (subcommand === 'add') {
    return { compressed: 'ok', savings: 100 };
  }

  // Fallback: first meaningful line
  const firstLine = lines.find(l => !l.startsWith('warning:') && !l.startsWith('hint:')) || lines[0];
  return { compressed: firstLine, savings: Math.round((1 - firstLine.length / output.length) * 100) };
}

/**
 * Route git output to the appropriate filter.
 */
export function filterGit(output, args) {
  const subcommand = (args[0] || '').toLowerCase();
  switch (subcommand) {
    case 'status': return filterGitStatus(output);
    case 'diff': return filterGitDiff(output, args);
    case 'log': return filterGitLog(output);
    case 'push':
    case 'pull':
    case 'commit':
    case 'add':
      return filterGitAction(output, subcommand);
    default:
      return null; // No specific filter, use generic
  }
}
