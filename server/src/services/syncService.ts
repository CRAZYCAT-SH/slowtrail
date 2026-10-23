/**
 * 数据同步服务
 * 通过 Provider 从数据源按日拉取慢查询数据，逐批算指纹后入库
 */

import { getProvider } from '../providers/index';
import { NormalizedSlowQuery } from '../providers/types';
import { getDataSourceRaw, getDefaultDataSource } from './dataSourceService';
import { insertSlowQueries, isDateSynced, addSyncRecord, clearDataBySyncRecord, SlowQueryRecord } from '../db/queries';
import { analyzeDatabase } from '../db/index';

// 动态导入 sql-fingerprint（ESM 包，CommonJS 环境需要 dynamic import）
let fingerprintFn: ((sql: string, matchMD5?: boolean, matchEmbedded?: boolean) => string) | null = null;

async function getFingerprint(): Promise<typeof fingerprintFn> {
  if (!fingerprintFn) {
    // 使用 Function 构造器避免 TypeScript 将 import() 转译为 require()
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const mod = await dynamicImport('sql-fingerprint');
    fingerprintFn = mod.default || mod;
  }
  return fingerprintFn;
}
// ========== 类型 ==========

export interface SyncParams {
  dataSourceId?: number;
  instanceName: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  forceOverwrite?: boolean;
  triggerType?: 'manual' | 'scheduled';
}

export interface SyncResult {
  totalRecords: number;
  syncedDates: string[];
  skippedDates: string[];
  emptyDates: string[];
  errors: string[];
}

// ========== 工具函数 ==========

/**
 * 枚举日期范围内的每一天
 */
function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);

  let year = sy, month = sm, day = sd;

  while (
    year < ey ||
    (year === ey && month < em) ||
    (year === ey && month === em && day <= ed)
  ) {
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    dates.push(`${year}-${m}-${d}`);

    // 递增一天
    const daysInMonth = new Date(year, month, 0).getDate();
    day++;
    if (day > daysInMonth) {
      day = 1;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }

  return dates;
}

/**
 * 计算某一天的本地时区起止时间戳（[00:00, 次日00:00)）
 */
function dayBounds(date: string): { start: number; end: number } {
  const start = new Date(date + 'T00:00:00').getTime();
  const nextDay = new Date(start);
  nextDay.setDate(nextDay.getDate() + 1);
  return { start, end: nextDay.getTime() };
}

/**
 * 将归一化记录转换为带指纹的 SlowQueryRecord
 */
function toSlowQueryRecord(
  normalized: NormalizedSlowQuery,
  dataSourceId: number,
  syncDate: string,
  sourceRef: string
): SlowQueryRecord {
  const querySql = normalized.querySql || '';
  // 计算 SQL 指纹（matchEmbeddedNumbers=true 保留表名中的数字）
  const fp = querySql && fingerprintFn ? fingerprintFn(querySql, false, true) : '';

  return {
    query_sql: querySql,
    fingerprint: fp,
    query_time: normalized.queryTime,
    lock_time: normalized.lockTime,
    rows_examined: normalized.rowsExamined,
    rows_sent: normalized.rowsSent,
    db_name: normalized.dbName,
    instance_name: normalized.instanceName,
    instance_id: normalized.instanceId,
    node_id: normalized.nodeId,
    user_name: normalized.userName,
    user_host: normalized.userHost,
    timestamp: normalized.timestamp,
    es_index: sourceRef,
    data_source_id: dataSourceId,
    sync_date: syncDate,
  };
}

// ========== 主流程 ==========

/**
 * 从指定数据源拉取数据
 * 按日为单元迭代：每天做时间区间查询 → 逐批算指纹入库 → 记同步历史
 */
