/**
 * Project indexer and symbol extraction using @ast-grep/napi.
 *
 * AST-based symbol extraction supporting:
 * - JavaScript/TypeScript/TSX: functions, classes, variables, exports, interfaces, types, enums (AST via ast-grep)
 * - Python: functions, classes, variables (regex fallback)
 * - Go: functions, types, structs (regex fallback)
 * - Rust: functions, structs, enums, traits (regex fallback)
 * - Bash/Shell: functions (regex fallback)
 * - SQL: tables, views, functions, procedures (regex fallback)
 * - YAML: top-level keys as config variables (regex fallback)
 * - HTML: pages, titles, script dependencies, inline functions
 *
 * JS/TS uses proper AST parsing via ast-grep (tree-sitter).
 * Other languages use regex as fallback until their ast-grep lang plugins are added.
 *
 * Benchmarked: ~0.35ms/file parse, ~69ms full project scan (103 files).
 */

import fs from 'fs';
import path from 'path';
import { parse, Lang, registerDynamicLanguage } from '@ast-grep/napi';
import { createRequire } from 'module';
import { writeJsonAtomic } from './wisdom.js';
import { levenshtein } from './levenshtein.js';

const require = createRequire(import.meta.url);

// Directories that are never source code — cannot be overridden
const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.wisdom', '.claude', 'dist', 'build',
  'coverage', '.next', '__pycache__', '.tox', '.venv', 'venv',
  'vendor', 'target', '.cache', '.turbo',
]);

// Skipped by default but overridable via includeDirs
// (.wisdom/config.json or scan options)
const DEFAULT_SKIP = new Set([
  '.github',
  // Backups / archive / generated
  'archive', 'backups', 'backup', 'logs', 'tmp',
  'uploads', 'media', 'data',
  // Non-code / static content
  'content', 'public', 'static', 'assets',
]);

// Max alternate definition sites tracked per symbol name
const MAX_LOCATIONS = 5;

// Bump to invalidate existing scan caches when the format changes
const SCAN_CACHE_VERSION = 1;

// File extensions and their ast-grep language (or 'regex' for fallback)
const LANG_MAP = {
  '.js': { lang: Lang.JavaScript, name: 'javascript' },
  '.mjs': { lang: Lang.JavaScript, name: 'javascript' },
  '.cjs': { lang: Lang.JavaScript, name: 'javascript' },
  '.jsx': { lang: Lang.JavaScript, name: 'javascript' },
  '.ts': { lang: Lang.TypeScript, name: 'typescript' },
  '.tsx': { lang: Lang.Tsx, name: 'typescript' },
  '.py': { lang: null, name: 'python' },
  '.go': { lang: null, name: 'go' },
  '.rs': { lang: null, name: 'rust' },
  '.html': { lang: null, name: 'html' },
  '.sh': { lang: null, name: 'bash' },
  '.bash': { lang: null, name: 'bash' },
  '.sql': { lang: null, name: 'sql' },
  '.yaml': { lang: null, name: 'yaml' },
  '.yml': { lang: null, name: 'yaml' },
  '.json': { lang: null, name: 'json' },
  '.md': { lang: null, name: 'markdown' },
  // Regex-extracted languages (no AST grammar bundled — symbol-existence only)
  '.java': { lang: null, name: 'java' },
  '.cs': { lang: null, name: 'csharp' },
  '.rb': { lang: null, name: 'ruby' },
  '.php': { lang: null, name: 'php' },
  '.kt': { lang: null, name: 'kotlin' },
  '.kts': { lang: null, name: 'kotlin' },
  '.swift': { lang: null, name: 'swift' },
  '.c': { lang: null, name: 'c' },
  '.h': { lang: null, name: 'c' },
  '.cpp': { lang: null, name: 'cpp' },
  '.cc': { lang: null, name: 'cpp' },
  '.cxx': { lang: null, name: 'cpp' },
  '.hpp': { lang: null, name: 'cpp' },
  '.scala': { lang: null, name: 'scala' },
};

// Extensions the scanner extracts symbols from — used by the file watcher to
// decide which change events warrant an incremental rescan.
export const CODE_EXTENSIONS = new Set(Object.keys(LANG_MAP));

function emptySymbols() {
  return {
    functions: {},
    classes: {},
    variables: {},
    exports: {},
    apiRoutes: {},
    htmlPages: {},
  };
}

/**
 * Read optional scan configuration from .wisdom/config.json.
 * Supported keys: skipDirs (extra dirs to skip), includeDirs (override default skips).
 */
