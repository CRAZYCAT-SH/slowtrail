/**
 * 数据源 CRUD 服务
 * 负责数据源配置的增删改查、密码脱敏、环境变量导入、级联删除
 */

import { getDatabase, saveDatabase } from '../db/index';
import { getProvider, listProviders } from '../providers/index';
import {
  Settings,
  DataSourceProvider,
  InstanceEnumerable,
  ConfigPreviewable,
  FieldDiscoverable,
  IndexFieldInfo,
  PreviewResult,
} from '../providers/types';

// ========== 类型定义 ==========

export interface DataSourceRecord {
  id: number;
  name: string;
  type: string;
  settings: Settings;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 列表项附加 provider 信息 */
export interface DataSourceListItem extends DataSourceRecord {
  summary: string;
  capabilities: { instanceEnumeration: boolean; configPreview: boolean };
}

/** 创建/更新输入 */
export interface DataSourceInput {
  name: string;
  type: string;
  settings: Settings;
  enabled?: boolean;
}

/** provider 类型信息（供前端类型下拉） */
export interface ProviderTypeInfo {
  type: string;
  label: string;
  capabilities: { instanceEnumeration: boolean; configPreview: boolean };
  defaultSettings: Settings;
}

// ========== 内部工具 ==========

const PASSWORD_MASK = '******';

/**
 * 将数据库行转为 DataSourceRecord
 */
function rowToRecord(row: unknown[]): DataSourceRecord {
  return {
    id: row[0] as number,
    name: row[1] as string,
    type: row[2] as string,
    settings: JSON.parse(row[3] as string),
    enabled: (row[4] as number) === 1,
    isDefault: (row[5] as number) === 1,
    createdAt: row[6] as number,
    updatedAt: row[7] as number,
  };
}

/**
 * 对 settings 中的密钥字段脱敏
 */
function maskSecrets(record: DataSourceRecord): DataSourceRecord {
  try {
    const provider = getProvider(record.type);
    const secretKeys = provider.secretKeys();
    const maskedSettings = { ...record.settings };
    for (const key of secretKeys) {
      if (maskedSettings[key] && typeof maskedSettings[key] === 'string' && (maskedSettings[key] as string).length > 0) {
        maskedSettings[key] = PASSWORD_MASK;
      }
    }
    return { ...record, settings: maskedSettings };
  } catch {
    // provider 不存在时不脱敏
    return record;
  }
}

/**
 * 合并 settings 更新：如果密钥字段值为 PASSWORD_MASK 或 undefined，保留原值
 */
function mergeSettingsSecrets(newSettings: Settings, oldSettings: Settings, provider: DataSourceProvider): Settings {
  const merged = { ...newSettings };
  const secretKeys = provider.secretKeys();
  for (const key of secretKeys) {
    if (merged[key] === PASSWORD_MASK || merged[key] === undefined || merged[key] === '') {
      merged[key] = oldSettings[key];
    }
  }
  return merged;
}

// ========== 服务方法 ==========

/**
 * 获取所有已注册 provider 的类型信息
 */
export function getProviderTypes(): ProviderTypeInfo[] {
  return listProviders().map((p) => ({
    type: p.type,
    label: p.label,
    capabilities: p.capabilities(),
    defaultSettings: p.defaultSettings(),
  }));
}

/**
 * 获取数据源列表（settings 脱敏）
 */
export function listDataSources(): DataSourceListItem[] {
  const db = getDatabase();
  const result = db.exec(
    'SELECT id, name, type, settings, enabled, is_default, created_at, updated_at FROM data_sources ORDER BY is_default DESC, created_at ASC'
  );
  if (result.length === 0) return [];

  return result[0].values.map((row) => {
    const record = maskSecrets(rowToRecord(row));
    let summary = '';
    let capabilities = { instanceEnumeration: false, configPreview: false };
    try {
      const provider = getProvider(record.type);
      const original = rowToRecord(row);
      summary = provider.describe(original.settings);
      capabilities = provider.capabilities();
    } catch {
      summary = record.type;
    }
    return { ...record, summary, capabilities };
  });
}

/**
 * 获取单个数据源（未脱敏，内部使用）
 */
export function getDataSourceRaw(id: number): DataSourceRecord | null {
  const db = getDatabase();
  const result = db.exec(
    'SELECT id, name, type, settings, enabled, is_default, created_at, updated_at FROM data_sources WHERE id = ?',
    [id]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToRecord(result[0].values[0]);
}

/**
 * 获取单个数据源（脱敏，对外使用）
 */
export function getDataSource(id: number): DataSourceListItem | null {
  const raw = getDataSourceRaw(id);
  if (!raw) return null;
  const masked = maskSecrets(raw);
  let summary = '';
  let capabilities = { instanceEnumeration: false, configPreview: false };
  try {
    const provider = getProvider(raw.type);
    summary = provider.describe(raw.settings);
    capabilities = provider.capabilities();
  } catch {
    summary = raw.type;
  }
  return { ...masked, summary, capabilities };
}

/**
 * 获取默认数据源（未脱敏）
 */
export function getDefaultDataSource(): DataSourceRecord | null {
  const db = getDatabase();
  const result = db.exec(
    'SELECT id, name, type, settings, enabled, is_default, created_at, updated_at FROM data_sources WHERE is_default = 1 LIMIT 1'
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToRecord(result[0].values[0]);
}

/**
 * 创建数据源
 */
export function createDataSource(input: DataSourceInput): DataSourceListItem {
  const provider = getProvider(input.type);

  // 校验
  const errors = provider.validate(input.settings);
  if (errors.length > 0) {
    throw new Error(`配置校验失败: ${errors.join('; ')}`);
  }

  const db = getDatabase();
  const now = Date.now();
  const settingsJson = JSON.stringify(input.settings);

  db.run(
    `INSERT INTO data_sources (name, type, settings, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [input.name, input.type, settingsJson, input.enabled !== false ? 1 : 0, now, now]
  );

  const idResult = db.exec('SELECT last_insert_rowid()');
  const id = idResult[0].values[0][0] as number;

  saveDatabase();

  const record = getDataSourceRaw(id)!;
  const summary = provider.describe(record.settings);
  const capabilities = provider.capabilities();
  return { ...record, summary, capabilities };
}

/**
 * 更新数据源
 */
export function updateDataSource(id: number, input: Partial<DataSourceInput>): DataSourceListItem {
  const existing = getDataSourceRaw(id);
  if (!existing) {
    throw new Error(`数据源 ${id} 不存在`);
  }

  const type = input.type || existing.type;
  const provider = getProvider(type);

  // 合并 settings：保留密钥字段原值
  let newSettings = existing.settings;
  if (input.settings) {
    newSettings = mergeSettingsSecrets(input.settings, existing.settings, provider);
  }

  // 校验
  const errors = provider.validate(newSettings);
  if (errors.length > 0) {
    throw new Error(`配置校验失败: ${errors.join('; ')}`);
  }

  const db = getDatabase();
  const now = Date.now();
  const name = input.name ?? existing.name;
  const enabled = input.enabled != null ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);

  db.run(
    `UPDATE data_sources SET name = ?, type = ?, settings = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    [name, type, JSON.stringify(newSettings), enabled, now, id]
  );

  saveDatabase();

  // 使用 getDataSource 统一返回含 schedule 的完整数据
  return getDataSource(id)!;
}

/**
 * 删除数据源
 * @param deleteData 是否同时删除该数据源已拉取的本地数据
 */
export function deleteDataSource(id: number, deleteData: boolean = false): void {
  const existing = getDataSourceRaw(id);
  if (!existing) {
    throw new Error(`数据源 ${id} 不存在`);
  }
  if (existing.isDefault) {
    throw new Error('默认数据源（来自环境变量）不可删除');
  }

  const db = getDatabase();
  db.run('BEGIN TRANSACTION');

  try {
    if (deleteData) {
      db.run('DELETE FROM slow_queries WHERE data_source_id = ?', [id]);
      db.run('DELETE FROM sync_history WHERE data_source_id = ?', [id]);
    }
    db.run('DELETE FROM data_sources WHERE id = ?', [id]);
    db.run('COMMIT');
    saveDatabase();
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 测试数据源连接
 */
export async function testDataSourceConnection(id: number): Promise<{ connected: boolean; info?: string; error?: string }> {
  const raw = getDataSourceRaw(id);
  if (!raw) {
    return { connected: false, error: `数据源 ${id} 不存在` };
  }
  const provider = getProvider(raw.type);
  return provider.testConnection(raw.settings);
}

/**
 * 获取数据源的实例列表
 */
export async function getDataSourceInstanceNames(id: number): Promise<string[]> {
  const raw = getDataSourceRaw(id);
  if (!raw) {
    throw new Error(`数据源 ${id} 不存在`);
  }
  const provider = getProvider(raw.type);
  if (!provider.capabilities().instanceEnumeration) {
    throw new Error(`数据源类型 ${raw.type} 不支持枚举实例列表`);
  }
  return (provider as unknown as InstanceEnumerable).getInstanceNames(raw.settings);
}

/**
 * 预览索引配置（支持未落库的配置）
 */
export async function previewDataSource(
  type: string,
  settings: Settings,
  startDate: string,
  endDate: string
): Promise<PreviewResult> {
  const provider = getProvider(type);
  if (!provider.capabilities().configPreview) {
    throw new Error(`数据源类型 ${type} 不支持配置预览`);
  }
  return (provider as unknown as ConfigPreviewable).preview(settings, startDate, endDate);
}

/**
 * 测试未落库的数据源连接（创建前测试）
 */
export async function testUnsavedConnection(
  type: string,
  settings: Settings
): Promise<{ connected: boolean; info?: string; error?: string }> {
  const provider = getProvider(type);
  return provider.testConnection(settings);
}

/**
 * 获取索引字段列表（用于字段映射下拉选择）
 * 支持两种模式：
 * 1. 传 dataSourceId —— 使用已保存数据源的配置（含真实密码）
 * 2. 传 type + settings —— 使用未落库的配置（创建时预览字段）
 */
export async function getIndexFields(
  type: string,
  settings: Settings,
  dataSourceId?: number
): Promise<IndexFieldInfo[]> {
  let actualType = type;
  let actualSettings = settings;

  // 如果指定了 dataSourceId，使用数据库中的真实配置
  if (dataSourceId) {
    const raw = getDataSourceRaw(dataSourceId);
    if (!raw) {
      throw new Error(`数据源 ${dataSourceId} 不存在`);
    }
    actualType = raw.type;
    // 合并：以传入的 settings 为准，但密码为脱敏值时回退到数据库原始值
    const dbSettings = raw.settings as Record<string, unknown>;
    const merged = { ...dbSettings, ...settings };
    // 恢复被脱敏的密码字段
    const provider = getProvider(actualType);
    for (const key of provider.secretKeys()) {
      if (merged[key] === '******') {
        merged[key] = dbSettings[key];
      }
    }
    actualSettings = merged;
  }

  const provider = getProvider(actualType);
  if (!(provider as unknown as FieldDiscoverable).getIndexFields) {
    throw new Error(`数据源类型 ${actualType} 不支持字段发现`);
  }
  return (provider as unknown as FieldDiscoverable).getIndexFields(actualSettings);
}

/**
 * 启动时初始化：从环境变量导入默认数据源
 * - 如果 data_sources 表中没有 is_default=1 的记录，则从环境变量创建一条
 * - 创建后把 slow_queries / sync_history 中 data_source_id IS NULL 的历史数据回填为该 ID
 */
export function initDefaultDataSource(): void {
  const existing = getDefaultDataSource();
  if (existing) {
    console.log(`[DataSource] 默认数据源已存在: id=${existing.id}, name=${existing.name}`);
    return;
  }

  // 从环境变量确定类型，获取该类型的 provider 默认配置
  const dsType = process.env.ES_TYPE || 'kibana_proxy';
  const provider = getProvider(dsType);
  const defaults = provider.defaultSettings();

  // 用环境变量覆盖默认值（仅覆盖已设置的变量）
  const settings: Settings = { ...defaults };
  if (process.env.ES_HOST) settings.host = process.env.ES_HOST;
  if (process.env.ES_PROXY_PATH) settings.proxyPath = process.env.ES_PROXY_PATH;
  if (process.env.ES_USERNAME) settings.username = process.env.ES_USERNAME;
  if (process.env.ES_PASSWORD) settings.password = process.env.ES_PASSWORD;
  if (process.env.ES_INDEX_PATTERN) settings.indexPattern = process.env.ES_INDEX_PATTERN;

  const db = getDatabase();
  const now = Date.now();

  db.run(
    `INSERT INTO data_sources (name, type, settings, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, 1, 1, ?, ?)`,
    ['默认数据源', dsType, JSON.stringify(settings), now, now]
  );

  const idResult = db.exec('SELECT last_insert_rowid()');
  const defaultId = idResult[0].values[0][0] as number;

  console.log(`[DataSource] 从环境变量创建默认数据源: id=${defaultId}`);

  // 回填历史数据的 data_source_id
  const updateResult1 = db.exec('SELECT COUNT(*) FROM slow_queries WHERE data_source_id IS NULL');
  const nullCount1 = updateResult1.length > 0 ? (updateResult1[0].values[0][0] as number) : 0;

  if (nullCount1 > 0) {
    db.run('UPDATE slow_queries SET data_source_id = ? WHERE data_source_id IS NULL', [defaultId]);
    console.log(`[DataSource] 回填 slow_queries.data_source_id: ${nullCount1} 条`);
  }

  const updateResult2 = db.exec('SELECT COUNT(*) FROM sync_history WHERE data_source_id IS NULL');
  const nullCount2 = updateResult2.length > 0 ? (updateResult2[0].values[0][0] as number) : 0;

  if (nullCount2 > 0) {
    db.run('UPDATE sync_history SET data_source_id = ? WHERE data_source_id IS NULL', [defaultId]);
    console.log(`[DataSource] 回填 sync_history.data_source_id: ${nullCount2} 条`);
  }

  saveDatabase();
}
