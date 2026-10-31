// 离线验证守卫：只记录「调用栈里出现我们扩展代码」的网络尝试。
// VS Code 自身的遥测/更新请求不归我们管，会被过滤掉。
const fs = require('fs');
const path = require('path');

const LOG = 'D:\\cfix\\logs\\net-guard.log';
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(
  LOG,
  `# guard loaded pid=${process.pid} node=${process.version}\n` +
    `# 只记录调用栈中包含 cfix 扩展代码的网络调用\n`,
  'utf8',
);

function ours() {
  const stack = new Error().stack || '';
  // 只认我们自己的产物：cfix 目录下的 dist/extension.js，或安装目录里的 zr-c-fix。
  // 不能用裸的 "extension.js"——VS Code 内置扩展的入口文件也叫这个名字。
  return /zr-c-fix|[\\/]cfix[\\/]dist[\\/]extension\.js/i.test(stack);
}

function record(what) {
  if (!ours()) return; // VS Code 自身的网络活动，忽略
  const stack = (new Error().stack || '').split('\n').slice(2, 5).join(' | ');
  const line = `${new Date().toISOString()} ${what}\n    ${stack}\n`;
  try {
    fs.appendFileSync(LOG, line, 'utf8');
  } catch {
    /* ignore */
  }
}

function brief(v) {
  try {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return '<unserializable>';
  }
}

const installed = [];
function patch(modName, fnName, describe) {
  try {
    const m = require(modName);
    if (!m || typeof m[fnName] !== 'function') return;
    const orig = m[fnName];
    m[fnName] = function (...args) {
      record(`${modName}.${fnName} ${describe(args)}`);
      return orig.apply(this, args);
    };
    installed.push(`${modName}.${fnName}`);
  } catch {
    /* ignore */
  }
}

patch('dns', 'lookup', (a) => brief(a[0]));
patch('dns', 'resolve', (a) => brief(a[0]));
patch('net', 'createConnection', (a) => brief(a[0]));
patch('tls', 'connect', (a) => brief(a[0]));
patch('http', 'request', (a) => brief(a[0]));
patch('http', 'get', (a) => brief(a[0]));
patch('https', 'request', (a) => brief(a[0]));
patch('https', 'get', (a) => brief(a[0]));

try {
  const net = require('net');
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    record(`net.Socket.connect ${brief(args[0])}`);
    return origConnect.apply(this, args);
  };
  installed.push('net.Socket.connect');
} catch {
  /* ignore */
}

if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (...args) {
    record(`fetch ${brief(args[0])}`);
    return origFetch.apply(this, args);
  };
  installed.push('fetch');
}

fs.appendFileSync(LOG, `# 已挂钩：${installed.join(', ')}\n`, 'utf8');
