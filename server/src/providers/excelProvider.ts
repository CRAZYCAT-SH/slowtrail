/**
 * Excel 数据源 Provider
 * 从上传的 Excel/CSV 文件中读取慢查询数据，归一化后交给 syncService 入库
 */

import * as XLSX from 'xlsx';
import fs from 'fs';
import {
  DataSourceProvider,
  ProviderCapabilities,
  Settings,
  FetchQuery,
  FetchBatch,
  NormalizedSlowQuery,
} from './types';
import { readWorkbookWithEncoding } from '../utils/encoding';

// ========== Excel Settings 类型 ==========

export interface ExcelColumnMapping {
  /** SQL 语句列名（必填） */
  querySql: string;
  /** 查询耗时列名（必填，单位秒） */
  queryTime: string;
  /** 时间戳列名（可选，支持毫秒时间戳或日期字符串） */
  timestamp?: string;
  /** 数据库名列名 */
  dbName?: string;
  /** 实例名列名 */
  instanceName?: string;
  /** 锁等待时间列名 */
  lockTime?: string;
  /** 扫描行数列名 */
  rowsExamined?: string;
  /** 返回行数列名 */
  rowsSent?: string;
  /** 用户名列名 */
  userName?: string;
  /** 用户主机列名 */
  userHost?: string;
}

export interface ExcelSettings {
  /** 后端存储的文件路径 */
  filePath: string;
  /** 原始文件名（前端展示用） */
  originalFileName: string;
  /** 工作表名，为空则使用第一个 */
  sheetName?: string;
  /** 文件编码（仅 CSV 有效），'auto' 或具体编码名如 'GBK'、'UTF-8' */
  encoding?: string;
  /** 列映射配置 */
  columnMapping: ExcelColumnMapping;
}

// ========== 常量 ==========

/** 每批产出的记录数 */
const BATCH_SIZE = 500;

// ========== Provider 实现 ==========

export const excelProvider: DataSourceProvider = {
  type: 'excel',
  label: 'Excel / CSV 导入',

  capabilities(): ProviderCapabilities {
    return {
      instanceEnumeration: false,
      configPreview: false,
    };
  },

  defaultSettings(): Settings {
    return {
      filePath: '',
      originalFileName: '',
      sheetName: '',
      encoding: 'auto',
      columnMapping: {
        querySql: '',
        queryTime: '',
        timestamp: '',
        dbName: '',
        instanceName: '',
        lockTime: '',
        rowsExamined: '',
        rowsSent: '',
        userName: '',
        userHost: '',
      },
    } as unknown as Settings;
  },

  secretKeys(): string[] {
    // Excel 数据源没有需要脱敏的字段
    return [];
  },

  validate(settings: Settings): string[] {
    const errors: string[] = [];
    const s = settings as unknown as ExcelSettings;

    if (!s.filePath) {
      errors.push('未上传文件');
    }
    if (!s.columnMapping) {
      errors.push('缺少列映射配置');
    } else {
      if (!s.columnMapping.querySql) {
        errors.push('必须指定 SQL 语句对应的列');
      }
      if (!s.columnMapping.queryTime) {
        errors.push('必须指定查询耗时对应的列');
      }
    }

    return errors;
  },

  describe(settings: Settings): string {
    const s = settings as unknown as ExcelSettings;
    const fileName = s.originalFileName || '未上传';
    const sheet = s.sheetName ? ` · Sheet: ${s.sheetName}` : '';
    return `${fileName}${sheet}`;
  },

  async testConnection(settings: Settings): Promise<{ connected: boolean; info?: string; error?: string }> {
    const s = settings as unknown as ExcelSettings;

    // 检查文件是否存在
    if (!s.filePath) {
      return { connected: false, error: '未配置文件路径' };
    }

    if (!fs.existsSync(s.filePath)) {
      return { connected: false, error: `文件不存在: ${s.originalFileName || s.filePath}` };
    }

    try {
      // 尝试读取文件并验证表头（使用编码感知方式）
      const { workbook } = readWorkbookWithEncoding(s.filePath, s.encoding || 'auto');
      const sheetName = s.sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      if (!sheet) {
        return { connected: false, error: `工作表 "${sheetName}" 不存在` };
      }

      const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      if (jsonData.length === 0) {
        return { connected: false, error: '文件为空' };
      }

      // 获取表头
      const headers = jsonData[0].map((h) => String(h ?? ''));
      const totalRows = jsonData.length - 1;

      // 验证列映射的列是否存在于表头中
      const mapping = s.columnMapping;
      const missingCols: string[] = [];

      if (mapping.querySql && !headers.includes(mapping.querySql)) {
        missingCols.push(`SQL语句列 "${mapping.querySql}"`);
      }
      if (mapping.queryTime && !headers.includes(mapping.queryTime)) {
        missingCols.push(`查询耗时列 "${mapping.queryTime}"`);
      }

      if (missingCols.length > 0) {
        return {
          connected: false,
          error: `以下列在文件中不存在: ${missingCols.join(', ')}`,
        };
      }

      return {
        connected: true,
        info: `文件有效 · ${totalRows} 行数据 · 工作表: ${sheetName}`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return { connected: false, error: `文件读取失败: ${err.message}` };
    }
  },

  async *fetchRecords(settings: Settings, query: FetchQuery): AsyncIterable<FetchBatch> {
    const s = settings as unknown as ExcelSettings;

    if (!fs.existsSync(s.filePath)) {
      throw new Error(`文件不存在: ${s.originalFileName || s.filePath}`);
    }

    const { workbook } = readWorkbookWithEncoding(s.filePath, s.encoding || 'auto');
    const sheetName = s.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(`工作表 "${sheetName}" 不存在`);
    }

    // 使用 header 模式读取，获取列名作为 key
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    const mapping = s.columnMapping;

    let batch: NormalizedSlowQuery[] = [];

    for (const row of rows) {
      const record = normalizeRow(row, mapping, query);
      if (!record) continue;

      // 时间范围过滤
      if (record.timestamp < query.startTime || record.timestamp >= query.endTime) {
        continue;
      }

      // 实例名过滤（如果 query 指定了实例名）
      if (query.instanceName && record.instanceName !== query.instanceName) {
        continue;
      }

      batch.push(record);

      if (batch.length >= BATCH_SIZE) {
        yield { records: batch, sourceRef: s.originalFileName || s.filePath };
        batch = [];
      }
    }

    // 剩余记录
    if (batch.length > 0) {
      yield { records: batch, sourceRef: s.originalFileName || s.filePath };
    }
  },
};

