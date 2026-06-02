# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.7.1]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/Akunimal/Anti-Hallucination-MCP/releases/tag/v0.1.0
