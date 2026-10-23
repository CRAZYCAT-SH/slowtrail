/**
 * 为 Electron 准备 better-sqlite3 原生模块
 *
 * 背景：better-sqlite3 是原生模块，.node 二进制与 ABI 版本强绑定。
 * 本项目存在两套运行时：
 *   - 开发模式：后端由 tsx 跑在系统 Node 上（如 Node 22 → ABI 127）
 *   - 打包模式：后端被 spawn 成 ELECTRON_RUN_AS_NODE 的 electron.exe 子进程
 *               （Electron 33 → ABI 130）
 * 两者 ABI 不同，同一个 .node 无法通用。
 *
 * 因此 server/node_modules 里始终保留「系统 Node 版」供开发使用，
 * 本脚本额外下载「Electron 版」到 build/native/electron/<platform>-<arch>/，
 * 由 electron-builder 的 extraResources 覆盖进打包产物。
 * 这样开发环境完全不受打包流程影响。
 *
 * 用法：
 *   node scripts/prepare-native-electron.js                     # 当前平台 + x64
 *   node scripts/prepare-native-electron.js --platform darwin --arch arm64
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE_NAME = 'better-sqlite3';
const BINARY_NAME = 'better_sqlite3.node';

/** npmmirror 二进制镜像，GitHub 不可达时的备用源 */
const MIRROR_BASE = 'https://registry.npmmirror.com/-/binary/better-sqlite3';
const GITHUB_BASE = 'https://github.com/WiseLibs/better-sqlite3/releases/download';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { platform: process.platform, arch: 'x64' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) out.platform = args[++i];
    else if (args[i] === '--arch' && args[i + 1]) out.arch = args[++i];
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 从 server/package.json 读取 better-sqlite3 的确定版本 */
function resolveModuleVersion() {
  const installed = path.join(ROOT, 'server', 'node_modules', MODULE_NAME, 'package.json');
  if (fs.existsSync(installed)) return readJson(installed).version;

  const declared = readJson(path.join(ROOT, 'server', 'package.json')).dependencies[MODULE_NAME];
  if (!declared) throw new Error(`server/package.json 中找不到 ${MODULE_NAME} 依赖`);
  // 去掉 ^ ~ 等范围前缀
  return declared.replace(/^[^\d]*/, '');
}

/** 从根 package.json 读取 Electron 版本 */
function resolveElectronVersion() {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const declared = (pkg.devDependencies && pkg.devDependencies.electron) || '';
  if (!declared) throw new Error('根 package.json 的 devDependencies 中找不到 electron');
  return declared.replace(/^[^\d]*/, '');
}

/** 计算 Electron 对应的 ABI（NODE_MODULE_VERSION） */
function resolveAbi(electronVersion) {
  try {
    // node-abi 是 electron-builder 的传递依赖，打包环境必定存在
    return require('node-abi').getAbi(electronVersion, 'electron');
  } catch (error) {
    throw new Error(
      `无法计算 Electron ${electronVersion} 的 ABI，请确认已安装依赖（node-abi）。原始错误: ${error.message}`
    );
  }
}

function download(url, destFile, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      // 跟随重定向（GitHub release 会跳转到对象存储）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
        return download(res.headers.location, destFile, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(destFile);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

/**
 * 解压 tar.gz 并取出 .node
 * 用系统 tar（Windows 10+ / macOS / Linux 均自带），避免引入额外依赖
 */
function extractBinary(tarFile, workDir) {
  execFileSync('tar', ['-xzf', tarFile, '-C', workDir], { stdio: 'pipe' });
  // 包内结构为 build/Release/better_sqlite3.node
  const extracted = path.join(workDir, 'build', 'Release', BINARY_NAME);
  if (!fs.existsSync(extracted)) {
    throw new Error(`解压产物中找不到 ${BINARY_NAME}`);
  }
  return extracted;
}

async function main() {
  const { platform, arch } = parseArgs();
  const moduleVersion = resolveModuleVersion();
  const electronVersion = resolveElectronVersion();
  const abi = resolveAbi(electronVersion);

  const tarName = `${MODULE_NAME}-v${moduleVersion}-electron-v${abi}-${platform}-${arch}.tar.gz`;
  const outDir = path.join(ROOT, 'build', 'native', 'electron', `${platform}-${arch}`);
  const outFile = path.join(outDir, BINARY_NAME);
  const metaFile = path.join(outDir, 'meta.json');

  const expectedMeta = { moduleVersion, electronVersion, abi, platform, arch };

  console.log(
    `[native] 目标: ${MODULE_NAME}@${moduleVersion} / Electron ${electronVersion} (ABI ${abi}) / ${platform}-${arch}`
  );

  // 幂等：已有匹配产物则跳过，避免每次打包都重新下载
  if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
    try {
      const meta = readJson(metaFile);
      if (JSON.stringify(meta) === JSON.stringify(expectedMeta)) {
        console.log(`[native] 已存在匹配的二进制，跳过下载: ${path.relative(ROOT, outFile)}`);
        return;
      }
      console.log('[native] 已有产物与目标不一致，重新下载');
    } catch {
      console.log('[native] meta.json 解析失败，重新下载');
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slowtrail-native-'));
  const tarFile = path.join(workDir, tarName);

  // 先试 GitHub，失败再退到 npmmirror（国内网络更稳）
  const sources = [
    `${GITHUB_BASE}/v${moduleVersion}/${tarName}`,
    `${MIRROR_BASE}/v${moduleVersion}/${tarName}`,
  ];

  let lastError = null;
  let ok = false;
  for (const url of sources) {
    try {
      console.log(`[native] 下载 ${url}`);
      await download(url, tarFile);
      const extracted = extractBinary(tarFile, workDir);
      fs.copyFileSync(extracted, outFile);
      fs.writeFileSync(metaFile, JSON.stringify(expectedMeta, null, 2));
      const sizeMB = (fs.statSync(outFile).size / 1048576).toFixed(2);
      console.log(`[native] 完成: ${path.relative(ROOT, outFile)} (${sizeMB} MB)`);
      ok = true;
      break;
    } catch (error) {
      lastError = error;
      // 用 stdout 输出，避免在 PowerShell 里被当成命令失败
      console.log(`[native] 该源不可用（${error.message}），尝试下一个源`);
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  if (!ok) {
    console.error(
      `\n[native] 无法获取 Electron 版 ${MODULE_NAME}。\n` +
      `打包产物会因 ABI 不匹配而无法启动后端。请检查网络，或手动下载 ${tarName}\n` +
      `解压后把 build/Release/${BINARY_NAME} 放到 ${path.relative(ROOT, outFile)}\n`
    );
    throw lastError || new Error('下载失败');
  }
}

main().catch((error) => {
  console.error('[native] 失败:', error.message);
  process.exit(1);
});
