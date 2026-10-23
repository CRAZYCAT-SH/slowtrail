import { getDatabase } from '../db/index';
import { QueryFilter } from './statsService';

/**
 * 指纹归类统计项
 */
export interface FingerprintItem {
  fingerprint: string;
  count: number;
  avgQueryTime: number;
  maxQueryTime: number;
  minQueryTime: number;
  avgRowsExamined: number;
  avgLockTime: number;
  totalQueryTime: number;
}

/**
 * 慢查询原始记录（指纹详情里的样例行）
 * 字段与 slow_queries 表一一对应，data_source_name 由 LEFT JOIN data_sources 取得
 * 可空字段用 null：ES 文档里对应字段缺失时归一化后就是 null
 */
export interface SlowQuerySample {
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
 * 指纹详情
 */
export interface FingerprintDetail {
  fingerprint: string;
  count: number;
  avgQueryTime: number;
  maxQueryTime: number;
  minQueryTime: number;
  avgRowsExamined: number;
  avgLockTime: number;
  /** rows_sent 全为空时 AVG 结果为 null */
  avgRowsSent: number | null;
  totalQueryTime: number;
  databases: string[];
  instances: string[];
  samplesTotal: number;
  samples: SlowQuerySample[];
  timeTrend: Array<{
    time: number;
    count: number;
    avgTime: number;
    maxTime: number;
  }>;
  trendGranularity: 'minute' | 'hour' | 'day';
}

/**
 * 构建 WHERE 条件
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
 * 获取指纹归类列表
 * @param search 可选的模糊搜索关键词，匹配 fingerprint 或 query_sql
 */
export function getFingerprints(
  filter: QueryFilter,
  sortBy: string = 'count',
  order: string = 'desc',
  limit: number = 20,
  offset: number = 0,
  search?: string
): { data: FingerprintItem[]; total: number } {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 如果有搜索关键词，追加模糊匹配条件
  let searchWhere = where;
  const searchParams = [...params];
  if (search && search.trim()) {
    const keyword = `%${search.trim()}%`;
    const searchCondition = '(fingerprint LIKE ? OR query_sql LIKE ?)';
    if (searchWhere) {
      searchWhere += ' AND ' + searchCondition;
    } else {
      searchWhere = 'WHERE ' + searchCondition;
    }
    searchParams.push(keyword, keyword);
  }

  // 允许的排序字段
  const sortFieldMap: Record<string, string> = {
    count: 'count',
    avg_time: 'avgQueryTime',
    max_time: 'maxQueryTime',
    min_time: 'minQueryTime',
    avg_rows: 'avgRowsExamined',
    avg_lock: 'avgLockTime',
    total_time: 'totalQueryTime',
  };
  const sortField = sortFieldMap[sortBy] || 'count';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  // 排序值并列时（如多个指纹 count 相同）需要一个确定的次级键，
  // 否则取哪些行由扫描顺序决定，翻页时可能重复或遗漏

  // 查询总数（不同指纹的数量）
  const countSql = `SELECT COUNT(DISTINCT fingerprint) FROM slow_queries ${searchWhere}`;
  const countResult = db.exec(countSql, searchParams);
  const total = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

  // 聚合查询
  //
  // 刻意不在这里取样例 SQL：query_sql 平均约 7KB，一旦聚合里出现 MIN(query_sql)，
  // 就必须为范围内每一行回表读取大字段，idx_sq_fp_cover 的覆盖效果失效，
  // 实测在 20 万行规模上从 119ms 退化到 1.4 秒。
  // 指纹视图前端展示的是 fingerprint 本身，并不需要样例 SQL。
  const dataSql = `
    SELECT 
      fingerprint,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      ROUND(MAX(query_time), 3) as maxQueryTime,
      ROUND(MIN(query_time), 3) as minQueryTime,
      ROUND(AVG(rows_examined), 0) as avgRowsExamined,
      ROUND(AVG(lock_time), 3) as avgLockTime,
      ROUND(SUM(query_time), 3) as totalQueryTime
    FROM slow_queries ${searchWhere}
    GROUP BY fingerprint
    ORDER BY ${sortField} ${sortOrder}, fingerprint ASC
    LIMIT ? OFFSET ?
  `;

  const dataResult = db.exec(dataSql, [...searchParams, limit, offset]);
  if (dataResult.length === 0) {
    return { data: [], total };
  }

  const columns = dataResult[0].columns;
  const data = dataResult[0].values.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      record[col] = row[i];
    });
    return record as unknown as FingerprintItem;
  });

  return { data, total };
}

