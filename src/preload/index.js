const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfigLocation: () => ipcRenderer.invoke('get-config-location'),
  pickConfigFile: () => ipcRenderer.invoke('pick-config-file'),
  setConfigLocation: (configPath) => ipcRenderer.invoke('set-config-location', configPath),
  resetConfigLocation: () => ipcRenderer.invoke('reset-config-location'),
  pickFolders: () => ipcRenderer.invoke('pick-folder'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBranches: (repoPath, appRemote = null) => ipcRenderer.invoke('get-branches', repoPath, appRemote),
  checkout: (repoPath, branch) => ipcRenderer.invoke('checkout', repoPath, branch),
  createBranch: (repoPath, branch) => ipcRenderer.invoke('create-branch', repoPath, branch),
  pull: (repoPath, appRemote = null) => ipcRenderer.invoke('pull', repoPath, appRemote),
  push: (repoPath, appRemote = null) => ipcRenderer.invoke('push', repoPath, appRemote),
  pushSetUpstream: (repoPath) => ipcRenderer.invoke('push-set-upstream', repoPath),
  cancelGit: (repoPath) => ipcRenderer.invoke('cancel-git', repoPath),
  confirmDialog: (opts) => ipcRenderer.invoke('confirm-dialog', opts),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getHomedir: () => ipcRenderer.invoke('get-homedir'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  openTerminal: (repoPath) => ipcRenderer.invoke('open-terminal', repoPath),
  openWith: (repoPath, target) => ipcRenderer.invoke('open-with', repoPath, target),
  fetch: (repoPath, appRemote = null) => ipcRenderer.invoke('fetch', repoPath, appRemote),
  getGitRemotes: (repoPath) => ipcRenderer.invoke('get-git-remotes', repoPath),
  setGitRemoteUrl: (repoPath, remoteName, url) => (
    ipcRenderer.invoke('set-git-remote-url', repoPath, remoteName, url)
  ),
  testAppRemote: (repoPath, appRemote) => ipcRenderer.invoke('test-app-remote', repoPath, appRemote),
  clearAppRemote: (repoPath, remoteId) => ipcRenderer.invoke('clear-app-remote', repoPath, remoteId),
  gitStatus: (repoPath) => ipcRenderer.invoke('git-status', repoPath),
  commitAll: (repoPath, message, amend = false) => ipcRenderer.invoke('git-commit-all', repoPath, message, amend),
  identityGet: (scope, repoPath = '') => ipcRenderer.invoke('identity-get', { scope, repoPath }),
  identitySave: (payload) => ipcRenderer.invoke('identity-save', payload),
  identityClearProject: (repoPath) => ipcRenderer.invoke('identity-clear-project', repoPath),
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
