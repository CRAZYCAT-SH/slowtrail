import { useState, useEffect, useMemo } from 'react';
import { dataSourceApi, syncApi } from '../api';
import type { DataSourceItem, ProviderTypeInfo, SyncHistoryItem, SyncResult } from '../api';
import { DataSourceList, DataSourceModal, ScheduleTaskList } from '../components/datasource';
import DateRangeShortcuts from '../components/DateRangeShortcuts';
import Button from '../components/Button';
import Select from '../components/Select';
import { useDateRange } from '../contexts/DateRangeContext';

function formatDateHelper(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type TabKey = 'sync' | 'datasource' | 'schedule';

export default function SyncPage() {
  const { refreshFilterOptions } = useDateRange();
  const [activeTab, setActiveTab] = useState<TabKey>('sync');

  // 数据源相关
  const [dataSources, setDataSources] = useState<DataSourceItem[]>([]);
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDs, setEditingDs] = useState<DataSourceItem | null>(null);

  // 同步表单
  const [selectedDsId, setSelectedDsId] = useState<number | ''>('');
  const [instanceNames, setInstanceNames] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateHelper(yesterday);
  });
  const [endDate, setEndDate] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateHelper(yesterday);
  });
  const [loading, setLoading] = useState(false);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loadingInstances, setLoadingInstances] = useState(false);

  // 历史与统计
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [dbStats, setDbStats] = useState<{ totalRecords: number; dbSize: string } | null>(null);
  const [error, setError] = useState('');

  // 数据源名称映射
  const dsNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const ds of dataSources) {
      map.set(ds.id, ds.name);
    }
    return map;
  }, [dataSources]);

  // 当前选中数据源的能力
  const selectedDs = dataSources.find((ds) => ds.id === selectedDsId);
  const canEnumerateInstances = selectedDs?.capabilities.instanceEnumeration ?? false;

  // 初始化
  useEffect(() => {
    loadDataSources();
    loadTypes();
    loadHistory();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDataSources() {
    try {
      const res = await dataSourceApi.getList();
      if (res.data.success) {
        const list = res.data.data;
        setDataSources(list);
        if (!selectedDsId && list.length > 0) {
          const defaultDs = list.find((ds) => ds.isDefault && ds.enabled);
          const firstEnabled = list.find((ds) => ds.enabled);
          const target = defaultDs || firstEnabled;
          if (target) {
            setSelectedDsId(target.id);
          }
        }
      }
    } catch { /* 静默 */ }
  }

  async function loadTypes() {
    try {
      const res = await dataSourceApi.getTypes();
      if (res.data.success) {
        setTypes(res.data.data);
      }
    } catch { /* 静默 */ }
  }

  async function loadLastInstance() {
    try {
      const res = await syncApi.getLastInstance();
      if (res.data.success && res.data.data) {
        setSelectedInstance(res.data.data);
      }
    } catch { /* 静默 */ }
  }

  async function loadInstanceNames() {
    if (!selectedDsId) return;
    setLoadingInstances(true);
    setError('');
    try {
      const res = await dataSourceApi.getInstanceNames(selectedDsId as number);
      if (res.data.success) {
        const names = res.data.data;
        setInstanceNames(names);
        if (names.length > 0) {
          if (!names.includes(selectedInstance)) {
            setSelectedInstance(names[0]);
          }
        } else {
          setSelectedInstance('');
        }
      }
    } catch (err: unknown) {
      const e = err as Error;
      setError('获取实例列表失败: ' + e.message);
    } finally {
      setLoadingInstances(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await syncApi.getHistory();
      if (res.data.success) {
        setHistory(res.data.data);
      }
    } catch { /* 静默 */ }
  }

  async function loadStats() {
    try {
      const res = await syncApi.getStats();
      if (res.data.success) {
        setDbStats(res.data.data);
      }
    } catch { /* 静默 */ }
  }

  async function handleSync() {
    if (!selectedInstance) {
      setError('请选择或输入实例');
      return;
    }
    if (!startDate || !endDate) {
      setError('请选择日期范围');
      return;
    }

    setLoading(true);
    setError('');
    setSyncResult(null);

    try {
      const res = await syncApi.sync({
        dataSourceId: selectedDsId ? (selectedDsId as number) : undefined,
        instanceName: selectedInstance,
        startDate,
        endDate,
        forceOverwrite,
      });
      if (res.data.success) {
        setSyncResult(res.data.data);
        loadHistory();
        loadStats();
        refreshFilterOptions();
      } else {
        setError('同步失败');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || '同步失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleClearData() {
    if (!window.confirm('确定要清空所有本地数据吗？此操作不可撤销。')) return;
    try {
      await syncApi.clearData();
      loadHistory();
      loadStats();
      setSyncResult(null);
      refreshFilterOptions();
    } catch (err: unknown) {
      const e = err as Error;
      setError('清空数据失败: ' + e.message);
    }
  }

  async function handleDeleteRecord(item: SyncHistoryItem) {
    if (!item.data_source_id) {
      setError('该记录缺少数据源信息，无法删除');
      return;
    }
    if (!window.confirm(`确定要删除 ${item.instance_name} / ${item.sync_date} 的数据吗？`)) return;
    setError('');
    try {
      await syncApi.clearRecord(item.data_source_id, item.instance_name, item.sync_date);
      loadHistory();
      loadStats();
      refreshFilterOptions();
    } catch (err: unknown) {
      const e = err as Error;
      setError('删除失败: ' + e.message);
    }
  }

  // 数据源管理
  function handleEditDs(item: DataSourceItem) {
    setEditingDs(item);
    setModalVisible(true);
  }

  function handleAddDs() {
    setEditingDs(null);
    setModalVisible(true);
  }

  function handleDsSaved() {
    loadDataSources();
  }

  function handleDsDeleted() {
    loadDataSources();
    loadHistory();
    loadStats();
  }

  // 数据源下拉选项（仅 enabled）
  const dsOptions = dataSources
    .filter((ds) => ds.enabled)
    .map((ds) => ({ value: String(ds.id), label: ds.name }));

  // 切换数据源时自动加载实例列表
  useEffect(() => {
    if (selectedDsId && canEnumerateInstances) {
      loadInstanceNames();
    } else if (selectedDsId) {
      loadLastInstance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDsId, canEnumerateInstances]);

  function handleDsChange(v: string) {
    const newId = v ? Number(v) : '' as const;
    setSelectedDsId(newId);
    setInstanceNames([]);
    setSelectedInstance('');
  }

  // Tab 配置
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'sync', label: '拉取数据' },
    { key: 'datasource', label: '数据源' },
    { key: 'schedule', label: '定时任务' },
  ];

  return (
    <div className="space-y-5">
      {/* ===== 上方区域：Tab 切换 ===== */}
      <div className="bg-white rounded-lg shadow-sm">
        {/* Tab 导航 */}
        <div className="flex border-b border-gray-100">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div className="p-5">
          {/* 拉取数据 */}
          {activeTab === 'sync' && (
            <div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
                  {/* 数据源 */}
                  <label className="text-sm text-gray-500 font-medium whitespace-nowrap justify-self-end">数据源</label>
                  <Select
                    value={selectedDsId ? String(selectedDsId) : ''}
                    onChange={handleDsChange}
                    placeholder="-- 请选择数据源 --"
                    options={[
                      { value: '', label: '-- 请选择数据源 --' },
                      ...dsOptions,
                    ]}
                    className="min-w-[160px] max-w-[280px]"
                  />

                  {/* 实例 */}
                  <label className="text-sm text-gray-500 font-medium whitespace-nowrap justify-self-end">实例</label>
                  <div className="flex gap-2 items-center">
                    {canEnumerateInstances ? (
                      <Select
                        value={selectedInstance}
                        onChange={setSelectedInstance}
                        placeholder={loadingInstances ? '加载中...' : '-- 请选择实例 --'}
                        options={[
                          { value: '', label: loadingInstances ? '加载中...' : '-- 请选择实例 --' },
                          ...instanceNames.map((name) => ({ value: name, label: name })),
                        ]}
                        className="min-w-[160px] max-w-[280px]"
                      />
                    ) : (
                      <input
                        type="text"
                        className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none min-w-[200px] max-w-[280px]"
                        value={selectedInstance}
                        onChange={(e) => setSelectedInstance(e.target.value)}
                        placeholder="输入实例名"
                      />
                    )}
                  </div>

                  {/* 日期范围 */}
                  <label className="text-sm text-gray-500 font-medium whitespace-nowrap justify-self-end">日期范围</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <DateRangeShortcuts
                      startDate={startDate}
                      endDate={endDate}
                      onChange={({ startDate: s, endDate: e }) => {
                        setStartDate(s);
                        setEndDate(e);
                        const today = formatDateHelper(new Date());
                        setForceOverwrite(s === today && e === today);
                      }}
                    />
                  </div>
                </div>

                {/* 操作栏 */}
                <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={forceOverwrite}
                      onChange={(e) => setForceOverwrite(e.target.checked)}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    <span>覆盖已拉取</span>
                  </label>
                  <Button variant="primary" onClick={handleSync} disabled={loading}>
                    {loading ? '拉取中...' : '开始拉取'}
                  </Button>
                </div>
              </div>

              {/* 错误信息 */}
              {error && (
                <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error}</div>
              )}

              {/* 同步结果 */}
              {syncResult && (
                <div className="mt-4 bg-green-50 border border-green-200 p-4 rounded-lg">
                  <h4 className="m-0 mb-2 text-green-700 text-sm font-semibold">同步结果</h4>
                  <p className="text-sm text-gray-700 mb-1">拉取记录数: <strong>{syncResult.totalRecords}</strong></p>
                  <p className="text-sm text-gray-700 mb-1">成功: {syncResult.syncedDates.length} 天</p>
                  {syncResult.skippedDates.length > 0 && (
                    <p className="text-sm text-gray-700 mb-1">跳过（已拉取）: {syncResult.skippedDates.length} 天 ({syncResult.skippedDates.join(', ')})</p>
                  )}
                  {syncResult.emptyDates.length > 0 && (
                    <p className="text-sm text-gray-700 mb-1">无数据: {syncResult.emptyDates.length} 天 ({syncResult.emptyDates.join(', ')})</p>
                  )}
                  {syncResult.errors.length > 0 && (
                    <div className="mt-2 text-red-600 text-sm">
                      <p className="mb-1">错误:</p>
                      <ul className="pl-4">
                        {syncResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 数据源管理 */}
          {activeTab === 'datasource' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">管理数据源连接配置，支持 Kibana 代理、直连 ES、Excel 导入等类型。</p>
                <Button variant="primary" size="sm" onClick={handleAddDs}>新增数据源</Button>
              </div>
              <DataSourceList dataSources={dataSources} onEdit={handleEditDs} onDeleted={handleDsDeleted} />
            </div>
          )}

          {/* 定时任务 */}
          {activeTab === 'schedule' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">配置定时自动同步任务，按指定间隔自动拉取慢查询数据。</p>
              <ScheduleTaskList dataSources={dataSources} onSynced={() => { loadHistory(); loadStats(); refreshFilterOptions(); }} />
            </div>
          )}
        </div>
      </div>

      {/* ===== 下方区域：同步历史 ===== */}
      <div className="bg-white p-5 rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">同步历史</h3>
          <div className="flex items-center gap-4">
            {dbStats && (
              <span className="text-xs text-gray-500">
                共 <strong className="text-gray-700">{dbStats.totalRecords}</strong> 条 · {dbStats.dbSize}
              </span>
            )}
            <Button variant="danger" size="sm" onClick={handleClearData}>清空所有</Button>
          </div>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-gray-400">暂无同步记录，请先拉取数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">数据源</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">实例</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">数据日期</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">记录数</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">同步时间</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">方式</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="px-3 py-2.5 text-sm">
                      {item.data_source_id ? (dsNameMap.get(item.data_source_id) || <span className="text-gray-400">已删除</span>) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm">{item.instance_name}</td>
                    <td className="px-3 py-2.5 text-sm" title={item.source_ref || ''}>
                      {item.sync_date}
                    </td>
                    <td className="px-3 py-2.5 text-sm">{item.record_count}</td>
                    <td className="px-3 py-2.5 text-sm">{new Date(item.synced_at).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-sm">
                      {item.trigger_type === 'scheduled' ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-600 rounded">定时</span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">手动</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm">
                      <Button variant="danger" size="sm" onClick={() => handleDeleteRecord(item)}>
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 数据源弹窗 */}
      <DataSourceModal
        key={modalVisible ? `modal-${editingDs?.id || 'new'}` : 'hidden'}
        visible={modalVisible}
        editItem={editingDs}
        types={types}
        onClose={() => { setModalVisible(false); setEditingDs(null); }}
        onSaved={handleDsSaved}
      />
    </div>
  );
}