/**
 * 获取单个指纹的详细信息
 * @param samplesLimit 每页原始 SQL 数量
 * @param samplesOffset 原始 SQL 偏移量
 * @param trendGranularity 趋势聚合粒度，不传则根据时间跨度自动选择
 * @param tzOffset 客户端时区偏移（分钟），如 UTC+8 为 -480
 */
export function getFingerprintDetail(
  fp: string,
  filter: QueryFilter,
  samplesLimit: number = 10,
  samplesOffset: number = 0,
  trendGranularity?: 'minute' | 'hour' | 'day',
  tzOffset?: number
): FingerprintDetail | null {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 在 WHERE 条件中追加 fingerprint 过滤
  const fpWhere = where ? `${where} AND fingerprint = ?` : 'WHERE fingerprint = ?';
  const fpParams = [...params, fp];

  // 聚合统计
  const statsSql = `
    SELECT 
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      ROUND(MAX(query_time), 3) as maxQueryTime,
      ROUND(MIN(query_time), 3) as minQueryTime,
      ROUND(AVG(rows_examined), 0) as avgRowsExamined,
      ROUND(AVG(lock_time), 3) as avgLockTime,
      ROUND(AVG(rows_sent), 0) as avgRowsSent,
      ROUND(SUM(query_time), 3) as totalQueryTime
    FROM slow_queries ${fpWhere}
  `;
  const statsResult = db.exec(statsSql, fpParams);
  if (statsResult.length === 0 || statsResult[0].values.length === 0) {
    return null;
  }

  const statsRow = statsResult[0].values[0];

  // 原始 SQL（支持分页）
  // 返回 slow_queries 的全部行级字段，前端样例列表与 SQL 详情弹窗据此展示完整信息。
  // fpWhere 已把范围收窄到单个指纹 + 时间区间，且每页只取 10 条，
  // 多带几列的回表成本可忽略（本来 query_sql 就已经要回表）。
  // 内层的 fpWhere/ORDER BY 走 idx_sq_fp_cover，LEFT JOIN 只对本页这几行生效。
  // 列名用显式 AS 固定，下面按 columns 与取值下标对齐拼装对象。
  const samplesSql = `
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
    WHERE s.id IN (
      SELECT id FROM slow_queries ${fpWhere}
      ORDER BY query_time DESC, id ASC
      LIMIT ? OFFSET ?
    )
    ORDER BY s.query_time DESC, s.id ASC
  `;
  const samplesResult = db.exec(samplesSql, [...fpParams, samplesLimit, samplesOffset]);
  const samples: SlowQuerySample[] = samplesResult.length > 0
    ? samplesResult[0].values.map((row) => {
        const record: Record<string, unknown> = {};
        samplesResult[0].columns.forEach((col, i) => {
          record[col] = row[i];
        });
        return record as unknown as SlowQuerySample;
      })
    : [];

  // 时间趋势：支持 minute/hour/day 三种粒度
  // 如果未指定粒度，根据时间跨度自动选择
  const timeRangeSql = `
    SELECT 
      MIN(timestamp) as minTs,
      MAX(timestamp) as maxTs
    FROM slow_queries ${fpWhere}
  `;
  const timeRangeResult = db.exec(timeRangeSql, fpParams);
  let granularity: 'minute' | 'hour' | 'day' = trendGranularity || 'day';
  if (!trendGranularity && timeRangeResult.length > 0 && timeRangeResult[0].values.length > 0) {
    const minTs = timeRangeResult[0].values[0][0] as number;
    const maxTs = timeRangeResult[0].values[0][1] as number;
    if (minTs && maxTs) {
      const diffHours = (maxTs - minTs) / (1000 * 60 * 60);
      if (diffHours <= 1) {
        granularity = 'minute';
      } else if (diffHours <= 24) {
        granularity = 'hour';
      } else {
        granularity = 'day';
      }
    }
  }

  // 使用毫秒时间戳数值分组
  const tzOffsetMs = -(tzOffset || 0) * 60000;
  let intervalMs: number;
  if (granularity === 'minute') {
    intervalMs = 60000;
  } else if (granularity === 'hour') {
    intervalMs = 3600000;
  } else {
    intervalMs = 86400000;
  }

  const timeGroupExpr = `((timestamp + ${tzOffsetMs}) / ${intervalMs})`;

  const trendSql = `
    SELECT 
      ${timeGroupExpr} as timeGroup,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgTime,
      ROUND(MAX(query_time), 3) as maxTime
    FROM slow_queries ${fpWhere}
    GROUP BY timeGroup
    ORDER BY timeGroup ASC
  `;
  const trendResult = db.exec(trendSql, fpParams);
  const timeTrend = trendResult.length > 0
    ? trendResult[0].values.map((row) => ({
        time: (row[0] as number) * intervalMs - tzOffsetMs,
        count: row[1] as number,
        avgTime: row[2] as number,
        maxTime: row[3] as number,
      }))
    : [];

  // 涉及的数据库和实例（去重）
  const dbsSql = `SELECT DISTINCT db_name FROM slow_queries ${fpWhere} AND db_name IS NOT NULL AND db_name != ''`;
  const dbsResult = db.exec(dbsSql, fpParams);
  const databases = dbsResult.length > 0 ? dbsResult[0].values.map((row) => row[0] as string) : [];

  const instSql = `SELECT DISTINCT instance_name FROM slow_queries ${fpWhere} AND instance_name IS NOT NULL AND instance_name != ''`;
  const instResult = db.exec(instSql, fpParams);
  const instances = instResult.length > 0 ? instResult[0].values.map((row) => row[0] as string) : [];

  return {
    fingerprint: fp,
    count: statsRow[0] as number,
    avgQueryTime: statsRow[1] as number,
    maxQueryTime: statsRow[2] as number,
    minQueryTime: statsRow[3] as number,
    avgRowsExamined: statsRow[4] as number,
    avgLockTime: statsRow[5] as number,
    avgRowsSent: statsRow[6] as number | null,
    totalQueryTime: statsRow[7] as number,
    databases,
    instances,
    samplesTotal: statsRow[0] as number,
    samples,
    timeTrend,
    trendGranularity: granularity,
  };
}

