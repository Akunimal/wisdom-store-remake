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
  { name: 'wisdom-store', version: '0.5.0' },
  { capabilities: { tools: {} } }
);

// Tool definitions - Core anti-hallucination + environment detection
const TOOLS = [
  {
    name: 'detect_environment',
    description: 'Detecta tu entorno (OS, shell, package managers) y provee reglas anti-errores para evitar comandos incompatibles entre plataformas. Especialmente útil en Windows para prevenir errores de PowerShell vs Bash. Ejecuta esto al inicio de una sesión o cuando tengas dudas sobre compatibilidad de comandos.',
    inputSchema: {
      type: 'object',
      properties: {},
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
        }
      }
    }
  },
  {
    name: 'get_project_overview',
    description: 'Get a compact map of the project showing file structure and key symbols. Runs a fresh scan for accuracy. Useful for orienting yourself in an unfamiliar codebase or getting a high-level view before diving into specifics.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Project root directory. If omitted, auto-detects from current working directory.'
        }
      }
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
        }
      }
    }
  }
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
