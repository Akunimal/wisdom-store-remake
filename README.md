# 🛡️ Anti-Hallucination-MCP

[![CI](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/codeql.yml/badge.svg)](https://github.com/Akunimal/Anti-Hallucination-MCP/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

**Minimalist MCP server + hooks for anti-hallucination in AI coding assistants (Claude Code, Codex, Antigravity IDE, OpenCode, Cursor, Windsurf, etc.).**

**Servidor MCP minimalista + hooks para anti-alucinación en AI coding assistants (Claude Code, Codex, Antigravity IDE, OpenCode, Cursor, Windsurf, etc.).**

> **Focused Core** — Four core anti-hallucination tools plus four companion tools for environment detection, token-efficient output, hallucination analytics, and compression metrics. Redundant context management and general memory storage were removed due to overlap with other tools (Serena MCP, GSD Skills).
>
> **Núcleo Enfocado** — Cuatro herramientas core anti-alucinación más cuatro herramientas complementarias para detección de entorno, output eficiente en tokens, analítica de alucinaciones y métricas de compresión. La gestión de contexto y la memoria general fueron eliminadas por solapamiento con otras herramientas (Serena MCP, GSD Skills).

### 🔀 About Anti-Hallucination-MCP

Anti-Hallucination-MCP is a focused, high-performance MCP server with **8 tools**: 4 core anti-hallucination tools and 4 companion tools for environment detection, token-efficient command output with secret redaction, cross-session hallucination tracking, and compression analytics. It avoids redundant features like context management or general wisdom storage that overlap with Claude Code's native auto-compact, Serena MCP's memory system, or GSD Skills' planning capabilities.

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
Symbol registry with **fuzzy matching** and **confidence scoring** that detects:
- Hallucinated function names (with 0-100% confidence per symbol)
- Typos in imports and calls (fuzzy match with suggestion)
- Unknown or non-existent symbols
- Import paths to files that don't exist
- Invalid API routes
- **Repeat offenders** — symbols hallucinated across multiple sessions are flagged with `⚠️ [REPEAT]`

**Automatic post-write hook** that warns after every edit.

### 🗜️ Token Compressor Engine
Native Node.js implementation of intelligent filtering strategies inspired by RTK (Rust Token Killer). It executes shell commands and returns token-optimized output, drastically reducing the context window usage for the AI while preserving critical fidelity.

**Key Features:**
- **Zero-Install:** Runs natively in Node.js (Windows, macOS, Linux). No Rust compilation needed.
- **Smart Strategies:** Detects `git`, `test runners`, `linters`, and `file listings`.
- **High Fidelity:** Preserves 100% of actual code changes (lossless diffs) while stripping noise (index hashes, ANSI colors).
- **🔒 Secret Redaction (v0.8.0):** Automatically detects and redacts API keys, tokens, passwords, and credentials before output reaches the LLM. Covers 15+ patterns (OpenAI, GitHub, AWS, Stripe, Slack, npm, connection strings, Bearer tokens, private keys).
- **📊 Line Deduplication (v0.8.0):** Collapses consecutive identical lines with `[×N]` counters. Highly effective for npm install warnings and build output.
- **🔗 Similar Line Grouping (v0.8.1):** Collapses consecutive lines sharing a common prefix (e.g., `npm warn deprecated module-a`, `module-b`, `module-c`) into a single grouped summary. Saves 200-500 additional tokens on repetitive output.
- **⚡ Threshold Compression (v0.8.0):** Skips compression when savings are below 10% to avoid overhead. Returns raw cleaned output instead.
- **🛡️ Fail-Open (v0.8.0):** If the compressor crashes internally, the raw command output is returned instead of an error.

**Token Savings Benchmark vs Raw Output:**
| Command | Raw Tokens | WSR Compressed | Savings |
|---------|-----------|----------------|---------|
| `git status` | 244 | 167 | **32%** |
| `git log -30` | 568 | 375 | **34%** |
| `ls -la` | 581 | 136 | **77%** |
| `git diff` | 3929 | ~1000 | **~75%** (Preserves code!)* |

*\* WSR follows RTK's philosophy: it heavily compresses noise but refuses to blindly truncate critical content like code diffs, ensuring the AI can actually read the changes.*

### 🤖 Universally Compatible with MCP Clients
The MCP server works natively with **any AI IDE or client that supports the Model Context Protocol** (OpenCode, Cursor, Windsurf, Cline, RooCode, Zed, etc.).
- **Automated setup** is provided for Claude Code, Codex, and Antigravity IDE.
- **Manual configuration** works for all other MCP clients by pointing them to the `src/mcp-server/index.js` file.

### 🌐 Universal IDE Support (Shell Aliases)
To get automatic output compression for verbose commands (like `npm install` or `cargo build`) in **any IDE terminal** (Cursor, Windsurf, Cline, etc.), you can set up shell aliases. This guarantees that your LLM only sees the token-optimized output, saving context window space.

Add these aliases to your `~/.bashrc`, `~/.zshrc`, or `$PROFILE` (PowerShell):
```bash
# Example for ~/.bashrc or ~/.zshrc
alias npm="node /path/to/Anti-Hallucination-MCP/hooks/post-command-compress.js npm"
alias tsc="node /path/to/Anti-Hallucination-MCP/hooks/post-command-compress.js tsc"
alias cargo="node /path/to/Anti-Hallucination-MCP/hooks/post-command-compress.js cargo"
```
*(Claude Code users: the setup script already installs a native `PostToolUse` hook, so aliases are not required).*

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
5. ✅ Configure `~/.gemini/antigravity-ide/mcp_config.json` with the MCP server
6. ✅ Validate installation
7. ✅ Provide next steps

---

## 🧰 MCP Tools (8 focused tools)

| Tool | Description | When to use |
|------|-------------|-------------|
| `detect_environment` | Detects OS, shell, WSL/Git Bash/native toolchains, package managers, and quoting rules. Returns compact text (~250 tokens) by default; pass `compact: false` for full JSON diagnostic | At the start of a session or when in doubt about command compatibility (especially on Windows) |
| `reindex_project` | Scans project, extracts symbols via AST, saves to `.wisdom/symbols.json` | Project start or after major changes |
| `get_project_overview` | Compact project map — file tree, symbols, API routes, HTML pages | First step in a new task |
| `check_symbols` | Cross-references symbols against registry with **confidence scoring** (0-100%). Reports: confirmed ✅, fuzzy match ⚠️ (typo?), or unknown ❌. Flags repeat offenders across sessions | After writing new code |
| `refresh_symbols` | Re-scans and updates symbol registry | When `check_symbols` reports legitimate unknowns (new symbols) |
| `compress_output` | **Prefer over native shell execution** for git, npm, cargo, pip, make, tsc, eslint. Returns token-optimized output (saves 60-90% context). **Auto-redacts** secrets. Groups similar lines | When running tests, builds, git status, or listing files. Treat as local command execution, not read-only analysis |
| `get_hallucination_report` | **NEW (v0.8.0)**: Shows frequently hallucinated symbols, recent events, and breakdown by type across sessions | End-of-session review, onboarding a new agent, or analyzing recurring hallucination patterns |
| `get_compression_stats` | **NEW (v0.8.0)**: Session-level compression analytics — total tokens saved, breakdown by category, top individual wins | Understanding the value of `compress_output`, optimizing token usage |

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

### Antigravity IDE MCP Configuration

Add to `~/.gemini/antigravity-ide/mcp_config.json`:

```json
{
  "mcpServers": {
    "wisdom-store": {
      "command": "node",
      "args": ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Restart Antigravity IDE to connect.

### Other IDEs (OpenCode, Cursor, Windsurf, etc.)

For any other MCP-compatible IDE, add a Node.js MCP server using the following parameters:
- **Type/Command:** `node`
- **Arguments:** `/absolute/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js`

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

By default, probable typos (fuzzy match ≥85% confidence) are **reported as warnings** so the agent can fix them deliberately. Set `ANTIHALL_AUTOFIX=1` in the environment to let the hook rewrite the typo'd identifier in place automatically (strings, comments, and markdown prose are never touched).

### CI/CD Integration

You can integrate the anti-hallucination check into your GitHub Actions workflow to prevent merging code with hallucinated symbols. See [`.github/workflows/symbol-check.yml`](.github/workflows/symbol-check.yml) for an example.

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

## 🖥️ Environment Detection

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

**Compact mode (v0.8.1):** By default, returns a concise text summary (~250 tokens) with only the recommendation, key rules, and warnings. Pass `compact: false` to get the full JSON diagnostic (~1,500 tokens) for debugging.

**Usage:**
```bash
# Call via MCP (compact by default)
/detect_environment

# Full JSON diagnostic
/detect_environment {"compact": false}

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
   ├─> ✅ Confirmed (100% confidence) → continue
   ├─> ⚠️ Fuzzy match (30-70% confidence) → possible typo, review
   ├─> ❌ Unknown (0% confidence) → check if hallucination or new symbol
   └─> ⚠️ [REPEAT] → symbol has been flagged before (cross-session tracking)

4. If there are legitimate unknowns (new symbols)
   └─> refresh_symbols → update registry

5. End of session (optional)
   └─> get_hallucination_report → review patterns
```

**The post-write hook does step 3 automatically** after each Write/Edit.

---

## 📦 Requirements

- Node.js 18+
- Any MCP-compatible client (Claude Code, Codex, Antigravity IDE, OpenCode, Cursor, Windsurf, etc.)
- Git (optional, for versioning `.wisdom/` directory)

---

## 🧪 Tests

```bash
npm test
```

Expected output:
```
✔ Secret Redaction Engine
✔ Line Deduplication
✔ Hallucination Tracker
✔ Token Compressor Engine
...
55 passing (17s)
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
Registro de símbolos con **fuzzy matching** y **scoring de confianza** que detecta:
- Nombres de funciones hallucinados (con 0-100% de confianza por símbolo)
- Typos en imports y llamadas (fuzzy match con sugerencia)
- Símbolos desconocidos o inexistentes
- Import paths a archivos que no existen
- Rutas API inválidas
- **Reincidentes** — símbolos alucinados en múltiples sesiones se marcan con `⚠️ [REPEAT]`

**Hook post-write automático** que advierte después de cada edición.

### 🗜️ Token Compressor Engine
Implementación nativa en Node.js de estrategias de filtrado inteligente inspiradas en RTK (Rust Token Killer). Ejecuta comandos de shell y retorna un output optimizado, reduciendo drásticamente el consumo de tokens de la IA mientras preserva la fidelidad crítica de los datos.

**Características Clave:**
- **Zero-Install:** Funciona de forma nativa en Node.js (Windows, macOS, Linux). No requiere compilar Rust.
- **Estrategias Inteligentes:** Detecta `git`, `test runners`, `linters` y `listados de archivos`.
- **Alta Fidelidad:** Preserva el 100% de los cambios de código reales (diffs lossless) eliminando únicamente el ruido (hashes de index, colores ANSI).
- **🔒 Redacción de Secretos (v0.8.0):** Detecta y redacta automáticamente API keys, tokens, contraseñas y credenciales antes de que el output llegue al LLM. Cubre 15+ patrones (OpenAI, GitHub, AWS, Stripe, Slack, npm, connection strings, Bearer tokens, claves privadas).
- **📊 Deduplicación de Líneas (v0.8.0):** Colapsa líneas consecutivas idénticas con contadores `[×N]`. Altamente efectivo para warnings de npm install y output de builds.
- **🔗 Agrupación de Líneas Similares (v0.8.1):** Colapsa líneas consecutivas que comparten un prefijo común (ej: `npm warn deprecated module-a`, `module-b`, `module-c`) en un único resumen agrupado. Ahorra 200-500 tokens adicionales en output repetitivo.
- **⚡ Compresión con Umbral (v0.8.0):** Omite la compresión cuando el ahorro es menor al 10% para evitar overhead innecesario.
- **🛡️ Fail-Open (v0.8.0):** Si el compresor falla internamente, retorna el output crudo del comando en lugar de un error.

**Benchmark de Ahorro de Tokens vs Output Crudo:**
| Comando | Tokens Crudos | WSR Comprimido | Ahorro |
|---------|---------------|----------------|--------|
| `git status` | 244 | 167 | **32%** |
| `git log -30` | 568 | 375 | **34%** |
| `ls -la` | 581 | 136 | **77%** |
| `git diff` | 3929 | ~1000 | **~75%** (¡Preserva el código!)* |

*\* WSR sigue la filosofía de RTK: comprime fuertemente el ruido pero se rehúsa a truncar ciegamente contenido crítico como los diffs de código, asegurando que la IA realmente pueda leer los cambios.*

### 🤖 Universalmente Compatible con Clientes MCP
El servidor MCP funciona de forma nativa con **cualquier AI IDE o cliente que soporte el Model Context Protocol** (OpenCode, Cursor, Windsurf, Cline, RooCode, Zed, etc.).
- **Configuración automática** provista para Claude Code, Codex y Antigravity IDE.
- **Configuración manual** funciona para todos los demás clientes apuntándolos al archivo `src/mcp-server/index.js`.

### 🌐 Soporte Universal para IDEs (Shell Aliases)
Para obtener compresión automática de comandos ruidosos (como `npm install` o `cargo build`) en **cualquier terminal de IDE** (Cursor, Windsurf, Cline, etc.), podés configurar shell aliases. Esto garantiza que tu LLM solo vea el output optimizado, ahorrando espacio en la ventana de contexto.

Agregá estos alias a tu `~/.bashrc`, `~/.zshrc`, o `$PROFILE` (PowerShell):
```bash
# Ejemplo para ~/.bashrc o ~/.zshrc
alias npm="node /ruta/a/Anti-Hallucination-MCP/hooks/post-command-compress.js npm"
alias tsc="node /ruta/a/Anti-Hallucination-MCP/hooks/post-command-compress.js tsc"
alias cargo="node /ruta/a/Anti-Hallucination-MCP/hooks/post-command-compress.js cargo"
```
*(Usuarios de Claude Code: el script de setup ya instala un hook nativo `PostToolUse`, por lo que los aliases no son necesarios).*

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
5. ✅ Configura `~/.gemini/antigravity-ide/mcp_config.json` con el servidor MCP
6. ✅ Valida la instalación
7. ✅ Proporciona los siguientes pasos

---

## 🧰 Tools MCP (8 tools enfocadas)

| Tool | Descripción | Cuándo usar |
|------|-------------|-------------|
| `detect_environment` | Detecta OS, shell, WSL/Git Bash/toolchains nativas, package managers y reglas de quoting. Retorna texto compacto (~250 tokens) por defecto; pasá `compact: false` para el JSON completo | Al inicio de una sesión o cuando tengas dudas sobre compatibilidad de comandos (especialmente en Windows) |
| `reindex_project` | Escanea el proyecto, extrae símbolos vía AST, guarda en `.wisdom/symbols.json` | Inicio del proyecto o después de cambios mayores |
| `get_project_overview` | Mapa compacto del proyecto — árbol de archivos, símbolos, rutas API, páginas HTML | Primer paso en una nueva tarea |
| `check_symbols` | Cruza símbolos contra el registro con **scoring de confianza** (0-100%). Reporta: confirmados ✅, fuzzy match ⚠️ (typo?), o desconocidos ❌. Marca reincidentes entre sesiones | Después de escribir código nuevo |
| `refresh_symbols` | Re-escanea y actualiza el registro de símbolos | Cuando `check_symbols` reporta unknowns legítimos (símbolos nuevos) |
| `compress_output` | **Preferir sobre ejecución nativa de shell** para git, npm, cargo, pip, make, tsc, eslint. Retorna output optimizado (ahorra 60-90% de contexto). **Auto-redacta** secretos. Agrupa líneas similares | Al correr tests, builds, git status, o listar archivos. Trátalo como ejecución local de comandos, no como análisis read-only |
| `get_hallucination_report` | **NUEVO (v0.8.0)**: Muestra símbolos frecuentemente alucinados, eventos recientes y desglose por tipo entre sesiones | Revisión de fin de sesión, onboarding de un nuevo agente, o análisis de patrones de alucinación recurrentes |
| `get_compression_stats` | **NUEVO (v0.8.0)**: Analítica de compresión a nivel de sesión — total de tokens ahorrados, desglose por categoría, mejores ahorros individuales | Entender el valor de `compress_output`, optimizar uso de tokens |

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

### Setup para Antigravity IDE

Agrega a `~/.gemini/antigravity-ide/mcp_config.json`:

```json
{
  "mcpServers": {
    "wisdom-store": {
      "command": "node",
      "args": ["/path/to/Anti-Hallucination-MCP/src/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

Reinicia Antigravity IDE para conectar.

### Otros IDEs (OpenCode, Cursor, Windsurf, etc.)

Para cualquier otro IDE compatible con MCP, agrega un servidor MCP de Node.js usando estos parámetros:
- **Tipo/Comando:** `node`
- **Argumentos:** `/ruta/absoluta/a/Anti-Hallucination-MCP/src/mcp-server/index.js`

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

Por defecto, los typos probables (fuzzy match ≥85% de confianza) se **reportan como warnings** para que el agente los corrija deliberadamente. Definí `ANTIHALL_AUTOFIX=1` en el entorno para que el hook reescriba el identificador automáticamente (strings, comentarios y prosa markdown nunca se tocan).

### Integración con CI/CD

Puedes integrar la verificación anti-alucinación en tu workflow de GitHub Actions para evitar que se aprueben PRs con símbolos alucinados. Consulta [`.github/workflows/symbol-check.yml`](.github/workflows/symbol-check.yml) para ver un ejemplo de implementación.

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

## 🖥️ Environment Detection

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

**Modo compacto (v0.8.1):** Por defecto retorna un resumen de texto conciso (~250 tokens) con solo la recomendación, reglas clave y advertencias. Pasá `compact: false` para obtener el JSON completo (~1,500 tokens) para debugging.

**Uso:**
```bash
# Llamar vía MCP (compacto por defecto)
/detect_environment

# JSON completo para diagnóstico
/detect_environment {"compact": false}

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
   ├─> ✅ Confirmados (100% confianza) → continuar
   ├─> ⚠️ Fuzzy match (30-70% confianza) → posible typo, revisar
   ├─> ❌ Unknowns (0% confianza) → verificar si es hallucination o símbolo nuevo
   └─> ⚠️ [REPEAT] → el símbolo fue marcado antes (tracking entre sesiones)

4. Si hay unknowns legítimos (símbolos nuevos)
   └─> refresh_symbols → actualizar el registro

5. Fin de sesión (opcional)
   └─> get_hallucination_report → revisar patrones
```

**El hook post-write hace el paso 3 automáticamente** después de cada Write/Edit.

---

## 📦 Requisitos

- Node.js 18+
- Cualquier cliente compatible con MCP (Claude Code, Codex, Antigravity IDE, OpenCode, Cursor, Windsurf, etc.)
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
