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
const PROJECT_SETTINGS_PATH = join(ROOT_DIR, '.claude', 'settings.json');
const PROJECT_MCP_JSON_PATH = join(ROOT_DIR, '.mcp.json');
const PROJECT_CODEX_CONFIG_PATH = join(ROOT_DIR, '.codex', 'config.toml');

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

function upsertCodexMcpServer(configContent, name, serverPath, disabledTools = []) {
  const block = [
    `[mcp_servers.${name}]`,
    'command = "node"',
    `args = [${tomlString(serverPath)}]`,
    disabledTools.length > 0
      ? `env = { WISDOM_STORE_DISABLED_TOOLS = ${tomlString(disabledTools.join(','))} }`
      : null,
    'startup_timeout_sec = 15'
  ].filter(Boolean).join('\n');

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

function readJsonConfig(filePath, label) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    logWarn(`Could not parse ${label}; skipping it for MCP compatibility detection.`);
    return {};
  }
}

function extractCodexMcpServerNames(configContent) {
  const names = [];
  const tablePattern = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/gm;
  let match;
  while ((match = tablePattern.exec(configContent)) !== null) {
    names.push(match[1].replace(/^"|"$/g, ''));
  }
  return names;
}

function removeCodexMcpServerBlocks(configContent, names) {
  let nextContent = configContent;

  for (const name of names) {
    const pattern = new RegExp(`(^|\\n)\\[mcp_servers\\.${escapeRegExp(name)}\\]\\n[\\s\\S]*?(?=\\n\\[|$)`);
    nextContent = nextContent.replace(pattern, '$1');
  }

  return nextContent.replace(/\n{3,}/g, '\n\n').trimEnd() + (nextContent.trim() ? '\n' : '');
}

const MCP_CAPABILITY_PROFILES = [
  {
    id: 'repo-overview',
    label: 'repository overview/navigation',
    namePattern: /(serena|graphify|repo[-_ ]?map|codebase[-_ ]?map|project[-_ ]?overview)/i,
    tools: ['get_project_overview'],
    reason: 'repo overview/symbol navigation'
  }
];

function collectMcpServers(configs) {
  const servers = [];

  for (const [name, config] of Object.entries(configs.globalClaude.mcpServers || {})) {
    servers.push({ name, source: 'Claude global', scope: 'global', configType: 'claude-json', config });
  }
  for (const [name, config] of Object.entries(configs.projectClaude.mcpServers || {})) {
    servers.push({ name, source: 'Claude repo', scope: 'repo', configType: 'project-claude-json', config });
  }
  for (const [name, config] of Object.entries(configs.projectMcpJson.mcpServers || {})) {
    servers.push({ name, source: '.mcp.json', scope: 'repo', configType: 'project-mcp-json', config });
  }
  for (const name of extractCodexMcpServerNames(configs.globalCodex)) {
    servers.push({ name, source: 'Codex global', scope: 'global', configType: 'codex-toml', config: {} });
  }
  for (const name of extractCodexMcpServerNames(configs.projectCodex)) {
    servers.push({ name, source: 'Codex repo', scope: 'repo', configType: 'project-codex-toml', config: {} });
  }

  return servers;
}

function profileMatchesServer(profile, server) {
  const haystack = [
    server.name,
    server.config?.command,
    ...(server.config?.args || [])
  ].filter(Boolean).join(' ');

  return profile.namePattern.test(haystack);
}

function analyzeMcpCompatibility(servers, wisdomName) {
  const disabledTools = new Set();
  const groups = [];

  for (const profile of MCP_CAPABILITY_PROFILES) {
    const matches = servers
      .filter((server) => server.name !== wisdomName)
      .filter((server) => profileMatchesServer(profile, server));

    if (matches.length > 0) {
      for (const tool of profile.tools) {
        disabledTools.add(tool);
      }
    }

    if (matches.length > 1) {
      groups.push({
        profile: profile.label,
        reason: profile.reason,
        servers: matches
      });
    }
  }

  return {
    disabledTools: [...disabledTools].sort(),
    groups
  };
}

