/**
 * 数据源新增/编辑弹窗
 */

import { useState, Suspense, lazy } from 'react';
import type { DataSourceItem, DataSourceSettings, ProviderTypeInfo } from '../../api';
import { dataSourceApi } from '../../api';
import type { DataSourceFormProps } from './formRegistry';
import Button from '../Button';
import Select from '../Select';

// 表单组件映射
const KibanaProxyForm = lazy(() => import('./KibanaProxyForm'));
const DirectESForm = lazy(() => import('./DirectESForm'));
const ExcelForm = lazy(() => import('./ExcelForm'));

const formComponentMap: Record<string, React.LazyExoticComponent<React.ComponentType<DataSourceFormProps>>> = {
  kibana_proxy: KibanaProxyForm,
  direct_es: DirectESForm,
  excel: ExcelForm,
};

interface Props {
  visible: boolean;
  editItem?: DataSourceItem | null;
  types: ProviderTypeInfo[];
  onClose: () => void;
  onSaved: () => void;
}

export default function DataSourceModal({ visible, editItem, types, onClose, onSaved }: Props) {
  const isEdit = !!editItem;

  const [name, setName] = useState(() => editItem?.name || '');
  const [type, setType] = useState(() => editItem?.type || types[0]?.type || 'kibana_proxy');
  const [settings, setSettings] = useState<DataSourceSettings>(() => ({ ...(editItem?.settings || types[0]?.defaultSettings || {}) }));
  const [enabled, setEnabled] = useState(() => editItem?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; info?: string; error?: string } | null>(null);
  const [error, setError] = useState('');

  function handleTypeChange(newType: string) {
    setType(newType);
    const typeInfo = types.find((t) => t.type === newType);
    if (typeInfo) {
      setSettings({ ...typeInfo.defaultSettings });
    }
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      let result: { connected: boolean; info?: string; error?: string };
      if (isEdit && editItem) {
        const res = await dataSourceApi.test(editItem.id);
        result = res.data.success ? res.data.data : { connected: false, error: '请求失败' };
      } else {
        const res = await dataSourceApi.testUnsaved(type, settings);
        result = res.data.success ? res.data.data : { connected: false, error: '请求失败' };
      }
      setTestResult(result);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setTestResult({ connected: false, error: e.response?.data?.error || e.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('请输入数据源名称');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit && editItem) {
        await dataSourceApi.update(editItem.id, { name, type, settings, enabled });
      } else {
        await dataSourceApi.create({ name, type, settings, enabled });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  const FormComponent = formComponentMap[type] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl w-[560px] max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {isEdit ? '编辑数据源' : '新增数据源'}
          </h3>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 基础信息 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">名称 <span className="text-red-400">*</span></label>
              <input
                type="text"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：生产环境 ES"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">类型</label>
              <Select
                value={type}
                onChange={handleTypeChange}
                options={types.map((t) => ({ value: t.type, label: t.label }))}
                className="w-full"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            启用
          </label>

          {/* 类型专属表单 */}
          {FormComponent && (
            <Suspense fallback={<div className="text-sm text-gray-400">加载中...</div>}>
              <FormComponent settings={settings} onChange={setSettings} isEdit={isEdit} dataSourceId={editItem?.id} />
            </Suspense>
          )}

          {/* 错误信息 */}
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-red-600 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-6 py-3 border-t border-gray-100 space-y-2">
          {testResult && (
            <div className={`px-3 py-2 rounded-md text-xs ${testResult.connected ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {testResult.connected ? `连接成功: ${testResult.info || ''}` : `连接失败: ${testResult.error || '未知错误'}`}
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={handleTest} disabled={testing}>
              {testing ? '测试中...' : '测试连接'}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
