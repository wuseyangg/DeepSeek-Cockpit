const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const RESOURCE_DIR = path.join(__dirname, '../resources');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 图标是 scripts/generate-icon.ps1 的二进制产物，结构错误肉眼看不出来，
// 而 electron-builder 要到打包最后一步才会报错，所以在这里先校验容器结构
test('icon asset - icon.ico is a valid multi-size ICO containing 256x256', async () => {
  const ico = await fs.readFile(path.join(RESOURCE_DIR, 'icon.ico'));

  assert.equal(ico.readUInt16LE(0), 0, 'ICONDIR reserved 字段应为 0');
  assert.equal(ico.readUInt16LE(2), 1, 'ICONDIR type 字段应为 1（icon）');

  const count = ico.readUInt16LE(4);
  assert.ok(count >= 2, `应包含多个尺寸，实际 ${count}`);

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const width = ico[entry] === 0 ? 256 : ico[entry];
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);

    assert.ok(offset >= 6 + count * 16, `条目 ${i} 数据偏移落在目录区内`);
    assert.ok(offset + length <= ico.length, `条目 ${i} 数据越界`);
    assert.ok(
      ico.subarray(offset, offset + 8).equals(PNG_MAGIC),
      `条目 ${i} 应为 PNG 压缩数据`
    );
    sizes.push(width);
  }

  assert.ok(sizes.includes(256), `electron-builder 要求 256x256，实际尺寸 ${sizes.join('/')}`);
});

test('icon asset - tray.png exists and is a 32x32 PNG', async () => {
  const png = await fs.readFile(path.join(RESOURCE_DIR, 'tray.png'));

  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'tray.png 应为 PNG');
  // IHDR 紧跟文件头：长度(4) + 类型(4) + 宽(4) + 高(4)
  assert.equal(png.readUInt32BE(16), 32, 'tray.png 宽度应为 32');
  assert.equal(png.readUInt32BE(20), 32, 'tray.png 高度应为 32');
});
