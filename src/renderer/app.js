// 渲染层全局控制器
let currentConfig = null;
let webProcessState = { state: 'stopped', port: 3080, url: null, pid: null };
let uptimeTimerId = null;
let uptimeStartTs = null;

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initSubTabs();
  initLogListener();
  initProcessStateListener();
  await loadInitialConfig();
  initInstallView();
  initLauncherView();
  initPluginsView();
  initMarketControls();
});

// 1. 主导航切换
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const viewPanels = document.querySelectorAll('.view-panel');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      navButtons.forEach(b => b.classList.remove('active'));
      viewPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(`view-${tabName}`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

// 2. 插件子标签切换
function initSubTabs() {
  const subTabBtns = document.querySelectorAll('.sub-tab-btn');
  const subTabContents = document.querySelectorAll('.subtab-content');

  subTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      subTabBtns.forEach(b => b.classList.remove('active'));
      subTabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(`subtab-${subtab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      if (subtab === 'plugins-catalog') {
        renderCatalog();
      }
    });
  });
}

// 3. 日志与进程状态监听
function initLogListener() {
  const terminal = document.getElementById('terminal-logs');
  const modalTerminal = document.getElementById('modal-terminal-logs');
  const installModal = document.getElementById('plugin-install-modal');
  const statusMsg = document.getElementById('status-latest-msg');

  window.cockpit.events.onLog((log) => {
    const line = `[${log.timestamp || new Date().toLocaleTimeString()}] [${log.source || 'sys'}] ${log.message}\n`;
    if (terminal) {
      terminal.textContent += line;
      terminal.scrollTop = terminal.scrollHeight;
    }
    if (installModal && installModal.style.display !== 'none' && modalTerminal) {
      if (log.source === 'plugin' || log.source === 'pnpm' || log.source === 'system') {
        const ts = log.timestamp || new Date().toLocaleTimeString();
        modalTerminal.appendChild(document.createTextNode(`[${ts}] ${log.message}\n`));
        modalTerminal.scrollTop = modalTerminal.scrollHeight;
      }
    }
    if (statusMsg && log.message) {
      statusMsg.textContent = log.message.slice(0, 50);
    }
  });

  const btnClear = document.getElementById('btn-clear-logs');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (terminal) terminal.textContent = '';
    });
  }

  const btnCopyModal = document.getElementById('btn-copy-modal-logs');
  if (btnCopyModal) {
    btnCopyModal.addEventListener('click', async () => {
      if (!modalTerminal) return;
      try {
        await navigator.clipboard.writeText(modalTerminal.textContent);
        const original = btnCopyModal.textContent;
        btnCopyModal.textContent = '已复制';
        setTimeout(() => { btnCopyModal.textContent = original; }, 1200);
      } catch (err) {
        console.error('复制失败:', err);
      }
    });
  }

  const btnToggleLogs = document.getElementById('btn-toggle-logs');
  if (btnToggleLogs && terminal) {
    btnToggleLogs.addEventListener('click', () => {
      terminal.classList.toggle('collapsed');
      btnToggleLogs.textContent = terminal.classList.contains('collapsed') ? '展开' : '隐藏';
    });
  }
}

// 4. 进程状态 → UI
function initProcessStateListener() {
  window.cockpit.events.onProcessState((state) => {
    updateLauncherUIState(state);
  });
}

function updateLauncherUIState(state) {
  webProcessState = state;
  const port = state.port || 3080;

  // 底部状态栏 (兼容旧)
  const ind = document.getElementById('status-web-indicator');
  const txt = document.getElementById('status-web-text');
  if (ind && txt) {
    ind.className = `dot dot-${state.state}`;
    if (state.state === 'running') txt.textContent = `Web: 运行中 (:${port})`;
    else if (state.state === 'starting') txt.textContent = 'Web: 正在启动...';
    else if (state.state === 'failed') txt.textContent = 'Web: 启动失败';
    else txt.textContent = 'Web: 已停止';
  }

  // 启动器顶栏
  const dot = document.getElementById('launcher-status-dot');
  const stText = document.getElementById('launcher-status-text');
  const stMeta = document.getElementById('launcher-status-meta');
  const pidLabel = document.getElementById('launcher-pid-label');
  const pidVal = document.getElementById('launcher-pid');
  const cmdPort = document.getElementById('launcher-cmd-port');

  if (dot) dot.className = `status-dot ${state.state}`;
  if (cmdPort) cmdPort.textContent = String(port);
  if (stMeta) stMeta.textContent = `端口 :${port}`;

  if (stText) {
    if (state.state === 'running') stText.textContent = '运行中';
    else if (state.state === 'starting') stText.textContent = '启动中';
    else if (state.state === 'failed') stText.textContent = '启动失败';
    else stText.textContent = '已停止';
  }

  // PID
  if (state.state === 'running' && state.pid) {
    if (pidLabel) pidLabel.style.display = 'inline-flex';
    if (pidVal) pidVal.textContent = String(state.pid);
  } else {
    if (pidLabel) pidLabel.style.display = 'none';
  }

  // 按钮启停
  const btnRun = document.getElementById('btn-run-main');
  const btnRestart = document.getElementById('btn-restart-main');
  const btnStop = document.getElementById('btn-stop-main');
  const btnOpen = document.getElementById('btn-open-main');

  const isRunning = state.state === 'running';
  const isStarting = state.state === 'starting';

  if (btnRun) btnRun.disabled = isRunning || isStarting;
  if (btnRestart) btnRestart.disabled = !isRunning;
  if (btnStop) btnStop.disabled = !isRunning && !isStarting;
  if (btnOpen) btnOpen.disabled = !isRunning || !state.url;

  // Uptime timer
  if (isRunning) {
    if (!uptimeTimerId) {
      uptimeStartTs = Date.now();
      uptimeTimerId = setInterval(updateUptimeDisplay, 1000);
      updateUptimeDisplay();
    }
  } else {
    if (uptimeTimerId) {
      clearInterval(uptimeTimerId);
      uptimeTimerId = null;
      uptimeStartTs = null;
      const upEl = document.getElementById('launcher-uptime');
      if (upEl) upEl.textContent = '';
    }
  }
}

function updateUptimeDisplay() {
  const upEl = document.getElementById('launcher-uptime');
  if (!upEl || !uptimeStartTs) return;
  const secs = Math.floor((Date.now() - uptimeStartTs) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  upEl.textContent = `已运行 ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 5. 配置加载
async function loadInitialConfig() {
  try {
    currentConfig = await window.cockpit.config.load();
    const repoInput = document.getElementById('repo-path-input');
    const statusRepo = document.getElementById('status-repo-path');
    const installPath = document.getElementById('install-repo-path');
    const portInput = document.getElementById('web-port-input');
    const autoOpenCheck = document.getElementById('web-auto-open');

    if (currentConfig.harnessPath) {
      if (repoInput) repoInput.value = currentConfig.harnessPath;
      if (statusRepo) statusRepo.textContent = currentConfig.harnessPath;
      if (installPath) installPath.textContent = currentConfig.harnessPath;
    } else {
      if (statusRepo) statusRepo.textContent = '未配置';
      if (installPath) installPath.textContent = '未配置路径';
    }

    if (currentConfig.web) {
      if (portInput) portInput.value = currentConfig.web.port || 3080;
      if (autoOpenCheck) autoOpenCheck.checked = currentConfig.web.autoOpenBrowser !== false;
    }

    // 同步启动器端口显示
    const cmdPort = document.getElementById('launcher-cmd-port');
    const stMeta = document.getElementById('launcher-status-meta');
    if (cmdPort && portInput) cmdPort.textContent = portInput.value;
    if (stMeta && portInput) stMeta.textContent = `端口 :${portInput.value}`;

    if (currentConfig.harnessPath) {
      await refreshRepoStatus();
      await runPreflightCheck();
      await refreshPluginsList();
    }
  } catch (err) {
    console.error('Failed to load initial config:', err);
  }
}

// 6. 安装视图 (path + git + preflight)
function initInstallView() {
  const btnBrowse = document.getElementById('btn-browse-repo');
  const btnClone = document.getElementById('btn-clone-repo');
  const btnFetch = document.getElementById('btn-fetch-repo');
  const btnSync = document.getElementById('btn-sync-repo');
  const btnRecheck = document.getElementById('btn-recheck-preflight');
  const btnPrepare = document.getElementById('btn-prepare-harness');

  if (btnBrowse) {
    btnBrowse.addEventListener('click', async () => {
      const selected = await window.cockpit.repo.pickDirectory();
      if (selected) {
        await window.cockpit.config.save({ harnessPath: selected });
        await loadInitialConfig();
      }
    });
  }

  if (btnClone) {
    btnClone.addEventListener('click', async () => {
      const targetDir = await window.cockpit.repo.pickDirectory();
      if (!targetDir) return;
      const remote = currentConfig?.remoteUrl || 'https://github.com/deepseek-ai/deepseek-harness.git';
      const confirmed = confirm(`确认克隆 ${remote} 到 ${targetDir} ?`);
      if (!confirmed) return;

      btnClone.disabled = true;
      try {
        const res = await window.cockpit.repo.clone(targetDir, remote);
        if (res.ok) {
          await window.cockpit.config.save({ harnessPath: targetDir });
          await loadInitialConfig();
          alert('克隆成功!');
        } else {
          alert(`克隆失败: ${res.stderr || res.stdout || '未知错误'}`);
        }
      } finally {
        btnClone.disabled = false;
      }
    });
  }

  if (btnFetch) {
    btnFetch.addEventListener('click', async () => {
      btnFetch.disabled = true;
      try {
        await window.cockpit.repo.fetch();
        await refreshRepoStatus();
      } finally {
        btnFetch.disabled = false;
      }
    });
  }

  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      btnSync.disabled = true;
      try {
        const res = await window.cockpit.repo.sync();
        if (res.ok) {
          alert('同步成功!');
        } else {
          alert(`同步失败: ${res.stderr || '请检查 Git 状态'}`);
        }
        await refreshRepoStatus();
      } finally {
        btnSync.disabled = false;
      }
    });
  }

  if (btnRecheck) {
    btnRecheck.addEventListener('click', async () => {
      await runPreflightCheck();
    });
  }

  if (btnPrepare) {
    btnPrepare.addEventListener('click', async () => {
      const ok = confirm('将执行 pnpm install && pnpm run build, 可能需要几分钟, 是否继续?');
      if (!ok) return;
      btnPrepare.disabled = true;
      try {
        const res = await window.cockpit.web.prepare();
        if (res.ok) {
          alert('依赖安装与编译完成!');
        } else {
          alert(`编译失败: ${res.stderr || '请查看终端日志'}`);
        }
        await runPreflightCheck();
      } finally {
        btnPrepare.disabled = false;
      }
    });
  }
}

