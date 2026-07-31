/**
 * ES 类数据源共用字段块
 * 包含：认证信息、索引模板（含占位符说明与预览）、keyword 后缀、字段映射（下拉选择）
 */

import { useState } from 'react';
import type { DataSourceSettings, PreviewResult, IndexFieldInfo } from '../../api';
import { dataSourceApi } from '../../api';
import Button from '../Button';

interface Props {
  settings: DataSourceSettings;
  onChange: (settings: DataSourceSettings) => void;
  type: string;
  isEdit?: boolean;
  /** 已保存数据源的 ID（编辑模式下传入，用于获取字段时使用真实密码） */
  dataSourceId?: number;
}

const FIELD_MAPPING_KEYS = [
  { key: 'querySql', label: 'SQL 语句', default: 'query_sql' },
  { key: 'queryTime', label: '查询耗时', default: 'query_time' },
  { key: 'lockTime', label: '锁等待时间', default: 'lock_time' },
  { key: 'rowsExamined', label: '扫描行数', default: 'rows_examined' },
  { key: 'rowsSent', label: '返回行数', default: 'rows_sent' },
  { key: 'dbName', label: '数据库名', default: 'db_name' },
  { key: 'instanceName', label: '实例名', default: 'instance_name' },
  { key: 'instanceId', label: '实例 ID', default: 'instance_id' },
  { key: 'nodeId', label: '节点 ID', default: 'node_id' },
  { key: 'userName', label: '用户名', default: 'user_name' },
  { key: 'userHost', label: '用户主机', default: 'user_host' },
  { key: 'timestamp', label: '时间戳', default: 'timestamp' },
];

const PATTERN_EXAMPLES = [
  { label: '按日（点分隔）', value: 'mysql_slow_log-{YYYY}.{MM}.{DD}' },
  { label: '按日（无分隔符）', value: 'slow_log_{YYYY}{MM}{DD}' },
  { label: '按月', value: 'logs-{YYYY}-{MM}' },
  { label: '不切分', value: 'mysql_slow_log' },
  { label: '纯通配', value: 'mysql_slow_log-*' },
];

