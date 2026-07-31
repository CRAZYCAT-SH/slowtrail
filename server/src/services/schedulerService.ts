/**
 * 定时调度服务
 * 基于 schedule_tasks 表的独立任务管理 + setInterval 轮询调度引擎
 */

import { getDatabase, saveDatabase } from '../db/index';
import { syncFromDataSource } from './syncService';

// ========== 类型 ==========

/** 定时任务记录 */
export interface ScheduleTask {
  id: number;
  dataSourceId: number;
  instanceName: string;
  enabled: boolean;
  intervalMinutes: number;
  daysOffset: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 创建/更新任务输入 */
export interface ScheduleTaskInput {
  dataSourceId: number;
  instanceName: string;
  enabled?: boolean;
  intervalMinutes?: number;
  daysOffset?: number;
}

/** 任务列表项（附带数据源名称） */
export interface ScheduleTaskItem extends ScheduleTask {
  dataSourceName: string;
  running: boolean;
}

// ========== 内部状态 ==========

/** 调度器检查间隔（毫秒），每 30 秒检查一次 */
const CHECK_INTERVAL_MS = 30 * 1000;

/** 主调度定时器 */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** 当前正在执行同步的任务 ID 集合（防止并发） */
const runningTasks = new Set<number>();

// ========== 工具函数 ==========

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcNextRunTime(intervalMinutes: number, fromTime?: number): number {
  const base = fromTime || Date.now();
  return base + intervalMinutes * 60 * 1000;
}

function rowToTask(row: unknown[]): ScheduleTask {
  return {
    id: row[0] as number,
    dataSourceId: row[1] as number,
    instanceName: row[2] as string,
    enabled: (row[3] as number) === 1,
    intervalMinutes: row[4] as number,
    daysOffset: row[5] as number,
    lastRunAt: row[6] as number | null,
    nextRunAt: row[7] as number | null,
    createdAt: row[8] as number,
    updatedAt: row[9] as number,
  };
}

// ========== CRUD ==========

/**
 * 获取所有定时任务（附带数据源名称和运行状态）
 */
export function listScheduleTasks(): ScheduleTaskItem[] {
  const db = getDatabase();
  const result = db.exec(
    `SELECT t.id, t.data_source_id, t.instance_name, t.enabled, t.interval_minutes,
            t.days_offset, t.last_run_at, t.next_run_at, t.created_at, t.updated_at,
            d.name as ds_name
     FROM schedule_tasks t
     LEFT JOIN data_sources d ON t.data_source_id = d.id
     ORDER BY t.created_at ASC`
  );
  if (result.length === 0) return [];

  return result[0].values.map((row) => ({
    ...rowToTask(row),
    dataSourceName: (row[10] as string) || '已删除',
    running: runningTasks.has(row[0] as number),
  }));
}

/**
 * 获取单个任务
 */
export function getScheduleTask(id: number): ScheduleTask | null {
  const db = getDatabase();
  const result = db.exec(
    `SELECT id, data_source_id, instance_name, enabled, interval_minutes,
            days_offset, last_run_at, next_run_at, created_at, updated_at
     FROM schedule_tasks WHERE id = ?`,
    [id]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToTask(result[0].values[0]);
}

/**
 * 创建定时任务
 */
export function createScheduleTask(input: ScheduleTaskInput): ScheduleTask {
  const db = getDatabase();
  const now = Date.now();
  const enabled = input.enabled !== false;
  const interval = input.intervalMinutes || 60;
  const daysOffset = input.daysOffset ?? 0;
  const nextRunAt = enabled ? calcNextRunTime(interval) : null;

  // 校验数据源存在
  const dsCheck = db.exec('SELECT id FROM data_sources WHERE id = ?', [input.dataSourceId]);
  if (dsCheck.length === 0 || dsCheck[0].values.length === 0) {
    throw new Error(`数据源 ${input.dataSourceId} 不存在`);
  }

  if (!input.instanceName || !input.instanceName.trim()) {
    throw new Error('实例名不能为空');
  }

  db.run(
    `INSERT INTO schedule_tasks (data_source_id, instance_name, enabled, interval_minutes, days_offset, last_run_at, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [input.dataSourceId, input.instanceName.trim(), enabled ? 1 : 0, interval, daysOffset, nextRunAt, now, now]
  );

  const idResult = db.exec('SELECT last_insert_rowid()');
  const id = idResult[0].values[0][0] as number;
  saveDatabase();

  return getScheduleTask(id)!;
}

/**
 * 更新定时任务
 */
export function updateScheduleTask(id: number, input: Partial<ScheduleTaskInput> & { enabled?: boolean }): ScheduleTask {
  const existing = getScheduleTask(id);
  if (!existing) {
    throw new Error(`定时任务 ${id} 不存在`);
  }

  const db = getDatabase();
  const now = Date.now();

  const dataSourceId = input.dataSourceId ?? existing.dataSourceId;
  const instanceName = input.instanceName?.trim() || existing.instanceName;
  const enabled = input.enabled ?? existing.enabled;
  const interval = input.intervalMinutes ?? existing.intervalMinutes;
  const daysOffset = input.daysOffset ?? existing.daysOffset;

  // 计算 nextRunAt
  let nextRunAt = existing.nextRunAt;
  if (enabled && !existing.enabled) {
    // 从禁用变为启用
    nextRunAt = calcNextRunTime(interval);
  } else if (enabled && input.intervalMinutes !== undefined && input.intervalMinutes !== existing.intervalMinutes) {
    // 间隔变更
    nextRunAt = calcNextRunTime(interval);
  } else if (!enabled) {
    nextRunAt = null;
  }

  db.run(
    `UPDATE schedule_tasks SET data_source_id = ?, instance_name = ?, enabled = ?,
            interval_minutes = ?, days_offset = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [dataSourceId, instanceName, enabled ? 1 : 0, interval, daysOffset, nextRunAt, now, id]
  );
  saveDatabase();

  return getScheduleTask(id)!;
}

/**
 * 删除定时任务
 */
export function deleteScheduleTask(id: number): void {
  const db = getDatabase();
  const existing = getScheduleTask(id);
  if (!existing) {
    throw new Error(`定时任务 ${id} 不存在`);
  }
  db.run('DELETE FROM schedule_tasks WHERE id = ?', [id]);
  saveDatabase();
}

// ========== 调度执行 ==========

/**
 * 获取所有需要调度的任务（enabled 且对应数据源也 enabled）
 */
function getActiveScheduleTasks(): Array<{
  id: number;
  dataSourceId: number;
  dataSourceName: string;
  instanceName: string;
  intervalMinutes: number;
  daysOffset: number;
  nextRunAt: number | null;
}> {
  const db = getDatabase();
  const result = db.exec(
    `SELECT t.id, t.data_source_id, d.name, t.instance_name, t.interval_minutes, t.days_offset, t.next_run_at
     FROM schedule_tasks t
     JOIN data_sources d ON t.data_source_id = d.id
     WHERE t.enabled = 1 AND d.enabled = 1`
  );
  if (result.length === 0) return [];

  return result[0].values.map((row) => ({
    id: row[0] as number,
    dataSourceId: row[1] as number,
    dataSourceName: row[2] as string,
    instanceName: row[3] as string,
    intervalMinutes: row[4] as number,
    daysOffset: row[5] as number,
    nextRunAt: row[6] as number | null,
  }));
}

/**
 * 更新任务的运行时间戳
 */
function updateTaskTimestamps(taskId: number, lastRunAt: number, nextRunAt: number): void {
  const db = getDatabase();
  db.run(
    'UPDATE schedule_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?',
    [lastRunAt, nextRunAt, taskId]
  );
  saveDatabase();
}

/**
 * 执行单个任务的同步
 */
async function executeTask(task: {
  id: number;
  dataSourceId: number;
  dataSourceName: string;
  instanceName: string;
  intervalMinutes: number;
  daysOffset: number;
}): Promise<void> {
  if (runningTasks.has(task.id)) {
    console.log(`[Scheduler] 任务 #${task.id} (${task.dataSourceName}/${task.instanceName}) 正在执行中，跳过`);
    return;
  }

  runningTasks.add(task.id);
  const now = Date.now();

  try {
    // 计算日期范围：endDate 始终为今天，startDate = today - daysOffset
    const today = new Date();
    const endDateObj = new Date(today);
    const startDateObj = new Date(today);
    startDateObj.setDate(startDateObj.getDate() - task.daysOffset);

    const startDate = formatDate(startDateObj);
    const endDate = formatDate(endDateObj);

    console.log(`[Scheduler] 任务 #${task.id} 开始: ${task.dataSourceName}/${task.instanceName}, 范围=${startDate}~${endDate}`);

    const result = await syncFromDataSource({
      dataSourceId: task.dataSourceId,
      instanceName: task.instanceName,
      startDate,
      endDate,
      forceOverwrite: true,
      triggerType: 'scheduled',
    });

    console.log(`[Scheduler] 任务 #${task.id} 完成: 新增=${result.totalRecords}条, 同步=${result.syncedDates.length}天, 跳过=${result.skippedDates.length}天`);

    const nextRunAt = calcNextRunTime(task.intervalMinutes, now);
    updateTaskTimestamps(task.id, now, nextRunAt);
  } catch (error) {
    const err = error as Error;
    console.error(`[Scheduler] 任务 #${task.id} 失败:`, err.message);
    // 失败也更新时间，避免持续重试
    const nextRunAt = calcNextRunTime(task.intervalMinutes, now);
    updateTaskTimestamps(task.id, now, nextRunAt);
  } finally {
    runningTasks.delete(task.id);
  }
}

/**
 * 调度器主循环
 */
async function checkAndExecute(): Promise<void> {
  const now = Date.now();
  const tasks = getActiveScheduleTasks();

  for (const task of tasks) {
    const shouldRun = !task.nextRunAt || now >= task.nextRunAt;
    if (shouldRun) {
      executeTask(task).catch((err) => {
        console.error(`[Scheduler] 任务 #${task.id} 未预期错误:`, err);
      });
    }
  }
}

// ========== 公开调度器控制 ==========

/**
 * 初始化调度器
 */
export function initScheduler(): void {
  if (schedulerTimer) {
    console.log('[Scheduler] 调度器已在运行中');
    return;
  }

  // 为没有 nextRunAt 的已启用任务设置初始下次执行时间
  const tasks = getActiveScheduleTasks();
  const db = getDatabase();
  let updated = false;
  for (const task of tasks) {
    if (!task.nextRunAt) {
      const nextRunAt = calcNextRunTime(task.intervalMinutes);
      db.run('UPDATE schedule_tasks SET next_run_at = ? WHERE id = ?', [nextRunAt, task.id]);
      updated = true;
    }
  }
  if (updated) saveDatabase();

  schedulerTimer = setInterval(() => {
    checkAndExecute().catch((err) => {
      console.error('[Scheduler] 检查循环异常:', err);
    });
  }, CHECK_INTERVAL_MS);

  console.log(`[Scheduler] 调度器已启动，检查间隔=${CHECK_INTERVAL_MS / 1000}秒，活跃任务=${tasks.length}个`);

  // 启动后立即检查一次
  checkAndExecute().catch((err) => {
    console.error('[Scheduler] 首次检查异常:', err);
  });
}

/**
 * 停止调度器
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Scheduler] 调度器已停止');
  }
}

/**
 * 立即触发指定任务
 */
export async function triggerTask(taskId: number): Promise<{ success: boolean; message: string }> {
  const task = getScheduleTask(taskId);
  if (!task) {
    return { success: false, message: '任务不存在' };
  }

  if (runningTasks.has(taskId)) {
    return { success: false, message: '该任务正在执行中' };
  }

  // 查询数据源名
  const db = getDatabase();
  const dsResult = db.exec('SELECT name, enabled FROM data_sources WHERE id = ?', [task.dataSourceId]);
  if (dsResult.length === 0 || dsResult[0].values.length === 0) {
    return { success: false, message: '关联的数据源已被删除' };
  }
  const dsName = dsResult[0].values[0][0] as string;
  const dsEnabled = (dsResult[0].values[0][1] as number) === 1;
  if (!dsEnabled) {
    return { success: false, message: '关联的数据源已禁用' };
  }

  executeTask({
    id: task.id,
    dataSourceId: task.dataSourceId,
    dataSourceName: dsName,
    instanceName: task.instanceName,
    intervalMinutes: task.intervalMinutes,
    daysOffset: task.daysOffset,
  }).catch((err) => {
    console.error(`[Scheduler] 手动触发任务 #${taskId} 失败:`, err);
  });

  return { success: true, message: `已触发任务: ${dsName}/${task.instanceName}` };
}

/**
 * 检查任务是否正在运行
 */
export function isTaskRunning(taskId: number): boolean {
  return runningTasks.has(taskId);
}
