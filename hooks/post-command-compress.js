#!/usr/bin/env node

/**
 * RTK-inspired Post-Command Hook for Claude Code
 * This script intercepts command outputs and compresses them
 * before they reach the LLM context window.
 */

import { compressOutput } from '../src/mcp-server/tools/token-compressor.js';
import { runShellCommand } from '../src/mcp-server/lib/process-runner.js';

// The hook script takes the command as arguments
const command = process.argv.slice(2).join(' ');

if (!command) {
  console.error("Usage: node post-command-compress.js <command>");
  process.exit(1);
}

// Allow override via env; default 2 minutes so interactive or never-ending
// commands (credential prompts, watch mode) cannot freeze the hook forever.
const TIMEOUT_MS = parseInt(process.env.RTK_COMMAND_TIMEOUT_MS, 10) || 120000;

const result = await runShellCommand(command, {
  maxBuffer: 1024 * 1024 * 50,
  timeoutMs: TIMEOUT_MS
});

if (result.timedOut) {
  console.error(`[RTK-Engine] Command timed out after ${TIMEOUT_MS}ms and was killed: ${command}`);
  process.exit(124);
}

if (result.maxBufferExceeded) {
  console.error(`[RTK-Engine] Command output exceeded the 50MB safety limit and was killed: ${command}`);
  process.exit(1);
}

// Could not even start the command.
if (result.error && result.status === null) {
  console.error(`Failed to execute: ${result.error}`);
  process.exit(1);
}

// Combine stdout + stderr so success-path warnings survive compression.
const rawOutput = (result.stdout || '') + (result.stderr ? '\n' + result.stderr : '');
const stats = compressOutput(command, rawOutput);

// Print the compressed output to stdout
console.log(stats.output);

// Print savings stats to stderr (so it doesn't pollute the command output if piped)
const exitCode = result.status || 0;
const mode = exitCode !== 0 ? ' (error mode)' : '';
console.error(`\n[RTK-Engine Savings] Tokens: ${stats.originalTokens} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category}${mode}`);

process.exit(exitCode);
