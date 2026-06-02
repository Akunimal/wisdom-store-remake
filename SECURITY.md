# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.6.x   | ✅ Yes             |
| < 0.6   | ❌ No              |

## Reporting a Vulnerability

If you discover a security vulnerability in Anti-Hallucination-MCP, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email** the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/Akunimal/Anti-Hallucination-MCP/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Within 2 weeks for critical issues

## Scope

This security policy covers:

- The MCP server (`src/mcp-server/`)
- The post-write hooks (`hooks/`)
- The setup script (`scripts/setup.js`)
- Dependencies (`@ast-grep/napi`, `@modelcontextprotocol/sdk`)

## Security Considerations

Anti-Hallucination-MCP processes source code files on the local filesystem. Key security considerations:

- **Core analysis is read-only**: Symbol indexing and symbol checking read source files and write only local registry files under `.wisdom/`
- **Command execution is explicit**: The `compress_output` MCP tool runs the user-provided shell command locally via Node.js. Treat it as trusted local command execution with the same filesystem, network, and process permissions as the MCP server.
- **Network behavior depends on invoked commands**: The core MCP server does not make network requests itself, but commands run through `compress_output` can access the network if the command does.
- **Local storage**: All data (`.wisdom/` directory) stays on the local filesystem
- **Secrets caution**: The tool does not intentionally store or transmit secrets, but command output may contain secrets if an invoked command prints them. Review commands before running `compress_output`.
