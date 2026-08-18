const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cockpit', {
  appInfo: {
    name: 'DeepSeek Harness Cockpit',
    version: '1.0.0'
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (partial) => ipcRenderer.invoke('config:save', partial)
  },
  repo: {
    pickDirectory: () => ipcRenderer.invoke('repo:pick-directory'),
    inspect: () => ipcRenderer.invoke('repo:inspect'),
    clone: (targetDir, remoteUrl) => ipcRenderer.invoke('repo:clone', { targetDir, remoteUrl }),
    fetch: () => ipcRenderer.invoke('repo:fetch'),
    sync: () => ipcRenderer.invoke('repo:sync')
  },
  web: {
    preflight: () => ipcRenderer.invoke('web:preflight'),
    prepare: () => ipcRenderer.invoke('web:prepare'),
    start: (port) => ipcRenderer.invoke('web:start', { port }),
    stop: () => ipcRenderer.invoke('web:stop'),
    restart: (port) => ipcRenderer.invoke('web:restart', { port }),
    open: (url, inApp) => ipcRenderer.invoke('web:open', { url, inApp })
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    getCatalog: () => ipcRenderer.invoke('plugins:get-catalog'),
    add: (source) => ipcRenderer.invoke('plugins:add', { source }),
    remove: (packageName) => ipcRenderer.invoke('plugins:remove', { packageName }),
    update: (packageName) => ipcRenderer.invoke('plugins:update', { packageName }),
    replace: (packageName, source) => ipcRenderer.invoke('plugins:replace', { packageName, source }),
    approveBuilds: (args) => {
      // 向后兼容：旧调用方传 string[]（纯包名），新调用方传 { packageNames, allowBuildKeys }。
      if (Array.isArray(args)) {
        return ipcRenderer.invoke('plugins:approve-builds', { packageNames: args, allowBuildKeys: [] });
      }
      const { packageNames = [], allowBuildKeys = [] } = args || {};
      return ipcRenderer.invoke('plugins:approve-builds', { packageNames, allowBuildKeys });
    },
    loadPatch: () => ipcRenderer.invoke('plugins:load-patch'),
    savePatch: (yamlText) => ipcRenderer.invoke('plugins:save-patch', { yamlText })
  },
  events: {
    onLog: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('log:append', listener);
      return () => ipcRenderer.removeListener('log:append', listener);
    },
    onProcessState: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('process:state', listener);
      return () => ipcRenderer.removeListener('process:state', listener);
    }
  }
});
