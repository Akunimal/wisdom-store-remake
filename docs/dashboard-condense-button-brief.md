# Brief: Add a "Condense" button to the dashboard for per-session JSONL condensation

## What it does

Triggers wisdom-store's `condense_jsonl_blocks` tool against a Claude Code conversation JSONL — heuristically condenses image bytes, stale file reads, MCP status snapshots, thinking signatures, verbose tool inputs, and large tool_result outputs. **Zero LLM cost** (pure heuristic). **Out-of-process** — does not touch any agent's context window. The targeted agent picks up the condensed file on its NEXT turn (chain re-walk; hot-trim safe).

Typical impact: **15–30% file size reduction** on a JSONL that hasn't been condensed before; **5–15% AC% reduction** in the agent's context. Smaller incremental gains on already-condensed sessions (sidecar tracking makes re-runs idempotent).

## Why a dashboard button (vs asking the agent itself)

Asking the agent to run condense on its own JSONL costs context twice:
1. **Wake-up cache miss** when the agent processes the tool call + result
2. **Post-condense cache miss** when the next prompt encounters the new chain shape

A dashboard button bypasses both — pure file mutation, agent never knows it happened until it next reads its chain (which it has to do anyway to continue working).

## How to invoke (Node, no MCP needed)

The condense tool is a plain Node module — call it directly via `child_process.spawn` from the dashboard's backend:

```javascript
import { handleCondenseJsonlBlocks } from '/home/michael/Projects/wisdom-store/src/mcp-server/tools/condense-jsonl-blocks.js';

// Recommended default modes (all heuristic, all reversible)
const DEFAULT_MODES = [
  'images',
  'memory-reads',
  'identical-reads',
  'mcp-snapshots',
  'refetch-markers',
  'tool-args',
  'thinking'
];

async function condenseConversation({ jsonlPath, modes = DEFAULT_MODES, dryRun = false }) {
  const result = await handleCondenseJsonlBlocks({
    jsonl_path: jsonlPath,           // explicit path — bypasses UUID lookup
    modes,
    dry_run: dryRun,
    thinking_marker_style: 'minimal' // minimal markers (empirically validated; verbose available)
  });
  return result;
}
```

`result.content[0].text` contains a markdown report. `result.structuredContent` (when present) has parsed fields: `sizeBefore`, `sizeAfter`, `reductionPct`, `condensed` (per-mode counts), `backupPath`.

## Arguments to expose in the UI

Minimum viable button:
- **One button** per session card: "Condense conversation" — uses default modes, no other args needed
- **Dry-run option** (checkbox): run in preview mode first, show predicted savings, ask user to confirm before mutating

Optional power-user controls:
- **Mode selection** (multi-select checklist of the 7 modes)
- **`thinking_marker_style`**: `minimal` (default, byte-efficient) or `verbose` (embeds Pass 1 turn summaries when an analyze-v2 plan exists)
- **`keep_recent_turns`**: integer override; default is `min(30, ceil(totalTurns/2))` — keep the most recent N turns verbatim
- **Re-run button** to re-trigger with same params (idempotent — sidecar prevents double-condensing)

## Where things live

For a conversation at `<conv_dir>/<convId>.jsonl`, the tool maintains three sidecar dirs:

- **`<conv_dir>/.condense-backups/<convId>.<epoch>.jsonl`** — full JSONL backup before each mutation. Last 3 retained, oldest pruned.
- **`<conv_dir>/.condense-meta/<convId>.json`** — per-block tracking (which blocks were condensed by which mode, with byte stats). Makes re-runs idempotent.
- **`<conv_dir>/.condense-log/<convId>.jsonl`** — append-only run log: one JSON line per run with parameters + results + timing.

## Logging / diagnostic data the dashboard can surface

Every run appends to the log file. Each entry has:

