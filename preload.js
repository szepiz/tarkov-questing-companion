const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInit: () => ipcRenderer.invoke('get-init'),
  loadTasks: () => ipcRenderer.invoke('load-tasks'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  setGameMode: (mode) => ipcRenderer.invoke('set-game-mode', mode),
  toggleTask: (taskId, done, mode) => ipcRenderer.invoke('toggle-task', { taskId, done, mode }),
  resetProgress: (mode) => ipcRenderer.invoke('reset-progress', mode),
  rescanAll: () => ipcRenderer.invoke('rescan-all'),
  browseLogs: () => ipcRenderer.invoke('browse-logs'),
  openWiki: (url) => ipcRenderer.invoke('open-wiki', url),
  onAutoCompletions: (cb) => ipcRenderer.on('auto-completions', (_e, data) => cb(data)),
  onWatcherStatus: (cb) => ipcRenderer.on('watcher-status', (_e, data) => cb(data)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, data) => cb(data)),
});
