const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');

Menu.setApplicationMenu(null);
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

// Hot reload in development only (reloads renderer on file changes)
if (!app.isPackaged) {
  require('electron-reload')(__dirname, {
    ignored: /node_modules|\.git|config\.json/,
  });
}

const execFileP = promisify(execFile);

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function createWindow() {
  const config = await loadConfig();
  const saved = config.window || {};

  const win = new BrowserWindow({
    width:  saved.width  || 820,
    height: saved.height || 500,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#ede9fe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const saveBounds = debounce(async () => {
    if (win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    const cfg = await loadConfig();
    cfg.window = { width: b.width, height: b.height, x: b.x, y: b.y };
    await saveConfig(cfg);
  }, 400);

  win.on('resize', saveBounds);
  win.on('move',   saveBounds);

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
    const { stdout, stderr } = await execFileP('git', args, { cwd });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
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

async function saveConfig(config) {
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

ipcMain.handle('load-config', loadConfig);
ipcMain.handle('save-config', async (_, config) => {
  const existing = await loadConfig();
  return saveConfig({ ...existing, ...config });
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
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

  return {
    ok: true,
    branches: branches.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
    current:  current.stdout.trim(),
    ahead:    ahead.ok  ? (parseInt(ahead.stdout.trim())  || 0) : null,
    behind:   behind.ok ? (parseInt(behind.stdout.trim()) || 0) : null,
  };
});

ipcMain.handle('fetch', async (_, repoPath) => {
  return await runGit(['fetch', '--prune'], repoPath);
});

ipcMain.handle('checkout', async (_, repoPath, branch) => {
  return await runGit(['checkout', branch], repoPath);
});

ipcMain.handle('pull', async (_, repoPath) => {
  return await runGit(['pull'], repoPath);
});

ipcMain.handle('push', async (_, repoPath) => {
  return await runGit(['push'], repoPath);
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
