# 🛡️ Anti-Hallucination-MCP

[![CI](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/codeql.yml/badge.svg)](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

**Minimalist MCP server + hooks for anti-hallucination in AI coding assistants.**

**Servidor MCP minimalista + hooks para anti-alucinación en AI coding assistants.**

> **Focused Core** — Four anti-hallucination tools plus two agent-safety companion tools. Redundant context management and general memory storage were removed due to overlap with other tools (Serena MCP, GSD Skills).
>
> **Núcleo Enfocado** — Cuatro herramientas anti-alucinación más dos herramientas complementarias de seguridad para agentes. La gestión de contexto y la memoria general fueron eliminadas por solapamiento con otras herramientas (Serena MCP, GSD Skills).

### 🔀 About Anti-Hallucination-MCP

Anti-Hallucination-MCP is a focused, high-performance MCP server with **6 tools**: 4 core anti-hallucination tools and 2 companion tools for environment detection and token-efficient command output. It avoids redundant features like context management or general wisdom storage that overlap with Claude Code’s native auto-compact, Serena MCP’s memory system, or GSD Skills’ planning capabilities.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full rationale and design decisions.

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

### 🗜️ Token Compressor Engine (NEW in v0.6.0)
Native Node.js implementation of intelligent filtering strategies inspired by RTK (Rust Token Killer). It executes shell commands and returns token-optimized output, drastically reducing the context window usage for the AI while preserving critical fidelity.

**Key Features:**
- **Zero-Install:** Runs natively in Node.js (Windows, macOS, Linux). No Rust compilation needed.
- **Smart Strategies:** Detects `git`, `test runners`, `linters`, and `file listings`.
- **High Fidelity:** Preserves 100% of actual code changes (lossless diffs) while stripping noise (index hashes, ANSI colors).

**Token Savings Benchmark vs Raw Output:**
| Command | Raw Tokens | WSR Compressed | Savings |
|---------|-----------|----------------|---------|
| `git status` | 244 | 167 | **32%** |
| `git log -30` | 568 | 375 | **34%** |
| `ls -la` | 581 | 136 | **77%** |
| `git diff` | 3929 | ~1000 | **~75%** (Preserves code!)* |

*\* WSR follows RTK's philosophy: it heavily compresses noise but refuses to blindly truncate critical content like code diffs, ensuring the AI can actually read the changes.*

### 🤖 Compatible with Claude Code and Codex
The MCP server works with Claude Code and Codex. The post-write hook is installed automatically for Claude Code only; Codex hook support depends on the Codex app/runtime hook mechanism and is documented as manual configuration.

---

## 🚀 Quick Installation

```bash
git clone https://github.com/Akunimal/Anti-Hallucination-MCP.git
cd Anti-Hallucination-MCP
npm install
```

### 🎁 Automated Setup (Recommended)

Run the setup script from the project you want to configure, or pass `--project` explicitly:

```bash
node /path/to/Anti-Hallucination-MCP/scripts/setup.js
node /path/to/Anti-Hallucination-MCP/scripts/setup.js --project /path/to/target-project
```

This script will:
1. ✅ Detect your OS and environment
2. ✅ Create `~/.claude` directory if needed
3. ✅ Configure `~/.claude/settings.json` with MCP server and Claude Code hooks
4. ✅ Configure `~/.codex/config.toml` with the MCP server
5. ✅ Validate installation
6. ✅ Provide next steps

---

## 🧰 MCP Tools (6 focused tools)

| Tool | Description | When to use |
|------|-------------|-------------|
| `detect_environment` | Detects OS, shell, WSL/Git Bash/native toolchains, package managers, and quoting rules to avoid cross-platform command failures | At the start of a session or when in doubt about command compatibility (especially on Windows) |
| `reindex_project` | Scans project, extracts symbols via AST, saves to `.wisdom/symbols.json` | Project start or after major changes |
| `get_project_overview` | Compact project map — file tree, symbols, API routes, HTML pages | First step in a new task |
| `check_symbols` | Cross-references symbols against registry. Reports: confirmed ✅, fuzzy match ⚠️ (typo?), or unknown ❌ | After writing new code |
| `refresh_symbols` | Re-scans and updates symbol registry | When `check_symbols` reports legitimate unknowns (new symbols) |
| `compress_output` | **NEW**: Executes a trusted local shell command and returns token-optimized output (saves 60-90% context) | When running tests, builds, git status, or listing files. Treat as local command execution, not read-only analysis |

---

## ⚙️ MCP Configuration

Add to your `~/.claude/settings.json` or project's `.mcp.json`:

```json
{
  "mcpServers": {
    "anti-hallucination": {
      "command": "node",
      "args": ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Restart Claude Code or run `/mcp` to connect.

### Codex MCP Configuration

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.anti-hallucination]
command = "node"
args = ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"]
startup_timeout_sec = 15
```

Restart Codex to connect.

### Compatibility Mode

`scripts/setup.js` reviews MCP servers configured globally and in the current repository (`~/.claude/settings.json`, `~/.codex/config.toml`, repo `.claude/settings.json`, repo `.mcp.json`, and repo `.codex/config.toml`). When it detects overlapping repository overview/navigation tools, such as Serena or Graphify, it configures the server to skip redundant tools:

```toml
[mcp_servers.anti-hallucination]
command = "node"
args = ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"]
env = { WISDOM_STORE_DISABLED_TOOLS = "get_project_overview" }
startup_timeout_sec = 15
```

You can manually disable any tool with `WISDOM_STORE_DISABLED_TOOLS`, using comma-separated names.

The setup also removes redundant repo-level MCP entries automatically when a better equivalent is already configured, while leaving global MCP configs untouched so other projects are not affected. Before changing an existing config file, it writes a timestamped `.backup.<timestamp>` copy next to that file.

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
          "command": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      }
    ]
  }
}
```

### Experimental Codex Hook Setup

`scripts/setup.js` configures the Codex MCP server, but it does not install Codex post-write hooks automatically. Codex hook payloads can vary by app/runtime version, so Codex hook wiring is experimental and should be verified in your environment before enabling it always-on. If your Codex runtime supports a compatible post-write hook configuration, you can wire this script manually:

```json
{
  "hooks": {
    "post_write": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh"
  }
}
```

The hook reads JSON input and responds with warnings to stderr (exit code 2).

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

Uses `@ast-grep/napi` (tree-sitter based) for JavaScript/TypeScript/TSX. Dynamic Polyglot AST extraction for Python, Go, and Rust via optional dependencies, with regex fallbacks.

### Language Support

| Language | Extensions | AST Extraction | Regex fallback | Extracted Symbols |
|----------|-------------|---------------|----------------|-------------------|
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | ✅ Full | - | functions, classes, variables, exports, methods |
| TypeScript | `.ts`, `.tsx` | ✅ Full | - | functions, classes, interfaces, types, enums, exports |
| Python | `.py` | ✅ Full (with `tree-sitter-python`) | ✅ | functions, classes, methods, constants |
| Go | `.go` | ✅ Full (with `tree-sitter-go`) | ✅ | functions, types, structs, interfaces, methods |
| Rust | `.rs` | ✅ Full (with `tree-sitter-rust`) | ✅ | functions, structs, enums, traits, methods |
| Bash/Shell | `.sh`, `.bash` | - | ✅ | functions |
| SQL | `.sql` | - | ✅ | tables, views, functions, procedures |
| YAML | `.yaml`, `.yml` | - | ✅ | top-level keys (config variables) |
| HTML | `.html` | - | ✅ | page titles, script dependencies, inline functions |

---

## 🖥️ Environment Detection (NEW in v0.5.0)

The `detect_environment` tool helps prevent cross-platform command errors by analyzing your system:

**What it detects:**
- **OS**: Windows, macOS, Linux (with version)
- **Shell**: PowerShell, cmd.exe, Git Bash, WSL, Bash, Zsh
- **Package Managers**: npm, yarn, pnpm, bun, pip, poetry, brew, apt, etc.
- **Available alternatives**: Suggests Git Bash or WSL on Windows for Unix compatibility

**Anti-error rules provided:**
- Command equivalents (e.g., `ls` → `Get-ChildItem` in PowerShell)
- Path format differences (`~/` vs `%USERPROFILE%`)
- Syntax warnings (redirection, exports, sourcing)
- Critical recommendations for Windows users

**Usage:**
```bash
# Call via MCP
/detect_environment

