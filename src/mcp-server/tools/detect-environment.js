#!/usr/bin/env node
/**
 * Tool: detect_environment
 *
 * Reports the real local command environment and gives shell-safe guidance.
 * The Windows path is intentionally explicit: agents often mix PowerShell,
 * Git Bash, and WSL quoting rules, which creates avoidable command failures.
 */

import { platform, arch, homedir, tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const IS_WINDOWS = platform() === 'win32';

function cleanOutput(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function runRaw(command, args = [], options = {}) {
  try {
    let executable = command;
    let finalArgs = args;

    if (IS_WINDOWS && /\.(cmd|bat)$/i.test(command)) {
      executable = 'cmd.exe';
      finalArgs = ['/d', '/c', command, ...args];
    }

    const result = spawnSync(executable, finalArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout || 5000,
      windowsHide: true
    });

    return {
      ok: result.status === 0,
      status: result.status,
      stdout: cleanOutput(result.stdout),
      stderr: cleanOutput(result.stderr),
      error: result.error?.message || null
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

function resolveWindowsCommand(command) {
  if (!IS_WINDOWS || /[\\/]/.test(command) || path.extname(command)) {
    return command;
  }

  const result = runRaw('where.exe', [command]);
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

function run(command, args = [], options = {}) {
  return runRaw(resolveWindowsCommand(command), args, options);
}

function firstLine(text) {
  return cleanOutput(text).split('\n').find(Boolean) || null;
}

function versionOf(command, args = ['--version']) {
  const result = run(command, args);
  if (!result.ok && !result.stdout && !result.stderr) {
    return null;
  }
  return firstLine(result.stdout || result.stderr);
}

function commandPath(command) {
  if (IS_WINDOWS) {
    const resolved = resolveWindowsCommand(command);
    return resolved === command ? null : resolved;
  }

  const result = run('which', [command]);
  return result.ok ? firstLine(result.stdout) : null;
}

function detectOS() {
  const plat = platform();
  if (plat === 'win32') {
    const ver = run('cmd.exe', ['/d', '/s', '/c', 'ver']);
    return { name: 'Windows', version: firstLine(ver.stdout) || 'Unknown' };
  }
  if (plat === 'darwin') {
    return { name: 'macOS', version: versionOf('sw_vers', ['-productVersion']) || 'Unknown' };
  }
  return { name: 'Linux', version: versionOf('uname', ['-r']) || 'Unknown' };
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

function getWslToolchain() {
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

  const result = run('wsl', ['--exec', 'bash', '-lc', script], { timeout: 10000 });
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

function detectPlainBashTarget() {
  const result = run('bash', ['-lc', 'printf "uname=%s\\npwd=%s\\nshell=%s\\n" "$(uname -s)" "$(pwd)" "$SHELL"']);
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

function detectGitBash() {
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
  const result = run(executable, ['-lc', script]);
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

function detectWsl() {
  if (!IS_WINDOWS) {
    return null;
  }

  const status = run('wsl', ['--status']);
  const list = run('wsl', ['--list', '--verbose']);
  const distros = parseWslList(list.stdout);
  const defaultDistribution = parseWslDefault(status.stdout, distros);
  const defaultDistro = distros.find((distro) => distro.name === defaultDistribution) || null;
  const usableDefault = Boolean(defaultDistro && !/^docker-desktop$/i.test(defaultDistro.name));
  const toolchain = usableDefault ? getWslToolchain() : null;

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

function detectNativeToolchain() {
  return {
    node: { path: commandPath('node'), version: versionOf('node') },
    npm: { path: commandPath('npm'), version: versionOf('npm') },
    git: { path: commandPath('git'), version: versionOf('git') },
    python: { path: commandPath('python'), version: versionOf('python', ['--version']) }
  };
}

function detectPackageManagers(nativeToolchain) {
  const managers = [];

  for (const [name, info] of Object.entries(nativeToolchain)) {
    if (info.path || info.version) {
      managers.push({ name, type: name === 'python' ? 'python' : 'native', path: info.path, version: info.version });
    }
  }

  for (const name of ['yarn', 'pnpm', 'bun', 'pip', 'pip3', 'poetry', 'conda']) {
    const version = versionOf(name);
    const binPath = commandPath(name);
    if (version || binPath) {
      managers.push({ name, type: name.startsWith('pip') || ['poetry', 'conda'].includes(name) ? 'python' : 'node', path: binPath, version });
    }
  }

  if (platform() === 'darwin') {
    const brew = versionOf('brew');
    if (brew) managers.push({ name: 'brew', type: 'system', path: commandPath('brew'), version: brew });
  }
  if (platform() === 'linux') {
    for (const name of ['apt', 'dnf', 'pacman']) {
      const version = versionOf(name);
      if (version) managers.push({ name, type: 'system', path: commandPath(name), version });
    }
  }
  if (IS_WINDOWS) {
    for (const name of ['choco', 'scoop']) {
      const version = versionOf(name);
      if (version) managers.push({ name, type: 'system', path: commandPath(name), version });
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
        command: "rtk bash -lc 'npm test'"
      };
    }

    if (gitBash?.available && gitBash.node && gitBash.npm && gitBash.git) {
      return {
        shell: 'Git Bash',
        reason: 'Git Bash has a coherent Windows-native git/node/npm toolchain.',
        command: 'rtk "C:\\Program Files\\Git\\bin\\bash.exe" -lc \'npm test\''
      };
    }

    if (nativeToolchain.node.path && nativeToolchain.npm.path && nativeToolchain.git.path) {
      return {
        shell: 'Native Windows command',
        reason: 'Native Windows node/npm/git are available; use PowerShell/cmd syntax only.',
        command: 'rtk npm test'
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
    command: 'rtk npm test'
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
      'rtk bash -lc': context.wsl?.usableDefault
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

export async function detectEnvironmentHandler() {
  const os = detectOS();
  const nativeToolchain = detectNativeToolchain();
  const wsl = detectWsl();
  const gitBash = IS_WINDOWS ? detectGitBash() : null;
  const plainBash = IS_WINDOWS ? detectPlainBashTarget() : {
    available: Boolean(process.env.SHELL),
    target: platform(),
    uname: versionOf('uname', ['-s']),
    pwd: process.cwd(),
    shell: process.env.SHELL || null,
    error: null
  };
  const packageManagers = detectPackageManagers(nativeToolchain);
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

export async function handleDetectEnvironment() {
  const result = await detectEnvironmentHandler();

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  detectEnvironmentHandler().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
