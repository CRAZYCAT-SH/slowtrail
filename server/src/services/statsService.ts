import { getDatabase } from '../db/index';

/**
 * 查询过滤参数
 */
export interface QueryFilter {
  startTime?: number;
  endTime?: number;
  dbName?: string;
  instanceName?: string;
}

/**
 * 统计概览数据
 */
export interface StatsOverview {
  totalCount: number;
  avgQueryTime: number;
  maxQueryTime: number;
  avgRowsExamined: number;
  avgLockTime: number;
  totalRowsExamined: number;
  totalQueryTime: number;
}

/**
 * 带环比的统计概览响应
 */
export interface StatsOverviewWithCompare {
  current: StatsOverview;
  compare?: StatsOverview;
}

/**
 * 耗时分布项
 */
export interface TimeRangeItem {
  range: string;
  count: number;
}

/**
 * 维度分布项
 */
export interface DimensionItem {
  name: string;
  count: number;
}

/**
 * 分布统计结果
 */
export interface StatsDistribution {
  timeRanges: TimeRangeItem[];
  byDatabase: DimensionItem[];
  byInstance: DimensionItem[];
}

/**
 * 热力图数据点
 */
export interface HeatmapPoint {
  dayOfWeek: number; // 0=周一, 6=周日
  hour: number; // 0-23
  count: number;
}

/**
 * 慢查询记录（带 id）
 * 字段与 slow_queries 表一一对应，data_source_name 由 LEFT JOIN data_sources 取得
 */
export interface SlowQueryItem {
  id: number;
  query_sql: string;
  fingerprint: string;
  query_time: number;
  lock_time: number | null;
  rows_examined: number | null;
  rows_sent: number | null;
  db_name: string | null;
  instance_name: string | null;
  instance_id: string | null;
  node_id: string | null;
  user_name: string | null;
  user_host: string | null;
  timestamp: number;
  es_index: string | null;
  data_source_id: number | null;
  data_source_name: string | null;
  sync_date: string | null;
}

/**
 * 构建 WHERE 条件和参数
 */
