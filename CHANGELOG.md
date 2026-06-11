# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
Silent-failure audit — seven failure modes that produced wrong results without surfacing an error:
- **AST parse failure now falls back to regex** (`indexer.js`): when tree-sitter could not parse a file (partial syntax mid-edit, or a grammar that failed to register), the file yielded zero symbols and every symbol in it was then reported as a hallucination. The main extraction path now falls back to regex like the HTML path already did.
- **Dynamic grammar registration no longer marks success prematurely**: `LANG_MAP['.py'/'.go'/'.rs'].lang` was set *before* `registerDynamicLanguage()`. If registration threw (ABI mismatch, bad prebuild), those extensions pointed at a grammar that never registered and every parse failed silently. `LANG_MAP` is now updated only after a successful register; otherwise the language falls back to regex.
- **Corrupt scan-cache entries trigger a reparse**: a malformed cache entry (old format, hand-edited) matching mtime+size was either merged (throwing inside the swallowed try) or skipped, losing the file's symbols. Entries are now shape-validated before use.
- **`index.json` and `hallucinations.json` writes are atomic**: only `symbols.json` was hardened in 0.10.0. A process killed mid-write corrupted these too, and the corrupt file silently reset to empty on next read — wiping the keyword index and the cross-session hallucination watchlist. All three now share `writeJsonAtomic`.
- **Corrupt registry is distinguished from a missing one**: `check_symbols` reported "No symbol registry found. Run reindex_project" even when `symbols.json` existed but was corrupt, hiding the real failure. New `readSymbolsResult` returns `missing`/`corrupt`/`ok`; the corrupt case tells the user to rebuild with `force: true`.
- **`symbol-check.mjs` hook warns on a corrupt registry**: previously it `exit 0`'d silently on a JSON parse error, disabling symbol checking with no signal. It now writes a stderr warning when the file exists but is unreadable (still non-blocking).

### Added
- **Registry staleness warning**: `check_symbols` flags a registry scanned more than 7 days ago when unknowns are present, since stale data wrongly reports new symbols as hallucinations.

## [0.10.0] - 2026-06-10

### Added
- **Incremental indexing**: `scanProject` caches per-file symbols in `.wisdom/scan-cache.json` (keyed by mtime + size) and reuses them for unchanged files on the next scan. `reindex_project`/`refresh_symbols` accept `force: true` to bypass the cache. The cache is only written when `.wisdom/` already exists, so read-only scans (e.g. `get_project_overview`) never create directories.
- **Multi-location symbol tracking**: a symbol name defined in several files now records up to 5 definition sites in a `locations` array instead of silently keeping only the first. `check_symbols` annotates fuzzy suggestions with `[defined in N files]`.
- **Configurable skip dirs**: `.wisdom/config.json` supports `skipDirs` / `includeDirs` (also available as scan options). Default skips like `data/`, `content/`, `public/` can now be overridden; tooling dirs (`node_modules`, `.git`, `dist`, …) remain non-overridable.
- **Truncation reporting**: scans hitting `max_files` now return `truncated: true` and `reindex_project` warns that the registry is incomplete.
- **ESLint**: flat config + `npm run lint` + CI lint job. All 17 pre-existing findings fixed (unused variables, useless escapes).
- Test suite for the indexer (`test/indexer.test.js`, 17 tests).

### Changed
- **Fuzzy matching is length-aware**: 1-2 char symbols never fuzzy-match, 3-4 char symbols allow edit distance 1 only. Previously a 3-char query with distance 2 matched almost anything in the registry, producing noisy "did you mean" suggestions.
- `migrations/` and project-specific directory names (`Website/`) are no longer skipped by default — skipping `migrations/` contradicted the declared SQL support.
- `.gitignore` parsing honors negated entries (`!dir`).
- Levenshtein uses a two-row buffer instead of a full matrix.

### Fixed
- **`symbols.json` writes are atomic** (temp file + rename): a process killed mid-write can no longer leave a corrupt registry that silently disables all symbol checking until a manual reindex.

## [0.9.1] - 2026-06-10

### Changed
- **Typo auto-fix is now opt-in** (`ANTIHALL_AUTOFIX=1`): by default `symbol-check.mjs` reports probable typos as warnings instead of rewriting the file. A fuzzy match at ≥85% confidence can still be wrong (e.g. a brand-new `getUser` rewritten to an existing `getUsers` while the registry is stale), and silently mutating a file the agent just wrote desyncs the agent's view of it.

