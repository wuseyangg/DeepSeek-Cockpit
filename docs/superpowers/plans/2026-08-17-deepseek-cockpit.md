# DeepSeek Harness Cockpit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Electron 与原生 Web 技术，构建极简、安全、无数据库的 Windows 桌面管理助手（DeepSeek Harness Cockpit），实现对本地 DeepSeek Harness 仓库的安全同步、依赖构建、Web 服务托管 (`pnpm dsh web`)、浏览器直连以及 `web` profile 插件与 `cordis.patch.yml` 补丁的安全管理。

**Architecture:** Electron 极简主/渲染进程架构。主进程通过 Node 原生模块 (`node:child_process`, `node:fs/promises`, `node:http`, `node:path`) 承载 Git、pnpm、文件系统操作与进程生命周期；渲染进程采用原生 HTML/CSS/Vanilla JS，通过安全的 Preload IPC 桥接访问后端服务。采用 `node:test` 进行自动化测试。

**Tech Stack:** Electron 34+, Node.js 22+, Native HTML5/CSS3/ESM JavaScript, `yaml`, `electron-builder`, `node:test`。

---

## Global Constraints

- **目标平台**: Windows 10/11 桌面应用，支持 NSIS 安装包与便携绿色启动。
- **极简原则 (Ponytail)**: 拒绝重型前端框架 (No React/Vue/Tauri/Rust)，无数据库，无后台守护进程/托盘常驻，原生能力与 Node 标准库优先。
- **安全执行**: 所有外部进程调用一律使用参数数组且 `shell: false`，杜绝 Shell 拼接与命令注入。
- **Git 安全守则**: 绝不执行 `git reset --hard`、`git clean`、强制拉取或自动 stash；仅在工作区干净且可快进 (Fast-Forward Only) 时允许同步。
- **凭据隔离**: 绝不读取、存储或导出 Harness `.env`、API Keys、模型凭据或用户会话数据。
- **插件与补丁安全**: 插件生命周期脚本执行 (`pnpm approve-builds`) 需按包精细化确认，补丁保存需经 YAML 校验 + `dsh --dump-config` 校验，失败自动回滚。

---

## Planned File Structure

```
DeepSeek-Cockpit/
├── package.json                   # 项目元数据、依赖及 npm 脚本 (start, test, build)
├── electron-builder.yml           # Windows NSIS 打包配置
├── resources/
│   ├── icon.ico                   # 应用图标
│   └── plugin-catalog.json        # 官方/推荐 bundle 插件元数据（只读）
├── src/
│   ├── main.js                    # Electron 主进程入口，IPC 调度与窗口生命周期
│   ├── preload.js                 # 渲染进程上下文安全隔离桥接 (window.cockpit)
│   ├── services/
│   │   ├── config-store.js        # 应用配置持久化与原子写入 (%APPDATA%/DeepSeek-Cockpit/config.json)
│   │   ├── path-resolver.js       # Harness 目录、DSH_HOME 及 Web Profile 路径解析
│   │   ├── command-runner.js      # 非 Shell 安全子进程运行器与生命周期托管
│   │   ├── git-service.js         # Git 状态巡检、克隆、Fetch 与快进同步
│   │   ├── harness-service.js     # 预检 (Preflight)、依赖编译、Web 启动/停止/探活/浏览器调起
│   │   ├── plugin-source.js       # npm / Git / 本地插件源解析与白名单安全校验
│   │   └── profile-service.js     # 插件增删改查、构建审批确认、备份与 cordis.patch.yml 校验回滚
│   └── renderer/
│       ├── index.html             # 单窗口主布局（侧边导航、主工作区、底部状态栏）
│       ├── styles.css             # 原生现代深浅色自适应/现代化 UI 样式表
│       ├── app.js                 # 渲染层主控制器、导航路由与全局事件监听
│       └── views/
│           ├── repo-view.js       # 仓库选择、克隆、Git 状态看板与同步控制视图
│           ├── web-view.js        # 环境预检、安装构建、Web 服务启停监控与实时日志视图
│           ├── plugins-view.js    # 插件列表、安装向导、构建审批与快捷操作视图
│           └── patch-editor.js    # cordis.patch.yml 在线编辑、语法校验与安全保存视图
├── test/
│   ├── config-store.test.js       # 配置存储单元测试
│   ├── path-resolver.test.js      # 路径解析单元测试
│   ├── command-runner.test.js     # 命令执行器单元测试
│   ├── git-service.test.js        # Git 巡检与安全同步测试
│   ├── harness-service.test.js    # Web 生命周期与探活测试
│   ├── plugin-source.test.js      # 插件源安全解析测试
│   ├── profile-service.test.js    # 插件增删与构建审批测试
│   ├── patch-editor.test.js       # YAML 补丁回滚测试
│   └── manual-windows-smoke.md    # Windows 平台端到端冒烟测试手册
└── README.md                      # 项目说明、快速启动与安全规范文档
```

---

## Task Decomposition

### Task 1: 初始化项目骨架与 Electron 基础外壳

