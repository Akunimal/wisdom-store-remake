# Contributing to wisdom-store-remake

Thank you for your interest in contributing! This project is an anti-hallucination MCP server for AI coding assistants, and we welcome contributions that improve detection accuracy, language support, or compatibility.

## Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `npm install`
3. **Run tests**: `npm test`

## How to Contribute

### Reporting Bugs

- Open an [issue](https://github.com/Akunimal/wisdom-store-remake/issues) with:
  - Steps to reproduce
  - Expected vs actual behavior
  - Your environment (OS, Node.js version, AI assistant used)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and why it matters for anti-hallucination

### Submitting Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass: `npm test`
4. Submit a PR with a clear description of what changed and why

### Code Style

- ESM modules (`import`/`export`)
- No external dependencies beyond `@ast-grep/napi` and `@modelcontextprotocol/sdk`
- Tests use Node.js built-in test runner (`node:test`)

## Areas Where Help Is Needed

- **Language support**: Adding AST extraction for languages currently using regex fallback (Python, Go, Rust)
- **Performance**: Optimizing symbol indexing for large codebases (10k+ files)
- **IDE compatibility**: Testing and documenting MCP setup for Cursor, Windsurf, and other editors
- **False positive reduction**: Improving the fuzzy matching threshold and ignore patterns

## Development

```bash
# Run tests
npm test

# Start MCP server manually
npm start

# Inspect with MCP Inspector
npm run inspector
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