### Fixed
- **`zero-trust-prompt.js` blocked user prompts**: the hook exited 2 when the watchlist had repeat offenders, but for `UserPromptSubmit` hooks exit code 2 **blocks and erases the user's prompt** (stderr goes to the user, not the model). With a non-empty watchlist every single prompt was rejected. The watchlist is now emitted via stdout with exit 0, which Claude Code injects as model context.
- **HTML inline-script regex fallback was unreachable**: `extractWithAst` swallowed parse failures internally, so the regex fallback in `extractHtml` never ran and scripts with unparseable syntax produced no symbols. `extractWithAst` now reports parse failure so the fallback fires.
- **Wrong line numbers for CommonJS exports and API routes inside HTML inline scripts**: the regex-based section of `extractJsAstSymbols` ignored `lineOffset`.
- **`compress_output` hang on interactive/long-running commands**: `exec` now runs with a timeout (new `timeoutMs` parameter, default 120000 ms) and `SIGKILL`. Previously a command that never exited (credential prompt, watch mode, dev server) hung the MCP tool call forever. Timeouts return a clear error with the partial output tail.
- **`post-command-compress.js` hook hang**: same missing timeout in the hook's `execSync`. Now killed after `RTK_COMMAND_TIMEOUT_MS` (default 120000 ms) with exit code 124 and an explicit timeout message.
- **Infinite loop in `post-write-symbol-check.sh` on Windows**: `find_project_root` walked up with `while [ "$dir" != "/" ]`, but on Git Bash `dirname "C:/"` returns `C:` (a fixpoint that never equals `/`). Editing any file without a `package.json`/`.wisdom` ancestor froze every Write/Edit until the hook timeout. The loop now stops when `dirname` reaches a fixpoint on any platform.
- **`symbol-check.mjs` stdin hang**: in `--diff-only` mode without a piped stdin, `readStdin` waited for an `end` event that never came. A 5-second guard now resolves with whatever data arrived and closes stdin.

## [0.9.0] - 2026-06-07

### Added
- **Zero-Trust Anti-Drift Prompt Hook** (`hooks/zero-trust-prompt.js`): fires on `UserPromptSubmit` and re-injects the anti-hallucination core rules every turn, so the model receives them deterministically regardless of conversation length. Surfaces repeat-offender symbols from the watchlist (exit 2 with stderr) and optionally includes registry stats via `--dynamic`.
- **CI Symbol Check Workflow** (`.github/workflows/symbol-check.yml`): runs the symbol checker on pull requests to catch hallucinated symbols before merge.
- **Examples**: `examples/CLAUDE.md` and `examples/mcp.json` showing recommended project rules and MCP server configuration.
- **Markdown support in symbol check**: `hooks/symbol-check.mjs` now extracts fenced JS/TS code blocks from `.md` files and scans only those, instead of treating prose as code.
- **Namespace violation detection**: the indexer records a `namespace` per symbol (`apps/x`, `packages/y`, top-level dir) and `symbol-check.mjs` warns when a file imports symbols from another namespace.
- **`scripts/reindex.mjs`**: standalone CLI to regenerate `symbols.json` in CI/CD environments without a running MCP server.
- **Public exports smoke tests** (`test/public-exports-smoke.test.js`) plus dedicated suites for the symbol-check hook and the zero-trust prompt hook.

