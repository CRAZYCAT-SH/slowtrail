/**
 * 数据源列表组件
 * 展示所有已配置的数据源，支持测试连接、编辑、删除
 */

import { useState } from 'react';
import type { DataSourceItem } from '../../api';
import { dataSourceApi } from '../../api';
import Button from '../Button';

interface Props {
  dataSources: DataSourceItem[];
  onEdit: (item: DataSourceItem) => void;
  onDeleted: () => void;
}

export default function DataSourceList({ dataSources, onEdit, onDeleted }: Props) {
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { connected: boolean; info?: string; error?: string }>>({});
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteData, setDeleteData] = useState(false);

  async function handleTest(id: number) {
    setTestingId(id);
    try {
      const res = await dataSourceApi.test(id);
      if (res.data.success) {
        setTestResults((prev) => ({ ...prev, [id]: res.data.data }));
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setTestResults((prev) => ({ ...prev, [id]: { connected: false, error: e.message || '测试失败' } }));
    } finally {
      setTestingId(null);
    }
  }

  async function confirmDelete(id: number) {
    try {
      await dataSourceApi.remove(id, deleteData);
      setDeletingId(null);
      setDeleteData(false);
      onDeleted();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      alert(e.response?.data?.error || e.message || '删除失败');
    }
  }

  if (dataSources.length === 0) {
    return <p className="text-sm text-gray-400">暂无数据源配置</p>;
  }

  return (
    <div className="space-y-3">
      {dataSources.map((ds) => (
        <div key={ds.id} className="flex items-center justify-between px-4 py-3 bg-gray-50/50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {/* 名称与标签 */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{ds.name}</span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                  {ds.type === 'kibana_proxy' ? 'Kibana' : ds.type === 'direct_es' ? '直连' : ds.type}
                </span>
                {ds.isDefault && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-600 rounded">
                    环境变量
                  </span>
                )}
                {!ds.enabled && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-400 rounded">
                    已禁用
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{ds.summary}</p>
            </div>
          </div>

          {/* 操作 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 测试结果 */}
            {testResults[ds.id] && (
              <span className={`text-xs ${testResults[ds.id].connected ? 'text-green-600' : 'text-red-500'}`}>
                {testResults[ds.id].connected ? '已连接' : '失败'}
              </span>
            )}
            <Button size="sm" variant="secondary" onClick={() => handleTest(ds.id)} disabled={testingId === ds.id}>
              {testingId === ds.id ? '...' : '测试'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onEdit(ds)}>
              编辑
            </Button>
            {ds.isDefault ? (
              <Button size="sm" variant="secondary" disabled title="默认数据源不可删除">
                删除
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setDeletingId(ds.id)}>
                删除
              </Button>
            )}
          </div>
        </div>
      ))}

      {/* 删除确认弹窗 */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setDeletingId(null); setDeleteData(false); }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-gray-900 mb-3">确认删除数据源</h4>
            <p className="text-sm text-gray-600 mb-3">
              删除后该数据源配置将永久移除。
            </p>
            <label className="flex items-center gap-2 text-sm text-red-600 cursor-pointer select-none mb-4">
              <input
                type="checkbox"
                checked={deleteData}
                onChange={(e) => setDeleteData(e.target.checked)}
                className="w-3.5 h-3.5 accent-red-500"
              />
              同时删除该数据源已拉取的本地数据（不可撤销）
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setDeletingId(null); setDeleteData(false); }}>取消</Button>
              <Button variant="danger" onClick={() => confirmDelete(deletingId)}>
                {deleteData ? '删除配置和数据' : '仅删除配置'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
