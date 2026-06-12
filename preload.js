const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  saveData: (payload) => ipcRenderer.invoke('save-data', payload),
  exportCSV: (payload) => ipcRenderer.invoke('export-csv', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('choose-directory', defaultPath),
  chooseSaveFile: (opts) => ipcRenderer.invoke('choose-save-file', opts),
  confirmDialog: (opts) => ipcRenderer.invoke('confirm-dialog', opts),
  writeFile: (payload) => ipcRenderer.invoke('write-file', payload),
  requestQuit: () => ipcRenderer.invoke('request-quit'),
  listHistory: (opts) => ipcRenderer.invoke('list-history', opts),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  onUpdateStats: (callback) => ipcRenderer.on('update-stats', callback)
});

contextBridge.exposeInMainWorld('appLogger', {
  info: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
});