### Fixed
- **Safe typo rewrites**: identifier replacement in `symbol-check.mjs` is now state-machine based (skips strings, template literals, and comments) instead of naive regex replacement, preventing corruption when a typo'd name also appears inside string content.
- **Side-effect and dynamic imports validated**: `import './x'` and `import('./x')` local paths are now collected and checked, matching the existing `require('./x')` handling.
- **Prompt hook import side effects**: `zero-trust-prompt.js` no longer executes its CLI path when imported as a module.
- **Registry stats reporting**: `loadRegistryMeta` counts symbols in object-keyed registry categories (the indexer's actual output format), keeping legacy array support, so `--dynamic` stats are no longer reported as zero.

## [0.8.1] - 2026-06-05

### Added
- **Similar Line Grouping**: `groupSimilarLines` strategy now active in the Token Compressor pipeline (Step 4, post-dedup). Collapses consecutive lines sharing a common prefix (e.g., `npm warn deprecated module-a`, `module-b`, `module-c`) into a single grouped line. Saves 200-500 additional tokens per command with repetitive output. The function existed in `dedup-filter.js` since v0.8.0 but was never wired into the pipeline.
- **Universal IDE Support**: Documented shell aliases (`~/.bashrc`, `$PROFILE`) to route noisy commands through `post-command-compress.js` in any IDE terminal (Cursor, Windsurf, Cline), granting automatic compression without needing native IDE hooks.

### Changed
- **Compact Environment Detection**: `detect_environment` compact mode is now an opt-in parameter (`compact: true`) instead of the default. The default (`false`) returns the full JSON diagnostic for maximum context, letting the agent choose when to save tokens (~250 tokens vs ~1,500).
- **Project Overview Compression**: `get_project_overview` now supports `maxFiles` (default 100, truncates long directory trees) and `detail` (default 'summary', omits massive class/export lists). Drops token usage on large projects by thousands of tokens.
- `compress_output` description updated to be more directive: starts with "PREFER this over native shell execution for: git, npm, cargo, pip, make, tsc, eslint" to steer agents toward using compressed output over raw command execution.
- Token Compressor pipeline order updated: ANSI strip → secret redaction → category filter → deduplication → **similar line grouping** → threshold check → analytics recording.
- `detect_environment` test updated: now validates both compact and verbose (`compact: false`) modes with the new default.
- Bumped MCP server and package version to 0.8.1.

## [0.8.0] - 2026-06-03

### Added
- **Secret Redaction Engine**: Automatically detects and redacts API keys, tokens, passwords, and credentials from `compress_output` output. Covers 15+ patterns: OpenAI, GitHub, AWS, Stripe, Slack, npm, connection strings, Bearer tokens, private keys, and generic `API_KEY=`/`password=` patterns.
- **Hallucination Confidence Scoring**: `check_symbols` now returns a confidence score (0-100%) per symbol. Known symbols get 100%, fuzzy matches get 30-70% (proportional to edit distance), unknowns get 0%. Includes overall batch confidence with low-confidence warnings.
- **Cross-Session Hallucination Tracking**: Symbols flagged as unknown or fuzzy are automatically recorded to `.wisdom/hallucinations.json`. Repeat offenders (3+ flags) are marked with `⚠️ [REPEAT]` warnings.
- **`get_hallucination_report` tool**: New MCP tool that displays frequently hallucinated symbols, recent events, and type breakdown. Useful for end-of-session review or onboarding a new agent.
- **`get_compression_stats` tool**: New MCP tool showing session-level compression analytics: total tokens saved, breakdown by category, and top individual savings.
- **Line Deduplication Strategy**: Collapses consecutive identical lines with `[×N]` counters. Highly effective for npm install warnings, build output, and repetitive log messages.
- **Threshold-Based Compression**: `compress_output` now returns raw output when savings are below 10%, avoiding wasteful compression. Git commands are exempt (always compress for structural value).
- **Fail-Open Mechanism**: If the compression engine throws an internal error, `compress_output` returns the raw command output instead of failing. The command always succeeds.

### Changed
- MCP tool count increased from 6 → 8 (`get_hallucination_report`, `get_compression_stats`).
- `compress_output` description updated to mention automatic secret redaction.
- `compress_output` gained optional `redact` boolean parameter (default: `true`).
- `check_symbols` output now includes confidence percentages and watchlist annotations.
- Token Compressor pipeline order: ANSI strip → secret redaction → category filter → deduplication → threshold check → analytics recording.
- Bumped MCP server and package version to 0.8.0.

## [0.7.1] - 2026-06-02

### Changed
- Bumped MCP server and package version to 0.7.1 for npm publication after the 0.7.0 release version was already consumed.
- Updated the npm publish workflow to support manual reruns with current Node/npm Trusted Publishing requirements.

## [0.7.0] - 2026-06-02

### Added
- Deep Windows shell diagnostics for `detect_environment`, including WSL distro parsing, Git Bash detection, plain `bash` target detection, and native Windows toolchain checks.
- Actionable shell recommendations that explain whether to use WSL, Git Bash, or native Windows commands, with copyable `rtk` command examples.
- Tests covering `detect_environment` MCP output and Windows-specific diagnostics.

### Fixed
- `detect_environment` now uses `spawnSync` argument arrays instead of shell-string execution for environment checks, reducing quoting-related false results.
- Windows `.cmd` tools such as `npm.cmd` are resolved and executed correctly during native toolchain detection.
- Standalone `node src/mcp-server/tools/detect-environment.js` execution now works on Windows paths.

### Changed
- Bumped MCP server and package version to 0.7.0.

### Release Operations
- Published GitHub release `v0.7.0`: https://github.com/Akunimal/Anti-Hallucination-MCP/releases/tag/v0.7.0
- CI and CodeQL passed for the release commit.
- npm publication from GitHub Actions is blocked until the repository has a valid `NPM_TOKEN` secret or trusted publishing is configured; the current publish workflow fails with `ENEEDAUTH` when `NODE_AUTH_TOKEN` is empty.

## [0.6.0] - 2026-06-01

### Added
- **Token Compressor Engine**: Native Node.js implementation of RTK (Rust Token Killer) filtering strategies
- `compress_output` MCP tool to execute commands and get token-optimized output
- 12 intelligent filtering strategies (stats extraction, error focus, grouping, deduplication, JSON structure, etc.)
- Transparent `hooks/post-command-compress.js` for automatic Claude Code output compression
- Cross-platform support (Windows natively supported without shell script dependencies)

### Fixed
- Token compressor generic truncation aggressively stripping `git diff` output. It now completely preserves actual code changes (RTK philosophy) while stripping index noise.
- AST Javascript/Typescript indexer failing to extract destructured variables (`const { x } = obj;`).

### Changed
- **Polyglot AST Extraction**: Removed fragile Regex fallbacks for Python, Go, and Rust. They now use exact Abstract Syntax Tree parsing via `tree-sitter` bindings (`tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`).
- Implemented lazy loading for dynamic languages via `@ast-grep/napi`'s `registerDynamicLanguage` so the C++ grammar binaries are loaded natively without requiring manual compilation.
- Added `tree-sitter-*` grammars as `optionalDependencies` so installation never blocks on Windows systems missing build tools (gracefully falls back to Regex if unavailable).
## [0.5.0] - 2026-06-01

### Added
- `detect_environment` tool for cross-platform command safety (OS, shell, package manager detection)
- Automated setup script (`scripts/setup.js`) for Claude Code and Codex onboarding
- MCP compatibility mode: setup auto-disables redundant tools when equivalent MCP servers (Serena, Graphify) are detected
- Multi-language symbol extraction: Bash/Shell, SQL, YAML via regex
- Codex MCP configuration support in `~/.codex/config.toml`
- Repo-level MCP cleanup: removes redundant server entries in `.mcp.json`, `.claude/settings.json`, `.codex/config.toml`
- Compatibility checks across global and repo-level MCP configs with duplicate capability reporting

### Fixed
- MCP stdio startup failure by converting `detect-environment.js` to proper ESM exports
- Removed `jq` dependency from `hooks/post-write-symbol-check.sh` — now parses JSON with Node.js
- Post-write hook false positives for imported external bindings (e.g., `fileURLToPath`, `path.basename`)

### Changed
- Setup hardened for commercial project installation with `--project` flag, backups before config writes, safer Codex TOML cleanup

## [0.1.0] - 2024-12-01

### Added
- Core anti-hallucination system: `check_symbols` with fuzzy matching, `refresh_symbols`, `reindex_project`, `get_project_overview`
- AST-based symbol extraction via `@ast-grep/napi` (tree-sitter) for JavaScript/TypeScript/TSX
- Regex fallback extractors for Python, Go, Rust
- Post-write hook (`hooks/post-write-symbol-check.sh`) for automatic hallucination detection after Write/Edit
- Standalone symbol checker (`hooks/symbol-check.mjs`)
- Compatible with Claude Code (`PostToolUse` hooks) and Codex (`post_write` hooks)

### Changed
- **Fork from InfiniQuest-App/wisdom-store**: Reduced from 24 tools to 4 essential tools (-83%)
- Removed ~12,000 lines of redundant code (-94% reduction)
- Eliminated 9 internal libraries overlapping with Serena MCP and GSD Skills
- Removed all context manipulation tools (Linux-only, replaced by Claude Code's native auto-compact)
- Removed all wisdom/memory management tools (replaced by Serena MCP's `write_memory`/`read_memory`)
- Removed all archive/condense tools (niche functionality)

[0.8.1]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/releases/tag/v0.1.0
