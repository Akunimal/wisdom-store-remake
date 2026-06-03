/**
 * Compression Statistics Tracker (Singleton)
 *
 * In-memory analytics for the Token Compressor Engine.
 * Tracks per-session stats: commands executed, tokens saved, category breakdown.
 *
 * Data is lost on server restart (by design — zero disk I/O overhead).
 */

const sessionStart = new Date().toISOString();

let totalCommands = 0;
let totalTokensSaved = 0;
let totalOriginalTokens = 0;
const categoryStats = {};
const commandHistory = [];
const MAX_HISTORY = 100;

/**
 * Record a compression event.
 * @param {string} command - The command that was compressed
 * @param {string} category - The detected category (git, test, lint, etc.)
 * @param {number} originalTokens - Token count before compression
 * @param {number} compressedTokens - Token count after compression
 * @param {number} savingsPercent - Savings as a percentage
 */
export function recordCompression(command, category, originalTokens, compressedTokens, savingsPercent) {
  totalCommands++;
  const tokensSaved = Math.max(0, originalTokens - compressedTokens);
  totalTokensSaved += tokensSaved;
  totalOriginalTokens += originalTokens;

  // Category breakdown
  if (!categoryStats[category]) {
    categoryStats[category] = { commands: 0, tokensSaved: 0, totalOriginal: 0 };
  }
  categoryStats[category].commands++;
  categoryStats[category].tokensSaved += tokensSaved;
  categoryStats[category].totalOriginal += originalTokens;

  // Command history (capped)
  commandHistory.push({
    command: command.length > 80 ? command.substring(0, 77) + '...' : command,
    category,
    tokensSaved,
    savingsPercent,
    timestamp: new Date().toISOString()
  });
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory.shift();
  }
}

/**
 * Get aggregated compression statistics.
 * @returns {Object} Stats object with totals, category breakdown, and top commands
 */
export function getStats() {
  const averageSavings = totalCommands > 0
    ? Math.round((totalTokensSaved / Math.max(1, totalOriginalTokens)) * 100)
    : 0;

  // Top categories by tokens saved
  const topCategories = Object.entries(categoryStats)
    .map(([name, stats]) => ({
      category: name,
      commands: stats.commands,
      tokensSaved: stats.tokensSaved,
      averageSavings: stats.totalOriginal > 0
        ? Math.round((stats.tokensSaved / stats.totalOriginal) * 100)
        : 0
    }))
    .sort((a, b) => b.tokensSaved - a.tokensSaved);

  // Top 5 commands by tokens saved
  const topCommands = [...commandHistory]
    .sort((a, b) => b.tokensSaved - a.tokensSaved)
    .slice(0, 5);

  return {
    sessionStart,
    totalCommands,
    totalTokensSaved,
    totalOriginalTokens,
    averageSavings,
    topCategories,
    topCommands
  };
}

/**
 * Reset all stats (for testing).
 */
export function resetStats() {
  totalCommands = 0;
  totalTokensSaved = 0;
  totalOriginalTokens = 0;
  for (const key of Object.keys(categoryStats)) delete categoryStats[key];
  commandHistory.length = 0;
}
