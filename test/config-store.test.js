const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ConfigStore, DEFAULT_CONFIG } = require('../src/services/config-store');

test('ConfigStore - default config and loading', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  const store = new ConfigStore(cfgPath);

  const config = await store.loadConfig();
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.remoteName, 'origin');
  assert.equal(config.web.port, 3080);
  assert.equal(config.web.autoOpenBrowser, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('ConfigStore - saveConfig partial updates and atomic writes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  const store = new ConfigStore(cfgPath);

  await store.saveConfig({ harnessPath: 'D:\\repo\\deepseek-harness', web: { port: 8080 } });
  const reloaded = await store.loadConfig();

  assert.equal(reloaded.harnessPath, 'D:\\repo\\deepseek-harness');
  assert.equal(reloaded.web.port, 8080);
  assert.equal(reloaded.web.autoOpenBrowser, true); // preserved

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('ConfigStore - invalid JSON handling backup to .invalid', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-cfg-test-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  await fs.writeFile(cfgPath, '{ malformed json: 123', 'utf8');

  const store = new ConfigStore(cfgPath);
  const config = await store.loadConfig();

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.harnessPath, null);

  const invalidFiles = (await fs.readdir(tmpDir)).filter(f => f.includes('.invalid'));
  assert.ok(invalidFiles.length > 0, 'Should create .invalid backup');

  await fs.rm(tmpDir, { recursive: true, force: true });
});
