const { app, BrowserWindow, Menu, ipcMain, dialog, nativeImage } = require('electron');

const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createGitService, combinedGitOutput } = require('./git-process');
const { createConfigStore } = require('./config-store');
const { createConfigLocationStore } = require('./config-location');

function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      role: 'editMenu',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

const execFileP = promisify(execFile);
const {
  runGit,
  runGitWithInput,
  runGitStreaming,
  cancelRepoOperations,
} = createGitService();
const userDataPath = app.getPath('userData');
const homePath = app.getPath('home');
const configEnvironmentVariable = 'GIT_SYNC_CONFIG_PATH';
const rawEnvironmentConfigPath = String(process.env[configEnvironmentVariable] || '').trim();
const environmentConfigPath = rawEnvironmentConfigPath.startsWith('~/')
  ? path.join(homePath, rawEnvironmentConfigPath.slice(2))
  : rawEnvironmentConfigPath;
const legacyDefaultConfigPath = path.join(userDataPath, 'config.json');
const configLocationStore = createConfigLocationStore({
  defaultConfigPath: path.join(homePath, 'git_sync_config.json'),
  pointerPath: path.join(userDataPath, 'config-location.json'),
  overrideConfigPath: environmentConfigPath,
  overrideLabel: configEnvironmentVariable,
});
let configLocationReady = null;
const ensureConfigLocation = async () => {
  configLocationReady ||= (async () => {
    await configLocationStore.initialize();
    await configLocationStore.migrateDefaultFrom(legacyDefaultConfigPath);
  })();
  await configLocationReady;
  return await configLocationStore.initialize();
};
const configStore = createConfigStore({ getConfigPath: configLocationStore.getPath });

const APP_REMOTE_ID_PATTERN = /^[a-z0-9_-]{1,80}$/i;
const MANUAL_FETCH_TIMEOUT_MS = 60 * 1000;

function resolveAppRemote(value) {
  if (value == null) return { ok: true, remote: null };
  const id = typeof value?.id === 'string' ? value.id.trim() : '';
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const url = typeof value?.url === 'string' ? value.url.trim() : '';
  if (
    !APP_REMOTE_ID_PATTERN.test(id)
    || !name
    || name.length > 64
    || !url
    || url.length > 4096
    || /[\u0000-\u001f\u007f]/.test(name)
    || /[\u0000-\u001f\u007f]/.test(url)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_APP_REMOTE',
      errorSummary: 'The selected app remote is invalid.',
      errorRaw: '',
    };
  }
  return { ok: true, remote: { id, name, url } };
}

function appRemoteRef(remoteId, branch = '') {
  return `refs/git-sync/remotes/${remoteId}${branch ? `/${branch}` : ''}`;
}

function validateGitRemoteName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  const invalidPart = name.split('/').some((part) => (
    !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')
  ));
  if (
    !name
    || name.length > 255
    || name.startsWith('-')
    || invalidPart
    || name.includes('..')
    || name.includes('@{')
    || /[\s~^:?*[\]\\\u0000-\u001f\u007f]/u.test(name)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_GIT_REMOTE',
      errorSummary: 'The Git remote name is invalid.',
      errorRaw: '',
    };
  }
  return { ok: true, name };
}

function validateRemoteUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url || url.length > 4096 || /[\u0000-\u001f\u007f]/.test(url)) {
    return {
      ok: false,
      errorCode: 'INVALID_REMOTE_URL',
      errorSummary: 'Enter a valid remote URL or local repository path.',
      errorRaw: '',
    };
  }
  return { ok: true, url };
}

async function listGitRemotes(repoPath) {
  const namesResult = await runGit(['remote'], repoPath);
  if (!namesResult.ok) return namesResult;

  const names = namesResult.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const remotes = await Promise.all(names.map(async (name) => {
    const [fetchResult, pushResult, explicitPushResult] = await Promise.all([
      runGit(['remote', 'get-url', '--all', name], repoPath),
      runGit(['remote', 'get-url', '--push', '--all', name], repoPath),
      runGit(['config', '--get-all', `remote.${name}.pushurl`], repoPath),
    ]);
    const urls = fetchResult.ok
      ? fetchResult.stdout.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
      : [];
    const pushUrls = pushResult.ok
      ? pushResult.stdout.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
      : [];
    return {
      name,
      url: urls[0] || '',
      urls,
      pushUrl: pushUrls[0] || '',
      pushUrls,
      hasExplicitPushUrl: explicitPushResult.ok,
    };
  }));
  return { ok: true, remotes };
}

function changedGitRemote(existing, name, url) {
  const urls = existing.urls.map((entry) => entry === existing.url ? url : entry);
  const pushUrls = existing.hasExplicitPushUrl ? existing.pushUrls : urls;
  return {
    ...existing,
    name,
    url,
    urls,
    pushUrl: pushUrls[0] || '',
    pushUrls,
  };
}

