const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');

const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

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

// Hot reload in development only (reloads renderer on file changes)
if (!app.isPackaged) {
  require('electron-reload')(__dirname, {
    ignored: /node_modules|\.git|config\.json/,
  });
}

const execFileP = promisify(execFile);

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
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
    backgroundColor: '#ede9fe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  win.loadFile('index.html');
}

// Single-instance lock — production only (electron-reload needs to respawn freely in dev)
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      env: gitEnv(),
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

async function runGitStreaming(args, cwd, onProgress) {
  return await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: gitEnv(),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onProgress?.({ stream: 'stdout', text });
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onProgress?.({ stream: 'stderr', text });
    });

    child.on('error', (err) => {
      resolve({ ok: false, stdout, stderr: stderr || err.message, liveOutput: true });
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr, liveOutput: true });
    });
  });
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

async function loadConfig() {
  try {
    const data = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(data);
    return { ...parsed, projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch {
    return { projects: [] };
  }
}

let configMutex = Promise.resolve();

function updateConfig(mutator) {
  configMutex = configMutex.then(async () => {
    const cfg = await loadConfig();
    mutator(cfg);
    await fs.writeFile(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  });
  return configMutex;
}

ipcMain.handle('load-config', loadConfig);
ipcMain.handle('save-config', (_, config) => {
  return updateConfig((cfg) => { Object.assign(cfg, config); });
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('get-branches', async (_, repoPath) => {
  const check = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
  if (!check.ok) return { ok: false, error: 'Not a git repository' };

  const branches = await runGit(
    ['branch', '--list', '--format=%(refname:short)'],
    repoPath
  );
  if (!branches.ok) return { ok: false, error: branches.stderr };

  const current = await runGit(['branch', '--show-current'], repoPath);
  const ahead   = await runGit(['rev-list', '--count', '@{u}..HEAD'], repoPath);
  const behind  = await runGit(['rev-list', '--count', 'HEAD..@{u}'], repoPath);
  const status  = await runGit(['status', '--porcelain'], repoPath);
  const uncommitted = status.ok
    ? status.stdout.split('\n').map((s) => s.trim()).filter(Boolean).length
    : 0;

  return {
    ok: true,
    branches: branches.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
    current:  current.stdout.trim(),
    ahead:    ahead.ok  ? (parseInt(ahead.stdout.trim())  || 0) : null,
    behind:   behind.ok ? (parseInt(behind.stdout.trim()) || 0) : null,
    uncommitted,
  };
});

ipcMain.handle('fetch', async (event, repoPath) => {
  return await runGitStreaming(['fetch', '--prune'], repoPath, (payload) => {
    event.sender.send('git-progress', { repoPath, ...payload });
  });
});

ipcMain.handle('git-status', async (_, repoPath) => {
  // Porcelain output is one line per changed file (staged, unstaged, or untracked).
  const res = await runGit(['status', '--porcelain'], repoPath);
  if (!res.ok) return { ok: false, error: res.stderr };
  const lines = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { ok: true, changedCount: lines.length, changes: lines };
});

ipcMain.handle('git-commit-all', async (_, repoPath, message) => {
  const add = await runGit(['add', '-A'], repoPath);
  if (!add.ok) return { ok: false, stdout: add.stdout, stderr: add.stderr };
  const commit = await runGit(['commit', '-m', message || 'Quick commit'], repoPath);
  return commit;
});

ipcMain.handle('checkout', async (_, repoPath, branch) => {
  return await runGit(['checkout', branch], repoPath);
});

ipcMain.handle('pull', async (event, repoPath) => {
  return await runGitStreaming(['pull'], repoPath, (payload) => {
    event.sender.send('git-progress', { repoPath, ...payload });
  });
});

ipcMain.handle('push', async (event, repoPath) => {
  return await runGitStreaming(['push'], repoPath, (payload) => {
    event.sender.send('git-progress', { repoPath, ...payload });
  });
});

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

ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-homedir', () => require('node:os').homedir());

ipcMain.handle('open-terminal', (_, repoPath) => {
  try {
    if (process.platform === 'win32') {
      // `start cmd.exe` opens a new window; inherits cwd → lands in repoPath
      const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], {
        cwd: repoPath, detached: true, stdio: 'ignore',
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      execFile('open', ['-a', 'Terminal', repoPath]);
    } else {
      // Linux: try common emulators in order
      for (const t of ['gnome-terminal', 'konsole', 'xfce4-terminal', 'x-terminal-emulator', 'xterm']) {
        const ch = spawn(t, [], { cwd: repoPath, detached: true, stdio: 'ignore' });
        ch.on('error', () => {}); // suppress ENOENT for missing emulators
        ch.unref();
        break; // spawn doesn't throw synchronously; first attempt wins
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
