import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanProject } from '../src/mcp-server/lib/indexer.js';

function projectWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-lang-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function names(cat) {
  return new Set(Object.keys(cat));
}

test('Java: classes, interfaces, enums, methods', () => {
  const dir = projectWith({
    'A.java': [
      'public class Account {',
      '  public void deposit(int amount) {}',
      '  private int balance() { return 0; }',
      '}',
      'interface Ledger {}',
      'enum Currency { USD, EUR }',
    ].join('\n')
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.classes).has('Account'));
  assert.ok(names(symbols.classes).has('Ledger'));
  assert.ok(names(symbols.classes).has('Currency'));
  assert.ok(names(symbols.functions).has('deposit'));
  assert.ok(names(symbols.functions).has('balance'));
  // Control-flow keywords must not be captured as methods
  assert.ok(!names(symbols.functions).has('if'));
});

test('C#: namespace, class, method', () => {
  const dir = projectWith({
    'S.cs': [
      'namespace App.Core {',
      '  public class Service {',
      '    public async Task Run() {}',
      '  }',
      '}',
    ].join('\n')
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.classes).has('Service'));
  assert.ok(names(symbols.functions).has('Run'));
});

test('Ruby: def, class, module', () => {
  const dir = projectWith({
    'r.rb': 'module Auth\n  class Session\n    def login!\n    end\n    def self.reset\n    end\n  end\nend\n'
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.classes).has('Auth'));
  assert.ok(names(symbols.classes).has('Session'));
  assert.ok(names(symbols.functions).has('login!'));
  assert.ok(names(symbols.functions).has('reset'));
});

test('PHP: function, class, trait', () => {
  const dir = projectWith({
    'p.php': '<?php\nfunction handle($req) {}\nclass Controller {}\ntrait Loggable {}\n'
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.functions).has('handle'));
  assert.ok(names(symbols.classes).has('Controller'));
  assert.ok(names(symbols.classes).has('Loggable'));
});

test('Kotlin: fun, class, object', () => {
  const dir = projectWith({
    'k.kt': 'fun greet(name: String) {}\nclass Repo {}\nobject Singleton {}\ndata class User(val id: Int)\n'
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.functions).has('greet'));
  assert.ok(names(symbols.classes).has('Repo'));
  assert.ok(names(symbols.classes).has('Singleton'));
  assert.ok(names(symbols.classes).has('User'));
});

test('Swift: func, struct, protocol', () => {
  const dir = projectWith({
    's.swift': 'func compute(_ x: Int) -> Int { return x }\nstruct Point {}\nprotocol Drawable {}\nenum State {}\n'
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.functions).has('compute'));
  assert.ok(names(symbols.classes).has('Point'));
  assert.ok(names(symbols.classes).has('Drawable'));
  assert.ok(names(symbols.classes).has('State'));
});

test('C/C++: function definitions and structs', () => {
  const dir = projectWith({
    'm.c': [
      '#include <stdio.h>',
      'struct Node { int v; };',
      'int add(int a, int b) {',
      '  return a + b;',
      '}',
      'void noop(void) {}',
      'int main() {',
      '  if (add(1, 2)) {}',  // call, not a definition
      '  return 0;',
      '}',
    ].join('\n')
  });
  const { symbols } = scanProject(dir);
  assert.ok(names(symbols.classes).has('Node'));
  assert.ok(names(symbols.functions).has('add'));
  assert.ok(names(symbols.functions).has('noop'));
  assert.ok(names(symbols.functions).has('main'));
  // `if (...)` inside main must not be a function
  assert.ok(!names(symbols.functions).has('if'));
});
