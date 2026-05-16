const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getBranches: (repoPath) => ipcRenderer.invoke('get-branches', repoPath),
  checkout: (repoPath, branch) => ipcRenderer.invoke('checkout', repoPath, branch),
  pull: (repoPath) => ipcRenderer.invoke('pull', repoPath),
  push: (repoPath) => ipcRenderer.invoke('push', repoPath),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
});
