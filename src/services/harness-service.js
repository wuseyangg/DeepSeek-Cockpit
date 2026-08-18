const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const { runCommand, spawnManagedProcess } = require('./command-runner');

let activeWebProcess = null;
let currentWebState = {
  state: 'stopped',
  pid: null,
  url: null,
  port: 3080,
  exitCode: null,
  error: null
};

function isWebRunning() {
  return currentWebState.state === 'running' || currentWebState.state === 'starting';
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function preflight(config = {}) {
  const issues = [];
  let nodeOk = false;
  let nodeVersion = null;
  let pnpmOk = false;
  let pnpmVersion = null;
  let gitOk = false;
  let repoValid = false;
  let depsInstalled = false;
  let buildArtifactsExist = false;

  // 1. 检查 Node.js
  try {
    const res = await runCommand('node', ['-v']);
    if (res.ok) {
      nodeVersion = res.stdout.trim();
      const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
      nodeOk = major >= 18;
      if (!nodeOk) issues.push(`Node.js 版本过低 (${nodeVersion})，建议使用 Node.js >= 20`);
    } else {
      issues.push('未检测到 Node.js 环境');
    }
  } catch {
    issues.push('检测 Node.js 失败');
  }

  // 2. 检查 pnpm
  try {
    const res = await runCommand('pnpm', ['-v']);
    if (res.ok) {
      pnpmVersion = res.stdout.trim();
      pnpmOk = true;
    } else {
      issues.push('未检测到 pnpm 包管理器');
    }
  } catch {
    issues.push('检测 pnpm 失败');
  }

  // 3. 检查 git
  try {
    const res = await runCommand('git', ['--version']);
    gitOk = res.ok;
    if (!gitOk) issues.push('未检测到 Git 命令');
  } catch {
    issues.push('检测 Git 失败');
  }

  // 4. 检查 Harness 代码目录
  const hPath = config.harnessPath;
  if (hPath) {
    const hasPkg = await fileExists(path.join(hPath, 'package.json'));
    const hasGit = await fileExists(path.join(hPath, '.git'));
    repoValid = hasPkg && hasGit;
    if (!repoValid) {
      issues.push('Harness 目录无效（缺少 package.json 或 .git）');
    } else {
      depsInstalled = await fileExists(path.join(hPath, 'node_modules'));
      if (!depsInstalled) issues.push('依赖尚未安装，请执行“安装依赖并编译”');

      // 检查产物（检查 packages/*/lib 或 apps/web/dist 等）
      const webDist = await fileExists(path.join(hPath, 'apps', 'web', 'dist'));
      const coreLib = await fileExists(path.join(hPath, 'packages', 'core', 'lib'));
      buildArtifactsExist = webDist || coreLib || depsInstalled;
    }
  } else {
    issues.push('未指定 Harness 仓库目录');
  }

  const canStart = nodeOk && pnpmOk && repoValid && depsInstalled;

  return {
    nodeOk,
    nodeVersion,
    pnpmOk,
    pnpmVersion,
    gitOk,
    repoValid,
    depsInstalled,
    buildArtifactsExist,
    canStart,
    issues
  };
}

async function prepare(config = {}, broadcastLog = null) {
  const onLog = broadcastLog ? (line, type) => broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'prepare') : null;
  const hPath = config.harnessPath;
  if (!hPath) {
    return { ok: false, stderr: '请先配置 Harness 目录' };
  }

  if (onLog) onLog('正在执行 pnpm install ...', 'stdout');
  const installRes = await runCommand('pnpm', ['install'], { cwd: hPath, onLog });
  if (!installRes.ok) {
    return installRes;
  }

  if (onLog) onLog('正在执行 pnpm run build ...', 'stdout');
  const buildRes = await runCommand('pnpm', ['run', 'build'], { cwd: hPath, onLog });
  return buildRes;
}

function pollHttpReadiness(url, isAliveCheck, maxWaitMs = 30000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let timer = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const isReadyStatus = (code) => code >= 200 && code < 400;
    // 拿到首个 2xx/3xx 后给首屏编译留出的缓冲窗口，避免被 Vite/Hono 等
    // 在编译首屏时返回的中间 200/占位页误导为"已就绪"。
    const settleMs = 500;

    const check = () => {
      if (finished) return;

      // 1. 每次检查前确认子进程依然处于运行状态
      if (isAliveCheck && !isAliveCheck()) {
        cleanup();
        return reject(new Error('Web 进程已异常退出，未能成功启动'));
      }

      // 2. 超时判断
      if (Date.now() - startTime >= maxWaitMs) {
        cleanup();
        return reject(new Error(`等待服务就绪超时 (${maxWaitMs / 1000}s)`));
      }

      // 3. HTTP 探测
      try {
        const req = http.get(url, (res) => {
          // 排空响应体以便 socket 复用
          res.resume();

          if (!isReadyStatus(res.statusCode)) {
            // 4xx/5xx 通常意味着服务端仍在编译首屏或挂载中间件，
            // 按"未就绪"继续探测，不要让任何响应都误判为就绪。
            if (finished) return;
            timer = setTimeout(check, 500);
            return;
          }

          // 首次拿到 2xx/3xx：清掉 pending 探测定时器（不要立刻 finished=true，
          // 否则下面 settle 定时器回调里的 `if (finished) return` 会吞掉 resolve）。
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            timer = null;
            resolve(true);
          }, settleMs);
        });

        req.on('error', () => {
          if (finished) return;
          timer = setTimeout(check, 500);
        });

        req.setTimeout(1500, () => {
          req.destroy();
        });
      } catch {
        if (finished) return;
        timer = setTimeout(check, 500);
      }
    };

    timer = setTimeout(check, 400);
  });
}

