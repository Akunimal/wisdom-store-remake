import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const IS_WINDOWS = platform() === 'win32';
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;
const activeChildren = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', terminateAllProcessTrees);
}

function getWindowsProcessSnapshot() {
  const wmic = spawnSync('wmic.exe', [
    'process',
    'get',
    'ProcessId,ParentProcessId',
    '/format:csv'
  ], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });

  let processes = [];
  if (wmic.status === 0 && wmic.stdout?.trim()) {
    processes = wmic.stdout.split(/\r?\n/).flatMap((line) => {
      const fields = line.replace(/\r/g, '').trim().split(',');
      const parentPid = Number(fields.at(-2));
      const pid = Number(fields.at(-1));
      return Number.isInteger(pid) && Number.isInteger(parentPid)
        ? [{ ProcessId: pid, ParentProcessId: parentPid }]
        : [];
    });
  }

  if (processes.length === 0) {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      script
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });

    if (result.status === 0 && result.stdout?.trim()) {
      try {
        const parsed = JSON.parse(result.stdout);
        processes = Array.isArray(parsed) ? parsed : [parsed];
      } catch { /* no usable process snapshot */ }
    }
  }

  return processes;
}

function getWindowsDescendantPids(rootPid) {
  const processes = getWindowsProcessSnapshot();
  const descendants = new Set();

  function collect() {
    let found = true;
    while (found) {
      found = false;
      for (const entry of processes) {
        const pid = Number(entry.ProcessId);
        const parentPid = Number(entry.ParentProcessId);
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || descendants.has(pid)) continue;
        if (parentPid === rootPid || descendants.has(parentPid)) {
          descendants.add(pid);
          found = true;
        }
      }
    }
  }

  collect();
  return [...descendants];
}

export function terminateProcessTree(childOrPid) {
  const pid = typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;

  if (IS_WINDOWS) {
    const rootMayStillExist = typeof childOrPid === 'number'
      || (childOrPid.exitCode === null && childOrPid.signalCode === null);

    function taskkill(targetPid) {
      const result = spawnSync('taskkill.exe', ['/pid', String(targetPid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: 5000,
        windowsHide: true
      });
      return result.status === 0;
    }

    // Fast path while the root still exists. If it already exited, taskkill /T
    // cannot discover descendants, even though they retain the dead parent PID.
    let killed = rootMayStillExist && taskkill(pid);
    if (rootMayStillExist && typeof childOrPid?.kill === 'function') {
      try { childOrPid.kill('SIGKILL'); } catch { /* already gone */ }
    }

    if (!killed) {
      for (const descendantPid of getWindowsDescendantPids(pid)) {
        const killedBranch = taskkill(descendantPid);
        killed = killedBranch || killed;
      }
    }
    return killed;
  }

  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

export function terminateAllProcessTrees() {
  const children = [...activeChildren];
  for (const child of children) {
    terminateProcessTree(child);
  }
  return children.length;
}

export function activeProcessCount() {
  return activeChildren.size;
}

export function runProcess(command, args = [], options = {}) {
  const {
    timeoutMs: requestedTimeoutMs = 120000,
    maxBuffer: requestedMaxBuffer = DEFAULT_MAX_BUFFER,
    shell = false,
    stdio = ['ignore', 'pipe', 'pipe'],
    signal,
    ...spawnOptions
  } = options;
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 0
    ? requestedTimeoutMs
    : 120000;
  const maxBuffer = Number.isFinite(requestedMaxBuffer) && requestedMaxBuffer >= 0
    ? requestedMaxBuffer
    : DEFAULT_MAX_BUFFER;

  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: 'Process was aborted',
      killed: true,
      timedOut: false,
      maxBufferExceeded: false,
      aborted: true
    });
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        ...spawnOptions,
        shell,
        stdio,
        windowsHide: spawnOptions.windowsHide ?? true,
        detached: spawnOptions.detached ?? !IS_WINDOWS
      });
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: error.message,
        killed: false,
        timedOut: false,
        maxBufferExceeded: false,
        aborted: false
      });
      return;
    }

    installExitHook();
    activeChildren.add(child);

    const stdout = [];
    const stderr = [];
    let bufferedBytes = 0;
    let spawnError = null;
    let stopReason = null;
    let timer = null;

    function collect(chunks, chunk) {
      if (stopReason === 'maxBuffer') return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBuffer - bufferedBytes;
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining));
        bufferedBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) {
        stop('maxBuffer');
      }
    }

    function stop(reason) {
      if (stopReason) return;
      stopReason = reason;
      terminateProcessTree(child);
      // A detached descendant can keep inherited pipe handles open after the
      // direct child exits. Closing our ends guarantees `close` can settle.
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    }

    function onAbort() {
      stop('abort');
    }

    child.stdout?.on('data', (chunk) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk) => collect(stderr, chunk));
    child.on('error', (error) => {
      spawnError = error;
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => stop('timeout'), timeoutMs);
      timer.unref?.();
    }

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('close', (status, closeSignal) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      activeChildren.delete(child);

      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      const timedOut = stopReason === 'timeout';
      const maxBufferExceeded = stopReason === 'maxBuffer';
      const aborted = stopReason === 'abort';
      const error = spawnError?.message
        || (timedOut ? `Process timed out after ${timeoutMs}ms` : null)
        || (maxBufferExceeded ? `Process output exceeded maxBuffer (${maxBuffer} bytes)` : null)
        || (aborted ? 'Process was aborted' : null);

      resolve({
        ok: status === 0 && !stopReason && !spawnError,
        status: spawnError ? null : status,
        signal: closeSignal,
        stdout: stdoutText,
        stderr: stderrText,
        error,
        killed: Boolean(stopReason),
        timedOut,
        maxBufferExceeded,
        aborted
      });
    });
  });
}

export function runShellCommand(command, options = {}) {
  return runProcess(command, [], { ...options, shell: true });
}
