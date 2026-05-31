# Changelog

## Unreleased

- Fixed the MCP stdio startup failure by converting `detect-environment.js` to proper ESM exports and scoping platform detection inside the handler.
- Removed the `jq` dependency from `hooks/post-write-symbol-check.sh`; the hook now parses JSON with Node.js.
- Updated `scripts/setup.js` to also configure Codex MCP in `~/.codex/config.toml` with `startup_timeout_sec = 15`.
- Documented the Codex MCP TOML configuration.
- Added MCP compatibility mode so setup can disable redundant Wisdom Store tools when equivalent MCP servers are already configured.
- Extended MCP compatibility checks across global and repo-level MCP configs, with duplicate capability reporting for existing servers.
- Automated repo-level MCP cleanup for redundant server entries in `.mcp.json`, repo `.claude/settings.json`, and repo `.codex/config.toml`.
- Hardened setup for commercial project installation with `--project`, target-repo cleanup, backups before config writes, safer Codex TOML table cleanup, integration coverage, and aligned package version metadata.
