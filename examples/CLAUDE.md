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
