# 🛡️ wisdom-store-remake: Architecture & Design Decisions

## Resumen Ejecutivo

wisdom-store fue **reducido de 24 tools a 4 tools esenciales**, eliminando ~12,000 líneas de código redundante y enfocándose exclusivamente en su funcionalidad más valiosa: **prevención de alucinaciones en AI coding assistants**.

---

## 📊 Antes vs Después

| Métrica | Antes | Después | Cambio |
|---------|-------|---------|--------|
| Tools MCP | 24 | 4 | -83% |
| Archivos de código | 50+ | 15 | -70% |
| Líneas de código | ~12,500 | ~800 | -94% |
| Librerías internas | 10 | 2 | -80% |
| Tests | 10 | 5 | -50% (solo los relevantes) |

---

## 🔪 Qué fue eliminado

### Tools removidas (19 total)

#### Context Manipulation (8 tools)
- `prune_context` — Solapado con auto-compact de Claude Code 2026
- `sandwich_prune` — Linux-only, no funciona en Windows
- `prune_to_handoff` — GSD ya maneja handoffs
- `inject_context` — Redundante
- `restore_context` — Redundante
- `compact_context` — Auto-compact nativo es mejor
- `inspect_pruned_messages` — Debug tool, no esencial
- `context_status` — Mantenida como readonly (diagnóstico)

#### Wisdom Management (6 tools)
- `save_wisdom` — Serena tiene `write_memory` con edición real
- `get_wisdom` — Serena tiene `read_memory`
- `list_wisdom` — Serena tiene `list_memories`
- `annotate_wisdom` — Serena tiene `edit_memory`
- `update_plan` — GSD maneja planes en `.planning/`
- `backup_plan` — GSD maneja backups

#### Archive Tools (5 tools)
- `analyze_for_archive` — Funcionalidad niche
- `analyze_for-archive-v2` — Versión alternativa
- `condense_jsonl_blocks` — Condensación de contexto
- `apply_archive_plan` — Aplicación de planes de archivo
- `restore_archive_backup` — Restauración de backups

#### Utilities (1 tool)
- `add_dir` — `execute_shell_command` de Serena es más potente

### Librerías eliminadas (9 archivos)

```
src/mcp-server/lib/
  ❌ anthropic-client.js    — Solo usada por save_wisdom
  ❌ jsonl.js               — Manipulación de JSONL para archive
  ❌ jsonl-mutate.js        — Mutaciones de contexto
  ❌ jsonl-condense.js      — Condensación de bloques
  ❌ condense-meta.js       — Metadata de condensación
  ❌ orphan-summarizer.js   — Resumen de mensajes huérfanos
  ❌ refetch-summarizer.js  — Resumen de refetch
  ❌ turn-prefilter.js      — Pre-filtrado de turns
  ❌ turn-segmenter.js      — Segmentación de turns
```

### Tests eliminados (7 archivos)

Todos los tests dependían de librerías eliminadas:
- `test/apply-archive-plan.test.js`
- `test/jsonl-condense.test.js`
- `test/jsonl-mutate.test.js`
- `test/restore-archive-backup.test.js`
- `test/sandwich-prune.test.js`
- `test/turn-prefilter.test.js`
- `test/turn-segmenter.test.js`

---

## ✅ Qué fue mantenido

### Tools esenciales (4 + 1 opcional)

| Tool | Propósito | Estado |
|------|-----------|--------|
| `reindex_project` | Extrae símbolos vía AST, guarda en `.wisdom/symbols.json` | ✅ Core |
| `get_project_overview` | Snapshot compacto del proyecto | ✅ Core |
| `check_symbols` | **Anti-alucinación**: detecta símbolos hallucinados | ✅ CORE |
| `refresh_symbols` | Actualiza el registry post-cambios | ✅ Core |
| `context_status` | Diagnóstico readonly (opcional) | ⚠️ Opcional |

### Librerías mantenidas (2 archivos)

```
src/mcp-server/lib/
  ✅ indexer.js   — AST parser (@ast-grep/napi) + symbol check + fuzzy matching
  ✅ wisdom.js    — Utilidades: findProjectRoot, getWisdomDir, readSymbols, writeSymbols
```

### Hooks anti-alucinación (2 archivos)

```
hooks/
  ✅ symbol-check.mjs          — Verificador standalone de símbolos
  ✅ post-write-symbol-check.sh — Hook automático post-Write/Edit
```

**El hook es compatible con:**
- Claude Code (via `PostToolUse` hooks)
- Codex (via `post_write` hooks)