async function refreshRepoStatus() {
  try {
    const status = await window.cockpit.repo.inspect();
    const branchEl = document.getElementById('repo-branch');
    const commitEl = document.getElementById('repo-commit');
    const upstreamEl = document.getElementById('repo-upstream');
    const syncDiffEl = document.getElementById('repo-sync-diff');
    const dirtyWarn = document.getElementById('repo-dirty-warning');
    const dirtyList = document.getElementById('repo-dirty-list');
    const btnSync = document.getElementById('btn-sync-repo');

    if (!status.valid) {
      if (branchEl) branchEl.textContent = '无效';
      if (commitEl) commitEl.textContent = '-';
      if (upstreamEl) upstreamEl.textContent = '-';
      if (syncDiffEl) syncDiffEl.textContent = status.message || '未检测到 Git 仓库';
      if (dirtyWarn) dirtyWarn.style.display = 'none';
      if (btnSync) btnSync.disabled = true;
      return;
    }

    if (branchEl) branchEl.textContent = status.branch || '游离';
    if (commitEl) commitEl.textContent = status.commit ? status.commit.slice(0, 7) : '-';
    if (upstreamEl) upstreamEl.textContent = status.upstream || '无上游';

    if (syncDiffEl) {
      if (status.behind > 0) {
        syncDiffEl.textContent = `落后 ${status.behind}`;
        syncDiffEl.style.color = 'var(--warning)';
      } else if (status.ahead > 0) {
        syncDiffEl.textContent = `领先 ${status.ahead}`;
        syncDiffEl.style.color = 'var(--accent)';
      } else {
        syncDiffEl.textContent = '已是最新';
        syncDiffEl.style.color = 'var(--success)';
      }
    }

    if (status.dirty && dirtyWarn && dirtyList) {
      dirtyWarn.style.display = 'block';
      dirtyList.innerHTML = status.changes.map(c => `<li>${c}</li>`).join('');
    } else if (dirtyWarn) {
      dirtyWarn.style.display = 'none';
    }

    if (btnSync) {
      btnSync.disabled = !status.canSync;
    }
  } catch (err) {
    console.error('Failed to refresh repo status:', err);
  }
}

