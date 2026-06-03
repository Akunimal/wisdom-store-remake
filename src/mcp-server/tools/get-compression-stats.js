/**
 * get_compression_stats tool
 *
 * MCP tool that provides session-level compression analytics.
 * Shows how many tokens have been saved, which command categories
 * benefit most, and the top individual savings.
 */

import { getStats } from '../lib/compression-stats.js';

export const compressionStatsDefinition = {
  name: 'get_compression_stats',
  description: 'Get compression analytics for the current session. Shows total tokens saved, breakdown by command category (git, test, lint, etc.), and top individual compression wins. Useful for understanding the value of compress_output.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function handleCompressionStats() {
  const stats = getStats();

  if (stats.totalCommands === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No compression events recorded yet this session. Use `compress_output` to execute commands with token-optimized output.'
      }]
    };
  }

  const lines = [];

  // Session header
  const now = new Date();
  const startTime = new Date(stats.sessionStart);
  const durationMs = now - startTime;
  const durationMin = Math.floor(durationMs / 60000);
  const durationStr = durationMin > 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin}m`;

  lines.push('# Compression Analytics\n');
  lines.push(`Session: ${durationStr} | Commands: **${stats.totalCommands}** | Tokens saved: **${stats.totalTokensSaved.toLocaleString()}** | Average savings: **${stats.averageSavings}%**\n`);

  // Category breakdown
  if (stats.topCategories.length > 0) {
    lines.push('## By Category\n');
    lines.push('| Category | Commands | Tokens Saved | Avg Savings |');
    lines.push('|----------|----------|--------------|-------------|');
    for (const cat of stats.topCategories) {
      lines.push(`| ${cat.category} | ${cat.commands} | ${cat.tokensSaved.toLocaleString()} | ${cat.averageSavings}% |`);
    }
    lines.push('');
  }

  // Top commands
  if (stats.topCommands.length > 0) {
    lines.push('## Top Savings\n');
    for (const cmd of stats.topCommands) {
      lines.push(`- **${cmd.tokensSaved} tokens** saved on \`${cmd.command}\` (${cmd.savingsPercent}%)`);
    }
    lines.push('');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
