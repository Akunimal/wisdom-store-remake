#!/usr/bin/env node
/**
 * Tool: detect_environment
 *
 * Reports the real local command environment and gives shell-safe guidance.
 * The Windows path is intentionally explicit: agents often mix PowerShell,
 * Git Bash, and WSL quoting rules, which creates avoidable command failures.
 */

import { platform, arch, homedir, tmpdir } from 'os';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runProcess } from '../lib/process-runner.js';

const IS_WINDOWS = platform() === 'win32';

function cleanOutput(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

async function runRaw(command, args = [], options = {}) {
  try {
    let executable = command;
    let finalArgs = args;

    if (IS_WINDOWS && /\.(cmd|bat)$/i.test(command)) {
      executable = 'cmd.exe';
      finalArgs = ['/d', '/c', command, ...args];
    }

    const result = await runProcess(executable, finalArgs, {
      timeoutMs: options.timeout || 5000,
      signal: options.signal
    });

    return {
      ok: result.ok,
      status: result.status,
      stdout: cleanOutput(result.stdout),
      stderr: cleanOutput(result.stderr),
      error: result.error || null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      error: error.message
    };
  }
}

async function resolveWindowsCommand(command, options = {}) {
  if (!IS_WINDOWS || /[\\/]/.test(command) || path.extname(command)) {
    return command;
  }

  const result = await runRaw('where.exe', [command], options);
  if (!result.ok) {
    return command;
  }

  const candidates = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const runnable = candidates.find((candidate) => /\.(exe|cmd|bat|com)$/i.test(candidate));
  if (runnable) {
    return runnable;
  }

  for (const candidate of candidates) {
    for (const ext of ['.cmd', '.exe', '.bat', '.com']) {
      if (existsSync(candidate + ext)) {
        return candidate + ext;
      }
    }
  }

  return candidates[0] || command;
}

async function run(command, args = [], options = {}) {
  return runRaw(await resolveWindowsCommand(command, options), args, options);
}

function firstLine(text) {
  return cleanOutput(text).split('\n').find(Boolean) || null;
}

async function versionOf(command, args = ['--version'], options = {}) {
  const result = await run(command, args, options);
  if (!result.ok && !result.stdout && !result.stderr) {
    return null;
  }
  return firstLine(result.stdout || result.stderr);
}

async function commandPath(command, options = {}) {
  if (IS_WINDOWS) {
    const resolved = await resolveWindowsCommand(command, options);
    return resolved === command ? null : resolved;
  }

  const result = await run('which', [command], options);
  return result.ok ? firstLine(result.stdout) : null;
}

async function detectOS(options = {}) {
  const plat = platform();
  if (plat === 'win32') {
    const ver = await run('cmd.exe', ['/d', '/s', '/c', 'ver'], options);
    return { name: 'Windows', version: firstLine(ver.stdout) || 'Unknown' };
  }
  if (plat === 'darwin') {
    return { name: 'macOS', version: await versionOf('sw_vers', ['-productVersion'], options) || 'Unknown' };
  }
  return { name: 'Linux', version: await versionOf('uname', ['-r'], options) || 'Unknown' };
}

function findGitBash() {
  if (!IS_WINDOWS) {
    return null;
  }

  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    path.join(homedir(), 'scoop\\apps\\git\\current\\bin\\bash.exe')
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function parseWslList(output) {
  const distros = [];
  for (const rawLine of cleanOutput(output).split('\n')) {
    const line = rawLine.trim();
    if (!line || /^NAME\s+STATE\s+VERSION/i.test(line)) {
      continue;
    }

    const match = line.match(/^(\*)?\s*(\S+)\s+(\S+)\s+(\d+)$/);
    if (!match) {
      continue;
    }

    distros.push({
      name: match[2],
      state: match[3],
      version: Number(match[4]),
      default: Boolean(match[1])
    });
  }
  return distros;
}

function parseWslDefault(statusOutput, distros) {
  const normalized = cleanOutput(statusOutput);
  const lines = normalized.split('\n');
  for (const line of lines) {
    const match = line.match(/(?:Default Distribution|Distribucion predeterminada|Distribución predeterminada):\s*(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }
  return distros.find((distro) => distro.default)?.name || null;
}

async function getWslToolchain(options = {}) {
  const script = [
    'printf "shell=%s\\n" "$SHELL"',
    'printf "bash=%s\\n" "$(command -v bash 2>/dev/null || true)"',
    'printf "git=%s\\n" "$(command -v git 2>/dev/null || true)"',
    'printf "node=%s\\n" "$(command -v node 2>/dev/null || true)"',
    'printf "npm=%s\\n" "$(command -v npm 2>/dev/null || true)"',
    'printf "nodeVersion=%s\\n" "$(node --version 2>/dev/null || true)"',
    'printf "npmVersion=%s\\n" "$(npm --version 2>/dev/null || true)"',
    'printf "gitVersion=%s\\n" "$(git --version 2>/dev/null || true)"'
  ].join('; ');

  const result = await run('wsl', ['--exec', 'bash', '-lc', script], { ...options, timeout: 10000 });
  const values = {};
  for (const line of result.stdout.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key) {
      values[key] = rest.join('=');
    }
  }

  return {
    ok: result.ok,
    shell: values.shell || null,
    bash: values.bash || null,
    git: values.git || null,
    node: values.node || null,
    npm: values.npm || null,
    versions: {
      git: values.gitVersion || null,
      node: values.nodeVersion || null,
      npm: values.npmVersion || null
    },
    error: result.ok ? null : (result.stderr || result.error || 'WSL command failed')
  };
}

async function detectPlainBashTarget(options = {}) {
  const result = await run('bash', ['-lc', 'printf "uname=%s\\npwd=%s\\nshell=%s\\n" "$(uname -s)" "$(pwd)" "$SHELL"'], options);
  if (!result.ok) {
    return {
      available: false,
      target: null,
      uname: null,
      pwd: null,
      shell: null,
      error: result.stderr || result.error || 'bash is not available'
    };
  }

  const values = {};
  for (const line of result.stdout.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key) {
      values[key] = rest.join('=');
    }
  }

  const uname = values.uname || null;
  let target = 'unknown';
  if (uname === 'Linux') {
    target = 'WSL/Linux';
  } else if (/MINGW|MSYS|CYGWIN/i.test(uname || '')) {
    target = 'Git Bash/MSYS';
  }

  return {
    available: true,
    target,
    uname,
    pwd: values.pwd || null,
    shell: values.shell || null,
    error: null
  };
}

async function detectGitBash(options = {}) {
  const executable = findGitBash();
  if (!executable) {
    return {
      available: false,
      executable: null,
      uname: null,
      git: null,
      node: null,
      npm: null
    };
  }

  const script = [
    'printf "uname=%s\\n" "$(uname -s)"',
    'printf "git=%s\\n" "$(command -v git 2>/dev/null || true)"',
    'printf "node=%s\\n" "$(command -v node 2>/dev/null || true)"',
    'printf "npm=%s\\n" "$(command -v npm 2>/dev/null || true)"',
    'printf "nodeVersion=%s\\n" "$(node --version 2>/dev/null || true)"',
    'printf "npmVersion=%s\\n" "$(npm --version 2>/dev/null || true)"',
    'printf "gitVersion=%s\\n" "$(git --version 2>/dev/null || true)"'
  ].join('; ');
  const result = await run(executable, ['-lc', script], options);
  const values = {};
  for (const line of result.stdout.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key) {
      values[key] = rest.join('=');
    }
  }

  return {
    available: result.ok,
    executable,
    uname: values.uname || null,
    git: values.git || null,
    node: values.node || null,
    npm: values.npm || null,
    versions: {
      git: values.gitVersion || null,
      node: values.nodeVersion || null,
      npm: values.npmVersion || null
    },
    error: result.ok ? null : (result.stderr || result.error || 'Git Bash command failed')
  };
}

async function detectWsl(options = {}) {
  if (!IS_WINDOWS) {
    return null;
  }

  const [status, list] = await Promise.all([
    run('wsl', ['--status'], options),
    run('wsl', ['--list', '--verbose'], options)
  ]);
  const distros = parseWslList(list.stdout);
  const defaultDistribution = parseWslDefault(status.stdout, distros);
  const defaultDistro = distros.find((distro) => distro.name === defaultDistribution) || null;
  const usableDefault = Boolean(defaultDistro && !/^docker-desktop$/i.test(defaultDistro.name));
  const toolchain = usableDefault ? await getWslToolchain(options) : null;

  return {
    installed: status.ok || list.ok,
    defaultDistribution,
    defaultVersion: status.stdout.match(/(?:Default Version|Version predeterminada|Versión predeterminada):\s*(\d+)/i)?.[1] || null,
    distros,
    usableDefault,
    toolchain,
    warnings: [
      !defaultDistribution && 'WSL is installed but has no default distro.',
      defaultDistro && /^docker-desktop$/i.test(defaultDistro.name) && 'WSL default distro is docker-desktop; do not use it as a coding shell.',
      usableDefault && toolchain && (!toolchain.node || !toolchain.npm) && 'WSL default distro is usable, but Node/npm are missing inside Linux.',
      usableDefault && toolchain && toolchain.npm?.startsWith('/mnt/c/') && 'WSL npm resolves to Windows PATH; install Node/npm inside WSL to avoid mixed toolchains.'
    ].filter(Boolean)
  };
}

async function detectNativeToolchain(options = {}) {
  async function inspect(command, args) {
    const [commandPathResult, version] = await Promise.all([
      commandPath(command, options),
      versionOf(command, args, options)
    ]);
    return { path: commandPathResult, version };
  }

  const [node, npm, git, python] = await Promise.all([
    inspect('node'),
    inspect('npm'),
    inspect('git'),
    inspect('python', ['--version'])
  ]);

  return {
    node,
    npm,
    git,
    python
  };
}

async function detectPackageManagers(nativeToolchain, options = {}) {
  const managers = [];

  for (const [name, info] of Object.entries(nativeToolchain)) {
    if (info.path || info.version) {
      managers.push({ name, type: name === 'python' ? 'python' : 'native', path: info.path, version: info.version });
    }
  }

  for (const name of ['yarn', 'pnpm', 'bun', 'pip', 'pip3', 'poetry', 'conda']) {
    // Resolve the binary first (fast where/which) and only spawn the
    // `--version` probe when it exists — absent managers otherwise cost a
    // full failed-spawn each, adding seconds to the tool on lean systems.
    const binPath = await commandPath(name, options);
    const version = binPath ? await versionOf(name, ['--version'], options) : null;
    if (version || binPath) {
      managers.push({ name, type: name.startsWith('pip') || ['poetry', 'conda'].includes(name) ? 'python' : 'node', path: binPath, version });
    }
  }

  if (platform() === 'darwin') {
    const brew = await versionOf('brew', ['--version'], options);
    if (brew) managers.push({ name: 'brew', type: 'system', path: await commandPath('brew', options), version: brew });
  }
  if (platform() === 'linux') {
    for (const name of ['apt', 'dnf', 'pacman']) {
      const version = await versionOf(name, ['--version'], options);
      if (version) managers.push({ name, type: 'system', path: await commandPath(name, options), version });
    }
  }
  if (IS_WINDOWS) {
    for (const name of ['choco', 'scoop']) {
      const version = await versionOf(name, ['--version'], options);
      if (version) managers.push({ name, type: 'system', path: await commandPath(name, options), version });
    }
  }

  return managers;
}

function chooseRecommendation({ wsl, gitBash, nativeToolchain }) {
  if (IS_WINDOWS) {
    if (wsl?.usableDefault && wsl.toolchain?.node && wsl.toolchain?.npm && wsl.toolchain?.git) {
      return {
        shell: 'WSL Ubuntu/Linux',
        reason: 'Default WSL distro has bash, git, node, and npm installed inside Linux.',
        command: "bash -lc 'npm test'"
      };
    }

    if (gitBash?.available && gitBash.node && gitBash.npm && gitBash.git) {
      return {
        shell: 'Git Bash',
        reason: 'Git Bash has a coherent Windows-native git/node/npm toolchain.',
        command: '"C:\\Program Files\\Git\\bin\\bash.exe" -lc \'npm test\''
      };
    }

    if (nativeToolchain.node.path && nativeToolchain.npm.path && nativeToolchain.git.path) {
      return {
        shell: 'Native Windows command',
        reason: 'Native Windows node/npm/git are available; use PowerShell/cmd syntax only.',
        command: 'npm test'
      };
    }

    return {
      shell: 'Needs setup',
      reason: 'No complete git/node/npm toolchain was detected.',
      command: 'Install Git Bash or configure WSL with node/npm/git.'
    };
  }

  return {
    shell: path.basename(process.env.SHELL || 'sh'),
    reason: 'Non-Windows shells have consistent POSIX quoting by default.',
    command: 'npm test'
  };
}

function getPlatformRules(context) {
  const plat = platform();
  const rules = {
    general: [],
    commands: {},
    paths: {},
    quoting: []
  };

  if (plat === 'win32') {
    rules.general = [
      'Pick one shell per command: PowerShell, Git Bash, or WSL. Do not mix quoting rules.',
      'Use WSL (`bash -lc`) only when the WSL distro has the required tools installed inside Linux.',
      'Use Git Bash explicitly when you need Bash semantics with Windows-native Node/npm.',
      'Avoid plain `bash` if WSL default is docker-desktop or if WSL is missing Node/npm.'
    ];

    rules.commands = {
      'bash': context.plainBash.available
        ? `Plain bash currently targets ${context.plainBash.target}.`
        : 'Plain bash is not available.',
      'bash -lc': context.wsl?.usableDefault
        ? 'Preferred for Linux-style commands when WSL toolchain is complete.'
        : 'Only use after installing a real WSL distro and required tools.',
      'git-bash': context.gitBash?.available
        ? `Use "${context.gitBash.executable}" -lc 'command' for explicit Git Bash.`
        : 'Git Bash was not found.',
      'rm -rf': 'Use only in Bash/WSL after verifying the target path. In PowerShell use Remove-Item with -LiteralPath.',
      'export VAR=value': 'Bash syntax. In PowerShell use $env:VAR = "value".',
      'source file': 'Bash syntax. In PowerShell use dot sourcing with . path.'
    };

    rules.quoting = [
      "Bash: use single quotes around scripts passed to -lc, e.g. bash -lc 'npm test'.",
      'PowerShell expands $variables inside double quotes; escape or use single quotes when needed.',
      'Do not embed unescaped Windows paths with spaces inside unquoted Bash commands.',
      'Prefer spawn/argument arrays in Node.js over shell strings for automation.'
    ];

    rules.paths = {
      windowsHome: homedir(),
      temp: tmpdir(),
      wslCwdExample: '/mnt/c/path/to/project',
      note: 'Windows paths use C:\\..., WSL paths use /mnt/c/..., Git Bash accepts /c/... and many C:/... paths.'
    };
  } else if (plat === 'darwin') {
    rules.general = [
      'macOS uses zsh by default.',
      'Use Homebrew for system packages.',
      'GNU and BSD command flags can differ; check sed/awk/find flags.'
    ];
    rules.commands = {
      'sed -i': 'macOS requires sed -i "" for in-place edits without backups.',
      open: 'Use open to launch files/apps.'
    };
    rules.paths = {
      home: homedir(),
      temp: tmpdir(),
      note: '~/ and /tmp/ work normally.'
    };
  } else {
    rules.general = [
      'Linux uses Bash/Zsh-compatible POSIX quoting by default.',
      'Use the distro package manager for system packages.',
      'Permissions are managed with chmod/chown.'
    ];
    rules.paths = {
      home: homedir(),
      temp: tmpdir(),
      note: '~/ and /tmp/ work normally.'
    };
  }

  return rules;
}

export async function detectEnvironmentHandler(signal) {
  const options = { signal };
  const plainBashProbe = IS_WINDOWS
    ? detectPlainBashTarget(options)
    : (async () => ({
      available: Boolean(process.env.SHELL),
      target: platform(),
      uname: await versionOf('uname', ['-s'], options),
      pwd: process.cwd(),
      shell: process.env.SHELL || null,
      error: null
    }))();

  const [os, nativeToolchain, wsl, gitBash, plainBash] = await Promise.all([
    detectOS(options),
    detectNativeToolchain(options),
    detectWsl(options),
    IS_WINDOWS ? detectGitBash(options) : null,
    plainBashProbe
  ]);
  const packageManagers = await detectPackageManagers(nativeToolchain, options);
  const recommendation = chooseRecommendation({ wsl, gitBash, nativeToolchain });
  const context = { wsl, gitBash, plainBash };
  const rules = getPlatformRules(context);

  const warnings = [
    ...(wsl?.warnings || []),
    IS_WINDOWS && plainBash.available && plainBash.target === 'WSL/Linux' && wsl?.usableDefault && !wsl.toolchain?.node && 'Plain bash enters WSL, but WSL Node is missing.',
    IS_WINDOWS && gitBash?.available && wsl?.usableDefault && 'Both WSL and Git Bash are available; choose one per command to avoid quoting/path confusion.'
  ].filter(Boolean);

  return {
    system: {
      os: os.name,
      osVersion: os.version,
      arch: arch(),
      platform: platform(),
      cwd: process.cwd(),
      nativeNodeVersion: nativeToolchain.node.version
    },
    shell: {
      currentProcessShell: process.env.SHELL || process.env.ComSpec || null,
      plainBash,
      recommended: recommendation
    },
    windows: IS_WINDOWS ? {
      wsl,
      gitBash,
      nativeToolchain
    } : null,
    packageManagers,
    rules,
    recommendations: [
      `Recommended shell: ${recommendation.shell}`,
      `Reason: ${recommendation.reason}`,
      `Example: ${recommendation.command}`,
      ...warnings.map((warning) => `Warning: ${warning}`)
    ]
  };
}

function formatCompact(result) {
  const lines = [];

  // Recommendation block
  for (const rec of result.recommendations) {
    lines.push(rec);
  }

  // Key rules (flatten to essentials)
  if (result.rules.general?.length) {
    lines.push('');
    lines.push('Rules:');
    for (const rule of result.rules.general) {
      lines.push(`- ${rule}`);
    }
  }

  if (result.rules.quoting?.length) {
    for (const rule of result.rules.quoting) {
      lines.push(`- ${rule}`);
    }
  }

  // Critical command notes (only non-obvious ones)
  if (result.rules.commands) {
    const critical = Object.entries(result.rules.commands)
      .filter(([, v]) => !v.includes('not available') && !v.includes('not found'))
      .slice(0, 5);
    if (critical.length) {
      lines.push('');
      lines.push('Commands:');
      for (const [cmd, note] of critical) {
        lines.push(`- ${cmd}: ${note}`);
      }
    }
  }

  // Path info (one line)
  if (result.rules.paths?.note) {
    lines.push('');
    lines.push(`Paths: ${result.rules.paths.note}`);
  }

  return lines.join('\n');
}

export async function handleDetectEnvironment(args, signal) {
  const result = await detectEnvironmentHandler(signal);
  const compact = args?.compact === true; // default: false

  if (compact) {
    return {
      content: [{ type: 'text', text: formatCompact(result) }]
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  detectEnvironmentHandler().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
