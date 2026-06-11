/**
 * get_file_skeleton tool
 *
 * Returns the structural skeleton of a single file — function/method
 * signatures, class/interface/type names, and exports — with bodies stripped.
 * Typically ~85-95% smaller than reading the whole file.
 *
 * Anti-hallucination value is preventive: the agent sees the *real* signatures
 * (parameter names, arity, return types) before writing a call, so it doesn't
 * invent arguments or misremember a function's shape. Cheaper than Read, and
 * unlike check_symbols it works on a single file without a built registry.
 */

import fs from 'fs';
import path from 'path';
import { parse, Lang } from '@ast-grep/napi';

const AST_LANGS = {
  '.js': Lang.JavaScript, '.mjs': Lang.JavaScript, '.cjs': Lang.JavaScript, '.jsx': Lang.JavaScript,
  '.ts': Lang.TypeScript, '.tsx': Lang.Tsx
};

// Declaration-line patterns for languages without a bundled AST grammar.
const DECL_PATTERNS = [
  /^\s*(?:export\s+)?(?:public|private|protected|internal|static|final|override|virtual|abstract|open|sealed|suspend|async|inline)?\s*(?:def|fun|func|fn|function)\b.*/,
  /^\s*(?:export\s+)?(?:pub\s+)?(?:public|private|protected|internal|static|final|abstract|sealed|data|open)?\s*(?:class|interface|trait|struct|enum|protocol|object|record|module|namespace)\b.*/,
  /^\s*(?:public|private|protected|internal|static|final|override|virtual|abstract|async)\s+[\w<>[\],?.]+\s+[A-Za-z_]\w*\s*\([^;]*\)\s*\{?\s*$/, // Java/C# method
  /^[A-Za-z_][\w\s*&:<>,]*?\b[A-Za-z_]\w*\s*\([^;{]*\)\s*(?:const\s*)?\{\s*$/ // C/C++ definition
];

function sliceSignature(content, node) {
  // From the declaration start to just before the body — yields the clean
  // signature ("function foo(a, b): number"), collapsed to one line.
  const start = node.range().start.index;
  const body = node.field('body');
  const end = body ? body.range().start.index : node.range().end.index;
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function extractJsSkeleton(content, lang) {
  const root = parse(lang, content).root();
  const isTS = lang === Lang.TypeScript || lang === Lang.Tsx;
  const functions = [];
  const classes = [];
  const exportsSet = new Set();

  for (const node of root.findAll({ rule: { kind: 'function_declaration' } })) {
    const name = node.field('name');
    if (name) functions.push({ sig: sliceSignature(content, node), line: name.range().start.line + 1 });
  }

  for (const kind of ['lexical_declaration', 'variable_declaration']) {
    for (const decl of root.findAll({ rule: { kind } })) {
      for (const d of decl.findAll({ rule: { kind: 'variable_declarator' } })) {
        const nameNode = d.field('name');
        const value = d.field('value');
        const vk = value?.kind();
        if (nameNode && (vk === 'arrow_function' || vk === 'function_expression')) {
          const params = value.field('parameters')?.text() || value.field('parameter')?.text() || '()';
          functions.push({ sig: `const ${nameNode.text()} = ${params} =>`, line: nameNode.range().start.line + 1 });
        }
      }
    }
  }

  for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
    const name = node.field('name');
    if (!name) continue;
    const methods = [];
    for (const m of node.findAll({ rule: { kind: 'method_definition' } })) {
      const mn = m.field('name');
      if (mn) methods.push({ sig: sliceSignature(content, m), line: mn.range().start.line + 1 });
    }
    classes.push({ name: name.text(), line: name.range().start.line + 1, methods });
  }

  if (isTS) {
    for (const kind of ['interface_declaration', 'type_alias_declaration', 'enum_declaration']) {
      for (const node of root.findAll({ rule: { kind } })) {
        const name = node.field('name');
        if (name) classes.push({ name: `${kind.split('_')[0]} ${name.text()}`, line: name.range().start.line + 1, methods: [] });
      }
    }
  }

  for (const node of root.findAll({ rule: { kind: 'export_statement' } })) {
    for (const spec of node.findAll({ rule: { kind: 'export_specifier' } })) {
      const n = spec.field('name');
      if (n) exportsSet.add(n.text());
    }
    const decl = node.field('declaration');
    const dn = decl?.field('name');
    if (dn) exportsSet.add(dn.text());
    // export const/let/var foo = ... — names live on the declarators
    if (decl && (decl.kind() === 'lexical_declaration' || decl.kind() === 'variable_declaration')) {
      for (const d of decl.findAll({ rule: { kind: 'variable_declarator' } })) {
        const n = d.field('name');
        if (n && n.kind() === 'identifier') exportsSet.add(n.text());
      }
    }
  }
  for (const line of content.split('\n')) {
    const m = line.match(/^(?:module\.)?exports\.(\w+)\s*=/);
    if (m) exportsSet.add(m[1]);
  }

  return { functions, classes, exports: [...exportsSet] };
}

function extractGenericSkeleton(content) {
  const lines = content.split('\n');
  const decls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 300) continue;
    if (DECL_PATTERNS.some((re) => re.test(line))) {
      decls.push({ sig: line.replace(/\s*\{?\s*$/, '').replace(/\s+/g, ' ').trim(), line: i + 1 });
    }
  }
  return decls;
}

export const fileSkeletonDefinition = {
  name: 'get_file_skeleton',
  description: 'Returns a file\'s structure — function/method signatures, class/interface/type names, and exports — with bodies stripped (typically 85-95% fewer tokens than reading the file). Use BEFORE writing code that calls into a file: you see the real parameter names, arity, and return types instead of guessing. Works on a single file with no registry.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to skeletonize.' }
    },
    required: ['file_path']
  }
};

