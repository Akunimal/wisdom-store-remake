#!/usr/bin/env node

/**
 * wisdom-store-remake Setup Script
 * 
 * Automated onboarding for Claude Code & Codex.
 * - Detects OS and Shell
 * - Configures ~/.claude/settings.json
 * - Registers MCP server and Hooks
 * - Validates installation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SETTINGS_PATH = join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'settings.json');

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

// 1. Detect Environment
logStep('Detecting environment...');
const os = platform();
const isWindows = os === 'win32';
log(`OS: ${os}`);

// 2. Ensure .claude directory exists
logStep('Ensuring Claude config directory exists...');
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
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
const mcpConfig = {
  command: 'node',
  args: [join(ROOT_DIR, 'src', 'mcp-server', 'index.js')],
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
                        settings.mcpServers[mcpName].args?.includes('index.js');
const isHookConfigured = settings.hooks.PostToolUse?.some(h => h.includes('post-write-symbol-check.sh'));

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
  if (!settings.hooks.PostToolUse.some(h => h.includes('post-write-symbol-check.sh'))) {
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
log('2. In Claude Code, type: "Reindex this project"');
log('3. The anti-hallucination hook will now run automatically after every file write.');
log('\nConfiguration file: ' + SETTINGS_PATH);
log('MCP Server: ' + mcpName);
log('Active Hook: PostToolUse (post-write-symbol-check.sh)');
console.log('');
