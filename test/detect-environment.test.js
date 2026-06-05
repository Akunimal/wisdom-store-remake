import { test } from 'node:test';
import assert from 'node:assert';
import { platform } from 'node:os';
import { detectEnvironmentHandler, handleDetectEnvironment } from '../src/mcp-server/tools/detect-environment.js';

test('detectEnvironmentHandler returns stable environment guidance', async () => {
  const result = await detectEnvironmentHandler();

  assert.ok(result.system, 'Should include system block');
  assert.ok(result.shell, 'Should include shell block');
  assert.ok(result.rules, 'Should include command rules');
  assert.ok(Array.isArray(result.packageManagers), 'Should include package manager list');
  assert.ok(Array.isArray(result.recommendations), 'Should include recommendations');
  assert.ok(result.shell.recommended.shell, 'Should recommend a shell');
  assert.ok(result.shell.recommended.command, 'Should include an example command');
});

test('handleDetectEnvironment returns JSON by default', async () => {
  const response = await handleDetectEnvironment({});
  const payload = JSON.parse(response.content[0].text);

  assert.strictEqual(response.content[0].type, 'text');
  assert.ok(payload.system.os, 'Verbose MCP response should contain OS');
});

test('handleDetectEnvironment returns compact text when compact is true', async () => {
  const response = await handleDetectEnvironment({ compact: true });
  assert.strictEqual(response.content[0].type, 'text');
  // Compact mode returns plain text, not JSON
  assert.ok(response.content[0].text.includes('Recommended shell:'), 'Compact output should include recommendation');
  assert.ok(!response.content[0].text.startsWith('{'), 'Compact output should not be JSON');
});

test('Windows detection includes WSL/Git Bash diagnostics when applicable', async () => {
  const result = await detectEnvironmentHandler();

  if (platform() !== 'win32') {
    assert.strictEqual(result.windows, null);
    return;
  }

  assert.ok(result.windows.wsl, 'Windows should include WSL diagnostics');
  assert.ok(result.windows.gitBash, 'Windows should include Git Bash diagnostics');
  assert.ok(result.windows.nativeToolchain, 'Windows should include native toolchain diagnostics');
  assert.ok(result.rules.commands.bash, 'Windows rules should explain plain bash target');
  assert.ok(result.rules.quoting.some((rule) => rule.includes('PowerShell')), 'Windows rules should warn about PowerShell quoting');
});