function buildWhereClause(filter: QueryFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.startTime != null) {
    conditions.push('timestamp >= ?');
    params.push(filter.startTime);
  }
  if (filter.endTime != null) {
    conditions.push('timestamp <= ?');
    params.push(filter.endTime);
  }
  if (filter.dbName) {
    conditions.push('db_name = ?');
    params.push(filter.dbName);
  }
  if (filter.instanceName) {
    conditions.push('instance_name = ?');
    params.push(filter.instanceName);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

/**
 * 筛选选项（数据库名和实例名的去重列表）
 */
export interface FilterOptions {
  dbNames: string[];
  instanceNames: string[];
}

/**
 * 获取可用的筛选选项（数据库名、实例名去重列表）
 */
export function getFilterOptions(): FilterOptions {
  const db = getDatabase();

  const dbResult = db.exec('SELECT DISTINCT db_name FROM slow_queries WHERE db_name IS NOT NULL AND db_name != \'\' ORDER BY db_name');
  const dbNames = dbResult.length > 0 ? dbResult[0].values.map((row) => row[0] as string) : [];

  const instanceResult = db.exec('SELECT DISTINCT instance_name FROM slow_queries WHERE instance_name IS NOT NULL AND instance_name != \'\' ORDER BY instance_name');
  const instanceNames = instanceResult.length > 0 ? instanceResult[0].values.map((row) => row[0] as string) : [];

  return { dbNames, instanceNames };
}

/**
 * 内部：获取单次统计概览
 */
function queryOverview(filter: QueryFilter): StatsOverview {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  const sql = `
    SELECT 
      COUNT(*) as totalCount,
      COALESCE(AVG(query_time), 0) as avgQueryTime,
      COALESCE(MAX(query_time), 0) as maxQueryTime,
      COALESCE(AVG(rows_examined), 0) as avgRowsExamined,
      COALESCE(AVG(lock_time), 0) as avgLockTime,
      COALESCE(SUM(rows_examined), 0) as totalRowsExamined,
      COALESCE(SUM(query_time), 0) as totalQueryTime
    FROM slow_queries ${where}
  `;

  const result = db.exec(sql, params);
  if (result.length === 0 || result[0].values.length === 0) {
    return {
      totalCount: 0,
      avgQueryTime: 0,
      maxQueryTime: 0,
      avgRowsExamined: 0,
      avgLockTime: 0,
      totalRowsExamined: 0,
      totalQueryTime: 0,
    };
  }

  const row = result[0].values[0];
  return {
    totalCount: row[0] as number,
    avgQueryTime: Math.round((row[1] as number) * 1000) / 1000,
    maxQueryTime: Math.round((row[2] as number) * 1000) / 1000,
    avgRowsExamined: Math.round(row[3] as number),
    avgLockTime: Math.round((row[4] as number) * 1000) / 1000,
    totalRowsExamined: row[5] as number,
    totalQueryTime: Math.round((row[6] as number) * 1000) / 1000,
  };
}

/**
 * 获取统计概览（支持环比对比）
 * 如果传入 compareStartTime/compareEndTime，会额外查询上期数据
 */
export interface OverviewFilter extends QueryFilter {
  compareStartTime?: number;
  compareEndTime?: number;
}

export function getStatsOverview(filter: OverviewFilter): StatsOverviewWithCompare {
  const current = queryOverview(filter);

  let compare: StatsOverview | undefined;
  if (filter.compareStartTime != null && filter.compareEndTime != null) {
    compare = queryOverview({
      startTime: filter.compareStartTime,
      endTime: filter.compareEndTime,
      dbName: filter.dbName,
      instanceName: filter.instanceName,
    });
  }

  return { current, compare };
}

/**
 * 获取 TOP N 慢查询
 */
export function getTopQueries(
  filter: QueryFilter,
  limit: number = 20,
  offset: number = 0,
  sortBy: string = 'query_time'
): { data: SlowQueryItem[]; total: number } {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 允许排序的字段白名单
  const allowedSortFields = ['query_time', 'lock_time', 'rows_examined', 'rows_sent', 'timestamp'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'query_time';

  // 查询总数
  const countSql = `SELECT COUNT(*) FROM slow_queries ${where}`;
  const countResult = db.exec(countSql, params);
  const total = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

  // 查询数据
  //
  // 分两段做：子查询只在覆盖索引里定位出本页的 id（不触碰 query_sql），
  // 外层再按这批 id 精确回表。直接 SELECT query_sql 会让排序前的每一行
  // 都被读入（平均 7KB），实测在 20 万行规模上从 81ms 退化到 1 秒以上。
  // 列名用显式 AS 固定，调用方依赖 columns 与取值下标对齐。
  // 排序补 id ASC 作次级键：排序字段并列时若不指定次级键，
  // 取哪些行由扫描顺序决定，翻页会出现重复或遗漏。
  const dataSql = `
    SELECT s.id AS id, s.query_sql AS query_sql, s.fingerprint AS fingerprint,
           s.query_time AS query_time, s.lock_time AS lock_time,
           s.rows_examined AS rows_examined, s.rows_sent AS rows_sent,
           s.db_name AS db_name, s.instance_name AS instance_name,
           s.instance_id AS instance_id, s.node_id AS node_id,
           s.user_name AS user_name, s.user_host AS user_host,
           s.timestamp AS timestamp, s.es_index AS es_index,
           s.data_source_id AS data_source_id, ds.name AS data_source_name,
           s.sync_date AS sync_date
    FROM slow_queries s
    LEFT JOIN data_sources ds ON ds.id = s.data_source_id
    JOIN (
      SELECT id FROM slow_queries ${where}
      ORDER BY ${sortField} DESC, id ASC
      LIMIT ? OFFSET ?
    ) picked ON picked.id = s.id
    ORDER BY s.${sortField} DESC, s.id ASC
  `;

  const dataResult = db.exec(dataSql, [...params, limit, offset]);
  if (dataResult.length === 0) {
    return { data: [], total };
  }

  const columns = dataResult[0].columns;
  const data = dataResult[0].values.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      record[col] = row[i];
    });
    return record as unknown as SlowQueryItem;
  });

  return { data, total };
}

