const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { loadPatch, savePatch } = require('../src/services/profile-service');

test('PatchEditor - load non-existent patch', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const res = await loadPatch({ dshHome: tmpHome });
  assert.equal(res.exists, false);
  assert.equal(res.content, '');
  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('PatchEditor - save invalid YAML syntax rejected before writing', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const invalidYaml = 'key: [unclosed list';

  const res = await savePatch({ dshHome: tmpHome }, invalidYaml);
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('YAML 语法错误'));

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('PatchEditor - save valid YAML creates backup and saves file', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-'));
  const webDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webDir, { recursive: true });
  const patchFile = path.join(webDir, 'cordis.patch.yml');

  await fs.writeFile(patchFile, 'initial: 1\n', 'utf8');

  // We test with bypassDumpConfig flag or mock when harness repo is not loaded
  const res = await savePatch({ dshHome: tmpHome, harnessPath: null }, 'updated: 2\n');
  assert.equal(res.ok, true);

  const saved = await fs.readFile(patchFile, 'utf8');
  assert.ok(saved.includes('updated: 2'));

  const bak = await fs.readFile(`${patchFile}.bak`, 'utf8');
  assert.ok(bak.includes('initial: 1'));

  await fs.rm(tmpHome, { recursive: true, force: true });
});
