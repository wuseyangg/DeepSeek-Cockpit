const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

function resolveDshHome(config = {}) {
  if (config && config.dshHome && typeof config.dshHome === 'string') {
    return path.normalize(config.dshHome);
  }
  if (process.env.DSH_HOME) {
    return path.normalize(process.env.DSH_HOME);
  }
  return path.join(os.homedir(), '.dsh');
}

function resolveProfileDir(config = {}, profileName = 'web') {
  const dshHome = resolveDshHome(config);
  return path.join(dshHome, 'profiles', profileName);
}

async function isExecutableFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveExecutable(name) {
  // 如果已经是绝对路径且存在
  if (path.isAbsolute(name) && (await isExecutableFile(name))) {
    return name;
  }

  const isWin = process.platform === 'win32';
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  const extensions = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return name; // fallback
}

module.exports = {
  resolveDshHome,
  resolveProfileDir,
  resolveExecutable
};
