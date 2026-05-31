# wisdom-store (Lite) 🛡️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

**MCP server minimalista + hooks para anti-alucinación en AI coding assistants.**

> **Versión Lite** — Solo el núcleo anti-alucinación. Todo lo demás fue eliminado por solapamiento con otras herramientas (Serena MCP, GSD Skills).

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
git clone https://github.com/InfiniQuest-App/wisdom-store.git
cd wisdom-store
npm install
```

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
      "args": ["/path/to/wisdom-store/src/mcp-server/index.js"],
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
          "command": "/path/to/wisdom-store/hooks/post-write-symbol-check.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "/path/to/wisdom-store/hooks/post-write-symbol-check.sh",
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
    "post_write": "/path/to/wisdom-store/hooks/post-write-symbol-check.sh"
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

| Lenguaje | Extensiones | Extracción AST | Regex fallback |
|----------|-------------|---------------|----------------|
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | ✅ Full | - |
| TypeScript | `.ts`, `.tsx` | ✅ Full | - |
| Python | `.py` | - | ✅ Funciones, clases, métodos |
| Go | `.go` | - | ✅ Funciones, tipos, variables |
| Rust | `.rs` | - | ✅ Funciones, structs, enums, traits |
| HTML | `.html` | - | ✅ Títulos de página, estructura |

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

## 📝 License

MIT
