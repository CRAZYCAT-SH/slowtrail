/**
 * 清理 release 目录中的旧打包产物
 * 保留 linux-unpacked / win-unpacked 等目录（由 electron-builder 自行管理）
 * 主要清理：安装包文件、临时目录、日志文件
 */
const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'release');

if (!fs.existsSync(releaseDir)) {
  console.log('[clean-release] release/ 目录不存在，跳过清理');
  process.exit(0);
}

// 需要删除的文件扩展名
const removeExtensions = ['.exe', '.msi', '.zip', '.dmg', '.AppImage', '.deb', '.rpm', '.blockmap', '.yml', '.yaml'];

// 需要删除的临时目录前缀
const removeDirPrefixes = ['__', 'win-unpacked', 'linux-unpacked', 'mac'];

let cleaned = 0;

const entries = fs.readdirSync(releaseDir, { withFileTypes: true });

for (const entry of entries) {
  const fullPath = path.join(releaseDir, entry.name);

  if (entry.isFile()) {
    const ext = path.extname(entry.name).toLowerCase();
    if (removeExtensions.includes(ext)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`[clean-release] 已删除: ${entry.name}`);
        cleaned++;
      } catch (err) {
        console.warn(`[clean-release] 无法删除 ${entry.name}: ${err.message}`);
      }
    }
  } else if (entry.isDirectory()) {
    const shouldRemove = removeDirPrefixes.some(prefix => entry.name.startsWith(prefix));
    if (shouldRemove) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`[clean-release] 已删除目录: ${entry.name}/`);
        cleaned++;
      } catch (err) {
        console.warn(`[clean-release] 无法删除目录 ${entry.name}/: ${err.message}`);
      }
    }
  }
}

console.log(`[clean-release] 清理完成，共清理 ${cleaned} 项`);