export async function handleFileSkeleton(args = {}) {
  const filePath = args.file_path;
  if (!filePath) {
    return { content: [{ type: 'text', text: 'Provide file_path.' }], isError: true };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { content: [{ type: 'text', text: `Cannot read ${filePath}: ${e.message}` }], isError: true };
  }

  const totalLines = content.split('\n').length;
  const ext = path.extname(filePath);
  const astLang = AST_LANGS[ext];
  const name = path.basename(filePath);
  const lines = [];

  if (astLang) {
    let skel;
    try {
      skel = extractJsSkeleton(content, astLang);
    } catch {
      skel = null;
    }
    if (skel) {
      const symCount = skel.functions.length + skel.classes.length;
      lines.push(`# Skeleton: ${name} (${totalLines} lines → ${symCount} symbols)`);
      if (skel.classes.length) {
        lines.push('\n## Classes / Types');
        for (const c of skel.classes) {
          lines.push(`- ${c.name.includes(' ') ? c.name : 'class ' + c.name} (line ${c.line})`);
          for (const m of c.methods) lines.push(`    ${m.sig}  [${m.line}]`);
        }
      }
      if (skel.functions.length) {
        lines.push('\n## Functions');
        for (const f of skel.functions) lines.push(`- ${f.sig}  [${f.line}]`);
      }
      if (skel.exports.length) {
        lines.push('\n## Exports');
        lines.push(`- ${skel.exports.join(', ')}`);
      }
      if (lines.length === 1) lines.push('\n(no top-level declarations found)');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  }

  // Generic / fallback
  const decls = extractGenericSkeleton(content);
  lines.push(`# Skeleton: ${name} (${totalLines} lines → ${decls.length} declarations)`);
  if (decls.length === 0) {
    lines.push('\n(no recognizable declarations — read the file directly)');
  } else {
    lines.push('');
    for (const d of decls) lines.push(`- ${d.sig}  [${d.line}]`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