export default function EsCommonFields({ settings, onChange, type, isEdit, dataSourceId }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // 字段发现
  const [indexFields, setIndexFields] = useState<IndexFieldInfo[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState('');

  const fieldMapping = (settings.fieldMapping || {}) as Record<string, string>;

  function updateField(key: string, value: string) {
    onChange({ ...settings, [key]: value });
  }

  function updateFieldMapping(key: string, value: string) {
    const newMapping = { ...fieldMapping, [key]: value };
    onChange({ ...settings, fieldMapping: newMapping });
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewResult(null);
    try {
      // 用最近 3 天做预览
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 2);
      const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

      const res = await dataSourceApi.preview(type, settings, startDate, endDate);
      if (res.data.success) {
        setPreviewResult(res.data.data);
      } else {
        setPreviewError('预览失败');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setPreviewError(e.response?.data?.error || e.message || '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleFetchFields() {
    setFieldsLoading(true);
    setFieldsError('');
    try {
      const res = await dataSourceApi.getFields(type, settings, dataSourceId);
      if (res.data.success) {
        setIndexFields(res.data.data);
        if (res.data.data.length === 0) {
          setFieldsError('未发现任何字段，请检查索引模板和连接配置');
        }
      } else {
        setFieldsError('获取字段失败');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setFieldsError(e.response?.data?.error || e.message || '获取字段失败');
    } finally {
      setFieldsLoading(false);
    }
  }

  const rolloverLabels: Record<string, string> = {
    none: '不切分（单索引或通配）',
    daily: '按日切分',
    monthly: '按月切分',
    yearly: '按年切分',
  };

  // 过滤掉 .keyword 等子字段，只展示主字段（用户通过 keyword 后缀配置来控制聚合字段）
  const primaryFields = indexFields.filter((f) => !f.name.includes('.'));

  return (
    <div className="space-y-4">
      {/* 认证信息 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">用户名</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
            value={settings.username || ''}
            onChange={(e) => updateField('username', e.target.value)}
            placeholder="可选"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">密码</label>
          <input
            type="password"
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
            value={settings.password || ''}
            onChange={(e) => updateField('password', e.target.value)}
            placeholder={isEdit ? '留空表示不修改' : '可选'}
          />
        </div>
      </div>

      {/* 索引模板 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">索引模板</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none font-mono"
            value={settings.indexPattern || ''}
            onChange={(e) => updateField('indexPattern', e.target.value)}
            placeholder="mysql_slow_log-{YYYY}.{MM}.{DD}"
          />
          <Button variant="secondary" size="sm" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? '...' : '预览'}
          </Button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PATTERN_EXAMPLES.map((ex) => (
            <button
              key={ex.value}
              type="button"
              className="px-2 py-0.5 text-xs text-gray-500 bg-gray-50 rounded hover:bg-gray-100 hover:text-gray-700 transition-colors"
              onClick={() => updateField('indexPattern', ex.value)}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          占位符: {'{YYYY}'} {'{YY}'} {'{MM}'} {'{M}'} {'{DD}'} {'{D}'}，其余字符原样保留，可用 *
        </p>

        {/* 预览结果 */}
        {previewResult && (
          <div className="mt-2 p-3 bg-gray-50 rounded-md text-xs space-y-1">
            <p><span className="text-gray-500">切分周期:</span> <span className="font-medium">{rolloverLabels[previewResult.rollover] || previewResult.rollover}</span></p>
            <p><span className="text-gray-500">解析目标:</span> <code className="text-primary">{previewResult.resolvedTarget}</code></p>
            {previewResult.renderedSamples.length > 0 && (
              <p><span className="text-gray-500">示例索引:</span> {previewResult.renderedSamples.slice(0, 3).join(', ')}</p>
            )}
            {previewResult.existingIndices.length > 0 && (
              <p><span className="text-gray-500">实际存在 ({previewResult.existingIndices.length}):</span> {previewResult.existingIndices.slice(0, 5).join(', ')}{previewResult.existingIndices.length > 5 ? ' ...' : ''}</p>
            )}
            {previewResult.existingIndices.length === 0 && (
              <p className="text-amber-600">未匹配到已存在的索引，请检查模板是否正确</p>
            )}
          </div>
        )}
        {previewError && (
          <p className="mt-1 text-xs text-red-500">{previewError}</p>
        )}
      </div>

      {/* 高级选项 */}
      <div>
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▸</span>
          高级选项
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3 pl-3 border-l-2 border-gray-100">
            {/* keyword 后缀 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">keyword 后缀</label>
              <input
                type="text"
                className="w-48 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none font-mono"
                value={settings.keywordSuffix ?? '.keyword'}
                onChange={(e) => updateField('keywordSuffix', e.target.value)}
                placeholder=".keyword"
              />
              <p className="mt-0.5 text-xs text-gray-400">字段本身为 keyword 类型时置空</p>
            </div>

            {/* 字段映射 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-500">字段映射</label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleFetchFields}
                  disabled={fieldsLoading || !settings.indexPattern}
                >
                  {fieldsLoading ? '加载中...' : indexFields.length > 0 ? '刷新字段' : '获取字段'}
                </Button>
              </div>

              {fieldsError && (
                <p className="text-xs text-red-500 mb-2">{fieldsError}</p>
              )}

              {indexFields.length > 0 && (
                <p className="text-xs text-green-600 mb-2">
                  已发现 {primaryFields.length} 个字段，请从下拉列表中选择对应映射
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {FIELD_MAPPING_KEYS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-20 text-right shrink-0">{f.label}</span>
                    {indexFields.length > 0 ? (
                      <select
                        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-primary/50 focus:outline-none font-mono"
                        value={fieldMapping[f.key] || ''}
                        onChange={(e) => updateFieldMapping(f.key, e.target.value)}
                      >
                        <option value="">-- 请选择 --</option>
                        {primaryFields.map((field) => (
                          <option key={field.name} value={field.name}>
                            {field.name} ({field.type})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-primary/50 focus:outline-none font-mono"
                        value={fieldMapping[f.key] || ''}
                        onChange={(e) => updateFieldMapping(f.key, e.target.value)}
                        placeholder={f.default}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
