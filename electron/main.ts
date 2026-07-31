import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import type { NativeImage } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let isQuitting = false;
let serverPort = 0;

const isDev = !app.isPackaged;

/**
 * 获取一个可用的随机端口
 */
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('无法获取端口')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * 启动 Express 后端服务
 */
function startServer(): Promise<number> {
  return new Promise(async (resolve, reject) => {
    // 获取随机可用端口
    let port: number;
    try {
      port = await getAvailablePort();
    } catch {
      // fallback 到默认端口
      port = 13800;
    }

    const serverEntry = isDev
      ? path.join(__dirname, '../server/dist/index.js')
      : path.join(process.resourcesPath, 'server/dist/index.js');

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_DIR_OVERRIDE: app.getPath('userData'),
      ELECTRON_RUN_AS_NODE: '1',
    };

    serverProcess = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(serverEntry),
    });

    let resolved = false;

    serverProcess.stdout!.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (!resolved && msg.includes('已启动')) {
        resolved = true;
        resolve(port);
      }
    });

    serverProcess.stderr!.on('data', (data: Buffer) => {
      console.error('[Server stderr]', data.toString().trim());
    });

    serverProcess.on('error', (err: Error) => {
      console.error('[Server] spawn error:', err.message);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    serverProcess.on('exit', (code: number | null) => {
      console.log('[Server] exit code:', code);
      serverProcess = null;
      if (!resolved) {
        resolved = true;
        reject(new Error(`后端进程退出, code: ${code}`));
      }
    });

    // 超时兜底
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(port);
      }
    }, 10000);
  });
}

/**
 * 停止后端服务
 */
function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

/**
 * 创建主窗口
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SlowTrail',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const url = isDev
    ? 'http://localhost:5173'
    : `http://localhost:${serverPort}`;

  mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 加载失败时重试
  mainWindow.webContents.on('did-fail-load', () => {
    console.log('[Window] 页面加载失败，3 秒后重试...');
    setTimeout(() => {
      mainWindow?.loadURL(url);
    }, 3000);
  });

  // 窗口关闭时最小化到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    shell.openExternal(linkUrl);
    return { action: 'deny' };
  });
}

/**
 * 获取图标路径（窗口图标，使用 png）
 */
function getIconPath(): string {
  if (isDev) {
    return path.join(__dirname, '../../build/icon.png');
  }
  return path.join(process.resourcesPath, 'icon.png');
}

/**
 * 获取托盘图标路径（Windows 优先使用 ico）
 */
function getTrayIconPath(): string {
  if (isDev) {
    // 开发模式：优先用 ico，没有则用 png
    const icoPath = path.join(__dirname, '../../build/icon.ico');
    const pngPath = path.join(__dirname, '../../build/icon.png');
    try {
      require('fs').accessSync(icoPath);
      return icoPath;
    } catch {
      return pngPath;
    }
  }
  // 打包模式
  if (process.platform === 'win32') {
    const icoPath = path.join(process.resourcesPath, 'icon.ico');
    try {
      require('fs').accessSync(icoPath);
      return icoPath;
    } catch {
      return path.join(process.resourcesPath, 'icon.png');
    }
  }
  return path.join(process.resourcesPath, 'icon.png');
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  const iconPath = getTrayIconPath();
  let trayIcon: NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // 回退：尝试加载其他尺寸的 png
      const fallbackPath = isDev
        ? path.join(__dirname, '../../build/icon-32.png')
        : path.join(process.resourcesPath, 'icon.png');
      trayIcon = nativeImage.createFromPath(fallbackPath);
    }
    // 系统托盘需要小尺寸图标，缩放到 16x16
    if (!trayIcon.isEmpty()) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SlowTrail - MySQL Slow Query Analyzer');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: '在浏览器中打开',
      click: () => {
        shell.openExternal(`http://localhost:${serverPort}`);
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// ============================================
// 应用生命周期
// ============================================

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      if (!isDev) {
        serverPort = await startServer();
        console.log(`[Electron] 后端服务已就绪, 端口: ${serverPort}`);
      } else {
        serverPort = 5173; // 开发模式加载 Vite
      }
      createWindow();
      createTray();
    } catch (error) {
      dialog.showErrorBox('启动失败', String(error));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // 由托盘管理，不退出
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopServer();
  });
}
