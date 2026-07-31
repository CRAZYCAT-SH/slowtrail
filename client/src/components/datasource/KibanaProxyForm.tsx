/**
 * Kibana 代理类型数据源表单
 */

import type { DataSourceFormProps } from './formRegistry';
import EsCommonFields from './EsCommonFields';

export default function KibanaProxyForm({ settings, onChange, isEdit, dataSourceId }: DataSourceFormProps) {
  return (
    <div className="space-y-4">
      {/* 连接地址 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Kibana 地址 <span className="text-red-400">*</span></label>
        <input
          type="text"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
          value={settings.host || ''}
          onChange={(e) => onChange({ ...settings, host: e.target.value })}
          placeholder="http://localhost:5601"
        />
      </div>

      {/* 代理路径 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">代理路径</label>
        <input
          type="text"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none font-mono"
          value={settings.proxyPath || ''}
          onChange={(e) => onChange({ ...settings, proxyPath: e.target.value })}
          placeholder="/api/console/proxy"
        />
        <p className="mt-0.5 text-xs text-gray-400">Kibana console proxy 端点，留空使用默认值</p>
      </div>

      {/* 共用 ES 字段 */}
      <EsCommonFields settings={settings} onChange={onChange} type="kibana_proxy" isEdit={isEdit} dataSourceId={dataSourceId} />
    </div>
  );
}
