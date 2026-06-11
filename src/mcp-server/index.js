#!/usr/bin/env node
/**
 * Wisdom Store MCP Server — Lite (Anti-Hallucination Core)
 *
 * Minimal server providing only the essential anti-hallucination tools:
 * - reindex_project: Scan project and build symbol registry
 * - get_project_overview: Compact project map with file structure and symbols
 * - check_symbols: Cross-reference symbols against registry (catch hallucinations)
 * - refresh_symbols: Re-scan and update symbol registry
 *
 * Everything else has been removed as it overlaps with Serena MCP or GSD Skills.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root (no dotenv dependency needed)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

// Core anti-hallucination tools + environment detection
import { handleReindexProject } from './tools/reindex-project.js';
import { handleGetProjectOverview } from './tools/get-project-overview.js';
import { handleCheckSymbols } from './tools/check-symbols.js';
import { handleRefreshSymbols } from './tools/refresh-symbols.js';
import { handleDetectEnvironment } from './tools/detect-environment.js';
import { compressOutputDefinition, compressOutputHandler } from './tools/compress-output.js';
import { hallucinationReportDefinition, handleHallucinationReport } from './tools/get-hallucination-report.js';
import { compressionStatsDefinition, handleCompressionStats } from './tools/get-compression-stats.js';

function parseDisabledTools(value) {
  if (!value) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(String));
    }
  } catch {}

  return new Set(
    value
      .split(/[,\s]+/)
      .map((tool) => tool.trim())
      .filter(Boolean)
  );
}

const server = new Server(
  { name: 'wisdom-store', version: '0.10.2' },
  { capabilities: { tools: {} } }
);

// Tool definitions - Core anti-hallucination + environment detection
const TOOLS = [
  {
    name: 'detect_environment',
    description: 'Detects the local command environment and returns shell-safe guidance. On Windows it distinguishes PowerShell, plain bash, WSL default distro/toolchain, Git Bash, native node/npm/git, path conventions, and quoting rules. Run at session start or before commands that may differ between PowerShell, Git Bash, and WSL.',
    inputSchema: {
      type: 'object',
      properties: {
        compact: {
          type: 'boolean',
          description: 'Defaults to false (full JSON diagnostic). Set to true to get a compact text summary (~250 tokens) if you only need the key rules and recommendations.',
          default: false
        }
      },
      required: []
    }
  },
  {
    name: 'reindex_project',
    description: 'Scan the project and build a symbol registry. Extracts functions, classes, variables, exports, and API routes from all code files. Creates .wisdom/symbols.json. Run this after major refactors or when check_symbols reports unknown symbols that should exist.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Project root directory. If omitted, auto-detects from current working directory.'
        },
        max_depth: {
          type: 'integer',
          description: 'Maximum directory depth to scan. Default: 8.'
        },
        max_files: {
          type: 'integer',
          description: 'Maximum number of files to scan. Default: 2000.'
        },
        force: {
          type: 'boolean',
          description: 'If true, bypass the incremental scan cache and reparse every file. Default: false.'
        }
      }
    }
  },
  {
    name: 'get_project_overview',
    description: 'Returns a compact map of the project (file tree, API routes, HTML pages). Pass maxFiles to control truncation. detail="full" includes a list of classes and exports, but can consume many tokens. Run this early when exploring a new repository.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Optional path to scan. Defaults to current directory.'
        },
        maxFiles: {
          type: 'integer',
          description: 'Maximum number of files to show in the directory tree before truncating (default: 100).',
          default: 100
        },
        detail: {
          type: 'string',
          description: 'Level of detail: "summary" (default, omits class/export lists) or "full".',
          enum: ['summary', 'full'],
          default: 'summary'
        }
      },
      required: []
    }
  },
  {
    name: 'check_symbols',
    description: 'Anti-hallucination check: verify that symbol names (functions, classes, variables) exist in the project registry. Provide an array of symbol names; returns which are known, which might be typos (with suggestions), and which are unknown (could be hallucinated or new). Essential before committing code changes.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of symbol names to check against the registry.'
        },
        project_path: {
          type: 'string',
          description: 'Project root directory. If omitted, auto-detects from current working directory.'
        },
        verbose: {
          type: 'boolean',
          description: 'If true, include full list of known symbols. Default: false.'
        }
      },
      required: ['symbols']
    }
  },
  {
    name: 'refresh_symbols',
    description: 'Re-scan the project and update the symbol registry. Thin wrapper around reindex_project — use when you know the codebase has changed and need the registry updated before running check_symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Project root directory. If omitted, auto-detects from current working directory.'
        },
        max_depth: {
          type: 'integer',
          description: 'Maximum directory depth to scan. Default: 8.'
        },
        max_files: {
          type: 'integer',
          description: 'Maximum number of files to scan. Default: 2000.'
        },
        force: {
          type: 'boolean',
          description: 'If true, bypass the incremental scan cache and reparse every file. Default: false.'
        }
      }
    }
  },
  compressOutputDefinition,
  hallucinationReportDefinition,
  compressionStatsDefinition
];

const disabledTools = parseDisabledTools(process.env.WISDOM_STORE_DISABLED_TOOLS);
const activeTools = TOOLS.filter((tool) => !disabledTools.has(tool.name));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: activeTools
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (disabledTools.has(name)) {
      return {
        content: [{ type: 'text', text: `Tool disabled by WISDOM_STORE_DISABLED_TOOLS: ${name}` }],
        isError: true
      };
    }

    switch (name) {
      case 'detect_environment':
        return await handleDetectEnvironment(args);
      case 'reindex_project':
        return await handleReindexProject(args);
      case 'get_project_overview':
        return await handleGetProjectOverview(args);
      case 'check_symbols':
        return await handleCheckSymbols(args);
      case 'refresh_symbols':
        return await handleRefreshSymbols(args);
      case 'compress_output':
        return await compressOutputHandler(args);
      case 'get_hallucination_report':
        return await handleHallucinationReport(args);
      case 'get_compression_stats':
        return await handleCompressionStats(args);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
