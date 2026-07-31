/**
 * 直连 ES 类型数据源表单
 */

import type { DataSourceFormProps } from './formRegistry';
import EsCommonFields from './EsCommonFields';

export default function DirectESForm({ settings, onChange, isEdit, dataSourceId }: DataSourceFormProps) {
  return (
    <div className="space-y-4">
      {/* 连接地址 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">ES 地址 <span className="text-red-400">*</span></label>
        <input
          type="text"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
          value={settings.host || ''}
          onChange={(e) => onChange({ ...settings, host: e.target.value })}
          placeholder="http://localhost:9200"
        />
      </div>

      {/* 共用 ES 字段（无代理路径） */}
      <EsCommonFields settings={settings} onChange={onChange} type="direct_es" isEdit={isEdit} dataSourceId={dataSourceId} />
    </div>
  );
}
