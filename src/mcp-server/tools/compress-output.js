/**
 * compress_output tool
 * Executes a shell command and returns token-optimized output.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { compressOutput } from './token-compressor.js';

const execAsync = promisify(exec);

export const compressOutputDefinition = {
  name: "compress_output",
  description: "Execute a shell command and return compressed output optimized for LLM context windows. Reduces token consumption by 60-90% by applying smart filtering strategies (e.g., stripping noise, summarizing failures, grouping errors).",
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
        description: "Maximum estimated tokens allowed in output before forced truncation",
        default: 500
      }
    },
    required: ["command"]
  }
};

export async function compressOutputHandler(args) {
  const { command, level = 'normal', maxTokens = 500 } = args;

  if (!command) {
    throw new Error('Command is required');
  }

  try {
    // Execute command. We capture both stdout and stderr.
    // Use a large maxBuffer (50MB) to prevent truncation by Node.js before we can filter it.
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 1024 * 1024 * 50 });
    
    // Combine stdout and stderr.
    const rawOutput = stdout + (stderr ? '\n' + stderr : '');
    
    // Pass to compressor engine
    const stats = compressOutput(command, rawOutput, { level, maxTokens });
    
    // Format the response for the LLM
    const header = `[RTK-Engine] Executed: ${command}`;
    const statsLine = `[Savings] Tokens: ${stats.originalTokens} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category}`;
    
    return {
      content: [
        {
          type: "text",
          text: `${header}\n${statsLine}\n\n${stats.output}`
        }
      ]
    };
  } catch (error) {
    // If the command fails, child_process throws an error that contains stdout and stderr.
    // We want to filter failure output too, because compilation/test errors are often huge.
    if (error.stdout || error.stderr) {
      const rawOutput = (error.stdout || '') + '\n' + (error.stderr || '');
      const stats = compressOutput(command, rawOutput, { level, maxTokens });
      
      const header = `[RTK-Engine] Command failed with exit code ${error.code || 1}: ${command}`;
      const statsLine = `[Savings] Tokens: ${Math.ceil(rawOutput.length/4)} → ${stats.compressedTokens} (-${stats.savingsPercent}%) | Filter: ${stats.category} (error mode)`;
      
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
