#!/usr/bin/env node
/**
 * Anti-Hallucination CLI.
 *
 * Exposes the same engine as the MCP server to any agent (or human) with a
 * shell — no MCP client required. Model-agnostic by construction: Codex,
 * Cursor, Gemini, Aider, a CI job, or a plain terminal can all call it.
 *
 *   anti-hallucination index [path]            Build/refresh the symbol registry
 *   anti-hallucination check <sym...> [--json] Check symbols against the registry
 *   anti-hallucination skeleton <file> [--json] Print a file's signatures (no bodies)
 *   anti-hallucination overview [path]         Compact project map
 *   anti-hallucination report [path]           Hallucination patterns this project
 *   anti-hallucination agents [--target F]     Write guardrails into AGENTS.md
 *   anti-hallucination setup [--project P]     Configure MCP/hooks for your tools
 *   anti-hallucination --version | --help
 */

import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

import { handleReindexProject } from '../src/mcp-server/tools/reindex-project.js';
import { handleCheckSymbols } from '../src/mcp-server/tools/check-symbols.js';
import { handleFileSkeleton } from '../src/mcp-server/tools/get-file-skeleton.js';
import { handleGetProjectOverview } from '../src/mcp-server/tools/get-project-overview.js';
import { handleHallucinationReport } from '../src/mcp-server/tools/get-hallucination-report.js';
import { handleGenAgentsContext } from '../src/mcp-server/tools/gen-agents-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function pkgVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; }
}

function print(result) {
  const text = result?.content?.[0]?.text ?? '';
  if (result?.isError) { process.stderr.write(text + '\n'); process.exitCode = 1; }
  else process.stdout.write(text + '\n');
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  args.splice(i, value !== undefined && !value.startsWith('-') ? 2 : 1);
  return value !== undefined && !value.startsWith('-') ? value : true;
}

const HELP = `anti-hallucination v${pkgVersion()}

Usage:
  anti-hallucination index [path]                Build/refresh the symbol registry
  anti-hallucination check <sym...> [--json]     Check symbols against the registry
  anti-hallucination skeleton <file> [--json]    Print a file's signatures (no bodies)
  anti-hallucination overview [path] [--full]    Compact project map
  anti-hallucination report [path]               Hallucination patterns for this project
  anti-hallucination agents [--target AGENTS.md] Write guardrails into a convention file
  anti-hallucination setup [--project PATH]      Configure MCP server + hooks for your tools
  anti-hallucination --version | --help`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); return; }
  if (cmd === '--version' || cmd === '-v') { console.log(pkgVersion()); return; }

  const json = Boolean(takeFlag(argv, '--json'));
  const project = takeFlag(argv, '--project');
  const projectPath = typeof project === 'string' ? project : undefined;

  switch (cmd) {
    case 'index':
    case 'reindex': {
      print(await handleReindexProject({ project_path: projectPath || argv[0], force: argv.includes('--force') }));
      return;
    }
    case 'check': {
      const symbols = argv.filter((a) => !a.startsWith('-'));
      if (symbols.length === 0) { process.stderr.write('Provide at least one symbol: anti-hallucination check <name...>\n'); process.exitCode = 1; return; }
      print(await handleCheckSymbols({ symbols, project_path: projectPath, format: json ? 'json' : 'text' }));
      return;
    }
    case 'skeleton': {
      const file = argv.find((a) => !a.startsWith('-'));
      if (!file) { process.stderr.write('Provide a file: anti-hallucination skeleton <file>\n'); process.exitCode = 1; return; }
      print(await handleFileSkeleton({ file_path: resolve(file), format: json ? 'json' : 'text' }));
      return;
    }
    case 'overview': {
      print(await handleGetProjectOverview({ project_path: projectPath || argv[0], detail: argv.includes('--full') ? 'full' : 'summary' }));
      return;
    }
    case 'report': {
      print(await handleHallucinationReport({ project_path: projectPath || argv[0] }));
      return;
    }
    case 'agents': {
      const target = takeFlag(argv, '--target');
      print(await handleGenAgentsContext({ project_path: projectPath || argv[0], target: typeof target === 'string' ? target : undefined }));
      return;
    }
    case 'setup': {
      // setup.js is a standalone script; run it as a child so its top-level
      // logic executes with the user's chosen --project, HOME, etc.
      await new Promise((res) => {
        const child = spawn(process.execPath, [join(ROOT, 'scripts', 'setup.js'), ...argv], { stdio: 'inherit' });
        child.on('exit', (code) => { process.exitCode = code || 0; res(); });
      });
      return;
    }
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}\n`);
      process.exitCode = 1;
  }
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exitCode = 1; });