function readScanConfig(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.wisdom', 'config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Scan a project directory and extract all symbols.
 *
 * Options:
 * - maxDepth (default 8), maxFiles (default 2000)
 * - skipDirs / includeDirs: extend or override the default skip list
 *   (also configurable via .wisdom/config.json)
 * - incremental (default true): reuse .wisdom/scan-cache.json for files
 *   whose mtime+size are unchanged since the last scan
 *
 * Returns { files, symbols, truncated, cacheHits }.
 */
export function scanProject(projectRoot, options = {}) {
  initDynamicLanguages(); // Attempt to load tree-sitter grammars if available

  const config = readScanConfig(projectRoot);
  const skip = new Set(DEFAULT_SKIP);
  for (const d of config.skipDirs || []) skip.add(d);
  for (const d of options.skipDirs || []) skip.add(d);
  const include = new Set([...(config.includeDirs || []), ...(options.includeDirs || [])]);

  const incremental = options.incremental !== false;
  const cache = incremental ? readScanCache(projectRoot) : null;

  const ctx = {
    projectRoot,
    maxDepth: options.maxDepth || 8,
    maxFiles: options.maxFiles || 2000,
    files: [],
    symbols: emptySymbols(),
    skip,
    include,
    extraSkip: readGitignoreDirs(projectRoot),
    cache: cache?.files || {},
    newCache: { version: SCAN_CACHE_VERSION, files: {} },
    truncated: false,
    cacheHits: 0,
  };

  walkDir(projectRoot, ctx, 0);

  if (incremental) writeScanCache(projectRoot, ctx.newCache);

  return {
    files: ctx.files,
    symbols: ctx.symbols,
    truncated: ctx.truncated,
    cacheHits: ctx.cacheHits,
  };
}

let dynamicLangsRegistered = false;
function initDynamicLanguages() {
  if (dynamicLangsRegistered) return;
  dynamicLangsRegistered = true;

  const toRegister = {};
  function findPrebuild(packageName) {
    try {
      const pkgPath = require.resolve(packageName + '/package.json');
      const pkgDir = path.dirname(pkgPath);
      const prebuildDir = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`);
      if (fs.existsSync(prebuildDir)) {
        const files = fs.readdirSync(prebuildDir);
        const nodeFile = files.find(f => f.endsWith('.node'));
        if (nodeFile) return path.join(prebuildDir, nodeFile);
      }
    } catch (e) {}
    return null;
  }

  // Map ext → LANG_MAP lang value to apply only after a successful register.
  // Assigning before registration risks pointing .py/.go/.rs at a grammar
  // that never registered (ABI mismatch, bad prebuild) — every parse would
  // then fail and the file would yield zero symbols.
  const pending = [];

  const pyPath = findPrebuild('tree-sitter-python');
  if (pyPath) {
    toRegister['Python'] = { libraryPath: pyPath, extensions: ['py'], languageSymbol: 'tree_sitter_python' };
    pending.push(['.py', 'Python']);
  }

  const goPath = findPrebuild('tree-sitter-go');
  if (goPath) {
    toRegister['Go'] = { libraryPath: goPath, extensions: ['go'], languageSymbol: 'tree_sitter_go' };
    pending.push(['.go', 'Go']);
  }

  const rustPath = findPrebuild('tree-sitter-rust');
  if (rustPath) {
    toRegister['Rust'] = { libraryPath: rustPath, extensions: ['rs'], languageSymbol: 'tree_sitter_rust' };
    pending.push(['.rs', 'Rust']);
  }

  if (Object.keys(toRegister).length > 0) {
    try {
      registerDynamicLanguage(toRegister);
      // Only now is it safe to route these extensions through the AST path.
      for (const [ext, lang] of pending) LANG_MAP[ext].lang = lang;
    } catch (e) {
      // Registration failed — leave LANG_MAP[ext].lang === null so these
      // languages fall back to regex extraction instead of failing every parse.
      console.error("Anti-Hallucination: Failed to register dynamic AST languages, using regex fallback", e);
    }
  }
}

/**
 * Parse .gitignore for directory entries to skip.
 * Only extracts simple directory patterns (no globs).
 * Negated entries (`!dir`) remove a previously added skip.
 */
function readGitignoreDirs(projectRoot) {
  const dirs = new Set();
  const gitignorePath = path.join(projectRoot, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const negated = trimmed.startsWith('!');
      const pattern = negated ? trimmed.slice(1) : trimmed;
      // Match directory entries like "Website/" or "GoogleDrive"
      const dirMatch = pattern.match(/^([a-zA-Z0-9_-]+)\/?$/);
      if (dirMatch) {
        if (negated) dirs.delete(dirMatch[1]);
        else dirs.add(dirMatch[1]);
      }
    }
  } catch { /* no .gitignore */ }
  return dirs;
}

function readScanCache(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.wisdom', 'scan-cache.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === SCAN_CACHE_VERSION && parsed.files) return parsed;
  } catch { /* no cache or unreadable — full scan */ }
  return null;
}

/**
 * Validate a cache entry's shape before trusting it. A malformed entry
 * (old format, hand-edited, truncated) must force a reparse rather than
 * crash mergeFileSymbols or silently contribute nothing.
 */
function isValidCacheEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.lang !== 'string') return false;
  const s = entry.symbols;
  if (!s || typeof s !== 'object') return false;
  for (const cat of ['functions', 'classes', 'variables', 'exports']) {
    if (!s[cat] || typeof s[cat] !== 'object') return false;
  }
  return true;
}

function writeScanCache(projectRoot, cache) {
  // Only persist if .wisdom/ already exists — a direct scanProject() call on
  // a project that never opted into .wisdom/ must not create directories.
  // (The MCP tools create .wisdom/ themselves via getWisdomDir before scanning.)
  const wisdomDir = path.join(projectRoot, '.wisdom');
  try {
    if (!fs.existsSync(wisdomDir)) return;
    writeJsonAtomic(path.join(wisdomDir, 'scan-cache.json'), cache);
  } catch { /* cache is best-effort */ }
}

/**
 * Merge one file's symbols into the global registry.
 * Same name in multiple files: first occurrence keeps file/line,
 * additional files are recorded in a `locations` array (capped).
 */
function mergeFileSymbols(globalSymbols, fileSymbols) {
  for (const cat of ['functions', 'classes', 'variables', 'exports']) {
    for (const [name, entry] of Object.entries(fileSymbols[cat] || {})) {
      const existing = globalSymbols[cat][name];
      if (!existing) {
        globalSymbols[cat][name] = { ...entry };
        continue;
      }
      existing.usages += entry.usages;
      if (existing.file !== entry.file) {
        if (!existing.locations) existing.locations = [{ file: existing.file, line: existing.line }];
        if (existing.locations.length < MAX_LOCATIONS &&
            !existing.locations.some(l => l.file === entry.file)) {
          existing.locations.push({ file: entry.file, line: entry.line });
        }
      }
    }
  }
  for (const [key, info] of Object.entries(fileSymbols.apiRoutes || {})) {
    if (!globalSymbols.apiRoutes[key]) globalSymbols.apiRoutes[key] = info;
  }
  for (const [name, info] of Object.entries(fileSymbols.htmlPages || {})) {
    if (!globalSymbols.htmlPages[name]) globalSymbols.htmlPages[name] = info;
  }
}

function walkDir(dir, ctx, depth) {
  if (depth > ctx.maxDepth) return;
  if (ctx.files.length >= ctx.maxFiles) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (ctx.files.length >= ctx.maxFiles) {
      ctx.truncated = true;
      break;
    }

    const name = entry.name;
    const fullPath = path.join(dir, name);

    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(name)) continue;
      if (!ctx.include.has(name)) {
        if (name.startsWith('.')) continue;
        if (ctx.skip.has(name)) continue;
        if (ctx.extraSkip.has(name)) continue;
        // Skip dirs with spaces (usually backups/copies) or containing 'backup'/'Backup'
        if (name.includes(' ') || /backup/i.test(name)) continue;
      }
      walkDir(fullPath, ctx, depth + 1);
      continue;
    }

    if (name.startsWith('.')) continue;

    const ext = path.extname(name);
    const langInfo = LANG_MAP[ext];
    if (!langInfo) continue;

    const relPath = path.relative(ctx.projectRoot, fullPath);

    try {
      const stat = fs.statSync(fullPath);
      // HTML monoliths (e.g. admin_tickets.html) can be large but we only
      // extract inline <script> blocks, so allow up to 5MB for HTML files
      const sizeLimit = langInfo.name === 'html' ? 5 * 1024 * 1024 : 500 * 1024;
      if (stat.size > sizeLimit) continue;

      // Incremental: reuse cached symbols when mtime+size unchanged.
      // isValidCacheEntry guards against a malformed/old cache shape — a bad
      // entry must trigger a reparse, not be merged (TypeError) or skipped.
      const cached = ctx.cache[relPath];
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size &&
          isValidCacheEntry(cached)) {
        ctx.files.push({
          path: relPath,
          lang: cached.lang,
          lines: cached.lines,
          size: cached.size,
          modified: cached.modified
        });
        mergeFileSymbols(ctx.symbols, cached.symbols);
        ctx.newCache.files[relPath] = cached;
        ctx.cacheHits++;
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      ctx.files.push({
        path: relPath,
        lang: langInfo.name,
        lines: lines.length,
        size: stat.size,
        modified: stat.mtime.toISOString().split('T')[0]
      });

      const fileSymbols = emptySymbols();
      if (langInfo.name === 'html') {
        extractHtml(relPath, content, fileSymbols);
      } else if (langInfo.lang) {
        // AST parse can fail on partial/invalid syntax (a file mid-edit) or a
        // grammar that did not register. Fall back to regex so the file still
        // contributes symbols instead of being reported as all-unknown.
        const parsed = extractWithAst(relPath, content, langInfo.lang, fileSymbols);
        if (!parsed) {
          extractWithRegex(relPath, lines, langInfo.name, fileSymbols);
        }
      } else {
        extractWithRegex(relPath, lines, langInfo.name, fileSymbols);
      }
      mergeFileSymbols(ctx.symbols, fileSymbols);

      ctx.newCache.files[relPath] = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        lang: langInfo.name,
        lines: lines.length,
        modified: stat.mtime.toISOString().split('T')[0],
        symbols: fileSymbols
      };
    } catch { /* skip unreadable/unparseable files */ }
  }
}

/**
 * Extract symbols using ast-grep AST parsing.
 * Returns true if parsing+extraction ran, false if the parse failed
 * (so callers can fall back to regex extraction).
 */
function extractWithAst(filePath, content, lang, symbols, lineOffset = 0) {
  let root;
  try {
    root = parse(lang, content).root();
  } catch {
    return false;
  }

  try {
    if (lang === Lang.JavaScript || lang === Lang.TypeScript || lang === Lang.Tsx) {
      extractJsAstSymbols(root, filePath, lang, symbols, lineOffset);
    } else if (lang === 'Python') {
      extractPythonAstSymbols(root, filePath, symbols, lineOffset);
    } else if (lang === 'Go') {
      extractGoAstSymbols(root, filePath, symbols, lineOffset);
    } else if (lang === 'Rust') {
      extractRustAstSymbols(root, filePath, symbols, lineOffset);
    }
  } catch (e) {
    // AST extraction failed — continue without losing other files' data
  }
  return true;
}

function extractNamesFromNode(nameNode) {
  const kind = nameNode.kind();
  const nodes = [];
  if (kind === 'identifier') {
    nodes.push(nameNode);
  } else if (kind === 'array_pattern' || kind === 'object_pattern') {
    const ids = nameNode.findAll({ rule: { kind: 'identifier' } });
    for (const id of ids) nodes.push(id);
    const shorthands = nameNode.findAll({ rule: { kind: 'shorthand_property_identifier_pattern' } });
    for (const sh of shorthands) nodes.push(sh);
  }
  return nodes;
}

function extractJsAstSymbols(root, filePath, lang, symbols, lineOffset = 0) {
  const isTS = (lang === Lang.TypeScript || lang === Lang.Tsx);

  // Extract function declarations
  const funcDecls = root.findAll({ rule: { kind: 'function_declaration' } });
  for (const node of funcDecls) {
    const name = node.field('name');
    if (name) addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  // Extract arrow/const functions: const foo = (...) => or const foo = function
  const lexDecls = root.findAll({ rule: { kind: 'lexical_declaration' } });
  for (const node of lexDecls) {
    const declarators = node.findAll({ rule: { kind: 'variable_declarator' } });
    for (const decl of declarators) {
      const nameNode = decl.field('name');
      const valueNode = decl.field('value');
      if (!nameNode) continue;

      const valueKind = valueNode?.kind();
      const extractedNodes = extractNamesFromNode(nameNode);

      for (const nNode of extractedNodes) {
        if (valueKind === 'arrow_function' || valueKind === 'function_expression') {
          addSymbol(symbols.functions, nNode.text(), filePath, nNode.range().start.line + 1 + lineOffset);
        } else {
          // Regular variable
          addSymbol(symbols.variables, nNode.text(), filePath, nNode.range().start.line + 1 + lineOffset);
        }
      }
    }
  }

  // var declarations
  const varDecls = root.findAll({ rule: { kind: 'variable_declaration' } });
  for (const node of varDecls) {
    const declarators = node.findAll({ rule: { kind: 'variable_declarator' } });
    for (const decl of declarators) {
      const nameNode = decl.field('name');
      const valueNode = decl.field('value');
      if (!nameNode) continue;

      const valueKind = valueNode?.kind();
      const extractedNodes = extractNamesFromNode(nameNode);

      for (const nNode of extractedNodes) {
        if (valueKind === 'arrow_function' || valueKind === 'function_expression') {
          addSymbol(symbols.functions, nNode.text(), filePath, nNode.range().start.line + 1 + lineOffset);
        } else {
          addSymbol(symbols.variables, nNode.text(), filePath, nNode.range().start.line + 1 + lineOffset);
        }
      }
    }
  }

  // Extract class declarations
  const classDecls = root.findAll({ rule: { kind: 'class_declaration' } });
  for (const node of classDecls) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  // Extract method definitions inside classes
  const methods = root.findAll({ rule: { kind: 'method_definition' } });
  for (const node of methods) {
    const name = node.field('name');
    if (name && name.text() !== 'constructor') {
      addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
    }
  }

  // TypeScript-specific: interfaces, type aliases, enums
  if (isTS) {
    const interfaces = root.findAll({ rule: { kind: 'interface_declaration' } });
    for (const node of interfaces) {
      const name = node.field('name');
      if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
    }

    const typeAliases = root.findAll({ rule: { kind: 'type_alias_declaration' } });
    for (const node of typeAliases) {
      const name = node.field('name');
      if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
    }

    const enums = root.findAll({ rule: { kind: 'enum_declaration' } });
    for (const node of enums) {
      const name = node.field('name');
      if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
    }
  }

  // Extract exports
  const exportStmts = root.findAll({ rule: { kind: 'export_statement' } });
  for (const node of exportStmts) {
    // export function foo / export class Bar / export const baz
    const declaration = node.field('declaration');
    if (declaration) {
      const nameNode = declaration.field('name');
      if (nameNode) {
        addSymbol(symbols.exports, nameNode.text(), filePath, nameNode.range().start.line + 1 + lineOffset);
      } else if (declaration.kind() === 'lexical_declaration' || declaration.kind() === 'variable_declaration') {
        // export const foo = ...
        const declarators = declaration.findAll({ rule: { kind: 'variable_declarator' } });
        for (const decl of declarators) {
          const n = decl.field('name');
          if (!n) continue;
          const extractedNodes = extractNamesFromNode(n);
          for (const nNode of extractedNodes) {
            addSymbol(symbols.exports, nNode.text(), filePath, nNode.range().start.line + 1 + lineOffset);
          }
        }
      }
    }

    // export { foo, bar }
    const exportClause = node.findAll({ rule: { kind: 'export_specifier' } });
    for (const spec of exportClause) {
      const nameNode = spec.field('name');
      if (nameNode) addSymbol(symbols.exports, nameNode.text(), filePath, nameNode.range().start.line + 1 + lineOffset);
    }

    // export default
    const value = node.field('value');
    if (value && value.kind() === 'identifier') {
      addSymbol(symbols.exports, value.text(), filePath, value.range().start.line + 1 + lineOffset);
    }
  }

  // CommonJS exports (module.exports.foo = ..., exports.foo = ...)
  // Use regex on source lines since AST structure for these is generic assignment_expression
  const sourceLines = root.text().split('\n');
  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];

    // exports.foo = ... or module.exports.foo = ...
    const memberExport = line.match(/^(?:module\.)?exports\.(\w+)\s*=/);
    if (memberExport) {
      addSymbol(symbols.exports, memberExport[1], filePath, i + 1 + lineOffset);
      continue;
    }

    // module.exports = { foo, bar, baz } or module.exports = { foo: ..., bar: ... }
    const bulkExport = line.match(/^module\.exports\s*=\s*\{([^}]+)\}/);
    if (bulkExport) {
      const names = bulkExport[1].split(',').map(s => s.trim().split(/[:\s]/)[0].trim());
      for (const name of names) {
        if (name && /^\w+$/.test(name)) {
          addSymbol(symbols.exports, name, filePath, i + 1 + lineOffset);
        }
      }
    }

    // Express API routes: router.get('/path', ...) or app.get('/path', ...)
    const routeMatch = line.match(/(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (routeMatch) {
      const method = routeMatch[1].toUpperCase();
      const routePath = routeMatch[2];
      const key = `${method} ${routePath}`;
      if (!symbols.apiRoutes[key]) {
        symbols.apiRoutes[key] = { file: filePath, line: i + 1 + lineOffset, method, path: routePath };
      }
      continue;
    }

    // Route mount: app.use('/api/tickets', ticketRoutes)
    const mountMatch = line.match(/app\.use\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (mountMatch && mountMatch[1].startsWith('/api')) {
      const mountPath = mountMatch[1];
      const key = `MOUNT ${mountPath}`;
      if (!symbols.apiRoutes[key]) {
        symbols.apiRoutes[key] = { file: filePath, line: i + 1 + lineOffset, method: 'MOUNT', path: mountPath };
      }
    }
  }
}

function extractPythonAstSymbols(root, filePath, symbols, lineOffset = 0) {
  const funcs = root.findAll({ rule: { kind: 'function_definition' } });
  for (const node of funcs) {
    const name = node.field('name');
    if (name) addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const classes = root.findAll({ rule: { kind: 'class_definition' } });
  for (const node of classes) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }
}

function extractGoAstSymbols(root, filePath, symbols, lineOffset = 0) {
  const funcs = root.findAll({ rule: { kind: 'function_declaration' } });
  for (const node of funcs) {
    const name = node.field('name');
    if (name) addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const methods = root.findAll({ rule: { kind: 'method_declaration' } });
  for (const node of methods) {
    const name = node.field('name');
    if (name) addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const types = root.findAll({ rule: { kind: 'type_spec' } });
  for (const node of types) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }
}

function extractRustAstSymbols(root, filePath, symbols, lineOffset = 0) {
  const funcs = root.findAll({ rule: { kind: 'function_item' } });
  for (const node of funcs) {
    const name = node.field('name');
    if (name) addSymbol(symbols.functions, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const structs = root.findAll({ rule: { kind: 'struct_item' } });
  for (const node of structs) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const enums = root.findAll({ rule: { kind: 'enum_item' } });
  for (const node of enums) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }

  const traits = root.findAll({ rule: { kind: 'trait_item' } });
  for (const node of traits) {
    const name = node.field('name');
    if (name) addSymbol(symbols.classes, name.text(), filePath, name.range().start.line + 1 + lineOffset);
  }
}

/**
 * Regex fallback for Python/Go/Rust.
 */
function extractWithRegex(filePath, lines, lang, symbols, lineOffset = 0) {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      extractJsRegex(filePath, lines, symbols, lineOffset);
      break;
    case 'python':
      extractPython(filePath, lines, symbols);
      break;
    case 'go':
      extractGo(filePath, lines, symbols);
      break;
    case 'rust':
      extractRust(filePath, lines, symbols);
      break;
    case 'bash':
      extractBash(filePath, lines, symbols);
      break;
    case 'sql':
      extractSql(filePath, lines, symbols);
      break;
    case 'yaml':
      extractYaml(filePath, lines.join('\n'), symbols);
      break;
    case 'java':
    case 'csharp':
    case 'scala':
      extractCFamilyOop(filePath, lines, symbols);
      break;
    case 'kotlin':
      extractKotlin(filePath, lines, symbols);
      break;
    case 'swift':
      extractSwift(filePath, lines, symbols);
      break;
    case 'ruby':
      extractRuby(filePath, lines, symbols);
      break;
    case 'php':
      extractPhp(filePath, lines, symbols);
      break;
    case 'c':
    case 'cpp':
      extractCLike(filePath, lines, symbols);
      break;
  }
}

// Keywords that look like `name(...)` calls but are control flow, not symbols.
const C_FAMILY_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'do', 'else',
  'synchronized', 'throw', 'throws', 'new', 'super', 'this', 'using', 'lock',
  'foreach', 'await', 'yield', 'when', 'match', 'guard', 'defer', 'repeat',
]);

/**
 * Java / C# / Scala: classes, interfaces, enums, records, and methods.
 * Conservative — methods must carry a visibility/modifier keyword to avoid
 * matching arbitrary `foo()` calls.
 */
function extractCFamilyOop(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const typeDecl = line.match(/\b(?:class|interface|enum|record|struct|trait|object)\s+([A-Za-z_]\w*)/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }

    // namespace / package members (C#)
    const nsDecl = line.match(/\bnamespace\s+([A-Za-z_][\w.]*)/);
    if (nsDecl) { addSymbol(symbols.variables, nsDecl[1], filePath, lineNum); continue; }

    // Methods: one or more leading modifiers, an optional return type, then
    // name(. Requiring ≥1 modifier keyword keeps arbitrary `foo()` calls out;
    // the name may be PascalCase (C#) or camelCase (Java/Scala).
    const methodDecl = line.match(/^\s*(?:(?:public|private|protected|internal|static|final|override|virtual|abstract|async|sealed|unsafe|extern|partial|suspend|open|inline|def|fun)\s+)+(?:[\w<>[\],?.]+\s+)?([A-Za-z_]\w*)\s*\(/);
    if (methodDecl && !C_FAMILY_KEYWORDS.has(methodDecl[1])) {
      addSymbol(symbols.functions, methodDecl[1], filePath, lineNum);
    }
  }
}

/**
 * Kotlin: fun, class/interface/object/enum, top-level val/var.
 */
function extractKotlin(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funDecl = line.match(/\bfun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?([a-z_]\w*)\s*\(/i);
    if (funDecl) { addSymbol(symbols.functions, funDecl[1], filePath, lineNum); continue; }

    const typeDecl = line.match(/\b(?:class|interface|object|enum\s+class|data\s+class|sealed\s+class)\s+([A-Za-z_]\w*)/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }
  }
}

/**
 * Swift: func, class/struct/enum/protocol/extension/actor.
 */
function extractSwift(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funcDecl = line.match(/\bfunc\s+([a-z_]\w*)\s*[(<]/i);
    if (funcDecl) { addSymbol(symbols.functions, funcDecl[1], filePath, lineNum); continue; }

    const typeDecl = line.match(/\b(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }
  }
}

/**
 * Ruby: def, class, module.
 */
function extractRuby(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    const defDecl = line.match(/^def\s+(?:self\.)?([a-z_]\w*[?!=]?)/);
    if (defDecl) { addSymbol(symbols.functions, defDecl[1], filePath, lineNum); continue; }

    const classDecl = line.match(/^(?:class|module)\s+([A-Z]\w*)/);
    if (classDecl) { addSymbol(symbols.classes, classDecl[1], filePath, lineNum); continue; }
  }
}

/**
 * PHP: function, class, interface, trait.
 */
function extractPhp(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funcDecl = line.match(/\bfunction\s+&?\s*([a-zA-Z_]\w*)\s*\(/);
    if (funcDecl) { addSymbol(symbols.functions, funcDecl[1], filePath, lineNum); continue; }

    const typeDecl = line.match(/\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }
  }
}

/**
 * C / C++: function definitions, struct/class/enum/union, typedefs.
 * Function detection is conservative: a return type, a name, a parenthesized
 * arg list, and an opening brace (definition, not a call or prototype).
 */
function extractCLike(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const typeDecl = line.match(/\b(?:struct|class|enum|union)\s+([A-Za-z_]\w*)/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }

    // ret-type name(args) {   — a definition opening at column 0 (skips
    // indented call sites and prototypes ending in `;`). Accepts an empty
    // single-line body `{}` as well as an opening `{`.
    const funcDef = line.match(/^[A-Za-z_][\w\s*&:<>,]*?\b([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:const\s*)?\{\s*\}?\s*$/);
    if (funcDef && !C_FAMILY_KEYWORDS.has(funcDef[1])) {
      addSymbol(symbols.functions, funcDef[1], filePath, lineNum);
    }
  }
}

function extractJsRegex(filePath, lines, symbols, lineOffset = 0) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1 + lineOffset;

    // function declarations: function foo(...) or async function foo(...)
    const funcDecl = line.match(/(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/);
    if (funcDecl) {
      addSymbol(symbols.functions, funcDecl[1], filePath, lineNum);
      continue;
    }

    // const/let/var arrow functions: const foo = (...) => or const foo = async (...) =>
    const arrowFunc = line.match(/(?:const|let|var)\s+([a-zA-Z_$]\w*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/);
    if (arrowFunc) {
      addSymbol(symbols.functions, arrowFunc[1], filePath, lineNum);
      continue;
    }

    // class declarations: class Foo
    const classDecl = line.match(/class\s+([A-Z]\w*)/);
    if (classDecl) {
      addSymbol(symbols.classes, classDecl[1], filePath, lineNum);
      continue;
    }
  }
}

function extractPython(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funcDef = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if (funcDef) { addSymbol(symbols.functions, funcDef[1], filePath, lineNum); continue; }

    const classDef = line.match(/^class\s+(\w+)[\s(:]/);
    if (classDef) { addSymbol(symbols.classes, classDef[1], filePath, lineNum); continue; }

    const methodDef = line.match(/^\s+(?:async\s+)?def\s+(\w+)\s*\(/);
    if (methodDef && !methodDef[1].startsWith('_')) {
      addSymbol(symbols.functions, methodDef[1], filePath, lineNum);
      continue;
    }

    const varAssign = line.match(/^(\w+)\s*(?::\s*\w+\s*)?=/);
    if (varAssign && varAssign[1] === varAssign[1].toUpperCase()) {
      addSymbol(symbols.variables, varAssign[1], filePath, lineNum);
    }
  }
}

function extractGo(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funcDecl = line.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
    if (funcDecl) { addSymbol(symbols.functions, funcDecl[1], filePath, lineNum); continue; }

    const typeDecl = line.match(/^type\s+(\w+)\s+(?:struct|interface)\s*\{/);
    if (typeDecl) { addSymbol(symbols.classes, typeDecl[1], filePath, lineNum); continue; }

    const constDecl = line.match(/^(?:const|var)\s+(\w+)\s/);
    if (constDecl) { addSymbol(symbols.variables, constDecl[1], filePath, lineNum); }
  }
}

function extractRust(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const funcDecl = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (funcDecl) { addSymbol(symbols.functions, funcDecl[1], filePath, lineNum); continue; }

    const structDecl = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structDecl) { addSymbol(symbols.classes, structDecl[1], filePath, lineNum); continue; }

    const enumDecl = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
    if (enumDecl) { addSymbol(symbols.classes, enumDecl[1], filePath, lineNum); continue; }

    const traitDecl = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitDecl) { addSymbol(symbols.classes, traitDecl[1], filePath, lineNum); continue; }

    const constDecl = line.match(/^(?:pub\s+)?(?:const|static)\s+(\w+)/);
    if (constDecl) { addSymbol(symbols.variables, constDecl[1], filePath, lineNum); }
  }
}

function extractBash(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;

    // Function definitions: function foo() or foo()
    const funcDecl = line.match(/^(?:function\s+)?(\w+)\s*\(\s*\)/);
    if (funcDecl && !['if', 'while', 'for', 'case', 'function'].includes(funcDecl[1])) {
      addSymbol(symbols.functions, funcDecl[1], filePath, lineNum);
      continue;
    }

    // Named functions with braces: function foo {
    const funcBrace = line.match(/^function\s+(\w+)\s*\{/);
    if (funcBrace) {
      addSymbol(symbols.functions, funcBrace[1], filePath, lineNum);
      continue;
    }
  }
}

function extractSql(filePath, lines, symbols) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // CREATE TABLE statements
    const createTable = line.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(/i);
    if (createTable) {
      addSymbol(symbols.classes, createTable[1], filePath, lineNum);
      continue;
    }

    // Function/procedure definitions
    const createFunc = line.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);
    if (createFunc) {
      addSymbol(symbols.functions, createFunc[1], filePath, lineNum);
      continue;
    }
  }
}

function extractYaml(filePath, content, symbols) {
  // Extract top-level keys as "variables" for YAML configs
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Top-level keys (no indentation) that look like identifiers
    const topLevel = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (topLevel) {
      addSymbol(symbols.variables, topLevel[1], filePath, lineNum);
    }
  }
}

/**
 * Extract HTML page info: title, script dependencies.
 */
function extractHtml(filePath, content, symbols) {
  // Extract <title>
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // Extract <script src="...">
  const scripts = [];
  const scriptRegex = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    const src = match[1];
    // Skip CDN/external scripts and common libs
    if (src.startsWith('http') || src.startsWith('//')) continue;
    scripts.push(src);
  }

  // Extract function definitions from inline <script> blocks
  // This catches functions defined in HTML monoliths (e.g. admin_tickets.html)
  const inlineScriptRegex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let inlineMatch;
  while ((inlineMatch = inlineScriptRegex.exec(content)) !== null) {
    const scriptContent = inlineMatch[1];
    if (!scriptContent.trim()) continue;
    // Line offset of this script block within the HTML file. The script's
    // first line (index 0) is the remainder of the <script> tag's own line,
    // and extractors add `line + 1 + offset`, so the offset must be the
    // tag's line number minus one — otherwise every symbol reports one
    // line below its real position.
    const blockStart = content.substring(0, inlineMatch.index).split('\n').length - 1;
    const parsed = extractWithAst(filePath, scriptContent, Lang.JavaScript, symbols, blockStart);
    if (!parsed) {
      // AST parse failed (maybe template syntax) — regex fallback
      const lines = scriptContent.split('\n');
      extractWithRegex(filePath, lines, 'javascript', symbols, blockStart);
    }
  }

  const name = path.basename(filePath);
  symbols.htmlPages[name] = {
    file: filePath,
    title: title || name,
    scripts
  };
}

function addSymbol(category, name, filePath, line) {
  let namespace = 'root';
  const parts = filePath.split(/[/\\]/);
  if (parts.length > 1 && (parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'services')) {
    namespace = `${parts[0]}/${parts[1]}`;
  } else if (parts.length > 1) {
    namespace = parts[0];
  }

  if (!category[name]) {
    category[name] = { file: filePath, line, usages: 1, namespace };
  } else {
    category[name].usages++;
  }
}

/**
 * Generate a compact project overview for context injection.
 */
export function generateOverview(projectRoot, scanResult, options = {}) {
  const { files, symbols } = scanResult;
  const maxFiles = options.maxFiles || 100;
  const detail = options.detail || 'summary';
  const lines = ['# Project Overview\n'];

  // File tree (compact — group by directory)
  const dirs = {};
  for (const f of files) {
    const dir = path.dirname(f.path);
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push(f);
  }

  lines.push(`## Files (${files.length})`);
  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  lines.push(`Total: ${totalLines.toLocaleString()} lines\n`);

  let fileCount = 0;
  let truncatedFiles = false;

  for (const [dir, dirFiles] of Object.entries(dirs).sort()) {
    if (fileCount >= maxFiles) {
      truncatedFiles = true;
      break;
    }
    
    let filesToShow = dirFiles;
    if (fileCount + dirFiles.length > maxFiles) {
      filesToShow = dirFiles.slice(0, maxFiles - fileCount);
      truncatedFiles = true;
    }

    const fileList = filesToShow.map(f => {
      const name = path.basename(f.path);
      return `${name} (${f.lines}L)`;
    }).join(', ');
    
    lines.push(`- **${dir || '.'}**/: ${fileList}${filesToShow.length < dirFiles.length ? ', ...' : ''}`);
    fileCount += filesToShow.length;
    
    if (truncatedFiles) break;
  }
  
  if (truncatedFiles) {
    const remaining = files.length - fileCount;
    if (remaining > 0) {
      lines.push(`- ... and ${remaining} more files in other directories.`);
    }
  }
  lines.push('');

  const funcCount = Object.keys(symbols.functions).length;
  const classCount = Object.keys(symbols.classes).length;
  const exportCount = Object.keys(symbols.exports).length;

  lines.push(`## Symbols`);
  lines.push(`Functions: ${funcCount}, Classes/Types: ${classCount}, Exports: ${exportCount}\n`);

  if (detail !== 'summary') {
    if (classCount > 0 && classCount <= 50) {
      lines.push(`### Classes/Types`);
      for (const [name, info] of Object.entries(symbols.classes).sort()) {
        lines.push(`- **${name}** — ${info.file}:${info.line}`);
      }
      lines.push('');
    }

    if (exportCount > 0 && exportCount <= 80) {
      lines.push(`### Exports`);
      for (const [name, info] of Object.entries(symbols.exports).sort()) {
        lines.push(`- ${name} — ${info.file}:${info.line}`);
      }
      lines.push('');
    }
  }

  // API Routes (compact: group by file, show methods only)
  const routeEntries = Object.entries(symbols.apiRoutes || {});
  if (routeEntries.length > 0) {
    const mounts = routeEntries.filter(([, v]) => v.method === 'MOUNT');
    const routes = routeEntries.filter(([, v]) => v.method !== 'MOUNT');

    lines.push(`## API Routes (${routes.length} endpoints)\n`);

    // Group routes by file, show file + methods + count
    const routesByFile = {};
    for (const [, info] of routes) {
      if (!routesByFile[info.file]) routesByFile[info.file] = [];
      routesByFile[info.file].push(info);
    }

    for (const [file, fileRoutes] of Object.entries(routesByFile).sort()) {
      const methods = [...new Set(fileRoutes.map(r => r.method))].sort().join(', ');
      const mountInfo = mounts.find(([, v]) => {
        // Try to match mount path to this route file
        const fileBase = path.basename(file, '.js').replace(/[-_]/g, '');
        return v.path.replace(/[/-]/g, '').includes(fileBase);
      });
      const mountPath = mountInfo ? mountInfo[1].path : '';
      lines.push(`- **${file}** — ${methods} (${fileRoutes.length})${mountPath ? ` → ${mountPath}` : ''}`);
    }
    lines.push('');
  }

  // HTML Pages (compact: name + title, scripts available via get_wisdom)
  const pageEntries = Object.entries(symbols.htmlPages || {});
  if (pageEntries.length > 0) {
    lines.push(`## HTML Pages (${pageEntries.length})\n`);
    for (const [name, info] of pageEntries.sort()) {
      const scriptCount = info.scripts.length > 0 ? ` (${info.scripts.length} scripts)` : '';
      lines.push(`- **${name}**: ${info.title}${scriptCount}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check symbols against registry. Returns { known, fuzzy, unknown, overallConfidence }.
 *
 * Each entry includes a `confidence` field (0.0 - 1.0):
 * - known: 1.0 (+ established: true if usages >= 5)
 * - fuzzy: 0.3 - 0.7 (higher for closer matches)
 * - unknown: 0.0
 *
 * overallConfidence: weighted average across all checked symbols.
 */
export function checkSymbols(symbolNames, registry) {
  const known = [];
  const fuzzy = [];
  const unknown = [];

  // Only these categories hold real code identifiers. apiRoutes keys are
  // "GET /path" strings and htmlPages keys are filenames — matching a queried
  // symbol against them produces bogus "known"/fuzzy results.
  const SYMBOL_CATEGORIES = ['functions', 'classes', 'variables', 'exports'];
  const symbolRegistry = {};
  for (const cat of SYMBOL_CATEGORIES) {
    if (registry[cat] && typeof registry[cat] === 'object') symbolRegistry[cat] = registry[cat];
  }

  const allNames = new Set();
  for (const category of Object.values(symbolRegistry)) {
    for (const name of Object.keys(category)) {
      allNames.add(name);
    }
  }

  for (const name of symbolNames) {
    if (allNames.has(name)) {
      for (const [catName, cat] of Object.entries(symbolRegistry)) {
        if (cat[name]) {
          const established = (cat[name].usages || 0) >= 5;
          known.push({
            name,
            category: catName,
            confidence: 1.0,
            established,
            ...cat[name]
          });
          break;
        }
      }
    } else {
      const match = findFuzzyMatch(name, allNames);
      if (match) {
        for (const [catName, cat] of Object.entries(symbolRegistry)) {
          if (cat[match.name]) {
            // Confidence: 0.3 base + up to 0.4 based on distance quality
            const maxDistance = fuzzyMaxDistance(name.length);
            const distanceRatio = 1 - (match.distance / maxDistance);
            const confidence = Math.round((0.3 + 0.4 * distanceRatio) * 100) / 100;
            fuzzy.push({
              queried: name,
              suggestion: match.name,
              distance: match.distance,
              confidence,
              category: catName,
              ...cat[match.name]
            });
            break;
          }
        }
      } else {
        unknown.push({ name, confidence: 0.0 });
      }
    }
  }

  // Compute overall confidence
  const total = known.length + fuzzy.length + unknown.length;
  let overallConfidence = 0;
  if (total > 0) {
    const sum = known.reduce((s, k) => s + k.confidence, 0)
              + fuzzy.reduce((s, f) => s + f.confidence, 0)
              + unknown.reduce((s, u) => s + u.confidence, 0);
    overallConfidence = Math.round((sum / total) * 100) / 100;
  }

  return { known, fuzzy, unknown, overallConfidence };
}

/**
 * Edit-distance tolerance scaled to symbol length.
 * Short identifiers get strict (or no) fuzzy matching — with distance 2,
 * a 3-char query would match almost anything.
 */
function fuzzyMaxDistance(len) {
  if (len < 3) return 0; // too short — fuzzy matching is pure noise
  if (len < 5) return 1;
  return Math.max(2, Math.floor(len * 0.3));
}

function findFuzzyMatch(query, names) {
  let bestMatch = null;
  let bestDistance = Infinity;
  const maxDistance = fuzzyMaxDistance(query.length);
  if (maxDistance === 0) return null;

  for (const name of names) {
    if (Math.abs(name.length - query.length) > maxDistance) continue;
    const dist = levenshtein(query.toLowerCase(), name.toLowerCase());
    if (dist <= maxDistance && dist < bestDistance) {
      bestDistance = dist;
      bestMatch = name;
    }
  }

  return bestMatch ? { name: bestMatch, distance: bestDistance } : null;
}

/**
 * Read the registry, distinguishing "absent" from "corrupt".
 * Returns { registry, status } where status is 'ok' | 'missing' | 'corrupt'.
 * A corrupt registry must not be silently treated as missing — that hides a
 * real failure and tells the user to reindex as if the file were never there.
 */
export function readSymbolsResult(wisdomDir) {
  const symbolsPath = path.join(wisdomDir, 'symbols.json');
  if (!fs.existsSync(symbolsPath)) return { registry: null, status: 'missing' };
  try {
    const registry = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
    if (!registry || typeof registry !== 'object') return { registry: null, status: 'corrupt' };
    return { registry, status: 'ok' };
  } catch {
    return { registry: null, status: 'corrupt' };
  }
}

export function readSymbols(wisdomDir) {
  return readSymbolsResult(wisdomDir).registry;
}

export function writeSymbols(wisdomDir, symbols) {
  writeJsonAtomic(path.join(wisdomDir, 'symbols.json'), symbols);
}
