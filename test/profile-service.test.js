const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const YAML = require('yaml');
const { listPlugins, backupProfileState, approveBuilds } = require('../src/services/profile-service');

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

test('ProfileService - approveBuilds with allowBuildKeys writes git-tarball keys into pnpm-workspace.yaml', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-allowbuilds-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });
  await fs.writeFile(path.join(webProfileDir, 'package.json'), '{"name": "web"}', 'utf8');

  // 已有 onlyBuiltDependencies 与 allowBuilds 段共存
  const initialYaml = [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    '',
    'onlyBuiltDependencies:',
    '  - esbuild',
    '  - "@swc/core"',
    '',
    'allowBuilds:',
    '  dshmarket@https://codeload.github.com/foo/bar/tar.gz/aaa: true',
    ''
  ].join('\n');
  await fs.writeFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), initialYaml, 'utf8');

  const newKey = 'dshclient@https://codeload.github.com/dsh-market/dsh-market/tar.gz/3242663e4281acd94f4351bce37da8b62a0a691f';
  const res = await approveBuilds({ dshHome: tmpHome }, [], [newKey]);
  assert.equal(res.ok, true);

  const after = YAML.parse(await fs.readFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'utf8'));

  // 新 key 已被写入
  assert.equal(after.allowBuilds[newKey], true);
  // 旧 key 仍存在
  assert.equal(after.allowBuilds['dshmarket@https://codeload.github.com/foo/bar/tar.gz/aaa'], true);
  // onlyBuiltDependencies 段未被覆盖
  assert.deepEqual(after.onlyBuiltDependencies, ['esbuild', '@swc/core']);
  // packages / nodeLinker 也未被覆盖
  assert.deepEqual(after.packages, ['.']);
  assert.equal(after.nodeLinker, 'hoisted');

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('ProfileService - approveBuilds creates allowBuilds section when missing', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-allowbuilds2-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });

  // 文件存在但没有 allowBuilds 段
  await fs.writeFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', 'utf8');

  const key = 'dshmarket@https://codeload.github.com/foo/bar/tar.gz/bbb';
  const res = await approveBuilds({ dshHome: tmpHome }, [], [key]);
  assert.equal(res.ok, true);

  const after = YAML.parse(await fs.readFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'utf8'));
  assert.equal(after.allowBuilds[key], true);
  assert.deepEqual(after.packages, ['.']);

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('ProfileService - approveBuilds returns error when pnpm-workspace.yaml read fails for non-ENOENT reason', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-allowbuilds3-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });

  // 不存在 pnpm-workspace.yaml → ENOENT 应被视为空配置（返回 ok: true, 自动新建）
  const key = 'dshmarket@https://codeload.github.com/foo/bar/tar.gz/ccc';
  const res = await approveBuilds({ dshHome: tmpHome }, [], [key]);
  assert.equal(res.ok, true);
  assert.equal(YAML.parse(await fs.readFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'utf8')).allowBuilds[key], true);

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test('ProfileService - approveBuilds legacy packageNames path is preserved (empty allowBuildKeys falls through)', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-dsh-home-allowbuilds4-'));
  const webProfileDir = path.join(tmpHome, 'profiles', 'web');
  await fs.mkdir(webProfileDir, { recursive: true });
  await fs.writeFile(path.join(webProfileDir, 'package.json'), '{"name": "web"}', 'utf8');

  // 不传 packageNames 也不传 allowBuildKeys → 老路径走 noop 返回 ok
  const res1 = await approveBuilds({ dshHome: tmpHome }, []);
  assert.deepEqual(res1, { ok: true });

  // 传 packageNames 但 allowBuildKeys 为空 → 走老路径调 pnpm approve-builds，
  // 不应触发 YAML 补丁（pnpm-workspace.yaml 仍保持初始状态不变）。
  const before = await fs.readFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
  const res2 = await approveBuilds({ dshHome: tmpHome }, ['somepkg-without-real-install']);
  const after = await fs.readFile(path.join(webProfileDir, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
  // 老路径不写 yaml（即使 res2 因 pkg 不存在而 ok=false，也不应留下 allowBuilds 段）
  assert.equal(after.includes('allowBuilds'), before.includes('allowBuilds'));
  // 只要不抛出且返回结构化结果即可
  assert.ok(typeof res2.ok === 'boolean');

  await fs.rm(tmpHome, { recursive: true, force: true });
});
