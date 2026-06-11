/**
 * Symbol checker - called by post-write-symbol-check.sh hook
 * Usage: node symbol-check.mjs <file_path> <symbols_json_path> [--diff-only]
 *
 * When --diff-only is set, reads the changed content from stdin and only
 * checks symbols that appear in that diff. This prevents false positives
 * from pre-existing code in the file.
 *
 * Checks local imports AND standalone function calls against the
 * project's .wisdom/symbols.json registry.
 *
 * Compatible with Claude Code and Codex hooks.
 */
import fs from 'fs';
import path from 'path';
import { levenshtein } from '../src/mcp-server/lib/levenshtein.js';

/**
 * Write a file atomically: write to a sibling temp file, then rename over the
 * target. A crash mid-write must never truncate the user's source file — the
 * old content stays intact until the rename completes. Temp lives in the same
 * directory so the rename is atomic on the same filesystem.
 */
function writeFileAtomic(targetPath, content) {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    throw err;
  }
}

const args = process.argv.slice(2);

const filePath = args[0];
const symbolsFile = args[1];
const diffOnly = args.includes('--diff-only');

if (!filePath || !symbolsFile) process.exit(0);

// Read the written file (always needed for context like local definitions)
let content;
try {
  content = fs.readFileSync(filePath, 'utf8');
} catch { process.exit(0); }

let fullOriginalContent = content;
const isMarkdown = filePath.endsWith('.md');

if (isMarkdown) {
  const codeBlockRegex = /```(?:javascript|js|typescript|ts|jsx|tsx)([\s\S]*?)```/gi;
  let mdCode = '';
  let match;
  while ((match = codeBlockRegex.exec(fullOriginalContent)) !== null) {
    mdCode += match[1] + '\n';
  }
  content = mdCode;
}

// Read diff content from stdin if in diff-only mode
let diffContent = '';
if (diffOnly && !isMarkdown) {
  try {
    const readStdin = () => {
      return new Promise((resolve) => {
        let data = '';
        // Guard: if stdin never closes (invoked without a pipe), resolve
        // with whatever arrived instead of hanging forever.
        const guard = setTimeout(() => {
          try { process.stdin.destroy(); } catch {}
          resolve(data);
        }, 5000);
        guard.unref?.();
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
          let chunk;
          while ((chunk = process.stdin.read()) !== null) {
            data += chunk;
          }
        });
        process.stdin.on('end', () => { clearTimeout(guard); resolve(data); });
        process.stdin.on('error', () => { clearTimeout(guard); resolve(''); });
      });
    };
    diffContent = await readStdin();
  } catch { process.exit(0); }
  if (!diffContent.trim()) process.exit(0);
}

// The content to scan for symbols — either the diff or the full file
const scanContent = (diffOnly && !isMarkdown) ? diffContent : content;

// Read symbol registry
let registry;
try {
  registry = JSON.parse(fs.readFileSync(symbolsFile, 'utf8'));
} catch (err) {
  // Distinguish a missing registry (nothing to check yet — silent) from a
  // present-but-corrupt one. A corrupt registry would silently disable all
  // symbol checking, so warn on stderr (exit 0 keeps the write non-blocking).
  if (fs.existsSync(symbolsFile)) {
    process.stderr.write(`[anti-hallucination] symbols.json is corrupt or unreadable (${err.message}); symbol check skipped. Run reindex_project --force to rebuild.\n`);
  }
  process.exit(0);
}
if (!registry || typeof registry !== 'object') {
  process.stderr.write('[anti-hallucination] symbols.json has unexpected shape; symbol check skipped. Run reindex_project --force to rebuild.\n');
  process.exit(0);
}

// Build set of all known symbols
const known = new Set();
for (const [cat, symbols] of Object.entries(registry)) {
  if (cat === '_meta') continue;
  for (const name of Object.keys(symbols)) {
    known.add(name);
  }
}

if (known.size === 0) process.exit(0);

