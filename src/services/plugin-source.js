const path = require('node:path');
const fs = require('node:fs/promises');

// npm 包名规范校验（支持 scope 和版本号标签）
const NPM_SPEC_REGEX = /^(?:@([a-z0-9-~][a-z0-9-._~]*)\/)?([a-z0-9-~][a-z0-9-._~]*)(?:@([a-z0-9-._~^><=+|*]+))?$/i;

async function validateAndNormalizeSource(source) {
  if (!source || typeof source !== 'object' || !source.kind) {
    return { valid: false, error: '未知的插件来源类型' };
  }

  if (source.kind === 'npm') {
    const spec = (source.spec || '').trim();
    if (!spec) {
      return { valid: false, error: 'npm 规范不能为空' };
    }
    // 防注入检查：禁止任何控制字符、命令行参数 flag 前缀、管道与换行
    if (spec.startsWith('-') || /[\s;`$|&><\r\n\t]/.test(spec)) {
      return { valid: false, error: 'npm 包名包含非法字符或命令注入风险' };
    }
    // 常见拼写纠错提示
    if (spec.startsWith('@cordisis/')) {
      return {
        valid: false,
        error: `检测到疑似拼写错误: "${spec}"。您是否是指 "@cordisjs/${spec.slice(10)}"?`
      };
    }
    if (!NPM_SPEC_REGEX.test(spec)) {
      return { valid: false, error: 'npm 包名或版本格式不正确' };
    }
    return { valid: true, normalized: spec };
  }

  if (source.kind === 'git') {
    const url = (source.url || '').trim();
    if (!url) {
      return { valid: false, error: 'Git URL 不能为空' };
    }
    const isHttps = url.startsWith('https://') || url.startsWith('git+https://');
    const isGithub = url.startsWith('github:');
    if (!isHttps && !isGithub) {
      return { valid: false, error: 'Git 地址仅允许 HTTPS 或 github: 协议源' };
    }
    if (/[\s;`$|&><\r\n\t]/.test(url)) {
      return { valid: false, error: 'Git 地址包含非法字符' };
    }
    return { valid: true, normalized: url };
  }

  if (source.kind === 'local') {
    const rawPath = (source.path || '').trim();
    if (!rawPath) {
      return { valid: false, error: '本地路径不能为空' };
    }
    const resolvedPath = path.resolve(rawPath);
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return { valid: false, error: '指定的本地路径不是目录' };
      }
      const pkgPath = path.join(resolvedPath, 'package.json');
      await fs.access(pkgPath);
      return { valid: true, normalized: resolvedPath };
    } catch {
      return { valid: false, error: '指定的本地目录必须包含 package.json' };
    }
  }

  return { valid: false, error: `不支持的插件来源类型: ${source.kind}` };
}

module.exports = {
  validateAndNormalizeSource
};
