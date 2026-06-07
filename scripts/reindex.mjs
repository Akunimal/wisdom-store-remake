#!/usr/bin/env node

/**
 * Script de línea de comandos para forzar una reindexación.
 * Útil para entornos CI/CD donde no hay un servidor MCP corriendo
 * y se necesita regenerar el symbols.json.
 */

import { handleReindexProject } from '../src/mcp-server/tools/reindex-project.js';

async function main() {
  const projectPath = process.cwd();
  console.log(`[Reindex] Iniciando indexación del proyecto: ${projectPath}`);
  
  try {
    const result = await handleReindexProject({ project_path: projectPath });
    console.log('\n--- Resultado de la Indexación ---');
    console.log(result.content[0].text);
    console.log('----------------------------------\n');
  } catch (error) {
    console.error('[Error] Falló la reindexación:', error);
    process.exit(1);
  }
}

main();
