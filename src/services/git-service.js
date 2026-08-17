const path = require('node:path');
const fs = require('node:fs/promises');
const { runCommand } = require('./command-runner');

async function isGitDirectory(dirPath) {
  if (!dirPath) return false;
  try {
    const gitDir = path.join(dirPath, '.git');
    const stat = await fs.stat(gitDir);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function inspectRepo(harnessPath, remoteName = 'origin') {
  if (!harnessPath) {
    return {
      valid: false,
      path: '',
      branch: null,
      commit: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      changes: [],
      canSync: false,
      message: '尚未配置 Harness 路径'
    };
  }

  const isGit = await isGitDirectory(harnessPath);
  if (!isGit) {
    return {
      valid: false,
      path: harnessPath,
      branch: null,
      commit: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      changes: [],
      canSync: false,
      message: '指定目录不是有效的 Git 仓库 (.git 不存在)'
    };
  }

  // 1. 获取当前分支
  const branchRes = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: harnessPath });
  const branch = branchRes.ok ? branchRes.stdout.trim() : null;

  // 2. 获取当前 HEAD commit
  const commitRes = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: harnessPath });
  const commit = commitRes.ok ? commitRes.stdout.trim() : null;

  // 3. 检查工作区修改
  const statusRes = await runCommand('git', ['status', '--porcelain=v1'], { cwd: harnessPath });
  const changes = statusRes.ok && statusRes.stdout.trim()
    ? statusRes.stdout.trim().split(/\r?\n/).filter(Boolean)
    : [];
  const dirty = changes.length > 0;

  // 4. 获取上游追踪分支
  const upstreamRes = await runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: harnessPath });
  const upstream = upstreamRes.ok ? upstreamRes.stdout.trim() : null;

  let ahead = 0;
  let behind = 0;

  if (upstream) {
    const countsRes = await runCommand('git', ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], { cwd: harnessPath });
    if (countsRes.ok) {
      const parts = countsRes.stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    }
  }

  let canSync = false;
  let message = null;

  if (dirty) {
    canSync = false;
    message = '工作区存在未提交的更改，已禁止同步';
  } else if (!upstream) {
    canSync = false;
    message = '未配置上游远程跟踪分支';
  } else if (ahead > 0 && behind > 0) {
    canSync = false;
    message = `本地与远程发生分叉 (领先 ${ahead}，落后 ${behind})，需手动处理`;
  } else if (behind > 0) {
    canSync = true;
    message = `发现 ${behind} 个新提交，可进行安全同步`;
  } else {
    canSync = false;
    message = '当前已是最新版本';
  }

  return {
    valid: true,
    path: harnessPath,
    branch,
    commit,
    upstream,
    ahead,
    behind,
    dirty,
    changes,
    canSync,
    message
  };
}

async function cloneRepo(targetDir, remoteUrl, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'git') : null;
  return await runCommand('git', ['clone', remoteUrl, targetDir], { onLog });
}

async function fetchRepo(harnessPath, remoteName = 'origin', broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'git') : null;
  return await runCommand('git', ['fetch', '--prune', remoteName], { cwd: harnessPath, onLog });
}

async function syncRepo(harnessPath, remoteName = 'origin', branch = null, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'git') : null;
  const snapshot = await inspectRepo(harnessPath, remoteName);
  if (!snapshot.canSync) {
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: snapshot.message || '当前状态不允许安全快进同步',
      errorCode: 'SYNC_BLOCKED'
    };
  }

  const targetBranch = branch || snapshot.branch;
  return await runCommand('git', ['pull', '--ff-only', remoteName, targetBranch], { cwd: harnessPath, onLog });
}

module.exports = {
  inspectRepo,
  cloneRepo,
  fetchRepo,
  syncRepo
};
