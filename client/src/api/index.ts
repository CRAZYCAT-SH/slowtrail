import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

/** 获取客户端时区偏移量（分钟），用于趋势聚合的本地时间分组 */
function getTzOffset(): number {
  return new Date().getTimezoneOffset();
}

// ========== 数据源相关 ==========

export interface DataSourceSettings {
  host?: string;
  proxyPath?: string;
  username?: string;
  password?: string;
  indexPattern?: string;
  keywordSuffix?: string;
  fieldMapping?: Record<string, string>;
  [key: string]: unknown;
}

export interface DataSourceItem {
  id: number;
  name: string;
  type: string;
  settings: DataSourceSettings;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  summary: string;
  capabilities: { instanceEnumeration: boolean; configPreview: boolean };
}

/** 定时任务 */
export interface ScheduleTask {
  id: number;
  dataSourceId: number;
  instanceName: string;
  enabled: boolean;
  intervalMinutes: number;
  daysOffset: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 定时任务列表项（附带数据源名称和运行状态） */
export interface ScheduleTaskItem extends ScheduleTask {
  dataSourceName: string;
  running: boolean;
}

/** 创建/更新定时任务输入 */
export interface ScheduleTaskInput {
  dataSourceId: number;
  instanceName: string;
  enabled?: boolean;
  intervalMinutes?: number;
  daysOffset?: number;
}

export interface ProviderTypeInfo {
  type: string;
  label: string;
  capabilities: { instanceEnumeration: boolean; configPreview: boolean };
  defaultSettings: DataSourceSettings;
}

export interface PreviewResult {
  rollover: string;
  resolvedTarget: string;
  renderedSamples: string[];
  existingIndices: string[];
}

/** ES 索引字段信息 */
export interface IndexFieldInfo {
  name: string;
  type: string;
}

/** 文件上传结果 */
export interface UploadResult {
  filePath: string;
  originalFileName: string;
  sheetNames: string[];
  headers: string[];
  previewRows: string[][];
  totalRows: number;
  /** 检测到的文件编码（仅 CSV 文件返回） */
  detectedEncoding?: string;
}

/** 编码选项 */
export interface EncodingOption {
  value: string;
  label: string;
}

export const dataSourceApi = {
  getTypes: () =>
    api.get<{ success: boolean; data: ProviderTypeInfo[] }>('/datasources/types'),
  getList: () =>
    api.get<{ success: boolean; data: DataSourceItem[] }>('/datasources'),
  create: (data: { name: string; type: string; settings: DataSourceSettings; enabled?: boolean }) =>
    api.post<{ success: boolean; data: DataSourceItem }>('/datasources', data),
  update: (id: number, data: { name?: string; type?: string; settings?: DataSourceSettings; enabled?: boolean }) =>
    api.put<{ success: boolean; data: DataSourceItem }>(`/datasources/${id}`, data),
  remove: (id: number, deleteData: boolean = false) =>
    api.delete<{ success: boolean; message: string }>(`/datasources/${id}`, { params: { deleteData } }),
  test: (id: number) =>
    api.post<{ success: boolean; data: { connected: boolean; info?: string; error?: string } }>(`/datasources/${id}/test`),
  testUnsaved: (type: string, settings: DataSourceSettings) =>
    api.post<{ success: boolean; data: { connected: boolean; info?: string; error?: string } }>('/datasources/test-unsaved', { type, settings }),
  getInstanceNames: (id: number) =>
    api.get<{ success: boolean; data: string[] }>(`/datasources/${id}/instance-names`),
  preview: (type: string, settings: DataSourceSettings, startDate: string, endDate: string) =>
    api.post<{ success: boolean; data: PreviewResult }>('/datasources/preview', { type, settings, startDate, endDate }),
  getFields: (type: string, settings: DataSourceSettings, dataSourceId?: number) =>
    api.post<{ success: boolean; data: IndexFieldInfo[] }>('/datasources/fields', { type, settings, dataSourceId }),
  /** 上传 Excel/CSV 文件，返回文件路径和表头信息 */
  upload: (formData: FormData) =>
    api.post<{ success: boolean; data: UploadResult }>('/datasources/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  /** 获取已上传文件指定 sheet 的表头（支持指定编码） */
  uploadHeaders: (filePath: string, sheetName?: string, encoding?: string) =>
    api.post<{ success: boolean; data: { headers: string[]; previewRows: string[][]; totalRows: number; detectedEncoding?: string } }>('/datasources/upload/headers', { filePath, sheetName, encoding }),
  /** 获取支持的编码列表 */
  getEncodings: () =>
    api.get<{ success: boolean; data: EncodingOption[] }>('/datasources/encodings'),
};

// ========== 定时任务相关 ==========

export const scheduleApi = {
  /** 获取所有定时任务 */
  getList: () =>
    api.get<{ success: boolean; data: ScheduleTaskItem[] }>('/schedule'),
  /** 获取单个任务 */
  getTask: (id: number) =>
    api.get<{ success: boolean; data: ScheduleTask }>(`/schedule/${id}`),
  /** 创建任务 */
  create: (data: ScheduleTaskInput) =>
    api.post<{ success: boolean; data: ScheduleTask }>('/schedule', data),
  /** 更新任务 */
  update: (id: number, data: Partial<ScheduleTaskInput> & { enabled?: boolean }) =>
    api.put<{ success: boolean; data: ScheduleTask }>(`/schedule/${id}`, data),
  /** 删除任务 */
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/schedule/${id}`),
  /** 立即触发任务 */
  trigger: (id: number) =>
    api.post<{ success: boolean; message: string }>(`/schedule/${id}/trigger`),
};

// ========== 同步相关 ==========

export interface SyncParams {
  dataSourceId?: number;
  instanceName: string;
  startDate: string;
  endDate: string;
  forceOverwrite?: boolean;
}

export interface SyncResult {
  totalRecords: number;
  syncedDates: string[];
  skippedDates: string[];
  emptyDates: string[];
  errors: string[];
}

export interface SyncHistoryItem {
  id: number;
  data_source_id: number | null;
  instance_name: string;
  sync_date: string;
  source_ref: string | null;
  synced_at: number;
  record_count: number;
  trigger_type: string;
}

export const syncApi = {
  sync: (params: SyncParams) => api.post<{ success: boolean; data: SyncResult }>('/sync', params),
  getHistory: (filter?: { instanceName?: string; dataSourceId?: number }) =>
    api.get<{ success: boolean; data: SyncHistoryItem[] }>('/sync/history', { params: filter }),
  getStats: () => api.get<{ success: boolean; data: { totalRecords: number; dbSize: string } }>('/sync/stats'),
  getLastInstance: () => api.get<{ success: boolean; data: string | null }>('/sync/last-instance'),
  clearData: (params?: { startTime?: number; endTime?: number }) =>
    api.delete('/sync/data', { params }),
  clearRecord: (dataSourceId: number, instanceName: string, syncDate: string) =>
    api.delete<{ success: boolean; message: string; deletedCount: number }>('/sync/record', {
      params: { dataSourceId, instanceName, syncDate },
    }),
};

// 统计相关
export interface QueryFilter {
  startTime?: number;
  endTime?: number;
  dbName?: string;
  instanceName?: string;
}

export interface StatsOverview {
  totalCount: number;
  avgQueryTime: number;
  maxQueryTime: number;
  avgRowsExamined: number;
  avgLockTime: number;
  totalRowsExamined: number;
  totalQueryTime: number;
}

/** 带环比对比的统计概览 */
export interface StatsOverviewWithCompare {
  current: StatsOverview;
  compare?: StatsOverview;
}

/** 耗时区间分布项 */
export interface TimeRangeItem {
  range: string;
  count: number;
}

/** 维度分布项 */
export interface DimensionItem {
  name: string;
  count: number;
}

/** 分布统计结果 */
export interface StatsDistribution {
  timeRanges: TimeRangeItem[];
  byDatabase: DimensionItem[];
  byInstance: DimensionItem[];
}

/** 热力图数据点 */
export interface HeatmapPoint {
  dayOfWeek: number; // 0=周一, 6=周日
  hour: number; // 0-23
  count: number;
}

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

export interface TrendPoint {
  time: number;
  count: number;
  avgQueryTime: number;
  maxQueryTime: number;
}

export interface FilterOptions {
  dbNames: string[];
  instanceNames: string[];
}

export const statsApi = {
  getOverview: (filter: QueryFilter & { compareStartTime?: number; compareEndTime?: number }) =>
    api.get<{ success: boolean; data: StatsOverviewWithCompare }>('/stats/overview', { params: filter }),
  getTopQueries: (filter: QueryFilter & { limit?: number; offset?: number; sortBy?: string }) =>
    api.get<{ success: boolean; data: SlowQueryItem[]; total: number }>('/stats/top-queries', { params: filter }),
  getTrends: (filter: QueryFilter & { granularity?: 'minute' | 'hour' | 'day'; fingerprint?: string; groupId?: number }) =>
    api.get<{ success: boolean; data: TrendPoint[] }>('/stats/trends', {
      params: { ...filter, tzOffset: getTzOffset() },
    }),
  getFilterOptions: () =>
    api.get<{ success: boolean; data: FilterOptions }>('/stats/filter-options'),
  getDistribution: (filter: QueryFilter) =>
    api.get<{ success: boolean; data: StatsDistribution }>('/stats/distribution', { params: filter }),
  getHeatmap: (filter: QueryFilter) =>
    api.get<{ success: boolean; data: HeatmapPoint[] }>('/stats/heatmap', {
      params: { ...filter, tzOffset: getTzOffset() },
    }),
};

// 指纹相关
// 说明：指纹视图展示的是 fingerprint 本身，不含 sampleSql —— 后端为此省掉了
// 对 7KB 级 query_sql 字段的聚合。分类视图的 GroupedFingerprintItem 仍带 sampleSql
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
 * 字段与 slow_queries 表一一对应；data_source_name 由后端 JOIN data_sources 得出
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

export const fingerprintApi = {
  getList: (filter: QueryFilter & { sortBy?: string; order?: string; limit?: number; offset?: number; search?: string; view?: 'fingerprint' | 'grouped' }) =>
    api.get<{ success: boolean; data: FingerprintItem[] | GroupedFingerprintItem[]; total: number }>('/fingerprints', { params: filter }),
  getDetail: (fingerprint: string, filter: QueryFilter & { samplesLimit?: number; samplesOffset?: number; trendGranularity?: 'minute' | 'hour' | 'day' }) =>
    api.get<{ success: boolean; data: FingerprintDetail }>('/fingerprints/detail', {
      params: { fingerprint, ...filter, tzOffset: getTzOffset() },
    }),
  /** 获取分组详情：汇总 + 各成员独立统计 + 趋势图 */
  getGroupDetail: (fingerprints: string[], filter: QueryFilter & { trendGranularity?: 'minute' | 'hour' | 'day' }) =>
    api.post<{ success: boolean; data: GroupDetailResult }>('/fingerprints/group-detail', {
      fingerprints, ...filter, tzOffset: getTzOffset(),
    }),
};

// 指纹归类（分组）相关
export interface GroupDetailResult {
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
  timeTrend: Array<{
    time: number;
    count: number;
    avgTime: number;
    maxTime: number;
  }>;
  trendGranularity: 'minute' | 'hour' | 'day';
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

export interface FingerprintGroup {
  id: number;
  name: string;
  createdAt: number;
  fingerprints: string[];
}

/** 分类视图聚合项 */
export interface GroupedFingerprintItem {
  groupId: number | null;
  groupName: string | null;
  memberCount: number;
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

/** 相似指纹推荐项 */
export interface SimilarFingerprintItem {
  fingerprint: string;
  sampleSql: string;
  count: number;
  avgQueryTime: number;
  similarity: number;
  existingGroupId: number | null;
  existingGroupName: string | null;
}

export const groupApi = {
  /** 获取所有分类列表 */
  getList: () =>
    api.get<{ success: boolean; data: FingerprintGroup[] }>('/fingerprint-groups'),

  /** 获取相似指纹推荐 */
  getSimilar: (fingerprint: string, filter: QueryFilter & { limit?: number }) =>
    api.get<{ success: boolean; data: SimilarFingerprintItem[] }>('/fingerprint-groups/similar', {
      params: { fingerprint, ...filter },
    }),

  /** 创建分类 */
  create: (name: string, fingerprints: string[]) =>
    api.post<{ success: boolean; data: FingerprintGroup }>('/fingerprint-groups', { name, fingerprints }),

  /** 修改分类名称 */
  updateName: (groupId: number, name: string) =>
    api.put<{ success: boolean; data: FingerprintGroup }>(`/fingerprint-groups/${groupId}`, { name }),

  /** 删除分类 */
  delete: (groupId: number) =>
    api.delete<{ success: boolean }>(`/fingerprint-groups/${groupId}`),

  /** 向分类添加指纹 */
  addFingerprints: (groupId: number, fingerprints: string[]) =>
    api.post<{ success: boolean; data: { addedCount: number } }>(`/fingerprint-groups/${groupId}/fingerprints`, { fingerprints }),

  /** 从分类移除指纹 */
  removeFingerprint: (groupId: number, fingerprint: string) =>
    api.delete<{ success: boolean }>(`/fingerprint-groups/${groupId}/fingerprints/${encodeURIComponent(fingerprint)}`),
};

export default api;
