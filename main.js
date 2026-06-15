const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
// Node.js 原生 Buffer 不支持 GBK 编码，通过 iconv-lite 实现 GBK 编解码
const iconv = require('iconv-lite');

// ==================== 文件 I/O 统一编码 ====================
// 项目内所有用户文件（session JSON / CSV / 设置）统一以 GBK 编码读写，
// 与 Windows 记事本、Excel 默认解码方式保持一致。
// GBK 字符集无法表示部分 Unicode 字符（如部分 emoji / 罕用汉字），
// 此时 iconv-lite 会用 '?' 替换而不抛错。
const TEXT_ENCODING = 'gbk';
// 调试开关：可通过环境变量 ALGO_VIZ_DEBUG=1 开启编码/路径详细日志。
const DEBUG = process.env.ALGO_VIZ_DEBUG === '1' || process.env.ALGO_VIZ_DEBUG === 'true';
// 截断预览时用的安全长度（避免控制台被超长 base64 / 数组刷屏）
const PREVIEW_LIMIT = 120;

function debugLog(tag, payload) {
  if (!DEBUG) return;
  try {
    const time = new Date().toISOString();
    const line = `[ALGO-VIZ ${time}] [${tag}]`;
    if (payload === undefined) {
      console.log(line);
    } else {
      console.log(line, JSON.stringify(payload, replacerSafe, 2));
    }
  } catch (e) { /* ignore */ }
}
// JSON.stringify 的安全 replacer：Buffer/function/undefined 不让它炸
function replacerSafe(_key, value) {
  if (value == null) return value;
  if (typeof value === 'function') return '[Function]';
  if (Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
  if (typeof value === 'string' && value.length > PREVIEW_LIMIT) {
    return value.slice(0, PREVIEW_LIMIT) + `...(truncated, total ${value.length} chars)`;
  }
  return value;
}
function previewText(s) {
  if (s == null) return { kind: 'null', length: 0, head: '' };
  const str = String(s);
  return {
    kind: 'string',
    length: str.length,
    head: str.length > PREVIEW_LIMIT ? str.slice(0, PREVIEW_LIMIT) + '...(truncated)' : str
  };
}

function writeText(filePath, content) {
  // 将字符串按 GBK 编码成 Buffer 后写入
  const str = content == null ? '' : content;
  const buf = iconv.encode(str, TEXT_ENCODING);
  fs.writeFileSync(filePath, buf);
  debugLog('writeText', {
    path: filePath,
    encoding: TEXT_ENCODING,
    bytes: buf.length,
    textLength: str.length,
    text: previewText(str)
  });
}
function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = iconv.decode(buf, TEXT_ENCODING);
  debugLog('readText', {
    path: filePath,
    encoding: TEXT_ENCODING,
    bytes: buf.length,
    textLength: text.length,
    text: previewText(text)
  });
  return text;
}

// ==================== 路径字符串编码修复 ====================
// 现象：中文 Windows 用户名（如"有辐同享"）+ Electron 28 + Node 24 的某些
// 组合下，app.getPath / dialog.showOpenDialog 返回的字符串中，中文字符实际是
// GBK 字节被错误地当 Latin-1 解释的产物（每 2 个 GBK 字节被压成 1 个 char code），
// 直接显示会出现"颓宠微媪矶机"这类乱码。
//
// 修复启发式：把字符串视为 Latin-1 字节流，按 GBK 反向解码；
// - 若解码结果不包含 U+FFFD（替换字符）且非空，认为修复成功；
// - 否则保留原字符串（说明该字符串本身就是正确 UTF-16 编码）。
function fixPathEncoding(p) {
  if (!p) return p;
  // 仅处理含非 ASCII 字符的字符串，纯 ASCII 路径无此问题
  if (!/[^\x00-\x7f]/.test(p)) return p;
  try {
    const buf = Buffer.from(p, 'latin1');
    const decoded = iconv.decode(buf, TEXT_ENCODING);
    // 解码结果中不能含替换字符；且长度 > 0
    if (decoded && decoded.length > 0 && !decoded.includes('\ufffd')) {
      // 进一步验证：解码结果含中文字符才算"成功"（GBK 编码的特征）
      // 避免误把 ASCII 字符串也通过 latin1 → GBK 转换
      if (/[^\x00-\x7f]/.test(decoded)) {
        debugLog('fixPathEncoding:fixed', { before: previewText(p), after: previewText(decoded) });
        return decoded;
      }
    }
  } catch (e) {
    debugLog('fixPathEncoding:error', { message: e.message });
  }
  return p;
}

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
    // 隐藏原生窗口的"关闭 / 最小化 / 全屏"按钮：所有窗口控制都走应用内
    // 自定义按钮（工具栏右上的 ⬇ / ⛶ / ⏻），避免用户用错原生控件。
    closable: false,
    minimizable: false,
    maximizable: false,
    // Windows 上隐藏 OS 原生标题栏（顶部那条灰色横条），仅保留可拖动
    // + 调整大小边框。所有窗口控制由工具栏自定义按钮接管。
    // 工具栏会通过 -webkit-app-region: drag 支持整窗拖动。
    titleBarStyle: 'hidden',
    title: '排序算法可视化',
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

  // 注：原生窗口关闭按钮已通过 BrowserWindow.closable=false 禁用，
  // 退出应用只能通过工具栏"退出程序"按钮触发 quit-app IPC。
  // 拦截 close 事件已无必要，此处不再注册 close 监听。
}

