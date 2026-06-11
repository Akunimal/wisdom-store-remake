import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as wisdom from '../src/mcp-server/lib/wisdom.js';
import * as tracker from '../src/mcp-server/lib/hallucination-tracker.js';
import * as compStats from '../src/mcp-server/lib/compression-stats.js';
import * as indexer from '../src/mcp-server/lib/indexer.js';
import { compressOutput } from '../src/mcp-server/tools/token-compressor.js';
import { handleCheckSymbols } from '../src/mcp-server/tools/check-symbols.js';
import { handleReindexProject } from '../src/mcp-server/tools/reindex-project.js';
import { handleRefreshSymbols } from '../src/mcp-server/tools/refresh-symbols.js';
import { handleGetProjectOverview } from '../src/mcp-server/tools/get-project-overview.js';
import { compressOutputHandler } from '../src/mcp-server/tools/compress-output.js';
import { detectEnvironmentHandler, handleDetectEnvironment } from '../src/mcp-server/tools/detect-environment.js';
import { handleHallucinationReport } from '../src/mcp-server/tools/get-hallucination-report.js';
import { handleCompressionStats } from '../src/mcp-server/tools/get-compression-stats.js';
import * as zt from '../hooks/zero-trust-prompt.js';
import * as dedup from '../src/mcp-server/tools/strategies/dedup-filter.js';
import * as generic from '../src/mcp-server/tools/strategies/generic-filter.js';
import * as fileFilter from '../src/mcp-server/tools/strategies/file-filter.js';
import * as testFilter from '../src/mcp-server/tools/strategies/test-filter.js';
import * as lintFilter from '../src/mcp-server/tools/strategies/lint-filter.js';
import * as secret from '../src/mcp-server/tools/strategies/secret-redactor.js';
import * as jsonFilter from '../src/mcp-server/tools/strategies/json-filter.js';
import * as logFilter from '../src/mcp-server/tools/strategies/log-filter.js';
import * as gitFilter from '../src/mcp-server/tools/strategies/git-filter.js';

function tmpdir(prefix = 'wsr-public-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function textOf(result) {
  if (typeof result === 'string') return result;
  return result.output ?? result.compressed ?? '';
}

test('wisdom exported helpers work end-to-end', () => {
  const project = tmpdir();
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.mkdirSync(path.join(project, 'src', 'lib'), { recursive: true });
  assert.equal(wisdom.findProjectRoot(path.join(project, 'src', 'lib')), project);

  const wisdomDir = wisdom.getWisdomDir(project, true);
  assert.ok(fs.existsSync(wisdomDir));
  assert.ok(Array.isArray(wisdom.readIndex(wisdomDir).files));

  wisdom.writeIndex(wisdomDir, { files: [{ path: 'src/a.js' }], keywords: {} });
  assert.equal(wisdom.readIndex(wisdomDir).files[0].path, 'src/a.js');

  // writeJsonAtomic round-trips and leaves no temp file behind
  const target = path.join(wisdomDir, 'atomic.json');
  wisdom.writeJsonAtomic(target, { ok: true });
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).ok, true);
  assert.ok(!fs.readdirSync(wisdomDir).some((f) => f.endsWith('.tmp')));
});

test('tracker and compression stat exports work', () => {
  const wisdomDir = path.join(tmpdir(), '.wisdom');
  fs.mkdirSync(wisdomDir);

  for (let i = 0; i < 3; i++) tracker.recordHallucination(wisdomDir, 'ghost', 'a.js', 'unknown');
  tracker.recordHallucination(wisdomDir, 'typo', 'b.js', 'fuzzy');
  assert.ok(tracker.getHallucinationPatterns(wisdomDir).frequent.some((p) => p.symbol === 'ghost' && p.count === 3));
  assert.equal(tracker.getWatchlist(wisdomDir).get('ghost'), 3);
  tracker.clearHallucinations(wisdomDir);
  assert.equal(tracker.getHallucinationPatterns(wisdomDir).total, 0);

  compStats.resetStats();
  compStats.recordCompression('npm test', 'test', 100, 20, 80);
  assert.equal(compStats.getStats().totalCommands, 1);
  compStats.resetStats();
  assert.equal(compStats.getStats().totalCommands, 0);
});

test('indexer exported functions scan, report, check, read, and write', () => {
  const project = tmpdir();
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'a.js'), 'export function foo(){}\nconst bar = () => foo();\nclass Baz {}\n');

  const scan = indexer.scanProject(project);
  assert.ok(scan.symbols.functions.foo);
  assert.ok(indexer.generateOverview(project, scan, { detail: 'full' }).includes('foo'));

  const checked = indexer.checkSymbols(['foo', 'fooo', 'missing'], scan.symbols);
  assert.equal(checked.known.length, 1);
  assert.ok(checked.fuzzy.length >= 1);
  assert.equal(checked.unknown.length, 1);

  const wisdomDir = path.join(project, '.wisdom');
  fs.mkdirSync(wisdomDir);
  indexer.writeSymbols(wisdomDir, { _meta: {}, ...scan.symbols });
  assert.ok(indexer.readSymbols(wisdomDir).functions.foo);
});

