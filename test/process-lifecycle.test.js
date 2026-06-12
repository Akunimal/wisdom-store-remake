import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  activeProcessCount,
  runProcess,
  runShellCommand,
  terminateProcessTree
} from '../src/mcp-server/lib/process-runner.js';
import { compressOutputHandler } from '../src/mcp-server/tools/compress-output.js';
import { detectEnvironmentHandler } from '../src/mcp-server/tools/detect-environment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const serverEntry = path.join(rootDir, 'src', 'mcp-server', 'index.js');
const hookEntry = path.join(rootDir, 'hooks', 'post-command-compress.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(25);
  }
  return null;
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function createHangingTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-process-tree-'));
  const pidFile = path.join(dir, 'grandchild.pid');
  const grandchild = path.join(dir, 'grandchild.mjs');
  const parent = path.join(dir, 'parent.mjs');

  fs.writeFileSync(grandchild, [
    "import fs from 'node:fs';",
    "fs.writeFileSync(process.argv[2], String(process.pid));",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  fs.writeFileSync(parent, [
    "import { spawn } from 'node:child_process';",
    "const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: 'ignore' });",
    "child.on('error', () => process.exit(2));",
    'setInterval(() => {}, 1000);'
  ].join('\n'));

  return {
    command: [process.execPath, parent, grandchild, pidFile].map(shellQuote).join(' '),
    pidFile
  };
}

function createPipeHoldingOrphan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-pipe-orphan-'));
  const pidFile = path.join(dir, 'child.pid');
  const childFile = path.join(dir, 'child.mjs');
  const parentFile = path.join(dir, 'parent.mjs');

  fs.writeFileSync(childFile, [
    "import fs from 'node:fs';",
    "fs.writeFileSync(process.argv[2], String(process.pid));",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  fs.writeFileSync(parentFile, [
    "import fs from 'node:fs';",
    "import { spawn } from 'node:child_process';",
    "const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: 'inherit', detached: process.platform === 'win32' });",
    'child.unref();',
    'const timer = setInterval(() => {',
    '  if (fs.existsSync(process.argv[3])) { clearInterval(timer); process.exit(0); }',
    '}, 10);'
  ].join('\n'));

  return { parentFile, childFile, pidFile };
}

test('runShellCommand kills the complete process tree on timeout', { timeout: 10000 }, async () => {
  const { command, pidFile } = createHangingTree();
  let grandchildPid = null;
  try {
    const result = await runShellCommand(command, { timeoutMs: 800 });
    grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));

    assert.equal(result.timedOut, true);
    assert.equal(await waitFor(() => !isAlive(grandchildPid)), true);
    assert.equal(activeProcessCount(), 0);
  } finally {
    if (grandchildPid && isAlive(grandchildPid)) terminateProcessTree(grandchildPid);
  }
});

test('runProcess kills pipe-holding descendants after their parent exits', { timeout: 10000 }, async () => {
  const { parentFile, childFile, pidFile } = createPipeHoldingOrphan();
  const pending = runProcess(process.execPath, [parentFile, childFile, pidFile], { timeoutMs: 800 });
  let descendantPid = null;
  let outcome;

  try {
    assert.ok(await waitFor(() => fs.existsSync(pidFile), 3000), 'descendant did not start');
    descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
    outcome = await Promise.race([
      pending,
      sleep(4000).then(() => null)
    ]);

    assert.ok(outcome, 'runner remained stuck after its timeout');
    assert.equal(outcome.timedOut, true);
    assert.equal(await waitFor(() => !isAlive(descendantPid)), true);
  } finally {
    if (descendantPid && isAlive(descendantPid)) terminateProcessTree(descendantPid);
    await pending;
  }
});

