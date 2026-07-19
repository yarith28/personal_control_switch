const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  pickFolders: () => ipcRenderer.invoke('pick-folder'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBranches: (repoPath) => ipcRenderer.invoke('get-branches', repoPath),
  checkout: (repoPath, branch) => ipcRenderer.invoke('checkout', repoPath, branch),
  createBranch: (repoPath, branch) => ipcRenderer.invoke('create-branch', repoPath, branch),
  pull: (repoPath) => ipcRenderer.invoke('pull', repoPath),
  push: (repoPath) => ipcRenderer.invoke('push', repoPath),
  cancelGit: (repoPath) => ipcRenderer.invoke('cancel-git', repoPath),
  confirmDialog: (opts) => ipcRenderer.invoke('confirm-dialog', opts),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getHomedir: () => ipcRenderer.invoke('get-homedir'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  openTerminal: (repoPath) => ipcRenderer.invoke('open-terminal', repoPath),
  openWith: (repoPath, target) => ipcRenderer.invoke('open-with', repoPath, target),
  fetch: (repoPath) => ipcRenderer.invoke('fetch', repoPath),
  gitStatus: (repoPath) => ipcRenderer.invoke('git-status', repoPath),
  commitAll: (repoPath, message, amend = false) => ipcRenderer.invoke('git-commit-all', repoPath, message, amend),
  commitToolGetGlobalIdentity: () => ipcRenderer.invoke('commit-tool-get-global-identity'),
  commitToolSaveGlobalIdentity: (identity) => ipcRenderer.invoke('commit-tool-save-global-identity', identity),
  commitToolHistory: (repoPath, limit) => ipcRenderer.invoke('commit-tool-history', repoPath, limit),
  commitToolDetail: (repoPath, commit) => ipcRenderer.invoke('commit-tool-detail', repoPath, commit),
  commitToolRewrite: (payload) => ipcRenderer.invoke('commit-tool-rewrite', payload),
  crossCompare: (payload) => ipcRenderer.invoke('cross-compare', payload),
  crossIntegrate: (payload) => ipcRenderer.invoke('cross-integrate', payload),
  crossFetchBranch: (payload) => ipcRenderer.invoke('cross-fetch-branch', payload),
  onGitProgress: (listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on('git-progress', wrapped);
    return () => ipcRenderer.removeListener('git-progress', wrapped);
  },
});