/**
 * 趋势数据点
 */
export interface TrendPoint {
  time: number; // 该时段起始毫秒时间戳
  count: number;
  avgQueryTime: number;
  maxQueryTime: number;
}

/**
 * 趋势查询扩展过滤参数
 */
export interface TrendFilter extends QueryFilter {
  granularity?: 'minute' | 'hour' | 'day';
  fingerprint?: string;
  groupId?: number;
  tzOffset?: number; // 客户端时区偏移（分钟），如 UTC+8 为 -480
}

/**
 * 获取趋势分析数据
 * 按时间粒度（分钟/小时/天）聚合慢 SQL 的数量和耗时
 * 使用毫秒时间戳数值分组，根据客户端时区偏移量对齐本地时间
 */
export function getTrends(filter: TrendFilter): TrendPoint[] {
  const db = getDatabase();
  const granularity = filter.granularity || 'day';
  // tzOffset 是 JS getTimezoneOffset() 的值（UTC+8 时为 -480）
  // 转为毫秒偏移量：本地时间 = UTC + (-tzOffset * 60000)
  const tzOffsetMs = -(filter.tzOffset || 0) * 60000;

  // 构建 WHERE 条件
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.startTime != null) {
    conditions.push('timestamp >= ?');
    params.push(filter.startTime);
  }
  if (filter.endTime != null) {
    conditions.push('timestamp <= ?');
    params.push(filter.endTime);
  }
  if (filter.dbName) {
    conditions.push('db_name = ?');
    params.push(filter.dbName);
  }
  if (filter.instanceName) {
    conditions.push('instance_name = ?');
    params.push(filter.instanceName);
  }
  if (filter.fingerprint) {
    conditions.push('fingerprint = ?');
    params.push(filter.fingerprint);
  }
  if (filter.groupId) {
    // 根据分组 ID 查询其成员指纹
    const membersResult = db.exec(
      'SELECT fingerprint FROM fingerprint_group_members WHERE group_id = ?',
      [filter.groupId]
    );
    if (membersResult.length > 0 && membersResult[0].values.length > 0) {
      const fps = membersResult[0].values.map((row) => row[0] as string);
      const placeholders = fps.map(() => '?').join(',');
      conditions.push(`fingerprint IN (${placeholders})`);
      params.push(...fps);
    } else {
      // 分组不存在或无成员，返回空结果
      return [];
    }
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // 根据粒度选择分组间隔（毫秒）
  let intervalMs: number;
  if (granularity === 'minute') {
    intervalMs = 60000;
  } else if (granularity === 'hour') {
    intervalMs = 3600000;
  } else {
    intervalMs = 86400000;
  }

  // 使用整数除法按本地时间分组
  // (timestamp + tzOffsetMs) / intervalMs 的整数部分作为分组键
  const timeGroupExpr = `((timestamp + ${tzOffsetMs}) / ${intervalMs})`;

  const sql = `
    SELECT 
      ${timeGroupExpr} as timeGroup,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      ROUND(MAX(query_time), 3) as maxQueryTime
    FROM slow_queries ${where}
    GROUP BY timeGroup
    ORDER BY timeGroup ASC
  `;

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row) => ({
    // 还原为 UTC 毫秒时间戳：timeGroup * interval - tzOffsetMs
    time: (row[0] as number) * intervalMs - tzOffsetMs,
    count: row[1] as number,
    avgQueryTime: row[2] as number,
    maxQueryTime: row[3] as number,
  }));
}


/**
 * 获取分布统计数据
 * 包括：耗时区间分布、按数据库分布、按实例分布
 */