export async function syncFromDataSource(params: SyncParams): Promise<SyncResult> {
  const { instanceName, startDate, endDate, forceOverwrite = false, triggerType = 'manual' } = params;

  // 预加载指纹模块（ESM 包需要动态导入）
  await getFingerprint();

  // 确定数据源
  let dataSourceId = params.dataSourceId;
  if (!dataSourceId) {
    const defaultDs = getDefaultDataSource();
    if (!defaultDs) {
      throw new Error('未配置默认数据源，请指定 dataSourceId');
    }
    dataSourceId = defaultDs.id;
  }

  const dsRecord = getDataSourceRaw(dataSourceId);
  if (!dsRecord) {
    throw new Error(`数据源 ${dataSourceId} 不存在`);
  }
  if (!dsRecord.enabled) {
    throw new Error(`数据源 "${dsRecord.name}" 已禁用`);
  }

  const provider = getProvider(dsRecord.type);
  const dates = enumerateDates(startDate, endDate);

  const result: SyncResult = {
    totalRecords: 0,
    syncedDates: [],
    skippedDates: [],
    emptyDates: [],
    errors: [],
  };

  for (const date of dates) {
    // 检查是否已同步
    if (isDateSynced(dataSourceId, instanceName, date)) {
      if (!forceOverwrite) {
        result.skippedDates.push(date);
        continue;
      }
      // 覆盖模式：先删除旧数据
      clearDataBySyncRecord(dataSourceId, instanceName, date);
      console.log(`[Sync] 覆盖模式：已清除 ${date} (instance: ${instanceName}) 的旧数据`);
    }

    try {
      const { start, end } = dayBounds(date);
      let dayCount = 0;
      let sourceRef = '';

      // 按批提交，每批一个独立事务
      //
      // 这里刻意不把一整天包在单个事务里：拉取过程要 await 网络 IO，
      // 而 better-sqlite3 是单连接同步驱动，跨 await 持有事务会把这期间
      // 其它 HTTP 请求和定时任务的写入一起吞进本事务，回滚时会连带丢掉。
      // 代价是单日不再原子，改用下面的失败补偿来保证「该天要么完整入库、要么不留残留」。
      try {
        // 逐批消费 provider 产出
        for await (const batch of provider.fetchRecords(dsRecord.settings, {
          instanceName,
          startTime: start,
          endTime: end,
        })) {
          sourceRef = batch.sourceRef;

          // 转换为 SlowQueryRecord（含指纹计算）
          const records = batch.records.map((r) =>
            toSlowQueryRecord(r, dataSourceId!, date, sourceRef)
          );

          // 每批自开事务提交，写入即落盘
          insertSlowQueries(records, false);
          dayCount += records.length;
        }
      } catch (batchError) {
        // 补偿：清理本次已写入的部分数据，避免留下不完整的一天
        // 此时尚未写 sync_history，重试该日期时会重新完整拉取
        if (dayCount > 0) {
          try {
            clearDataBySyncRecord(dataSourceId!, instanceName, date);
            console.log(`[Sync] ${date} 拉取中断，已回滚该日已写入的 ${dayCount} 条`);
          } catch (cleanupError) {
            console.error(`[Sync] ${date} 清理不完整数据失败:`, (cleanupError as Error).message);
          }
        }
        throw batchError;
      }

      if (dayCount > 0) {
        // 记录同步历史
        addSyncRecord(dataSourceId, instanceName, date, sourceRef, dayCount, triggerType);
        result.syncedDates.push(date);
        result.totalRecords += dayCount;
        console.log(`[Sync] ${date} (instance: ${instanceName}) 同步完成: ${dayCount} 条`);
      } else {
        // 查询成功但无数据
        result.emptyDates.push(date);
      }
    } catch (error: unknown) {
      const err = error as Error;
      const errorMsg = `${date}: ${err.message}`;
      result.errors.push(errorMsg);
      console.error(`[Sync] ${date} 同步失败:`, err.message);
      // 单日出错继续后续日期
    }
  }

  // 有新数据入库则刷新统计信息，让查询规划器按新的数据分布选择索引
  if (result.totalRecords > 0) {
    analyzeDatabase();
  }

  console.log(
    `[Sync] 同步完成 - 总计: ${result.totalRecords} 条, ` +
    `成功: ${result.syncedDates.length} 天, ` +
    `跳过: ${result.skippedDates.length} 天, ` +
    `无数据: ${result.emptyDates.length} 天, ` +
    `失败: ${result.errors.length} 天`
  );

  return result;
}
