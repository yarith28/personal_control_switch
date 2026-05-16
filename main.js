const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');

Menu.setApplicationMenu(null);
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);

function createWindow() {
  const win = new BrowserWindow({
    width: 820,
    height: 500,
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
  win.loadFile('index.html');
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
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch {
    return { projects: [] };
  }
}

async function saveConfig(config) {
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

ipcMain.handle('load-config', loadConfig);
ipcMain.handle('save-config', (_, config) => saveConfig(config));

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

  return {
    ok: true,
    branches: branches.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
    current: current.stdout.trim(),
  };
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

ipcMain.handle('get-platform', () => process.platform);

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
