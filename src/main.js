const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

// 导入核心服务（Task 2-6 将逐步完善实现）
let configStore;
let pathResolver;
let commandRunner;
let gitService;
let harnessService;
let pluginSource;
let profileService;

try {
  configStore = require('./services/config-store');
  pathResolver = require('./services/path-resolver');
  commandRunner = require('./services/command-runner');
  gitService = require('./services/git-service');
  harnessService = require('./services/harness-service');
  pluginSource = require('./services/plugin-source');
  profileService = require('./services/profile-service');
} catch {
  // 允许在服务未全部创建前基础启动
}

app.name = 'DeepSeek-Cockpit';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.deepseek.cockpit');
}

let mainWindow = null;
let webAppWindow = null;
let tray = null;
let appIcon = null;
let isQuitting = false;

// 跨调用复用 BrowserWindow 的重试状态：清理上一次的监听器和定时器，
// 防止新一次的打开与旧一次的回调相互覆盖。
const webAppRetryState = new WeakMap();
const WEB_APP_MAX_RETRIES = 12;
const WEB_APP_RETRY_DELAY_MS = 1000;

function openInAppWebWindow(url) {
  if (!url) return;

  const isNew = !webAppWindow || webAppWindow.isDestroyed();
  if (isNew) {
    webAppWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 800,
      minHeight: 600,
      title: 'DeepSeek Harness Web',
      icon: appIcon || undefined,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    webAppWindow.on('closed', () => {
      webAppRetryState.delete(webAppWindow);
      webAppWindow = null;
    });
  } else {
    if (webAppWindow.isMinimized()) webAppWindow.restore();
    webAppWindow.show();
    webAppWindow.focus();
  }

  // 始终重新加载：服务端首屏还在编译时，第一次 loadURL 可能拿到空白或 502；
  // 复用旧窗口时早一次失败加载也必须能重试，而不是靠 getURL 差异触发。
  retryLoadWebApp(webAppWindow, url);
}

function retryLoadWebApp(win, url) {
  if (!win || win.isDestroyed()) return;

  const prior = webAppRetryState.get(win);
  if (prior) {
    if (prior.timer) clearTimeout(prior.timer);
    prior.listeners.forEach(({ evt, fn }) => {
      try { win.webContents.removeListener(evt, fn); } catch { /* ignore */ }
    });
  }

  const state = {
    attempt: 0,
    succeeded: false,
    timer: null,
    listeners: []
  };
  webAppRetryState.set(win, state);

  const scheduleRetry = (reason) => {
    if (state.succeeded) return;
    if (state.attempt >= WEB_APP_MAX_RETRIES) {
      try { win.setTitle('DeepSeek Harness Web — 加载失败'); } catch { /* ignore */ }
      console.error(`[openInAppWebWindow] 放弃重试：${reason}（已尝试 ${state.attempt} 次）`);
      return;
    }
    state.attempt += 1;
    state.timer = setTimeout(() => {
      if (state.succeeded || win.isDestroyed()) return;
      try {
        win.loadURL(url);
      } catch (err) {
        console.error('[openInAppWebWindow] loadURL 抛出：', err);
      }
    }, WEB_APP_RETRY_DELAY_MS);
  };

  const onFinishLoad = () => {
    state.succeeded = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    try { win.setTitle('DeepSeek Harness Web'); } catch { /* ignore */ }
  };

  const onFailLoad = (_event, errorCode, errorDescription) => {
    scheduleRetry(`did-fail-load code=${errorCode} ${errorDescription}`);
  };

  const onRenderGone = () => {
    scheduleRetry('render-process-gone');
  };

  win.webContents.on('did-finish-load', onFinishLoad);
  win.webContents.on('did-fail-load', onFailLoad);
  win.webContents.on('render-process-gone', onRenderGone);
  state.listeners = [
    { evt: 'did-finish-load', fn: onFinishLoad },
    { evt: 'did-fail-load', fn: onFailLoad },
    { evt: 'render-process-gone', fn: onRenderGone }
  ];

  try {
    win.loadURL(url);
  } catch (err) {
    console.error('[openInAppWebWindow] 首次 loadURL 抛出：', err);
    scheduleRetry('initial-loadURL-throw');
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception in Main Process:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in Main Process:', reason);
});

function broadcastLog(level, message, source = 'system') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log:append', {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      source
    });
  }
}

function broadcastProcessState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process:state', state);
  }
}

// 读字节再交给 createFromBuffer，而不是 createFromPath —— 打包后图标在 app.asar 内，
// fs.readFile 能穿透 asar，且 createFromBuffer 只认 PNG/JPEG（不解析 ICO）
async function loadAppIcon() {
  try {
    const buf = await fs.readFile(path.join(__dirname, '../resources/tray.png'));
    return nativeImage.createFromBuffer(buf);
  } catch {
    // ponytail: 图标缺失就降级为无托盘，不能让主进程起不来
    return null;
  }
}

