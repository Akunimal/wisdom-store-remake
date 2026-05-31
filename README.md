# wisdom-store (Lite)

MCP server minimalista + hooks para anti-alucinación en AI coding assistants.

> **Versión Lite** — Solo el núcleo anti-alucinación. Todo lo demás fue eliminado por solapamiento con otras herramientas.

## Qué hace

**Indexado de proyecto** — Extracción de símbolos basada en AST (vía `@ast-grep/napi`), detección de rutas API, inventario de páginas HTML.

**Anti-alucinación** — Registro de símbolos con fuzzy matching que detecta nombres de funciones hallucinados, typos y símbolos desconocidos. Incluye un hook post-write que automáticamente advierte sobre imports hallucinados, paths de archivos, llamadas a funciones y rutas API después de cada edición.

**Compatible con Claude Code y Codex** — El hook funciona en ambos mediante configuración estándar.

## Tools MCP (4)

| Tool | Descripción |
|------|-------------|
| `reindex_project` | Escanea el proyecto, extrae símbolos vía AST, guarda en `.wisdom/symbols.json` |
| `get_project_overview` | Mapa compacto del proyecto — árbol de archivos, símbolos, rutas API, páginas HTML |
| `check_symbols` | Cruza símbolos contra el registro. Reporta: confirmados, fuzzy match (typo?), o desconocidos |
| `refresh_symbols` | Re-escanea y actualiza el registro de símbolos |

## Install

```bash
git clone https://github.com/InfiniQuest-App/wisdom-store.git
cd wisdom-store
npm install
```

## Configuración MCP

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

## Hooks Anti-Alucinación

El directorio `hooks/` contiene scripts que se integran automáticamente con Claude Code o Codex.

### Post-Write Hallucination Check

Automáticamente chequea hallucinaciones después de cada Write/Edit:
- Import paths apuntando a archivos que no existen
- Símbolos importados no encontrados en el registro del proyecto
- Llamadas a funciones standalone a símbolos desconocidos
- Rutas API no encontradas en el índice del proyecto

Requiere `.wisdom/symbols.json` — ejecutá `get_project_overview` una vez para generarlo.

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

En tu configuración de hooks de Codex, agrega el hook post-write:

```json
{
  "hooks": {
    "post_write": "/path/to/wisdom-store/hooks/post-write-symbol-check.sh"
  }
}
```

El hook lee el input JSON estándar de ambos sistemas y responde con warnings en stderr (exit code 2).

## Cómo funciona

### Storage

Todo son archivos planos en un directorio `.wisdom/` en la raíz del proyecto:

```
.wisdom/
  symbols.json         # Registro de símbolos (funciones, clases, exports, rutas)
  index.json           # Lista de archivos + metadata
```

### Extracción AST

Usa `@ast-grep/napi` (basado en tree-sitter) para JavaScript/TypeScript/TSX. Extrae funciones, clases, variables, exports, interfaces, tipos, enums. Regex fallback para Python, Go, y Rust.

## Workflow típico

```
1. Empezar una tarea
2. get_project_overview → entender el codebase
3. Trabajar en la tarea
4. check_symbols después de escribir código → detectar hallucinations
5. Si check_symbols reporta unknowns: refresh_symbols para actualizar el registro
```

El hook post-write hace el paso 4 automáticamente después de cada Write/Edit.

## Soporte de lenguajes

| Lenguaje | Extracción AST | Regex fallback |
|----------|---------------|----------------|
| JavaScript (.js, .mjs, .cjs, .jsx) | Full | - |
| TypeScript (.ts, .tsx) | Full | - |
| Python (.py) | - | Funciones, clases, métodos |
| Go (.go) | - | Funciones, tipos, variables |
| Rust (.rs) | - | Funciones, structs, enums, traits |
| HTML (.html) | - | Títulos de página, estructura |

## Requisitos

- Node.js 18+
- Claude Code o Codex (para hooks)

## License

MIT