# Or standalone
node src/mcp-server/tools/detect-environment.js
```

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
✔ Token Compressor Engine (15.35ms)
...
14 passing (250ms)
```

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

### 🗜️ Token Compressor Engine (NUEVO en v0.6.0)
Implementación nativa en Node.js de estrategias de filtrado inteligente inspiradas en RTK (Rust Token Killer). Ejecuta comandos de shell y retorna un output optimizado, reduciendo drásticamente el consumo de tokens de la IA mientras preserva la fidelidad crítica de los datos.

**Características Clave:**
- **Zero-Install:** Funciona de forma nativa en Node.js (Windows, macOS, Linux). No requiere compilar Rust.
- **Estrategias Inteligentes:** Detecta `git`, `test runners`, `linters` y `listados de archivos`.
- **Alta Fidelidad:** Preserva el 100% de los cambios de código reales (diffs lossless) eliminando únicamente el ruido (hashes de index, colores ANSI).

**Benchmark de Ahorro de Tokens vs Output Crudo:**
| Comando | Tokens Crudos | WSR Comprimido | Ahorro |
|---------|---------------|----------------|--------|
| `git status` | 244 | 167 | **32%** |
| `git log -30` | 568 | 375 | **34%** |
| `ls -la` | 581 | 136 | **77%** |
| `git diff` | 3929 | ~1000 | **~75%** (¡Preserva el código!)* |

