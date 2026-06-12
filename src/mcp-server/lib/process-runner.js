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

export function terminateProcessTree(childOrPid) {
  const pid = typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;

  if (IS_WINDOWS) {
    const result = spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true
    });

    if (typeof childOrPid?.kill === 'function') {
      try { childOrPid.kill('SIGKILL'); } catch { /* already gone */ }
    }
    return result.status === 0;
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
  activeChildren.clear();
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
    timeoutMs = 120000,
    maxBuffer = DEFAULT_MAX_BUFFER,
    shell = false,
    stdio = ['ignore', 'pipe', 'pipe'],
    signal,
    ...spawnOptions
  } = options;

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
