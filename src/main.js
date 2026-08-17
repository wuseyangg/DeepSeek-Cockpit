const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

let mainWindow = null;

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 750,
    minWidth: 920,
    minHeight: 620,
    autoHideMenuBar: true,
    title: 'DeepSeek Harness Cockpit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

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

  ipcMain.handle('web:open', async (_event, { url }) => {
    if (url) {
      await shell.openExternal(url);
    }
  });

  // 插件与补丁相关
  ipcMain.handle('plugins:get-catalog', async () => {
    try {
      const catalogPath = path.join(__dirname, '../resources/plugin-catalog.json');
      const data = await fs.readFile(catalogPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
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

  ipcMain.handle('plugins:approve-builds', async (_event, { packageNames }) => {
    if (profileService && configStore) {
      const cfg = await configStore.loadConfig();
      return await profileService.approveBuilds(cfg, packageNames, broadcastLog);
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

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async (event) => {
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
