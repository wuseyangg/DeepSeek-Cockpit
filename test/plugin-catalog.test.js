const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateAndNormalizeSource } = require('../src/services/plugin-source');

test('PluginCatalog - electron-builder.yml packs data/**/* so registry-snapshot.json ships in the asar', async () => {
  // 守卫：data/**/* 必须在 files 白名单里，否则主进程的
  // path.join(__dirname, '../data/registry-snapshot.json') 在打包后会 ENOENT，
  // 插件市场会掉到 3 项 fallback，分类全空。
  const yml = await fs.readFile(path.join(__dirname, '../electron-builder.yml'), 'utf8');
  assert.match(
    yml,
    /^\s*-\s*"data\/\*\*\/\*"/m,
    'electron-builder.yml files: 白名单缺少 "data/**/*"，打包后插件市场会 fallback 到 3 项资源'
  );
});

test('PluginCatalog - load and validate registry-snapshot.json structure', async () => {
  const snapshotPath = path.join(__dirname, '../data/registry-snapshot.json');
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const data = JSON.parse(raw);

  assert.equal(typeof data, 'object');
  assert.equal(typeof data.categories, 'object');
  assert.ok(Array.isArray(data.plugins));
  assert.ok(data.plugins.length > 100, `Expected > 100 plugins, got ${data.plugins.length}`);

  // 校验分类定义
  const expectedCategories = ['ui', 'theme', 'model', 'session', 'memory', 'tools', 'skill', 'workflow', 'notify', 'dev', 'market', 'fun'];
  for (const cat of expectedCategories) {
    assert.ok(data.categories[cat], `Missing category: ${cat}`);
    assert.ok(data.categories[cat].zh, `Category ${cat} missing zh title`);
  }

  // 抽取前几个插件检查字段合法性
  for (let i = 0; i < Math.min(20, data.plugins.length); i++) {
    const plugin = data.plugins[i];
    assert.ok(plugin.name, `Plugin at index ${i} missing name`);
    assert.ok(plugin.category, `Plugin ${plugin.name} missing category`);
    assert.ok(plugin.description, `Plugin ${plugin.name} missing description`);
  }
});

test('PluginCatalog - convert registry plugins to valid install sources', async () => {
  const snapshotPath = path.join(__dirname, '../data/registry-snapshot.json');
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const data = JSON.parse(raw);

  // 找一个带有 npm 规范的插件
  const npmPlugin = data.plugins.find(p => p.npm);
  assert.ok(npmPlugin, 'Should have at least one plugin with npm field');
  const npmSource = { kind: 'npm', spec: npmPlugin.npm };
  const npmRes = await validateAndNormalizeSource(npmSource);
  assert.equal(npmRes.valid, true);

  // 找一个纯 git 插件 (npm: null)
  const gitPlugin = data.plugins.find(p => !p.npm && p.url);
  assert.ok(gitPlugin, 'Should have at least one plugin with git url');
  const gitSource = { kind: 'git', url: gitPlugin.url };
  const gitRes = await validateAndNormalizeSource(gitSource);
  assert.equal(gitRes.valid, true);
  assert.ok(gitRes.normalized.startsWith('git+https://') || gitRes.normalized.startsWith('github:'));
});

test('PluginCatalog - verify category aggregation and label mapping', async () => {
  const snapshotPath = path.join(__dirname, '../data/registry-snapshot.json');
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const data = JSON.parse(raw);

  const categories = data.categories || {};
  const plugins = data.plugins || [];

  const counts = { all: plugins.length };
  const presentCategories = new Set();

  for (const p of plugins) {
    const cat = p.category || 'other';
    presentCategories.add(cat);
    counts[cat] = (counts[cat] || 0) + 1;
  }

  assert.equal(counts.all, 839);
  assert.ok(presentCategories.size >= 12);
  for (const cat of presentCategories) {
    assert.ok(counts[cat] > 0, `Category ${cat} should have > 0 count`);
  }
});