*\* WSR sigue la filosofía de RTK: comprime fuertemente el ruido pero se rehúsa a truncar ciegamente contenido crítico como los diffs de código, asegurando que la IA realmente pueda leer los cambios.*

### 🤖 Compatible con Claude Code y Codex
El servidor MCP funciona con Claude Code y Codex. El hook post-write se instala automáticamente para Claude Code; en Codex la configuración de hooks depende del runtime y se documenta como experimental/manual.

---

## 🚀 Instalación rápida

```bash
git clone https://github.com/Akunimal/Anti-Hallucination-MCP.git
cd Anti-Hallucination-MCP
npm install
```

### 🎁 Configuración automática (Recomendado)

Ejecuta el script de setup interactivo para configurar todo automáticamente:

```bash
node scripts/setup.js
node scripts/setup.js --project /path/to/target-project
```

Este script:
1. ✅ Detecta tu SO y entorno
2. ✅ Crea el directorio `~/.claude` si es necesario
3. ✅ Configura `settings.json` con el servidor MCP y hooks
4. ✅ Configura `~/.codex/config.toml` con el servidor MCP
5. ✅ Valida la instalación
6. ✅ Proporciona los siguientes pasos

---

## 🧰 Tools MCP (6 tools enfocadas)

| Tool | Descripción | Cuándo usar |
|------|-------------|-------------|
| `detect_environment` | Detecta OS, shell, WSL/Git Bash/toolchains nativas, package managers y reglas de quoting para evitar fallos de comandos entre plataformas | Al inicio de una sesión o cuando tengas dudas sobre compatibilidad de comandos (especialmente en Windows) |
| `reindex_project` | Escanea el proyecto, extrae símbolos vía AST, guarda en `.wisdom/symbols.json` | Inicio del proyecto o después de cambios mayores |
| `get_project_overview` | Mapa compacto del proyecto — árbol de archivos, símbolos, rutas API, páginas HTML | Primer paso en una nueva tarea |
| `check_symbols` | Cruza símbolos contra el registro. Reporta: confirmados ✅, fuzzy match ⚠️ (typo?), o desconocidos ❌ | Después de escribir código nuevo |
| `refresh_symbols` | Re-escanea y actualiza el registro de símbolos | Cuando `check_symbols` reporta unknowns legítimos (símbolos nuevos) |
| `compress_output` | **NUEVO**: Ejecuta un comando shell local confiable y retorna el output optimizado (ahorra 60-90% de contexto) | Al correr tests, builds, git status, o listar archivos. Trátalo como ejecución local de comandos, no como análisis read-only |

