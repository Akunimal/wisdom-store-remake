#!/usr/bin/env node
/**
 * Symbol-extraction precision benchmark.
 *
 * Runs the indexer against a fixed corpus of fixtures with hand-labelled
 * ground-truth symbols, then reports recall (did we find the real symbols?)
 * and precision (did we avoid inventing fake ones?) per language and overall.
 *
 * Run: `npm run benchmark`. Exits non-zero if recall or precision falls below
 * the thresholds, so CI catches extractor regressions.
 *
 * Recall    = correctly-found symbols / expected symbols
 * Precision = correctly-found symbols / all extracted symbols
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanProject } from '../src/mcp-server/lib/indexer.js';

const MIN_RECALL = 0.90;
const MIN_PRECISION = 0.90;

// Each fixture lists the EXHAUSTIVE set of symbols (functions + classes/types)
// the extractor is expected to produce — anything extra counts against precision.
const FIXTURES = [
  {
    lang: 'JavaScript', file: 'a.js',
    code: 'export function alpha(a, b){ return a; }\nconst beta = () => 1;\nclass Gamma {}\nclass Delta { ping(){} }\n',
    expected: ['alpha', 'beta', 'Gamma', 'Delta', 'ping']
  },
  {
    lang: 'TypeScript', file: 'a.ts',
    code: 'export interface User { id: string }\nexport type Id = string;\nexport class Svc { run(): void {} }\nexport function parse(x: string): number { return 1; }\n',
    expected: ['User', 'Id', 'Svc', 'run', 'parse']
  },
  {
    lang: 'Python', file: 'a.py',
    code: 'def alpha(a, b):\n    return a\nclass Beta:\n    def method(self):\n        pass\n',
    expected: ['alpha', 'Beta', 'method']
  },
  {
    lang: 'Go', file: 'a.go',
    code: 'package x\nfunc Alpha(a int) int { return a }\ntype Beta struct{}\nfunc (b Beta) Ping() {}\n',
    expected: ['Alpha', 'Beta', 'Ping']
  },
  {
    lang: 'Rust', file: 'a.rs',
    code: 'pub fn alpha() {}\nstruct Beta;\nenum Gamma { A }\ntrait Delta {}\n',
    expected: ['alpha', 'Beta', 'Gamma', 'Delta']
  },
  {
    lang: 'Java', file: 'A.java',
    code: 'public class Account {\n  public void deposit(int a) {}\n  private int balance() { return 0; }\n}\ninterface Ledger {}\nenum Currency { USD }\n',
    expected: ['Account', 'deposit', 'balance', 'Ledger', 'Currency']
  },
  {
    lang: 'C#', file: 'A.cs',
    code: 'public class Service {\n  public async Task Run() {}\n  private int Count() { return 0; }\n}\ninterface IThing {}\n',
    expected: ['Service', 'Run', 'Count', 'IThing']
  },
  {
    lang: 'Ruby', file: 'a.rb',
    code: 'module Auth\n  class Session\n    def login\n    end\n    def self.reset\n    end\n  end\nend\n',
    expected: ['Auth', 'Session', 'login', 'reset']
  },
  {
    lang: 'PHP', file: 'a.php',
    code: '<?php\nfunction handle($r) {}\nclass Controller {}\ntrait Loggable {}\ninterface Renderable {}\n',
    expected: ['handle', 'Controller', 'Loggable', 'Renderable']
  },
  {
    lang: 'Kotlin', file: 'a.kt',
    code: 'fun greet(name: String) {}\nclass Repo {}\nobject Singleton {}\ninterface Service {}\n',
    expected: ['greet', 'Repo', 'Singleton', 'Service']
  },
  {
    lang: 'Swift', file: 'a.swift',
    code: 'func compute(_ x: Int) -> Int { return x }\nstruct Point {}\nprotocol Drawable {}\nenum State {}\n',
    expected: ['compute', 'Point', 'Drawable', 'State']
  },
  {
    lang: 'C', file: 'a.c',
    code: 'struct Node { int v; };\nint add(int a, int b) {\n  return a + b;\n}\nvoid noop(void) {}\n',
    expected: ['Node', 'add', 'noop']
  }
];

function extractedNames(symbols) {
  const names = new Set();
  for (const cat of ['functions', 'classes']) {
    for (const n of Object.keys(symbols[cat] || {})) names.add(n);
  }
  return names;
}

function main() {
  const rows = [];
  let totalExpected = 0;
  let totalFound = 0;
  let totalExtracted = 0;

  for (const fx of FIXTURES) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-bench-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, fx.file), fx.code);
    const { symbols } = scanProject(dir);
    const got = extractedNames(symbols);

    const expected = new Set(fx.expected);
    const found = [...expected].filter((n) => got.has(n));
    const extra = [...got].filter((n) => !expected.has(n));

    const recall = found.length / expected.size;
    const precision = got.size === 0 ? 1 : found.length / got.size;

    totalExpected += expected.size;
    totalFound += found.length;
    totalExtracted += got.size;

    rows.push({
      lang: fx.lang,
      recall,
      precision,
      missed: [...expected].filter((n) => !got.has(n)),
      extra
    });
  }

  const overallRecall = totalFound / totalExpected;
  const overallPrecision = totalFound / totalExtracted;

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log('Symbol-extraction precision benchmark\n');
  console.log('Language        Recall   Precision  Notes');
  console.log('--------------- -------- ---------- ---------------------------');
  for (const r of rows) {
    const notes = [];
    if (r.missed.length) notes.push(`missed: ${r.missed.join(',')}`);
    if (r.extra.length) notes.push(`extra: ${r.extra.join(',')}`);
    console.log(`${r.lang.padEnd(15)} ${pct(r.recall).padEnd(8)} ${pct(r.precision).padEnd(10)} ${notes.join(' | ')}`);
  }
  console.log('--------------- -------- ---------- ---------------------------');
  console.log(`${'OVERALL'.padEnd(15)} ${pct(overallRecall).padEnd(8)} ${pct(overallPrecision).padEnd(10)} ${FIXTURES.length} languages, ${totalExpected} symbols`);

  const ok = overallRecall >= MIN_RECALL && overallPrecision >= MIN_PRECISION;
  console.log(`\nThresholds: recall ≥ ${pct(MIN_RECALL)}, precision ≥ ${pct(MIN_PRECISION)} → ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}

main();
