/**
 * ES 文档归一化器
 * 将 ES _source 原始文档按 fieldMapping 转换为 NormalizedSlowQuery
 * 两个 ES 类 Provider 共用此模块
 */

import { EsFieldMapping, NormalizedSlowQuery } from './types';

/**
 * 将单个 ES 原始文档归一化为统一记录
 * - timestamp 兼容 ISO 字符串与数值
 * - 缺失字段给安全默认值
 */
export function normalizeEsDoc(
  raw: Record<string, unknown>,
  fieldMapping: EsFieldMapping
): NormalizedSlowQuery {
  return {
    querySql: getString(raw, fieldMapping.querySql),
    queryTime: getNumber(raw, fieldMapping.queryTime),
    lockTime: getNumber(raw, fieldMapping.lockTime),
    rowsExamined: getNumber(raw, fieldMapping.rowsExamined),
    rowsSent: getNumber(raw, fieldMapping.rowsSent),
    dbName: getString(raw, fieldMapping.dbName),
    instanceName: getString(raw, fieldMapping.instanceName),
    instanceId: getString(raw, fieldMapping.instanceId),
    nodeId: getString(raw, fieldMapping.nodeId),
    userName: getString(raw, fieldMapping.userName),
    userHost: getString(raw, fieldMapping.userHost),
    timestamp: parseTimestamp(raw[fieldMapping.timestamp]),
  };
}

/**
 * 安全取字符串，缺失或非字符串返回空串
 */
function getString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val === 'string') return val;
  if (val == null) return '';
  return String(val);
}

/**
 * 安全取数字，缺失或无法解析返回 0
 */
function getNumber(obj: Record<string, unknown>, key: string): number {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * 解析时间戳，支持毫秒数值、秒数值、ISO 字符串
 * 返回毫秒时间戳，无法解析返回 0
 */
function parseTimestamp(val: unknown): number {
  if (val == null) return 0;

  if (typeof val === 'number') {
    // 如果数值小于 1e12 认为是秒级时间戳
    if (val < 1e12) return val * 1000;
    return val;
  }

  if (typeof val === 'string') {
    const ts = new Date(val).getTime();
    return isNaN(ts) ? 0 : ts;
  }

  return 0;
}