async function runPreflightCheck() {
  const container = document.getElementById('preflight-list');
  if (!container) return;

  try {
    const res = await window.cockpit.web.preflight();
    let html = '';

    html += `<div class="check-item"><span class="indicator">${res.nodeOk ? '✓' : '✗'}</span> Node.js: ${res.nodeVersion || '未找到'}</div>`;
    html += `<div class="check-item"><span class="indicator">${res.pnpmOk ? '✓' : '✗'}</span> pnpm: ${res.pnpmVersion || '未找到'}</div>`;
    html += `<div class="check-item"><span class="indicator">${res.repoValid ? '✓' : '✗'}</span> Harness 仓库路径</div>`;
    html += `<div class="check-item"><span class="indicator">${res.depsInstalled ? '✓' : '!'}</span> node_modules</div>`;
    html += `<div class="check-item"><span class="indicator">${res.buildArtifactsExist ? '✓' : '!'}</span> Web 编译产物</div>`;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="check-item"><span class="indicator">✗</span> 预检错误: ${err.message}</div>`;
  }
}

// 7. 启动器视图 (Run / Stop / Restart / Open + 设置)
function initLauncherView() {
  const portInput = document.getElementById('web-port-input');
  const autoOpenCheck = document.getElementById('web-auto-open');
  const btnRun = document.getElementById('btn-run-main');
  const btnStop = document.getElementById('btn-stop-main');
  const btnRestart = document.getElementById('btn-restart-main');
  const btnOpen = document.getElementById('btn-open-main');

  if (portInput) {
    portInput.addEventListener('change', async () => {
      const val = parseInt(portInput.value, 10);
      if (val >= 1024 && val <= 65535) {
        await window.cockpit.config.save({
          web: { port: val, autoOpenBrowser: autoOpenCheck ? autoOpenCheck.checked : true }
        });
        // 同步启动器显示
        const cmdPort = document.getElementById('launcher-cmd-port');
        const stMeta = document.getElementById('launcher-status-meta');
        if (cmdPort) cmdPort.textContent = String(val);
        if (stMeta) stMeta.textContent = `port :${val}`;
      }
    });
  }

  if (autoOpenCheck) {
    autoOpenCheck.addEventListener('change', async () => {
      const portVal = portInput ? parseInt(portInput.value, 10) : 3080;
      await window.cockpit.config.save({
        web: { port: portVal, autoOpenBrowser: autoOpenCheck.checked }
      });
    });
  }

  if (btnRun) {
    btnRun.addEventListener('click', async () => {
      const port = portInput ? parseInt(portInput.value, 10) : 3080;
      const shouldAutoOpen = autoOpenCheck ? autoOpenCheck.checked : true;
      updateLauncherUIState({ state: 'starting', port, url: null });

      // 持久化保存
      await window.cockpit.config.save({
        web: { port, autoOpenBrowser: shouldAutoOpen }
      });

      const res = await window.cockpit.web.start(port);
      if (res && res.state === 'running') {
        if (shouldAutoOpen && res.url) {
          await window.cockpit.web.open(res.url, true);
        }
      } else {
        const errorMsg = (res && res.error) || 'Web 服务未能正常就绪，请检查日志面板输出';
        updateLauncherUIState({ state: 'failed', port, url: null, error: errorMsg });
        alert(`启动失败: ${errorMsg}`);
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', async () => {
      await window.cockpit.web.stop();
    });
  }

  if (btnRestart) {
    btnRestart.addEventListener('click', async () => {
      const port = portInput ? parseInt(portInput.value, 10) : 3080;
      const shouldAutoOpen = autoOpenCheck ? autoOpenCheck.checked : true;
      updateLauncherUIState({ state: 'starting', port, url: null });

      await window.cockpit.config.save({
        web: { port, autoOpenBrowser: shouldAutoOpen }
      });

      const res = await window.cockpit.web.restart(port);
      if (res && res.state === 'running') {
        if (shouldAutoOpen && res.url) {
          await window.cockpit.web.open(res.url, true);
        }
      } else {
        const errorMsg = (res && res.error) || 'Web 服务未能正常就绪，请检查日志面板输出';
        updateLauncherUIState({ state: 'failed', port, url: null, error: errorMsg });
        alert(`重启失败: ${errorMsg}`);
      }
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener('click', async () => {
      // 防御：必须 state === 'running' 才能开 BrowserWindow，
      // 避免在 starting/failed 时打开一个会空白到需要强刷的窗口。
      if (webProcessState.state === 'running' && webProcessState.url) {
        await window.cockpit.web.open(webProcessState.url, true);
      }
    });
  }
}

// 8. 插件与补丁视图
function initPluginsView() {
  const sourceRadios = document.querySelectorAll('input[name="plugin-source-type"]');
  const groupNpm = document.getElementById('group-npm-spec');
  const groupGit = document.getElementById('group-git-url');
  const groupLocal = document.getElementById('group-local-path');
  const inputNpm = document.getElementById('input-npm-spec');
  const inputGit = document.getElementById('input-git-url');
  const inputLocal = document.getElementById('input-local-path');
  const btnBrowseLocal = document.getElementById('btn-browse-local-plugin');
  const cmdPreview = document.getElementById('install-cmd-preview');
  const btnSubmit = document.getElementById('btn-submit-install-plugin');
  const btnRefresh = document.getElementById('btn-refresh-plugins');

  function updatePreview() {
    const selected = document.querySelector('input[name="plugin-source-type"]:checked')?.value;
    let target = '';
    if (selected === 'npm') target = inputNpm?.value.trim() || '<package-name>';
    if (selected === 'git') {
      const rawGit = inputGit?.value.trim() || '<git-url>';
      // 与 services/plugin-source.js 的规范化保持一致：裸 https:// 自动加 git+ 前缀，
      // 让用户在预览中看到真正会被执行的命令形式。
      target = rawGit.startsWith('https://') ? `git+${rawGit}` : rawGit;
    }
    if (selected === 'local') target = inputLocal?.value.trim() || '<directory-path>';
    // git 模式必须带 -w / --workspace-root，否则 pnpm 11+ 会因 ERR_PNPM_ADDING_TO_ROOT 拒绝写入
    const prefix = selected === 'git' ? '-w ' : '';
    if (cmdPreview) cmdPreview.textContent = `pnpm dsh plugin --profile web add ${prefix}${target}`;
  }

  sourceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const type = radio.value;
      if (groupNpm) groupNpm.style.display = type === 'npm' ? 'block' : 'none';
      if (groupGit) groupGit.style.display = type === 'git' ? 'block' : 'none';
      if (groupLocal) groupLocal.style.display = type === 'local' ? 'block' : 'none';
      updatePreview();
    });
  });

  [inputNpm, inputGit, inputLocal].forEach(inp => {
    if (inp) inp.addEventListener('input', updatePreview);
  });

  if (btnBrowseLocal) {
    btnBrowseLocal.addEventListener('click', async () => {
      const dir = await window.cockpit.repo.pickDirectory();
      if (dir && inputLocal) {
        inputLocal.value = dir;
        updatePreview();
      }
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const selected = document.querySelector('input[name="plugin-source-type"]:checked')?.value;
      let source = null;

      if (selected === 'npm') {
        const spec = inputNpm?.value.trim();
        if (!spec) return alert('请输入 npm 包名');
        source = { kind: 'npm', spec };
      } else if (selected === 'git') {
        const url = inputGit?.value.trim();
        if (!url) return alert('请输入 Git 仓库地址');
        source = { kind: 'git', url, ref: null };
      } else if (selected === 'local') {
        const path = inputLocal?.value.trim();
        if (!path) return alert('请选择本地目录');
        source = { kind: 'local', path };
      }

      if (!source) return;
      await performInstallWithVisualization(source);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', refreshPluginsList);
  }

  const btnOpenWebsite = document.getElementById('btn-open-dsh-website');
  if (btnOpenWebsite) {
    btnOpenWebsite.addEventListener('click', () => {
      window.cockpit.web.open('https://www.dsh.so/zh/');
    });
  }
}

// 9. 插件安装可视化
function showPluginInstallModal(targetSpec) {
  const modal = document.getElementById('plugin-install-modal');
  const targetLabel = document.getElementById('modal-target-spec');
  const terminal = document.getElementById('modal-terminal-logs');
  const statusTag = document.getElementById('modal-terminal-status');
  const resultBanner = document.getElementById('modal-result-banner');
  const loadingInfo = document.getElementById('modal-loading-info');
  const btnDone = document.getElementById('btn-modal-done');
  const btnClose = document.getElementById('btn-close-install-modal');
  const btnApproveRetry = document.getElementById('btn-modal-approve-retry');

  if (targetLabel) targetLabel.textContent = targetSpec;
  if (terminal) terminal.textContent = '';
  if (statusTag) {
    statusTag.textContent = '执行中...';
    statusTag.style.color = '';
  }
  if (resultBanner) {
    resultBanner.style.display = 'none';
    resultBanner.textContent = '';
  }
  if (loadingInfo) loadingInfo.style.display = 'flex';
  if (btnDone) btnDone.style.display = 'none';
  if (btnClose) btnClose.style.display = 'none';
  if (btnApproveRetry) {
    btnApproveRetry.style.display = 'none';
    btnApproveRetry.onclick = null;
  }

  const steps = ['validate', 'backup', 'install', 'finish'];
  steps.forEach(s => {
    const el = document.getElementById(`step-${s}`);
    if (el) el.className = 'step-item';
  });
  const lines = ['1', '2', '3'];
  lines.forEach(l => {
    const el = document.getElementById(`line-${l}`);
    if (el) el.className = 'step-line';
  });

  if (modal) modal.style.display = 'flex';
}

function updateInstallModalStep(stepIndex, state) {
  const stepIds = ['validate', 'backup', 'install', 'finish'];
  const currentId = stepIds[stepIndex - 1];
  const stepEl = document.getElementById(`step-${currentId}`);
  if (stepEl) {
    stepEl.className = `step-item ${state}`;
  }
  if (stepIndex > 1 && state === 'completed') {
    const lineEl = document.getElementById(`line-${stepIndex - 1}`);
    if (lineEl) lineEl.className = 'step-line completed';
  }
}

function appendModalInstallLog(line) {
  const terminal = document.getElementById('modal-terminal-logs');
  if (!terminal) return;
  const time = new Date().toLocaleTimeString();
  terminal.appendChild(document.createTextNode(`[${time}] ${line}\n`));
  terminal.scrollTop = terminal.scrollHeight;
}

function finishPluginInstallModal(success, message) {
  const statusTag = document.getElementById('modal-terminal-status');
  const resultBanner = document.getElementById('modal-result-banner');
  const loadingInfo = document.getElementById('modal-loading-info');
  const btnDone = document.getElementById('btn-modal-done');
  const btnClose = document.getElementById('btn-close-install-modal');
  const btnApproveRetry = document.getElementById('btn-modal-approve-retry');

  if (loadingInfo) loadingInfo.style.display = 'none';
  if (btnDone) btnDone.style.display = 'inline-flex';
  if (btnClose) btnClose.style.display = 'inline-block';
  if (btnApproveRetry) btnApproveRetry.style.display = 'none';

  if (statusTag) {
    statusTag.textContent = success ? '安装成功' : '安装失败';
    statusTag.style.color = '';
  }

  if (resultBanner) {
    resultBanner.style.display = 'block';
    resultBanner.className = `alert ${success ? 'alert-success' : 'alert-warning'}`;
    resultBanner.textContent = message;
  }
}

// 从 pnpm / dsh plugin 的报错里提取需要写入 allowBuilds 的 key（git-tarball 形式）。
// pnpm 11 在错误信息中给出的形如：
//   dshmarket@https://codeload.github.com/dsh-market/dsh-market/tar.gz/<sha>: true
function extractAllowBuildsKey(rawError) {
  if (!rawError) return null;
  // 先匹配 codeload 形式（git-tarball 场景最常见）
  const codeload = /([^\s:]+@https:\/\/codeload\.github\.com\/[^\s:]+):\s*true/i.exec(rawError);
  if (codeload) return codeload[1];
  // 兜底：泛化匹配 <name>@<url>: true
  const generic = /^([^\s:]+@[^\s:]+):\s*true/im.exec(rawError);
  if (generic) return generic[1];
  return null;
}

function closePluginInstallModal() {
  const modal = document.getElementById('plugin-install-modal');
  if (modal) modal.style.display = 'none';
}

async function performInstallWithVisualization(source) {
  const targetSpec = source.spec || source.url || source.path;
  showPluginInstallModal(targetSpec);

  const onDoneClick = async () => {
    closePluginInstallModal();
    const subTabBtns = document.querySelectorAll('.sub-tab-btn');
    const subTabContents = document.querySelectorAll('.subtab-content');
    subTabBtns.forEach(b => b.classList.remove('active'));
    subTabContents.forEach(c => c.classList.remove('active'));
    document.querySelector('.sub-tab-btn[data-subtab="plugins-list"]')?.classList.add('active');
    document.getElementById('subtab-plugins-list')?.classList.add('active');
    await refreshPluginsList();
  };

  const btnDone = document.getElementById('btn-modal-done');
  const btnClose = document.getElementById('btn-close-install-modal');
  if (btnDone) btnDone.onclick = onDoneClick;
  if (btnClose) btnClose.onclick = onDoneClick;

  updateInstallModalStep(1, 'active');
  appendModalInstallLog(`正在校验来源: ${targetSpec} ...`);
  await new Promise(r => setTimeout(r, 200));
  updateInstallModalStep(1, 'completed');

  updateInstallModalStep(2, 'active');
  appendModalInstallLog('正在备份 profile 元数据 ...');
  await new Promise(r => setTimeout(r, 250));
  updateInstallModalStep(2, 'completed');

  updateInstallModalStep(3, 'active');
  appendModalInstallLog(`执行: pnpm dsh plugin --profile web add ${targetSpec} ...`);

  let installRes;
  try {
    installRes = await window.cockpit.plugins.add(source);
  } catch (err) {
    installRes = { ok: false, stderr: err.message };
  }

  if (installRes.ok) {
    updateInstallModalStep(3, 'completed');
    updateInstallModalStep(4, 'active');
    appendModalInstallLog('正在刷新 profile 插件图谱 ...');
    await new Promise(r => setTimeout(r, 200));
    updateInstallModalStep(4, 'completed');

    finishPluginInstallModal(true, `✓ 插件 ${targetSpec} 安装成功!`);
  } else {
    updateInstallModalStep(3, 'error');
    updateInstallModalStep(4, 'error');
    const rawError = `${installRes.stderr || ''}\n${installRes.stdout || ''}`.trim();
    appendModalInstallLog(`[错误] 安装失败: ${rawError || '未知错误'}`);

    let userFriendlyMsg = rawError;
    let extractedKey = null;
    if (source && source.kind === 'git') {
      // pnpm 11+ 默认拦截 git 依赖的构建脚本（prepare / postinstall），要求先在 allowBuilds 中放行。
      // 这是已知流程，dsh plugin 已经把需要写入 allowBuilds 的 key 打印到 stderr。
      if (rawError.includes('allowBuilds') || rawError.includes('PREPARE_PACKAGE') || rawError.includes('IGNORED_BUILDS')) {
        extractedKey = extractAllowBuildsKey(rawError);
        if (extractedKey) {
          userFriendlyMsg = `Git 插件 "${targetSpec}" 已下载，但 pnpm 11 默认拦截其构建脚本.\n💡 检测到需要写入 allowBuilds 的 key:\n   ${extractedKey}\n点击下方「一键授权并重试」可直接写入 pnpm-workspace.yaml 并自动重投安装。`;
        } else {
          userFriendlyMsg = `Git 插件 "${targetSpec}" 已下载，但 pnpm 11 默认拦截其构建脚本.\n💡 请到「已装插件」列表中点击该插件的「授权编译」按钮，然后重新执行安装。\n\n原始错误:\n${rawError}`;
        }
      } else {
        userFriendlyMsg = `无法通过 Git 安装 "${targetSpec}".\n💡 请确认仓库地址存在、可公开访问，且根目录包含有效的 package.json.\n\n原始错误:\n${rawError}`;
      }
    } else if (rawError.includes('404') || rawError.includes('ERR_PNPM_FETCH_404') || rawError.includes('Not Found') || rawError.includes('pnpm failed')) {
      userFriendlyMsg = `未在 npm 源中找到 "${targetSpec}" (404).\n💡 请核对包名拼写.`;
    } else if (rawError.includes('ETIMEDOUT') || rawError.includes('fetch failed')) {
      userFriendlyMsg = `网络超时, 无法拉取 "${targetSpec}".\n💡 请检查网络或 npm 镜像源.`;
    }

    finishPluginInstallModal(false, `✗ 安装失败:\n${userFriendlyMsg}`);

    // 仅当 key 提取成功才提供一键重试按钮
    if (extractedKey) {
      const btnApproveRetry = document.getElementById('btn-modal-approve-retry');
      const loadingInfo = document.getElementById('modal-loading-info');
      const loadingText = document.getElementById('modal-loading-text');
      const btnDoneLocal = document.getElementById('btn-modal-done');
      if (btnApproveRetry) {
        btnApproveRetry.style.display = 'inline-flex';
        btnApproveRetry.disabled = false;
        btnApproveRetry.onclick = async () => {
          btnApproveRetry.disabled = true;
          if (btnDoneLocal) btnDoneLocal.style.display = 'none';
          if (loadingInfo) loadingInfo.style.display = 'flex';
          if (loadingText) loadingText.textContent = '正在写入 allowBuilds 并重试安装 ...';
          appendModalInstallLog(`正在写入 allowBuilds: ${extractedKey}`);

          const approveRes = await window.cockpit.plugins.approveBuilds({ allowBuildKeys: [extractedKey] });
          if (!approveRes || !approveRes.ok) {
            const errText = (approveRes && approveRes.stderr) || '未知错误';
            appendModalInstallLog(`[错误] 写入 allowBuilds 失败: ${errText}`);
            finishPluginInstallModal(false, `✗ 写入 allowBuilds 失败:\n${errText}`);
            return;
          }
          appendModalInstallLog('allowBuilds 写入成功, 重新执行安装 ...');

          let retryRes;
          try {
            retryRes = await window.cockpit.plugins.add(source);
          } catch (err) {
            retryRes = { ok: false, stderr: err.message };
          }
          if (retryRes.ok) {
            finishPluginInstallModal(true, `✓ 插件 ${targetSpec} 安装成功!`);
          } else {
            const retryRaw = `${retryRes.stderr || ''}\n${retryRes.stdout || ''}`.trim();
            appendModalInstallLog(`[错误] 重试仍失败: ${retryRaw || '未知错误'}`);
            finishPluginInstallModal(false, `✗ 重试安装失败:\n${retryRaw}`);
          }
        };
      }
    }
  }
}

async function refreshPluginsList() {
  const tbody = document.getElementById('plugins-table-body');
  if (!tbody) return;

  try {
    const list = await window.cockpit.plugins.list();
    marketState.installedPluginNames = new Set((list || []).map(item => item.name));

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-hint">当前 web profile 暂无已安装的插件.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(item => {
      const typeBadge = item.isBundle ? '<span class="badge badge-success">Bundle</span>' : '<span class="badge badge-info">Package</span>';
      const isBuiltin = item.isBuiltin ? '<span class="badge badge-info">内置</span>' : '';
      const approveStatus = item.buildApproved === false ? '<span class="badge badge-warning">未授权编译</span>' : '<span class="badge badge-success">已通过</span>';

      return `
        <tr>
          <td><strong>${item.name}</strong> ${isBuiltin}</td>
          <td>${item.version || '-'}</td>
          <td>${typeBadge}</td>
          <td>${approveStatus}</td>
          <td>
            ${!item.isBuiltin ? `<button class="btn-text btn-danger" onclick="removePluginAction('${item.name}')">卸载</button>` : '<span style="color:var(--text-dim)">只读</span>'}
            ${item.buildApproved === false ? `<button class="btn-text" onclick="approvePluginAction('${item.name}')">授权编译</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-hint">获取插件列表失败: ${err.message}</td></tr>`;
  }
}

window.removePluginAction = async function(pkgName) {
  const ok = confirm(`确认从 web profile 卸载 ${pkgName} ?`);
  if (!ok) return;
  const res = await window.cockpit.plugins.remove(pkgName);
  if (res.ok) {
    alert('插件已移除');
    await refreshPluginsList();
    if (marketState.rawCatalog) renderCatalog();
  } else {
    alert(`卸载失败: ${res.stderr || '未知错误'}`);
  }
};

window.approvePluginAction = async function(pkgName) {
  const ok = confirm(`向 ${pkgName} 授权运行 build 脚本?\n只向可信赖的插件授予构建权限.`);
  if (!ok) return;
  const res = await window.cockpit.plugins.approveBuilds([pkgName]);
  if (res.ok) {
    alert('授权成功!');
    await refreshPluginsList();
  } else {
    alert(`授权失败: ${res.stderr || '未知错误'}`);
  }
};

// ============================================================
// 10. 插件市场与分类管理系统
// ============================================================

const DEFAULT_CATEGORY_NAMES = {
  ui: { zh: 'UI 增强', en: 'UI Enhancements' },
  theme: { zh: '主题与外观', en: 'Themes & Appearance' },
  model: { zh: '模型与账号接入', en: 'Models & Providers' },
  session: { zh: '会话与消息', en: 'Sessions & Messages' },
  memory: { zh: '记忆', en: 'Memory' },
  tools: { zh: '工具与能力', en: 'Tools & Capabilities' },
  tool: { zh: '工具与能力', en: 'Tools & Capabilities' },
  skill: { zh: '技能包', en: 'Skills' },
  workflow: { zh: '工作流与自动化', en: 'Workflow & Automation' },
  notify: { zh: '通知与集成', en: 'Notifications & Integrations' },
  dev: { zh: '开发与运行时', en: 'Development & Runtime' },
  market: { zh: '插件市场与管理', en: 'Plugin Markets & Managers' },
  fun: { zh: '娱乐', en: 'Just for Fun' },
  core: { zh: '核心插件', en: 'Core Plugins' },
  other: { zh: '其他', en: 'Other' }
};

function getCategoryLabel(categories, catKey) {
  if (!catKey) return '插件';
  const meta = (categories && categories[catKey]) || DEFAULT_CATEGORY_NAMES[catKey];
  if (!meta) return catKey;
  if (typeof meta === 'string') return meta;
  return meta.zh || meta.en || catKey;
}

const marketState = {
  initialized: false,
  rawCatalog: null,
  activeCategory: 'all',
  searchQuery: '',
  sortBy: 'stars',
  currentPage: 1,
  pageSize: 24,
  installedPluginNames: new Set()
};

function initMarketControls() {
  if (marketState.initialized) return;
  marketState.initialized = true;

  const searchInput = document.getElementById('market-search-input');
  const clearBtn = document.getElementById('btn-market-clear-search');
  const sortSelect = document.getElementById('market-sort-select');
  const prevBtn = document.getElementById('btn-market-prev');
  const nextBtn = document.getElementById('btn-market-next');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      marketState.searchQuery = searchInput.value.trim().toLowerCase();
      marketState.currentPage = 1;
      if (clearBtn) clearBtn.style.display = marketState.searchQuery ? 'block' : 'none';
      updateMarketView();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      marketState.searchQuery = '';
      marketState.currentPage = 1;
      clearBtn.style.display = 'none';
      updateMarketView();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      marketState.sortBy = sortSelect.value;
      marketState.currentPage = 1;
      updateMarketView();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (marketState.currentPage > 1) {
        marketState.currentPage--;
        updateMarketView();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      marketState.currentPage++;
      updateMarketView();
    });
  }
}