// 拦截默认的 window-all-closed 行为：因 closable=false 时 app.quit() 不会
// 自动销毁窗口，必须显式销毁并退出，否则进程会卡死。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createMenu() {
  // 不显示任何应用菜单（顶部菜单栏已移除）
  Menu.setApplicationMenu(null);
}

ipcMain.handle('get-app-info', () => {
  try {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform
    };
  } catch (e) {
    console.error('读取应用信息失败:', e);
    return { name: 'algo-viz', version: 'unknown', platform: process.platform || 'unknown' };
  }
});

// 应用内"退出程序"按钮触发的 IPC：显式销毁窗口（因为 closable=false）→
// 触发 window-all-closed → 走 app.quit() 完成正常退出流程
ipcMain.handle('quit-app', () => {
  debugLog('quit-app:enter');
  try {
    setImmediate(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // destroy() 绕过 close 事件（closable=false 不会触发 close），
          // 直接销毁窗口，触发 window-all-closed → app.quit()
          mainWindow.destroy();
        } else {
          app.quit();
        }
        debugLog('quit-app:done', { quitting: true });
      } catch (e) {
        console.error('退出应用失败:', e);
        debugLog('quit-app:destroy-error', { message: e.message });
        // 兜底：万一 destroy 也失败，用 app.exit 强制退出
        try { app.exit(0); } catch (_) {}
      }
    });
    return { ok: true };
  } catch (e) {
    console.error('退出应用失败:', e);
    debugLog('quit-app:error', { message: e.message });
    return { ok: false, error: e.message };
  }
});

// 应用内"最小化"按钮：直接调用主进程 API 最小化窗口
ipcMain.handle('minimize-window', () => {
  debugLog('minimize-window:enter');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
      return { ok: true };
    }
    return { ok: false, error: '主窗口不存在' };
  } catch (e) {
    debugLog('minimize-window:error', { message: e.message });
    return { ok: false, error: e.message };
  }
});

// 应用内"全屏"按钮：切换最大化状态
ipcMain.handle('toggle-maximize-window', () => {
  debugLog('toggle-maximize-window:enter');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return { ok: true, isMaximized: mainWindow.isMaximized() };
    }
    return { ok: false, error: '主窗口不存在' };
  } catch (e) {
    debugLog('toggle-maximize-window:error', { message: e.message });
    return { ok: false, error: e.message };
  }
});

// 读取应用设置（默认保存/导出路径）
ipcMain.handle('get-settings', () => {
  try {
    const s = loadSettings();
    debugLog('get-settings:done', s);
    return s;
  } catch (e) {
    console.error('读取设置失败:', e);
    debugLog('get-settings:error', { message: e.message });
    return {
      defaultSavePath: defaultBasePath(),
      defaultExportPath: defaultBasePath()
    };
  }
});

// 保存应用设置
ipcMain.handle('save-settings', (event, settings) => {
  debugLog('save-settings:enter', { keys: settings ? Object.keys(settings) : null });
  try {
    if (settings == null || typeof settings !== 'object') {
      throw new Error('设置参数无效');
    }
    const merged = Object.assign(loadSettings(), settings);
    saveSettings(merged);
    debugLog('save-settings:done', { merged });
    return merged;
  } catch (e) {
    console.error('保存设置失败:', e);
    debugLog('save-settings:error', { message: e.message });
    throw new Error(`无法保存设置: ${e.message}`);
  }
});

