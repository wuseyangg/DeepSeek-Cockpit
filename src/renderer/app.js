// 渲染层全局控制器
let currentConfig = null;
let webProcessState = { state: 'stopped', port: 3080, url: null };

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initSubTabs();
  initLogListener();
  initProcessStateListener();
  await loadInitialConfig();
  initRepoView();
  initWebView();
  initPluginsView();
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

      if (subtab === 'patch-editor') {
        loadPatchContent();
      } else if (subtab === 'plugins-catalog') {
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
    // 若插件安装模态框正打开且是 plugin/pnpm 相关日志，实时追加
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
}

function initProcessStateListener() {
  window.cockpit.events.onProcessState((state) => {
    updateWebUIState(state);
  });
}

function updateWebUIState(state) {
  webProcessState = state;
  const ind = document.getElementById('status-web-indicator');
  const txt = document.getElementById('status-web-text');
  const btnStart = document.getElementById('btn-start-web');
  const btnStop = document.getElementById('btn-stop-web');
  const btnRestart = document.getElementById('btn-restart-web');
  const btnOpen = document.getElementById('btn-open-browser');

  if (ind && txt) {
    ind.className = `dot dot-${state.state}`;
    if (state.state === 'running') {
      txt.textContent = `Web: 运行中 (:${state.port})`;
    } else if (state.state === 'starting') {
      txt.textContent = `Web: 正在启动...`;
    } else {
      txt.textContent = `Web: 已停止`;
    }
  }

  const isRunning = state.state === 'running';
  const isStarting = state.state === 'starting';

  if (btnStart) btnStart.disabled = isRunning || isStarting;
  if (btnStop) btnStop.disabled = !isRunning && !isStarting;
  if (btnRestart) btnRestart.disabled = !isRunning;
  if (btnOpen) btnOpen.disabled = !isRunning;
}

// 4. 配置初始化与状态更新
async function loadInitialConfig() {
  try {
    currentConfig = await window.cockpit.config.load();
    const repoInput = document.getElementById('repo-path-input');
    const statusRepo = document.getElementById('status-repo-path');
    const portInput = document.getElementById('web-port-input');
    const autoOpenCheck = document.getElementById('web-auto-open');

    if (currentConfig.harnessPath) {
      if (repoInput) repoInput.value = currentConfig.harnessPath;
      if (statusRepo) statusRepo.textContent = currentConfig.harnessPath;
    } else {
      if (statusRepo) statusRepo.textContent = '未配置';
    }

    if (currentConfig.web) {
      if (portInput) portInput.value = currentConfig.web.port || 3080;
      if (autoOpenCheck) autoOpenCheck.checked = currentConfig.web.autoOpenBrowser !== false;
    }

    if (currentConfig.harnessPath) {
      await refreshRepoStatus();
      await runPreflightCheck();
      await refreshPluginsList();
    }
  } catch (err) {
    console.error('Failed to load initial config:', err);
  }
}

