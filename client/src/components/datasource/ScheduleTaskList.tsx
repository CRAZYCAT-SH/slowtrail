/**
 * 定时任务列表组件
 * 展示所有定时同步任务，支持新增、编辑、删除、立即触发
 */

import { useState, useEffect } from 'react';
import type { ScheduleTaskItem, ScheduleTaskInput, DataSourceItem } from '../../api';
import { scheduleApi, dataSourceApi, syncApi } from '../../api';
import type { SyncResult } from '../../api';
import Button from '../Button';
import Select from '../Select';

/** 间隔选项 */
const INTERVAL_OPTIONS = [
  { value: '10', label: '每 10 分钟' },
  { value: '30', label: '每 30 分钟' },
  { value: '60', label: '每小时' },
  { value: '120', label: '每 2 小时' },
  { value: '360', label: '每 6 小时' },
  { value: '720', label: '每 12 小时' },
  { value: '1440', label: '每天' },
];

const DAYS_OPTIONS = [
  { value: '0', label: '仅今天' },
  { value: '1', label: '今天 + 昨天' },
  { value: '2', label: '今天 + 前 2 天' },
  { value: '3', label: '今天 + 前 3 天' },
  { value: '7', label: '今天 + 前 7 天' },
];

function formatInterval(minutes: number): string {
  if (minutes < 60) return `每 ${minutes} 分钟`;
  if (minutes === 60) return '每小时';
  if (minutes < 1440) return `每 ${minutes / 60} 小时`;
  if (minutes === 1440) return '每天';
  return `每 ${(minutes / 1440).toFixed(1)} 天`;
}