async function renderCatalog(forceReload = false) {
  const container = document.getElementById('catalog-list');
  const catList = document.getElementById('market-categories-list');
  if (!container) return;

  if (!marketState.rawCatalog || forceReload) {
    try {
      const data = await window.cockpit.plugins.getCatalog();
      if (Array.isArray(data)) {
        marketState.rawCatalog = {
          name: 'awesome-dsh-plugin',
          categories: {},
          plugins: data,
          count: data.length
        };
      } else {
        marketState.rawCatalog = data || { categories: {}, plugins: [] };
      }

      try {
        const list = await window.cockpit.plugins.list();
        marketState.installedPluginNames = new Set((list || []).map(item => item.name));
      } catch {
        marketState.installedPluginNames = new Set();
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-hint">加载插件市场失败: ${err.message}</div>`;
      return;
    }
  }

  const catalog = marketState.rawCatalog || { categories: {}, plugins: [] };
  const categories = catalog.categories || {};
  const plugins = catalog.plugins || [];

  const counts = { all: plugins.length };
  const presentCategories = new Set();

  plugins.forEach(p => {
    const cat = p.category || 'other';
    presentCategories.add(cat);
    counts[cat] = (counts[cat] || 0) + 1;
  });

  if (catList) {
    const allCategoryKeys = Array.from(new Set([...Object.keys(categories), ...presentCategories]));
    let html = `
      <button class="category-chip ${marketState.activeCategory === 'all' ? 'active' : ''}" data-category="all">
        全部 <span class="chip-count">(${counts.all || 0})</span>
      </button>
    `;

    allCategoryKeys.forEach(key => {
      const count = counts[key] || 0;
      if (count === 0 && !categories[key]) return;
      const label = getCategoryLabel(categories, key);
      const isActive = marketState.activeCategory === key ? 'active' : '';
      html += `
        <button class="category-chip ${isActive}" data-category="${key}">
          ${label} <span class="chip-count">(${count})</span>
        </button>
      `;
    });

    catList.innerHTML = html;

    catList.querySelectorAll('.category-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        catList.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        marketState.activeCategory = btn.dataset.category || 'all';
        marketState.currentPage = 1;
        updateMarketView();
      });
    });
  }

  updateMarketView();
}

