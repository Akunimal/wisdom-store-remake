#!/usr/bin/env node

/**
 * RTK-inspired Post-Command Hook for Claude Code
 * This script intercepts command outputs and compresses them
 * before they reach the LLM context window.
 */

import { execSync } from 'child_process';
import { compressOutput } from '../src/mcp-server/tools/token-compressor.js';

// The hook script takes the command as arguments
const command = process.argv.slice(2).join(' ');

if (!command) {
  console.error("Usage: node post-command-compress.js <command>");
  process.exit(1);
}

// Allow override via env; default 2 minutes so interactive or never-ending
// commands (credential prompts, watch mode) cannot freeze the hook forever.
const TIMEOUT_MS = parseInt(process.env.RTK_COMMAND_TIMEOUT_MS, 10) || 120000;

try {
  // Execute the command synchronously
  const stdout = execSync(command, {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 50,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });
  
  // Compress the output
  const stats = compressOutput(command, stdout);
  
  // Print the compressed output to stdout
  console.log(stats.output);
  
  // Print savings stats to stderr (so it doesn't pollute the command output if piped)
  console.error(`\n[RTK-Engine Savings] Tokens: ${stats.originalTokens} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category}`);
  
} catch (error) {
  // Timed out — say so explicitly instead of dumping a generic kill error.
  // execSync surfaces timeouts as ETIMEDOUT (sometimes with killed/SIGKILL set).
  if (error.killed || error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT' || error.signal === 'SIGKILL') {
    console.error(`[RTK-Engine] Command timed out after ${TIMEOUT_MS}ms and was killed: ${command}`);
    process.exit(124);
  }

  // If the command fails, we still want to compress the error output
  if (error.stdout || error.stderr) {
    const rawOutput = (error.stdout || '') + '\n' + (error.stderr || '');
    const stats = compressOutput(command, rawOutput);
    
    console.log(stats.output);
    console.error(`\n[RTK-Engine Savings] Tokens: ${Math.ceil(rawOutput.length/4)} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category} (error mode)`);
  } else {
    console.error(`Failed to execute: ${error.message}`);
  }
  process.exit(error.status || 1);
}
