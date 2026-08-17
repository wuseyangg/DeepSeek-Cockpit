const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resolveDshHome, resolveProfileDir, resolveExecutable } = require('../src/services/path-resolver');

test('PathResolver - resolveDshHome precedence', () => {
  // 1. Configured path
  const dshFromConfig = resolveDshHome({ dshHome: 'E:\\custom_dsh' });
  assert.equal(dshFromConfig, path.normalize('E:\\custom_dsh'));

  // 2. DSH_HOME env var
  process.env.DSH_HOME = 'E:\\env_dsh';
  const dshFromEnv = resolveDshHome({ dshHome: null });
  assert.equal(dshFromEnv, path.normalize('E:\\env_dsh'));
  delete process.env.DSH_HOME;

  // 3. Fallback to ~/.dsh
  const dshDefault = resolveDshHome({});
  assert.equal(dshDefault, path.join(os.homedir(), '.dsh'));
});

test('PathResolver - resolveProfileDir', () => {
  const profileDir = resolveProfileDir({ dshHome: 'E:\\dsh_root' }, 'web');
  assert.equal(profileDir, path.join('E:\\dsh_root', 'profiles', 'web'));
});

test('PathResolver - resolveExecutable exists', async () => {
  const gitExe = await resolveExecutable('git');
  assert.ok(gitExe, 'git should be resolvable on this system');

  const nodeExe = await resolveExecutable('node');
  assert.ok(nodeExe, 'node should be resolvable on this system');
});