/**
 * 分类视图聚合项（包含已归类和未归类）
 */
export interface GroupedFingerprintItem {
  /** 分类 ID，未归类时为 null */
  groupId: number | null;
  /** 分类名称，未归类时为 null */
  groupName: string | null;
  /** 分类包含的指纹数量，未归类时为 1 */
  memberCount: number;
  /** 代表性指纹（未归类时为自身，已归类时为第一个成员） */
  fingerprint: string;
  count: number;
  avgQueryTime: number;
  maxQueryTime: number;
  minQueryTime: number;
  avgRowsExamined: number;
  avgLockTime: number;
  sampleSql: string;
  totalQueryTime: number;
}

/**
 * 按分类视图获取指纹聚合列表
 * - 仅展示已归类的指纹，按 group_id 合并统计
 * @param search 可选的模糊搜索关键词
 */
export function getGroupedFingerprints(
  filter: QueryFilter,
  sortBy: string = 'count',
  order: string = 'desc',
  limit: number = 20,
  offset: number = 0,
  search?: string
): { data: GroupedFingerprintItem[]; total: number } {
  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 搜索条件
  let searchWhere = where;
  const searchParams = [...params];
  if (search && search.trim()) {
    const keyword = `%${search.trim()}%`;
    const searchCondition = '(fingerprint LIKE ? OR query_sql LIKE ?)';
    if (searchWhere) {
      searchWhere += ' AND ' + searchCondition;
    } else {
      searchWhere = 'WHERE ' + searchCondition;
    }
    searchParams.push(keyword, keyword);
  }

  // 获取所有分类及其成员
  const groupsResult = db.exec(
    `SELECT g.id, g.name, m.fingerprint 
     FROM fingerprint_groups g 
     JOIN fingerprint_group_members m ON g.id = m.group_id 
     ORDER BY g.id`
  );

  // 构建分类映射：groupId -> { name, fingerprints[] }
  const groupMap = new Map<number, { name: string; fingerprints: string[] }>();
  const allGroupedFingerprints = new Set<string>();

  if (groupsResult.length > 0) {
    for (const row of groupsResult[0].values) {
      const gId = row[0] as number;
      const gName = row[1] as string;
      const fp = row[2] as string;

      if (!groupMap.has(gId)) {
        groupMap.set(gId, { name: gName, fingerprints: [] });
      }
      groupMap.get(gId)!.fingerprints.push(fp);
      allGroupedFingerprints.add(fp);
    }
  }

  // 排序字段映射
  const sortFieldMap: Record<string, string> = {
    count: 'count',
    avg_time: 'avgQueryTime',
    max_time: 'maxQueryTime',
    min_time: 'minQueryTime',
    avg_rows: 'avgRowsExamined',
    avg_lock: 'avgLockTime',
    total_time: 'totalQueryTime',
  };
  const sortField = sortFieldMap[sortBy] || 'count';
  const sortOrder = order === 'asc' ? 1 : -1;

  const results: GroupedFingerprintItem[] = [];

  // 1. 为每个分类聚合统计
  for (const [groupId, groupInfo] of groupMap) {
    if (groupInfo.fingerprints.length === 0) continue;

    // 构建 IN 子句
    const placeholders = groupInfo.fingerprints.map(() => '?').join(',');
    const fpCondition = `fingerprint IN (${placeholders})`;

    let groupWhere = searchWhere;
    const groupParams = [...searchParams];
    if (groupWhere) {
      groupWhere += ' AND ' + fpCondition;
    } else {
      groupWhere = 'WHERE ' + fpCondition;
    }
    groupParams.push(...groupInfo.fingerprints);

    const sql = `
      SELECT 
        COUNT(*) as count,
        ROUND(AVG(query_time), 3) as avgQueryTime,
        ROUND(MAX(query_time), 3) as maxQueryTime,
        ROUND(MIN(query_time), 3) as minQueryTime,
        ROUND(AVG(rows_examined), 0) as avgRowsExamined,
        ROUND(AVG(lock_time), 3) as avgLockTime,
        MIN(query_sql) as sampleSql,
        ROUND(SUM(query_time), 3) as totalQueryTime
      FROM slow_queries ${groupWhere}
    `;
    const result = db.exec(sql, groupParams);

    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      const count = row[0] as number;
      if (count > 0) {
        results.push({
          groupId,
          groupName: groupInfo.name,
          memberCount: groupInfo.fingerprints.length,
          fingerprint: groupInfo.fingerprints[0],
          count,
          avgQueryTime: row[1] as number,
          maxQueryTime: row[2] as number,
          minQueryTime: row[3] as number,
          avgRowsExamined: row[4] as number,
          avgLockTime: row[5] as number,
          sampleSql: row[6] as string,
          totalQueryTime: row[7] as number,
        });
      }
    }
  }

  // 3. 排序
  results.sort((a, b) => {
    const aVal = (a as unknown as Record<string, number>)[sortField] || 0;
    const bVal = (b as unknown as Record<string, number>)[sortField] || 0;
    return (bVal - aVal) * sortOrder;
  });

  // 4. 分页
  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  return { data: paged, total };
}

