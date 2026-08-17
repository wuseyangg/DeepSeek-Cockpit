# DeepSeek Harness Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a Windows desktop assistant for managing a local DeepSeek Harness checkout, synchronizing it safely, launching `pnpm dsh web`, opening the Web UI in the default browser, and managing plugins for the `web` profile.

**Architecture:** Use Electron as a thin Windows desktop shell. The Electron main process owns Git, pnpm, filesystem, HTTP readiness checks, and child-process lifecycle; the renderer is a small native HTML/CSS/JavaScript UI exposed through a restricted preload IPC API. Keep the implementation single-user, local-only, and database-free.

**Tech Stack:** Electron, Node.js, native HTML/CSS/JavaScript, `node:test`, a small YAML parser, and electron-builder for the Windows installer.

## Global Constraints

- Target: Windows 10/11 desktop application with an NSIS installer.
- The current workspace is empty apart from `.git`; create the application from scratch.
- Manage one local DeepSeek Harness Git checkout and one `web` profile in v1.
- Default upstream remote: `https://github.com/deepseek-ai/deepseek-harness.git`.
- The Harness source workflow is `pnpm install`, `pnpm run build`, then `pnpm dsh web`; the default Web URL is `http://127.0.0.1:3080`. See the [official README](https://github.com/deepseek-ai/deepseek-harness#readme).
- Do not automatically stash, reset, clean, force-pull, or overwrite uncommitted Harness changes.
- Use argument arrays with `shell: false`; never concatenate user input into shell commands.
- Do not store API keys, `.env` contents, model credentials, or Web session data in Cockpit configuration.
- Plugin sources: npm packages, Git repositories, and local directories.
- Plugin installation and lifecycle/build scripts require explicit user confirmation.
- `cordis.patch.yml` may be edited directly, but it must pass YAML parsing and Harness-level validation before the change is accepted.
- Do not add React, Tauri, Rust, a database, a tray daemon, a marketplace service, multi-profile management, or automatic update delivery in v1.

## Upstream Contracts Used by the Implementation

The Cockpit must follow the current upstream contracts rather than reimplementing them:

- `dsh web` is the Web profile alias and Web accepts `--port`; the production Web runner requires built artifacts. See the [official CLI behavior reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md).
- `dsh plugin --profile <name> <args...>` forwards plugin operations to pnpm in that profile directory. Installed bundle layers are reconciled through `dsh.profile.bundles`. See the [official plugin-management section](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#plugin-management).
- Resolve the Harness data root as configured path, then `DSH_HOME`, then `~/.dsh`. See the [official home-paths contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md).
- pnpm build-script approval uses `pnpm approve-builds <package...>` and writes the `allowBuilds` map to `pnpm-workspace.yaml`. See the [pnpm documentation](https://pnpm.io/cli/approve-builds).

## Planned File Structure

- `package.json`: Electron scripts, runtime metadata, test command, and minimal dependencies.
- `electron-builder.yml`: Windows NSIS packaging configuration.
- `src/main.js`: Main-process window lifecycle and IPC registration.
- `src/preload.js`: Narrow renderer-facing API.
- `src/services/config-store.js`: JSON configuration and atomic persistence.
- `src/services/command-runner.js`: Non-shell command execution and managed process lifecycle.
- `src/services/path-resolver.js`: Harness checkout, DSH home, and Web profile path resolution.
- `src/services/git-service.js`: Git inspection, fetch, clone, and fast-forward synchronization.
- `src/services/harness-service.js`: preflight, dependency preparation, Web launch, readiness polling, stop/restart, and browser opening.
- `src/services/plugin-source.js`: npm/Git/local source validation and normalization.
- `src/services/profile-service.js`: `web` profile package operations, state inspection, backups, and patch validation.
- `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/app.js`: shell layout and page navigation.
- `src/renderer/views/repo-view.js`: synchronization page.
- `src/renderer/views/web-view.js`: Web startup page.
- `src/renderer/views/plugins-view.js`: plugin list and package actions.
- `src/renderer/views/patch-editor.js`: raw `cordis.patch.yml` editor.
- `resources/plugin-catalog.json`: verified recommended plugin metadata only.
- `test/*.test.js`: pure service and validation tests using `node:test`.
- `README.md`: installation, usage, safety behavior, and troubleshooting.

## Task 1: Bootstrap the Electron application

**Files:** Create `package.json`, `electron-builder.yml`, `src/main.js`, `src/preload.js`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/app.js`, `resources/plugin-catalog.json`.

**Interfaces:** The renderer receives only the methods defined by `window.cockpit`; no Node or Electron primitive is exposed directly.

- [ ] Add the Electron dependency, the YAML parser, electron-builder, and a Node test script.
- [ ] Create a single-window Electron app with a fixed minimum size, a native menu-free layout, and a clean shutdown path.
- [ ] Add a left navigation with three pages: `同步`, `启动 Web`, and `插件`.
- [ ] Add a global status area showing the configured Harness path, Web process state, and latest operation result.
- [ ] Implement default configuration creation under `%APPDATA%\DeepSeek-Cockpit\config.json`.
- [ ] Add the NSIS target and application metadata to `electron-builder.yml`.
- [ ] Keep `resources/plugin-catalog.json` data-only. Do not add package names that have not been verified as Harness bundle packages.
- [ ] Add Chinese UI copy, keyboard-focus states, disabled states, and readable error surfaces without adding a UI component library.

## Task 2: Implement configuration, path resolution, and command execution

**Files:** Create `src/services/config-store.js`, `src/services/path-resolver.js`, `src/services/command-runner.js`, `test/config-store.test.js`, `test/command-runner.test.js`; modify `src/main.js` and `src/preload.js`.

**Interfaces:**

```js
// AppConfig
{
  schemaVersion: 1,
  harnessPath: string | null,
  remoteUrl: string,
  remoteName: string,
  branch: string | null,
  web: { port: number, autoOpenBrowser: boolean },
  dshHome: string | null
}

// CommandResult
{
  ok: boolean,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  errorCode: string | null
}

runCommand(command, args, options) -> Promise<CommandResult>
spawnManagedProcess(command, args, options) -> ManagedProcess
```

- [ ] Write failing tests for default configuration, invalid ports, malformed JSON, and missing fields.
- [ ] Implement atomic JSON writes through a temporary file and replacement.
- [ ] Preserve malformed configuration as `.invalid` before falling back to defaults.
- [ ] Resolve `dshHome` using this exact precedence: configured value, `DSH_HOME`, then `path.join(os.homedir(), '.dsh')`.
- [ ] Resolve the Web profile as `<dshHome>/profiles/web`.
- [ ] Resolve Windows executables without a shell; prefer `pnpm.cmd`, `git.exe`, and `node.exe`, then try `corepack.cmd pnpm` when pnpm is not directly available.
- [ ] Stream stdout/stderr to the renderer while retaining complete output for the final operation result.
- [ ] Ensure renderer input is revalidated in the main process before any command is launched.

Expose only these IPC groups through `preload.js`:

```js
window.cockpit = {
  config: { load, save },
  repo: { inspect, clone, fetch, sync },
  web: { preflight, prepare, start, stop, restart, open },
  plugins: { list, add, remove, update, replace, loadPatch, savePatch, validatePatch },
  events: { onLog, onProcessState }
}
```

## Task 3: Implement safe Git checkout management

**Files:** Create `src/services/git-service.js`, `src/renderer/views/repo-view.js`, `test/git-service.test.js`.

**Interfaces:**

```js
inspectRepo(config) -> Promise<RepoSnapshot>
cloneRepo(targetDirectory, remoteUrl) -> Promise<CommandResult>
fetchRepo(config) -> Promise<CommandResult>
syncRepo(config) -> Promise<CommandResult>

RepoSnapshot = {
  valid: boolean,
  path: string,
  branch: string | null,
  commit: string | null,
  upstream: string | null,
  ahead: number,
  behind: number,
  dirty: boolean,
  changes: string[],
  canSync: boolean,
  message: string | null
}
```

- [ ] Add native directory selection for an existing checkout.
- [ ] Validate that the selected directory contains `.git` and a root `package.json`.
- [ ] Add clone flow to an empty destination; refuse to overwrite a non-empty invalid directory.
- [ ] Implement inspection using `git rev-parse`, `git branch`, `git remote`, `git status --porcelain=v1`, and ahead/behind counts.
- [ ] Add `git fetch --prune <remote>` to the “检查更新” action.
- [ ] Allow synchronization only when the worktree is clean and the remote state is fast-forwardable.
- [ ] Use `git pull --ff-only <remote> <branch>` for the actual update.
- [ ] Block dirty worktrees, diverged branches, missing remotes, and missing upstream branches with actionable messages.
- [ ] Never call `git reset --hard`, `git clean`, force-pull, automatic stash, or automatic merge.
- [ ] Test clean fast-forward, dirty rejection, divergence rejection, missing remote, invalid path, and already-current states.

## Task 4: Implement Web preparation, launch, stop, and browser entry

**Files:** Create `src/services/harness-service.js`, `src/renderer/views/web-view.js`, `test/harness-service.test.js`.

**Interfaces:**

```js
preflight(config) -> Promise<PreflightResult>
prepare(config) -> Promise<CommandResult>
startWeb(config, port) -> Promise<WebProcessState>
stopWeb() -> Promise<CommandResult>
restartWeb(config, port) -> Promise<WebProcessState>
openWeb(url) -> Promise<void>

WebProcessState = {
  state: 'starting' | 'running' | 'stopped' | 'failed',
  pid: number | null,
  url: string | null,
  port: number,
  exitCode: number | null,
  error: string | null
}
```

- [ ] Check checkout path, Node, pnpm/Corepack, root `package.json`, and dependency/build readiness.
- [ ] Keep preparation explicit; the button runs `pnpm install` and then `pnpm run build` in the checkout root.
- [ ] Do not run install/build automatically on every Web launch.
- [ ] Start exactly `pnpm dsh web --port <port>` in the configured checkout.
- [ ] Stream output and poll `http://127.0.0.1:<port>` for up to 30 seconds.
- [ ] Mark the service `running` only after the local HTTP endpoint responds.
- [ ] Provide Start, Stop, Restart, and Open Browser actions.
- [ ] Use Electron `shell.openExternal()` for the browser shortcut.
- [ ] Detect port conflicts and early process exits, retaining the full command output.
- [ ] On application close, gracefully stop the Web process before quitting; do not leave an unmanaged child process.
- [ ] Test command construction, readiness success, timeout, port conflict, early exit, repeat stop, and browser URL generation.

## Task 5: Implement `web` profile plugin management

**Files:** Create `src/services/plugin-source.js`, `src/services/profile-service.js`, `src/renderer/views/plugins-view.js`, `test/plugin-source.test.js`, `test/profile-service.test.js`.

**Interfaces:**

```js
PluginSource =
  | { kind: 'npm', spec: string }
  | { kind: 'git', url: string, ref: string | null }
  | { kind: 'local', path: string }

listPlugins(config) -> Promise<PluginState[]>
addPlugin(config, source) -> Promise<CommandResult>
removePlugin(config, packageName) -> Promise<CommandResult>
updatePlugin(config, packageName) -> Promise<CommandResult>
replacePlugin(config, packageName, source) -> Promise<CommandResult>
loadPatch(config) -> Promise<string>
savePatch(config, text) -> Promise<ValidationResult>
```

- [ ] Validate npm specs without accepting control characters, leading option flags, or arbitrary command arguments.
- [ ] Accept Git HTTPS, `git+https`, and `github:` sources only.
- [ ] Accept local directories only from an absolute native file-picker result containing `package.json`.
- [ ] Show the complete source, target profile, and command preview before installation.
- [ ] Execute additions through `pnpm dsh plugin --profile web add <source>`.
- [ ] Execute removal through `pnpm dsh plugin --profile web remove <packageName>`.
- [ ] Execute updates through `pnpm dsh plugin --profile web update <packageName>`.
- [ ] For a same-name source/version edit, add the new spec and refresh the installed state.
- [ ] For a package-name change, install the new source first, then remove the old package; report partial failure instead of hiding it.
- [ ] Back up `package.json`, `pnpm-lock.yaml`, `dsh.profile`, and `pnpm-workspace.yaml` before every mutating plugin operation.
- [ ] Keep the ten most recent profile metadata backups under `%APPDATA%\DeepSeek-Cockpit\backups\<timestamp>\`.
- [ ] If pnpm reports ignored build scripts, identify exact package names and ask for per-operation approval before running `pnpm approve-builds <package...>`; never use `--all`.
- [ ] After every successful package operation, reread package metadata and `dsh.profile`.
- [ ] Mark packages without a valid Harness bundle declaration as installed dependencies that will not become profile layers.
- [ ] Display built-in bundles as non-installable to prevent duplicate additions.

## Task 6: Implement the `cordis.patch.yml` editor

**Files:** Create `src/renderer/views/patch-editor.js`, `test/patch-editor.test.js`; extend `src/services/profile-service.js` and `src/renderer/views/plugins-view.js`.

- [ ] Edit only `<dshHome>/profiles/web/cordis.patch.yml` in v1.
- [ ] Keep the raw YAML editor intentionally simple: load, edit, validate, save, restore backup, and restart Web.
- [ ] Parse YAML before writing and report syntax errors with line information.
- [ ] Write through a temporary file, keep a `.bak`, and atomically replace the active patch.
- [ ] After writing, execute `pnpm dsh --profile web --dump-config`.
- [ ] Restore the backup automatically if Harness parsing, schema, resolution, or profile validation fails.
- [ ] Show the full `dump-config` output on failure.
- [ ] Warn that patch content is trusted code/configuration and can affect Web startup.
- [ ] Do not directly edit the home-level patch, package manifest, `dsh.profile`, or Harness source files.
- [ ] If Web is running, show that the user should restart it after a successful patch change.

## Task 7: Finish packaging, documentation, and end-to-end acceptance

**Files:** Modify `README.md`, `electron-builder.yml`, and renderer copy; create `test/manual-windows-smoke.md`.

- [ ] Document installation and first-run checkout selection.
- [ ] Document the explicit dependency/build preparation step.
- [ ] Document synchronization safety and dirty-worktree behavior.
- [ ] Document `pnpm dsh web`, the default Web URL, and browser shortcut behavior.
- [ ] Document npm/Git/local plugin sources and lifecycle-script confirmation.
- [ ] Document patch backup, validation, rollback, and restart behavior.
- [ ] Build the NSIS installer with electron-builder.
- [ ] Verify the installer launches without requiring Electron to be preinstalled.
- [ ] Keep system prerequisites explicit: Git, Node.js meeting the upstream floor, and pnpm/Corepack.

## Test and Acceptance Checklist

- [ ] `npm test` exits successfully with all service tests passing.
- [ ] A clean Harness checkout can be selected or cloned.
- [ ] A clean checkout can fetch and fast-forward.
- [ ] A dirty checkout is visibly blocked from synchronization.
- [ ] A diverged checkout is visibly blocked from synchronization.
- [ ] Missing Git, Node, pnpm, dependencies, and build artifacts produce actionable messages.
- [ ] `pnpm dsh web` starts, logs are visible, the Web URL is detected, and the default browser opens it.
- [ ] Stop and restart release and reacquire the configured port correctly.
- [ ] npm, Git, and local plugin sources can be previewed and installed with confirmation.
- [ ] Plugin removal and update refresh the actual `web` profile state.
- [ ] Build-script approval is package-specific and never silently approves all packages.
- [ ] Invalid YAML cannot be saved.
- [ ] A Harness-invalid patch automatically restores its backup.
- [ ] The Windows installer can be installed and launched on a clean Windows machine with the documented prerequisites.
- [ ] Git status after implementation shows only the intended Cockpit source files and the plan file; no Harness checkout is modified.

## Explicit v1 Non-Goals

- No multi-checkout workspace manager.
- No headless, TUI, or arbitrary profile management.
- No tray resident process or background daemon.
- No automatic Git conflict resolution.
- No direct arbitrary shell execution.
- No plugin marketplace or remote recommendation synchronization.
- No automatic API-key or model configuration management.
- No direct text editing of `package.json` or `dsh.profile`.
- No automatic approval of every pnpm build script.