// Strip comments and strings to avoid false positives from prose
function stripCommentsAndStrings(code) {
  return code
    // Block comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments
    .replace(/\/\/.*$/gm, '')
    // Template literals (rough — handles most cases)
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    // Double-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      // Single-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function replaceIdentifierInCode(code, from, to) {
  let output = '';
  let i = 0;
  let state = 'code';

  const isIdentChar = (char) => /[a-zA-Z0-9_$]/.test(char || '');

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (state === 'lineComment') {
      output += char;
      if (char === '\n') state = 'code';
      i++;
      continue;
    }

    if (state === 'blockComment') {
      output += char;
      if (char === '*' && next === '/') {
        output += next;
        i += 2;
        state = 'code';
      } else {
        i++;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      output += char;
      if (char === '\\') {
        output += next || '';
        i += next ? 2 : 1;
        continue;
      }
      if ((state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === '`')) {
        state = 'code';
      }
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      output += char + next;
      i += 2;
      state = 'lineComment';
      continue;
    }
    if (char === '/' && next === '*') {
      output += char + next;
      i += 2;
      state = 'blockComment';
      continue;
    }
    if (char === "'") {
      output += char;
      i++;
      state = 'single';
      continue;
    }
    if (char === '"') {
      output += char;
      i++;
      state = 'double';
      continue;
    }
    if (char === '`') {
      output += char;
      i++;
      state = 'template';
      continue;
    }

    if (code.startsWith(from, i) && !isIdentChar(code[i - 1]) && !isIdentChar(code[i + from.length])) {
      output += to;
      i += from.length;
      continue;
    }

    output += char;
    i++;
  }

  return output;
}

const referenced = new Set();
const importedBindings = new Set();

function addImportBinding(name) {
  const trimmed = name.trim();
  if (trimmed && /^[a-zA-Z_$][\w$]*$/.test(trimmed)) {
    importedBindings.add(trimmed);
  }
}

function collectImportedBindings(code) {
  for (const match of code.matchAll(/import\s+(?:type\s+)?([^'";]+?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = match[1].trim();

    const defaultMatch = clause.match(/^([a-zA-Z_$][\w$]*)\s*(?:,|$)/);
    if (defaultMatch) {
      addImportBinding(defaultMatch[1]);
    }

    const namespaceMatch = clause.match(/\*\s+as\s+([a-zA-Z_$][\w$]*)/);
    if (namespaceMatch) {
      addImportBinding(namespaceMatch[1]);
    }

    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      for (const specifier of namedMatch[1].split(',')) {
        const parts = specifier.trim().split(/\s+as\s+/);
        addImportBinding(parts[1] || parts[0]);
      }
    }
  }

  for (const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/);
      addImportBinding(parts[1] || parts[0]);
    }
  }

  for (const match of code.matchAll(/import\s+([a-zA-Z_$][\w$]*)\s+from\s*['"][^'"]+['"]/g)) {
    addImportBinding(match[1]);
  }

  for (const match of code.matchAll(/import\s+\*\s+as\s+([a-zA-Z_$][\w$]*)\s+from\s*['"][^'"]+['"]/g)) {
    addImportBinding(match[1]);
  }

  for (const match of code.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"][^'"]+['"]\s*\)/g)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s*:\s*/);
      addImportBinding(parts[1] || parts[0]);
    }
  }

  for (const match of code.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*require\s*\(\s*['"][^'"]+['"]\s*\)/g)) {
    addImportBinding(match[1]);
  }
}

collectImportedBindings(content);

// --- Imports (checked against scanContent) ---

// ES imports from local paths only: import { foo, bar } from './...'
for (const match of scanContent.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
  for (const name of match[1].split(',')) {
    const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
    if (trimmed && /^[a-zA-Z_]\w*$/.test(trimmed)) {
      referenced.add(trimmed);
    }
  }
}

// Default imports from local paths: import Foo from './...'
for (const match of scanContent.matchAll(/import\s+([A-Z]\w+)\s+from\s*['"](\.[^'"]+)['"]/g)) {
  referenced.add(match[1]);
}

// CommonJS require from local paths: const { foo } = require('./...')
for (const match of scanContent.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
  for (const name of match[1].split(',')) {
    const trimmed = name.trim().split(/\s*:\s*/)[0].trim();
    if (trimmed && /^[a-zA-Z_]\w*$/.test(trimmed)) {
      referenced.add(trimmed);
    }
  }
}

// --- Import path validation (only for paths in scanContent) ---

const fileDir = path.dirname(filePath);
const badPaths = [];

