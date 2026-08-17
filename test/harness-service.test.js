const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { preflight, isWebRunning } = require('../src/services/harness-service');

test('HarnessService - preflight on empty / unconfigured path', async () => {
  const result = await preflight({});
  assert.equal(result.nodeOk, true); // node is running this test
  assert.equal(result.pnpmOk, true);
  assert.equal(result.repoValid, false);
  assert.equal(result.canStart, false);
  assert.ok(result.issues.length > 0);
});

test('HarnessService - preflight on dummy harness repo', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-harness-preflight-'));
  await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'deepseek-harness' }), 'utf8');
  await fs.mkdir(path.join(tmpDir, '.git'));
  await fs.mkdir(path.join(tmpDir, 'node_modules'));

  const result = await preflight({ harnessPath: tmpDir });
  assert.equal(result.repoValid, true);
  assert.equal(result.depsInstalled, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('HarnessService - isWebRunning initial state', () => {
  assert.equal(isWebRunning(), false);
});