async function startWeb(config = {}, port = 3080, broadcastLog = null, broadcastState = null) {
  if (isWebRunning()) {
    return currentWebState;
  }

  const hPath = config.harnessPath;
  if (!hPath) {
    currentWebState = { state: 'failed', pid: null, url: null, port, exitCode: null, error: '未配置 Harness 路径' };
    if (broadcastState) broadcastState(currentWebState);
    return currentWebState;
  }

  const targetPort = port || (config.web && config.web.port) || 3080;
  const url = `http://127.0.0.1:${targetPort}`;

  currentWebState = {
    state: 'starting',
    pid: null,
    url,
    port: targetPort,
    exitCode: null,
    error: null
  };
  if (broadcastState) broadcastState(currentWebState);

  const onLog = (line, type) => {
    if (broadcastLog) broadcastLog(type === 'stderr' ? 'warn' : 'info', line, 'web');
  };

  try {
    let hasExited = false;
    let exitError = null;

    activeWebProcess = spawnManagedProcess('pnpm', ['dsh', 'web', '--port', targetPort.toString()], {
      cwd: hPath,
      onLog,
      onExit: (code) => {
        hasExited = true;
        exitError = code !== 0 ? `Web 进程异常退出 (code: ${code})` : null;
        currentWebState = {
          state: 'stopped',
          pid: null,
          url: null,
          port: targetPort,
          exitCode: code,
          error: exitError
        };
        activeWebProcess = null;
        if (broadcastState) broadcastState(currentWebState);
      }
    });

    await activeWebProcess.ready;
    currentWebState.pid = activeWebProcess.pid;

    // 探活：等待 HTTP 端口完全就绪，并实时监测进程存活
    try {
      await pollHttpReadiness(url, () => !hasExited && activeWebProcess && activeWebProcess.isRunning, 30000);

      if (hasExited || !activeWebProcess || !activeWebProcess.isRunning) {
        throw new Error(exitError || 'Web 进程已异常退出');
      }

      currentWebState.state = 'running';
      if (broadcastState) broadcastState(currentWebState);
      return currentWebState;
    } catch (pollErr) {
      if (activeWebProcess && activeWebProcess.isRunning) {
        await activeWebProcess.stop();
        activeWebProcess = null;
      }
      currentWebState = {
        state: 'failed',
        pid: null,
        url: null,
        port: targetPort,
        exitCode: currentWebState.exitCode,
        error: exitError || pollErr.message || '启动探活超时'
      };
      if (broadcastState) broadcastState(currentWebState);
      return currentWebState;
    }
  } catch (err) {
    currentWebState = {
      state: 'failed',
      pid: null,
      url: null,
      port: targetPort,
      exitCode: null,
      error: err.message
    };
    if (broadcastState) broadcastState(currentWebState);
    return currentWebState;
  }
}

async function stopWeb(broadcastLog = null, broadcastState = null) {
  if (activeWebProcess) {
    if (broadcastLog) broadcastLog('info', '正在停止 Web 服务...', 'web');
    await activeWebProcess.stop();
    activeWebProcess = null;
  }

  currentWebState = {
    state: 'stopped',
    pid: null,
    url: null,
    port: currentWebState.port,
    exitCode: 0,
    error: null
  };
  if (broadcastState) broadcastState(currentWebState);
  return { ok: true };
}

async function restartWeb(config = {}, port = 3080, broadcastLog = null, broadcastState = null) {
  await stopWeb(broadcastLog, broadcastState);
  await new Promise((r) => setTimeout(r, 600));
  return await startWeb(config, port, broadcastLog, broadcastState);
}

module.exports = {
  isWebRunning,
  preflight,
  prepare,
  startWeb,
  stopWeb,
  restartWeb,
  // 暴露以供测试：验证"5xx 不算就绪 + 首次 2xx 后缓冲"行为。
  // 不要在生产代码中直接依赖此函数。
  _pollHttpReadiness: pollHttpReadiness
};
