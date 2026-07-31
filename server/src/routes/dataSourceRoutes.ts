/**
 * 数据源管理路由
 * /api/datasources
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {
  getProviderTypes,
  listDataSources,
  getDataSource,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSourceConnection,
  getDataSourceInstanceNames,
  previewDataSource,
  testUnsavedConnection,
  getIndexFields,
} from '../services/dataSourceService';

// 文件上传目录
const UPLOAD_DIR = path.resolve(__dirname, '../../data/uploads');
// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置：存储到 server/data/uploads/
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // 使用时间戳 + 原始文件名避免冲突
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 最大 50MB
  fileFilter: (_req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，仅支持 .xlsx, .xls, .csv`));
    }
  },
});

const router = Router();

/**
 * GET /api/datasources/types
 * 获取可用的数据源类型列表
 */
router.get('/types', (_req: Request, res: Response) => {
  try {
    const types = getProviderTypes();
    res.json({ success: true, data: types });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/datasources
 * 获取数据源列表（settings 中密码脱敏）
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const list = listDataSources();
    res.json({ success: true, data: list });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources
 * 创建数据源
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, type, settings, enabled } = req.body;
    if (!name || !type || !settings) {
      res.status(400).json({ success: false, error: '缺少必填参数: name, type, settings' });
      return;
    }
    const record = createDataSource({ name, type, settings, enabled });
    res.json({ success: true, data: record });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('校验失败') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/datasources/:id
 * 修改数据源
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的数据源 ID' });
      return;
    }
    const { name, type, settings, enabled } = req.body;
    const record = updateDataSource(id, { name, type, settings, enabled });
    res.json({ success: true, data: record });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404
      : err.message.includes('校验失败') ? 400
      : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/datasources/:id
 * 删除数据源
 * Query: deleteData=true|false（是否同时删除已拉取的数据）
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的数据源 ID' });
      return;
    }
    const shouldDeleteData = req.query.deleteData === 'true';
    deleteDataSource(id, shouldDeleteData);
    res.json({ success: true, message: '数据源已删除' });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404
      : err.message.includes('不可删除') ? 403
      : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources/:id/test
 * 测试已保存数据源的连接
 */
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的数据源 ID' });
      return;
    }
    const result = await testDataSourceConnection(id);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources/test-unsaved
 * 测试未保存配置的连接（创建前预检）
 * Body: { type, settings }
 */
router.post('/test-unsaved', async (req: Request, res: Response) => {
  try {
    const { type, settings } = req.body;
    if (!type || !settings) {
      res.status(400).json({ success: false, error: '缺少必填参数: type, settings' });
      return;
    }
    const result = await testUnsavedConnection(type, settings);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/datasources/:id/instance-names
 * 获取数据源的实例名列表
 */
router.get('/:id/instance-names', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的数据源 ID' });
      return;
    }
    const names = await getDataSourceInstanceNames(id);
    res.json({ success: true, data: names });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404
      : err.message.includes('不支持') ? 400
      : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources/preview
 * 预览索引配置（body 传未落库的 type + settings + 日期区间）
 * Body: { type, settings, startDate, endDate }
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { type, settings, startDate, endDate } = req.body;
    if (!type || !settings || !startDate || !endDate) {
      res.status(400).json({ success: false, error: '缺少必填参数: type, settings, startDate, endDate' });
      return;
    }
    const result = await previewDataSource(type, settings, startDate, endDate);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不支持') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources/fields
 * 获取索引字段列表（用于字段映射下拉选择）
 * Body: { type, settings, dataSourceId? }
 */
router.post('/fields', async (req: Request, res: Response) => {
  try {
    const { type, settings, dataSourceId } = req.body;
    if (!type || !settings) {
      res.status(400).json({ success: false, error: '缺少必填参数: type, settings' });
      return;
    }
    const fields = await getIndexFields(type, settings, dataSourceId);
    res.json({ success: true, data: fields });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不支持') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/datasources/upload
 * 上传 Excel/CSV 文件，返回存储路径和表头列名
 * 用于文件类数据源（如 Excel）的配置流程
 */
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '未上传文件' });
      return;
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    // 解析 Excel 文件获取表头和工作表列表
    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;

    // 默认读取第一个 sheet 的表头
    const firstSheet = workbook.Sheets[sheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });

    // 第一行作为表头
    const headers: string[] = jsonData.length > 0
      ? (jsonData[0]).map((h) => String(h ?? ''))
      : [];

    // 预览前 5 行数据（不含表头）
    const previewRows = jsonData.slice(1, 6).map((row) =>
      row.map((cell) => String(cell ?? ''))
    );

    // 总行数（不含表头）
    const totalRows = Math.max(0, jsonData.length - 1);

    res.json({
      success: true,
      data: {
        filePath,
        originalFileName: originalName,
        sheetNames,
        headers,
        previewRows,
        totalRows,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: `文件解析失败: ${err.message}` });
  }
});

/**
 * POST /api/datasources/upload/headers
 * 获取已上传文件指定 sheet 的表头（切换 sheet 时调用）
 * Body: { filePath, sheetName }
 */
router.post('/upload/headers', (req: Request, res: Response) => {
  try {
    const { filePath, sheetName } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, error: '缺少 filePath' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: '文件不存在，可能已被清理' });
      return;
    }

    const workbook = XLSX.readFile(filePath);
    const targetSheet = sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[targetSheet];

    if (!sheet) {
      res.status(400).json({ success: false, error: `工作表 "${targetSheet}" 不存在` });
      return;
    }

    const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const headers: string[] = jsonData.length > 0
      ? (jsonData[0]).map((h) => String(h ?? ''))
      : [];

    const previewRows = jsonData.slice(1, 6).map((row) =>
      row.map((cell) => String(cell ?? ''))
    );

    const totalRows = Math.max(0, jsonData.length - 1);

    res.json({
      success: true,
      data: { headers, previewRows, totalRows },
    });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: `文件解析失败: ${err.message}` });
  }
});

export default router;