```json
{
  "at": 1778625179591,
  "modes": ["images", "memory-reads", "...", "thinking"],
  "args": { "dry_run": false, "thinking_marker_style": "minimal", ... },
  "filePath": "/home/michael/.claude/projects/.../<convId>.jsonl",
  "fileSize": { "before": 2785965, "after": 2363406 },
  "blocksCondensed": {
    "images": 0, "memoryReads": 0, "identicalReads": 0,
    "staleReads": 0, "mcpSnapshots": 2, "refetchMarkers": 47,
    "toolArgs": 0, "thinking": 93
  },
  "bytesSaved": {
    "images": 0, "memoryReads": 0, "identicalReads": 0,
    "staleReads": 0, "mcpSnapshots": 41123, "refetchMarkers": 230456,
    "toolArgs": 0, "thinking": 143521
  },
  "totalBlocksTouched": 142,
  "totalBytesSavedRaw": 415100,
  "backupPath": "/.../.condense-backups/<convId>.1778625179591.jsonl",
  "sidecarPath": "/.../.condense-meta/<convId>.json",
  "replacedActual": 142,
  "planUsed": null
}
```

Useful dashboard surfaces:
- **Per-session "condense history"** card — show last N runs, byte savings per run, cumulative savings
- **Per-mode effectiveness chart** — across all sessions, which modes save the most bytes (informs future tuning)
- **Re-condense detection** — if `blocksCondensed` totals are tiny, the file was already condensed — show "already condensed" badge instead of "X% saved"
- **Restore button** that reads the latest `.condense-backups/` entry and offers one-click rollback

## Reversibility

Every mutation is fully reversible. To restore from any backup:

```javascript
import { handleRestoreArchiveBackup } from '/home/michael/Projects/wisdom-store/src/mcp-server/tools/restore-archive-backup.js';

await handleRestoreArchiveBackup({
  conversation_id: '<convId>',
  backupPath: '/path/to/.condense-backups/<convId>.<epoch>.jsonl'
});
```

Or from the most recent backup automatically (no `backupPath` needed):

```javascript
await handleRestoreArchiveBackup({ conversation_id: '<convId>' });
```

## Safety properties

- **Backup-before-mutation** is unconditional. Even on dry-runs there's no risk (dry-runs don't mutate at all).
- **Atomic writes** via tmp + rename in `rewriteJsonl`. Race-guarded against the live agent appending mid-condense.
- **Hot-trim**: Claude Code re-walks the chain each turn — condensed content visible immediately without `/resume`. The condensed JSONL is always API-valid (no metadata pollution on `message.content[]` blocks).
- **Idempotent**: sidecar tracks per-block condense status; re-running is a no-op for already-touched blocks.

## Future extension hooks

- **`condense_jsonl_blocks`** is the current API. A future analyze-then-apply LLM pipeline (~$0.50/run on Haiku) is `mcp__wisdom-store__analyze_for_archive` + `mcp__wisdom-store__apply_archive_plan` — produces drop/distill decisions per turn. Could be wired as a separate "Deep condense (LLM-assisted)" button.
- **Score-threshold apply** lets the user dial archival aggressiveness via `min_keep_score` / `min_distill_score` args on apply (when an analyze plan exists). Could be a slider.

## Test endpoint suggestion

Wire a basic POST endpoint:

```
POST /api/condense
{
  "conversation_id": "...",   // optional, look up via dashboard's session map
  "jsonl_path": "...",        // OR explicit path
  "modes": [...],             // optional, default = all 7
  "dry_run": false,           // optional, default false
  "thinking_marker_style": "minimal"
}

→ 200 { ok: true, report: <markdown text>, structured: {...} }
→ 500 { ok: false, error: "..." }
```

The handler shells out to a node script wrapping `handleCondenseJsonlBlocks` and returns its result.

## Estimated implementation effort

- Backend endpoint + node wrapper: ~30 min
- UI button on session card + simple result display: ~30-60 min
- "Condense history" view (reads `.condense-log/`): ~1-2 hr
- Restore button + history of backups: ~1 hr
- Mode picker + advanced settings: ~1 hr

**MVP (button + minimal display): ~1 hour total.**
