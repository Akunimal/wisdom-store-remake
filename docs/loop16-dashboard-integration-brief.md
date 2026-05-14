# Brief for loop16: integrate `prune_to_handoff` into the claudeLoop dashboard

## TL;DR

wisdom-store just shipped a new MCP tool, `prune_to_handoff`, that pairs with a workflow where a session writes its own structured hand-off near end-of-context, then a prune drops everything before that hand-off on resume. Cheaper (~1% of the 5-hour rate-limit window) and more accurate than `/compact` (~6% on a large session), because the session itself decides what was load-bearing.

You own the dashboard piece. Two integration surfaces:

1. **Threshold-triggered hand-off prompt** — when a tracked session crosses a context/TTL threshold, send the hand-off prompt to its tmux pane (you already have `tmuxUtils.sendKey` / `/api/tmux-send-key`).
2. **Resume-time prune call** — when a session is resumed (manually or auto), call `mcp__wisdom-store__prune_to_handoff` against its conversation file to lean it down.

## What's already shipped on the wisdom-store side

Commit `72ce0f2` on `wisdom-store/main`:

- `src/mcp-server/tools/prune-to-handoff.js` — the tool. Args: `conversation_id?`, `marker?` (default `"## SESSION HANDOFF"`), `dry_run?`. Scans chain newest-first for the marker, walks back to nearest user/system message, sets `parentUuid:null`. Reuses race-guard + atomic tmp-rename via `rewriteLine`. Returns a markdown report with snippet of the matched hand-off.
- `src/mcp-server/lib/jsonl.js` — added `findValidRootForward(chain, startIdx, filePath)` shared helper.
- `docs/handoff-template.md` — workflow doc + the verbatim user-message prompt + recovery notes.

The codegen MCP umbrella was also added to `~/.claude.json` top-level `mcpServers` (so all sessions get it without per-project `.mcp.json`).

## What you need to build on the dashboard side

### 1. Threshold detection

Extend the existing per-session context tracker (look at `dashboard/dashboard-condense.js` and the `contextPercent` field already tracked on session state — see the WS state push in `claude-loop-unified-dashboard.js`). Add a configurable threshold per session (or a global default):

- **Suggested default:** trigger when `contextPercent >= 75` OR `(ttlExpiresAt - now) <= 30 min`, whichever first.
- Threshold should be configurable per session (some users will want 70%, some 85%).
- Trigger only ONCE per session per threshold-cross — track a `handoffPromptedAt` flag in session state to avoid spamming.

### 2. Send-keys trigger

When the threshold trips, send the hand-off prompt to the tmux pane. Use the existing `tmuxUtils.sendCommand` (or sister) plumbing — see `claude-loop-unified-dashboard.js` (`/api/tmux-send-key` etc). Send the prompt verbatim from `wisdom-store/docs/handoff-template.md` (the block under "## Prompt").

Recommend wrapping it like: `"Context is at ${pct}% — " + handoffPromptText` so the session has the trigger context.

### 3. Post-resume prune

Two paths, your call which to ship first:

- **(a) Manual button in dashboard.** Add a "Prune to hand-off" button on the session card. On click, the dashboard makes an MCP call against the resumed session: `mcp__wisdom-store__prune_to_handoff` with `dry_run: true` first (show the user what will be orphaned + the hand-off snippet), then a confirm → `dry_run: false`.
- **(b) Auto-prune on resume.** When the dashboard detects a session start that has a hand-off as its leaf message, automatically call `prune_to_handoff` (skip dry-run). Riskier — recommend (a) first, layer (b) after a few cycles of confidence.

Calling MCP tools from the dashboard: you already have patterns for this. The wisdom-store MCP server is registered user-level, so any session can invoke it. From the dashboard JS, you'd typically call via the orchestrator's MCP bridge or shell out to a session's stdio MCP — whichever pattern you've used elsewhere. (If neither fits, surfacing a "click here to prune" link that just sends the literal MCP-call command via send-keys is a fine v1.)

## Files to read

- `wisdom-store/docs/handoff-template.md` — workflow + the prompt to send + a "Why this is better than /compact" comparison + recovery notes. **Read this first.**
- `wisdom-store/src/mcp-server/tools/prune-to-handoff.js` — implementation, ~190 lines. Doc-comment at top explains the chain-walk logic.
- `wisdom-store/src/mcp-server/lib/jsonl.js` — `findValidRootForward`, `rewriteLine`, `walkChain`, `findConversationFile` — the helpers `prune_to_handoff` uses.
- `wisdom-store/src/mcp-server/tools/sandwich-prune.js` and `prune-context.js` — sibling tools, same conventions. Useful if you want to wire a "prune options" dropdown that exposes all three.

## Suggested first move

1. Read `handoff-template.md` end-to-end.
2. Pick a session you want to use as the test rig (one of your own loops with healthy context, or a fresh sandbox).
3. Author + send the hand-off prompt manually via the dashboard's existing send-keys UI to feel the round-trip.
4. Once that returns a marker'd response, manually call `prune_to_handoff` with `dry_run: true` against it. Verify the report makes sense.
5. THEN start designing the threshold detection + auto-trigger.

## Open design questions

- **What's the right threshold default?** 75% feels right for a session that has ~25% headroom to author the hand-off. But if your context-tracker measures differently (active chain only vs. full window), this may need tuning.
- **Auto-prune vs. confirm prune.** Per (3a) above, leaning toward manual confirm first.
- **Hand-off detection on resume.** Is "leaf message starts with `## SESSION HANDOFF`" enough, or do you want a more durable signal (e.g., a marker in session metadata)?
- **Multiple hand-offs in one chain?** If a session writes multiple hand-offs (e.g., user prompts again), the tool already does the right thing — scans newest-first, takes the most recent. But the dashboard UI should make clear "you'll prune to the *most recent* hand-off."

## Considered Omitting

- **Per-session config schema.** I'm assuming you'll plumb threshold + enabled flag through whatever per-session config mechanism the dashboard already uses. If there isn't one, that's a small prerequisite.
- **Telemetry.** Worth tracking how many prompts trigger, how many hand-offs get authored vs. ignored, how many prunes get applied — but v1 doesn't need this.
- **Marker collision.** If a session naturally writes `## SESSION HANDOFF` in a non-hand-off context (unlikely but possible — e.g., discussing this very feature), the prune would catch the wrong message. The `marker` arg is overridable. Worth a one-line callout in the dashboard UI ("only used when the most recent message starts with this marker — verify before applying"). Probably not worth more than that.
- **What about non-claudeLoop sessions?** The MCP tool works on any Claude Code session; it just needs the conversation_id. If you want the dashboard to manage non-loop sessions too, the threshold detection needs a different signal source. Out of scope for v1.

## First-move summary

Read `handoff-template.md`. Then run the workflow manually once on a sandbox session. Then build the threshold detection. Ping back if anything in the tool's behavior doesn't match what you need — happy to extend args (e.g., `keep_recent_n_extra` to keep N turns past the marker as buffer, or a `walk_forward_to_user` flag to anchor differently) before you wire it deep.
