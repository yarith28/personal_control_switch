const { spawn, execFile } = require('node:child_process');

const DEFAULT_GIT_TIMEOUT_MS = 2 * 60 * 1000;
const STREAMING_GIT_TIMEOUT_MS = 5 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 1500;

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

function trimGitText(text) {
  return String(text || '').trim();
}

function combinedGitOutput(stdout, stderr) {
  return [trimGitText(stderr), trimGitText(stdout)].filter(Boolean).join('\n');
}

function defaultGitErrorSummary(command) {
  switch (command) {
    case 'fetch':
      return 'Fetch failed.';
    case 'pull':
      return 'Pull failed.';
    case 'push':
      return 'Push failed.';
    case 'commit':
      return 'Commit failed.';
    case 'checkout':
      return 'Branch switch failed.';
    case 'status':
      return 'Git status failed.';
    case 'add':
      return 'Staging changes failed.';
    default:
      return 'Git command failed.';
  }
}

function classifyGitFailure(args, stdout, stderr) {
  const command = args[0] || 'git';
  const raw = combinedGitOutput(stdout, stderr);
  const normalized = raw.toLowerCase();
  const has = (...patterns) => patterns.some((pattern) => normalized.includes(pattern));

  if (has('detected dubious ownership', 'safe.directory', 'is owned by someone else')) {
    return {
      code: 'UNSAFE_REPOSITORY',
      summary: 'Git blocked this repository because its owner is not trusted.',
      raw,
    };
  }

  if (
    has(
      'terminal prompts disabled',
      'could not read username',
      'could not read password',
      'authentication failed',
      'permission denied (publickey)',
      'permission denied (publickey,password)'
    )
  ) {
    return {
      summary: 'Authentication failed. Git needed credentials, but this app cannot answer interactive prompts.',
      raw,
    };
  }

  if (
    has(
      'repository not found',
      'requested url returned error: 401',
      'requested url returned error: 403',
      'the requested url returned error: 401',
      'the requested url returned error: 403',
      'write access to repository not granted',
      'access denied'
    )
  ) {
    return {
      code: 'REMOTE_ACCESS_DENIED',
      summary: 'The remote repository was not found or this account does not have access to it.',
      raw,
    };
  }

  if (
    has(
      'ssl certificate problem',
      'certificate verify failed',
      'server certificate verification failed',
      'unable to get local issuer certificate',
      'schannel: next initializesecuritycontext failed'
    )
  ) {
    return {
      code: 'TLS_CERTIFICATE_FAILED',
      summary: 'Git could not verify the remote server certificate. Check the certificate, system clock, or HTTPS proxy.',
      raw,
    };
  }

  if (
    has(
      'could not resolve host',
      'failed to connect',
      'connection timed out',
      'operation timed out',
      'network is unreachable',
      'connection refused',
      'connection reset',
      'unable to access'
    )
  ) {
    return {
      summary: 'Could not reach the remote repository. Check your network, VPN, or remote URL.',
      raw,
    };
  }

  if (command === 'push' && has('has no upstream branch', 'no upstream branch')) {
    return {
      code: 'NO_UPSTREAM',
      summary: 'No upstream branch is set for this branch.',
      raw,
    };
  }

  if (
    command === 'push'
    && has(
      'remote rejected',
      'hook declined',
      'protected branch',
      'pre-receive hook declined',
      'deny updating a hidden ref'
    )
  ) {
    return {
      code: 'PUSH_REMOTE_REJECTED',
      summary: 'The remote rejected this push because of a repository policy or server hook.',
      raw,
    };
  }

  if (
    command === 'push' &&
    has('non-fast-forward', 'fetch first', 'stale info')
  ) {
    return {
      summary: 'Push was rejected because the remote has newer commits.',
      raw,
    };
  }

  if (
    command === 'pull' &&
    has(
      'automatic merge failed',
      'merge conflict',
      'fix conflicts and then commit the result',
      'you have unmerged paths'
    )
  ) {
    return {
      summary: 'Pull stopped because Git found merge conflicts that need manual resolution.',
      raw,
    };
  }

  if (
    (command === 'pull' || command === 'push') &&
    has('there is no tracking information', 'no upstream configured for branch')
  ) {
    return {
      ...(command === 'push' ? { code: 'NO_UPSTREAM' } : {}),
      summary: 'No upstream branch is configured for the current branch.',
      raw,
    };
  }

  if (command === 'commit' && has('nothing to commit', 'no changes added to commit')) {
    return {
      summary: 'Nothing to commit.',
      raw,
    };
  }

  if (command === 'checkout' && has('pathspec', 'did not match any file')) {
    return {
      summary: 'That branch could not be found locally.',
      raw,
    };
  }

  if (has('not a git repository')) {
    return {
      summary: 'This folder is not currently a Git repository.',
      raw,
    };
  }

  if (has('couldn\'t find remote ref', 'remote ref does not exist')) {
    return {
      summary: 'The requested remote branch or ref does not exist.',
      raw,
    };
  }

  return {
    summary: defaultGitErrorSummary(command),
    raw,
  };
}