function formatNextRun(nextAt: number | null): string {
  if (!nextAt) return '-';
  const now = Date.now();
  const diff = nextAt - now;
  if (diff <= 0) return '即将执行';
  if (diff < 60 * 1000) return `${Math.ceil(diff / 1000)}秒后`;
  if (diff < 60 * 60 * 1000) return `${Math.ceil(diff / 60000)}分钟后`;
  const h = Math.floor(diff / 3600000);
  const m = Math.ceil((diff % 3600000) / 60000);
  if (diff < 24 * 60 * 60 * 1000) return m > 0 ? `${h}小时${m}分后` : `${h}小时后`;
  const date = new Date(nextAt);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateHelper(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface Props {
  dataSources: DataSourceItem[];
  onSynced?: () => void; // 同步完成后回调（刷新历史等）
  /** 紧凑模式：适用于侧栏窄空间 */
  compact?: boolean;
}

export default function ScheduleTaskList({ dataSources, onSynced, compact }: Props) {
  const [tasks, setTasks] = useState<ScheduleTaskItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduleTaskItem | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');

  // 表单状态
  const [formDsId, setFormDsId] = useState<number | ''>('');
  const [formInstance, setFormInstance] = useState('');
  const [formInterval, setFormInterval] = useState(60);
  const [formDaysOffset, setFormDaysOffset] = useState(0);
  const [formEnabled, setFormEnabled] = useState(true);
  const [instanceOptions, setInstanceOptions] = useState<string[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      const res = await scheduleApi.getList();
      if (res.data.success) {
        setTasks(res.data.data);
      }
    } catch { /* 静默 */ }
  }

  function openAddForm() {
    setEditingTask(null);
    const defaultDs = dataSources.find((ds) => ds.enabled);
    setFormDsId(defaultDs?.id || '');
    setFormInstance('');
    setFormInterval(60);
    setFormDaysOffset(0);
    setFormEnabled(true);
    setInstanceOptions([]);
    setShowForm(true);
    if (defaultDs?.capabilities.instanceEnumeration) {
      loadInstanceNames(defaultDs.id);
    }
  }

  function openEditForm(task: ScheduleTaskItem) {
    setEditingTask(task);
    setFormDsId(task.dataSourceId);
    setFormInstance(task.instanceName);
    setFormInterval(task.intervalMinutes);
    setFormDaysOffset(task.daysOffset);
    setFormEnabled(task.enabled);
    setShowForm(true);
    // 加载实例列表
    const ds = dataSources.find((d) => d.id === task.dataSourceId);
    if (ds?.capabilities.instanceEnumeration) {
      loadInstanceNames(ds.id);
    } else {
      setInstanceOptions([]);
    }
  }

  async function loadInstanceNames(dsId: number) {
    setLoadingInstances(true);
    try {
      const res = await dataSourceApi.getInstanceNames(dsId);
      if (res.data.success) {
        setInstanceOptions(res.data.data);
      }
    } catch { /* 静默 */ }
    finally { setLoadingInstances(false); }
  }

  function handleDsChange(v: string) {
    const id = Number(v);
    setFormDsId(id || '');
    setFormInstance('');
    setInstanceOptions([]);
    if (id) {
      const ds = dataSources.find((d) => d.id === id);
      if (ds?.capabilities.instanceEnumeration) {
        loadInstanceNames(id);
      }
    }
  }

  async function handleSave() {
    if (!formDsId) { setError('请选择数据源'); return; }
    if (!formInstance.trim()) { setError('请输入实例名'); return; }
    setSaving(true);
    setError('');
    try {
      const input: ScheduleTaskInput = {
        dataSourceId: formDsId as number,
        instanceName: formInstance.trim(),
        enabled: formEnabled,
        intervalMinutes: formInterval,
        daysOffset: formDaysOffset,
      };
      if (editingTask) {
        await scheduleApi.update(editingTask.id, input);
      } else {
        await scheduleApi.create(input);
      }
      setShowForm(false);
      loadTasks();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('确认删除该定时任务？')) return;
    try {
      await scheduleApi.remove(id);
      loadTasks();
    } catch { /* 静默 */ }
  }

  async function handleTrigger(task: ScheduleTaskItem) {
    setTriggeringId(task.id);
    setError('');
    setSyncResult(null);
    try {
      // 直接调用同步 API（和手动拉取效果一致）
      const today = new Date();
      const endDateObj = new Date(today);
      const startDateObj = new Date(today);
      startDateObj.setDate(startDateObj.getDate() - task.daysOffset);

      const res = await syncApi.sync({
        dataSourceId: task.dataSourceId,
        instanceName: task.instanceName,
        startDate: formatDateHelper(startDateObj),
        endDate: formatDateHelper(endDateObj),
        forceOverwrite: true,
      });
      if (res.data.success) {
        setSyncResult(res.data.data);
        loadTasks(); // 刷新 lastRunAt
        onSynced?.();
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || '同步失败');
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleToggle(task: ScheduleTaskItem) {
    try {
      await scheduleApi.update(task.id, { enabled: !task.enabled });
      loadTasks();
    } catch { /* 静默 */ }
  }

  const enabledDsOptions = dataSources
    .filter((ds) => ds.enabled && ds.type !== 'excel')
    .map((ds) => ({ value: String(ds.id), label: ds.name }));

  return (
    <div className="space-y-3">
      {/* 任务列表 */}
      {tasks.length === 0 && !showForm && (
        <p className="text-sm text-gray-400">暂无定时任务</p>
      )}

      {tasks.map((task) => (
        <div key={task.id} className={`rounded-lg border border-gray-100 bg-gray-50/50 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`font-medium text-gray-900 truncate ${compact ? 'text-xs' : 'text-sm'}`}>{task.dataSourceName}</span>
                <span className="text-[11px] text-gray-500">/ {task.instanceName}</span>
                {task.enabled ? (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-600 rounded">运行中</span>
                ) : (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-400 rounded">暂停</span>
                )}
                {task.running && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-600 rounded">同步中</span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {formatInterval(task.intervalMinutes)} · 回溯 {task.daysOffset} 天
                {task.enabled && task.nextRunAt && <span className="ml-2">下次: {formatNextRun(task.nextRunAt)}</span>}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="secondary" onClick={() => handleTrigger(task)} disabled={triggeringId === task.id}>
                {triggeringId === task.id ? '...' : '同步'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleToggle(task)}>
                {task.enabled ? '暂停' : '启用'}
              </Button>
              {!compact && (
                <Button size="sm" variant="secondary" onClick={() => openEditForm(task)}>编辑</Button>
              )}
              {compact ? (
                <Button size="sm" variant="secondary" onClick={() => openEditForm(task)}>编辑</Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => handleDelete(task.id)}>删除</Button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* 同步结果提示 */}
      {syncResult && (
        <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-md text-green-700 text-xs">
          同步完成: {syncResult.totalRecords} 条记录，{syncResult.syncedDates.length} 天
        </div>
      )}
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-red-600 text-xs">
          {error}
        </div>
      )}

      {/* 新增/编辑表单（内联展开） */}
      {showForm && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <h4 className="text-sm font-semibold text-gray-900">
            {editingTask ? '编辑定时任务' : '新增定时任务'}
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">数据源 <span className="text-red-400">*</span></label>
              <Select
                value={String(formDsId)}
                onChange={handleDsChange}
                options={[{ value: '', label: '请选择' }, ...enabledDsOptions]}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">实例名 <span className="text-red-400">*</span></label>
              {instanceOptions.length > 0 ? (
                <Select
                  value={formInstance}
                  onChange={setFormInstance}
                  options={[{ value: '', label: '请选择实例' }, ...instanceOptions.map((n) => ({ value: n, label: n }))]}
                  className="w-full"
                />
              ) : (
                <input
                  type="text"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:border-primary/50 focus:outline-none"
                  value={formInstance}
                  onChange={(e) => setFormInstance(e.target.value)}
                  placeholder={loadingInstances ? '加载中...' : '输入实例名'}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">同步间隔</label>
              <Select
                value={String(formInterval)}
                onChange={(v) => setFormInterval(Number(v))}
                options={INTERVAL_OPTIONS}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">同步范围</label>
              <Select
                value={String(formDaysOffset)}
                onChange={(v) => setFormDaysOffset(Number(v))}
                options={DAYS_OPTIONS}
                className="w-full"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formEnabled}
              onChange={(e) => setFormEnabled(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            立即启用
          </label>

          <div className="flex justify-end gap-2">
            {compact && editingTask && (
              <Button variant="danger" size="sm" onClick={() => { handleDelete(editingTask.id); setShowForm(false); }} className="mr-auto">删除</Button>
            )}
            <Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      )}

      {/* 新增按钮 */}
      {!showForm && (
        <Button variant="primary" size="sm" onClick={openAddForm}>
          {compact ? '新增' : '新增定时任务'}
        </Button>
      )}
    </div>
  );
}
