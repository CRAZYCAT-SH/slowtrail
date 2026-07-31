import { Router, Request, Response } from 'express';
import { getFingerprints, getFingerprintDetail, getGroupedFingerprints, getGroupDetail } from '../services/fingerprintService';
import { QueryFilter } from '../services/statsService';

const router = Router();

/**
 * GET /api/fingerprints
 * 获取 SQL 指纹归类列表
 * Query: startTime, endTime, dbName, instanceName, sortBy, order, limit, offset, search, view
 * view=grouped 时返回按分类聚合的结果
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };

    const sortBy = (req.query.sortBy as string) || 'count';
    const order = (req.query.order as string) || 'desc';
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = req.query.search as string | undefined;
    const view = req.query.view as string | undefined;

    if (view === 'grouped') {
      const result = getGroupedFingerprints(filter, sortBy, order, limit, offset, search);
      res.json({ success: true, ...result });
    } else {
      const result = getFingerprints(filter, sortBy, order, limit, offset, search);
      res.json({ success: true, ...result });
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取指纹列表失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/fingerprints/detail
 * 获取单个指纹的详细信息
 * Query: fingerprint (必填), startTime, endTime, dbName, instanceName, samplesLimit, samplesOffset, trendGranularity, tzOffset
 */
router.get('/detail', (req: Request, res: Response) => {
  try {
    const fp = req.query.fingerprint as string;
    if (!fp) {
      res.status(400).json({ success: false, error: '缺少必填参数: fingerprint' });
      return;
    }

    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };

    const samplesLimit = parseInt(req.query.samplesLimit as string) || 10;
    const samplesOffset = parseInt(req.query.samplesOffset as string) || 0;
    const trendGranularity = req.query.trendGranularity as 'minute' | 'hour' | 'day' | undefined;
    const tzOffset = req.query.tzOffset ? Number(req.query.tzOffset) : undefined;

    const detail = getFingerprintDetail(fp, filter, samplesLimit, samplesOffset, trendGranularity, tzOffset);
    if (!detail) {
      res.status(404).json({ success: false, error: '未找到该指纹的数据' });
      return;
    }

    res.json({ success: true, data: detail });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取指纹详情失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/fingerprints/group-detail
 * 获取分组详情：汇总统计 + 各成员指纹独立统计
 * Body: { fingerprints: string[], startTime?, endTime?, dbName?, instanceName? }
 */
router.post('/group-detail', (req: Request, res: Response) => {
  try {
    const { fingerprints, startTime, endTime, dbName, instanceName, tzOffset, trendGranularity } = req.body;
    if (!fingerprints || !Array.isArray(fingerprints) || fingerprints.length === 0) {
      res.status(400).json({ success: false, error: '缺少必填参数: fingerprints' });
      return;
    }

    const filter: QueryFilter = {
      startTime: startTime ? Number(startTime) : undefined,
      endTime: endTime ? Number(endTime) : undefined,
      dbName: dbName || undefined,
      instanceName: instanceName || undefined,
    };

    const detail = getGroupDetail(fingerprints, filter, tzOffset ? Number(tzOffset) : undefined, trendGranularity as 'minute' | 'hour' | 'day' | undefined);
    if (!detail) {
      res.status(404).json({ success: false, error: '未找到该分组的数据' });
      return;
    }

    res.json({ success: true, data: detail });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取分组详情失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
