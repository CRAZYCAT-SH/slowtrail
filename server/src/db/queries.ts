import { getDatabase, saveDatabase, getDatabaseByteSize } from './index';

/**
 * 慢查询记录接口（新结构，含 data_source_id 和 sync_date）
 */
export interface SlowQueryRecord {
  query_sql: string;
  fingerprint: string;
  query_time: number;
  lock_time: number;
  rows_examined: number;
  rows_sent: number;
  db_name: string;
  instance_name: string;
  instance_id: string;
  node_id: string;
  user_name: string;
  user_host: string;
  timestamp: number;
  es_index: string;
  data_source_id: number;
  sync_date: string;
}

/**
 * 同步历史记录接口（新结构）
 */
export interface SyncHistoryRecord {
  id: number;
  data_source_id: number | null;
  instance_name: string;
  sync_date: string;
  source_ref: string | null;
  synced_at: number;
  record_count: number;
  trigger_type: string;
}

/**
 * 批量插入慢查询记录（新结构，含 data_source_id 和 sync_date）
 * 在已有事务中调用时不自动开启事务
 */
export function insertSlowQueries(records: SlowQueryRecord[], inTransaction: boolean = false): number {
  const db = getDatabase();

  if (records.length === 0) return 0;

  const insertSQL = `
    INSERT INTO slow_queries 
      (query_sql, fingerprint, query_time, lock_time, rows_examined, rows_sent, 
       db_name, instance_name, instance_id, node_id, user_name, user_host, timestamp, es_index,
       data_source_id, sync_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  if (!inTransaction) {
    db.run('BEGIN TRANSACTION');
  }

  // 复用一个预编译语句，避免每条记录都 prepare/finalize
  const stmt = db.prepare(insertSQL);

  try {
    let insertedCount = 0;
    for (const record of records) {
      stmt.run([
        record.query_sql,
        record.fingerprint,
        record.query_time,
        record.lock_time,
        record.rows_examined,
        record.rows_sent,
        record.db_name,
        record.instance_name,
        record.instance_id,
        record.node_id,
        record.user_name,
        record.user_host,
        record.timestamp,
        record.es_index,
        record.data_source_id,
        record.sync_date,
      ]);
      insertedCount++;
    }

    stmt.free();

    if (!inTransaction) {
      db.run('COMMIT');
    }
    return insertedCount;
  } catch (error) {
    stmt.free();
    if (!inTransaction) {
      db.run('ROLLBACK');
    }
    throw error;
  }
}

// ========== 新同步相关函数（按数据源 + 实例 + 日期去重） ==========

/**
 * 检查某个日期是否已同步
 */
export function isDateSynced(dataSourceId: number, instanceName: string, syncDate: string): boolean {
  const db = getDatabase();
  const result = db.exec(
    `SELECT COUNT(*) FROM sync_history WHERE data_source_id = ? AND instance_name = ? AND sync_date = ?`,
    [dataSourceId, instanceName, syncDate]
  );
  if (result.length === 0 || result[0].values.length === 0) return false;
  return (result[0].values[0][0] as number) > 0;
}

/**
 * 添加同步历史记录（新结构）
 */
export function addSyncRecord(
  dataSourceId: number,
  instanceName: string,
  syncDate: string,
  sourceRef: string,
  recordCount: number,
  triggerType: 'manual' | 'scheduled' = 'manual'
): void {
  const db = getDatabase();
  db.run(
    `INSERT OR REPLACE INTO sync_history (data_source_id, instance_name, sync_date, source_ref, synced_at, record_count, trigger_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [dataSourceId, instanceName, syncDate, sourceRef, Date.now(), recordCount, triggerType]
  );
}

/**
 * 获取同步历史记录（新结构）
 */
