/**
 * 索引模板解析器
 * 负责从模板占位符推断切分周期、渲染索引名、解析时间区间对应的索引目标
 *
 * 占位符支持：{YYYY} {YY} {MM} {M} {DD} {D}
 * 其余字符（含 * _ . -）原样保留，可与占位符混用
 */

import { IndexRollover } from './types';

/** 合法占位符集合 */
const VALID_PLACEHOLDERS = new Set(['YYYY', 'YY', 'MM', 'M', 'DD', 'D']);

/**
 * 校验索引模板中的占位符是否合法
 * @returns 非法占位符列表，空数组表示通过
 */
export function validatePattern(pattern: string): string[] {
  const errors: string[] = [];
  const matches = pattern.matchAll(/\{(\w+)\}/g);
  for (const m of matches) {
    if (!VALID_PLACEHOLDERS.has(m[1])) {
      errors.push(`未知占位符: {${m[1]}}`);
    }
  }
  return errors;
}

/**
 * 从模板占位符推断切分周期
 * - 含 {DD} 或 {D} → daily
 * - 含 {MM} 或 {M}（无日占位符）→ monthly
 * - 仅含 {YYYY} 或 {YY} → yearly
 * - 无占位符 → none（静态目标，可能含 *）
 */
export function inferRollover(pattern: string): IndexRollover {
  const hasDay = /\{DD?\}/.test(pattern);
  const hasMonth = /\{MM?\}/.test(pattern);
  const hasYear = /\{YYYY?\}/.test(pattern);

  if (hasDay) return 'daily';
  if (hasMonth) return 'monthly';
  if (hasYear) return 'yearly';
  return 'none';
}

/**
 * 渲染单个时点的索引名：替换占位符，其余字符原样保留
 */
export function renderIndex(pattern: string, date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  return pattern
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2))
    .replace(/\{MM\}/g, String(m).padStart(2, '0'))
    .replace(/\{M\}/g, String(m))
    .replace(/\{DD\}/g, String(d).padStart(2, '0'))
    .replace(/\{D\}/g, String(d));
}

/**
 * 解析时间区间对应的索引目标（逗号分隔，可直接用于 ES 多索引搜索）
 *
 * - rollover 为 none：直接返回模板本身（静态名或通配）
 * - 否则：按周期枚举覆盖区间的索引名，并向前后各扩一个周期
 *   （索引日期后缀通常按 UTC 生成，与本地时区日界线错位，多搜不会错、漏搜会丢数据）
 * - 去重后 join(',')
 */
export function resolveIndices(pattern: string, startTime: number, endTime: number): string {
  const rollover = inferRollover(pattern);

  // 无占位符 → 静态目标（可能含 *）
  if (rollover === 'none') {
    return pattern;
  }

  const indices = new Set<string>();
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (rollover === 'daily') {
    // 向前扩一天
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 1);
    // 向后扩一天
    const limit = new Date(end);
    limit.setDate(limit.getDate() + 1);

    while (cursor <= limit) {
      indices.add(renderIndex(pattern, cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (rollover === 'monthly') {
    // 向前扩一月
    const cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    // 向后扩一月
    const limit = new Date(end.getFullYear(), end.getMonth() + 1, 1);

    while (cursor <= limit) {
      indices.add(renderIndex(pattern, cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (rollover === 'yearly') {
    // 向前扩一年
    const startYear = start.getFullYear() - 1;
    const endYear = end.getFullYear() + 1;

    for (let y = startYear; y <= endYear; y++) {
      indices.add(renderIndex(pattern, new Date(y, 0, 1)));
    }
  }

  return Array.from(indices).join(',');
}

/**
 * 通配目标，用于 getInstanceNames：把所有占位符替换为 '*' 并折叠连续 '*'
 */
export function resolveWildcard(pattern: string): string {
  return pattern
    .replace(/\{(?:YYYY|YY|MM|M|DD|D)\}/g, '*')
    .replace(/\*{2,}/g, '*');
}

/**
 * 渲染若干示例索引名（用于预览展示）
 * 以 startDate 为起点按切分周期生成几个样本
 */
export function renderSamples(pattern: string, startDate: string, count: number = 3): string[] {
  const rollover = inferRollover(pattern);
  if (rollover === 'none') return [pattern];

  const samples: string[] = [];
  const cursor = new Date(startDate + 'T00:00:00');

  for (let i = 0; i < count; i++) {
    samples.push(renderIndex(pattern, cursor));
    if (rollover === 'daily') {
      cursor.setDate(cursor.getDate() + 1);
    } else if (rollover === 'monthly') {
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (rollover === 'yearly') {
      cursor.setFullYear(cursor.getFullYear() + 1);
    }
  }

  return samples;
}