const localPaths = new Set();
for (const match of scanContent.matchAll(/(?:import|export)\s+.*?from\s*['"](\.[^'"]+)['"]/g)) {
  localPaths.add(match[1]);
}
for (const match of scanContent.matchAll(/import\s*['"](\.[^'"]+)['"]/g)) {
  localPaths.add(match[1]);
}
for (const match of scanContent.matchAll(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
  localPaths.add(match[1]);
}
for (const match of scanContent.matchAll(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
  localPaths.add(match[1]);
}

for (const importPath of localPaths) {
  const resolved = path.resolve(fileDir, importPath);
  const candidates = [resolved];
  if (!path.extname(resolved)) {
    candidates.push(resolved + '.js', resolved + '.mjs', resolved + '.ts', resolved + '.tsx',
                     resolved + '.jsx', resolved + '.cjs',
                     resolved + '/index.js', resolved + '/index.ts');
  }
  if (!candidates.some(c => fs.existsSync(c))) {
    badPaths.push(importPath);
  }
}

// --- Function calls (checked against stripped scanContent) ---

const stripped = stripCommentsAndStrings(scanContent);

// Standalone function calls (not method calls)
const SKIP = new Set([
  // Language keywords
  'if','for','while','switch','catch','require','import','return','throw',
  'function','async','class','const','let','var','try','else','new',
  'typeof','instanceof','delete','void','yield','await','of','in','from',
  // JS globals and builtins
  'console','Math','JSON','Object','Array','String','Number','Boolean',
  'Date','RegExp','Error','Promise','Set','Map','WeakMap','WeakSet',
  'Symbol','Proxy','Reflect','BigInt','Intl','ArrayBuffer','DataView',
  'Float32Array','Float64Array','Int8Array','Int16Array','Int32Array',
  'Uint8Array','Uint16Array','Uint32Array',
  'setTimeout','setInterval','clearTimeout','clearInterval',
  'requestAnimationFrame','cancelAnimationFrame',
  'parseInt','parseFloat','isNaN','isFinite','isInteger',
  'encodeURIComponent','decodeURIComponent','encodeURI','decodeURI',
  'atob','btoa',
  // Node.js globals
  'Buffer','process','module','exports','global','globalThis',
  'require','__dirname','__filename',
  // Common values
  'null','undefined','true','false','NaN','Infinity',
  'this','super','arguments',
  // Fetch/network
  'fetch','XMLHttpRequest','WebSocket','EventSource','Headers','Request','Response',
  'URL','URLSearchParams','FormData','AbortController',
  // Testing
  'describe','it','test','expect','beforeEach','afterEach','beforeAll','afterAll',
  'jest','vi','assert','should',
  // Console/logging
  'log','warn','info','error','debug','trace','dir','table','time','timeEnd',
  'alert','confirm','prompt',
  // Promise/async
  'resolve','reject','then','catch','finally',
  // Function methods
  'bind','call','apply',
  // Object methods
  'constructor','assign','keys','values','entries','freeze','seal','create','define',
  'is','from','parse','stringify','toString','valueOf','hasOwnProperty',
  'getPrototypeOf','setPrototypeOf','defineProperty','getOwnPropertyNames',
  // Array methods
  'includes','indexOf','lastIndexOf','push','pop','shift','unshift',
  'slice','splice','join','split','trim','trimStart','trimEnd',
  'replace','replaceAll','match','matchAll','search','test',
  'filter','map','reduce','reduceRight','forEach','find','findIndex','findLast',
  'some','every','sort','reverse','concat','flat','flatMap','fill',
  'copyWithin','at','with','toSorted','toReversed','toSpliced',
  // Collection methods
  'has','get','set','add','clear','delete','next','done','value',
  // DOM/Browser
  'querySelector','querySelectorAll','getElementById','getElementsByClassName',
  'createElement','createTextNode','appendChild','removeChild','insertBefore',
  'addEventListener','removeEventListener','dispatchEvent',
  'getAttribute','setAttribute','removeAttribute','classList',
  'preventDefault','stopPropagation',
  'getComputedStyle','getBoundingClientRect',
  // Node.js fs
  'readFileSync','writeFileSync','existsSync','mkdirSync','readdirSync',
  'readFile','writeFile','mkdir','readdir','stat','access','unlink',
  'statSync','unlinkSync','renameSync','copyFileSync',
  // Node.js path
  'resolve','join','dirname','basename','extname','relative','normalize','parse',
  // Node.js events
  'emit','on','once','off','removeListener','removeAllListeners',
  // Node.js crypto
  'randomUUID','createHash','createHmac','randomBytes',
  // Node.js child_process
  'exec','execSync','spawn','fork',
  // Node.js util
  'promisify','inspect','format','inherits',
  // CSS functions (appear in template literals)
  'rgba','rgb','hsl','hsla','calc','var','url','linear','radial',
  'translateX','translateY','rotate','scale','skew',
]);

for (const match of stripped.matchAll(/(?<![.\w])([a-zA-Z_]\w*)\s*\(/g)) {
  const name = match[1];
  if (SKIP.has(name)) continue;
  if (name.length <= 2) continue;
  // Skip constructor calls (new Foo()) — typically from dependencies
  if (/^[A-Z]/.test(name)) continue;
  referenced.add(name);
}

// Escape regex metacharacters so identifiers containing $, etc. ($http, foo$)
// don't act as anchors/quantifiers when interpolated into a RegExp below.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Namespace helper
function getNamespace(fPath) {
  const parts = fPath.split(/[/\\]/);
  if (parts.length > 1 && (parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'services')) {
    return `${parts[0]}/${parts[1]}`;
  } else if (parts.length > 1) {
    return parts[0];
  }
  return 'root';
}

const currentNamespace = getNamespace(path.relative(path.dirname(symbolsFile), filePath).replace(/^\.\.[/\\]/, ''));
const unknowns = [];
const fixedTypos = [];
const namespaceViolations = [];

// Helper to check cross-boundary namespace
function isNamespaceViolation(symbolName, fileNs) {
  const symbolInfo = registry.functions?.[symbolName] || registry.classes?.[symbolName] || registry.variables?.[symbolName] || registry.exports?.[symbolName];
  if (!symbolInfo || !symbolInfo.namespace) return false;
  
  const symNs = symbolInfo.namespace;
  if (symNs === fileNs) return false;
  if (symNs === 'root' || symNs.includes('shared') || symNs.includes('common')) return false;
  return symNs;
}

// Check which referenced symbols are unknown
for (const name of referenced) {
  if (name.length <= 2) continue;
  if (/^[A-Z_]+$/.test(name)) continue; // CONSTANTS
  if (importedBindings.has(name)) continue;

  // Is it a local definition in this file? (check full file, not just diff)
  const escapedName = escapeRegExp(name);
  const localDef = new RegExp(`(?:function|const|let|var|class)\\s+${escapedName}\\b`);
  if (localDef.test(content)) continue;

  // Is it a function parameter? (check full file)
  const paramInFunc = new RegExp(`(?:function\\s+\\w*|=>)\\s*\\([^)]*\\b${escapedName}\\b[^)]*\\)`);
  const strippedFull = stripCommentsAndStrings(content);
  if (paramInFunc.test(strippedFull)) continue;

  if (known.has(name)) {
    const violation = isNamespaceViolation(name, currentNamespace);
    if (violation) {
      namespaceViolations.push({ name, from: violation, to: currentNamespace });
    }
    continue;
  }

  // Check: not in registry AND looks like a project symbol
  if (/^[a-zA-Z_$][\w$]*$/.test(name)) {
    let bestMatch = null;
    let highestConfidence = 0;
    for (const k of known) {
      if (Math.abs(k.length - name.length) > 3) continue;
      const dist = levenshtein(name, k);
      const confidence = 1 - (dist / Math.max(name.length, k.length));
      if (confidence >= 0.85 && confidence > highestConfidence) {
        highestConfidence = confidence;
        bestMatch = k;
      }
    }

    if (bestMatch && highestConfidence >= 0.85) {
      fixedTypos.push({ wrong: name, right: bestMatch });
    } else {
      unknowns.push(name);
    }
  }
}

// --- API route validation (only routes in scanContent) ---

const badRoutes = [];
const apiRoutes = registry.apiRoutes || {};
if (Object.keys(apiRoutes).length > 0) {
  const knownPaths = new Set();
  const knownNormalized = new Set();
  const mounts = new Set();
  const mountsWithSubRoutes = new Set();

  for (const [key, info] of Object.entries(apiRoutes)) {
    const routePath = info.path || key.split(' ').slice(1).join(' ');
    if (info.method === 'MOUNT') {
      mounts.add(routePath);
    } else {
      knownPaths.add(routePath);
      const normalized = routePath.replace(/\/:[a-zA-Z_]\w*/g, '/*');
      knownNormalized.add(normalized);
    }
  }

  for (const mount of mounts) {
    for (const kp of knownPaths) {
      if (kp.startsWith(mount + '/') || kp === mount) {
        mountsWithSubRoutes.add(mount);
        break;
      }
    }
  }

  for (const match of scanContent.matchAll(/['"`](\/api\/[a-zA-Z0-9/_-]+)['"`]/g)) {
    const apiPath = match[1].replace(/\/$/, '');

    if (knownPaths.has(apiPath)) continue;

    const segments = apiPath.split('/');
    const wildcarded = segments.map(s => /^\d+$/.test(s) ? '*' : s).join('/');
    if (knownNormalized.has(wildcarded)) continue;

    let prefixMatch = false;
    for (const kp of knownPaths) {
      if (kp.startsWith(apiPath + '/')) { prefixMatch = true; break; }
    }
    if (prefixMatch) continue;

    let underOpaqueMount = false;
    for (const mount of mounts) {
      if (!mountsWithSubRoutes.has(mount) && (apiPath.startsWith(mount + '/') || apiPath === mount)) {
        underOpaqueMount = true;
        break;
      }
    }
    if (underOpaqueMount) continue;

    badRoutes.push(match[1]);
  }
}

const fileName = filePath.split('/').pop();
const warnings = [];
const infos = [];
const mode = (diffOnly && !isMarkdown) ? ' (in new code)' : '';

// Auto-rewriting files is opt-in: a fuzzy match at >=0.85 confidence can
// still be wrong (e.g. a brand-new `getUser` rewritten to an existing
// `getUsers` while the registry is stale), and silently mutating a file the
// agent just wrote desyncs the agent's view of it. Default: warn so the
// agent fixes it deliberately. Set ANTIHALL_AUTOFIX=1 to restore rewriting.
const AUTO_FIX = process.env.ANTIHALL_AUTOFIX === '1';

if (fixedTypos.length > 0) {
  if (isMarkdown) {
    warnings.push(`Symbol typo check: ${fixedTypos.length} possible typo(s) in markdown code fences for ${fileName}:`);
    for (const typo of fixedTypos) {
      warnings.push(`  - ${typo.wrong} → ${typo.right}`);
    }
  } else if (AUTO_FIX) {
    let newContent = fullOriginalContent;
    for (const typo of fixedTypos) {
      newContent = replaceIdentifierInCode(newContent, typo.wrong, typo.right);
      infos.push(`[INFO] Detecté el typo '${typo.wrong}', lo auto-corregí a '${typo.right}' por ti en ${fileName}. Re-lee el archivo antes de editarlo de nuevo.`);
    }
    try {
      writeFileAtomic(filePath, newContent);
    } catch (e) {
      warnings.push(`No se pudo auto-corregir el archivo: ${e.message}`);
    }
  } else {
    warnings.push(`Symbol typo check: ${fixedTypos.length} probable typo(s) in ${fileName}${mode}:`);
    for (const typo of fixedTypos) {
      warnings.push(`  - '${typo.wrong}' is not in the registry — did you mean '${typo.right}'? Fix it or run refresh_symbols if '${typo.wrong}' is new.`);
    }
  }
}

if (typeof namespaceViolations !== 'undefined' && namespaceViolations.length > 0) {
  warnings.push(`Monorepo Check: ${namespaceViolations.length} símbolo(s) importado(s) de otro namespace:`);
  for (const v of namespaceViolations) {
    warnings.push(`  - Intento de usar el símbolo '${v.name}' del namespace '${v.from}' en el archivo de '${v.to}'.`);
  }
}

if (badRoutes.length > 0) {
  warnings.push(`API route check: ${badRoutes.length} route(s) not found in project index for ${fileName}${mode}:`);
  for (const r of badRoutes.slice(0, 10)) {
    warnings.push(`  - ${r}`);
  }
  if (badRoutes.length > 10) warnings.push(`  ... and ${badRoutes.length - 10} more`);
}

if (badPaths.length > 0) {
  warnings.push(`Import path check: ${badPaths.length} import(s) point to files that don't exist in ${fileName}${mode}:`);
  for (const p of badPaths) {
    warnings.push(`  - ${p}`);
  }
}

if (unknowns.length > 0) {
  warnings.push(`Symbol check: ${unknowns.length} symbol(s) not found in project registry for ${fileName}${mode}:`);
  for (const name of unknowns.slice(0, 10)) {
    warnings.push(`  - ${name} (could be hallucinated, new, or from a dependency)`);
  }
  if (unknowns.length > 10) warnings.push(`  ... and ${unknowns.length - 10} more`);
  warnings.push(`Run refresh_symbols to update the registry if these are intentional.`);
}

if (infos.length > 0) {
  console.error(infos.join('\n'));
}

if (warnings.length > 0) {
  // Exit code 2 + stderr = feedback shown directly to Claude/Codex
  console.error(warnings.join('\n'));
  process.exit(2);
}