export function getSyncHistory(filter?: { dataSourceId?: number; instanceName?: string }): SyncHistoryRecord[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.dataSourceId) {
    conditions.push('data_source_id = ?');
    params.push(filter.dataSourceId);
  }
  if (filter?.instanceName) {
    conditions.push('instance_name = ?');
    params.push(filter.instanceName);
  }

  let sql = 'SELECT id, data_source_id, instance_name, sync_date, source_ref, synced_at, record_count, trigger_type FROM sync_history';
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY sync_date DESC';

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row) => ({
    id: row[0] as number,
    data_source_id: row[1] as number | null,
    instance_name: row[2] as string,
    sync_date: row[3] as string,
    source_ref: row[4] as string | null,
    synced_at: row[5] as number,
    record_count: row[6] as number,
    trigger_type: (row[7] as string) || 'manual',
  }));
}

/**
 * 获取最后一次同步的实例名
 */
export function getLastSyncedInstance(): string | null {
  const db = getDatabase();
  const result = db.exec(
    'SELECT instance_name FROM sync_history ORDER BY synced_at DESC LIMIT 1'
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] as string;
}

/**
 * 按同步记录删除数据（新结构，按三元组）
 * @returns 删除的慢查询记录数
 */
export function clearDataBySyncRecord(dataSourceId: number, instanceName: string, syncDate: string): number {
  const db = getDatabase();
  db.run(
    `DELETE FROM slow_queries WHERE data_source_id = ? AND instance_name = ? AND sync_date = ?`,
    [dataSourceId, instanceName, syncDate]
  );
  const result = db.exec('SELECT changes()');
  const deletedCount = result.length > 0 ? (result[0].values[0][0] as number) : 0;
  db.run(
    `DELETE FROM sync_history WHERE data_source_id = ? AND instance_name = ? AND sync_date = ?`,
    [dataSourceId, instanceName, syncDate]
  );
  saveDatabase();
  return deletedCount;
}

/**
 * 按数据源 ID 删除所有数据（用于级联删除数据源）
 */
export function clearDataByDataSource(dataSourceId: number): number {
  const db = getDatabase();
  db.run('DELETE FROM slow_queries WHERE data_source_id = ?', [dataSourceId]);
  const result = db.exec('SELECT changes()');
  const deletedCount = result.length > 0 ? (result[0].values[0][0] as number) : 0;
  db.run('DELETE FROM sync_history WHERE data_source_id = ?', [dataSourceId]);
  saveDatabase();
  return deletedCount;
}

/**
 * 获取已拉取的所有 instance_name 列表
 */
export function getLocalInstanceNames(): string[] {
  const db = getDatabase();
  const result = db.exec('SELECT DISTINCT instance_name FROM slow_queries ORDER BY instance_name');
  if (result.length === 0) return [];
  return result[0].values.map((row) => row[0] as string);
}

/**
 * 清空所有数据
 */
export function clearAllData(): void {
  const db = getDatabase();
  db.run('DELETE FROM slow_queries');
  db.run('DELETE FROM sync_history');
  saveDatabase();
}

/**
 * 按时间范围删除数据
 * @param startTime 开始时间（含），毫秒时间戳
 * @param endTime 结束时间（含），毫秒时间戳
 * @returns 删除的记录数
 */
export function clearDataByTimeRange(startTime: number, endTime: number): number {
  const db = getDatabase();
  db.run(
    `DELETE FROM slow_queries WHERE timestamp >= ? AND timestamp <= ?`,
    [startTime, endTime]
  );
  const result = db.exec('SELECT changes()');
  const deletedCount = result.length > 0 ? (result[0].values[0][0] as number) : 0;
  saveDatabase();
  return deletedCount;
}

/**
 * 获取数据库统计信息
 */
export function getDatabaseStats(): { totalRecords: number; dbSize: string } {
  const db = getDatabase();
  const result = db.exec('SELECT COUNT(*) FROM slow_queries');
  const totalRecords = result.length > 0 ? (result[0].values[0][0] as number) : 0;

  // 用 PRAGMA 计算体积，不能用 db.export()：那会复制一份完整的库到内存
  const sizeInMB = (getDatabaseByteSize() / (1024 * 1024)).toFixed(2);

  return { totalRecords, dbSize: `${sizeInMB} MB` };
}
