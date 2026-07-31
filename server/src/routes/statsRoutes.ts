import { Router, Request, Response } from 'express';
import { getStatsOverview, getTopQueries, getTrends, getFilterOptions, getDistribution, getHeatmap, QueryFilter, TrendFilter, OverviewFilter } from '../services/statsService';

const router = Router();

/**
 * GET /api/stats/filter-options
 * 获取可用的筛选选项（数据库名、实例名列表）
 */
router.get('/filter-options', (_req: Request, res: Response) => {
  try {
    const options = getFilterOptions();
    res.json({ success: true, data: options });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取筛选选项失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats/overview
 * 获取统计概览数据（支持环比对比）
 * Query: startTime, endTime, dbName, instanceName, compareStartTime, compareEndTime
 */
router.get('/overview', (req: Request, res: Response) => {
  try {
    const filter: OverviewFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
      compareStartTime: req.query.compareStartTime ? Number(req.query.compareStartTime) : undefined,
      compareEndTime: req.query.compareEndTime ? Number(req.query.compareEndTime) : undefined,
    };

    const overview = getStatsOverview(filter);
    res.json({ success: true, data: overview });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取统计概览失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats/top-queries
 * 获取 TOP N 慢查询列表
 * Query: startTime, endTime, dbName, instanceName, limit, offset, sortBy
 */
router.get('/top-queries', (req: Request, res: Response) => {
  try {
    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const sortBy = (req.query.sortBy as string) || 'query_time';

    const result = getTopQueries(filter, limit, offset, sortBy);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取 TOP 查询失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats/trends
 * 获取趋势分析数据
 * Query: startTime, endTime, dbName, instanceName, granularity(minute|hour|day), fingerprint, tzOffset
 */
router.get('/trends', (req: Request, res: Response) => {
  try {
    const filter: TrendFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
      granularity: (req.query.granularity as 'minute' | 'hour' | 'day') || 'day',
      fingerprint: req.query.fingerprint as string | undefined,
      groupId: req.query.groupId ? Number(req.query.groupId) : undefined,
      tzOffset: req.query.tzOffset ? Number(req.query.tzOffset) : undefined,
    };

    const trends = getTrends(filter);
    res.json({ success: true, data: trends });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取趋势数据失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats/distribution
 * 获取分布统计（耗时区间、按数据库、按实例）
 * Query: startTime, endTime, dbName, instanceName
 */
router.get('/distribution', (req: Request, res: Response) => {
  try {
    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };

    const distribution = getDistribution(filter);
    res.json({ success: true, data: distribution });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取分布统计失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats/heatmap
 * 获取 7×24 热力图数据
 * Query: startTime, endTime, dbName, instanceName, tzOffset
 */
router.get('/heatmap', (req: Request, res: Response) => {
  try {
    const filter: QueryFilter = {
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      dbName: req.query.dbName as string | undefined,
      instanceName: req.query.instanceName as string | undefined,
    };
    const tzOffset = req.query.tzOffset ? Number(req.query.tzOffset) : undefined;

    const heatmap = getHeatmap(filter, tzOffset);
    res.json({ success: true, data: heatmap });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 获取热力图数据失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
