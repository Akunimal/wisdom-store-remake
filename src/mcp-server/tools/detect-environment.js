#!/usr/bin/env node
/**
 * Tool: detect_environment
 * Detecta el entorno del usuario (OS, shell, package managers) y provee reglas anti-errores
 * para evitar comandos incompatibles entre plataformas.
 */

import { platform, arch, homedir, tmpdir } from 'os';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const MCP = require('@modelcontextprotocol/sdk/server/mcp.js');

function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function detectOS() {
  const plat = platform();
  const osMap = {
    win32: { name: 'Windows', version: safeExec('wmic os get Version /value')?.split('=')[1] || 'Unknown' },
    darwin: { name: 'macOS', version: safeExec('sw_vers -productVersion') },
    linux: { name: 'Linux', version: safeExec('uname -r') }
  };
  return osMap[plat] || { name: 'Unknown', version: 'Unknown' };
}

function detectShell() {
  const plat = platform();
  
  if (plat === 'win32') {
    const shell = process.env.COMSPEC || 'cmd.exe';
    const isPowerShell = shell.includes('PowerShell') || process.env.PSModulePath;
    const hasGitBash = existsSync('C:\\Program Files\\Git\\bin\\bash.exe') || 
                       existsSync(path.join(homedir(), 'scoop\\apps\\git\\current\\bin\\bash.exe'));
    const hasWSL = safeExec('wsl --version') !== null;
    
    return {
      current: isPowerShell ? 'PowerShell' : 'cmd.exe',
      recommended: hasGitBash ? 'Git Bash' : (hasWSL ? 'WSL' : 'PowerShell'),
      available: [isPowerShell ? 'PowerShell' : 'cmd.exe', hasGitBash && 'Git Bash', hasWSL && 'WSL'].filter(Boolean),
      warnings: isPowerShell ? [
        'PowerShell usa sintaxis diferente a Bash (ej: | Out-File en vez de >)',
        'Comandos Unix como ls, cat, grep pueden no estar disponibles',
        'Usa Git Bash o WSL para compatibilidad con tutoriales de Linux/macOS'
      ] : []
    };
  }
  
  const shell = process.env.SHELL || 'sh';
  const shellName = path.basename(shell);
  
  return {
    current: shellName,
    recommended: shellName,
    available: [shellName],
    warnings: []
  };
}

function detectPackageManagers() {
  const plat = platform();
  const managers = [];
  
  // Node.js
  if (safeExec('npm --version')) managers.push({ name: 'npm', type: 'node' });
  if (safeExec('yarn --version')) managers.push({ name: 'yarn', type: 'node' });
  if (safeExec('pnpm --version')) managers.push({ name: 'pnpm', type: 'node' });
  if (safeExec('bun --version')) managers.push({ name: 'bun', type: 'node' });
  
  // Python
  if (safeExec('pip --version')) managers.push({ name: 'pip', type: 'python' });
  if (safeExec('pip3 --version')) managers.push({ name: 'pip3', type: 'python' });
  if (safeExec('poetry --version')) managers.push({ name: 'poetry', type: 'python' });
  if (safeExec('conda --version')) managers.push({ name: 'conda', type: 'python' });
  
  // System
  if (plat === 'darwin' && safeExec('brew --version')) managers.push({ name: 'brew', type: 'system' });
  if (plat === 'linux') {
    if (safeExec('apt --version')) managers.push({ name: 'apt', type: 'system' });
    if (safeExec('dnf --version')) managers.push({ name: 'dnf', type: 'system' });
    if (safeExec('pacman --version')) managers.push({ name: 'pacman', type: 'system' });
  }
  if (plat === 'win32') {
    if (safeExec('choco --version')) managers.push({ name: 'chocolatey', type: 'system' });
    if (safeExec('scoop --version')) managers.push({ name: 'scoop', type: 'system' });
  }
  
  return managers;
}

