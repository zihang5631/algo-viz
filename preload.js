const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  exportCSV: (csvData) => ipcRenderer.invoke('export-csv', csvData),
  onUpdateStats: (callback) => ipcRenderer.on('update-stats', callback)
});

contextBridge.exposeInMainWorld('appLogger', {
  info: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
});