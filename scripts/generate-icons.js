/**
 * 图标生成脚本
 * 使用 sharp 将 SVG 转换为各平台所需的图标格式
 *
 * 安装依赖: npm install sharp --save-dev (仅生成图标时需要)
 * 运行: node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('请先安装 sharp: npm install sharp --save-dev');
    console.error('如果 sharp 安装困难，也可以使用在线工具手动转换:');
    console.error('  1. 打开 build/icon.svg');
    console.error('  2. 在 https://convertio.co/ 转换为 PNG (512x512)');
    console.error('  3. 在 https://convertico.com/ 将 PNG 转换为 ICO');
    console.error('  4. 将文件放入 build/ 目录');
    process.exit(1);
  }

  const svgPath = path.join(__dirname, '../build/icon.svg');
  const buildDir = path.join(__dirname, '../build');
  const svgBuffer = fs.readFileSync(svgPath);

  // 生成 PNG (512x512，用于 Linux 和 macOS)
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(buildDir, 'icon.png'));
  console.log('✓ 生成 build/icon.png (512x512)');

  // 生成多尺寸 PNG (用于 Windows ICO)
  const sizes = [16, 32, 48, 64, 128, 256];
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(buildDir, `icon-${size}.png`));
  }
  console.log('✓ 生成多尺寸 PNG (16-256)');

  // 生成 ICO (Windows) - 使用 256x256 的 PNG 作为 ico
  // electron-builder 支持直接使用 256x256 PNG 作为 ico 来源
  // 或者用 png-to-ico 包
  try {
    const pngToIco = require('png-to-ico');
    const pngBuffer = fs.readFileSync(path.join(buildDir, 'icon-256.png'));
    const icoBuffer = await pngToIco(pngBuffer);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
    console.log('✓ 生成 build/icon.ico');
  } catch {
    console.log('⚠ 未安装 png-to-ico，跳过 ICO 生成');
    console.log('  electron-builder 也可直接使用 icon.png 自动生成 ico');
  }

  console.log('\n图标生成完成！');
  console.log('注意: macOS 的 .icns 文件需要在 macOS 上使用 iconutil 生成，');
  console.log('或者 electron-builder 会在打包时自动从 icon.png 转换。');
}

generateIcons().catch(console.error);
