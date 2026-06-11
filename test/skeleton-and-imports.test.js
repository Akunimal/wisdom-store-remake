import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { handleFileSkeleton } from '../src/mcp-server/tools/get-file-skeleton.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const hook = path.join(rootDir, 'hooks', 'symbol-check.mjs');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-f2-'));
}

function runHook(file, symbolsFile) {
  return spawnSync(process.execPath, [hook, file, symbolsFile], { encoding: 'utf8' });
}

// ---- F6: get_file_skeleton ----

test('get_file_skeleton extracts TS signatures, methods, and exports', async () => {
  const dir = tmpdir();
  const f = path.join(dir, 'svc.ts');
  fs.writeFileSync(f, [
    'export interface User { id: string }',
    'export class UserService {',
    '  async login(email: string, pw: string): Promise<User> { return null; }',
    '  logout(): void {}',
    '}',
    'export function parseToken(raw: string): string { return raw; }',
    'export const getUser = (id: string): User => ({ id });'
  ].join('\n'));

  const out = (await handleFileSkeleton({ file_path: f })).content[0].text;
  assert.match(out, /class UserService/);
  assert.match(out, /login\(email: string, pw: string\): Promise<User>/);
  assert.match(out, /interface User/);
  assert.match(out, /function parseToken\(raw: string\): string/);
  // bodies are stripped — the return statement must not appear
  assert.ok(!out.includes('return raw'));
  // exports list includes the const arrow export
  assert.match(out, /getUser/);
});

test('get_file_skeleton falls back to declaration lines for non-AST languages', async () => {
  const dir = tmpdir();
  const f = path.join(dir, 'm.py');
  fs.writeFileSync(f, 'def foo(a, b):\n    return a\nclass Bar:\n    def m(self):\n        pass\n');
  const out = (await handleFileSkeleton({ file_path: f })).content[0].text;
  assert.match(out, /def foo\(a, b\)/);
  assert.match(out, /class Bar/);
  assert.ok(!out.includes('return a'));
});

test('get_file_skeleton errors cleanly on a missing file', async () => {
  const res = await handleFileSkeleton({ file_path: '/no/such/file.ts' });
  assert.equal(res.isError, true);
});

// ---- F4: imported symbol must be exported ----

function writeRegistry(dir, functions) {
  const reg = { _meta: {}, functions, classes: {}, variables: {}, exports: {}, apiRoutes: {}, htmlPages: {} };
  const p = path.join(dir, 'symbols.json');
  fs.writeFileSync(p, JSON.stringify(reg));
  return p;
}

test('hook flags importing a symbol the target defines but does not export', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'utils.js'), 'export function realExport(){}\nfunction hidden(){}\n');
  const symbols = writeRegistry(dir, {
    realExport: { file: 'utils.js', line: 1 },
    hidden: { file: 'utils.js', line: 2 }
  });
  const main = path.join(dir, 'main.js');
  fs.writeFileSync(main, "import { realExport, hidden } from './utils.js';\nrealExport();\nhidden();\n");

  const r = runHook(main, symbols);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Export check/);
  assert.match(r.stderr, /'hidden' is not exported/);
  assert.ok(!r.stderr.includes("'realExport' is not exported"));
});

test('hook does not flag exports it cannot enumerate (wildcard re-export)', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'barrel.js'), "export * from './somewhere.js';\n");
  const symbols = writeRegistry(dir, {});
  const main = path.join(dir, 'main.js');
  fs.writeFileSync(main, "import { anything } from './barrel.js';\nconsole.log(anything);\n");

  const r = runHook(main, symbols);
  assert.ok(!/is not exported/.test(r.stderr), 'wildcard re-export must not be flagged');
});

// ---- F5: session-defined symbols are not flagged as hallucinated ----

test('symbol defined in a prior write this session is not flagged in a later file', () => {
  const dir = tmpdir();
  const symbols = writeRegistry(dir, {}); // empty registry — nothing known yet

  // First write defines makeWidget (no imports, so it is recorded in the ledger).
  const a = path.join(dir, 'a.js');
  fs.writeFileSync(a, 'export function makeWidget(){ return 1; }\n');
  runHook(a, symbols);

  // Ledger should now contain makeWidget.
  assert.ok(fs.existsSync(path.join(dir, 'session-defs.json')));

  // Second file calls makeWidget — registry is still empty/stale, but the
  // session ledger suppresses the false "unknown" report.
  const b = path.join(dir, 'b.js');
  fs.writeFileSync(b, 'function run(){ return makeWidget(); }\nrun();\n');
  const r = runHook(b, symbols);

  assert.ok(!/makeWidget/.test(r.stderr), 'session-defined symbol should not be flagged');
});