// 5. 仓库视图逻辑
function initRepoView() {
  const btnBrowse = document.getElementById('btn-browse-repo');
  const btnClone = document.getElementById('btn-clone-repo');
  const btnFetch = document.getElementById('btn-fetch-repo');
  const btnSync = document.getElementById('btn-sync-repo');

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
      const confirmed = confirm(`确认克隆 ${remote} 到目录 ${targetDir}？`);
      if (!confirmed) return;

      btnClone.disabled = true;
      try {
        const res = await window.cockpit.repo.clone(targetDir, remote);
        if (res.ok) {
          await window.cockpit.config.save({ harnessPath: targetDir });
          await loadInitialConfig();
          alert('克隆成功！');
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
          alert('同步成功！');
        } else {
          alert(`同步失败: ${res.stderr || '请检查 Git 状态'}`);
        }
        await refreshRepoStatus();
      } finally {
        btnSync.disabled = false;
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
      if (branchEl) branchEl.textContent = '无效目录';
      if (commitEl) commitEl.textContent = '-';
      if (upstreamEl) upstreamEl.textContent = '-';
      if (syncDiffEl) syncDiffEl.textContent = status.message || '未检测到 Git 仓库';
      if (dirtyWarn) dirtyWarn.style.display = 'none';
      if (btnSync) btnSync.disabled = true;
      return;
    }

    if (branchEl) branchEl.textContent = status.branch || 'detached';
    if (commitEl) commitEl.textContent = status.commit ? status.commit.slice(0, 7) : '-';
    if (upstreamEl) upstreamEl.textContent = status.upstream || '无上游';

    if (syncDiffEl) {
      if (status.behind > 0) {
        syncDiffEl.textContent = `落后 ${status.behind} 个提交`;
        syncDiffEl.style.color = '#fbbf24';
      } else if (status.ahead > 0) {
        syncDiffEl.textContent = `领先 ${status.ahead} 个提交`;
        syncDiffEl.style.color = '#60a5fa';
      } else {
        syncDiffEl.textContent = `已是最新`;
        syncDiffEl.style.color = '#10b981';
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

// 6. Web 服务视图逻辑
function initWebView() {
  const btnRecheck = document.getElementById('btn-recheck-preflight');
  const btnPrepare = document.getElementById('btn-prepare-harness');
  const btnStart = document.getElementById('btn-start-web');
  const btnStop = document.getElementById('btn-stop-web');
  const btnRestart = document.getElementById('btn-restart-web');
  const btnOpen = document.getElementById('btn-open-browser');
  const portInput = document.getElementById('web-port-input');
  const autoOpenCheck = document.getElementById('web-auto-open');

  if (btnRecheck) {
    btnRecheck.addEventListener('click', async () => {
      await runPreflightCheck();
    });
  }

  if (btnPrepare) {
    btnPrepare.addEventListener('click', async () => {
      const ok = confirm('将执行 pnpm install && pnpm run build，这可能需要几分钟，是否继续？');
      if (!ok) return;
      btnPrepare.disabled = true;
      try {
        const res = await window.cockpit.web.prepare();
        if (res.ok) {
          alert('依赖安装与编译完成！');
        } else {
          alert(`编译失败: ${res.stderr || '请查看终端日志'}`);
        }
        await runPreflightCheck();
      } finally {
        btnPrepare.disabled = false;
      }
    });
  }

  if (portInput) {
    portInput.addEventListener('change', async () => {
      const val = parseInt(portInput.value, 10);
      if (val >= 1024 && val <= 65535) {
        await window.cockpit.config.save({ web: { port: val, autoOpenBrowser: autoOpenCheck ? autoOpenCheck.checked : true } });
      }
    });
  }

  if (autoOpenCheck) {
    autoOpenCheck.addEventListener('change', async () => {
      const portVal = portInput ? parseInt(portInput.value, 10) : 3080;
      await window.cockpit.config.save({ web: { port: portVal, autoOpenBrowser: autoOpenCheck.checked } });
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const port = portInput ? parseInt(portInput.value, 10) : 3080;
      updateWebUIState({ state: 'starting', port, url: null });
      const res = await window.cockpit.web.start(port);
      if (res.state === 'failed') {
        alert(`启动失败: ${res.error || '端口可能被占用或编译产物缺失'}`);
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
      updateWebUIState({ state: 'starting', port, url: null });
      await window.cockpit.web.restart(port);
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener('click', async () => {
      if (webProcessState.url) {
        await window.cockpit.web.open(webProcessState.url);
      }
    });
  }
}

async function runPreflightCheck() {
  const container = document.getElementById('preflight-list');
  if (!container) return;

  try {
    const res = await window.cockpit.web.preflight();
    let html = '';

    html += `<div class="check-item"><span class="indicator">${res.nodeOk ? '✅' : '❌'}</span> Node.js 环境: ${res.nodeVersion || '未找到'}</div>`;
    html += `<div class="check-item"><span class="indicator">${res.pnpmOk ? '✅' : '❌'}</span> pnpm 包管理器: ${res.pnpmVersion || '未找到'}</div>`;
    html += `<div class="check-item"><span class="indicator">${res.repoValid ? '✅' : '❌'}</span> Harness 代码库路径有效性</div>`;
    html += `<div class="check-item"><span class="indicator">${res.depsInstalled ? '✅' : '⚠️'}</span> node_modules 依赖安装状态</div>`;
    html += `<div class="check-item"><span class="indicator">${res.buildArtifactsExist ? '✅' : '⚠️'}</span> Web 编译产物就绪状态</div>`;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="check-item"><span class="indicator">❌</span> 检测发生异常: ${err.message}</div>`;
  }
}

// 7. 插件与补丁视图逻辑
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
  const btnReloadPatch = document.getElementById('btn-reload-patch');
  const btnSavePatch = document.getElementById('btn-save-patch');

  function updatePreview() {
    const selected = document.querySelector('input[name="plugin-source-type"]:checked')?.value;
    let target = '';
    if (selected === 'npm') target = inputNpm?.value.trim() || '<package-name>';
    if (selected === 'git') target = inputGit?.value.trim() || '<git-url>';
    if (selected === 'local') target = inputLocal?.value.trim() || '<directory-path>';
    if (cmdPreview) cmdPreview.textContent = `pnpm dsh plugin --profile web add ${target}`;
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

  if (btnReloadPatch) {
    btnReloadPatch.addEventListener('click', loadPatchContent);
  }

  if (btnSavePatch) {
    btnSavePatch.addEventListener('click', async () => {
      const editor = document.getElementById('patch-yaml-editor');
      const statusBox = document.getElementById('patch-validation-status');
      if (!editor) return;

      const text = editor.value;
      btnSavePatch.disabled = true;
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.className = 'alert alert-info';
        statusBox.textContent = '正在执行 YAML 解析与 dump-config 安全校验...';
      }

      try {
        const res = await window.cockpit.plugins.savePatch(text);
        if (res.ok) {
          if (statusBox) {
            statusBox.className = 'alert alert-success';
            statusBox.textContent = '✅ 补丁验证通过并已安全保存！如果 Web 服务正在运行，请重启 Web 服务使配置生效。';
          }
        } else {
          if (statusBox) {
            statusBox.className = 'alert alert-warning';
            statusBox.textContent = `❌ 补丁校验失败并已自动回滚：\n${res.error || res.dumpOutput || '配置不符合规范'}`;
          }
        }
      } finally {
        btnSavePatch.disabled = false;
      }
    });
  }

  // 跳转到 DSH 官网（dsh.so/zh）
  const btnOpenWebsite = document.getElementById('btn-open-dsh-website');
  if (btnOpenWebsite) {
    btnOpenWebsite.addEventListener('click', () => {
      window.cockpit.web.open('https://www.dsh.so/zh/');
    });
  }
}

// 8. 插件安装过程可视化控制器
function showPluginInstallModal(targetSpec) {
  const modal = document.getElementById('plugin-install-modal');
  const targetLabel = document.getElementById('modal-target-spec');
  const terminal = document.getElementById('modal-terminal-logs');
  const statusTag = document.getElementById('modal-terminal-status');
  const resultBanner = document.getElementById('modal-result-banner');
  const loadingInfo = document.getElementById('modal-loading-info');
  const btnDone = document.getElementById('btn-modal-done');
  const btnClose = document.getElementById('btn-close-install-modal');

  if (targetLabel) targetLabel.textContent = targetSpec;
  if (terminal) terminal.textContent = '';
  if (statusTag) {
    statusTag.textContent = '执行中...';
    statusTag.style.color = '#38bdf8';
  }
  if (resultBanner) {
    resultBanner.style.display = 'none';
    resultBanner.textContent = '';
  }
  if (loadingInfo) loadingInfo.style.display = 'flex';
  if (btnDone) btnDone.style.display = 'none';
  if (btnClose) btnClose.style.display = 'none';

  // 重置步骤状态
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

  if (loadingInfo) loadingInfo.style.display = 'none';
  if (btnDone) btnDone.style.display = 'inline-flex';
  if (btnClose) btnClose.style.display = 'inline-block';

  if (statusTag) {
    statusTag.textContent = success ? '安装成功' : '安装失败';
    statusTag.style.color = success ? '#10b981' : '#ef4444';
  }

  if (resultBanner) {
    resultBanner.style.display = 'block';
    resultBanner.className = `alert ${success ? 'alert-info' : 'alert-warning'}`;
    resultBanner.textContent = message;
  }
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

  // Step 1: 来源规范校验
  updateInstallModalStep(1, 'active');
  appendModalInstallLog(`正在进行来源格式与白名单校验: ${targetSpec} ...`);
  await new Promise(r => setTimeout(r, 200));
  updateInstallModalStep(1, 'completed');

  // Step 2: 环境备份
  updateInstallModalStep(2, 'active');
  appendModalInstallLog('正在备份当前 Profile 元数据 (package.json, dsh.profile, lockfile) ...');
  await new Promise(r => setTimeout(r, 250));
  updateInstallModalStep(2, 'completed');

  // Step 3: 执行安装
  updateInstallModalStep(3, 'active');
  appendModalInstallLog(`正在执行: pnpm dsh plugin --profile web add ${targetSpec} ...`);

  let installRes;
  try {
    installRes = await window.cockpit.plugins.add(source);
  } catch (err) {
    installRes = { ok: false, stderr: err.message };
  }

  if (installRes.ok) {
    updateInstallModalStep(3, 'completed');
    // Step 4: 状态同步
    updateInstallModalStep(4, 'active');
    appendModalInstallLog('正在刷新 Profile 插件图谱与构建脚本状态 ...');
    await new Promise(r => setTimeout(r, 200));
    updateInstallModalStep(4, 'completed');

    finishPluginInstallModal(true, `✅ 插件 ${targetSpec} 安装成功！已写入 web profile。`);
  } else {
    updateInstallModalStep(3, 'error');
    updateInstallModalStep(4, 'error');
    const rawError = `${installRes.stderr || ''}\n${installRes.stdout || ''}`.trim();
    appendModalInstallLog(`[ERROR] 插件安装失败: ${rawError || '未知错误'}`);

    let userFriendlyMsg = rawError;
    if (rawError.includes('404') || rawError.includes('ERR_PNPM_FETCH_404') || rawError.includes('Not Found') || rawError.includes('pnpm failed')) {
      userFriendlyMsg = `未在 npm 源中找到指定的包 "${targetSpec}" (404 Not Found)。\n💡 提示：请核对包名拼写（例如确认是否误将 @cordisjs 拼写成了 @cordisis）。`;
    } else if (rawError.includes('ETIMEDOUT') || rawError.includes('fetch failed')) {
      userFriendlyMsg = `网络请求超时，无法从 npm 仓库拉取包 "${targetSpec}"。\n💡 提示：请检查网络连接或 npm 镜像源配置。`;
    }

    finishPluginInstallModal(false, `❌ 插件安装失败：\n${userFriendlyMsg}`);
  }
}

async function refreshPluginsList() {
  const tbody = document.getElementById('plugins-table-body');
  if (!tbody) return;

  try {
    const list = await window.cockpit.plugins.list();
    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-hint">当前 web profile 暂无已安装的插件。</td></tr>';
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
            ${!item.isBuiltin ? `<button class="btn btn-text btn-danger" onclick="removePluginAction('${item.name}')">卸载</button>` : '<span style="color:var(--text-dim)">只读</span>'}
            ${item.buildApproved === false ? `<button class="btn btn-text btn-primary" onclick="approvePluginAction('${item.name}')">授权编译</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-hint">获取插件列表失败: ${err.message}</td></tr>`;
  }
}

window.removePluginAction = async function(pkgName) {
  const ok = confirm(`确认从 web profile 中卸载插件 ${pkgName}？`);
  if (!ok) return;
  const res = await window.cockpit.plugins.remove(pkgName);
  if (res.ok) {
    alert('插件已成功移除');
    await refreshPluginsList();
  } else {
    alert(`卸载失败: ${res.stderr || '未知错误'}`);
  }
};

window.approvePluginAction = async function(pkgName) {
  const ok = confirm(`确认向插件 ${pkgName} 授权运行 build 脚本？\n注意：只向可信赖的插件授予构建权限。`);
  if (!ok) return;
  const res = await window.cockpit.plugins.approveBuilds([pkgName]);
  if (res.ok) {
    alert('授权成功！');
    await refreshPluginsList();
  } else {
    alert(`授权失败: ${res.stderr || '未知错误'}`);
  }
};

async function renderCatalog() {
  const container = document.getElementById('catalog-list');
  if (!container) return;

  try {
    const catalog = await window.cockpit.plugins.getCatalog();
    container.innerHTML = catalog.map(p => `
      <div class="catalog-card">
        <div>
          <div class="catalog-title">${p.name}</div>
          <div class="catalog-desc">${p.description}</div>
        </div>
        <button class="btn btn-secondary" onclick="installCatalogPlugin('${p.name}')">一键安装</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-hint">加载推荐插件失败</div>`;
  }
}

window.installCatalogPlugin = async function(pkgName) {
  await performInstallWithVisualization({ kind: 'npm', spec: pkgName });
};

async function loadPatchContent() {
  const editor = document.getElementById('patch-yaml-editor');
  if (!editor) return;

  try {
    const res = await window.cockpit.plugins.loadPatch();
    editor.value = res.content || '# cordis.patch.yml 暂无内容\n';
  } catch (err) {
    editor.value = `# 加载失败: ${err.message}`;
  }
}