// 选择目录（保存路径/导出路径）
ipcMain.handle('choose-directory', async (event, defaultPath) => {
  debugLog('choose-directory:enter', { defaultPath });
  const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  const result = await dialog.showOpenDialog(parent, {
    title: '选择目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('documents')
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    debugLog('choose-directory:cancel');
    return null;
  }
  // 修复 Windows 上中文路径被错误编码返回的乱码
  const chosen = fixPathEncoding(result.filePaths[0]);
  debugLog('choose-directory:done', { chosen });
  return chosen;
});

// 选择保存文件路径（导出 CSV 用）
ipcMain.handle('choose-save-file', async (event, opts) => {
  debugLog('choose-save-file:enter', { opts });
  const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  const defaultPath = (opts && opts.defaultPath) || app.getPath('documents');
  const result = await dialog.showSaveDialog(parent, {
    title: (opts && opts.title) || '保存文件',
    defaultPath,
    filters: (opts && opts.filters) || [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) {
    debugLog('choose-save-file:cancel');
    return null;
  }
  // 修复 Windows 上中文路径被错误编码返回的乱码
  const chosen = fixPathEncoding(result.filePath);
  debugLog('choose-save-file:done', { chosen });
  return chosen;
});

// 弹出确认对话框（保存/退出/导出前的询问）
ipcMain.handle('confirm-dialog', async (event, opts) => {
  const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  const result = await dialog.showMessageBox(parent, {
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

// 持久化一次排序会话（含原始数组、运行结果、统计数据等）
ipcMain.handle('save-data', async (event, payload) => {
  const t0 = Date.now();
  debugLog('save-data:enter', { payloadKeys: payload ? Object.keys(payload) : null });
  try {
    if (payload == null) {
      throw new Error('未提供要保存的数据');
    }
    // 支持 { data, filePath } 形式；未指定路径则用默认保存路径
    const data = payload && payload.data !== undefined ? payload.data : payload;
    if (data == null) {
      throw new Error('数据为空，无法保存');
    }
    let filePath = payload && payload.filePath;
    if (!filePath) {
      const settings = loadSettings();
      const dir = settings.defaultSavePath || defaultBasePath();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      filePath = path.join(dir, `sorting_session_${Date.now()}.json`);
      debugLog('save-data:autopath', { dir, filePath });
    } else if (typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    } else {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      debugLog('save-data:userpath', { filePath });
    }
    const json = JSON.stringify(data, null, 2);
    writeText(filePath, json);
    const stats = fs.statSync(filePath);
    debugLog('save-data:done', {
      filePath, bytes: stats.size, elapsedMs: Date.now() - t0
    });
    return filePath;
  } catch (e) {
    console.error('保存数据失败:', e);
    debugLog('save-data:error', { message: e.message, stack: e.stack });
    throw new Error(`无法保存数据: ${e.message}`);
  }
});

ipcMain.handle('export-csv', async (event, payload) => {
  const t0 = Date.now();
  debugLog('export-csv:enter', { payloadKeys: payload ? Object.keys(payload) : null });
  try {
    if (payload == null) {
      throw new Error('未提供要导出的数据');
    }
    // 支持 { csvData, filePath } 形式；未指定路径则用默认导出路径
    const csvData = payload && payload.csvData !== undefined ? payload.csvData : (typeof payload === 'string' ? payload : null);
    if (csvData == null) {
      throw new Error('CSV 数据为空');
    }
    let filePath = payload && payload.filePath;
    if (!filePath) {
      const settings = loadSettings();
      const dir = settings.defaultExportPath || settings.defaultSavePath || defaultBasePath();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      filePath = path.join(dir, `sorting_stats_${Date.now()}.csv`);
      debugLog('export-csv:autopath', { dir, filePath });
    } else if (typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    } else {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      debugLog('export-csv:userpath', { filePath });
    }
    // 文件统一 GBK 编码写出，Windows 记事本/Excel 默认按 GBK 解码
    writeText(filePath, csvData);
    const stats = fs.statSync(filePath);
    debugLog('export-csv:done', {
      filePath,
      csvLength: csvData.length,
      bytes: stats.size,
      ratio: stats.size / Math.max(1, csvData.length),
      elapsedMs: Date.now() - t0
    });
    return filePath;
  } catch (e) {
    console.error('导出 CSV 失败:', e);
    debugLog('export-csv:error', { message: e.message, stack: e.stack });
    throw new Error(`无法导出 CSV: ${e.message}`);
  }
});

// ==================== 启动时读取默认路径下的历史数据 ====================
// 列出保存目录下所有 session 文件 / CSV 文件
ipcMain.handle('list-history', (event, opts) => {
  const settings = loadSettings();
  const dir = (opts && opts.dir) || settings.defaultSavePath || defaultBasePath();
  debugLog('list-history:enter', { dir, opts });
  try {
    // 首次使用时自动创建目录，方便用户立即保存
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); }
      catch (e) { console.error('创建历史目录失败:', e); debugLog('list-history:mkdir-fail', { message: e.message }); }
      debugLog('list-history:done', { dir, count: 0, created: true });
      return { dir, items: [] };
    }
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
    debugLog('list-history:done', { dir, count: files.length });
    return { dir, items: files };
  } catch (e) {
    console.error('读取历史数据失败:', e);
    debugLog('list-history:error', { message: e.message });
    return { dir, items: [], error: e.message };
  }
});

// 读取单个文件内容
ipcMain.handle('read-file', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('未提供有效的文件路径');
  }
  debugLog('read-file:enter', { filePath });
  try {
    const text = readText(filePath);
    debugLog('read-file:done', { filePath, length: text.length });
    return text;
  } catch (e) {
    console.error('读取文件失败:', e);
    debugLog('read-file:error', { filePath, code: e && e.code, message: e.message });
    if (e && e.code === 'ENOENT') {
      throw new Error(`文件不存在: ${filePath}`);
    }
    throw new Error(`无法读取文件: ${e.message}`);
  }
});

// ==================== 路径安全：白名单 ====================
// 删除文件等危险操作只允许在以下目录内进行：
//   1. Documents/algo-viz（默认保存/导出目录）
//   2. app.getPath('userData')（应用私有目录）
// 其它路径一律拒绝，防止误删系统文件。
const getAllowedDirs = () => {
  const dirs = [defaultBasePath()];
  try { dirs.push(app.getPath('userData')); } catch (e) { /* ignore */ }
  // 也允许 Electron 选择的任意保存/导出路径
  try {
    const s = loadSettings();
    if (s.defaultSavePath) dirs.push(s.defaultSavePath);
    if (s.defaultExportPath && s.defaultExportPath !== s.defaultSavePath) dirs.push(s.defaultExportPath);
  } catch (e) { /* ignore */ }
  return dirs;
};

const isPathAllowed = (filePath) => {
  if (!filePath) return false;
  const normalized = path.resolve(filePath);
  return getAllowedDirs().some(dir => {
    if (!dir) return false;
    const d = path.resolve(dir);
    // Windows / POSIX 路径分隔符统一
    const sep = path.sep;
    return normalized === d || normalized.startsWith(d.endsWith(sep) ? d : d + sep);
  });
};

// 删除文件
ipcMain.handle('delete-file', async (event, filePath) => {
  debugLog('delete-file:enter', { filePath });
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('未提供有效的文件路径');
  }
  if (!isPathAllowed(filePath)) {
    console.error('拒绝删除非白名单路径:', filePath);
    debugLog('delete-file:denied', { filePath, allowedDirs: getAllowedDirs() });
    throw new Error('不允许删除该路径的文件');
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      debugLog('delete-file:done', { filePath });
    } else {
      debugLog('delete-file:absent', { filePath });
    }
    return true;
  } catch (e) {
    console.error('删除文件失败:', e);
    debugLog('delete-file:error', { filePath, code: e && e.code, message: e.message });
    if (e && e.code === 'ENOENT') {
      // 文件已经不存在，视为删除成功
      return true;
    }
    throw new Error(`无法删除文件: ${e.message}`);
  }
});

// ==================== 设置持久化 ====================
function settingsFilePath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function defaultBasePath() {
  return path.join(fixPathEncoding(app.getPath('documents')), 'algo-viz');
}

function loadSettings() {
  try {
    const p = settingsFilePath();
    debugLog('loadSettings:enter', { path: p });
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(readText(p));
      const result = {
        defaultSavePath: parsed.defaultSavePath || defaultBasePath(),
        defaultExportPath: parsed.defaultExportPath || defaultBasePath()
      };
      debugLog('loadSettings:hit', { result });
      return result;
    }
    debugLog('loadSettings:default', { base: defaultBasePath() });
  } catch (e) {
    console.error('读取设置失败:', e);
    debugLog('loadSettings:error', { message: e.message });
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
    debugLog('saveSettings:write', { path: p });
    writeText(p, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('保存设置失败:', e);
    debugLog('saveSettings:error', { message: e.message });
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