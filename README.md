# 🛡️ wisdom-store

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-5%20passing-brightgreen)](test/)

**Minimalist MCP server + hooks for anti-hallucination in AI coding assistants.**

**Servidor MCP minimalista + hooks para anti-alucinación en AI coding assistants.**

> **Focused Core** — Only the anti-hallucination essentials. Everything else was removed due to overlap with other tools (Serena MCP, GSD Skills).
>
> **Núcleo Enfocado** — Solo lo esencial anti-alucinación. Todo lo demás fue eliminado por solapamiento con otras herramientas (Serena MCP, GSD Skills).

---

## 🌐 Languages / Idiomas

- [🇺🇸 English](#-english)
- [🇪🇸 Español](#-español)

---

# 🇺🇸 English

## 🎯 What it does

### Project Indexing
AST-based symbol extraction (via `@ast-grep/napi`):
- Functions, classes, variables, exports, interfaces, types, enums
- Automatic API route detection (Express, Hono, Next.js)
- HTML page inventory

### 🔍 Anti-Hallucination
Symbol registry with **fuzzy matching** that detects:
- Hallucinated function names
- Typos in imports and calls
- Unknown or non-existent symbols
- Import paths to files that don't exist
- Invalid API routes

**Automatic post-write hook** that warns after every edit.

### 🤖 Compatible with Claude Code and Codex
The hook works on both via standard hook configuration.

---

## 🚀 Quick Installation

```bash
git clone https://github.com/Akunimal/wisdom-store-remake.git
cd wisdom-store-remake
npm install
```

### 🎁 Automated Setup (Recommended)

Run the interactive setup script to configure everything automatically:

```bash
node scripts/setup.js
```

This script will:
1. ✅ Detect your OS and environment
2. ✅ Create `~/.claude` directory if needed
3. ✅ Configure `settings.json` with MCP server and hooks
4. ✅ Validate installation
5. ✅ Provide next steps

---

## 🧰 MCP Tools (4 essential tools)

| Tool | Description | When to use |
|------|-------------|-------------|
| `reindex_project` | Scans project, extracts symbols via AST, saves to `.wisdom/symbols.json` | Project start or after major changes |
| `get_project_overview` | Compact project map — file tree, symbols, API routes, HTML pages | First step in a new task |
| `check_symbols` | Cross-references symbols against registry. Reports: confirmed ✅, fuzzy match ⚠️ (typo?), or unknown ❌ | After writing new code |
| `refresh_symbols` | Re-scans and updates symbol registry | When `check_symbols` reports legitimate unknowns (new symbols) |

---

## ⚙️ MCP Configuration

Add to your `~/.claude/settings.json` or project's `.mcp.json`:

```json
{
  "mcpServers": {
    "wisdom-store": {
      "command": "node",
      "args": ["/path/to/wisdom-store-remake/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Restart Claude Code or run `/mcp` to connect.

---

## 🛡️ Anti-Hallucination Hooks

The `hooks/` directory contains scripts that integrate automatically with Claude Code or Codex.

### Post-Write Hallucination Check

Automatically checks hallucinations after each Write/Edit:

- ❌ Import paths pointing to non-existent files
- ❌ Imported symbols not found in project registry
- ❌ Standalone function calls to unknown symbols
- ❌ API routes not found in project index

**Requires** `.wisdom/symbols.json` — run `get_project_overview` or `reindex_project` once to generate it.

### Claude Code Setup

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (project):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [{
          "type": "command",
          "command": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      }
    ]
  }
}
```

### Codex Setup

In your Codex hooks configuration:

```json
{
  "hooks": {
    "post_write": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh"
  }
}
```

The hook reads standard JSON input from both systems and responds with warnings to stderr (exit code 2).

---

## 📁 Storage Structure

Everything is plain text files in a `.wisdom/` directory at the project root:

```
.wisdom/
  symbols.json         # Symbol registry (functions, classes, exports, routes)
  index.json           # File list + metadata
```

---

## 🔧 How it works

### AST Extraction

Uses `@ast-grep/napi` (tree-sitter based) for JavaScript/TypeScript/TSX. Regex fallback for Python, Go, and Rust.

### Language Support

| Language | Extensions | AST Extraction | Regex fallback | Extracted Symbols |
|----------|-------------|---------------|----------------|-------------------|
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | ✅ Full | - | functions, classes, variables, exports, methods |
| TypeScript | `.ts`, `.tsx` | ✅ Full | - | functions, classes, interfaces, types, enums, exports |
| Python | `.py` | - | ✅ | functions, classes, methods, constants |
| Go | `.go` | - | ✅ | functions, types, structs, interfaces, variables |
| Rust | `.rs` | - | ✅ | functions, structs, enums, traits, constants |
| Bash/Shell | `.sh`, `.bash` | - | ✅ | functions |
| SQL | `.sql` | - | ✅ | tables, views, functions, procedures |
| YAML | `.yaml`, `.yml` | - | ✅ | top-level keys (config variables) |
| HTML | `.html` | - | ✅ | page titles, script dependencies, inline functions |

---

## 🔄 Typical Workflow

```
1. Start a task
   └─> get_project_overview → understand the codebase

2. Work on the task
   └─> Write code...

3. check_symbols (automatic via post-write hook)
   ├─> ✅ Confirmed symbols → continue
   ├─> ⚠️ Fuzzy match → possible typo, review
   └─> ❌ Unknowns → check if hallucination or new symbol

4. If there are legitimate unknowns (new symbols)
   └─> refresh_symbols → update registry
```

**The post-write hook does step 3 automatically** after each Write/Edit.

---

## 📦 Requirements

- Node.js 18+
- Claude Code or Codex (for hooks)
- Git (optional, for versioning `.wisdom/` directory)

---

## 🧪 Tests

```bash
npm test
```

Expected output:
```
✔ symbol-check detects known symbols
✔ symbol-check reports unknown symbols
✔ symbol-check fuzzy matches typos
✔ symbol-check handles empty registry
✔ symbol-check handles missing file

5 passing (XXms)
```

---

## 📊 Before vs After

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| MCP Tools | 24 | 4 | -83% |
| Code Files | 50+ | 15 | -70% |
| Lines of Code | ~12,500 | ~800 | -94% |
| Internal Libraries | 10 | 2 | -80% |

---

## 📝 License

MIT

---

# 🇪🇸 Español

## 🎯 Qué hace

### Indexado de proyecto
Extracción de símbolos basada en AST (vía `@ast-grep/napi`):
- Funciones, clases, variables, exports, interfaces, tipos, enums
- Detección automática de rutas API (Express, Hono, Next.js)
- Inventario de páginas HTML

### 🔍 Anti-alucinación
Registro de símbolos con **fuzzy matching** que detecta:
- Nombres de funciones hallucinados
- Typos en imports y llamadas
- Símbolos desconocidos o inexistentes
- Import paths a archivos que no existen
- Rutas API inválidas

**Hook post-write automático** que advierte después de cada edición.

### 🤖 Compatible con Claude Code y Codex
El hook funciona en ambos mediante configuración estándar de hooks.

---

## 🚀 Instalación rápida

```bash
git clone https://github.com/Akunimal/wisdom-store-remake.git
cd wisdom-store-remake
npm install
```

### 🎁 Configuración automática (Recomendado)

Ejecuta el script de setup interactivo para configurar todo automáticamente:

```bash
node scripts/setup.js
```

Este script:
1. ✅ Detecta tu SO y entorno
2. ✅ Crea el directorio `~/.claude` si es necesario
3. ✅ Configura `settings.json` con el servidor MCP y hooks
4. ✅ Valida la instalación
5. ✅ Proporciona los siguientes pasos

---

## 🧰 Tools MCP (4 tools esenciales)

| Tool | Descripción | Cuándo usar |
|------|-------------|-------------|
| `reindex_project` | Escanea el proyecto, extrae símbolos vía AST, guarda en `.wisdom/symbols.json` | Inicio del proyecto o después de cambios mayores |
| `get_project_overview` | Mapa compacto del proyecto — árbol de archivos, símbolos, rutas API, páginas HTML | Primer paso en una nueva tarea |
| `check_symbols` | Cruza símbolos contra el registro. Reporta: confirmados ✅, fuzzy match ⚠️ (typo?), o desconocidos ❌ | Después de escribir código nuevo |
| `refresh_symbols` | Re-escanea y actualiza el registro de símbolos | Cuando `check_symbols` reporta unknowns legítimos (símbolos nuevos) |

---

## ⚙️ Configuración MCP

Agrega a tu `~/.claude/settings.json` o `.mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "wisdom-store": {
      "command": "node",
      "args": ["/path/to/wisdom-store-remake/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Reinicia Claude Code o ejecuta `/mcp` para conectar.

---

## 🛡️ Hooks Anti-Alucinación

El directorio `hooks/` contiene scripts que se integran automáticamente con Claude Code o Codex.

### Post-Write Hallucination Check

Automáticamente chequea hallucinaciones después de cada Write/Edit:

- ❌ Import paths apuntando a archivos que no existen
- ❌ Símbolos importados no encontrados en el registro del proyecto
- ❌ Llamadas a funciones standalone a símbolos desconocidos
- ❌ Rutas API no encontradas en el índice del proyecto

**Requiere** `.wisdom/symbols.json` — ejecutá `get_project_overview` o `reindex_project` una vez para generarlo.

### Setup para Claude Code

Agregar a `~/.claude/settings.json` (global) o `.claude/settings.json` (proyecto):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [{
          "type": "command",
          "command": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      }
    ]
  }
}
```

### Setup para Codex

En tu configuración de hooks de Codex:

```json
{
  "hooks": {
    "post_write": "/path/to/wisdom-store-remake/hooks/post-write-symbol-check.sh"
  }
}
```

El hook lee el input JSON estándar de ambos sistemas y responde con warnings en stderr (exit code 2).

---

## 📁 Estructura de almacenamiento

Todo son archivos planos en un directorio `.wisdom/` en la raíz del proyecto:

```
.wisdom/
  symbols.json         # Registro de símbolos (funciones, clases, exports, rutas)
  index.json           # Lista de archivos + metadata
```

---

## 🔧 Cómo funciona

### Extracción AST

Usa `@ast-grep/napi` (basado en tree-sitter) para JavaScript/TypeScript/TSX. Regex fallback para Python, Go, y Rust.

### Soporte de lenguajes

| Lenguaje | Extensiones | Extracción AST | Regex fallback | Símbolos extraídos |
|----------|-------------|---------------|----------------|-------------------|
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | ✅ Full | - | functions, classes, variables, exports, methods |
| TypeScript | `.ts`, `.tsx` | ✅ Full | - | functions, classes, interfaces, types, enums, exports |
| Python | `.py` | - | ✅ | functions, classes, methods, constants |
| Go | `.go` | - | ✅ | functions, types, structs, interfaces, variables |
| Rust | `.rs` | - | ✅ | functions, structs, enums, traits, constants |
| Bash/Shell | `.sh`, `.bash` | - | ✅ | functions |
| SQL | `.sql` | - | ✅ | tables, views, functions, procedures |
| YAML | `.yaml`, `.yml` | - | ✅ | top-level keys (config variables) |
| HTML | `.html` | - | ✅ | page titles, script dependencies, inline functions |

---

## 🔄 Workflow típico

```
1. Empezar una tarea
   └─> get_project_overview → entender el codebase

2. Trabajar en la tarea
   └─> Escribir código...

3. check_symbols (automático via hook post-write)
   ├─> ✅ Símbolos confirmados → continuar
   ├─> ⚠️ Fuzzy match → posible typo, revisar
   └─> ❌ Unknowns → verificar si es hallucination o símbolo nuevo

4. Si hay unknowns legítimos (símbolos nuevos)
   └─> refresh_symbols → actualizar el registro
```

**El hook post-write hace el paso 3 automáticamente** después de cada Write/Edit.

---

## 📦 Requisitos

- Node.js 18+
- Claude Code o Codex (para hooks)
- Git (opcional, para versionado del directorio `.wisdom/`)

---

## 🧪 Tests

```bash
npm test
```

Resultado esperado:
```
✔ symbol-check detecta símbolos conocidos
✔ symbol-check reporta símbolos desconocidos
✔ symbol-check hace fuzzy match de typos
✔ symbol-check maneja registry vacío
✔ symbol-check maneja archivo faltante

5 passing (XXms)
```

---

## 📊 Antes vs Después

| Métrica | Antes | Después | Cambio |
|---------|-------|---------|--------|
| Tools MCP | 24 | 4 | -83% |
| Archivos de código | 50+ | 15 | -70% |
| Líneas de código | ~12,500 | ~800 | -94% |
| Librerías internas | 10 | 2 | -80% |

---

## 📝 Licencia

MIT

---

## 🔗 Links / Enlaces

- **Repository / Repositorio:** https://github.com/Akunimal/wisdom-store-remake
- **Detailed Summary / Resumen Detallado:** [FOLK_SUMMARY.md](FOLK_SUMMARY.md)
- **Examples / Ejemplos:** [examples/](examples/)
