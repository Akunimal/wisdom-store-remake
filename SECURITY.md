# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | ✅ Yes             |
| < 0.5   | ❌ No              |

## Reporting a Vulnerability

If you discover a security vulnerability in wisdom-store-remake, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email** the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/Akunimal/wisdom-store-remake/security/advisories/new)
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

wisdom-store-remake processes source code files on the local filesystem. Key security considerations:

- **No network access**: The MCP server does not make any network requests
- **Read-only analysis**: Symbol checking only reads files, never modifies source code
- **Local storage**: All data (`.wisdom/` directory) stays on the local filesystem
- **No secrets handling**: The tool does not process, store, or transmit any secrets or credentials
