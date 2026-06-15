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
  listHistory: (opts) => ipcRenderer.invoke('list-history', opts),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  // 应用内"退出程序"按钮：调用此方法结束应用
  quitApp: () => ipcRenderer.invoke('quit-app'),
  // 工具栏窗口控制按钮（最小化 / 切换最大化）
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window')
});

contextBridge.exposeInMainWorld('appLogger', {
  info: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
});