function createTray() {
  if (tray || !appIcon) return;
  tray = new Tray(appIcon);
  tray.setToolTip('DeepSeek Harness Cockpit');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 750,
    minWidth: 920,
    minHeight: 620,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness Cockpit',
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // 最小化与关闭都收进托盘，只有托盘菜单的「退出」才真正退出，
  // 避免误关标题栏 × 时把正在跑的 dsh web 一起停掉。
  // 托盘没建起来时必须放行，否则窗口既唤不回也退不出。
  mainWindow.on('minimize', (event) => {
    if (!tray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (!tray || isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册 IPC Handlers
function setupIpcHandlers() {
  // 配置相关
  ipcMain.handle('config:load', async () => {
    if (configStore) return await configStore.loadConfig();
    return { schemaVersion: 1, harnessPath: null, remoteUrl: 'https://github.com/deepseek-ai/deepseek-harness.git', remoteName: 'origin', branch: null, web: { port: 3080, autoOpenBrowser: true }, dshHome: null };
  });

  ipcMain.handle('config:save', async (_event, partial) => {
    if (configStore) return await configStore.saveConfig(partial);
    return { ok: true };
  });

  // 仓库相关
  ipcMain.handle('repo:pick-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('repo:inspect', async () => {
    if (gitService && configStore) {
      const cfg = await configStore.loadConfig();
      return await gitService.inspectRepo(cfg.harnessPath, cfg.remoteName);
    }
    return { valid: false, message: '服务初始化中' };
  });

  ipcMain.handle('repo:clone', async (_event, { targetDir, remoteUrl }) => {
    if (gitService) return await gitService.cloneRepo(targetDir, remoteUrl, broadcastLog);
    return { ok: false, stderr: 'Git 服务不可用' };
  });

  ipcMain.handle('repo:fetch', async () => {
    if (gitService && configStore) {
      const cfg = await configStore.loadConfig();
      return await gitService.fetchRepo(cfg.harnessPath, cfg.remoteName, broadcastLog);
    }
    return { ok: false, stderr: 'Git 服务不可用' };
  });

  ipcMain.handle('repo:sync', async () => {
    if (gitService && configStore) {
      const cfg = await configStore.loadConfig();
      return await gitService.syncRepo(cfg.harnessPath, cfg.remoteName, cfg.branch, broadcastLog);
    }
    return { ok: false, stderr: 'Git 服务不可用' };
  });

  // Web 服务相关
  ipcMain.handle('web:preflight', async () => {
    if (harnessService && configStore) {
      const cfg = await configStore.loadConfig();
      return await harnessService.preflight(cfg);
    }
    return { canStart: false, issues: ['服务未就绪'] };
  });

  ipcMain.handle('web:prepare', async () => {
    if (harnessService && configStore) {
      const cfg = await configStore.loadConfig();
      return await harnessService.prepare(cfg, broadcastLog);
    }
    return { ok: false, stderr: '服务不可用' };
  });

  ipcMain.handle('web:start', async (_event, { port }) => {
    if (harnessService && configStore) {
      const cfg = await configStore.loadConfig();
      return await harnessService.startWeb(cfg, port, broadcastLog, broadcastProcessState);
    }
    return { state: 'failed', error: '服务不可用' };
  });

  ipcMain.handle('web:stop', async () => {
    if (harnessService) {
      return await harnessService.stopWeb(broadcastLog, broadcastProcessState);
    }
    return { ok: false };
  });

  ipcMain.handle('web:restart', async (_event, { port }) => {
    if (harnessService && configStore) {
      const cfg = await configStore.loadConfig();
      return await harnessService.restartWeb(cfg, port, broadcastLog, broadcastProcessState);
    }
    return { state: 'failed', error: '服务不可用' };
  });

  ipcMain.handle('web:open', async (_event, { url, inApp = null }) => {
    if (!url) return;
    const isLocalWeb = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('https://127.0.0.1') || url.startsWith('https://localhost');
    const shouldOpenInApp = inApp !== null ? inApp : isLocalWeb;
    if (shouldOpenInApp) {
      openInAppWebWindow(url);
    } else {
      await shell.openExternal(url);
    }
  });

  // 插件管理相关
  ipcMain.handle('plugins:get-catalog', async () => {
    try {
      const snapshotPath = path.join(__dirname, '../data/registry-snapshot.json');
      const data = await fs.readFile(snapshotPath, 'utf8');
      return JSON.parse(data);
    } catch {
      try {
        const catalogPath = path.join(__dirname, '../resources/plugin-catalog.json');
        const data = await fs.readFile(catalogPath, 'utf8');
        const list = JSON.parse(data);
        return { categories: {}, plugins: Array.isArray(list) ? list : [] };
      } catch {
        return { categories: {}, plugins: [] };
      }
    }
  });

  ipcMain.handle('plugins:list', async () => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.listPlugins(cfg);
    }
    return [];
  });

  ipcMain.handle('plugins:add', async (_event, { source }) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.addPlugin(cfg, source, broadcastLog);
    }
    return { ok: false, stderr: '插件服务不可用' };
  });

  ipcMain.handle('plugins:remove', async (_event, { packageName }) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.removePlugin(cfg, packageName, broadcastLog);
    }
    return { ok: false, stderr: '插件服务不可用' };
  });

  ipcMain.handle('plugins:update', async (_event, { packageName }) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.updatePlugin(cfg, packageName, broadcastLog);
    }
    return { ok: false, stderr: '插件服务不可用' };
  });

  ipcMain.handle('plugins:approve-builds', async (_event, { packageNames = [], allowBuildKeys = [] } = {}) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.approveBuilds(cfg, packageNames, allowBuildKeys, broadcastLog);
    }
    return { ok: false, stderr: '插件服务不可用' };
  });

  ipcMain.handle('plugins:load-patch', async () => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.loadPatch(cfg);
    }
    return { content: '', exists: false };
  });

  ipcMain.handle('plugins:save-patch', async (_event, { yamlText }) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.savePatch(cfg, yamlText, broadcastLog);
    }
    return { ok: false, error: '补丁服务不可用' };
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  // 先载入图标：托盘和窗口图标复用同一份，顺序不能颠倒
  appIcon = await loadAppIcon();
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async (event) => {
  // 在窗口 close 事件之前置位，否则 close 处理器会把退出流程挡住
  isQuitting = true;
  if (harnessService && harnessService.isWebRunning && harnessService.isWebRunning()) {
    event.preventDefault();
    try {
      await harnessService.stopWeb();
    } finally {
      app.exit(0);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
