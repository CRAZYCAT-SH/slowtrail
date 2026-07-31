import { getDatabase, saveDatabase } from '../db/index';
import { QueryFilter } from './statsService';

/**
 * 分类信息
 */
export interface GroupInfo {
  id: number;
  name: string;
  createdAt: number;
  fingerprints: string[];
}

/**
 * 创建分类并关联指纹
 * @param name 分类名称
 * @param fingerprints 要归入该分类的指纹列表
 * @returns 创建的分类信息
 */
export function createGroup(name: string, fingerprints: string[]): GroupInfo {
  const db = getDatabase();
  const now = Date.now();

  db.run('BEGIN TRANSACTION');
  try {
    db.run(
      'INSERT INTO fingerprint_groups (name, created_at) VALUES (?, ?)',
      [name, now]
    );

    // 获取刚插入的 id
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const groupId = idResult[0].values[0][0] as number;

    // 关联指纹
    for (const fp of fingerprints) {
      db.run(
        'INSERT OR IGNORE INTO fingerprint_group_members (group_id, fingerprint) VALUES (?, ?)',
        [groupId, fp]
      );
    }

    db.run('COMMIT');
    saveDatabase();

    return {
      id: groupId,
      name,
      createdAt: now,
      fingerprints,
    };
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 删除分类（同时移除所有关联关系）
 */
export function deleteGroup(groupId: number): void {
  const db = getDatabase();

  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM fingerprint_group_members WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM fingerprint_groups WHERE id = ?', [groupId]);
    db.run('COMMIT');
    saveDatabase();
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 修改分类名称
 */
export function updateGroupName(groupId: number, name: string): void {
  const db = getDatabase();
  db.run('UPDATE fingerprint_groups SET name = ? WHERE id = ?', [name, groupId]);
  saveDatabase();
}

/**
 * 向已有分类添加指纹
 * @param groupId 分类 ID
 * @param fingerprints 要添加的指纹列表
 * @returns 实际成功添加的数量（已属于其他分类的会被忽略）
 */
export function addFingerprintsToGroup(groupId: number, fingerprints: string[]): number {
  const db = getDatabase();
  let addedCount = 0;

  db.run('BEGIN TRANSACTION');
  try {
    for (const fp of fingerprints) {
      // UNIQUE(fingerprint) 约束会阻止重复添加
      try {
        db.run(
          'INSERT INTO fingerprint_group_members (group_id, fingerprint) VALUES (?, ?)',
          [groupId, fp]
        );
        addedCount++;
      } catch {
        // 指纹已属于某个分类，跳过
      }
    }
    db.run('COMMIT');
    saveDatabase();
    return addedCount;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 将指纹从其所属分类中移除
 */
export function removeFingerprintFromGroup(fingerprint: string): void {
  const db = getDatabase();
  db.run('DELETE FROM fingerprint_group_members WHERE fingerprint = ?', [fingerprint]);
  saveDatabase();
}

/**
 * 获取所有分类列表（含成员指纹）
 */
export function getGroups(): GroupInfo[] {
  const db = getDatabase();

  const groupsResult = db.exec('SELECT id, name, created_at FROM fingerprint_groups ORDER BY created_at DESC');
  if (groupsResult.length === 0) return [];

  const groups: GroupInfo[] = groupsResult[0].values.map((row) => ({
    id: row[0] as number,
    name: row[1] as string,
    createdAt: row[2] as number,
    fingerprints: [],
  }));

  // 批量查询所有成员
  const membersResult = db.exec('SELECT group_id, fingerprint FROM fingerprint_group_members ORDER BY id');
  if (membersResult.length > 0) {
    const memberMap = new Map<number, string[]>();
    for (const row of membersResult[0].values) {
      const groupId = row[0] as number;
      const fp = row[1] as string;
      if (!memberMap.has(groupId)) {
        memberMap.set(groupId, []);
      }
      memberMap.get(groupId)!.push(fp);
    }

    for (const group of groups) {
      group.fingerprints = memberMap.get(group.id) || [];
    }
  }

  return groups;
}

/**
 * 获取单个分类详情
 */
export function getGroupById(groupId: number): GroupInfo | null {
  const db = getDatabase();

  const groupResult = db.exec(
    'SELECT id, name, created_at FROM fingerprint_groups WHERE id = ?',
    [groupId]
  );
  if (groupResult.length === 0 || groupResult[0].values.length === 0) return null;

  const row = groupResult[0].values[0];
  const group: GroupInfo = {
    id: row[0] as number,
    name: row[1] as string,
    createdAt: row[2] as number,
    fingerprints: [],
  };

  const membersResult = db.exec(
    'SELECT fingerprint FROM fingerprint_group_members WHERE group_id = ?',
    [groupId]
  );
  if (membersResult.length > 0) {
    group.fingerprints = membersResult[0].values.map((r) => r[0] as string);
  }

  return group;
}

/**
 * 查询某指纹所属的分类
 * @returns 所属分类信息，未归类则返回 null
 */
export function getGroupByFingerprint(fingerprint: string): GroupInfo | null {
  const db = getDatabase();

  const result = db.exec(
    `SELECT g.id, g.name, g.created_at 
     FROM fingerprint_groups g 
     JOIN fingerprint_group_members m ON g.id = m.group_id 
     WHERE m.fingerprint = ?`,
    [fingerprint]
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const groupId = row[0] as number;

  // 获取该分类的所有成员
  const membersResult = db.exec(
    'SELECT fingerprint FROM fingerprint_group_members WHERE group_id = ?',
    [groupId]
  );

  return {
    id: groupId,
    name: row[1] as string,
    createdAt: row[2] as number,
    fingerprints: membersResult.length > 0
      ? membersResult[0].values.map((r) => r[0] as string)
      : [],
  };
}


// ========== 相似指纹推荐 ==========

/**
 * 相似指纹推荐结果项
 */
export interface SimilarFingerprintItem {
  fingerprint: string;
  sampleSql: string;
  count: number;
  avgQueryTime: number;
  similarity: number;
  existingGroupId: number | null;
  existingGroupName: string | null;
}

/**
 * 从 SQL 指纹中提取操作类型
 * 指纹通常以 select/update/insert/delete 开头
 */
function extractOperationType(fingerprint: string): string | null {
  const normalized = fingerprint.trim().toLowerCase();
  const match = normalized.match(/^(select|update|insert|delete|replace|merge)/);
  return match ? match[1] : null;
}

/**
 * 从 SQL 指纹中提取表名列表（含 schema.table 格式）
 * 支持 FROM table、FROM schema.table、JOIN table、UPDATE table、INSERT INTO table 等模式
 * 返回完整的 schema.table 或 table 名称
 */
function extractTableNames(fingerprint: string): string[] {
  const normalized = fingerprint.trim().toLowerCase();
  const tables: Set<string> = new Set();

  // 匹配表名的模式：支持 schema.table 和单独 table（含反引号）
  // 表名模式：(\w+(?:\.\w+)?) 匹配 word 或 word.word
  const tablePattern = '[`"]?(\\w+(?:\\.\\w+)?)[`"]?';

  // FROM table_name / FROM schema.table_name（可能有别名紧跟）
  const fromRegex = new RegExp(`\\bfrom\\s+${tablePattern}`, 'g');
  for (const m of normalized.matchAll(fromRegex)) {
    tables.add(m[1]);
  }

  // JOIN table_name / JOIN schema.table_name
  const joinRegex = new RegExp(`\\bjoin\\s+${tablePattern}`, 'g');
  for (const m of normalized.matchAll(joinRegex)) {
    tables.add(m[1]);
  }

  // UPDATE table_name / UPDATE schema.table_name
  const updateRegex = new RegExp(`\\bupdate\\s+${tablePattern}`, 'g');
  for (const m of normalized.matchAll(updateRegex)) {
    tables.add(m[1]);
  }

  // INSERT INTO table_name / INSERT INTO schema.table_name
  const insertRegex = new RegExp(`\\binsert\\s+(?:into\\s+)?${tablePattern}`, 'g');
  for (const m of normalized.matchAll(insertRegex)) {
    tables.add(m[1]);
  }

  // DELETE FROM table_name / DELETE FROM schema.table_name
  const deleteRegex = new RegExp(`\\bdelete\\s+from\\s+${tablePattern}`, 'g');
  for (const m of normalized.matchAll(deleteRegex)) {
    tables.add(m[1]);
  }

  return Array.from(tables);
}

/**
 * 计算 Levenshtein 编辑距离（矩阵法）
 * 为了性能，对超长字符串截断处理
 */
function levenshteinDistance(a: string, b: string): number {
  // 截断超长指纹，避免内存爆炸
  const maxLen = 800;
  const s1 = a.length > maxLen ? a.substring(0, maxLen) : a;
  const s2 = b.length > maxLen ? b.substring(0, maxLen) : b;

  const m = s1.length;
  const n = s2.length;

  // 长度差异过大直接返回最大值
  if (Math.abs(m - n) > Math.max(m, n) * 0.5) {
    return Math.max(m, n);
  }

  // 使用两行滚动数组优化空间
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * 对指纹进行归一化预处理，去除噪声提高相似度计算准确性
 * - 去除多余空格
 * - 去除参数占位符 ? 及其周围的逗号/空格
 * - 去除数字字面量
 * - 统一为小写
 */
function normalizeFingerprint(fp: string): string {
  return fp
    .toLowerCase()
    .trim()
    // 去除 IN 子句中的多个占位符 (?, ?, ?) -> (?)
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)')
    // 去除独立的 ? 参数
    .replace(/\s*\?\s*/g, ' ? ')
    // 压缩多余空格
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 计算表名集合的 Jaccard 相似度
 */
function tableJaccardSimilarity(tablesA: string[], tablesB: string[]): number {
  if (tablesA.length === 0 && tablesB.length === 0) return 0;
  if (tablesA.length === 0 || tablesB.length === 0) return 0;

  const setA = new Set(tablesA);
  const setB = new Set(tablesB);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * 计算综合相似度分数
 * 综合考虑：归一化指纹编辑距离(权重50%) + 表名重合度(权重30%) + 结构相似度(权重10%) + 操作类型(权重10%)
 */
function computeSimilarity(
  targetFp: string,
  targetOp: string | null,
  targetTables: string[],
  candidateFp: string,
  candidateOp: string | null,
  candidateTables: string[]
): number {
  // 1. 归一化指纹的编辑距离相似度 (权重 50%)
  const normTarget = normalizeFingerprint(targetFp);
  const normCandidate = normalizeFingerprint(candidateFp);
  const distance = levenshteinDistance(normTarget, normCandidate);
  const maxLen = Math.max(normTarget.length, normCandidate.length);
  const editSim = maxLen > 0 ? 1 - distance / maxLen : 1;

  // 2. 表名 Jaccard 相似度 (权重 30%)
  const tableSim = tableJaccardSimilarity(targetTables, candidateTables);

  // 3. 结构相似度：长度比例 (权重 10%)
  // 如果两条 SQL 长度差距很大，说明复杂度差异大
  const lenRatio = Math.min(normTarget.length, normCandidate.length) / Math.max(normTarget.length, normCandidate.length);
  const structSim = lenRatio;

  // 4. 操作类型匹配 (权重 10%)
  const opSim = (targetOp && candidateOp && targetOp === candidateOp) ? 1 : 0;

  // 加权综合
  const totalSim = editSim * 0.5 + tableSim * 0.3 + structSim * 0.1 + opSim * 0.1;

  return totalSim;
}

/**
 * 获取相似指纹推荐列表
 * 策略：先按表名+操作类型粗筛，再用编辑距离精排
 * @param fingerprint 目标指纹
 * @param filter 时间范围等过滤条件（用于限定候选集来源）
 * @param limit 返回数量上限
 * @returns 按相似度降序排列的推荐列表
 */
export function getSimilarFingerprints(
  fingerprint: string,
  filter: QueryFilter,
  limit: number = 20
): SimilarFingerprintItem[] {
  const db = getDatabase();

  // 提取目标指纹的特征
  const targetOp = extractOperationType(fingerprint);
  const targetTables = extractTableNames(fingerprint);

  // 构建 WHERE 条件（时间范围）
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

  // 查询时间范围内所有不同指纹的统计信息
  const sql = `
    SELECT 
      fingerprint,
      COUNT(*) as count,
      ROUND(AVG(query_time), 3) as avgQueryTime,
      MIN(query_sql) as sampleSql
    FROM slow_queries ${where}
    GROUP BY fingerprint
  `;
  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  // 获取所有已归类的指纹映射
  const memberResult = db.exec(
    `SELECT m.fingerprint, g.id, g.name 
     FROM fingerprint_group_members m 
     JOIN fingerprint_groups g ON m.group_id = g.id`
  );
  const groupMap = new Map<string, { groupId: number; groupName: string }>();
  if (memberResult.length > 0) {
    for (const row of memberResult[0].values) {
      groupMap.set(row[0] as string, {
        groupId: row[1] as number,
        groupName: row[2] as string,
      });
    }
  }

  // 粗筛 + 精排
  const candidates: SimilarFingerprintItem[] = [];

  for (const row of result[0].values) {
    const fp = row[0] as string;
    if (fp === fingerprint) continue; // 排除自身

    const fpOp = extractOperationType(fp);
    const fpTables = extractTableNames(fp);

    // 粗筛：操作类型必须相同 且 至少有一个共同表名
    const opMatch = targetOp === fpOp;
    const tableOverlap = targetTables.some((t) => fpTables.includes(t));

    // 操作类型不同直接跳过
    if (!opMatch) continue;
    // 无共同表名也跳过
    if (targetTables.length > 0 && fpTables.length > 0 && !tableOverlap) continue;

    // 计算综合相似度
    const similarity = computeSimilarity(
      fingerprint, targetOp, targetTables,
      fp, fpOp, fpTables
    );

    // 相似度阈值 0.65（综合分数，要求较高结构相似性）
    if (similarity < 0.65) continue;

    const groupInfo = groupMap.get(fp);

    candidates.push({
      fingerprint: fp,
      sampleSql: row[3] as string,
      count: row[1] as number,
      avgQueryTime: row[2] as number,
      similarity: Math.round(similarity * 100) / 100,
      existingGroupId: groupInfo?.groupId ?? null,
      existingGroupName: groupInfo?.groupName ?? null,
    });
  }

  // 按相似度降序排序
  candidates.sort((a, b) => b.similarity - a.similarity);

  return candidates.slice(0, limit);
}
