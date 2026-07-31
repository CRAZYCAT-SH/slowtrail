/**
 * 等待 Vite 开发服务器和后端服务就绪后启动 Electron
 */
const { exec } = require('child_process');
const http = require('http');

const VITE_URL = 'http://localhost:5173';
const SERVER_URL = 'http://localhost:3000/api/health';
const MAX_RETRIES = 60;
const RETRY_INTERVAL = 1000;

function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => {
      resolve(false);
    });
  });
}

async function waitForServices() {
  console.log('[Electron] 等待开发服务器启动...');

  for (let i = 0; i < MAX_RETRIES; i++) {
    const [viteReady, serverReady] = await Promise.all([
      checkUrl(VITE_URL),
      checkUrl(SERVER_URL),
    ]);

    if (viteReady && serverReady) {
      console.log('[Electron] 服务就绪，启动 Electron...');
      const child = exec('npx electron electron/dist/main.js', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
      child.on('exit', (code) => process.exit(code));
      return;
    }

    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }

  console.error('[Electron] 等待超时，服务未就绪');
  process.exit(1);
}

waitForServices();
