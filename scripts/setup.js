#!/usr/bin/env node

/**
 * wisdom-store-remake Setup Script
 * 
 * Automated onboarding for Claude Code & Codex.
 * - Detects OS and Shell
 * - Configures ~/.claude/settings.json
 * - Configures ~/.codex/config.toml
 * - Registers MCP server and Hooks
 * - Validates installation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const SETTINGS_PATH = join(homeDir, '.claude', 'settings.json');
const CODEX_CONFIG_PATH = join(homeDir, '.codex', 'config.toml');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(msg) {
  log(`\n🚀 ${msg}`, 'blue');
}

function logSuccess(msg) {
  log(`✅ ${msg}`, 'green');
}

function logWarn(msg) {
  log(`⚠️  ${msg}`, 'yellow');
}

function logError(msg) {
  log(`❌ ${msg}`, 'red');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tomlString(value) {
  return `"${value.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

function upsertCodexMcpServer(configContent, name, serverPath) {
  const block = [
    `[mcp_servers.${name}]`,
    'command = "node"',
    `args = [${tomlString(serverPath)}]`,
    'startup_timeout_sec = 15'
  ].join('\n');

  const pattern = new RegExp(`(^|\\n)\\[mcp_servers\\.${escapeRegExp(name)}\\]\\n[\\s\\S]*?(?=\\n\\[|$)`);

  if (pattern.test(configContent)) {
    return configContent.replace(pattern, `$1${block}\n`);
  }

  const separator = configContent.trim().length === 0 ? '' : '\n\n';
  return `${configContent.trimEnd()}${separator}${block}\n`;
}

function hookEntryIncludes(entry, value) {
  if (typeof entry === 'string') {
    return entry.includes(value);
  }
  return JSON.stringify(entry).includes(value);
}

// 1. Detect Environment
logStep('Detecting environment...');
const os = platform();
const isWindows = os === 'win32';
log(`OS: ${os}`);

// 2. Ensure .claude directory exists
logStep('Ensuring Claude config directory exists...');
const claudeDir = join(homeDir, '.claude');
if (!existsSync(claudeDir)) {
  mkdirSync(claudeDir, { recursive: true });
  logSuccess('Created ~/.claude directory');
} else {
  logSuccess('~/.claude directory exists');
}

// 3. Configure settings.json
logStep('Configuring ~/.claude/settings.json...');

let settings = {};
if (existsSync(SETTINGS_PATH)) {
  try {
    const content = readFileSync(SETTINGS_PATH, 'utf-8');
    settings = JSON.parse(content);
    log('Existing settings loaded');
  } catch (e) {
    logWarn('Could not parse existing settings.json. Creating backup and starting fresh.');
    const backupPath = SETTINGS_PATH + '.backup.' + Date.now();
    writeFileSync(backupPath, readFileSync(SETTINGS_PATH, 'utf-8'));
    log(`Backup created at: ${backupPath}`);
    settings = {};
  }
}

// Prepare MCP config
const mcpName = 'wisdom-store';
const mcpServerPath = join(ROOT_DIR, 'src', 'mcp-server', 'index.js');
const mcpConfig = {
  command: 'node',
  args: [mcpServerPath],
  env: {}
};

// Prepare Hooks
const hooksDir = join(ROOT_DIR, 'hooks');
const postWriteHook = join(hooksDir, 'post-write-symbol-check.sh');

if (!existsSync(postWriteHook)) {
  logError(`Hook not found: ${postWriteHook}`);
  process.exit(1);
}

// Update settings object
if (!settings.mcpServers) settings.mcpServers = {};
if (!settings.hooks) settings.hooks = {};

// Check if already configured
const isMcpConfigured = settings.mcpServers[mcpName]?.command === 'node' && 
                        settings.mcpServers[mcpName].args?.some(arg => arg.includes('index.js'));
const isHookConfigured = settings.hooks.PostToolUse?.some(h => hookEntryIncludes(h, 'post-write-symbol-check.sh'));

if (isMcpConfigured && isHookConfigured) {
  logSuccess('wisdom-store already configured in settings.json!');
} else {
  // Merge configs
  settings.mcpServers[mcpName] = mcpConfig;
  
  // Handle PostToolUse hook (append to array or create)
  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }
  if (!Array.isArray(settings.hooks.PostToolUse)) {
    settings.hooks.PostToolUse = [settings.hooks.PostToolUse];
  }
  
  // Avoid duplicates
  if (!settings.hooks.PostToolUse.some(h => hookEntryIncludes(h, 'post-write-symbol-check.sh'))) {
    settings.hooks.PostToolUse.push(postWriteHook);
  }

  // Write back
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    logSuccess('settings.json updated successfully');
  } catch (e) {
    logError(`Failed to write settings.json: ${e.message}`);
    process.exit(1);
  }
}

// 3b. Configure Codex MCP server
logStep('Configuring ~/.codex/config.toml...');
const codexDir = dirname(CODEX_CONFIG_PATH);
if (!existsSync(codexDir)) {
  mkdirSync(codexDir, { recursive: true });
  logSuccess('Created ~/.codex directory');
}

let codexConfig = '';
if (existsSync(CODEX_CONFIG_PATH)) {
  codexConfig = readFileSync(CODEX_CONFIG_PATH, 'utf-8');
}

try {
  const nextConfig = upsertCodexMcpServer(codexConfig, mcpName, mcpServerPath);
  if (nextConfig !== codexConfig) {
    writeFileSync(CODEX_CONFIG_PATH, nextConfig, 'utf-8');
    logSuccess('config.toml updated successfully');
  } else {
    logSuccess('wisdom-store already configured in config.toml!');
  }
} catch (e) {
  logError(`Failed to write config.toml: ${e.message}`);
  process.exit(1);
}

// 4. Validate Installation
logStep('Validating installation...');
try {
  const indexPath = join(ROOT_DIR, 'src', 'mcp-server', 'index.js');
  if (existsSync(indexPath)) {
    logSuccess('MCP Server file found');
  } else {
    logError('MCP Server file missing');
    process.exit(1);
  }
} catch (e) {
  logError(`Validation failed: ${e.message}`);
  process.exit(1);
}

// Final Report
console.log('\n' + '='.repeat(60));
log(`${colors.bold}🎉 SETUP COMPLETE!${colors.reset}`, 'green');
console.log('='.repeat(60));
log('\nNext steps:', 'bold');
log('1. Restart your terminal or Claude Code session.');
log('2. In Claude Code or Codex, type: "Reindex this project"');
log('3. The anti-hallucination hook will now run automatically after every file write.');
log('\nConfiguration file: ' + SETTINGS_PATH);
log('Codex config file: ' + CODEX_CONFIG_PATH);
log('MCP Server: ' + mcpName);
log('Active Hook: PostToolUse (post-write-symbol-check.sh)');
console.log('');