export function getDistribution(filter: QueryFilter): StatsDistribution {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 耗时区间分布
  const timeRangeSql = `
    SELECT 
      CASE 
        WHEN query_time < 1 THEN '0-1s'
        WHEN query_time < 2 THEN '1-2s'
        WHEN query_time < 5 THEN '2-5s'
        WHEN query_time < 10 THEN '5-10s'
        WHEN query_time < 30 THEN '10-30s'
        ELSE '>30s'
      END as range_label,
      COUNT(*) as count
    FROM slow_queries ${where}
    GROUP BY range_label
    ORDER BY MIN(query_time) ASC
  `;
  const timeRangeResult = db.exec(timeRangeSql, params);

  // 固定区间顺序
  const rangeOrder = ['0-1s', '1-2s', '2-5s', '5-10s', '10-30s', '>30s'];
  const rangeMap = new Map<string, number>();
  if (timeRangeResult.length > 0) {
    timeRangeResult[0].values.forEach((row) => {
      rangeMap.set(row[0] as string, row[1] as number);
    });
  }
  const timeRanges: TimeRangeItem[] = rangeOrder.map((range) => ({
    range,
    count: rangeMap.get(range) || 0,
  }));

  // 按数据库分布
  const dbSql = `
    SELECT db_name, COUNT(*) as count
    FROM slow_queries ${where} ${where ? 'AND' : 'WHERE'} db_name IS NOT NULL AND db_name != ''
    GROUP BY db_name
    ORDER BY count DESC
  `;
  const dbResult = db.exec(dbSql, params);
  const byDatabase: DimensionItem[] = dbResult.length > 0
    ? dbResult[0].values.map((row) => ({ name: row[0] as string, count: row[1] as number }))
    : [];

  // 按实例分布
  const instSql = `
    SELECT instance_name, COUNT(*) as count
    FROM slow_queries ${where} ${where ? 'AND' : 'WHERE'} instance_name IS NOT NULL AND instance_name != ''
    GROUP BY instance_name
    ORDER BY count DESC
  `;
  const instResult = db.exec(instSql, params);
  const byInstance: DimensionItem[] = instResult.length > 0
    ? instResult[0].values.map((row) => ({ name: row[0] as string, count: row[1] as number }))
    : [];

  return { timeRanges, byDatabase, byInstance };
}

/**
 * 获取 7×24 热力图数据
 * 按星期几(0=周一,6=周日) × 小时(0-23) 聚合慢 SQL 数量
 * @param tzOffset 客户端时区偏移（分钟），如 UTC+8 为 -480
 */
export function getHeatmap(filter: QueryFilter, tzOffset?: number): HeatmapPoint[] {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 将 tzOffset 转为毫秒偏移
  const tzOffsetMs = -(tzOffset || 0) * 60000;

  // SQLite 没有原生的星期/小时函数处理毫秒时间戳
  // 我们使用数学计算：
  // 本地毫秒时间戳 = timestamp + tzOffsetMs
  // Unix 天数 = localTs / 86400000（从 1970-01-01 开始）
  // 1970-01-01 是周四，所以 dayOfWeek = (unixDays + 3) % 7（0=周一）
  // 小时 = (localTs % 86400000) / 3600000

  const localTsExpr = `(timestamp + ${tzOffsetMs})`;
  const unixDaysExpr = `(${localTsExpr} / 86400000)`;
  const dayOfWeekExpr = `((${unixDaysExpr} + 3) % 7)`;
  const hourExpr = `((${localTsExpr} % 86400000) / 3600000)`;

  const sql = `
    SELECT 
      ${dayOfWeekExpr} as dayOfWeek,
      ${hourExpr} as hour,
      COUNT(*) as count
    FROM slow_queries ${where}
    GROUP BY dayOfWeek, hour
    ORDER BY dayOfWeek ASC, hour ASC
  `;

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row) => ({
    dayOfWeek: row[0] as number,
    hour: row[1] as number,
    count: row[2] as number,
  }));
}