function getPlatformRules() {
  const plat = platform();
  const rules = {
    general: [],
    commands: {},
    paths: {}
  };
  
  if (plat === 'win32') {
    rules.general = [
      'Usa Git Bash o WSL para comandos de tipo Unix',
      'Evita usar > para redirección en PowerShell, usa Out-File o Tee-Object',
      'Las rutas usan \\ en vez de / (aunque Node.js acepta ambos)',
      'Los permisos de ejecución son diferentes (ExecutionPolicy en vez de chmod)'
    ];
    
    rules.commands = {
      'ls': 'Usa "Get-ChildItem" o "gci" en PowerShell, o "ls" en Git Bash/WSL',
      'cat': 'Usa "Get-Content" o "gc" en PowerShell, o "cat" en Git Bash/WSL',
      'grep': 'Usa "Select-String" en PowerShell, o "grep" en Git Bash/WSL',
      'chmod': 'No existe en Windows. Usa propiedades del archivo o ejecuta desde Git Bash/WSL',
      'rm -rf': 'PELIGROSO en PowerShell. Usa "Remove-Item -Recurse -Force" o hazlo desde Git Bash',
      './script.sh': 'No funciona directamente. Usa "bash script.sh" o "./script.sh" desde Git Bash',
      'export VAR=value': 'Usa "$env:VAR = \"value\"" en PowerShell o "export" desde Git Bash',
      'source ~/.bashrc': 'Usa ". $PROFILE" en PowerShell o no aplica en cmd.exe'
    };
    
    rules.paths = {
      home: homedir(),
      temp: tmpdir(),
      note: 'Usa variables de entorno (%USERPROFILE%, %TEMP%) en vez de ~/ o /tmp/'
    };
  } else if (plat === 'darwin') {
    rules.general = [
      'macOS usa Zsh por defecto (desde Catalina)',
      'Usa Homebrew para instalar paquetes del sistema',
      'Algunos comandos GNU tienen flags ligeramente diferentes (ej: sed, awk)'
    ];
    
    rules.commands = {
      'sed -i': 'En macOS requiere "sed -i \'\'" (con comillas vacías) para backup-less',
      'open': 'Usa "open" para abrir archivos/apps (equivalente a xdg-open en Linux)'
    };
    
    rules.paths = {
      home: homedir(),
      temp: tmpdir(),
      note: '~// funciona normalmente. /tmp/ es limpiado periódicamente'
    };
  } else {
    rules.general = [
      'Linux usa Bash/Zsh por defecto',
      'Verifica tu distribution para el package manager correcto (apt, dnf, pacman)',
      'Los permisos se manejan con chmod/chown'
    ];
    
    rules.paths = {
      home: homedir(),
      temp: tmpdir(),
      note: '~/ y /tmp/ funcionan normalmente'
    };
  }
  
  return rules;
}

async function detectEnvironmentHandler() {
  const os = detectOS();
  const shell = detectShell();
  const packageManagers = detectPackageManagers();
  const rules = getPlatformRules();
  
  return {
    system: {
      os: os.name,
      osVersion: os.version,
      arch: arch(),
      nodeVersion: safeExec('node --version'),
      cwd: process.cwd()
    },
    shell: shell,
    packageManagers: packageManagers,
    rules: rules,
    recommendations: [
      shell.warnings.length > 0 ? `⚠️ ${shell.warnings.join('\\n')}` : '✅ Shell configurado correctamente',
      packageManagers.length === 0 ? '💡 Instala al menos un package manager para tu lenguaje principal' : `✅ ${packageManagers.length} package managers disponibles`,
      plat === 'win32' && !shell.available.includes('Git Bash') && !shell.available.includes('WSL') 
        ? '🔴 RECOMENDACIÓN CRÍTICA: Instala Git Bash o habilita WSL para mejor compatibilidad con herramientas Unix'
        : '✅ Entorno compatible con la mayoría de herramientas'
    ].filter(Boolean)
  };
}

// Export para el servidor MCP
module.exports = {
  name: 'detect_environment',
  description: 'Detecta el entorno (OS, shell, package managers) y provee reglas anti-errores para evitar comandos incompatibles entre plataformas. Útil para prevenir errores en Windows/PowerShell vs Linux/macOS/Bash.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  },
  handler: detectEnvironmentHandler
};

// Si se ejecuta standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  detectEnvironmentHandler().then(result => {
    console.log(JSON.stringify(result, null, 2));
  });
}