function serverPreferenceScore(server) {
  const haystack = [
    server.name,
    server.config?.command,
    ...(server.config?.args || [])
  ].filter(Boolean).join(' ').toLowerCase();

  let score = 0;
  if (haystack.includes('serena')) score += 100;
  if (haystack.includes('graphify')) score += 80;
  if (/repo[-_ ]?map|codebase[-_ ]?map/.test(haystack)) score += 60;
  if (/project[-_ ]?overview/.test(haystack)) score += 50;
  if (server.scope === 'global') score += 5;

  return score;
}

function chooseKeeper(servers) {
  return [...servers].sort((a, b) => {
    const scoreDiff = serverPreferenceScore(b) - serverPreferenceScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`);
  })[0];
}

function getRepoRedundancyRemovals(analysis) {
  const removals = [];

  for (const group of analysis.groups) {
    const keeper = chooseKeeper(group.servers);
    for (const server of group.servers) {
      if (server === keeper || server.scope !== 'repo') {
        continue;
      }
      removals.push({ server, keeper, profile: group.profile });
    }
  }

  return removals;
}

function applyRepoMcpRedundancyFixes(analysis, configs) {
  const removals = getRepoRedundancyRemovals(analysis);
  if (removals.length === 0) {
    return { removals, configs };
  }

  const nextConfigs = {
    projectClaude: structuredClone(configs.projectClaude),
    projectMcpJson: structuredClone(configs.projectMcpJson),
    projectCodex: configs.projectCodex
  };
  const codexNamesToRemove = [];

  for (const { server } of removals) {
    if (server.configType === 'project-claude-json') {
      delete nextConfigs.projectClaude.mcpServers?.[server.name];
    }
    if (server.configType === 'project-mcp-json') {
      delete nextConfigs.projectMcpJson.mcpServers?.[server.name];
    }
    if (server.configType === 'project-codex-toml') {
      codexNamesToRemove.push(server.name);
    }
  }

  if (codexNamesToRemove.length > 0) {
    nextConfigs.projectCodex = removeCodexMcpServerBlocks(nextConfigs.projectCodex, codexNamesToRemove);
  }

  return { removals, configs: nextConfigs };
}

function writeRepoMcpFixes(cleanup, originalConfigs) {
  if (cleanup.removals.length === 0) {
    return;
  }

  if (JSON.stringify(cleanup.configs.projectClaude) !== JSON.stringify(originalConfigs.projectClaude) && existsSync(PROJECT_SETTINGS_PATH)) {
    writeFileSync(PROJECT_SETTINGS_PATH, JSON.stringify(cleanup.configs.projectClaude, null, 2), 'utf-8');
  }
  if (JSON.stringify(cleanup.configs.projectMcpJson) !== JSON.stringify(originalConfigs.projectMcpJson) && existsSync(PROJECT_MCP_JSON_PATH)) {
    writeFileSync(PROJECT_MCP_JSON_PATH, JSON.stringify(cleanup.configs.projectMcpJson, null, 2), 'utf-8');
  }
  if (cleanup.configs.projectCodex !== originalConfigs.projectCodex && existsSync(PROJECT_CODEX_CONFIG_PATH)) {
    writeFileSync(PROJECT_CODEX_CONFIG_PATH, cleanup.configs.projectCodex, 'utf-8');
  }
}

function logMcpCompatibilityReport(servers, analysis) {
  logStep('Reviewing repo-level MCP compatibility...');

  if (servers.length === 0) {
    log('No existing MCP servers found in global or repo configs.');
  } else {
    const uniqueServers = new Map();
    for (const server of servers) {
      const key = `${server.name} (${server.source})`;
      uniqueServers.set(key, server);
    }
    log(`Found ${uniqueServers.size} configured MCP server entries across global and repo configs.`);
  }

  if (analysis.disabledTools.length > 0) {
    logWarn(`Compatibility mode: disabling redundant Wisdom Store tools: ${analysis.disabledTools.join(', ')}`);
  } else {
    logSuccess('No Wisdom Store tool overlap detected.');
  }

  if (analysis.groups.length > 0) {
    logWarn('Existing MCP redundancy groups detected:');
    for (const group of analysis.groups) {
      const names = group.servers.map((server) => `${server.name} (${server.source})`).join(', ');
      logWarn(`- ${group.profile}: ${names}`);
    }
  } else {
    logSuccess('No duplicate MCP capability groups detected.');
  }
}

function logRepoMcpCleanup(removals) {
  if (removals.length === 0) {
    logSuccess('No repo MCP entries needed automatic cleanup.');
    return;
  }

  logWarn('Automatically removed redundant repo MCP entries:');
  for (const { server, keeper, profile } of removals) {
    logWarn(`- ${server.name} (${server.source}) overlapped ${profile}; kept ${keeper.name} (${keeper.source})`);
  }
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

let codexConfig = '';
if (existsSync(CODEX_CONFIG_PATH)) {
  codexConfig = readFileSync(CODEX_CONFIG_PATH, 'utf-8');
}

let projectClaudeSettings = readJsonConfig(PROJECT_SETTINGS_PATH, 'repo .claude/settings.json');
let projectMcpJson = readJsonConfig(PROJECT_MCP_JSON_PATH, 'repo .mcp.json');
let projectCodexConfig = existsSync(PROJECT_CODEX_CONFIG_PATH)
  ? readFileSync(PROJECT_CODEX_CONFIG_PATH, 'utf-8')
  : '';

// Prepare MCP config
const mcpName = 'wisdom-store';
const mcpServerPath = join(ROOT_DIR, 'src', 'mcp-server', 'index.js');
let configuredMcpServers = collectMcpServers({
  globalClaude: settings,
  projectClaude: projectClaudeSettings,
  projectMcpJson,
  globalCodex: codexConfig,
  projectCodex: projectCodexConfig
});
let compatibilityAnalysis = analyzeMcpCompatibility(configuredMcpServers, mcpName);
const cleanup = applyRepoMcpRedundancyFixes(compatibilityAnalysis, {
  projectClaude: projectClaudeSettings,
  projectMcpJson,
  projectCodex: projectCodexConfig
});
writeRepoMcpFixes(cleanup, {
  projectClaude: projectClaudeSettings,
  projectMcpJson,
  projectCodex: projectCodexConfig
});
projectClaudeSettings = cleanup.configs.projectClaude;
projectMcpJson = cleanup.configs.projectMcpJson;
projectCodexConfig = cleanup.configs.projectCodex;
configuredMcpServers = collectMcpServers({
  globalClaude: settings,
  projectClaude: projectClaudeSettings,
  projectMcpJson,
  globalCodex: codexConfig,
  projectCodex: projectCodexConfig
});
compatibilityAnalysis = analyzeMcpCompatibility(configuredMcpServers, mcpName);
const redundantTools = compatibilityAnalysis.disabledTools;
const mcpConfig = {
  command: 'node',
  args: [mcpServerPath],
  env: redundantTools.length > 0
    ? { WISDOM_STORE_DISABLED_TOOLS: redundantTools.join(',') }
    : {}
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
                        settings.mcpServers[mcpName].args?.some(arg => arg.includes('index.js')) &&
                        (settings.mcpServers[mcpName].env?.WISDOM_STORE_DISABLED_TOOLS || '') === (mcpConfig.env.WISDOM_STORE_DISABLED_TOOLS || '');
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

logMcpCompatibilityReport(configuredMcpServers, compatibilityAnalysis);
logRepoMcpCleanup(cleanup.removals);

// 3b. Configure Codex MCP server
logStep('Configuring ~/.codex/config.toml...');
const codexDir = dirname(CODEX_CONFIG_PATH);
if (!existsSync(codexDir)) {
  mkdirSync(codexDir, { recursive: true });
  logSuccess('Created ~/.codex directory');
}

try {
  const nextConfig = upsertCodexMcpServer(codexConfig, mcpName, mcpServerPath, redundantTools);
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
