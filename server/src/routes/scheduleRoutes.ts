/**
 * 定时任务管理路由
 * /api/schedule
 */

import { Router, Request, Response } from 'express';
import {
  listScheduleTasks,
  getScheduleTask,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  triggerTask,
} from '../services/schedulerService';

const router = Router();

/**
 * GET /api/schedule
 * 获取所有定时任务列表
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const tasks = listScheduleTasks();
    res.json({ success: true, data: tasks });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/schedule/:id
 * 获取单个定时任务
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的任务 ID' });
      return;
    }
    const task = getScheduleTask(id);
    if (!task) {
      res.status(404).json({ success: false, error: '任务不存在' });
      return;
    }
    res.json({ success: true, data: task });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/schedule
 * 创建定时任务
 * Body: { dataSourceId, instanceName, enabled?, intervalMinutes?, daysOffset? }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { dataSourceId, instanceName, enabled, intervalMinutes, daysOffset } = req.body;

    if (!dataSourceId || !instanceName) {
      res.status(400).json({ success: false, error: '缺少必填参数: dataSourceId, instanceName' });
      return;
    }

    // 校验
    if (intervalMinutes !== undefined && (intervalMinutes < 1 || intervalMinutes > 10080)) {
      res.status(400).json({ success: false, error: '同步间隔需在 1 分钟到 7 天（10080 分钟）之间' });
      return;
    }
    if (daysOffset !== undefined && (daysOffset < 0 || daysOffset > 30)) {
      res.status(400).json({ success: false, error: '回溯天数需在 0 到 30 之间' });
      return;
    }

    const task = createScheduleTask({ dataSourceId, instanceName, enabled, intervalMinutes, daysOffset });
    res.json({ success: true, data: task });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404 : err.message.includes('不能为空') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/schedule/:id
 * 更新定时任务
 * Body: { dataSourceId?, instanceName?, enabled?, intervalMinutes?, daysOffset? }
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的任务 ID' });
      return;
    }

    const { dataSourceId, instanceName, enabled, intervalMinutes, daysOffset } = req.body;

    if (intervalMinutes !== undefined && (intervalMinutes < 1 || intervalMinutes > 10080)) {
      res.status(400).json({ success: false, error: '同步间隔需在 1 分钟到 7 天（10080 分钟）之间' });
      return;
    }
    if (daysOffset !== undefined && (daysOffset < 0 || daysOffset > 30)) {
      res.status(400).json({ success: false, error: '回溯天数需在 0 到 30 之间' });
      return;
    }

    const task = updateScheduleTask(id, { dataSourceId, instanceName, enabled, intervalMinutes, daysOffset });
    res.json({ success: true, data: task });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/schedule/:id
 * 删除定时任务
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的任务 ID' });
      return;
    }
    deleteScheduleTask(id);
    res.json({ success: true, message: '任务已删除' });
  } catch (error: unknown) {
    const err = error as Error;
    const status = err.message.includes('不存在') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/schedule/:id/trigger
 * 立即触发指定任务
 */
router.post('/:id/trigger', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: '无效的任务 ID' });
      return;
    }
    const result = await triggerTask(id);
    res.json({ success: result.success, message: result.message });
  } catch (error: unknown) {
    const err = error as Error;
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
