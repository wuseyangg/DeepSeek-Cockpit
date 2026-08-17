const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const YAML = require('yaml');
const { resolveProfileDir, resolveDshHome } = require('./path-resolver');
const { runCommand } = require('./command-runner');
const { validateAndNormalizeSource } = require('./plugin-source');

function getBackupRootDir() {
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  return path.join(appData, 'DeepSeek-Cockpit', 'backups');
}

async function backupProfileState(config = {}) {
  const profileDir = resolveProfileDir(config, 'web');
  const backupRootDir = getBackupRootDir();
  const timestamp = Date.now();
  const currentBackupDir = path.join(backupRootDir, `${timestamp}`);

  await fs.mkdir(currentBackupDir, { recursive: true });

  const filesToBackup = ['package.json', 'pnpm-lock.yaml', 'dsh.profile', 'pnpm-workspace.yaml', 'cordis.patch.yml'];
  for (const filename of filesToBackup) {
    const srcFile = path.join(profileDir, filename);
    try {
      const data = await fs.readFile(srcFile);
      await fs.writeFile(path.join(currentBackupDir, filename), data);
    } catch {
      // 文件可能不存在，跳过
    }
  }

  // 只保留最近 10 次备份
  try {
    const entries = await fs.readdir(backupRootDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => ({ name: e.name, time: parseInt(e.name, 10) }))
      .sort((a, b) => b.time - a.time);

    if (dirs.length > 10) {
      const toDelete = dirs.slice(10);
      for (const d of toDelete) {
        await fs.rm(path.join(backupRootDir, d.name), { recursive: true, force: true });
      }
    }
  } catch {
    // 忽略清理异常
  }

  return currentBackupDir;
}

async function listPlugins(config = {}) {
  const profileDir = resolveProfileDir(config, 'web');
  const pkgPath = path.join(profileDir, 'package.json');
  const dshHome = resolveDshHome(config);

  let pkg = {};
  try {
    const data = await fs.readFile(pkgPath, 'utf8');
    pkg = JSON.parse(data);
  } catch {
    return [];
  }

  const dependencies = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {})
  };

  // 读取 allowBuilds
  let allowBuildsMap = {};
  try {
    const workspaceYamlPath = path.join(profileDir, 'pnpm-workspace.yaml');
    const wsData = await fs.readFile(workspaceYamlPath, 'utf8');
    const wsParsed = YAML.parse(wsData) || {};
    allowBuildsMap = wsParsed.allowBuilds || {};
  } catch {
    // optional
  }

  const result = [];
  for (const [name, version] of Object.entries(dependencies)) {
    const isBundle = name.startsWith('@deepseek/bundle-') || name.includes('bundle');
    const isBuiltin = name.startsWith('@deepseek/bundle-web');
    const buildApproved = allowBuildsMap[name] !== false;

    result.push({
      name,
      version,
      source: version,
      isBundle,
      isBuiltin,
      buildApproved
    });
  }

  return result;
}

async function addPlugin(config = {}, source, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'plugin') : null;
  const validated = await validateAndNormalizeSource(source);
  if (!validated.valid) {
    return { ok: false, stderr: validated.error };
  }

  const hPath = config.harnessPath;
  if (!hPath) {
    return { ok: false, stderr: '未配置 Harness 路径' };
  }

  await backupProfileState(config);

  if (onLog) onLog(`正在安装插件: ${validated.normalized} ...`, 'stdout');
  return await runCommand('pnpm', ['dsh', 'plugin', '--profile', 'web', 'add', validated.normalized], {
    cwd: hPath,
    onLog
  });
}

async function removePlugin(config = {}, packageName, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'plugin') : null;
  const hPath = config.harnessPath;
  if (!hPath) {
    return { ok: false, stderr: '未配置 Harness 路径' };
  }

  await backupProfileState(config);

  if (onLog) onLog(`正在移除插件: ${packageName} ...`, 'stdout');
  return await runCommand('pnpm', ['dsh', 'plugin', '--profile', 'web', 'remove', packageName], {
    cwd: hPath,
    onLog
  });
}

async function updatePlugin(config = {}, packageName, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'plugin') : null;
  const hPath = config.harnessPath;
  if (!hPath) {
    return { ok: false, stderr: '未配置 Harness 路径' };
  }

  await backupProfileState(config);

  if (onLog) onLog(`正在更新插件: ${packageName} ...`, 'stdout');
  return await runCommand('pnpm', ['dsh', 'plugin', '--profile', 'web', 'update', packageName], {
    cwd: hPath,
    onLog
  });
}

async function approveBuilds(config = {}, packageNames = [], broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'pnpm') : null;
  const profileDir = resolveProfileDir(config, 'web');
  if (!packageNames || packageNames.length === 0) {
    return { ok: true };
  }

  if (onLog) onLog(`正在授权构建脚本: ${packageNames.join(', ')} ...`, 'stdout');
  return await runCommand('pnpm', ['approve-builds', ...packageNames], {
    cwd: profileDir,
    onLog
  });
}

async function loadPatch(config = {}) {
  const profileDir = resolveProfileDir(config, 'web');
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  try {
    const content = await fs.readFile(patchPath, 'utf8');
    return { content, exists: true };
  } catch {
    return { content: '', exists: false };
  }
}

async function savePatch(config = {}, yamlText, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'patch') : null;
  
  // 1. 内存 YAML 解析校验
  try {
    YAML.parse(yamlText);
  } catch (parseErr) {
    const lineInfo = parseErr.linePos ? ` (行 ${parseErr.linePos[0].line}, 列 ${parseErr.linePos[0].col})` : '';
    return {
      ok: false,
      error: `YAML 语法错误${lineInfo}: ${parseErr.message}`
    };
  }

  const profileDir = resolveProfileDir(config, 'web');
  await fs.mkdir(profileDir, { recursive: true });
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  const bakPath = `${patchPath}.bak`;

  // 2. 备份现有文件
  try {
    const existing = await fs.readFile(patchPath);
    await fs.writeFile(bakPath, existing);
  } catch {
    // 首次创建，无旧文件
  }

  // 3. 写入临时文件并原子替换
  const tmpPath = `${patchPath}.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, yamlText, 'utf8');
  await fs.rename(tmpPath, patchPath);

  // 4. 执行 dump-config 校验（如果已配置 Harness 仓库）
  const hPath = config.harnessPath;
  if (hPath) {
    if (onLog) onLog('正在执行 pnpm dsh --profile web --dump-config 进行补丁校验...', 'stdout');
    const dumpRes = await runCommand('pnpm', ['dsh', '--profile', 'web', '--dump-config'], {
      cwd: hPath,
      onLog
    });

    if (!dumpRes.ok) {
      // 校验失败 -> 自动用 .bak 恢复
      try {
        const bakData = await fs.readFile(bakPath);
        await fs.writeFile(patchPath, bakData);
      } catch {
        // 如果原本就没有，删除新写入的无效 patch
        try { await fs.unlink(patchPath); } catch {}
      }

      return {
        ok: false,
        error: 'Harness dump-config 校验失败，配置已自动恢复原状',
        dumpOutput: `${dumpRes.stdout}\n${dumpRes.stderr}`
      };
    }
  }

  return { ok: true };
}

module.exports = {
  getBackupRootDir,
  backupProfileState,
  listPlugins,
  addPlugin,
  removePlugin,
  updatePlugin,
  approveBuilds,
  loadPatch,
  savePatch
};
