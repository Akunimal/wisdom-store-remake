# Changelog

## Unreleased

- Fixed the MCP stdio startup failure by converting `detect-environment.js` to proper ESM exports and scoping platform detection inside the handler.
- Removed the `jq` dependency from `hooks/post-write-symbol-check.sh`; the hook now parses JSON with Node.js.
- Updated `scripts/setup.js` to also configure Codex MCP in `~/.codex/config.toml` with `startup_timeout_sec = 15`.
- Documented the Codex MCP TOML configuration.