**Files:**
- Create: `package.json`
- Create: `electron-builder.yml`
- Create: `resources/plugin-catalog.json`
- Create: `src/main.js`
- Create: `src/preload.js`
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`
- Create: `src/renderer/app.js`

**Interfaces:**
- Preload 暴露 `window.cockpit.appInfo` / `window.cockpit.ping()` 基础联通性 API。

- [ ] **Step 1: 创建 `package.json` 与 `electron-builder.yml`**
- [ ] **Step 2: 创建只读插件目录 `resources/plugin-catalog.json`**
- [ ] **Step 3: 实现主进程 `src/main.js` 与预加载 `src/preload.js`**
- [ ] **Step 4: 实现渲染进程原生外壳 (`index.html`, `styles.css`, `app.js`)**
- [ ] **Step 5: 验证应用正常启动并能完成基础渲染**

---

### Task 2: 配置管理、路径解析与安全命令执行器

**Files:**
- Create: `src/services/config-store.js`
- Create: `src/services/path-resolver.js`
- Create: `src/services/command-runner.js`
- Create: `test/config-store.test.js`
- Create: `test/path-resolver.test.js`
- Create: `test/command-runner.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`

**Interfaces:**
```js
interface AppConfig {
  schemaVersion: number;
  harnessPath: string | null;
  remoteUrl: string;
  remoteName: string;
  branch: string | null;
  web: { port: number; autoOpenBrowser: boolean };
  dshHome: string | null;
}
runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>
spawnManagedProcess(command: string, args: string[], options?: { cwd?: string, onLog?: (line: string) => void }): ManagedProcess
```

- [ ] **Step 1: 编写 ConfigStore / PathResolver / CommandRunner 的单元测试**
- [ ] **Step 2: 运行测试并确认红灯 (Fail)**
- [ ] **Step 3: 实现 `config-store.js`**
- [ ] **Step 4: 实现 `path-resolver.js`**
- [ ] **Step 5: 实现 `command-runner.js`**
- [ ] **Step 6: 运行测试并确认绿灯 (Pass)**
- [ ] **Step 7: 注册主进程 IPC 并更新 `preload.js`**

---

### Task 3: 安全 Git 仓库状态检测与快进同步管理

**Files:**
- Create: `src/services/git-service.js`
- Create: `src/renderer/views/repo-view.js`
- Create: `test/git-service.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 编写 GitService 单元测试**
- [ ] **Step 2: 运行测试确认红灯**
- [ ] **Step 3: 实现 `git-service.js`**
- [ ] **Step 4: 运行测试确认绿灯**
- [ ] **Step 5: 实现渲染层 `repo-view.js` 与主进程 IPC 联动**

---

### Task 4: Harness Web 编译准备、服务启停与探活直连

**Files:**
- Create: `src/services/harness-service.js`
- Create: `src/renderer/views/web-view.js`
- Create: `test/harness-service.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 编写 HarnessService 单元测试**
- [ ] **Step 2: 运行测试确认红灯**
- [ ] **Step 3: 实现 `harness-service.js`**
- [ ] **Step 4: 运行测试确认绿灯**
- [ ] **Step 5: 实现渲染层 `web-view.js`**

---

### Task 5: Web Profile 插件安全管理与构建审批

**Files:**
- Create: `src/services/plugin-source.js`
- Create: `src/services/profile-service.js`
- Create: `src/renderer/views/plugins-view.js`
- Create: `test/plugin-source.test.js`
- Create: `test/profile-service.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 编写 PluginSource / ProfileService 单元测试**
- [ ] **Step 2: 运行测试确认红灯**
- [ ] **Step 3: 实现 `plugin-source.js` 与 `profile-service.js`**
- [ ] **Step 4: 运行测试确认绿灯**
- [ ] **Step 5: 实现渲染层 `plugins-view.js`**

---

### Task 6: `cordis.patch.yml` 补丁编辑器与自动回滚保护

**Files:**
- Create: `src/renderer/views/patch-editor.js`
- Create: `test/patch-editor.test.js`
- Modify: `src/services/profile-service.js`
- Modify: `src/renderer/views/plugins-view.js`

- [ ] **Step 1: 编写 PatchEditor 单元测试**
- [ ] **Step 2: 运行测试确认红灯**
- [ ] **Step 3: 在 `profile-service.js` 中完善补丁保存与回滚逻辑**
- [ ] **Step 4: 运行测试确认绿灯**
- [ ] **Step 5: 实现渲染层 `patch-editor.js`**

---

### Task 7: 平台打包、文档完善与端到端验收

**Files:**
- Create: `test/manual-windows-smoke.md`
- Create: `README.md`
- Modify: `electron-builder.yml`
- Modify: `package.json`

- [ ] **Step 1: 编写 `test/manual-windows-smoke.md` 冒烟测试用例**
- [ ] **Step 2: 编写 `README.md`**
- [ ] **Step 3: 运行完整自动化测试套件**
- [ ] **Step 4: 验证应用构建与启动**
