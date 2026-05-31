import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

test('symbol-check.mjs exists and is valid JS', () => {
  const symbolCheckPath = path.join(rootDir, 'hooks/symbol-check.mjs');
  assert.ok(fs.existsSync(symbolCheckPath), 'symbol-check.mjs should exist');
  
  const content = fs.readFileSync(symbolCheckPath, 'utf8');
  assert.ok(content.includes('export'), 'Should be an ES module');
  assert.ok(content.includes('known'), 'Should have known symbols check');
  assert.ok(content.includes('unknowns'), 'Should track unknown symbols');
});

test('post-write-symbol-check.sh exists and is executable', () => {
  const hookPath = path.join(rootDir, 'hooks/post-write-symbol-check.sh');
  assert.ok(fs.existsSync(hookPath), 'post-write-symbol-check.sh should exist');
  
  const content = fs.readFileSync(hookPath, 'utf8');
  assert.ok(content.startsWith('#!/bin/bash'), 'Should be a bash script');
  assert.ok(content.includes('symbol-check.mjs'), 'Should call symbol-check.mjs');
});

test('MCP server index.js has correct tools', () => {
  const indexPath = path.join(rootDir, 'src/mcp-server/index.js');
  assert.ok(fs.existsSync(indexPath), 'index.js should exist');
  
  const content = fs.readFileSync(indexPath, 'utf8');
  assert.ok(content.includes('reindex_project'), 'Should have reindex_project');
  assert.ok(content.includes('get_project_overview'), 'Should have get_project_overview');
  assert.ok(content.includes('check_symbols'), 'Should have check_symbols');
  assert.ok(content.includes('refresh_symbols'), 'Should have refresh_symbols');
  // Should NOT have removed tools
  assert.ok(!content.includes('prune_context'), 'Should NOT have prune_context');
  assert.ok(!content.includes('save_wisdom'), 'Should NOT have save_wisdom');
});

test('MCP server supports compatibility tool filtering', () => {
  const indexPath = path.join(rootDir, 'src/mcp-server/index.js');
  const setupPath = path.join(rootDir, 'scripts/setup.js');

  const indexContent = fs.readFileSync(indexPath, 'utf8');
  const setupContent = fs.readFileSync(setupPath, 'utf8');

  assert.ok(indexContent.includes('WISDOM_STORE_DISABLED_TOOLS'), 'Server should support disabled tool env');
  assert.ok(setupContent.includes('analyzeMcpCompatibility'), 'Setup should detect redundant tools');
  assert.ok(setupContent.includes('applyRepoMcpRedundancyFixes'), 'Setup should automatically clean repo redundancies');
  assert.ok(setupContent.includes('removeCodexMcpServerBlocks'), 'Setup should clean repo Codex MCP blocks');
  assert.ok(setupContent.includes('PROJECT_MCP_JSON_PATH'), 'Setup should inspect repo .mcp.json');
  assert.ok(setupContent.includes('PROJECT_CODEX_CONFIG_PATH'), 'Setup should inspect repo Codex config');
  assert.ok(setupContent.includes('get_project_overview'), 'Setup should disable redundant overview tool');
});

test('setup cleans target repo MCP redundancies with backups', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wisdom-store-setup-'));
  const targetRepo = path.join(tempRoot, 'target-repo');
  const homeDir = path.join(tempRoot, 'home');
  fs.mkdirSync(path.join(targetRepo, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(targetRepo, '.codex'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  fs.writeFileSync(path.join(targetRepo, '.claude', 'settings.json'), JSON.stringify({
    mcpServers: {
      serena: {
        command: 'serena',
        args: ['start-mcp-server']
      }
    }
  }, null, 2));
  fs.writeFileSync(path.join(targetRepo, '.mcp.json'), JSON.stringify({
    mcpServers: {
      graphify: {
        command: 'graphify',
        args: ['mcp']
      }
    }
  }, null, 2));
  fs.writeFileSync(path.join(targetRepo, '.codex', 'config.toml'), [
    '[mcp_servers.project-overview]',
    'command = "project-overview"',
    'args = ["mcp"]',
    ''
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    path.join(rootDir, 'scripts', 'setup.js'),
    '--project',
    targetRepo
  ], {
    cwd: rootDir,
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    encoding: 'utf8'
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);

  const projectMcp = JSON.parse(fs.readFileSync(path.join(targetRepo, '.mcp.json'), 'utf8'));
  const projectCodex = fs.readFileSync(path.join(targetRepo, '.codex', 'config.toml'), 'utf8');
  const globalCodex = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');

  assert.ok(!projectMcp.mcpServers.graphify, 'Redundant .mcp.json server should be removed');
  assert.ok(!projectCodex.includes('project-overview'), 'Redundant repo Codex server should be removed');
  assert.ok(globalCodex.includes('WISDOM_STORE_DISABLED_TOOLS = "get_project_overview"'), 'Wisdom Store should be complementary');
  assert.ok(fs.readdirSync(targetRepo).some((name) => name.startsWith('.mcp.json.backup.')), 'Repo .mcp.json backup should exist');
  assert.ok(fs.readdirSync(path.join(targetRepo, '.codex')).some((name) => name.startsWith('config.toml.backup.')), 'Repo Codex backup should exist');
});

test('symbol hook ignores imported external bindings', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wisdom-store-hook-'));
  const sourcePath = path.join(tempRoot, 'index.js');
  const registryPath = path.join(tempRoot, 'symbols.json');

  fs.writeFileSync(sourcePath, [
    "import { fileURLToPath } from 'url';",
    "import path, { basename } from 'path';",
    '',
    'const here = path.dirname(fileURLToPath(import.meta.url));',
    'console.log(basename(here));',
    ''
  ].join('\n'));
  fs.writeFileSync(registryPath, JSON.stringify({
    _meta: {},
    functions: {},
    classes: {},
    variables: { here: { file: 'index.js', line: 4 } },
    exports: {},
    apiRoutes: {},
    htmlPages: {}
  }));

  const result = spawnSync(process.execPath, [
    path.join(rootDir, 'hooks', 'symbol-check.mjs'),
    sourcePath,
    registryPath
  ], {
    encoding: 'utf8'
  });

  assert.strictEqual(result.status, 0, result.stderr);
});

test('indexer.js has core functions', () => {
  const indexerPath = path.join(rootDir, 'src/mcp-server/lib/indexer.js');
  assert.ok(fs.existsSync(indexerPath), 'indexer.js should exist');
  
  const content = fs.readFileSync(indexerPath, 'utf8');
  assert.ok(content.includes('scanProject'), 'Should have scanProject');
  assert.ok(content.includes('checkSymbols'), 'Should have checkSymbols');
  assert.ok(content.includes('readSymbols'), 'Should have readSymbols');
  assert.ok(content.includes('writeSymbols'), 'Should have writeSymbols');
  assert.ok(content.includes('@ast-grep/napi'), 'Should use ast-grep');
});

test('wisdom.js has core functions', () => {
  const wisdomPath = path.join(rootDir, 'src/mcp-server/lib/wisdom.js');
  assert.ok(fs.existsSync(wisdomPath), 'wisdom.js should exist');
  
  const content = fs.readFileSync(wisdomPath, 'utf8');
  assert.ok(content.includes('findProjectRoot'), 'Should have findProjectRoot');
  assert.ok(content.includes('getWisdomDir'), 'Should have getWisdomDir');
  assert.ok(content.includes('readIndex'), 'Should have readIndex');
  assert.ok(content.includes('writeIndex'), 'Should have writeIndex');
});
