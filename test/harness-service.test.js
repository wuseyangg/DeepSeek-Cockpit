const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { preflight, isWebRunning, _pollHttpReadiness } = require('../src/services/harness-service');

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

test('pollHttpReadiness - 5xx 不算就绪，须等到首个 2xx 才 resolve', async () => {
  let responses = 0;
  const server = http.createServer((req, res) => {
    responses += 1;
    // 前两次响应 502，模拟首屏编译占位；之后才回 200
    if (responses <= 2) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('still compiling');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ready');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  try {
    const start = Date.now();
    await _pollHttpReadiness(url, null, 5000);
    const elapsed = Date.now() - start;

    // 必须等到第 3 次响应（200）才解决；前两次 502 不能误判为就绪
    assert.ok(responses >= 3, `期望至少收到 3 次请求，实际 ${responses}`);
    // 首次 2xx 后还要再 settle 500ms，所以总耗时 ≥ ~1.4s（2 次 502 间隔 500ms × 2 + 500ms 缓冲）
    assert.ok(elapsed >= 1000, `期望至少等待 ~1s 让 settle 缓冲落地，实际 ${elapsed}ms`);
  } finally {
    // 先强制关闭 keep-alive 残留连接，否则 server.close 会挂死
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((r) => server.close(r));
  }
});

test('pollHttpReadiness - 4xx 同样视为未就绪', async () => {
  let responses = 0;
  const server = http.createServer((req, res) => {
    responses += 1;
    if (responses <= 1) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not yet');
      return;
    }
    res.writeHead(204);
    res.end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  try {
    await _pollHttpReadiness(url, null, 5000);
    assert.ok(responses >= 2, `期望至少 2 次请求（先 404 后 2xx），实际 ${responses}`);
  } finally {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((r) => server.close(r));
  }
});