function updateMarketView() {
  const container = document.getElementById('catalog-list');
  const countInfo = document.getElementById('market-count-info');
  const prevBtn = document.getElementById('btn-market-prev');
  const nextBtn = document.getElementById('btn-market-next');
  const pageIndicator = document.getElementById('market-page-indicator');

  if (!container || !marketState.rawCatalog) return;

  const catalog = marketState.rawCatalog;
  const categories = catalog.categories || {};
  const allPlugins = catalog.plugins || [];

  let filtered = allPlugins;
  if (marketState.activeCategory !== 'all') {
    filtered = filtered.filter(p => (p.category || 'other') === marketState.activeCategory);
  }

  const query = marketState.searchQuery;
  if (query) {
    filtered = filtered.filter(p => {
      const name = (p.name || '').toLowerCase();
      const owner = (p.owner || '').toLowerCase();
      const npm = (p.npm || '').toLowerCase();
      const zhDesc = (p.description?.zh || '').toLowerCase();
      const enDesc = (p.description?.en || '').toLowerCase();
      return name.includes(query) || owner.includes(query) || npm.includes(query) || zhDesc.includes(query) || enDesc.includes(query);
    });
  }

  const sortBy = marketState.sortBy;
  filtered.sort((a, b) => {
    if (sortBy === 'stars') {
      return (b.stars || 0) - (a.stars || 0);
    }
    if (sortBy === 'added') {
      return (b.added || '').localeCompare(a.added || '');
    }
    if (sortBy === 'name') {
      return (a.name || '').localeCompare(b.name || '');
    }
    return 0;
  });

  if (countInfo) {
    countInfo.textContent = `共 ${filtered.length} 个插件`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-hint" style="grid-column: 1 / -1; padding: 40px 0;">未找到符合条件的插件</div>`;
    if (pageIndicator) pageIndicator.textContent = '第 1 / 1 页';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / marketState.pageSize));
  if (marketState.currentPage > totalPages) marketState.currentPage = totalPages;
  if (marketState.currentPage < 1) marketState.currentPage = 1;

  const startIdx = (marketState.currentPage - 1) * marketState.pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + marketState.pageSize);

  if (pageIndicator) {
    pageIndicator.textContent = `第 ${marketState.currentPage} / ${totalPages} 页`;
  }
  if (prevBtn) prevBtn.disabled = marketState.currentPage <= 1;
  if (nextBtn) nextBtn.disabled = marketState.currentPage >= totalPages;

  container.innerHTML = pageItems.map(p => {
    const catKey = p.category || 'other';
    const catLabel = getCategoryLabel(categories, catKey);
    const desc = p.description?.zh || p.description?.en || (typeof p.description === 'string' ? p.description : '暂无详细描述');
    const starsBadge = p.stars > 0 ? `<span class="badge badge-stars">★ ${p.stars}</span>` : '';
    const ownerLabel = p.owner ? `<div class="catalog-owner">by ${p.owner}</div>` : '';

    const isInstalled = marketState.installedPluginNames.has(p.npm) ||
                        marketState.installedPluginNames.has(p.name) ||
                        (p.owner && marketState.installedPluginNames.has(`github:${p.owner}/${p.name}`));

    let sourcePayload = null;
    if (p.npm) {
      sourcePayload = { kind: 'npm', spec: p.npm };
    } else if (p.url) {
      sourcePayload = { kind: 'git', url: p.url };
    } else if (p.owner && p.name) {
      sourcePayload = { kind: 'git', url: `github:${p.owner}/${p.name}` };
    } else {
      sourcePayload = { kind: 'npm', spec: p.name };
    }

    const payloadStr = encodeURIComponent(JSON.stringify(sourcePayload));

    const links = [];
    if (p.page) {
      links.push(`<button class="catalog-link-btn" onclick="openExternalUrl('${p.page}')">主页 ↗</button>`);
    }
    if (p.url && p.url !== p.page) {
      links.push(`<button class="catalog-link-btn" onclick="openExternalUrl('${p.url}')">源码 ↗</button>`);
    }

    const actionBtn = isInstalled
      ? `<button class="btn-cmd btn-sm" onclick="installMarketPlugin('${payloadStr}')">[ 重新安装 ]</button>`
      : `<button class="btn-cmd btn-sm primary" onclick="installMarketPlugin('${payloadStr}')">[ 安装 ]</button>`;

    return `
      <div class="catalog-card">
        <div class="catalog-card-header">
          <div class="catalog-title-group">
            <div class="catalog-title" title="${p.name}">${p.name}</div>
            ${ownerLabel}
          </div>
          <div class="catalog-card-badges">
            <span class="badge badge-category">${catLabel}</span>
            ${starsBadge}
          </div>
        </div>
        <div class="catalog-desc" title="${desc.replace(/"/g, '&quot;')}">${desc}</div>
        <div class="catalog-card-footer">
          <div class="catalog-links">
            ${links.join('')}
          </div>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
}

window.openExternalUrl = async function(url) {
  if (url) {
    await window.cockpit.web.open(url);
  }
};

window.installMarketPlugin = async function(encodedPayload) {
  try {
    const source = JSON.parse(decodeURIComponent(encodedPayload));
    await performInstallWithVisualization(source);
  } catch (err) {
    alert(`安装参数解析失败: ${err.message}`);
  }
};

window.installCatalogPlugin = async function(pkgName) {
  await performInstallWithVisualization({ kind: 'npm', spec: pkgName });
};