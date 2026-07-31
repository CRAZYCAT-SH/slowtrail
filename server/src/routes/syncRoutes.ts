import { Router, Request, Response } from 'express';
import { syncFromDataSource, SyncParams } from '../services/syncService';
import { getSyncHistory, clearAllData, clearDataByTimeRange, clearDataBySyncRecord, getDatabaseStats, getLastSyncedInstance } from '../db/queries';

const router = Router();

/**
 * POST /api/sync
 * 触发数据同步：从指定数据源拉取指定 instance_name + 日期范围的数据
 * Body: { dataSourceId?: number, instanceName: string, startDate: string, endDate: string, forceOverwrite?: boolean }
 */
router.post('/', async (req: Request, res: Response) => {
  const { dataSourceId, instanceName, startDate, endDate, forceOverwrite } = req.body as SyncParams;

  // 参数校验
  if (!instanceName || !startDate || !endDate) {
    res.status(400).json({
      success: false,
      error: '缺少必填参数: instanceName, startDate, endDate',
    });
    return;
  }

  // 日期格式校验
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    res.status(400).json({
      success: false,
      error: '日期格式错误，请使用 YYYY-MM-DD 格式',
    });
    return;
  }

  if (new Date(startDate) > new Date(endDate)) {
    res.status(400).json({
      success: false,
      error: '开始日期不能晚于结束日期',
    });
    return;
  }

  try {
    console.log(`[API] 开始同步: dataSource=${dataSourceId || 'default'}, instance=${instanceName}, ${startDate} ~ ${endDate}, overwrite=${!!forceOverwrite}`);
    const result = await syncFromDataSource({ dataSourceId, instanceName, startDate, endDate, forceOverwrite });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[API] 同步失败:', err.message);
    res.status(500).json({ success: false, error: '同步失败: ' + err.message });
  }
});

/**
 * GET /api/sync/history
 * 获取同步历史记录
 * Query: instanceName (可选), dataSourceId (可选)
 */
router.get('/history', (req: Request, res: Response) => {
  try {
    const instanceName = req.query.instanceName as string | undefined;
    const dataSourceId = req.query.dataSourceId ? Number(req.query.dataSourceId) : undefined;
    const history = getSyncHistory({ dataSourceId, instanceName });
    res.json({ success: true, data: history });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/last-instance
 * 获取最后一次同步的实例名
 */
router.get('/last-instance', (_req: Request, res: Response) => {
  try {
    const instanceName = getLastSyncedInstance();
    res.json({ success: true, data: instanceName });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/stats
 * 获取本地数据库统计信息
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getDatabaseStats();
    res.json({ success: true, data: stats });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/sync/data
 * 清空本地数据
 * Query: startTime, endTime（可选毫秒时间戳，不传则清空所有）
 */
router.delete('/data', (req: Request, res: Response) => {
  try {
    const startTime = req.query.startTime ? Number(req.query.startTime) : undefined;
    const endTime = req.query.endTime ? Number(req.query.endTime) : undefined;

    if (startTime != null && endTime != null) {
      if (isNaN(startTime) || isNaN(endTime)) {
        res.status(400).json({ success: false, error: '时间参数格式错误，请传入毫秒时间戳' });
        return;
      }
      const deletedCount = clearDataByTimeRange(startTime, endTime);
      res.json({ success: true, message: `已删除 ${deletedCount} 条记录`, deletedCount });
    } else {
      clearAllData();
      res.json({ success: true, message: '所有数据已清空' });
    }
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/sync/record
 * 按同步记录删除数据
 * Query: dataSourceId (必填), instanceName (必填), syncDate (必填)
 */
router.delete('/record', (req: Request, res: Response) => {
  try {
    const dataSourceId = req.query.dataSourceId ? Number(req.query.dataSourceId) : undefined;
    const instanceName = req.query.instanceName as string;
    const syncDate = req.query.syncDate as string;

    if (!dataSourceId || !instanceName || !syncDate) {
      res.status(400).json({ success: false, error: '缺少必填参数: dataSourceId, instanceName, syncDate' });
      return;
    }

    const deletedCount = clearDataBySyncRecord(dataSourceId, instanceName, syncDate);
    res.json({ success: true, message: `已删除 ${deletedCount} 条记录`, deletedCount });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
