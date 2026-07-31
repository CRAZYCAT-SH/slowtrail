/**
 * 数据源 Provider 契约与共享类型定义
 */

// ========== 基础类型 ==========

/** 数据源类型标识（开放字符串，新类型无需改类型定义） */
export type DataSourceType = string;

/** 类型专属配置，由对应 provider 解释 */
export type Settings = Record<string, unknown>;

/** 索引切分周期 —— 由模板占位符推断 */
export type IndexRollover = 'none' | 'daily' | 'monthly' | 'yearly';

// ========== 归一化输出 ==========

/** 归一化慢查询记录 —— provider 的统一输出，syncService 只认这个 */
export interface NormalizedSlowQuery {
  querySql: string;
  queryTime: number;
  lockTime: number;
  rowsExamined: number;
  rowsSent: number;
  dbName: string;
  instanceName: string;
  instanceId: string;
  nodeId: string;
  userName: string;
  userHost: string;
  timestamp: number;      // 毫秒时间戳
}

// ========== Provider 能力声明 ==========

export interface ProviderCapabilities {
  /** 能否枚举实例列表（ES 可以，单文件不行） */
  instanceEnumeration: boolean;
  /** 能否预览校验配置（ES 预览索引，文件预览匹配到的文件） */
  configPreview: boolean;
}

// ========== Provider 契约 ==========

export interface FetchQuery {
  instanceName?: string;
  startTime: number;     // 毫秒时间戳（含）
  endTime: number;       // 毫秒时间戳（不含）
}

export interface FetchBatch {
  records: NormalizedSlowQuery[];
  sourceRef: string;     // 诊断信息：索引目标 / 文件路径 / 表名
}

/** 基契约 —— 所有数据源类型都必须且都能满足 */
export interface DataSourceProvider {
  /** 类型标识，如 'kibana_proxy'、'direct_es' */
  type: string;
  /** 类型显示名，前端类型下拉用 */
  label: string;

  /** 该类型的能力声明 */
  capabilities(): ProviderCapabilities;
  /** 类型的默认 settings */
  defaultSettings(): Settings;
  /** 需脱敏的 settings key，如 ['password'] */
  secretKeys(): string[];
  /** 校验 settings 合法性，返回错误信息列表，空数组表示通过 */
  validate(settings: Settings): string[];
  /** 列表页一行摘要，如 'http://kibana:5601 · 按日切分' */
  describe(settings: Settings): string;
  /** 测试连接 */
  testConnection(settings: Settings): Promise<{ connected: boolean; info?: string; error?: string }>;
  /** 分批产出归一化记录，provider 内部控制分批节奏 */
  fetchRecords(settings: Settings, query: FetchQuery): AsyncIterable<FetchBatch>;
}

// ========== 可选能力接口 ==========

/** 可枚举实例列表的数据源（按 capabilities.instanceEnumeration 声明后才会被调用） */
export interface InstanceEnumerable {
  getInstanceNames(settings: Settings): Promise<string[]>;
}

/** 可预览配置的数据源（按 capabilities.configPreview 声明后才会被调用） */
export interface ConfigPreviewable {
  preview(settings: Settings, startDate: string, endDate: string): Promise<PreviewResult>;
}

/** 可发现索引字段的数据源（用于字段映射下拉选择） */
export interface FieldDiscoverable {
  getIndexFields(settings: Settings): Promise<IndexFieldInfo[]>;
}

/** 索引字段信息 */
export interface IndexFieldInfo {
  /** 字段名（支持嵌套路径，如 a.b） */
  name: string;
  /** ES 字段类型，如 keyword, text, long, float, date 等 */
  type: string;
}

export interface PreviewResult {
  /** 推断出的切分周期 */
  rollover: IndexRollover;
  /** 解析后的索引目标字符串 */
  resolvedTarget: string;
  /** 渲染出的示例索引名（取前几个） */
  renderedSamples: string[];
  /** 实际在数据源中存在的索引列表 */
  existingIndices: string[];
}

// ========== ES 类 Settings ==========

/** ES 字段映射 */
export interface EsFieldMapping {
  querySql: string;
  queryTime: string;
  lockTime: string;
  rowsExamined: string;
  rowsSent: string;
  dbName: string;
  instanceName: string;
  instanceId: string;
  nodeId: string;
  userName: string;
  userHost: string;
  timestamp: string;
}

/** ES 类数据源的 settings 结构 */
export interface EsSettings {
  host: string;
  proxyPath?: string;          // 仅 kibana_proxy 使用
  username?: string;
  password?: string;
  indexPattern: string;
  keywordSuffix: string;
  fieldMapping: EsFieldMapping;
}

// ========== 默认值 ==========

export const DEFAULT_PROXY_PATH = '/api/console/proxy';
export const DEFAULT_INDEX_PATTERN = 'mysql_slow_log-{YYYY}.{MM}.{DD}';
export const DEFAULT_KEYWORD_SUFFIX = '.keyword';

export const DEFAULT_FIELD_MAPPING: EsFieldMapping = {
  querySql: 'query_sql',
  queryTime: 'query_time',
  lockTime: 'lock_time',
  rowsExamined: 'rows_examined',
  rowsSent: 'rows_sent',
  dbName: 'db_name',
  instanceName: 'instance_name',
  instanceId: 'instance_id',
  nodeId: 'node_id',
  userName: 'user_name',
  userHost: 'user_host',
  timestamp: 'timestamp',
};
