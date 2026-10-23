/**
 * electron-builder 配置
 * 文档: https://www.electron.build/configuration
 */
module.exports = {
  appId: 'com.slowtrail.app',
  productName: 'SlowTrail',
  copyright: 'Copyright © 2024',

  // Electron 下载镜像（解决国内网络问题）
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },

  // 输出目录
  directories: {
    output: 'release',
    buildResources: 'build',
  },

  // 主进程入口
  files: [
    'electron/dist/**/*',
  ],

  // 打包额外资源（后端代码 + 前端构建产物 + 图标）
  extraResources: [
    {
      from: 'server/dist',
      to: 'server/dist',
      filter: ['**/*'],
    },
    {
      from: 'server/node_modules',
      to: 'server/node_modules',
      filter: [
        '**/*',
        // better-sqlite3 是原生模块，随包的 .node 是「系统 Node ABI」版（开发用），
        // 在 Electron 里加载会因 ABI 不匹配失败，这里排除掉，由下面一条换成 Electron ABI 版
        '!better-sqlite3/build/Release/better_sqlite3.node',
        // 运行时不需要 SQLite 源码和编译中间产物，剔除约 10MB
        '!better-sqlite3/deps/**',
        '!better-sqlite3/src/**',
        '!better-sqlite3/build/Release/obj/**',
        '!better-sqlite3/build/*.{mk,gypi,Makefile,vcxproj,vcxproj.filters,sln}',
      ],
    },
    // Electron ABI 版的原生模块，由 scripts/prepare-native-electron.js 预先下载
    {
      from: 'build/native/electron/${platform}-${arch}/better_sqlite3.node',
      to: 'server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    },
    {
      from: 'server/package.json',
      to: 'server/package.json',
    },
    {
      from: 'client/dist',
      to: 'client/dist',
      filter: ['**/*'],
    },
    {
      from: 'build/icon.ico',
      to: 'icon.ico',
    },
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
  ],

  // Windows 配置
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'zip',
        arch: ['x64'],
      },
      {
        target: 'msi',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.png',
    signingHashAlgorithms: null,
    sign: null,
    artifactName: 'SlowTrail-${version}-win-x64.${ext}',
  },

  // NSIS 安装器配置
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SlowTrail',
    artifactName: 'SlowTrail-Setup-${version}.${ext}',
  },

  // MSI 安装器配置
  // 注意：不要设置 upgradeCode。未设置时 electron-builder 会依据 appId 生成确定性 GUID，
  // 手动指定会让已发布版本的升级链断掉（旧版不会被覆盖，而是并存两份）
  msi: {
    // 走 per-machine 安装（装到 Program Files，需要提权）。
    // 默认的 per-user 安装会把安装包缓存进 %AppData%\Microsoft\Installer 并对其设 ACL，
    // 在用户 profile 权限被安全策略/沙箱工具改坏的机器上会报 MSI 1926 / Error 5
    perMachine: true,
    // 显示安装向导，而不是静默安装（静默模式失败时用户看不到任何反馈）
    oneClick: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SlowTrail',
    runAfterFinish: true,
  },

  // macOS 配置
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
    ],
    icon: 'build/icon.png',
    category: 'public.app-category.developer-tools',
  },

  // DMG 配置
  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  // Linux 配置
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'deb',
        arch: ['x64'],
      },
    ],
    icon: 'build/icon.png',
    category: 'Development',
  },
};
