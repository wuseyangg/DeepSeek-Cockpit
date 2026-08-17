const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  harnessPath: null,
  remoteUrl: 'https://github.com/deepseek-ai/deepseek-harness.git',
  remoteName: 'origin',
  branch: null,
  web: {
    port: 3080,
    autoOpenBrowser: true
  },
  dshHome: null
};

class ConfigStore {
  constructor(customPath = null) {
    if (customPath) {
      this.configPath = customPath;
    } else {
      const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
      this.configPath = path.join(appData, 'DeepSeek-Cockpit', 'config.json');
    }
  }

  async ensureDir() {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
  }

  async loadConfig() {
    await this.ensureDir();
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        web: {
          ...DEFAULT_CONFIG.web,
          ...(parsed.web || {})
        }
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        await this.saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
      }
      // JSON 损坏或格式错误 -> 备份为 .invalid 并重置为默认配置
      try {
        const invalidBackupPath = `${this.configPath}.invalid.${Date.now()}`;
        await fs.rename(this.configPath, invalidBackupPath);
      } catch {
        // 忽略重命名失败
      }
      await this.saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(partial) {
    await this.ensureDir();
    let current = {};
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      current = JSON.parse(data);
    } catch {
      current = { ...DEFAULT_CONFIG };
    }

    const merged = {
      ...DEFAULT_CONFIG,
      ...current,
      ...partial,
      web: {
        ...DEFAULT_CONFIG.web,
        ...(current.web || {}),
        ...((partial && partial.web) || {})
      }
    };

    // 端口合法性保证
    if (typeof merged.web.port !== 'number' || merged.web.port < 1024 || merged.web.port > 65535) {
      merged.web.port = DEFAULT_CONFIG.web.port;
    }

    // 原子写入：先写入临时文件，再重命名
    const tempPath = `${this.configPath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(merged, null, 2), 'utf8');
    await fs.rename(tempPath, this.configPath);

    return merged;
  }
}

const defaultStore = new ConfigStore();

module.exports = {
  ConfigStore,
  DEFAULT_CONFIG,
  loadConfig: (cfgPath) => (cfgPath ? new ConfigStore(cfgPath).loadConfig() : defaultStore.loadConfig()),
  saveConfig: (partial, cfgPath) => (cfgPath ? new ConfigStore(cfgPath).saveConfig(partial) : defaultStore.saveConfig(partial))
};