/**
 * 分组详情结果：包含汇总统计 + 各成员指纹的独立统计 + 时间趋势
 */
export interface GroupDetailResult {
  /** 汇总统计（所有成员合并） */
  summary: {
    count: number;
    avgQueryTime: number;
    maxQueryTime: number;
    minQueryTime: number;
    avgRowsExamined: number;
    avgLockTime: number;
    totalQueryTime: number;
    databases: string[];
    instances: string[];
  };
  /** 时间趋势 */
  timeTrend: Array<{
    time: number;
    count: number;
    avgTime: number;
    maxTime: number;
  }>;
  trendGranularity: 'minute' | 'hour' | 'day';
  /** 各成员指纹的独立统计 */
  members: Array<{
    fingerprint: string;
    count: number;
    avgQueryTime: number;
    maxQueryTime: number;
    minQueryTime: number;
    avgRowsExamined: number;
    avgLockTime: number;
    totalQueryTime: number;
    sampleSql: string;
  }>;
}

/**
 * 获取分组详情：汇总 + 各成员指纹统计
 * @param fingerprints 该分组包含的所有指纹列表
 * @param filter 时间范围等过滤条件
 */
export function getGroupDetail(
  fingerprints: string[],
  filter: QueryFilter,
  tzOffset?: number,
  trendGranularity?: 'minute' | 'hour' | 'day'
): GroupDetailResult | null {
  if (fingerprints.length === 0) return null;

  const db = getDatabase();
  const { where, params } = buildWhereClause(filter);

  // 构建 IN 条件
  const placeholders = fingerprints.map(() => '?').join(',');
  const fpCondition = `fingerprint IN (${placeholders})`;
  const fpWhere = where ? `${where} AND ${fpCondition}` : `WHERE ${fpCondition}`;
  const fpParams = [...params, ...fingerprints];

  // 汇总统计
  const summarySql = `
    SELECT 
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      ROUND(MAX(query_time), 3) as maxQueryTime,
      ROUND(MIN(query_time), 3) as minQueryTime,
      ROUND(AVG(rows_examined), 0) as avgRowsExamined,
      ROUND(AVG(lock_time), 3) as avgLockTime,
      ROUND(SUM(query_time), 3) as totalQueryTime
    FROM slow_queries ${fpWhere}
  `;
  const summaryResult = db.exec(summarySql, fpParams);
  if (summaryResult.length === 0 || summaryResult[0].values.length === 0) {
    return null;
  }
  const sRow = summaryResult[0].values[0];
  if ((sRow[0] as number) === 0) return null;

  // 涉及的数据库和实例
  const dbsSql = `SELECT DISTINCT db_name FROM slow_queries ${fpWhere} AND db_name IS NOT NULL AND db_name != ''`;
  const dbsResult = db.exec(dbsSql, fpParams);
  const databases = dbsResult.length > 0 ? dbsResult[0].values.map((row) => row[0] as string) : [];

  const instSql = `SELECT DISTINCT instance_name FROM slow_queries ${fpWhere} AND instance_name IS NOT NULL AND instance_name != ''`;
  const instResult = db.exec(instSql, fpParams);
  const instances = instResult.length > 0 ? instResult[0].values.map((row) => row[0] as string) : [];

  // 各成员指纹的独立统计
  const membersSql = `
    SELECT 
      fingerprint,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      ROUND(MAX(query_time), 3) as maxQueryTime,
      ROUND(MIN(query_time), 3) as minQueryTime,
      ROUND(AVG(rows_examined), 0) as avgRowsExamined,
      ROUND(AVG(lock_time), 3) as avgLockTime,
      ROUND(SUM(query_time), 3) as totalQueryTime,
      MIN(query_sql) as sampleSql
    FROM slow_queries ${fpWhere}
    GROUP BY fingerprint
    ORDER BY COUNT(*) DESC
  `;
  const membersResult = db.exec(membersSql, fpParams);
  const members = membersResult.length > 0
    ? membersResult[0].values.map((row) => ({
        fingerprint: row[0] as string,
        count: row[1] as number,
        avgQueryTime: row[2] as number,
        maxQueryTime: row[3] as number,
        minQueryTime: row[4] as number,
        avgRowsExamined: row[5] as number,
        avgLockTime: row[6] as number,
        totalQueryTime: row[7] as number,
        sampleSql: row[8] as string,
      }))
    : [];

  return {
    summary: {
      count: sRow[0] as number,
      avgQueryTime: sRow[1] as number,
      maxQueryTime: sRow[2] as number,
      minQueryTime: sRow[3] as number,
      avgRowsExamined: sRow[4] as number,
      avgLockTime: sRow[5] as number,
      totalQueryTime: sRow[6] as number,
      databases,
      instances,
    },
    ...computeGroupTrend(fpWhere, fpParams, tzOffset, trendGranularity),
    members,
  };
}

