# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-06-01

### Added
- **Token Compressor Engine**: Native Node.js implementation of RTK (Rust Token Killer) filtering strategies
- `compress_output` MCP tool to execute commands and get token-optimized output
- 12 intelligent filtering strategies (stats extraction, error focus, grouping, deduplication, JSON structure, etc.)
- Transparent `hooks/post-command-compress.js` for automatic Claude Code output compression
- Cross-platform support (Windows natively supported without shell script dependencies)

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

[0.5.0]: https://github.com/Akunimal/wisdom-store-remake/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/Akunimal/wisdom-store-remake/releases/tag/v0.1.0
