/**
 * get_hallucination_report tool
 *
 * MCP tool that provides a human-readable report of hallucination patterns
 * across sessions. Shows frequently hallucinated symbols, recent events,
 * and summary statistics.
 */

import { findProjectRoot, getWisdomDir } from '../lib/wisdom.js';
import { getHallucinationPatterns } from '../lib/hallucination-tracker.js';

export const hallucinationReportDefinition = {
  name: 'get_hallucination_report',
  description: 'Get a report of hallucination patterns across sessions. Shows frequently flagged symbols (repeat offenders), recent hallucination events, and summary statistics. Useful for end-of-session review or onboarding a new agent to a project.',
  inputSchema: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: 'Project root directory. If omitted, auto-detects from current working directory.'
      }
    }
  }
};

export async function handleHallucinationReport(args) {
  const projectRoot = findProjectRoot(args?.project_path);
  const wisdomDir = getWisdomDir(projectRoot);
  const patterns = getHallucinationPatterns(wisdomDir);

  if (patterns.total === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No hallucination events recorded yet. Events are logged automatically when `check_symbols` detects unknown or fuzzy-matched symbols.'
      }]
    };
  }

  const lines = [];

  lines.push('# Hallucination Report\n');
  lines.push(`Total events recorded: **${patterns.total}**\n`);

  // Frequently hallucinated
  if (patterns.frequent.length > 0) {
    lines.push('## ⚠️ Frequently Hallucinated (3+ occurrences)\n');
    lines.push('| Symbol | Count | Type | Last Seen | Files |');
    lines.push('|--------|-------|------|-----------|-------|');
    for (const entry of patterns.frequent.slice(0, 20)) {
      const lastSeen = entry.lastSeen ? entry.lastSeen.split('T')[0] : 'unknown';
      const files = entry.files.slice(0, 3).join(', ') + (entry.files.length > 3 ? ` +${entry.files.length - 3} more` : '');
      lines.push(`| \`${entry.symbol}\` | ${entry.count} | ${entry.type} | ${lastSeen} | ${files} |`);
    }
    lines.push('');
    lines.push('> These symbols have been flagged multiple times. They are likely common hallucination targets for AI agents in this codebase.');
    lines.push('');
  }

  // Recent
  if (patterns.recent.length > 0) {
    lines.push('## 🕒 Recent Hallucinations\n');
    for (const entry of patterns.recent) {
      const time = entry.timestamp ? entry.timestamp.split('T')[1]?.split('.')[0] || '' : '';
      const date = entry.timestamp ? entry.timestamp.split('T')[0] : '';
      lines.push(`- **${entry.symbol}** (${entry.type}) in \`${entry.file || 'unknown'}\` — ${date} ${time}`);
    }
    lines.push('');
  }

  // By type summary
  if (Object.keys(patterns.byType).length > 0) {
    lines.push('## 📊 Breakdown by Type\n');
    for (const [type, count] of Object.entries(patterns.byType).sort((a, b) => b[1] - a[1])) {
      const icon = type === 'unknown' ? '❌' : type === 'fuzzy' ? '⚠️' : type === 'bad_path' ? '📁' : '🔗';
      lines.push(`- ${icon} **${type}**: ${count} events`);
    }
    lines.push('');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