### Tests mantenidos (1 archivo nuevo)

```
test/
  ✅ symbol-check.test.js — Tests del verificador anti-alucinación
```

---

## 🎯 Por qué esta reducción

### Análisis de solapamiento

| Capacidad | wisdom-store | Serena MCP | GSD Skills | Decisión |
|-----------|--------------|------------|------------|----------|
| Símbolos/AST | `reindex_project`, `check_symbols` | LSP real (`find_symbol`, `get_symbols_overview`) | `/gsd-map-codebase` | ✅ Mantener solo anti-hallucination |
| Memoria persistente | `save_wisdom`, `get_wisdom`, `list_wisdom` | `write_memory`, `read_memory`, `list_memories`, `edit_memory`, `delete_memory` | `.planning/` dir | ❌ Eliminar (Serena es superior) |
| Planes | `update_plan`, `backup_plan` | — | GSD maneja fases, specs, learnings | ❌ Eliminar (GSD es el owner) |
| Context management | 8 tools de prune/compact/inject | — | `gsd-context-monitor.js` hook | ❌ Eliminar (Linux-only, GSD ya lo hace) |
| Archive/Condense | 5 tools de analyze/condense/restore | — | — | ❌ Eliminar (funcionalidad niche) |
| Anti-hallucination | `check_symbols`, `refresh_symbols`, hooks | ❌ No existe | ❌ No existe | ✅ **MANTENER — Único y valioso** |

### Conclusión del análisis

**La única funcionalidad verdaderamente única y sin equivalente** en el stack es el sistema anti-alucinación:
- `check_symbols` con fuzzy matching
- `refresh_symbols` para actualizar registry
- Hook `post-write-symbol-check.sh` que corre automáticamente

Todo lo demás tiene mejor alternativa en Serena MCP o GSD Skills.

---

## 🔧 Cambios técnicos clave

### 1. Hook post-write-symbol-check.sh mejorado

**Antes:** Dependía de paths absolutos, solo funcionaba en Linux.

**Ahora:** 
- Lee stdin JSON estándar (compatible Claude Code + Codex)
- Responde con warnings en stderr (exit code 2)
- Timeout configurable (10s default)
- Funciona en Windows, macOS, Linux

### 2. symbol-check.mjs mejorado

**Antes:** Lectura síncrona, errores silenciosos.

**Ahora:**
- Lectura asíncrona de stdin
- Manejo explícito de errores
- Output estructurado para parsing
- Fuzzy matching mejorado (umbral 0.8)

### 3. Eliminación de dependencias Linux-specific

Las tools de context manipulation usaban `/proc/<pid>/fd/` para acceder a los JSONL de Claude Code. Esto:
- No funciona en Windows
- Es frágil en macOS
- Depende de implementación interna de Claude Code

Fueron eliminadas porque:
- Claude Code 2026 tiene auto-compact mejorado
- GSD tiene `gsd-context-monitor.js` como hook PostToolUse
- El propio Claude Code maneja mejor el contexto ahora

---

## 📁 Estructura resultante

```
wisdom-store/
├── src/mcp-server/
│   ├── index.js              # Server entry (4 tools registradas)
│   ├── lib/
│   │   ├── indexer.js        # ✅ AST parser + symbol check
│   │   └── wisdom.js         # ✅ Utilidades de filesystem
│   └── tools/
│       ├── reindex-project.js    # ✅
│       ├── get-project-overview.js # ✅
│       ├── check-symbols.js      # ✅ CORE
│       └── refresh-symbols.js    # ✅
├── hooks/
│   ├── symbol-check.mjs          # ✅ Verificador standalone
│   └── post-write-symbol-check.sh # ✅ Hook automático
├── test/
│   └── symbol-check.test.js      # ✅ Tests del core
├── examples/
│   ├── CLAUDE.md                 # Documentación de uso
│   └── mcp.json                  # Ejemplo de configuración
├── package.json
├── README.md                     # ✅ Actualizado
└── LICENSE
```

**Archivos eliminados:** 45+ archivos (~11,700 líneas)

---

## 🚀 Instalación y uso

### Instalar

```bash
git clone https://github.com/Akunimal/wisdom-store-remake.git
cd wisdom-store-remake
npm install
```

### Configurar MCP

En `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "wisdom-store": {
      "command": "node",
      "args": ["/path/to/wisdom-store/src/mcp-server/index.js"]
    }
  }
}
```

### Configurar hook anti-alucinación

En `~/.claude/settings.json`:

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

### Workflow típico

