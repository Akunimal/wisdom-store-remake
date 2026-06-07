# Example CLAUDE.md — Wisdom Store Lite Integration

# Copy the sections below into your project's CLAUDE.md to teach Claude
# how to use the wisdom-store anti-hallucination tools.

## Anti-Hallucination (wisdom-store-lite)

This project uses wisdom-store-lite for symbol checking and hallucination prevention.

### Starting a session
- Call `get_project_overview` at the start of each session to understand the codebase structure and refresh the symbol registry

### While working
- After writing code, call `check_symbols` with the symbols you used to verify you haven't hallucinated function names or imports
  - Example: `check_symbols({ symbols: ["myFunction", "helperUtil", "processData"] })`
- If `check_symbols` reports unknowns after you intentionally added new code, call `refresh_symbols` to update the registry

### Hook automation
- The post-write-symbol-check.sh hook automatically checks for hallucinations after every Write/Edit
- It validates: import paths, imported symbols, standalone function calls, and API routes
- No manual action needed — warnings appear directly in the chat if issues are detected

### What NOT to do
- Don't call `reindex_project` manually — use `get_project_overview` which includes a fresh scan
- Don't ignore `check_symbols` warnings — they catch real hallucinations and typos

## Anti-Drift Zero-Trust (v0.9.0)

This project uses the zero-trust prompt hook to re-inject anti-hallucination rules every turn.

### How it works
- The `UserPromptSubmit` hook fires before every response, injecting a deterministic reminder:
  - Never assume a symbol exists — verify with `check_symbols` or read the file first
  - Never assume a file path — use `list_dir` or find to confirm
  - Never assume API routes — check the actual router/handler files
- If there's a **watchlist** of previously hallucinated symbols (3+ occurrences), they're injected as a warning
- This combats **context drift** where the model forgets rules from CLAUDE.md over long conversations

### Modes
- Standard (default): Core rules + watchlist (~100 tokens)
- `--minimal`: Just the rules, no watchlist (~50 tokens)
- `--dynamic`: Adds registry stats like total symbols and last index time (~150 tokens)

### Note
- The zero-trust hook is currently exclusive to Claude Code (requires `UserPromptSubmit` hook support)