---

## ⚙️ Configuración MCP

Agrega a tu `~/.claude/settings.json` o `.mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "anti-hallucination": {
      "command": "node",
      "args": ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Reinicia Claude Code o ejecuta `/mcp` para conectar.

### Setup para Codex

Agrega a `~/.codex/config.toml`:

```toml
[mcp_servers.anti-hallucination]
command = "node"
args = ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"]
startup_timeout_sec = 15
```

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
          "command": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      }
    ]
  }
}
```

### Setup experimental para Codex

`scripts/setup.js` configura el servidor MCP para Codex, pero no instala hooks post-write de Codex automáticamente. Los payloads de hooks pueden variar según la versión del runtime/app, así que verificá el comportamiento en tu entorno antes de habilitarlo siempre. Si tu runtime soporta un hook post-write compatible, podés conectarlo manualmente:

```json
{
  "hooks": {
    "post_write": "/path/to/Anti-Hallucination-MCP/hooks/post-write-symbol-check.sh"
  }
}
```

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

Usa `@ast-grep/napi` (basado en tree-sitter) para JavaScript/TypeScript/TSX. Extracción Dinámica Políglota AST para Python, Go y Rust vía dependencias opcionales (con fallback a regex).

### Soporte de lenguajes

| Lenguaje | Extensiones | Extracción AST | Regex fallback | Símbolos extraídos |
|----------|-------------|---------------|----------------|-------------------|
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | ✅ Full | - | functions, classes, variables, exports, methods |
| TypeScript | `.ts`, `.tsx` | ✅ Full | - | functions, classes, interfaces, types, enums, exports |
| Python | `.py` | ✅ Full (con `tree-sitter-python`) | ✅ | functions, classes, methods, constants |
| Go | `.go` | ✅ Full (con `tree-sitter-go`) | ✅ | functions, types, structs, interfaces, methods |
| Rust | `.rs` | ✅ Full (con `tree-sitter-rust`) | ✅ | functions, structs, enums, traits, methods |
| Bash/Shell | `.sh`, `.bash` | - | ✅ | functions |
| SQL | `.sql` | - | ✅ | tables, views, functions, procedures |
| YAML | `.yaml`, `.yml` | - | ✅ | top-level keys (config variables) |
| HTML | `.html` | - | ✅ | page titles, script dependencies, inline functions |

---

## 🖥️ Environment Detection (NUEVO en v0.5.0)

La herramienta `detect_environment` ayuda a prevenir errores de plataforma cruzada analizando tu sistema operativo y shell:

**Qué detecta:**
- **OS**: Windows, macOS, Linux (con versión)
- **Shell**: PowerShell, cmd.exe, Git Bash, WSL, Bash, Zsh
- **Package Managers**: npm, yarn, pnpm, bun, pip, poetry, brew, apt, etc.
- **Alternativas disponibles**: Sugiere Git Bash o WSL en Windows para mayor compatibilidad Unix

**Reglas anti-errores que provee:**
- Comandos equivalentes (ej: `ls` → `Get-ChildItem` en PowerShell)
- Diferencias de formato de rutas (`~/` vs `%USERPROFILE%`)
- Advertencias de sintaxis (redirecciones, exports)
- Recomendaciones críticas para usuarios de Windows

**Uso:**
```bash
# Llamar vía MCP
/detect_environment

# O script standalone
node src/mcp-server/tools/detect-environment.js
```

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

---

## 📝 Licencia

MIT

---

## 🔗 Links / Enlaces

- **Repository / Repositorio:** https://github.com/Akunimal/Anti-Hallucination-MCP
- **Architecture / Arquitectura:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **Examples / Ejemplos:** [examples/](examples/)