function finalizeGitResult(args, result) {
  if (result.ok) return result;
  if (result.cancelled) {
    return {
      ...result,
      errorSummary: 'Operation cancelled.',
      errorRaw: combinedGitOutput(result.stdout, result.stderr),
    };
  }
  if (result.timedOut) {
    return {
      ...result,
      errorSummary: 'Git operation timed out.',
      errorRaw: combinedGitOutput(result.stdout, result.stderr),
    };
  }
  const failure = classifyGitFailure(args, result.stdout, result.stderr);
  return {
    ...result,
    ...(failure.code ? { errorCode: failure.code } : {}),
    errorSummary: failure.summary,
    errorRaw: failure.raw,
  };
}

function createGitService({
  defaultTimeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  streamingTimeoutMs = STREAMING_GIT_TIMEOUT_MS,
  spawnImpl = spawn,
  execFileImpl = execFile,
  platform = process.platform,
} = {}) {
  const activeByRepo = new Map();

  function track(cwd, operation) {
    if (!cwd) return;
    const current = activeByRepo.get(cwd) || new Set();
    current.add(operation);
    activeByRepo.set(cwd, current);
  }

  function untrack(cwd, operation) {
    if (!cwd) return;
    const current = activeByRepo.get(cwd);
    if (!current) return;
    current.delete(operation);
    if (current.size === 0) activeByRepo.delete(cwd);
  }

  function terminateProcessTree(child, force = false) {
    if (!child?.pid) return;
    if (platform === 'win32') {
      execFileImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
      return;
    }
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      try {
        child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // The process may have exited between the state check and the signal.
      }
    }
  }

  function runGitProcess(args, cwd, {
    input,
    envOverrides = {},
    onProgress,
    timeoutMs = defaultTimeoutMs,
    cancellable = false,
    liveOutput = false,
  } = {}) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let terminationReason = '';
      let forceKillTimer = null;

      const child = spawnImpl('git', args, {
        cwd,
        env: { ...gitEnv(), ...envOverrides },
        windowsHide: true,
        detached: platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const operation = {
        child,
        cancellable,
        cancel() {
          if (!cancellable || terminationReason || settled) return false;
          terminationReason = 'cancelled';
          terminateProcessTree(child, false);
          forceKillTimer = setTimeout(() => terminateProcessTree(child, true), FORCE_KILL_DELAY_MS);
          forceKillTimer.unref?.();
          return true;
        },
      };
      track(cwd, operation);

      const finish = (code, spawnError = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        untrack(cwd, operation);
        if (spawnError && !stderr) stderr = spawnError.message;
        resolve(finalizeGitResult(args, {
          ok: code === 0 && !terminationReason && !spawnError,
          exitCode: Number.isInteger(code) ? code : null,
          stdout,
          stderr,
          liveOutput,
          cancelled: terminationReason === 'cancelled',
          timedOut: terminationReason === 'timeout',
        }));
      };

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        onProgress?.({ stream: 'stdout', text });
      });
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        onProgress?.({ stream: 'stderr', text });
      });
      child.once('error', (error) => finish(null, error));
      child.once('close', (code) => finish(code));

      if (input !== undefined) {
        child.stdin?.on('error', () => {});
        child.stdin?.end(input);
      } else {
        child.stdin?.end();
      }

      const timeoutTimer = setTimeout(() => {
        if (settled || terminationReason) return;
        terminationReason = 'timeout';
        terminateProcessTree(child, false);
        forceKillTimer = setTimeout(() => terminateProcessTree(child, true), FORCE_KILL_DELAY_MS);
        forceKillTimer.unref?.();
      }, timeoutMs);
      timeoutTimer.unref?.();
    });
  }

  function runGit(args, cwd) {
    return runGitProcess(args, cwd);
  }

  function runGitWithInput(args, cwd, input, envOverrides = {}) {
    return runGitProcess(args, cwd, { input, envOverrides });
  }

  function runGitStreaming(args, cwd, onProgress, {
    timeoutMs = streamingTimeoutMs,
  } = {}) {
    return runGitProcess(args, cwd, {
      onProgress,
      timeoutMs,
      cancellable: true,
      liveOutput: true,
    });
  }

  function cancelRepoOperations(repoPath) {
    const current = activeByRepo.get(repoPath);
    if (!current) return { ok: true, cancelled: 0 };
    let cancelled = 0;
    for (const operation of current) {
      if (operation.cancel()) cancelled += 1;
    }
    return { ok: true, cancelled };
  }

  return {
    runGit,
    runGitWithInput,
    runGitStreaming,
    cancelRepoOperations,
  };
}

module.exports = {
  DEFAULT_GIT_TIMEOUT_MS,
  STREAMING_GIT_TIMEOUT_MS,
  classifyGitFailure,
  combinedGitOutput,
  createGitService,
  finalizeGitResult,
};
