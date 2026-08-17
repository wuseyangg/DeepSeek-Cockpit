const { spawn } = require('node:child_process');
const { resolveExecutable } = require('./path-resolver');

function prepareSpawnArgs(exe, args) {
  if (process.platform === 'win32') {
    const lower = exe.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      return {
        targetExe: process.env.ComSpec || 'cmd.exe',
        targetArgs: ['/d', '/s', '/c', exe, ...args]
      };
    }
  }
  return { targetExe: exe, targetArgs: args };
}

async function runCommand(command, args = [], options = {}) {
  const exe = await resolveExecutable(command);
  const { targetExe, targetArgs } = prepareSpawnArgs(exe, args);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;

    let child;
    try {
      child = spawn(targetExe, targetArgs, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...(options.env || {}) },
        shell: false,
        windowsHide: true
      });
    } catch (err) {
      return resolve({
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: err.message,
        errorCode: err.code || 'SPAWN_ERROR'
      });
    }

    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeout);
    }

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        if (options.onLog) {
          str.split(/\r?\n/).forEach((line) => {
            if (line.trim()) options.onLog(line, 'stdout');
          });
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        if (options.onLog) {
          str.split(/\r?\n/).forEach((line) => {
            if (line.trim()) options.onLog(line, 'stderr');
          });
        }
      });
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`,
        errorCode: err.code || 'SPAWN_ERROR'
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        errorCode: timedOut ? 'TIMEOUT' : code === 0 ? null : `EXIT_${code}`
      });
    });
  });
}

class ManagedProcess {
  constructor(command, args = [], options = {}) {
    this.command = command;
    this.args = args;
    this.options = options;
    this.child = null;
    this.pid = null;
    this.isRunning = false;
    this._exitPromise = null;
    this.ready = null;
  }

  async start() {
    const exe = await resolveExecutable(this.command);
    const { targetExe, targetArgs } = prepareSpawnArgs(exe, this.args);

    return new Promise((resolve, reject) => {
      try {
        this.child = spawn(targetExe, targetArgs, {
          cwd: this.options.cwd || process.cwd(),
          env: { ...process.env, ...(this.options.env || {}) },
          shell: false,
          windowsHide: true
        });

        this.pid = this.child.pid;
        this.isRunning = true;

        if (this.child.stdout) {
          this.child.stdout.on('data', (data) => {
            const str = data.toString();
            if (this.options.onLog) {
              str.split(/\r?\n/).forEach((line) => {
                if (line.trim()) optionsOnLog(this.options, line, 'stdout');
              });
            }
          });
        }

        if (this.child.stderr) {
          this.child.stderr.on('data', (data) => {
            const str = data.toString();
            if (this.options.onLog) {
              str.split(/\r?\n/).forEach((line) => {
                if (line.trim()) optionsOnLog(this.options, line, 'stderr');
              });
            }
          });
        }

        this._exitPromise = new Promise((resExit) => {
          this.child.on('close', (code) => {
            this.isRunning = false;
            if (this.options.onExit) {
              this.options.onExit(code);
            }
            resExit(code);
          });
        });

        this.child.on('error', (err) => {
          this.isRunning = false;
          if (this.options.onLog) {
            this.options.onLog(`[ERROR] ${err.message}`, 'stderr');
          }
        });

        resolve(this);
      } catch (err) {
        this.isRunning = false;
        reject(err);
      }
    });
  }

  async stop() {
    if (this.ready) {
      try { await this.ready; } catch {}
    }
    if (!this.isRunning || !this.child) {
      return { ok: true };
    }

    if (process.platform === 'win32' && this.pid) {
      try {
        await runCommand('taskkill', ['/PID', this.pid.toString(), '/T', '/F']);
      } catch {
        try { this.child.kill('SIGTERM'); } catch {}
      }
    } else {
      try { this.child.kill('SIGTERM'); } catch {}
    }

    this.isRunning = false;
    return { ok: true };
  }
}

function optionsOnLog(options, line, type) {
  if (options && options.onLog) {
    try { options.onLog(line, type); } catch {}
  }
}

function spawnManagedProcess(command, args = [], options = {}) {
  const proc = new ManagedProcess(command, args, options);
  proc.ready = proc.start().catch((err) => {
    if (options.onLog) options.onLog(`Failed to spawn: ${err.message}`, 'stderr');
    throw err;
  });
  return proc;
}

module.exports = {
  runCommand,
  spawnManagedProcess,
  ManagedProcess
};
