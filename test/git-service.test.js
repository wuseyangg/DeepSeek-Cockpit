const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runCommand } = require('../src/services/command-runner');
const { inspectRepo, fetchRepo, syncRepo } = require('../src/services/git-service');

test('GitService - inspect invalid directory', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-git-invalid-'));
  const res = await inspectRepo(tmpDir);
  assert.equal(res.valid, false);
  assert.ok(res.message.includes('不是有效的 Git 仓库'));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('GitService - inspect clean repo and dirty detection', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-git-test-'));
  
  // 初始化临时仓库
  await runCommand('git', ['init'], { cwd: tmpDir });
  await runCommand('git', ['config', 'user.name', 'Tester'], { cwd: tmpDir });
  await runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  
  await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-harness' }), 'utf8');
  await runCommand('git', ['add', '.'], { cwd: tmpDir });
  await runCommand('git', ['commit', '-m', 'initial commit'], { cwd: tmpDir });

  // 1. Clean inspect
  let snapshot = await inspectRepo(tmpDir);
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.changes.length, 0);

  // 2. Make it dirty
  await fs.writeFile(path.join(tmpDir, 'modified.txt'), 'some change', 'utf8');
  snapshot = await inspectRepo(tmpDir);
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.dirty, true);
  assert.equal(snapshot.canSync, false);
  assert.ok(snapshot.changes.length > 0);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