test('filter and compressor strategy exports produce expected compressed output', () => {
  const compressed = compressOutput('git status', 'On branch main\nmodified: a.js\n', { maxTokens: 1000 });
  assert.ok(compressed.originalTokens > 0);

  assert.ok(dedup.deduplicateLines('x\nx\nx\nx').compressed.includes('[×4]'));
  assert.ok(dedup.groupSimilarLines('error one a\nerror one b\nerror one c').compressed.includes('error one'));

  assert.equal(generic.stripAnsi('\u001b[31mx\u001b[0m'), 'x');
  assert.equal(generic.stripProgress('10%\nok').trim(), 'ok');
  assert.ok(generic.smartTruncate('a'.repeat(5000), 100).compressed.includes('omitted'));
  assert.equal(generic.normalizeWhitespace('a\n\n\n b').includes('\n\n\n'), false);
  assert.ok(generic.filterGeneric('a'.repeat(5000), 100).compressed);

  assert.ok(textOf(fileFilter.filterDirListing('Mode Length Name\n-a 1 a.js')));
  assert.ok(textOf(fileFilter.filterTreeOutput('root\n├── a\n└── b')));
  assert.ok(textOf(fileFilter.filterFileContent('line\n'.repeat(200), 'aggressive')));
  assert.ok(textOf(fileFilter.filterFile('a\n'.repeat(200), [], 'cat file.js')));

  assert.ok(textOf(testFilter.filterTestOutput('1 failed\nError: boom')).includes('boom'));
  assert.ok(textOf(testFilter.filterTest('1 failed\nError: boom', [])));
  assert.ok(textOf(lintFilter.filterLintOutput('a.ts(1,2): error TS1234: bad')).includes('TS1234'));
  assert.ok(textOf(lintFilter.filterLint('a.ts(1,2): error TS1234: bad', [])));
  assert.ok(textOf(jsonFilter.filterJsonOutput(JSON.stringify({ a: 1, b: { c: 2 } }))).includes('a'));
  assert.ok(textOf(jsonFilter.filterJson('{"a":1}', [])));
  assert.ok(textOf(logFilter.filterLogOutput('[2026-01-01T00:00:00Z] hello')).includes('hello'));
  assert.ok(textOf(logFilter.filterLog('2026-01-01T00:00:00Z hello', [])));
  assert.ok(textOf(gitFilter.filterGitStatus('Changes not staged for commit:\n  modified:   a.js\n\nUntracked files:\n  b.js\n')).includes('modified'));
  assert.ok(textOf(gitFilter.filterGitDiff('diff --git a/a b/a\n+hello', [])));
  assert.ok(textOf(gitFilter.filterGitLog('abc msg\ndef msg')));
  assert.ok(textOf(gitFilter.filterGitAction('main -> origin/main', 'push')));
  assert.ok(textOf(gitFilter.filterGit(' M a.js', ['status'])));

  const secretText = `OPENAI KEY sk-${'a'.repeat(48)} done`;
  assert.ok(secret.redactSecrets(secretText).includes('[REDACTED:OPENAI_KEY]'));
  assert.equal(secret.countRedactions(secretText), 1);
  assert.ok(secret.SECRETS_PATTERNS.length > 0);
});

test('MCP tool handlers exercise success and failure paths', async () => {
  const project = tmpdir();
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.writeFileSync(path.join(project, 'a.js'), 'export function foo(){}\n');

  assert.ok((await handleReindexProject({ project_path: project })).content[0].text.includes('Indexed'));
  assert.ok((await handleCheckSymbols({ project_path: project, symbols: ['foo'] })).content[0].text.includes('confirmed'));
  assert.ok((await handleGetProjectOverview({ project_path: project, maxFiles: 10 })).content[0].text.includes('Project Overview'));
  assert.ok((await handleRefreshSymbols({ project_path: project })).content[0].text.includes('Indexed'));

  assert.ok((await compressOutputHandler({ command: 'node -e "console.log(42)"', maxTokens: 200 })).content[0].text.includes('42'));
  assert.equal((await compressOutputHandler({ command: 'node -e "process.exit(7)"', maxTokens: 200 })).isError, true);

  assert.ok((await detectEnvironmentHandler()).system);
  assert.ok(JSON.parse((await handleDetectEnvironment({})).content[0].text).system);
  assert.ok((await handleDetectEnvironment({ compact: true })).content[0].text.includes('Recommended shell'));

  tracker.recordHallucination(path.join(project, '.wisdom'), 'ghost', 'x.js', 'unknown');
  assert.ok((await handleHallucinationReport({ project_path: project })).content[0].text.includes('ghost'));
  assert.ok((await handleCompressionStats()).content[0].text.includes('Compression'));
});

test('zero-trust exported helpers work without import side effects', () => {
  const project = tmpdir();
  const wisdomDir = path.join(project, '.wisdom');
  fs.mkdirSync(wisdomDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  fs.writeFileSync(path.join(wisdomDir, 'hallucinations.json'), JSON.stringify([{ symbol: 'ghost' }, { symbol: 'ghost' }, { symbol: 'ghost' }]));
  fs.writeFileSync(path.join(wisdomDir, 'symbols.json'), JSON.stringify({
    _meta: { scanned: new Date().toISOString(), file_count: 1 },
    functions: { foo: {} },
    classes: {},
    variables: {},
    exports: {}
  }));

  assert.equal(zt.findProjectRoot(path.join(project, 'x')), project);
  assert.equal(zt.loadWatchlist(wisdomDir)[0].symbol, 'ghost');
  assert.equal(zt.loadRegistryMeta(wisdomDir).totalSymbols, 1);
  assert.equal(zt.timeSince('not-a-date'), 'unknown');
  assert.ok(zt.CORE_RULES.length > 0);
  assert.ok(zt.HEADER.includes('Zero-Trust'));
});
