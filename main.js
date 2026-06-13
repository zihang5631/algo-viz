const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  // 仅在图标文件存在时设置，避免空 assets 目录导致运行时报错
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const iconOption = fs.existsSync(iconPath) ? { icon: iconPath } : {};

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    ...iconOption,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    backgroundColor: '#f5f7fa'
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 拦截窗口关闭：未保存时弹出确认
  let isForceClosing = false;
  let closeConfirmTimer = null;
  mainWindow.on('close', (event) => {
    if (isForceClosing) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    // 渲染端可能因 devtools 打开或加载异常而无法响应；超时回退到允许关闭，
    // 避免"卡住"无法退出
    if (closeConfirmTimer) clearTimeout(closeConfirmTimer);
    closeConfirmTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !isForceClosing) {
        isForceClosing = true;
        mainWindow.close();
      }
    }, 30000);
    try {
      mainWindow.webContents.send('request-close-confirm');
    } catch (e) {
      if (closeConfirmTimer) { clearTimeout(closeConfirmTimer); closeConfirmTimer = null; }
      isForceClosing = true;
      mainWindow.close();
    }
  });
  ipcMain.on('confirm-close-result', (event, confirmed) => {
    if (closeConfirmTimer) { clearTimeout(closeConfirmTimer); closeConfirmTimer = null; }
    if (confirmed) {
      isForceClosing = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }
  });
}

function createMenu() {
  // 不显示任何应用菜单（顶部菜单栏已移除）
  Menu.setApplicationMenu(null);
}

ipcMain.handle('get-app-info', () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  };
});

// 读取应用设置（默认保存/导出路径）
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

// 保存应用设置
ipcMain.handle('save-settings', (event, settings) => {
  const merged = Object.assign(loadSettings(), settings || {});
  saveSettings(merged);
  return merged;
});

// 选择目录（保存路径/导出路径）
ipcMain.handle('choose-directory', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('documents')
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// 选择保存文件路径（导出 CSV 用）
ipcMain.handle('choose-save-file', async (event, opts) => {
  const defaultPath = (opts && opts.defaultPath) || app.getPath('documents');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: (opts && opts.title) || '保存文件',
    defaultPath,
    filters: (opts && opts.filters) || [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  return result.filePath;
});

// 弹出确认对话框（保存/退出/导出前的询问）
ipcMain.handle('confirm-dialog', async (event, opts) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: (opts && opts.type) || 'question',
    title: (opts && opts.title) || '确认',
    message: (opts && opts.message) || '',
    detail: (opts && opts.detail) || undefined,
    buttons: (opts && opts.buttons) || ['确定', '取消'],
    defaultId: (opts && opts.defaultId) || 0,
    cancelId: (opts && opts.cancelId) || 1,
    noLink: true
  });
  return result.response;
});

// 写入文本文件（保存到任意路径）
ipcMain.handle('write-file', (event, payload) => {
  const filePath = payload && payload.filePath;
  const content = payload && payload.content;
  if (!filePath) throw new Error('未提供文件路径');
  fs.writeFileSync(filePath, content == null ? '' : content);
  return filePath;
});

// 退出应用（先弹出确认）
ipcMain.handle('request-quit', async () => {
  if (!mainWindow) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '退出确认',
    message: '确定要退出排序算法可视化测试吗？',
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) {
    mainWindow.destroy();
    return true;
  }
  return false;
});

ipcMain.handle('save-data', (event, payload) => {
  // 支持 { data, filePath } 形式；未指定路径则用默认保存路径
  const data = payload && payload.data !== undefined ? payload.data : payload;
  let filePath = payload && payload.filePath;
  if (!filePath) {
    const settings = loadSettings();
    const dir = settings.defaultSavePath || defaultBasePath();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `sorting_session_${Date.now()}.json`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
});

ipcMain.handle('export-csv', (event, payload) => {
  // 支持 { csvData, filePath } 形式；未指定路径则用默认导出路径
  const csvData = payload && payload.csvData !== undefined ? payload.csvData : (typeof payload === 'string' ? payload : null);
  let filePath = payload && payload.filePath;
  if (!filePath) {
    const settings = loadSettings();
    const dir = settings.defaultExportPath || settings.defaultSavePath || defaultBasePath();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `sorting_stats_${Date.now()}.csv`);
  }
  fs.writeFileSync(filePath, csvData == null ? '' : csvData);
  return filePath;
});

// ==================== 启动时读取默认路径下的历史数据 ====================
// 列出保存目录下所有 session 文件 / CSV 文件
ipcMain.handle('list-history', (event, opts) => {
  const settings = loadSettings();
  const dir = (opts && opts.dir) || settings.defaultSavePath || defaultBasePath();
  try {
    if (!fs.existsSync(dir)) return { dir, items: [] };
    const files = fs.readdirSync(dir)
      .filter(name => /^sorting_(session|stats)_.*\.(json|csv)$/i.test(name))
      .map(name => {
        const full = path.join(dir, name);
        let stat = null;
        try { stat = fs.statSync(full); } catch (e) { /* ignore */ }
        return {
          name,
          filePath: full,
          type: /\.json$/i.test(name) ? 'session' : 'csv',
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { dir, items: files };
  } catch (e) {
    console.error('读取历史数据失败:', e);
    return { dir, items: [], error: e.message };
  }
});

// 读取单个文件内容
ipcMain.handle('read-file', (event, filePath) => {
  if (!filePath) throw new Error('未提供文件路径');
  return fs.readFileSync(filePath, 'utf8');
});

// 删除文件
ipcMain.handle('delete-file', (event, filePath) => {
  if (!filePath) throw new Error('未提供文件路径');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return true;
});

// ==================== 设置持久化 ====================
function settingsFilePath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function defaultBasePath() {
  return path.join(app.getPath('documents'), 'Algorithm-Visualization');
}

function loadSettings() {
  try {
    const p = settingsFilePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        defaultSavePath: parsed.defaultSavePath || defaultBasePath(),
        defaultExportPath: parsed.defaultExportPath || defaultBasePath()
      };
    }
  } catch (e) {
    console.error('读取设置失败:', e);
  }
  return {
    defaultSavePath: defaultBasePath(),
    defaultExportPath: defaultBasePath()
  };
}

function saveSettings(settings) {
  try {
    const p = settingsFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('保存设置失败:', e);
  }
}

app.whenReady().then(() => {
  createWindow();
  createMenu();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});