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
      filter: ['**/*'],
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