```
1. get_project_overview → entender el codebase
2. Trabajar en la tarea
3. check_symbols (automático via hook) → detectar hallucinations
4. Si hay unknowns legítimos: refresh_symbols
```

---

## 🧪 Verificación

### Tests automáticos

```bash
npm test
```

**Resultado esperado:**
```
✔ symbol-check detects known symbols (Xms)
✔ symbol-check reports unknown symbols (Xms)
✔ symbol-check fuzzy matches typos (Xms)
✔ symbol-check handles empty registry (Xms)
✔ symbol-check handles missing file (Xms)

5 passing (XXms)
```

### Verificación manual

1. **Reindexar proyecto:**
   ```bash
   npx @modelcontextprotocol/cli
   > reindex_project
   ```

2. **Verificar símbolos conocidos:**
   ```bash
   > check_symbols {"symbols": ["express", "useCatalog"]}
   # Debería reportar: confirmed
   ```

3. **Verificar símbolos hallucinados:**
   ```bash
   > check_symbols {"symbols": ["nonExistentFunction", "fakeModule"]}
   # Debería reportar: unknown
   ```

4. **Probar hook post-write:**
   ```bash
   # Hacer un Write/Edit en Claude Code
   # El hook debería dispararse automáticamente
   # Ver stderr por warnings
   ```

---

## 📈 Beneficios de la sanitización

### Para desarrolladores
- ✅ **Menos ruido**: 4 tools claras vs 24 tools confusas
- ✅ **Más rápido**: Indexado y chequeo optimizados
- ✅ **Más confiable**: Solo código probado y mantenido

### Para el stack
- ✅ **Sin solapamiento**: Cada herramienta tiene un propósito único
- ✅ **Mejor integración**: Hooks compatibles con Claude Code + Codex
- ✅ **Menos mantenimiento**: -80% de código que mantener

### Para anti-alucinación
- ✅ **Detección temprana**: Hook automático post-write
- ✅ **Fuzzy matching**: Detecta typos, no solo errores exactos
- ✅ **Multi-lenguaje**: JS/TS full AST, Python/Go/Rust regex fallback

---

## 🔮 Próximos pasos (opcionales)

### Fase 2: Migración a Serena memories (si se desea)

Script para migrar `.wisdom/sections/*.md` a Serena memories:
- Leer cada sección
- Crear memory equivalente con `write_memory`
- Taggear con metadata (origen, fecha)
- Archivar `.wisdom/` completo como backup

### Fase 3: Hook standalone puro (Opción B)

Eliminar completamente el MCP y dejar solo los hooks:
- `reindex.mjs` como script manual o SessionStart hook
- `symbol-check.mjs` ya es standalone
- `post-write-symbol-check.sh` ya funciona

**Ventaja:** Zero overhead de servidor MCP.
**Desventaja:** No se puede llamar `check_symbols` on-demand desde el chat.

### Fase 4: Integración con CI/CD

Agregar symbol-check como paso de validación:
```yaml
# .github/workflows/symbol-check.yml
jobs:
  anti-hallucination:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: node hooks/symbol-check.mjs --ci
```

---

## 📝 Notas de breaking changes

### Tools eliminadas (no backward compatible)

Si usabas alguna de estas tools, vas a tener errores:

```
❌ prune_context, sandwich_prune, prune_to_handoff
❌ inject_context, restore_context, compact_context
❌ inspect_pruned_messages, context_status
❌ save_wisdom, get_wisdom, list_wisdom, annotate_wisdom
❌ update_plan, backup_plan
❌ analyze_for_archive, condense_jsonl_blocks, apply_archive_plan
❌ restore_archive_backup, add_dir
```

**Migración recomendada:**
- Context management → Usar auto-compact nativo de Claude Code o GSD hooks
- Wisdom management → Migrar a Serena MCP (`write_memory`, `read_memory`)
- Plan management → Usar GSD Skills
- Archive/Condense → Evaluar si realmente se necesita (era funcionalidad niche)

### Hooks actualizados

El hook `post-write-symbol-check.sh` cambió:
- **Antes:** Leía archivos de estado interno
- **Ahora:** Lee stdin JSON estándar

**Acción requerida:** Actualizar path del hook en settings.json si era diferente.

---

## 👥 Author

Fork maintained by [Akunimal](https://github.com/Akunimal) since December 2024.

**Repository:** https://github.com/Akunimal/wisdom-store-remake

**Original upstream:** https://github.com/InfiniQuest-App/wisdom-store

**License:** MIT
