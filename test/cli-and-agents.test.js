import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { handleGenAgentsContext, buildManagedBlock } from '../src/mcp-server/tools/gen-agents-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const cli = path.join(rootDir, 'bin', 'cli.js');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-cli-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'src.js'), 'export function makeWidget(a, b){ return a; }\nexport class Engine {}\n');
  return dir;
}

function run(args, opts = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...opts });
}

test('CLI --version and --help work', () => {
  assert.match(run(['--version']).stdout, /\d+\.\d+\.\d+/);
  assert.match(run(['--help']).stdout, /Usage:/);
  assert.match(run([]).stdout, /Usage:/);
});

test('CLI index → check (text + json) round-trips against a real project', () => {
  const dir = tmpProject();

  const idx = run(['index', '--project', dir]);
  assert.equal(idx.status, 0);
  assert.match(idx.stdout, /Indexed/);

  const text = run(['check', 'makeWidget', 'makeWidgett', 'ghostFn', '--project', dir]);
  assert.match(text.stdout, /makeWidgett/);
  assert.match(text.stdout, /ghostFn/);

  const jsonRes = run(['check', 'makeWidget', 'ghostFn', '--project', dir, '--json']);
  const parsed = JSON.parse(jsonRes.stdout);
  assert.equal(parsed.known[0].name, 'makeWidget');
  assert.deepEqual(parsed.unknown, ['ghostFn']);
});

test('CLI skeleton prints signatures without bodies', () => {
  const dir = tmpProject();
  const res = run(['skeleton', path.join(dir, 'src.js')]);
  assert.match(res.stdout, /function makeWidget\(a, b\)/);
  assert.ok(!res.stdout.includes('return a'));

  const jsonRes = run(['skeleton', path.join(dir, 'src.js'), '--json']);
  const parsed = JSON.parse(jsonRes.stdout);
  assert.ok(parsed.functions.some((f) => /makeWidget/.test(f.sig)));
  assert.ok(parsed.exports.includes('Engine'));
});

test('CLI unknown command exits non-zero with usage', () => {
  const res = run(['frobnicate']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Unknown command/);
});

// ---- F7: AGENTS.md generator ----

test('gen_agents_context writes a managed block and updates it idempotently', async () => {
  const dir = tmpProject();
  run(['index', '--project', dir]);

  const first = await handleGenAgentsContext({ project_path: dir });
  assert.match(first.content[0].text, /Wrote/);

  const agentsPath = path.join(dir, 'AGENTS.md');
  let body = fs.readFileSync(agentsPath, 'utf8');
  assert.match(body, /ANTI-HALLUCINATION:BEGIN/);
  assert.match(body, /Anti-Hallucination Guardrails/);
  assert.match(body, /Functions: 1/);

  // Pre-existing human content must be preserved across regeneration.
  fs.writeFileSync(agentsPath, '# My Project\n\nHand-written notes.\n\n' + body);
  const second = await handleGenAgentsContext({ project_path: dir });
  assert.match(second.content[0].text, /Updated/);
  body = fs.readFileSync(agentsPath, 'utf8');
  assert.match(body, /Hand-written notes\./);
  // Exactly one managed block (no duplication).
  assert.equal(body.split('ANTI-HALLUCINATION:BEGIN').length - 1, 1);
});

test('buildManagedBlock surfaces the watchlist', () => {
  const block = buildManagedBlock(
    { functions: { foo: {} }, classes: {}, variables: {}, exports: { foo: {} }, apiRoutes: {} },
    { frequent: [{ symbol: 'ghostFn', count: 4 }] }
  );
  assert.match(block, /Watchlist/);
  assert.match(block, /ghostFn.*×4/);
});
