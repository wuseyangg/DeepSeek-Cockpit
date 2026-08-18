const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateAndNormalizeSource } = require('../src/services/plugin-source');

test('PluginSource - valid npm specs', async () => {
  const s1 = await validateAndNormalizeSource({ kind: 'npm', spec: '@cordisjs/plugin-eval' });
  assert.equal(s1.valid, true);
  assert.equal(s1.normalized, '@cordisjs/plugin-eval');

  const s2 = await validateAndNormalizeSource({ kind: 'npm', spec: 'cordis-plugin-test@^1.2.0' });
  assert.equal(s2.valid, true);
  assert.equal(s2.normalized, 'cordis-plugin-test@^1.2.0');
});

test('PluginSource - reject malicious npm specs (flag injection, commands)', async () => {
  const bad1 = await validateAndNormalizeSource({ kind: 'npm', spec: '--save-dev evil' });
  assert.equal(bad1.valid, false);

  const bad2 = await validateAndNormalizeSource({ kind: 'npm', spec: 'pkg; rm -rf /' });
  assert.equal(bad2.valid, false);

  const bad3 = await validateAndNormalizeSource({ kind: 'npm', spec: 'pkg\nmalicious' });
  assert.equal(bad3.valid, false);
});

test('PluginSource - git sources validation', async () => {
  const gitValid = await validateAndNormalizeSource({ kind: 'git', url: 'https://github.com/deepseek-ai/test-plugin.git' });
  assert.equal(gitValid.valid, true);

  const gitInvalid = await validateAndNormalizeSource({ kind: 'git', url: 'file:///etc/passwd' });
  assert.equal(gitInvalid.valid, false);
});

test('PluginSource - git URL normalization prepends git+ for bare https', async () => {
  // 裸 https:// 应当规范化为 git+https://，避免 pnpm/dsh 把它当 npm 包名或 tarball 处理导致 404。
  const r1 = await validateAndNormalizeSource({ kind: 'git', url: 'https://github.com/dsh-market/dsh-market.git' });
  assert.equal(r1.valid, true);
  assert.equal(r1.normalized, 'git+https://github.com/dsh-market/dsh-market.git');

  // 没有 .git 后缀的 https URL 同样应被规范化（pnpm 仍可识别）。
  const r2 = await validateAndNormalizeSource({ kind: 'git', url: 'https://github.com/owner/repo' });
  assert.equal(r2.valid, true);
  assert.equal(r2.normalized, 'git+https://github.com/owner/repo');

  // 已经带 git+ 前缀的 URL 不应被重复添加。
  const r3 = await validateAndNormalizeSource({ kind: 'git', url: 'git+https://github.com/owner/repo.git' });
  assert.equal(r3.valid, true);
  assert.equal(r3.normalized, 'git+https://github.com/owner/repo.git');

  // github: shorthand 保持不变。
  const r4 = await validateAndNormalizeSource({ kind: 'git', url: 'github:owner/repo' });
  assert.equal(r4.valid, true);
  assert.equal(r4.normalized, 'github:owner/repo');
});

test('PluginSource - local directory source validation', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-local-pkg-'));
  
  // Without package.json
  const res1 = await validateAndNormalizeSource({ kind: 'local', path: tmpDir });
  assert.equal(res1.valid, false);

  // With package.json
  await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'local-pkg' }), 'utf8');
  const res2 = await validateAndNormalizeSource({ kind: 'local', path: tmpDir });
  assert.equal(res2.valid, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
