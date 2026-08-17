const test = require('node:test');
const assert = require('node:assert/strict');
const { runCommand, spawnManagedProcess } = require('../src/services/command-runner');

test('CommandRunner - runCommand basic execution', async () => {
  const res = await runCommand(process.execPath, ['-e', 'console.log("hello from test")']);
  assert.equal(res.ok, true);
  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.includes('hello from test'));
});

test('CommandRunner - runCommand non-zero exit', async () => {
  const res = await runCommand(process.execPath, ['-e', 'process.exit(2)']);
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 2);
});

test('CommandRunner - spawnManagedProcess and stop', async () => {
  const logs = [];
  const proc = spawnManagedProcess(
    process.execPath,
    ['-e', 'setInterval(() => console.log("tick"), 100)'],
    { onLog: (line) => logs.push(line) }
  );

  await proc.ready;
  assert.ok(proc.pid > 0);
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(logs.length >= 1, 'Should collect ticks');

  await proc.stop();
  assert.equal(proc.isRunning, false);
});
