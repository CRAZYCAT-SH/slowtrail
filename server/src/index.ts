import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initDatabase, closeDatabase } from './db/index';
import syncRoutes from './routes/syncRoutes';
import statsRoutes from './routes/statsRoutes';
import fingerprintRoutes from './routes/fingerprintRoutes';
import groupRoutes from './routes/groupRoutes';
import dataSourceRoutes from './routes/dataSourceRoutes';
import scheduleRoutes from './routes/scheduleRoutes';
import { initDefaultDataSource } from './services/dataSourceService';
import { initScheduler, stopScheduler } from './services/schedulerService';

// 加载环境变量（从项目根目录的 .env 文件）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查接口
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 注册路由
app.use('/api/sync', syncRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/fingerprints', fingerprintRoutes);
app.use('/api/fingerprint-groups', groupRoutes);
app.use('/api/datasources', dataSourceRoutes);
app.use('/api/schedule', scheduleRoutes);

// 生产模式下托管前端静态资源
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  // 所有非 /api 路由回退到 index.html（支持前端 SPA 路由）
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 启动服务
async function start() {
  try {
    // 初始化数据库
    await initDatabase();

    // 从环境变量导入默认数据源（首次启动时创建，后续跳过）
    initDefaultDataSource();

    // 初始化定时调度器
    initScheduler();

    app.listen(PORT, () => {
      console.log(`[Server] 慢 SQL 分析服务已启动: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('[Server] 启动失败:', error);
    process.exit(1);
  }
}

// 优雅退出
process.on('SIGINT', () => {
  stopScheduler();
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopScheduler();
  closeDatabase();
  process.exit(0);
});

start();

export default app;
