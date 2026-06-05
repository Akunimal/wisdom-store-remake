# 🛡️ Anti-Hallucination-MCP: Architecture & Design Decisions

## Resumen Ejecutivo

wisdom-store fue **reducido de 24 tools a 6 tools enfocadas**, y luego expandido a **8 tools** en v0.8.0 con hallucination tracking y compression analytics. El producto actual mantiene 4 tools core de anti-alucinación y 4 tools complementarias para seguridad operativa de agentes (`detect_environment`, `compress_output`, `get_hallucination_report`, `get_compression_stats`).

---

## 📊 Antes vs Después

| Métrica | Antes | Después (v0.1) | Actual (v0.8) | Cambio |
|---------|-------|---------------|---------------|--------|
| Tools MCP | 24 | 6 | 8 | -67% |
| Archivos de código | 50+ | 15 | 23 | -54% |
| Líneas de código | ~12,500 | ~800 | ~2,000 | -84% |
| Librerías internas | 10 | 2 | 4 | -60% |
| Tests | 10 | 5 | 55 | +450% |

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
- `context_status` — Diagnóstico readonly no mantenido en la versión pública actual

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

### Tools actuales (8)

| Tool | Propósito | Estado |
|------|-----------|--------|
| `detect_environment` | Detecta OS/shell/package managers y devuelve reglas anti-errores para agentes. **Modo compacto** por defecto (~250 tokens vs ~1,500 tokens) | ✅ Companion |
| `reindex_project` | Extrae símbolos vía AST, guarda en `.wisdom/symbols.json` | ✅ Core |
| `get_project_overview` | Snapshot compacto del proyecto | ✅ Core |
| `check_symbols` | **Anti-alucinación**: detecta símbolos hallucinados con **confidence scoring** y **watchlist** | ✅ CORE |
| `refresh_symbols` | Actualiza el registry post-cambios | ✅ Core |
| `compress_output` | Ejecuta comandos y comprime output. **Auto-redacta secretos**. **Agrupa líneas similares** (v0.8.1) | ⚠️ Companion con superficie de ejecución |
| `get_hallucination_report` | Reporte de alucinaciones frecuentes, recientes y por tipo entre sesiones | ✅ Companion (v0.8.0) |
| `get_compression_stats` | Analítica de compresión a nivel de sesión: tokens ahorrados, categorías, top ahorros | ✅ Companion (v0.8.0) |

### Librerías mantenidas (4 archivos)

```
src/mcp-server/lib/
  ✅ indexer.js             — AST parser (@ast-grep/napi) + symbol check + fuzzy matching + confidence scoring
  ✅ wisdom.js              — Utilidades: findProjectRoot, getWisdomDir, readSymbols, writeSymbols
  ✅ hallucination-tracker.js — Persistencia cross-session de alucinaciones + watchlist (v0.8.0)
  ✅ compression-stats.js    — Analítica in-memory de compresión por sesión (v0.8.0)
```

### Hooks anti-alucinación (2 archivos)

```
hooks/
  ✅ symbol-check.mjs          — Verificador standalone de símbolos
  ✅ post-write-symbol-check.sh — Hook automático post-Write/Edit
```

**Compatibilidad del servidor MCP y los hooks:**
- **Servidor MCP:** Compatible de forma nativa con cualquier cliente MCP (Claude Code, Codex, Antigravity IDE, OpenCode, Cursor, Windsurf, etc.).
- **Hook Automático:** Funciona de forma automática en Claude Code (vía `PostToolUse` hooks). En Codex de forma experimental/manual si el runtime expone un payload `post_write` compatible. Otros IDEs se benefician de las tools pero no disparan el hook automáticamente aún.

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
│   ├── index.js              # Server entry (8 tools registradas)
│   ├── lib/
│   │   ├── indexer.js        # ✅ AST parser + symbol check + confidence scoring
│   │   ├── wisdom.js         # ✅ Utilidades de filesystem
│   │   ├── hallucination-tracker.js # ✅ Cross-session tracking (v0.8.0)
│   │   └── compression-stats.js    # ✅ Analytics in-memory (v0.8.0)
│   └── tools/
│       ├── reindex-project.js    # ✅
│       ├── get-project-overview.js # ✅
│       ├── check-symbols.js      # ✅ CORE + confidence + watchlist
│       ├── refresh-symbols.js    # ✅
│       ├── detect-environment.js # ✅ + compact mode (v0.8.1)
│       ├── compress-output.js    # ✅ + secret redaction + fail-open
│       ├── token-compressor.js   # ✅ + dedup + grouping + threshold + analytics
│       ├── get-hallucination-report.js # ✅ NEW (v0.8.0)
│       ├── get-compression-stats.js   # ✅ NEW (v0.8.0)
│       └── strategies/
│           ├── git-filter.js     # ✅
│           ├── test-filter.js    # ✅
│           ├── lint-filter.js    # ✅
│           ├── file-filter.js    # ✅
│           ├── log-filter.js     # ✅
│           ├── json-filter.js    # ✅
│           ├── generic-filter.js # ✅
│           ├── secret-redactor.js # ✅ NEW (v0.8.0)
│           └── dedup-filter.js   # ✅ NEW (v0.8.0)
├── hooks/
│   ├── symbol-check.mjs          # ✅ Verificador standalone
│   ├── post-write-symbol-check.sh # ✅ Hook automático
│   └── post-command-compress.js   # ✅ Hook compresión
├── test/
│   ├── symbol-check.test.js      # ✅ Tests del core
│   ├── token-compressor.test.js  # ✅ Tests del compresor
│   ├── detect-environment.test.js # ✅ Tests de entorno
│   ├── secret-redactor.test.js   # ✅ NEW (v0.8.0)
│   ├── dedup-filter.test.js      # ✅ NEW (v0.8.0)
│   └── hallucination-tracker.test.js # ✅ NEW (v0.8.0)
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
git clone https://github.com/Akunimal/Anti-Hallucination-MCP.git
cd Anti-Hallucination-MCP
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
- ✅ **Menos ruido**: 6 tools claras vs 24 tools confusas
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

**Repository:** https://github.com/Akunimal/Anti-Hallucination-MCP

**Original upstream:** https://github.com/InfiniQuest-App/wisdom-store

**License:** MIT
