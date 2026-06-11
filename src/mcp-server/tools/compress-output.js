/**
 * compress_output tool
 * Executes a shell command and returns token-optimized output.
 *
 * v0.8.0: Added secret redaction (default on), fail-open mechanism,
 * and threshold-based compression passthrough.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { compressOutput } from './token-compressor.js';

const execAsync = promisify(exec);

export const compressOutputDefinition = {
  name: "compress_output",
  description: "PREFER this over native shell execution for: git, npm, cargo, pip, make, tsc, eslint, and any command with verbose output. Executes a shell command and returns compressed output optimized for LLM context windows. Saves 60-90% of tokens by stripping noise, summarizing failures, and grouping errors. Automatically redacts API keys, tokens, and passwords. Same as running a command locally but with intelligent output compression.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute and compress"
      },
      level: {
        type: "string",
        enum: ["minimal", "normal", "aggressive"],
        description: "Filtering level. Minimal keeps comments/bodies. Aggressive strips aggressively.",
        default: "normal"
      },
      maxTokens: {
        type: "number",
        description: "Soft cap on estimated tokens, applied to generic/unknown command output. Domain filters (git diff, tests, lint) preserve fidelity and self-truncate noise with domain knowledge instead of hard-cutting at this limit.",
        default: 500
      },
      redact: {
        type: "boolean",
        description: "Redact API keys, tokens, and passwords from output. Default: true.",
        default: true
      },
      timeoutMs: {
        type: "number",
        description: "Maximum milliseconds the command may run before being killed. Default: 120000 (2 minutes). Prevents interactive or long-running commands (watch mode, servers, credential prompts) from hanging the tool call forever.",
        default: 120000
      }
    },
    required: ["command"]
  }
};

export async function compressOutputHandler(args) {
  const { command, level = 'normal', maxTokens = 500, redact = true, timeoutMs = 120000 } = args;

  if (!command) {
    throw new Error('Command is required');
  }

  try {
    // Execute command. We capture both stdout and stderr.
    // Use a large maxBuffer (50MB) to prevent truncation by Node.js before we can filter it.
    // Timeout prevents interactive/never-ending commands from hanging the MCP call forever.
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    });
    
    // Combine stdout and stderr.
    const rawOutput = stdout + (stderr ? '\n' + stderr : '');
    
    // Pass to compressor engine — wrapped in fail-open
    let stats;
    try {
      stats = compressOutput(command, rawOutput, { level, maxTokens, redact });
    } catch (compressionError) {
      // Fail-open: if compression itself fails, return raw output
      console.error(`[RTK-Engine] Compression failed for "${command}":`, compressionError.message);
      const rawTokens = Math.ceil(rawOutput.length / 4);
      return {
        content: [{
          type: "text",
          text: `[RTK-Engine] Compression bypassed (internal error): ${command}\n[Passthrough] Tokens: ${rawTokens}\n\n${rawOutput}`
        }]
      };
    }
    
    // Format the response for the LLM
    let header, statsLine;

    if (stats.skipped) {
      header = `[RTK-Engine] Passthrough (savings <${stats.reason === 'below_threshold' ? '10%' : 'threshold'}): ${command}`;
      statsLine = `[Passthrough] Tokens: ${stats.originalTokens} | Filter: ${stats.category}`;
    } else {
      header = `[RTK-Engine] Executed: ${command}`;
      statsLine = `[Savings] Tokens: ${stats.originalTokens} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category}`;
    }

    if (stats.redactedCount > 0) {
      statsLine += ` | Redacted: ${stats.redactedCount} secret(s)`;
    }
    
    return {
      content: [
        {
          type: "text",
          text: `${header}\n${statsLine}\n\n${stats.output}`
        }
      ]
    };
  } catch (error) {
    // Timed out (interactive prompt, watch mode, server, etc.) — report clearly
    // instead of surfacing a generic kill error. Partial output is included.
    if (error.killed) {
      const partial = ((error.stdout || '') + (error.stderr ? '\n' + error.stderr : '')).slice(-4000);
      return {
        content: [{
          type: "text",
          text: `[RTK-Engine] Command timed out after ${timeoutMs}ms and was killed: ${command}\nLikely interactive or long-running (credential prompt, watch mode, dev server). Increase timeoutMs or run it differently.${partial.trim() ? `\n\nPartial output (tail):\n${partial}` : ''}`
        }],
        isError: true
      };
    }

    // If the command fails, child_process throws an error that contains stdout and stderr.
    // We want to filter failure output too, because compilation/test errors are often huge.
    if (error.stdout || error.stderr) {
      const rawOutput = (error.stdout || '') + '\n' + (error.stderr || '');

      // Fail-open for compression of error output too
      let stats;
      try {
        stats = compressOutput(command, rawOutput, { level, maxTokens, redact });
      } catch (compressionError) {
        console.error(`[RTK-Engine] Compression failed for error output of "${command}":`, compressionError.message);
        return {
          content: [{
            type: "text",
            text: `[RTK-Engine] Command failed (compression bypassed): ${command}\n\n${rawOutput}`
          }],
          isError: true
        };
      }
      
      const header = `[RTK-Engine] Command failed with exit code ${error.code || 1}: ${command}`;
      let statsLine = `[Savings] Tokens: ${Math.ceil(rawOutput.length/4)} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category} (error mode)`;
      
      if (stats.redactedCount > 0) {
        statsLine += ` | Redacted: ${stats.redactedCount} secret(s)`;
      }
      
      return {
        content: [
          {
            type: "text",
            text: `${header}\n${statsLine}\n\n${stats.output}`
          }
        ],
        isError: true
      };
    }

    // Generic execution failure (e.g., command not found)
    return {
      content: [
        {
          type: "text",
          text: `[RTK-Engine] Failed to execute command: ${error.message}`
        }
      ],
      isError: true
    };
  }
}