test('terminateProcessTree kills every orphaned Windows descendant branch', {
  timeout: 10000,
  skip: process.platform !== 'win32'
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-orphan-branches-'));
  const childFile = path.join(dir, 'child.mjs');
  const parentFile = path.join(dir, 'parent.mjs');
  const pidFiles = [path.join(dir, 'one.pid'), path.join(dir, 'two.pid')];
  fs.writeFileSync(childFile, [
    "import fs from 'node:fs';",
    "fs.writeFileSync(process.argv[2], String(process.pid));",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  fs.writeFileSync(parentFile, [
    "import fs from 'node:fs';",
    "import { spawn } from 'node:child_process';",
    'for (const pidFile of process.argv.slice(3)) {',
    "  const child = spawn(process.execPath, [process.argv[2], pidFile], { stdio: 'ignore', detached: true });",
    '  child.unref();',
    '}',
    'const timer = setInterval(() => {',
    '  if (process.argv.slice(3).every((file) => fs.existsSync(file))) { clearInterval(timer); process.exit(0); }',
    '}, 10);'
  ].join('\n'));

  const parent = spawn(process.execPath, [parentFile, childFile, ...pidFiles], {
    stdio: 'ignore',
    windowsHide: true
  });
  let pids = [];
  try {
    assert.ok(await waitFor(() => pidFiles.every((file) => fs.existsSync(file)), 3000));
    pids = pidFiles.map((file) => Number(fs.readFileSync(file, 'utf8')));
    if (parent.exitCode === null) {
      await new Promise((resolve) => parent.once('exit', resolve));
    }
    assert.ok(pids.every(isAlive), 'descendants should be alive before cleanup');

    terminateProcessTree(parent);
    assert.equal(await waitFor(() => pids.every((pid) => !isAlive(pid))), true);
  } finally {
    for (const pid of pids) {
      if (isAlive(pid)) terminateProcessTree(pid);
    }
  }
});

test('compress_output kills descendants and reports a timeout', { timeout: 10000 }, async () => {
  const { command, pidFile } = createHangingTree();
  let grandchildPid = null;
  try {
    const result = await compressOutputHandler({ command, timeoutMs: 800 });
    grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /timed out/i);
    assert.equal(await waitFor(() => !isAlive(grandchildPid)), true);
  } finally {
    if (grandchildPid && isAlive(grandchildPid)) terminateProcessTree(grandchildPid);
  }
});

test('compress_output kills descendants when the MCP request is cancelled', { timeout: 10000 }, async () => {
  const { command, pidFile } = createHangingTree();
  const controller = new AbortController();
  let grandchildPid = null;
  try {
    const resultPromise = compressOutputHandler({ command, timeoutMs: 5000 }, controller.signal);
    assert.ok(await waitFor(() => fs.existsSync(pidFile), 3000), 'grandchild did not start');
    grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));
    controller.abort();
    const result = await resultPromise;

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cancelled/i);
    assert.equal(await waitFor(() => !isAlive(grandchildPid)), true);
  } finally {
    if (grandchildPid && isAlive(grandchildPid)) terminateProcessTree(grandchildPid);
  }
});

test('post-command hook kills descendants and exits 124 on timeout', { timeout: 10000 }, async () => {
  const { command, pidFile } = createHangingTree();
  let grandchildPid = null;
  try {
    const result = await runProcess(process.execPath, [hookEntry, command], {
      env: { ...process.env, RTK_COMMAND_TIMEOUT_MS: '800' },
      timeoutMs: 5000
    });
    grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));

    assert.equal(result.status, 124, result.stderr);
    assert.match(result.stderr, /timed out/i);
    assert.equal(await waitFor(() => !isAlive(grandchildPid)), true);
  } finally {
    if (grandchildPid && isAlive(grandchildPid)) terminateProcessTree(grandchildPid);
  }
});

test('runProcess resolves spawn failures instead of waiting forever', { timeout: 5000 }, async () => {
  const result = await runProcess('wsr-command-that-does-not-exist-7f13f1', [], { timeoutMs: 500 });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error, /not found|ENOENT|cannot find/i);
  assert.equal(activeProcessCount(), 0);
});

test('detect_environment stops probes when its MCP request is cancelled', { timeout: 10000 }, async () => {
  const controller = new AbortController();
  const resultPromise = detectEnvironmentHandler(controller.signal);
  setTimeout(() => controller.abort(), 50);
  const result = await resultPromise;

  assert.ok(result.system);
  assert.equal(activeProcessCount(), 0);
});

test('MCP server exits after stdin closes with an active watcher', { timeout: 15000 }, async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-mcp-close-'));
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.writeFileSync(path.join(project, 'source.js'), 'export function live() {}\n');

  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });

  try {
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
      }
    }) + '\n');
    assert.ok(await waitFor(() => output.includes('"id":1'), 5000), errors || output);

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'watch_project',
        arguments: { project_path: project, debounce_ms: 50 }
      }
    }) + '\n');
    assert.ok(await waitFor(() => output.includes('"id":2'), 5000), errors || output);

    child.stdin.end();
    const exited = await waitFor(() => child.exitCode !== null, 3000);
    assert.equal(exited, true, errors || output);
    assert.equal(child.exitCode, 0, errors || output);
  } finally {
    if (child.exitCode === null) terminateProcessTree(child);
  }
});