// ========== 辅助函数 ==========

/**
 * 将一行 Excel 数据归一化为 NormalizedSlowQuery
 * 返回 null 表示该行无效（缺少必要字段）
 */
function normalizeRow(
  row: Record<string, unknown>,
  mapping: ExcelColumnMapping,
  query: FetchQuery
): NormalizedSlowQuery | null {
  // 必填字段
  const querySql = getStringValue(row, mapping.querySql);
  if (!querySql) return null;

  const queryTime = getNumberValue(row, mapping.queryTime);
  if (queryTime === null || queryTime < 0) return null;

  // 时间戳：优先使用映射列，否则使用查询起始时间
  let timestamp: number;
  if (mapping.timestamp) {
    const ts = parseTimestamp(row[mapping.timestamp]);
    timestamp = ts ?? query.startTime;
  } else {
    timestamp = query.startTime;
  }

  // 实例名：优先使用映射列，否则使用 query 中传入的
  const instanceName = mapping.instanceName
    ? getStringValue(row, mapping.instanceName) || query.instanceName || ''
    : query.instanceName || '';

  return {
    querySql,
    queryTime,
    lockTime: mapping.lockTime ? (getNumberValue(row, mapping.lockTime) ?? 0) : 0,
    rowsExamined: mapping.rowsExamined ? (getNumberValue(row, mapping.rowsExamined) ?? 0) : 0,
    rowsSent: mapping.rowsSent ? (getNumberValue(row, mapping.rowsSent) ?? 0) : 0,
    dbName: mapping.dbName ? (getStringValue(row, mapping.dbName) || '') : '',
    instanceName,
    instanceId: '',
    nodeId: '',
    userName: mapping.userName ? (getStringValue(row, mapping.userName) || '') : '',
    userHost: mapping.userHost ? (getStringValue(row, mapping.userHost) || '') : '',
    timestamp,
  };
}

/** 从 row 中获取字符串值 */
function getStringValue(row: Record<string, unknown>, key: string): string {
  if (!key) return '';
  const val = row[key];
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

/** 从 row 中获取数值 */
function getNumberValue(row: Record<string, unknown>, key: string): number | null {
  if (!key) return null;
  const val = row[key];
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

/**
 * 解析时间戳字段
 * 支持：毫秒时间戳数字、秒时间戳数字、日期字符串
 */
function parseTimestamp(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;

  // 数字类型
  if (typeof val === 'number') {
    // 小于 1e12 认为是秒级时间戳，转为毫秒
    if (val < 1e12) return val * 1000;
    return val;
  }

  // 字符串类型
  if (typeof val === 'string') {
    // 尝试作为数字
    const num = Number(val);
    if (!isNaN(num)) {
      if (num < 1e12) return num * 1000;
      return num;
    }

    // 尝试 Date.parse
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }

  // Date 对象（xlsx 解析出的日期）
  if (val instanceof Date) {
    return val.getTime();
  }

  return null;
}