function exactGitConfigValuePattern(value) {
  return `^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

async function listLocalGitConfig(repoPath) {
  const result = await runGit(['config', '--local', '--list'], repoPath);
  if (!result.ok) return result;
  const entries = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return separator === -1
        ? { key: line, value: '' }
        : { key: line.slice(0, separator), value: line.slice(separator + 1) };
    });
  return { ok: true, entries };
}

async function renameGitRemoteConfig(repoPath, currentName, nextName) {
  const configResult = await listLocalGitConfig(repoPath);
  if (!configResult.ok) return configResult;

  const currentPrefix = remoteTrackingPrefix(currentName);
  const nextPrefix = remoteTrackingPrefix(nextName);
  const currentFetchKey = `remote.${currentName}.fetch`.toLowerCase();
  const nextFetchKey = `remote.${nextName}.fetch`;
  const updates = [];
  const seenUpdates = new Set();
  for (const entry of configResult.entries) {
    const key = entry.key.toLowerCase();
    let update = null;
    if (key === currentFetchKey && entry.value.includes(currentPrefix)) {
      update = {
        key: nextFetchKey,
        previousValue: entry.value,
        nextValue: entry.value.split(currentPrefix).join(nextPrefix),
      };
    } else if (
      entry.value === currentName
      && (
        key === 'remote.pushdefault'
        || (
          key.startsWith('branch.')
          && (key.endsWith('.remote') || key.endsWith('.pushremote'))
        )
      )
    ) {
      update = {
        key: entry.key,
        previousValue: currentName,
        nextValue: nextName,
      };
    }
    if (!update) continue;
    const signature = `${update.key}\0${update.previousValue}\0${update.nextValue}`;
    if (seenUpdates.has(signature)) continue;
    seenUpdates.add(signature);
    updates.push(update);
  }

  const renamedSection = await runGit(
    ['config', '--local', '--rename-section', `remote.${currentName}`, `remote.${nextName}`],
    repoPath
  );
  if (!renamedSection.ok) {
    renamedSection.errorSummary = `Could not rename ${currentName} to ${nextName}.`;
    return renamedSection;
  }

  const applied = [];
  for (const update of updates) {
    const result = await runGit(
      [
        'config',
        '--local',
        '--replace-all',
        update.key,
        update.nextValue,
        exactGitConfigValuePattern(update.previousValue),
      ],
      repoPath
    );
    if (result.ok) {
      applied.push(update);
      continue;
    }

    const rollbackFailures = [];
    for (const completed of [...applied].reverse()) {
      const restored = await runGit(
        [
          'config',
          '--local',
          '--replace-all',
          completed.key,
          completed.previousValue,
          exactGitConfigValuePattern(completed.nextValue),
        ],
        repoPath
      );
      if (!restored.ok) rollbackFailures.push(restored.errorRaw || restored.errorSummary);
    }
    const restoredSection = await runGit(
      ['config', '--local', '--rename-section', `remote.${nextName}`, `remote.${currentName}`],
      repoPath
    );
    if (!restoredSection.ok) {
      rollbackFailures.push(restoredSection.errorRaw || restoredSection.errorSummary);
    }
    return {
      ...result,
      errorSummary: rollbackFailures.length
        ? `Could not rename ${currentName} to ${nextName}, and the config could not be fully restored.`
        : `Could not rename ${currentName} to ${nextName}. The previous config was restored.`,
      errorRaw: [result.errorRaw, ...rollbackFailures].filter(Boolean).join('\n'),
    };
  }
  return { ok: true, reusedTrackingRefs: true };
}

function remoteTrackingPrefix(remoteName) {
  return `refs/remotes/${remoteName}/`;
}

async function listRemoteTrackingRefs(repoPath, remoteName) {
  const result = await runGit(
    [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(symref)',
      remoteTrackingPrefix(remoteName),
    ],
    repoPath
  );
  if (!result.ok) return result;

  const refs = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = '', objectId = '', symbolicTarget = ''] = line.split('\0');
      return { name, objectId, symbolicTarget };
    })
    .filter((ref) => ref.name && ref.objectId);
  return { ok: true, refs };
}

function remoteRefMoves(refs, currentName, nextName) {
  const currentPrefix = remoteTrackingPrefix(currentName);
  const nextPrefix = remoteTrackingPrefix(nextName);
  return refs.map((ref) => ({
    ...ref,
    nextName: `${nextPrefix}${ref.name.slice(currentPrefix.length)}`,
    nextSymbolicTarget: ref.symbolicTarget.startsWith(currentPrefix)
      ? `${nextPrefix}${ref.symbolicTarget.slice(currentPrefix.length)}`
      : ref.symbolicTarget,
  }));
}

async function moveDirectRemoteRefs(repoPath, moves, reverse = false) {
  const directMoves = moves.filter((move) => !move.symbolicTarget);
  if (!directMoves.length) return { ok: true };

  const commands = directMoves.flatMap((move) => {
    const source = reverse ? move.nextName : move.name;
    const target = reverse ? move.name : move.nextName;
    return [
      `create ${target} ${move.objectId}`,
      `delete ${source} ${move.objectId}`,
    ];
  });
  return await runGitWithInput(
    ['update-ref', '--stdin'],
    repoPath,
    `${commands.join('\n')}\n`
  );
}

async function moveSymbolicRemoteRefs(repoPath, moves, reverse = false) {
  const symbolicMoves = moves.filter((move) => move.symbolicTarget);
  const completed = [];
  for (const move of symbolicMoves) {
    const source = reverse ? move.nextName : move.name;
    const target = reverse ? move.name : move.nextName;
    const symbolicTarget = reverse ? move.symbolicTarget : move.nextSymbolicTarget;
    const created = await runGit(['symbolic-ref', target, symbolicTarget], repoPath);
    if (!created.ok) return { ...created, completed };
    const removed = await runGit(['symbolic-ref', '--delete', source], repoPath);
    if (!removed.ok) {
      await runGit(['symbolic-ref', '--delete', target], repoPath);
      return { ...removed, completed };
    }
    completed.push(move);
  }
  return { ok: true, completed };
}

async function rollbackRemoteRefMoves(repoPath, moves, symbolicMoves = []) {
  const failures = [];
  for (const move of [...symbolicMoves].reverse()) {
    const restored = await runGit(
      ['symbolic-ref', move.name, move.symbolicTarget],
      repoPath
    );
    if (!restored.ok) failures.push(restored.errorRaw || restored.errorSummary);
    const removed = await runGit(['symbolic-ref', '--delete', move.nextName], repoPath);
    if (!removed.ok) failures.push(removed.errorRaw || removed.errorSummary);
  }
  const direct = await moveDirectRemoteRefs(repoPath, moves, true);
  if (!direct.ok) failures.push(direct.errorRaw || direct.errorSummary);
  return failures.filter(Boolean);
}

async function moveRemoteTrackingRefs(repoPath, currentName, nextName) {
  const currentPrefix = remoteTrackingPrefix(currentName);
  const nextPrefix = remoteTrackingPrefix(nextName);
  if (currentPrefix.startsWith(nextPrefix) || nextPrefix.startsWith(currentPrefix)) {
    return {
      ok: false,
      fallback: true,
      errorSummary: 'Nested remote names require the standard Git rename path.',
      errorRaw: '',
    };
  }

  const [sourceResult, targetResult] = await Promise.all([
    listRemoteTrackingRefs(repoPath, currentName),
    listRemoteTrackingRefs(repoPath, nextName),
  ]);
  if (!sourceResult.ok) return sourceResult;
  if (!targetResult.ok) return targetResult;
  if (targetResult.refs.length) {
    return {
      ok: true,
      reuseTarget: true,
    };
  }

  const moves = remoteRefMoves(sourceResult.refs, currentName, nextName);
  const direct = await moveDirectRemoteRefs(repoPath, moves);
  if (!direct.ok) return direct;

  const symbolic = await moveSymbolicRemoteRefs(repoPath, moves);
  if (!symbolic.ok) {
    const rollbackFailures = await rollbackRemoteRefMoves(
      repoPath,
      moves,
      symbolic.completed
    );
    return {
      ...symbolic,
      errorSummary: rollbackFailures.length
        ? 'Could not move remote-tracking refs, and they could not be fully restored.'
        : 'Could not move remote-tracking refs. The previous refs were restored.',
      errorRaw: [symbolic.errorRaw, ...rollbackFailures].filter(Boolean).join('\n'),
    };
  }
  return { ok: true, moves };
}

async function renameGitRemoteFast(repoPath, currentName, nextName) {
  const moved = await moveRemoteTrackingRefs(repoPath, currentName, nextName);
  if (moved.fallback) {
    return await runGit(['remote', 'rename', currentName, nextName], repoPath);
  }
  if (!moved.ok) return moved;
  if (moved.reuseTarget) {
    return await renameGitRemoteConfig(repoPath, currentName, nextName);
  }

  // Git now has no refs left under the old namespace, so it can update every
  // relevant config key without walking hundreds of refs one by one.
  const renamed = await runGit(['remote', 'rename', currentName, nextName], repoPath);
  if (renamed.ok) return renamed;

  const rollbackFailures = await rollbackRemoteRefMoves(
    repoPath,
    moved.moves,
    moved.moves.filter((move) => move.symbolicTarget)
  );
  return {
    ...renamed,
    errorSummary: rollbackFailures.length
      ? `Could not rename ${currentName} to ${nextName}, and the refs could not be fully restored.`
      : `Could not rename ${currentName} to ${nextName}. The previous refs were restored.`,
    errorRaw: [renamed.errorRaw, ...rollbackFailures].filter(Boolean).join('\n'),
  };
}

function sendGitProgress(event, repoPath, payload) {
  event?.sender?.send('git-progress', { repoPath, ...payload });
}

async function currentBranch(repoPath) {
  const result = await runGit(['branch', '--show-current'], repoPath);
  if (!result.ok) return result;
  const branch = result.stdout.trim();
  if (!branch) {
    return {
      ok: false,
      errorCode: 'DETACHED_HEAD',
      errorSummary: 'Check out a local branch before using an app remote.',
      errorRaw: '',
    };
  }
  return { ok: true, branch };
}

async function resolveCurrentBranchGitRemote(repoPath) {
  const branchResult = await currentBranch(repoPath);
  if (!branchResult.ok) return branchResult;

  const remotesResult = await listGitRemotes(repoPath);
  if (!remotesResult.ok) return remotesResult;
  const names = remotesResult.remotes.map((remote) => remote.name);
  const configuredResult = await runGit(
    ['config', '--get', `branch.${branchResult.branch}.remote`],
    repoPath
  );
  const configured = configuredResult.ok ? configuredResult.stdout.trim() : '';
  const remoteName = names.includes(configured)
    ? configured
    : names.includes('origin')
      ? 'origin'
      : names.length === 1
        ? names[0]
        : '';

  if (!remoteName) {
    return {
      ok: false,
      errorCode: 'AMBIGUOUS_REMOTE',
      errorSummary: names.length
        ? 'Select a remote before fetching this branch.'
        : 'Add a Git remote before fetching this branch.',
      errorRaw: names.length ? `Available remotes: ${names.join(', ')}` : '',
    };
  }

  return {
    ok: true,
    branch: branchResult.branch,
    remote: remotesResult.remotes.find((remote) => remote.name === remoteName),
  };
}

function fetchGitRemoteBranch(event, repoPath, remoteName, branch, timeoutMs) {
  return runGitStreaming(
    [
      'fetch',
      '--no-tags',
      remoteName,
      `+refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`,
    ],
    repoPath,
    (payload) => sendGitProgress(event, repoPath, payload),
    timeoutMs ? { timeoutMs } : undefined
  );
}

function fetchAppRemote(event, repoPath, remote, branch, timeoutMs) {
  return runGitStreaming(
    [
      'fetch',
      '--no-tags',
      '--',
      remote.url,
      `+refs/heads/${branch}:${appRemoteRef(remote.id, branch)}`,
    ],
    repoPath,
    (payload) => sendGitProgress(event, repoPath, payload),
    timeoutMs ? { timeoutMs } : undefined
  );
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function createWindow() {
  const config = await loadConfig();
  const saved = config.window || {};
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width:  saved.width  || 820,
    height: saved.height || 500,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    frame: false,
    ...(!isMac ? { titleBarStyle: 'hidden' } : {}),
    ...(!isMac && !app.isPackaged ? { icon: path.join(app.getAppPath(), 'build/icon.png') } : {}),
    backgroundColor: '#ede9fe',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const saveBounds = debounce(() => {
    if (win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    updateConfig((cfg) => {
      cfg.window = { width: b.width, height: b.height, x: b.x, y: b.y };
    });
  }, 400);

  win.on('resize', saveBounds);
  win.on('move',   saveBounds);

  if (isMac) {
    win.setWindowButtonVisibility(false);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// Single-instance lock — production only so local dev reloads stay friction-free.
if (app.isPackaged) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }
}

app.whenReady().then(() => {
  installApplicationMenu();
  // Packaged builds get the icon from the bundle; dev runs need it set explicitly.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const iconPath = path.resolve(__dirname, '../../resources/icon-dock.png');
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function openInFileManager(repoPath) {
  if (process.platform === 'win32') {
    await execFileP('explorer.exe', [repoPath]);
    return { ok: true };
  }
  if (process.platform === 'darwin') {
    await execFileP('open', [repoPath]);
    return { ok: true };
  }
  await execFileP('xdg-open', [repoPath]);
  return { ok: true };
}

async function openInTerminal(repoPath) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], {
        cwd: repoPath, detached: true, stdio: 'ignore',
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      execFile('open', ['-a', 'Terminal', repoPath]);
    } else {
      for (const t of ['gnome-terminal', 'konsole', 'xfce4-terminal', 'x-terminal-emulator', 'xterm']) {
        const ch = spawn(t, [], { cwd: repoPath, detached: true, stdio: 'ignore' });
        ch.on('error', () => {});
        ch.unref();
        break;
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function openWithApp(repoPath, appName, linuxCommand = null) {
  try {
    if (process.platform === 'darwin') {
      await execFileP('open', ['-a', appName, repoPath]);
      return { ok: true };
    }

    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', appName, repoPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { ok: true };
    }

    if (!linuxCommand) {
      return { ok: false, error: `${appName} is not supported on this platform` };
    }

    const child = spawn(linuxCommand, [repoPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function openProjectTarget(repoPath, target) {
  switch (target) {
    case 'terminal':
      return await openInTerminal(repoPath);
    case 'finder':
      return await openInFileManager(repoPath);
    case 'vscode':
      return await openWithApp(repoPath, 'Visual Studio Code', 'code');
    case 'sourcetree':
      return await openWithApp(repoPath, 'Sourcetree');
    case 'antigravity':
      return await openWithApp(repoPath, 'Antigravity');
    default:
      return { ok: false, error: `Unknown open target: ${target}` };
  }
}

async function loadConfig(options) {
  await ensureConfigLocation();
  return configStore.load(options);
}

async function updateConfig(mutator) {
  await ensureConfigLocation();
  return configStore.update(mutator);
}

ipcMain.handle('load-config', () => loadConfig({ reportRecovery: true }));
ipcMain.handle('save-config', (_, config) => {
  return updateConfig((cfg) => { Object.assign(cfg, config); });
});

ipcMain.handle('get-config-location', async () => {
  return await ensureConfigLocation();
});

ipcMain.handle('pick-config-file', async (event) => {
  await ensureConfigLocation();
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose Git Sync configuration',
    defaultPath: path.dirname(configLocationStore.getPath()),
    properties: ['openFile'],
    filters: [
      { name: 'JSON configuration', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('set-config-location', async (_, configPath) => {
  await ensureConfigLocation();
  await updateConfig(() => {});
  return await configLocationStore.setPath(configPath);
});

ipcMain.handle('reset-config-location', async () => {
  await ensureConfigLocation();
  await updateConfig(() => {});
  return await configLocationStore.reset();
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('get-branches', async (_, repoPath, appRemoteValue = null) => {
  // Distinguish a deleted/missing folder from a folder that simply isn't a repo,
  // so the UI can grey out and offer to remove projects whose path is gone.
  try {
    const st = await fs.stat(repoPath);
    if (!st.isDirectory()) return { ok: false, error: 'Folder not found', missing: true };
  } catch {
    return { ok: false, error: 'Folder not found', missing: true };
  }

  const check = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  if (!check.ok) {
    return {
      ok: false,
      error: check.errorCode === 'UNSAFE_REPOSITORY'
        ? `Git does not trust the owner of "${repoPath}". Add this folder to Git safe.directory, then try again.`
        : (check.errorSummary || 'Could not inspect this Git repository.'),
      errorCode: check.errorCode || '',
      rawError: check.errorRaw || '',
    };
  }

  const branches = await runGit(
    ['branch', '--list', '--format=%(refname:short)'],
    repoPath
  );
  if (!branches.ok) return { ok: false, error: branches.stderr };

  const remoteBranches = await runGit(
    ['for-each-ref', '--format=%(refname:short)%09%(symref)', 'refs/remotes'],
    repoPath
  );

  const current = await runGit(['branch', '--show-current'], repoPath);
  const upstream = await runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    repoPath
  );
  const appRemoteResult = resolveAppRemote(appRemoteValue);
  if (!appRemoteResult.ok) return appRemoteResult;
  const appRemote = appRemoteResult.remote;
  const currentName = current.stdout.trim();
  const configuredRemoteResult = currentName
    ? await runGit(['config', '--get', `branch.${currentName}.remote`], repoPath)
    : null;
  const configuredRemoteName = configuredRemoteResult?.ok
    ? configuredRemoteResult.stdout.trim()
    : null;
  const gitRemotesResult = await listGitRemotes(repoPath);
  const gitRemotes = gitRemotesResult.ok ? gitRemotesResult.remotes : [];
  const remoteNames = gitRemotes.map((remote) => remote.name);
  const configuredRemote = remoteNames.includes(configuredRemoteName)
    ? configuredRemoteName
    : null;
  const defaultRemote = configuredRemote
    || (remoteNames.includes('origin') ? 'origin' : null)
    || (remoteNames.length === 1 ? remoteNames[0] : null);
  const configuredRemoteUrl = configuredRemote
    ? gitRemotes.find((remote) => remote.name === configuredRemote)?.url || null
    : null;
  const comparisonRef = appRemote && currentName
    ? appRemoteRef(appRemote.id, currentName)
    : '@{u}';
  const comparisonExists = appRemote
    ? await runGit(['rev-parse', '--verify', comparisonRef], repoPath)
    : upstream;
  const ahead = comparisonExists.ok
    ? await runGit(['rev-list', '--count', `${comparisonRef}..HEAD`], repoPath)
    : null;
  const behind = comparisonExists.ok
    ? await runGit(['rev-list', '--count', `HEAD..${comparisonRef}`], repoPath)
    : null;
  const status  = await runGit(['status', '--porcelain'], repoPath);
  const uncommitted = status.ok
    ? status.stdout.split('\n').map((s) => s.trim()).filter(Boolean).length
    : 0;

  return {
    ok: true,
    branches: branches.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
    remoteBranches: remoteBranches.ok
      ? remoteBranches.stdout
          .split('\n')
          .map((line) => line.split('\t'))
          .filter(([name, symref]) => name?.trim() && !symref?.trim())
          .map(([name]) => name.trim())
      : [],
    gitRemotes,
    current:  currentName,
    hasUpstream: upstream.ok,
    upstream: upstream.ok ? upstream.stdout.trim() : null,
    hasRemoteBranch: appRemote ? comparisonExists.ok : null,
    configuredRemote,
    defaultRemote,
    configuredRemoteUrl,
    ahead:    ahead?.ok  ? (parseInt(ahead.stdout.trim())  || 0) : null,
    behind:   behind?.ok ? (parseInt(behind.stdout.trim()) || 0) : null,
    uncommitted,
  };
});

ipcMain.handle('fetch', async (event, repoPath, appRemoteValue = null) => {
  const appRemoteResult = resolveAppRemote(appRemoteValue);
  if (!appRemoteResult.ok) return appRemoteResult;
  if (appRemoteResult.remote) {
    const branchResult = await currentBranch(repoPath);
    if (!branchResult.ok) return branchResult;
    return await fetchAppRemote(
      event,
      repoPath,
      appRemoteResult.remote,
      branchResult.branch,
      MANUAL_FETCH_TIMEOUT_MS
    );
  }
  const target = await resolveCurrentBranchGitRemote(repoPath);
  if (!target.ok) return target;
  return await fetchGitRemoteBranch(
    event,
    repoPath,
    target.remote.name,
    target.branch,
    MANUAL_FETCH_TIMEOUT_MS
  );
});

ipcMain.handle('get-git-remotes', async (_, repoPath) => {
  return await listGitRemotes(repoPath);
});

ipcMain.handle('change-git-remote', async (
  _,
  repoPath,
  currentNameValue,
  nextNameValue,
  urlValue
) => {
  const currentName = validateGitRemoteName(currentNameValue);
  if (!currentName.ok) return currentName;
  const nextName = validateGitRemoteName(nextNameValue);
  if (!nextName.ok) return nextName;
  const remoteUrl = validateRemoteUrl(urlValue);
  if (!remoteUrl.ok) return remoteUrl;

  const remotesResult = await listGitRemotes(repoPath);
  if (!remotesResult.ok) return remotesResult;
  const existing = remotesResult.remotes.find((remote) => remote.name === currentName.name);
  if (!existing) {
    return {
      ok: false,
      errorCode: 'GIT_REMOTE_NOT_FOUND',
      errorSummary: `Remote ${currentName.name} no longer exists.`,
      errorRaw: '',
    };
  }
  const nameChanged = currentName.name !== nextName.name;
  const urlChanged = existing.url !== remoteUrl.url;
  if (nameChanged && remotesResult.remotes.some((remote) => remote.name === nextName.name)) {
    return {
      ok: false,
      errorCode: 'GIT_REMOTE_ALREADY_EXISTS',
      errorSummary: `Remote ${nextName.name} already exists. Select it as the target or use another name.`,
      errorRaw: '',
    };
  }
  if (!nameChanged && !urlChanged) {
    return {
      ok: true,
      unchanged: true,
      renamed: false,
      remote: existing,
      previousName: existing.name,
      previousUrl: existing.url,
    };
  }

  let activeName = currentName.name;
  if (nameChanged) {
    const renamed = await renameGitRemoteFast(repoPath, currentName.name, nextName.name);
    if (!renamed.ok) return renamed;
    activeName = nextName.name;
  }

  if (urlChanged) {
    // Replace only the current primary URL and preserve secondary fetch URLs.
    const updated = await runGit(
      [
        'config',
        '--local',
        '--replace-all',
        `remote.${activeName}.url`,
        remoteUrl.url,
        exactGitConfigValuePattern(existing.url),
      ],
      repoPath
    );
    if (!updated.ok) {
      if (!nameChanged) {
        updated.errorSummary = `Could not update ${activeName}.`;
        return updated;
      }
      const restored = await renameGitRemoteFast(
        repoPath,
        activeName,
        currentName.name
      );
      return {
        ...updated,
        errorSummary: restored.ok
          ? `Could not update ${activeName}. The previous remote was restored.`
          : `Could not update ${activeName}, and the previous remote could not be fully restored.`,
        errorRaw: [updated.errorRaw, restored.errorRaw].filter(Boolean).join('\n'),
      };
    }
  }

  return {
    ok: true,
    renamed: nameChanged,
    remote: changedGitRemote(existing, nextName.name, remoteUrl.url),
    previousName: existing.name,
    previousUrl: existing.url,
  };
});

ipcMain.handle('git-status', async (_, repoPath) => {
  // Porcelain output is one line per changed file (staged, unstaged, or untracked).
  const [res, headSubject] = await Promise.all([
    runGit(['status', '--porcelain'], repoPath),
    runGit(['log', '-1', '--format=%s', 'HEAD'], repoPath),
  ]);
  if (!res.ok) {
    return {
      ok: false,
      error: res.errorSummary || res.stderr,
      rawError: res.errorRaw || combinedGitOutput(res.stdout, res.stderr),
    };
  }
  const lines = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return {
    ok: true,
    changedCount: lines.length,
    changes: lines,
    hasHead: headSubject.ok,
    headMessage: headSubject.ok ? headSubject.stdout.trim() : '',
  };
});

ipcMain.handle('git-commit-all', async (_, repoPath, message, amend = false) => {
  let previousMessage = '';
  if (amend) {
    const [head, messageResult] = await Promise.all([
      runGit(['rev-parse', '--verify', 'HEAD'], repoPath),
      runGit(['log', '-1', '--format=%B', 'HEAD'], repoPath),
    ]);
    if (!head.ok) {
      return {
        ok: false,
        errorSummary: 'There is no previous commit to amend.',
        errorRaw: head.errorRaw,
      };
    }
    if (!messageResult.ok) {
      return {
        ok: false,
        errorSummary: 'Could not read the previous commit message.',
        errorRaw: messageResult.errorRaw,
      };
    }
    previousMessage = messageResult.stdout.replace(/\n+$/, '');
  }
  const add = await runGit(['add', '-A'], repoPath);
  if (!add.ok) return { ok: false, stdout: add.stdout, stderr: add.stderr };
  if (amend) {
    const messageLines = previousMessage.split('\n');
    messageLines[0] = message || messageLines[0] || 'Quick commit';
    return await runGitWithInput(['commit', '--amend', '-F', '-'], repoPath, messageLines.join('\n'));
  }
  const args = ['commit'];
  args.push('-m', message || 'Quick commit');
  const commit = await runGit(args, repoPath);
  return commit;
});

ipcMain.handle('checkout', async (_, repoPath, branch) => {
  return await runGit(['checkout', branch], repoPath);
});

ipcMain.handle('checkout-remote-branch', async (_, repoPath, remoteBranchValue) => {
  const remoteBranch = typeof remoteBranchValue === 'string'
    ? remoteBranchValue.trim()
    : '';
  if (!remoteBranch || remoteBranch.length > 1024 || /[\u0000-\u001f\u007f]/.test(remoteBranch)) {
    return {
      ok: false,
      errorCode: 'INVALID_REMOTE_BRANCH',
      errorSummary: 'The remote branch name is invalid.',
      errorRaw: '',
    };
  }

  const remotesResult = await listGitRemotes(repoPath);
  if (!remotesResult.ok) return remotesResult;
  const remote = remotesResult.remotes
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((entry) => remoteBranch.startsWith(`${entry.name}/`));
  const localBranch = remote ? remoteBranch.slice(remote.name.length + 1) : '';
  if (!remote || !localBranch || localBranch === 'HEAD') {
    return {
      ok: false,
      errorCode: 'REMOTE_BRANCH_NOT_FOUND',
      errorSummary: `Remote branch ${remoteBranch || '(empty)'} no longer exists.`,
      errorRaw: '',
    };
  }

  const validLocalName = await runGit(['check-ref-format', '--branch', localBranch], repoPath);
  if (!validLocalName.ok) {
    return {
      ok: false,
      errorCode: 'INVALID_REMOTE_BRANCH',
      errorSummary: 'The remote branch name is invalid.',
      errorRaw: validLocalName.errorRaw,
    };
  }

  const remoteRef = `refs/remotes/${remoteBranch}`;
  const exists = await runGit(['show-ref', '--verify', remoteRef], repoPath);
  if (!exists.ok) {
    return {
      ok: false,
      errorCode: 'REMOTE_BRANCH_NOT_FOUND',
      errorSummary: `Remote branch ${remoteBranch} no longer exists.`,
      errorRaw: exists.errorRaw,
    };
  }

  const localExists = await runGit(
    ['show-ref', '--verify', `refs/heads/${localBranch}`],
    repoPath
  );
  let created = false;
  if (!localExists.ok) {
    const createResult = await runGit(
      ['branch', '--track', localBranch, remoteBranch],
      repoPath
    );
    if (!createResult.ok) {
      const createdDespiteError = await runGit(
        ['show-ref', '--verify', `refs/heads/${localBranch}`],
        repoPath
      );
      if (!createdDespiteError.ok) {
        createResult.errorSummary = `Could not create ${localBranch} from ${remoteBranch}.`;
        return createResult;
      }
    } else {
      created = true;
    }
  }

  const checkedOut = await runGit(['checkout', localBranch], repoPath);
  if (!checkedOut.ok) {
    checkedOut.errorSummary = created
      ? `${localBranch} was created, but Git could not check it out.`
      : `Could not switch to ${localBranch}.`;
    return checkedOut;
  }

  const currentResult = await currentBranch(repoPath);
  if (!currentResult.ok || currentResult.branch !== localBranch) {
    return {
      ok: false,
      errorCode: 'CHECKOUT_VERIFY_FAILED',
      errorSummary: `Git did not switch to ${localBranch}.`,
      errorRaw: currentResult.errorRaw || '',
    };
  }
  return {
    ...checkedOut,
    branch: localBranch,
    remoteBranch,
    created,
  };
});

ipcMain.handle('create-branch', async (_, repoPath, branch) => {
  const name = typeof branch === 'string' ? branch.trim() : '';
  if (!name) {
    return { ok: false, errorSummary: 'Enter a branch name.', errorRaw: '' };
  }

  const validName = await runGit(['check-ref-format', '--branch', name], repoPath);
  if (!validName.ok) {
    return {
      ok: false,
      errorSummary: 'Enter a valid Git branch name.',
      errorRaw: validName.errorRaw,
    };
  }

  const created = await runGit(['checkout', '-b', name], repoPath);
  if (
    !created.ok
    && String(created.errorRaw || '').toLowerCase().includes('already exists')
  ) {
    created.errorSummary = 'A branch with that name already exists.';
  }
  return created;
});

ipcMain.handle('pull', async (event, repoPath, appRemoteValue = null) => {
  const appRemoteResult = resolveAppRemote(appRemoteValue);
  if (!appRemoteResult.ok) return appRemoteResult;
  if (appRemoteResult.remote) {
    const branchResult = await currentBranch(repoPath);
    if (!branchResult.ok) return branchResult;
    const fetched = await fetchAppRemote(
      event,
      repoPath,
      appRemoteResult.remote,
      branchResult.branch
    );
    if (!fetched.ok) return fetched;

    const remoteRef = appRemoteRef(appRemoteResult.remote.id, branchResult.branch);
    const exists = await runGit(['rev-parse', '--verify', remoteRef], repoPath);
    if (!exists.ok) {
      return {
        ok: false,
        errorCode: 'REMOTE_BRANCH_MISSING',
        errorSummary: `Remote ${appRemoteResult.remote.name} has no ${branchResult.branch} branch.`,
        errorRaw: exists.errorRaw,
      };
    }

    const merged = await runGitStreaming(['merge', '--ff-only', remoteRef], repoPath, (payload) => {
      sendGitProgress(event, repoPath, payload);
    });
    if (!merged.ok && /fast-forward|diverg/i.test(merged.errorRaw || '')) {
      merged.errorSummary = 'Fast-forward pull is not possible because the local and remote branches have diverged.';
      merged.errorCode = 'FF_ONLY_REQUIRED';
    }
    return merged;
  }
  return await runGitStreaming(['pull'], repoPath, (payload) => {
    sendGitProgress(event, repoPath, payload);
  });
});

ipcMain.handle('push', async (event, repoPath, appRemoteValue = null) => {
  const appRemoteResult = resolveAppRemote(appRemoteValue);
  if (!appRemoteResult.ok) return appRemoteResult;
  if (appRemoteResult.remote) {
    const branchResult = await currentBranch(repoPath);
    if (!branchResult.ok) return branchResult;
    const branchRef = `refs/heads/${branchResult.branch}`;
    const result = await runGitStreaming(
      ['push', '--', appRemoteResult.remote.url, `${branchRef}:${branchRef}`],
      repoPath,
      (payload) => sendGitProgress(event, repoPath, payload)
    );
    if (result.ok) {
      await runGit(['update-ref', appRemoteRef(appRemoteResult.remote.id, branchResult.branch), 'HEAD'], repoPath);
    }
    return result;
  }
  return await runGitStreaming(['push'], repoPath, (payload) => {
    sendGitProgress(event, repoPath, payload);
  });
});

ipcMain.handle('test-app-remote', async (_, repoPath, appRemoteValue) => {
  const appRemoteResult = resolveAppRemote(appRemoteValue);
  if (!appRemoteResult.ok || !appRemoteResult.remote) return appRemoteResult;
  const result = await runGit(['ls-remote', '--heads', '--', appRemoteResult.remote.url], repoPath);
  if (!result.ok) result.errorSummary = `Could not connect to ${appRemoteResult.remote.name}.`;
  return result;
});

ipcMain.handle('clear-app-remote', async (_, repoPath, remoteId) => {
  if (!APP_REMOTE_ID_PATTERN.test(String(remoteId || ''))) {
    return { ok: false, errorSummary: 'The app remote ID is invalid.', errorRaw: '' };
  }
  const prefix = `${appRemoteRef(remoteId)}/`;
  const refs = await runGit(['for-each-ref', '--format=%(refname)', prefix], repoPath);
  if (!refs.ok) return refs;
  for (const ref of refs.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const removed = await runGit(['update-ref', '-d', ref], repoPath);
    if (!removed.ok) return removed;
  }
  return { ok: true, removed: refs.stdout.split(/\r?\n/).filter(Boolean).length };
});

async function resolvePushSetupTarget(repoPath) {
  const [branchResult, remotesResult] = await Promise.all([
    runGit(['branch', '--show-current'], repoPath),
    runGit(['remote'], repoPath),
  ]);
  if (!branchResult.ok) return branchResult;
  if (!remotesResult.ok) return remotesResult;

  const branch = branchResult.stdout.trim();
  if (!branch) {
    return {
      ok: false,
      errorCode: 'DETACHED_HEAD',
      errorSummary: 'Check out a local branch before setting an upstream.',
      errorRaw: '',
    };
  }

  const remotes = remotesResult.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!remotes.length) {
    return {
      ok: false,
      errorCode: 'NO_REMOTE',
      errorSummary: 'Add a Git remote before setting an upstream branch.',
      errorRaw: '',
    };
  }

  const configKeys = [
    `branch.${branch}.pushRemote`,
    'remote.pushDefault',
    `branch.${branch}.remote`,
  ];
  const configured = await Promise.all(configKeys.map((key) => runGit(['config', '--get', key], repoPath)));
  const preferred = configured
    .filter((result) => result.ok)
    .map((result) => result.stdout.trim())
    .find((remote) => remotes.includes(remote));
  const remote = preferred || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : '');

  if (!remote) {
    return {
      ok: false,
      errorCode: 'AMBIGUOUS_REMOTE',
      errorSummary: 'Choose a default push remote before setting an upstream branch.',
      errorRaw: `Available remotes: ${remotes.join(', ')}`,
    };
  }

  return { ok: true, branch, remote };
}

ipcMain.handle('push-set-upstream', async (event, repoPath) => {
  const target = await resolvePushSetupTarget(repoPath);
  if (!target.ok) return target;
  const result = await runGitStreaming(
    ['push', '--set-upstream', target.remote, target.branch],
    repoPath,
    (payload) => event.sender.send('git-progress', { repoPath, ...payload })
  );
  return { ...result, branch: target.branch, remote: target.remote };
});

ipcMain.handle('cancel-git', (_, repoPath) => cancelRepoOperations(repoPath));

ipcMain.handle('confirm-dialog', async (e, { message, detail }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Remove Project',
    message,
    detail,
  });
  return response === 0;
});

// ── Commit Tool ──────────────────────────────────────────────────────────────
// Metadata rewrites are built with commit-tree and published with one
// compare-and-swap update-ref. Until update-ref succeeds, the current branch is
// untouched; partially created commit objects are unreachable and harmless.
const COMMIT_RECORD_SEP = '\x1e';
const COMMIT_FIELD_SEP = '\x1f';
const commitRewriteLocks = new Set();

function validCommitId(value) {
  return /^[0-9a-f]{7,40}$/i.test(String(value || ''));
}

function validIdentityValue(value) {
  const text = String(value || '').trim();
  return text && !/[\r\n\0]/.test(text);
}

async function readGlobalGitIdentity() {
  const [name, email] = await Promise.all([
    runGit(['config', '--global', '--get', 'user.name']),
    runGit(['config', '--global', '--get', 'user.email']),
  ]);
  return {
    ok: true,
    name: name.ok ? name.stdout.trim() : '',
    email: email.ok ? email.stdout.trim() : '',
  };
}

async function saveGlobalGitIdentity({ name, email } = {}) {
  name = String(name || '').trim();
  email = String(email || '').trim();
  if (!validIdentityValue(name) || !validIdentityValue(email)) {
    return { ok: false, error: 'Name and email are required and must each fit on one line.' };
  }

  const previous = await readGlobalGitIdentity();
  const setName = await runGit(['config', '--global', 'user.name', name]);
  if (!setName.ok) {
    return { ok: false, error: setName.errorSummary || 'Could not update the global Git name.', raw: setName.errorRaw };
  }

  const setEmail = await runGit(['config', '--global', 'user.email', email]);
  if (!setEmail.ok) {
    if (previous.name) await runGit(['config', '--global', 'user.name', previous.name]);
    else await runGit(['config', '--global', '--unset-all', 'user.name']);
    return { ok: false, error: setEmail.errorSummary || 'Could not update the global Git email.', raw: setEmail.errorRaw };
  }
  return { ok: true, name, email };
}

async function readProjectGitIdentity(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.trim()) {
    return { ok: false, error: 'Select a Git project first.' };
  }

  const check = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  if (!check.ok) {
    return {
      ok: false,
      error: 'The selected folder is not a Git repository.',
      raw: check.errorRaw,
    };
  }

  const [localName, localEmail, effectiveName, effectiveEmail] = await Promise.all([
    runGit(['config', '--local', '--get', 'user.name'], repoPath),
    runGit(['config', '--local', '--get', 'user.email'], repoPath),
    runGit(['config', '--get', 'user.name'], repoPath),
    runGit(['config', '--get', 'user.email'], repoPath),
  ]);
  return {
    ok: true,
    scope: 'project',
    name: localName.ok ? localName.stdout.trim() : '',
    email: localEmail.ok ? localEmail.stdout.trim() : '',
    effectiveName: effectiveName.ok ? effectiveName.stdout.trim() : '',
    effectiveEmail: effectiveEmail.ok ? effectiveEmail.stdout.trim() : '',
    hasNameOverride: localName.ok,
    hasEmailOverride: localEmail.ok,
  };
}

async function restoreProjectIdentityValue(repoPath, key, value, hadOverride) {
  if (hadOverride) return runGit(['config', '--local', key, value], repoPath);
  return runGit(['config', '--local', '--unset-all', key], repoPath);
}

async function saveProjectGitIdentity(repoPath, { name, email } = {}) {
  name = String(name || '').trim();
  email = String(email || '').trim();
  if (!validIdentityValue(name) || !validIdentityValue(email)) {
    return { ok: false, error: 'Name and email are required and must each fit on one line.' };
  }

  const previous = await readProjectGitIdentity(repoPath);
  if (!previous.ok) return previous;

  const setName = await runGit(['config', '--local', 'user.name', name], repoPath);
  if (!setName.ok) {
    return { ok: false, error: setName.errorSummary || 'Could not update the project Git name.', raw: setName.errorRaw };
  }

  const setEmail = await runGit(['config', '--local', 'user.email', email], repoPath);
  if (!setEmail.ok) {
    await restoreProjectIdentityValue(
      repoPath,
      'user.name',
      previous.name,
      previous.hasNameOverride
    );
    return { ok: false, error: setEmail.errorSummary || 'Could not update the project Git email.', raw: setEmail.errorRaw };
  }

  return {
    ok: true,
    scope: 'project',
    name,
    email,
    effectiveName: name,
    effectiveEmail: email,
    hasNameOverride: true,
    hasEmailOverride: true,
  };
}

async function clearProjectGitIdentity(repoPath) {
  const previous = await readProjectGitIdentity(repoPath);
  if (!previous.ok) return previous;

  if (previous.hasNameOverride) {
    const unsetName = await runGit(['config', '--local', '--unset-all', 'user.name'], repoPath);
    if (!unsetName.ok) {
      return { ok: false, error: unsetName.errorSummary || 'Could not remove the project Git name.', raw: unsetName.errorRaw };
    }
  }

  if (previous.hasEmailOverride) {
    const unsetEmail = await runGit(['config', '--local', '--unset-all', 'user.email'], repoPath);
    if (!unsetEmail.ok) {
      await restoreProjectIdentityValue(
        repoPath,
        'user.name',
        previous.name,
        previous.hasNameOverride
      );
      return { ok: false, error: unsetEmail.errorSummary || 'Could not remove the project Git email.', raw: unsetEmail.errorRaw };
    }
  }

  return await readProjectGitIdentity(repoPath);
}

function parseCommitHistory(stdout) {
  return String(stdout || '')
    .split(COMMIT_RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parentsText, authorName, authorEmail, authorDate, decorations, signature, subject] = record.split(COMMIT_FIELD_SEP);
      const parents = String(parentsText || '').split(' ').filter(Boolean);
      const labels = String(decorations || '').split(',').map((label) => label.trim()).filter(Boolean);
      return {
        sha: sha || '',
        shortSha: String(sha || '').slice(0, 7),
        parents,
        authorName: authorName || '',
        authorEmail: authorEmail || '',
        authorDate: authorDate || '',
        labels,
        signature: signature || 'N',
        subject: subject || '(no commit message)',
        isMerge: parents.length > 1,
      };
    });
}

async function commitToolHistory(repoPath, requestedLimit = 100) {
  const limit = Math.min(1000, Math.max(100, Math.trunc(Number(requestedLimit)) || 100));
  const check = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  if (!check.ok) return { ok: false, error: 'This project is not a Git repository.' };

  const [branch, status, logResult, totalResult, signingKey, signingDefault, signingFormat] = await Promise.all([
    runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoPath),
    runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoPath),
    runGit([
      'log', '-n', String(limit),
      `--pretty=format:%H${COMMIT_FIELD_SEP}%P${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%aI${COMMIT_FIELD_SEP}%D${COMMIT_FIELD_SEP}%G?${COMMIT_FIELD_SEP}%s${COMMIT_RECORD_SEP}`,
      'HEAD',
    ], repoPath),
    runGit(['rev-list', '--count', 'HEAD'], repoPath),
    runGit(['config', '--get', 'user.signingkey'], repoPath),
    runGit(['config', '--get', 'commit.gpgSign'], repoPath),
    runGit(['config', '--get', 'gpg.format'], repoPath),
  ]);

  if (!logResult.ok) {
    const emptyRepo = /does not have any commits|unknown revision|bad revision/i.test(logResult.errorRaw || '');
    if (!emptyRepo) return { ok: false, error: logResult.errorSummary || 'Could not read commit history.', raw: logResult.errorRaw };
  }

  return {
    ok: true,
    branch: branch.ok ? branch.stdout.trim() : '',
    detached: !branch.ok,
    dirty: status.ok && Boolean(status.stdout.trim()),
    changedCount: status.ok ? status.stdout.split('\n').filter(Boolean).length : 0,
    commits: logResult.ok ? parseCommitHistory(logResult.stdout) : [],
    totalCount: totalResult.ok ? Number.parseInt(totalResult.stdout.trim(), 10) || 0 : 0,
    limit,
    signing: {
      configured: Boolean((signingKey.ok && signingKey.stdout.trim()) || (signingDefault.ok && signingDefault.stdout.trim() === 'true')),
      key: signingKey.ok ? signingKey.stdout.trim() : '',
      format: signingFormat.ok ? signingFormat.stdout.trim() : 'openpgp',
    },
  };
}

async function readCommitObject(repoPath, commit) {
  if (!validCommitId(commit)) return { ok: false, error: 'Invalid commit ID.' };
  const result = await runGit([
    'show', '-s',
    '--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%G?%x00%B',
    commit,
  ], repoPath);
  if (!result.ok) return { ok: false, error: result.errorSummary || 'Could not read that commit.', raw: result.errorRaw };

  const fields = result.stdout.split('\0');
  if (fields.length < 12) return { ok: false, error: 'Git returned incomplete commit metadata.' };
  const [sha, tree, parentsText, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, decorations, signature] = fields;
  return {
    ok: true,
    commit: {
      sha,
      shortSha: sha.slice(0, 7),
      tree,
      parents: parentsText.split(' ').filter(Boolean),
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      labels: decorations.split(',').map((label) => label.trim()).filter(Boolean),
      signature: signature || 'N',
      message: fields.slice(11).join('\0').replace(/\n$/, ''),
    },
  };
}

async function commitToolDetail(repoPath, commit) {
  const detail = await readCommitObject(repoPath, commit);
  if (!detail.ok) return detail;
  const ancestor = await runGit(['merge-base', '--is-ancestor', detail.commit.sha, 'HEAD'], repoPath);
  const descendants = ancestor.ok
    ? await runGit(['rev-list', '--count', `${detail.commit.sha}..HEAD`], repoPath)
    : null;
  return {
    ...detail,
    commit: {
      ...detail.commit,
      isMerge: detail.commit.parents.length > 1,
      isAncestor: ancestor.ok,
      descendantCount: descendants?.ok ? Number.parseInt(descendants.stdout.trim(), 10) || 0 : 0,
    },
  };
}

async function rewriteCommitMetadata({
  repoPath,
  commit,
  commits,
  message,
  authorMode = 'global',
  authorDateMode = 'preserve',
  authorDate = '',
  committerMode = 'preserve',
  reSign = false,
} = {}) {
  if (commitRewriteLocks.has(repoPath)) return { ok: false, error: 'A commit rewrite is already running for this project.' };
  commitRewriteLocks.add(repoPath);
  try {
    const batchRewrite = Array.isArray(commits);
    const requestedCommitIds = new Set(
      (batchRewrite ? commits : [commit]).map((value) => String(value || ''))
    );
    if (!validCommitId(commit)) return { ok: false, error: 'Select a valid commit first.' };
    if (!requestedCommitIds.size || [...requestedCommitIds].some((sha) => !validCommitId(sha))) {
      return { ok: false, error: 'Select valid commits first.' };
    }
    if (!requestedCommitIds.has(commit)) {
      return { ok: false, error: 'The oldest selected commit must anchor the batch rewrite.' };
    }
    if (!['preserve', 'global'].includes(authorMode)) return { ok: false, error: 'Invalid author option.' };
    if (!['preserve', 'current', 'custom'].includes(authorDateMode)) return { ok: false, error: 'Invalid author date option.' };
    if (!['preserve', 'global'].includes(committerMode)) return { ok: false, error: 'Invalid committer option.' };
    if (batchRewrite && authorDateMode !== 'preserve') {
      return { ok: false, error: 'Batch rewrites must preserve author dates.' };
    }
    if (batchRewrite && message != null) {
      return { ok: false, error: 'Batch rewrites must preserve commit messages.' };
    }
    if (!batchRewrite && !String(message || '').trim()) return { ok: false, error: 'The commit message cannot be empty.' };

    const [identity, status, branchRef, oldHeadResult, targetResult] = await Promise.all([
      readGlobalGitIdentity(),
      runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoPath),
      runGit(['symbolic-ref', '--quiet', 'HEAD'], repoPath),
      runGit(['rev-parse', 'HEAD'], repoPath),
      readCommitObject(repoPath, commit),
    ]);
    if ((authorMode === 'global' || committerMode === 'global') && (!identity.name || !identity.email)) {
      return { ok: false, error: 'Set a global Git name and email in Identity Tool before using the global identity.' };
    }
    if (!status.ok) return { ok: false, error: status.errorSummary || 'Could not inspect the working tree.', raw: status.errorRaw };
    if (status.stdout.trim()) return { ok: false, error: 'This project has uncommitted changes. Commit or stash them before rewriting history.' };
    if (!branchRef.ok) return { ok: false, error: 'Commit rewriting requires a checked-out local branch; detached HEAD is not supported.' };
    if (!oldHeadResult.ok) return { ok: false, error: oldHeadResult.errorSummary || 'Could not read the current branch tip.', raw: oldHeadResult.errorRaw };
    if (!targetResult.ok) return targetResult;

    const oldHead = oldHeadResult.stdout.trim();
    const target = targetResult.commit;
    if (target.parents.length > 1) return { ok: false, error: 'Merge commits are not supported by the Commit Tool.' };

    const ancestor = await runGit(['merge-base', '--is-ancestor', target.sha, oldHead], repoPath);
    if (!ancestor.ok) return { ok: false, error: 'The selected commit is not an ancestor of the current branch.' };

    let chainShas;
    if (target.parents.length === 0) {
      const descendants = await runGit(['rev-list', '--reverse', '--ancestry-path', `${target.sha}..${oldHead}`], repoPath);
      if (!descendants.ok) return { ok: false, error: descendants.errorSummary || 'Could not inspect descendant commits.', raw: descendants.errorRaw };
      chainShas = [target.sha, ...descendants.stdout.split('\n').map((sha) => sha.trim()).filter(Boolean)];
    } else {
      const chain = await runGit(['rev-list', '--reverse', '--ancestry-path', `${target.sha}^..${oldHead}`], repoPath);
      if (!chain.ok) return { ok: false, error: chain.errorSummary || 'Could not inspect descendant commits.', raw: chain.errorRaw };
      chainShas = chain.stdout.split('\n').map((sha) => sha.trim()).filter(Boolean);
    }
    if (chainShas[0] !== target.sha || chainShas.at(-1) !== oldHead) {
      return { ok: false, error: 'The selected commit does not have a single rewrite path to the current branch.' };
    }

    const metadataResults = await Promise.all(chainShas.map((sha) => readCommitObject(repoPath, sha)));
    const failedRead = metadataResults.find((result) => !result.ok);
    if (failedRead) return failedRead;
    const selectedCommitIds = new Set();
    for (const requested of requestedCommitIds) {
      const matches = chainShas.filter((sha) => sha === requested || sha.startsWith(requested));
      if (matches.length !== 1) {
        return { ok: false, error: 'All selected commits must share one linear path to the current branch.' };
      }
      selectedCommitIds.add(matches[0]);
    }
    const chain = metadataResults.map((result) => result.commit);
    for (let index = 0; index < chain.length; index += 1) {
      const item = chain[index];
      if (item.parents.length > 1 || (index > 0 && (item.parents.length !== 1 || item.parents[0] !== chain[index - 1].sha))) {
        return { ok: false, error: 'This rewrite crosses a branch or merge. Only linear commit history is supported.' };
      }
    }

    const now = new Date().toISOString();
    let nextAuthorDate = target.authorDate;
    if (!batchRewrite && authorDateMode === 'current') nextAuthorDate = now;
    if (!batchRewrite && authorDateMode === 'custom') {
      const parsedDate = new Date(authorDate);
      if (!authorDate || Number.isNaN(parsedDate.getTime())) return { ok: false, error: 'Choose a valid custom author date.' };
      nextAuthorDate = parsedDate.toISOString();
    }

    const currentBranchRef = branchRef.stdout.trim();
    const currentBranch = currentBranchRef.replace(/^refs\/heads\//, '');
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
    const safeBranch = currentBranch.replace(/[^a-zA-Z0-9._-]/g, '-');
    let backupBranch = '';
    let backupResult = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = attempt ? `-${attempt}` : '';
      backupBranch = `pcs-backup-${safeBranch}-${timestamp}${suffix}`;
      backupResult = await runGit(['branch', backupBranch, oldHead], repoPath);
      if (backupResult.ok) break;
      if (!/already exists/i.test(backupResult.errorRaw || '')) break;
    }
    if (!backupResult?.ok) {
      return { ok: false, error: 'Could not create the temporary backup branch. The rewrite was not started.', raw: backupResult?.errorRaw };
    }

    let branchMoved = false;
    let newHead = null;
    const operationResult = await (async () => {
      let newParent = target.parents[0] || null;
      const rewritten = [];
      for (let index = 0; index < chain.length; index += 1) {
        const original = chain[index];
        const selected = selectedCommitIds.has(original.sha);
        const selectedSingleCommit = !batchRewrite && index === 0;
        const useGlobalAuthor = selected && authorMode === 'global';
        const useGlobalCommitter = selected && committerMode === 'global';
        const env = {
          GIT_AUTHOR_NAME: useGlobalAuthor ? identity.name : original.authorName,
          GIT_AUTHOR_EMAIL: useGlobalAuthor ? identity.email : original.authorEmail,
          GIT_AUTHOR_DATE: selectedSingleCommit ? nextAuthorDate : original.authorDate,
          GIT_COMMITTER_NAME: useGlobalCommitter ? identity.name : original.committerName,
          GIT_COMMITTER_EMAIL: useGlobalCommitter ? identity.email : original.committerEmail,
          GIT_COMMITTER_DATE: useGlobalCommitter ? now : original.committerDate,
        };
        const args = ['commit-tree'];
        if (reSign) args.push('-S');
        args.push(original.tree);
        if (newParent) args.push('-p', newParent);
        const created = await runGitWithInput(args, repoPath, selectedSingleCommit ? message : original.message, env);
        if (!created.ok) {
          const signingHint = reSign ? ' Git could not sign the rewritten commit; check your signing key and agent.' : '';
          return { ok: false, error: `${created.errorSummary || 'Could not create the rewritten commit.'}${signingHint}`, raw: created.errorRaw };
        }
        const newSha = created.stdout.trim();
        rewritten.push({ oldSha: original.sha, newSha });
        newParent = newSha;
      }

      newHead = rewritten.at(-1).newSha;
      const moved = await runGit(['update-ref', '-m', `commit-tool: rewrite ${target.shortSha}`, currentBranchRef, newHead, oldHead], repoPath);
      if (!moved.ok) return { ok: false, error: moved.errorSummary || 'The branch changed before the rewrite could be applied.', raw: moved.errorRaw };
      branchMoved = true;

      const [verifiedRef, verifiedTree, verifiedStatus] = await Promise.all([
        runGit(['rev-parse', currentBranchRef], repoPath),
        runGit(['rev-parse', `${newHead}^{tree}`], repoPath),
        runGit(['status', '--porcelain=v1', '--untracked-files=all'], repoPath),
      ]);
      const verificationPassed = verifiedRef.ok
        && verifiedRef.stdout.trim() === newHead
        && verifiedTree.ok
        && verifiedTree.stdout.trim() === chain.at(-1).tree
        && verifiedStatus.ok
        && !verifiedStatus.stdout.trim();
      if (!verificationPassed) {
        return {
          ok: false,
          error: 'Post-rewrite verification failed. The app will restore the original branch tip.',
          raw: [verifiedRef.errorRaw, verifiedTree.errorRaw, verifiedStatus.errorRaw].filter(Boolean).join('\n'),
        };
      }

      return {
        ok: true,
        branch: currentBranch,
        oldHead,
        newHead,
        oldCommit: target.sha,
        newCommit: rewritten[0].newSha,
        selectedCount: selectedCommitIds.size,
        rewrittenCount: rewritten.length,
      };
    })();

    let rolledBack = false;
    if (!operationResult.ok && branchMoved) {
      const rollback = await runGit([
        'update-ref', '-m', `commit-tool: rollback ${target.shortSha}`,
        currentBranchRef, oldHead, newHead,
      ], repoPath);
      const rollbackCheck = rollback.ok ? await runGit(['rev-parse', currentBranchRef], repoPath) : rollback;
      if (!rollback.ok || !rollbackCheck.ok || rollbackCheck.stdout.trim() !== oldHead) {
        return {
          ok: false,
          error: `${operationResult.error} Automatic rollback could not be confirmed. Backup branch "${backupBranch}" was kept.`,
          raw: [operationResult.raw, rollback.errorRaw, rollbackCheck.errorRaw].filter(Boolean).join('\n'),
          backupBranch,
        };
      }
      rolledBack = true;
      branchMoved = false;
    }

    const removedBackup = await runGit(['branch', '-D', backupBranch], repoPath);
    if (!removedBackup.ok) {
      const cleanupMessage = `Temporary backup branch "${backupBranch}" could not be deleted.`;
      if (operationResult.ok) {
        return { ...operationResult, warning: `Rewrite succeeded. ${cleanupMessage}`, backupBranch };
      }
      return {
        ...operationResult,
        error: `${operationResult.error} ${rolledBack ? 'The original branch was restored. ' : ''}${cleanupMessage}`,
        backupBranch,
        rolledBack,
      };
    }
    if (operationResult.ok) return operationResult;
    return {
      ...operationResult,
      error: rolledBack ? `${operationResult.error} The original branch was restored.` : operationResult.error,
      rolledBack,
    };
  } finally {
    commitRewriteLocks.delete(repoPath);
  }
}

ipcMain.handle('identity-get', async (_, { scope = 'global', repoPath = '' } = {}) => {
  if (scope === 'project') return await readProjectGitIdentity(repoPath);
  if (scope !== 'global') return { ok: false, error: 'Invalid identity scope.' };
  const result = await readGlobalGitIdentity();
  return {
    ...result,
    scope: 'global',
    effectiveName: result.name,
    effectiveEmail: result.email,
    hasNameOverride: Boolean(result.name),
    hasEmailOverride: Boolean(result.email),
  };
});
ipcMain.handle('identity-save', async (_, { scope = 'global', repoPath = '', name = '', email = '' } = {}) => {
  if (scope === 'project') return await saveProjectGitIdentity(repoPath, { name, email });
  if (scope !== 'global') return { ok: false, error: 'Invalid identity scope.' };
  return await saveGlobalGitIdentity({ name, email });
});
ipcMain.handle('identity-clear-project', async (_, repoPath) => {
  return await clearProjectGitIdentity(repoPath);
});
ipcMain.handle('commit-tool-history', (_, repoPath, limit) => commitToolHistory(repoPath, limit));
ipcMain.handle('commit-tool-detail', (_, repoPath, commit) => commitToolDetail(repoPath, commit));
ipcMain.handle('commit-tool-rewrite', (_, payload) => rewriteCommitMetadata(payload));

// ── Cross Sync ───────────────────────────────────────────────────────────────
// Move commits between two *independent* repos (different origins, diverged
// branches). The trick that avoids touching either repo's remotes: git can
// fetch straight from another repo's folder path. Each operation fetches into
// a unique temporary ref so concurrent links sharing a target repo cannot race
// through FETCH_HEAD. No named remote or config changes are needed.
const CROSS_RECORD_SEP = '\x1e';
const CROSS_FIELD_SEP = '\x1f';
let crossTempRefCounter = 0;

function parseCommitLog(stdout) {
  return String(stdout || '')
    .split(CROSS_RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject] = record.split(CROSS_FIELD_SEP);
      return { sha: sha || '', shortSha: (sha || '').slice(0, 7), subject: subject || '' };
    });
}

function crossDetectConflict(result) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  return /conflict|automatic merge failed|after resolving the conflicts/.test(text);
}

async function crossIsRepo(repoPath) {
  const res = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  return res.ok;
}

function crossCreateTempRef() {
  crossTempRefCounter += 1;
  return `refs/personal-control-switch/cross-sync/${process.pid}-${Date.now()}-${crossTempRefCounter}`;
}

function crossDeleteTempRef(targetPath, ref) {
  return runGit(['update-ref', '-d', ref], targetPath);
}

// Fetch <branch> from the source repo's folder into a unique ref in the target.
// The caller must delete the returned ref when its operation finishes.
async function crossFetchSourceTip(targetPath, sourcePath, sourceBranch) {
  const ref = crossCreateTempRef();
  const result = await runGit(
    ['fetch', '--no-tags', sourcePath, `${sourceBranch}:${ref}`],
    targetPath
  );
  if (!result.ok) {
    await crossDeleteTempRef(targetPath, ref);
    return result;
  }
  return { ...result, ref };
}

async function crossReadCommits(targetPath, range) {
  const res = await runGit(
    ['log', `--pretty=format:%H${CROSS_FIELD_SEP}%s${CROSS_RECORD_SEP}`, range],
    targetPath
  );
  return res.ok ? parseCommitLog(res.stdout) : [];
}

// Reject dirty working trees and put the target on the branch we're about to
// change, so merge/cherry-pick act on a known, clean state.
async function crossPrepareTarget(targetPath, targetBranch) {
  const dirty = await runGit(['status', '--porcelain'], targetPath);
  if (dirty.ok && dirty.stdout.trim()) {
    return { ok: false, error: 'The target repo has uncommitted changes. Commit or stash them first.' };
  }
  const checkout = await runGit(['checkout', targetBranch], targetPath);
  if (!checkout.ok) {
    return {
      ok: false,
      error: checkout.errorSummary || `Could not switch the target repo to "${targetBranch}".`,
      raw: checkout.errorRaw,
    };
  }
  return { ok: true };
}

// Read-only. Commits each side is missing relative to the other, plus whether
// the two histories share a common ancestor.
//   incoming = in source, not in target  (a source -> target merge)
//   outgoing = in target, not in source  (a target -> source merge)
async function crossCompare({ sourcePath, sourceBranch, targetPath, targetBranch }) {
  if (!sourceBranch || !targetBranch) {
    return { ok: false, error: 'Pick a branch on each side first.' };
  }
  if (!(await crossIsRepo(sourcePath)) || !(await crossIsRepo(targetPath))) {
    return { ok: false, error: 'One of the linked folders is not a Git repository.' };
  }
  const fetched = await crossFetchSourceTip(targetPath, sourcePath, sourceBranch);
  if (!fetched.ok) {
    return { ok: false, error: fetched.errorSummary || 'Could not read the source repository.', raw: fetched.errorRaw };
  }
  try {
    const incoming = await crossReadCommits(targetPath, `${targetBranch}..${fetched.ref}`);
    const outgoing = await crossReadCommits(targetPath, `${fetched.ref}..${targetBranch}`);
    const base = await runGit(['merge-base', targetBranch, fetched.ref], targetPath);
    return { ok: true, related: base.ok, incoming, outgoing };
  } finally {
    await crossDeleteTempRef(targetPath, fetched.ref);
  }
}

// Integrate the source branch into the target branch by rebasing the target's
// own commits on top of the source tip — linear history, no merge commit. No
// --allow-unrelated-histories: mismatched histories conflict and abort rather
// than silently combining (use fetch-branch for that case instead).
async function crossIntegrate({ sourcePath, sourceBranch, targetPath, targetBranch }) {
  const prepared = await crossPrepareTarget(targetPath, targetBranch);
  if (!prepared.ok) return prepared;
  const fetched = await crossFetchSourceTip(targetPath, sourcePath, sourceBranch);
  if (!fetched.ok) return { ok: false, error: fetched.errorSummary || 'Fetch failed.', raw: fetched.errorRaw };

  try {
    const res = await runGit(['rebase', fetched.ref], targetPath);
    if (!res.ok && crossDetectConflict(res)) {
      await runGit(['rebase', '--abort'], targetPath);
      return { ok: false, conflict: true, error: 'Rebase hit conflicts and was aborted — the histories do not line up cleanly. Do it manually in a terminal, or use Fetch branch instead.' };
    }
    if (!res.ok) return { ok: false, error: res.errorSummary || 'Rebase failed.', raw: res.errorRaw };
    return { ok: true, output: [res.stdout, res.stderr].filter(Boolean).join('\n').trim() };
  } finally {
    await crossDeleteTempRef(targetPath, fetched.ref);
  }
}

// Fetch the source branch into the target repo as a *new local branch* (empty
// name → same as the source branch). Only ever adds a ref — never force, never
// touches the working tree. Errors if the name is the target's checked-out
// branch, or already exists and would need a non-fast-forward update.
async function crossFetchBranch({ sourcePath, sourceBranch, targetPath, name }) {
  const branchName = (name && name.trim()) || sourceBranch;

  const current = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], targetPath);
  if (current.ok && current.stdout.trim() === branchName) {
    return { ok: false, error: `"${branchName}" is checked out in the target repo. Pick a different name.` };
  }

  const res = await runGit(
    ['fetch', '--no-tags', sourcePath, `${sourceBranch}:refs/heads/${branchName}`],
    targetPath
  );
  if (!res.ok) {
    const text = `${res.stderr || ''}\n${res.stdout || ''}`.toLowerCase();
    if (text.includes('non-fast-forward') || text.includes('rejected')) {
      return { ok: false, error: `A branch named "${branchName}" already exists in the target and has diverged. Pick a new name.` };
    }
    if (text.includes('checked out')) {
      return { ok: false, error: `"${branchName}" is checked out in the target repo. Pick a different name.` };
    }
    return { ok: false, error: res.errorSummary || 'Fetch branch failed.', raw: res.errorRaw };
  }
  return { ok: true, name: branchName };
}

ipcMain.handle('cross-compare', (_, payload) => crossCompare(payload));
ipcMain.handle('cross-integrate', (_, payload) => crossIntegrate(payload));
ipcMain.handle('cross-fetch-branch', (_, payload) => crossFetchBranch(payload));

ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-homedir', () => require('node:os').homedir());

ipcMain.handle('open-terminal', (_, repoPath) => {
  return openInTerminal(repoPath);
});

ipcMain.handle('open-with', async (_, repoPath, target) => {
  return await openProjectTarget(repoPath, target);
});

ipcMain.handle('window-minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.handle('window-maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});

ipcMain.handle('window-close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});
