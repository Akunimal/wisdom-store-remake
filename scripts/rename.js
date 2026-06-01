const fs = require('fs');

let pkg = fs.readFileSync('package.json', 'utf8');
pkg = pkg.replace('"name": "wisdom-store-remake"', '"name": "anti-hallucination-mcp"');
pkg = pkg.replace('"wisdom-store-remake":', '"anti-hallucination-mcp":');
pkg = pkg.replaceAll('wisdom-store-remake', 'Anti-Hallucination-MCP');
fs.writeFileSync('package.json', pkg);

let readme = fs.readFileSync('README.md', 'utf8');
readme = readme.replaceAll('wisdom-store-remake', 'Anti-Hallucination-MCP');
readme = readme.replaceAll('AA MCP (Anti-Hallucination MCP)', 'Anti-Hallucination-MCP');
readme = readme.replaceAll('AA MCP', 'Anti-Hallucination-MCP');
fs.writeFileSync('README.md', readme);