/**
 * 计算分组的时间趋势（复用趋势计算逻辑）
 */
function computeGroupTrend(
  fpWhere: string,
  fpParams: unknown[],
  tzOffset?: number,
  specifiedGranularity?: 'minute' | 'hour' | 'day'
): { timeTrend: Array<{ time: number; count: number; avgTime: number; maxTime: number }>; trendGranularity: 'minute' | 'hour' | 'day' } {
  const db = getDatabase();

  // 自动选择粒度（如果未指定）
  let granularity: 'minute' | 'hour' | 'day' = specifiedGranularity || 'day';
  if (!specifiedGranularity) {
    const timeRangeSql = `SELECT MIN(timestamp) as minTs, MAX(timestamp) as maxTs FROM slow_queries ${fpWhere}`;
    const timeRangeResult = db.exec(timeRangeSql, fpParams);
    if (timeRangeResult.length > 0 && timeRangeResult[0].values.length > 0) {
      const minTs = timeRangeResult[0].values[0][0] as number;
      const maxTs = timeRangeResult[0].values[0][1] as number;
      if (minTs && maxTs) {
        const diffHours = (maxTs - minTs) / (1000 * 60 * 60);
        if (diffHours <= 1) granularity = 'minute';
        else if (diffHours <= 24) granularity = 'hour';
        else granularity = 'day';
      }
    }
  }

  const tzOffsetMs = -(tzOffset || 0) * 60000;
  let intervalMs: number;
  if (granularity === 'minute') intervalMs = 60000;
  else if (granularity === 'hour') intervalMs = 3600000;
  else intervalMs = 86400000;

  const timeGroupExpr = `((timestamp + ${tzOffsetMs}) / ${intervalMs})`;

  const trendSql = `
    SELECT 
      ${timeGroupExpr} as timeGroup,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgTime,
      ROUND(MAX(query_time), 3) as maxTime
    FROM slow_queries ${fpWhere}
    GROUP BY timeGroup
    ORDER BY timeGroup ASC
  `;
  const trendResult = db.exec(trendSql, fpParams);
  const timeTrend = trendResult.length > 0
    ? trendResult[0].values.map((row) => ({
        time: (row[0] as number) * intervalMs - tzOffsetMs,
        count: row[1] as number,
        avgTime: row[2] as number,
        maxTime: row[3] as number,
      }))
    : [];

  return { timeTrend, trendGranularity: granularity };
}
