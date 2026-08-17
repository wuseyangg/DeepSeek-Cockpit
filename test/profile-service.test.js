const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { listPlugins, backupProfileState } = require('../src/services/profile-service');

test('ProfileService - listPlugins with empty profile', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const plugins = await listPlugins({ dshHome: tmpHome });
  assert.equal(Array.isArray(plugins), true);
  assert.equal(plugins.length, 0);
  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('ProfileService - listPlugins parsing dependencies and bundle info', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });

  const pkgJson = {
    dependencies: {
      '@cordisjs/plugin-server': '^1.0.0',
      'custom-tool-pkg': '2.0.0'
    }
  };
  await fs.writeFile(path.join(webProfileDir, 'package.json'), JSON.stringify(pkgJson), 'utf8');

  const plugins = await listPlugins({ dshHome: tmpHome });
  assert.equal(plugins.length, 2);
  const serverPkg = plugins.find(p => p.name === '@cordisjs/plugin-server');
  assert.ok(serverPkg);
  assert.equal(serverPkg.version, '^1.0.0');

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('ProfileService - backupProfileState keeps up to 10 backups', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });
  await fs.writeFile(path.join(webProfileDir, 'package.json'), '{"name": "web"}', 'utf8');

  // Trigger 3 backups
  await backupProfileState({ dshHome: tmpHome });
  await new Promise(r => setTimeout(r, 10));
  await backupProfileState({ dshHome: tmpHome });
  await new Promise(r => setTimeout(r, 10));
  const backupDir = await backupProfileState({ dshHome: tmpHome });

  assert.ok(backupDir);
  const entries = await fs.readdir(path.dirname(backupDir));
  assert.ok(entries.length >= 3);

  await fs.rm(tmpHome, { recursive: true, force: true });
});
