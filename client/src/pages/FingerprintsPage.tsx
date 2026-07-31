import React, { useState, useEffect, useRef, useCallback } from 'react';

import { fingerprintApi, groupApi } from '../api';
import type { FingerprintItem, FingerprintDetail, GroupedFingerprintItem, SimilarFingerprintItem, FingerprintGroup, GroupDetailResult } from '../api';
import { useQueryParams } from '../hooks/useQueryParams';
import { useDateRange } from '../contexts/DateRangeContext';
import Button from '../components/Button';
import ButtonGroup from '../components/ButtonGroup';
import {
  FingerprintDetailPanel,
  GroupDetailPanel,
  ClassifyModal,
  SqlDetailModal,
  formatTime,
} from '../components/fingerprints';

/** 模态框中展示的 SQL 信息 */
interface SqlModalData {
  sql: string;
  queryTime: number;
  rowsExamined: number;
  timestamp: number;
}

export default function FingerprintsPage() {
  const { startTime: sharedStartTime, endTime: sharedEndTime, setRange, dbName, instanceName } = useDateRange();

  // URL 参数同步
  const [queryParams, setQueryParams] = useQueryParams({
    startTime: String(sharedStartTime),
    endTime: String(sharedEndTime),
    sortBy: 'count',
    order: 'desc',
    page: '0',
    search: '',
    view: 'fingerprint',
  });

  const startTime = Number(queryParams.startTime) || 0;
  const endTime = Number(queryParams.endTime) || 0;
  const sortBy = queryParams.sortBy;
  const order = queryParams.order;
  const page = parseInt(queryParams.page) || 0;
  const search = queryParams.search;
  const viewMode = (queryParams.view as 'fingerprint' | 'grouped') || 'fingerprint';

  // 列表数据
  const [fingerprints, setFingerprints] = useState<FingerprintItem[]>([]);
  const [groupedItems, setGroupedItems] = useState<GroupedFingerprintItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSize = 15;

  // 挂载时：如果 URL 携带了时间参数且与全局不同，同步到全局 Context（顶部时间选择器）
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (startTime && endTime && (startTime !== sharedStartTime || endTime !== sharedEndTime)) {
        setRange(startTime, endTime);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 共享时间同步
  const prevSharedRef = useRef({ startTime: sharedStartTime, endTime: sharedEndTime });
  useEffect(() => {
    if (prevSharedRef.current.startTime !== sharedStartTime || prevSharedRef.current.endTime !== sharedEndTime) {
      prevSharedRef.current = { startTime: sharedStartTime, endTime: sharedEndTime };
      setQueryParams({ startTime: String(sharedStartTime), endTime: String(sharedEndTime), page: '0' });
    }
  }, [sharedStartTime, sharedEndTime]);

  // 全局筛选变化
  const prevFilterRef = useRef({ dbName, instanceName });
  useEffect(() => {
    if (prevFilterRef.current.dbName !== dbName || prevFilterRef.current.instanceName !== instanceName) {
      prevFilterRef.current = { dbName, instanceName };
      setQueryParams({ page: '0' });
    }
  }, [dbName, instanceName]);

  // 展开详情
  const [expandedFp, setExpandedFp] = useState<string | null>(null);
  const [detail, setDetail] = useState<FingerprintDetail | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [samplesPage, setSamplesPage] = useState(0);
  const samplesPageSize = 10;
  const [trendGranularity, setTrendGranularity] = useState<'minute' | 'hour' | 'day' | undefined>(undefined);

  // 模态框
  const [sqlModal, setSqlModal] = useState<SqlModalData | null>(null);

  // 归类操作
  const [classifyingFp, setClassifyingFp] = useState<string | null>(null);
  const [similarItems, setSimilarItems] = useState<SimilarFingerprintItem[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [selectedSimilar, setSelectedSimilar] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [existingGroups, setExistingGroups] = useState<FingerprintGroup[]>([]);
  const [selectedExistingGroupId, setSelectedExistingGroupId] = useState<number | null>(null);
  const [createMode, setCreateMode] = useState<'new' | 'existing'>('new');

  // 分类管理
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  // 已归类映射
  const [classifiedFingerprints, setClassifiedFingerprints] = useState<Map<string, string>>(new Map());
  const [groupMembersMap, setGroupMembersMap] = useState<Map<number, string[]>>(new Map());

  // 搜索防抖
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQueryParams({ search: value, page: '0' });
    }, 400);
  }, [setQueryParams]);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, groupsRes] = await Promise.all([
        fingerprintApi.getList({
          startTime, endTime, sortBy, order,
          limit: pageSize, offset: page * pageSize,
          search: search || undefined,
          dbName: dbName || undefined,
          instanceName: instanceName || undefined,
          view: viewMode,
        }),
        groupApi.getList(),
      ]);
      if (res.data.success) {
        if (viewMode === 'grouped') {
          setGroupedItems(res.data.data as GroupedFingerprintItem[]);
        } else {
          setFingerprints(res.data.data as FingerprintItem[]);
        }
        setTotal(res.data.total);
      }
      if (groupsRes.data.success) {
        const map = new Map<string, string>();
        const membersMap = new Map<number, string[]>();
        for (const g of groupsRes.data.data) {
          membersMap.set(g.id, g.fingerprints);
          for (const fp of g.fingerprints) {
            map.set(fp, g.name);
          }
        }
        setClassifiedFingerprints(map);
        setGroupMembersMap(membersMap);
      }
    } catch (err) {
      console.error('加载列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [startTime, endTime, sortBy, order, page, search, dbName, instanceName, viewMode]);

  useEffect(() => {
    if (startTime && endTime) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData]);

  // 时间/筛选条件变化时，自动刷新已展开的详情面板数据
  const prevDetailParamsRef = useRef({ startTime, endTime, dbName, instanceName });
  useEffect(() => {
    const prev = prevDetailParamsRef.current;
    if (prev.startTime === startTime && prev.endTime === endTime && prev.dbName === dbName && prev.instanceName === instanceName) return;
    prevDetailParamsRef.current = { startTime, endTime, dbName, instanceName };

    if (!expandedFp) return;

    // 重新加载当前展开的详情
    setDetailLoading(true);
    if (viewMode === 'grouped') {
      const currentGroup = groupedItems.find((item) => item.fingerprint === expandedFp);
      if (currentGroup?.groupId && groupMembersMap.has(currentGroup.groupId)) {
        const members = groupMembersMap.get(currentGroup.groupId)!;
        fingerprintApi.getGroupDetail(members, {
          startTime, endTime,
          dbName: dbName || undefined,
          instanceName: instanceName || undefined,
          trendGranularity: trendGranularity,
        }).then((res) => {
          if (res.data.success) setGroupDetail(res.data.data);
        }).catch((err) => console.error('刷新分组详情失败:', err))
          .finally(() => setDetailLoading(false));
      } else {
        setDetailLoading(false);
      }
    } else {
      setSamplesPage(0);
      fingerprintApi.getDetail(expandedFp, {
        startTime, endTime,
        dbName: dbName || undefined,
        instanceName: instanceName || undefined,
        samplesLimit: samplesPageSize, samplesOffset: 0,
        trendGranularity: trendGranularity,
      }).then((res) => {
        if (res.data.success) setDetail(res.data.data);
      }).catch((err) => console.error('刷新指纹详情失败:', err))
        .finally(() => setDetailLoading(false));
    }
  }, [startTime, endTime, dbName, instanceName, expandedFp, viewMode, groupedItems, groupMembersMap, trendGranularity]);

  function handleViewChange(newView: 'fingerprint' | 'grouped') {
    if (newView === viewMode) return;
    setExpandedFp(null);
    setDetail(null);
    setGroupDetail(null);
    setQueryParams({ view: newView, page: '0' });
  }

  async function toggleDetail(fp: string, groupId?: number | null) {
    if (expandedFp === fp) {
      setExpandedFp(null);
      setDetail(null);
      setGroupDetail(null);
      return;
    }
    setExpandedFp(fp);
    setSamplesPage(0);
    setTrendGranularity(undefined);
    setDetailLoading(true);
    setGroupDetail(null);
    setDetail(null);

    try {
      if (viewMode === 'grouped' && groupId && groupMembersMap.has(groupId)) {
        const members = groupMembersMap.get(groupId)!;
        const res = await fingerprintApi.getGroupDetail(members, {
          startTime, endTime,
          dbName: dbName || undefined,
          instanceName: instanceName || undefined,
        });
        if (res.data.success) setGroupDetail(res.data.data);
      } else {
        const res = await fingerprintApi.getDetail(fp, {
          startTime, endTime,
          dbName: dbName || undefined,
          instanceName: instanceName || undefined,
          samplesLimit: samplesPageSize, samplesOffset: 0,
        });
        if (res.data.success) setDetail(res.data.data);
      }
    } catch (err) {
      console.error('加载详情失败:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadSamplesPage(newPage: number) {
    if (!expandedFp) return;
    setSamplesPage(newPage);
    setDetailLoading(true);
    try {
      const res = await fingerprintApi.getDetail(expandedFp, {
        startTime, endTime,
        dbName: dbName || undefined,
        instanceName: instanceName || undefined,
        samplesLimit: samplesPageSize, samplesOffset: newPage * samplesPageSize,
        trendGranularity: trendGranularity,
      });
      if (res.data.success) setDetail(res.data.data);
    } catch (err) {
      console.error('加载原始 SQL 失败:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeTrendGranularity(newGranularity: 'minute' | 'hour' | 'day') {
    if (!expandedFp || newGranularity === trendGranularity) return;
    setTrendGranularity(newGranularity);
    try {
      const res = await fingerprintApi.getDetail(expandedFp, {
        startTime, endTime,
        dbName: dbName || undefined,
        instanceName: instanceName || undefined,
        samplesLimit: samplesPageSize, samplesOffset: samplesPage * samplesPageSize,
        trendGranularity: newGranularity,
      });
      if (res.data.success) setDetail(res.data.data);
    } catch (err) {
      console.error('切换粒度失败:', err);
    }
  }

  async function changeGroupTrendGranularity(newGranularity: 'minute' | 'hour' | 'day') {
    if (!expandedFp) return;
    // 找到当前展开的分组 ID
    const currentGroup = groupedItems.find((item) => item.fingerprint === expandedFp);
    if (!currentGroup?.groupId || !groupMembersMap.has(currentGroup.groupId)) return;

    const members = groupMembersMap.get(currentGroup.groupId)!;
    try {
      const res = await fingerprintApi.getGroupDetail(members, {
        startTime, endTime,
        dbName: dbName || undefined,
        instanceName: instanceName || undefined,
        trendGranularity: newGranularity,
      });
      if (res.data.success) setGroupDetail(res.data.data);
    } catch (err) {
      console.error('切换分组粒度失败:', err);
    }
  }

  function handleSort(field: string) {
    if (sortBy === field) {
      setQueryParams({ order: order === 'desc' ? 'asc' : 'desc', page: '0' });
    } else {
      setQueryParams({ sortBy: field, order: 'desc', page: '0' });
    }
  }

  function getSortIcon(field: string): string {
    if (sortBy !== field) return '↕';
    return order === 'desc' ? '↓' : '↑';
  }

  // 归类操作
  async function openClassifyPanel(fp: string, e: React.MouseEvent) {
    e.stopPropagation();
    setClassifyingFp(fp);
    setSelectedSimilar(new Set());
    setGroupName('');
    setCreateMode('new');
    setSelectedExistingGroupId(null);
    setSimilarLoading(true);
    try {
      const [similarRes, groupsRes] = await Promise.all([
        groupApi.getSimilar(fp, { startTime, endTime, dbName: dbName || undefined, instanceName: instanceName || undefined }),
        groupApi.getList(),
      ]);
      if (similarRes.data.success) setSimilarItems(similarRes.data.data);
      if (groupsRes.data.success) setExistingGroups(groupsRes.data.data);
    } catch (err) {
      console.error('加载推荐失败:', err);
    } finally {
      setSimilarLoading(false);
    }
  }

  async function confirmClassify() {
    if (!classifyingFp) return;
    const selectedFingerprints = [classifyingFp, ...selectedSimilar];
    try {
      if (createMode === 'new') {
        if (!groupName.trim()) return;
        await groupApi.create(groupName.trim(), selectedFingerprints);
      } else {
        if (!selectedExistingGroupId) return;
        await groupApi.addFingerprints(selectedExistingGroupId, selectedFingerprints);
      }
      setClassifyingFp(null);
      loadData();
    } catch (err) {
      console.error('归类操作失败:', err);
    }
  }

  function toggleSimilarSelection(fp: string) {
    setSelectedSimilar((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  }

  // 分类管理
  function startEditGroupName(groupId: number, currentName: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingGroupId(groupId);
    setEditingGroupName(currentName);
  }

  async function saveGroupName(e: React.MouseEvent) {
    e.stopPropagation();
    if (!editingGroupId || !editingGroupName.trim()) return;
    try {
      await groupApi.updateName(editingGroupId, editingGroupName.trim());
      setEditingGroupId(null);
      loadData();
    } catch (err) {
      console.error('修改分类名称失败:', err);
    }
  }

  async function handleDeleteGroup(groupId: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('确定要删除该分类吗？指纹将回归未归类状态。')) return;
    try {
      await groupApi.delete(groupId);
      loadData();
    } catch (err) {
      console.error('删除分类失败:', err);
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* 顶部操作栏 */}
      <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
        <ButtonGroup
          items={[
            { value: 'fingerprint', label: '按指纹' },
            { value: 'grouped', label: '按分类' },
          ]}
          value={viewMode}
          onChange={(v) => handleViewChange(v)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative inline-flex items-center">
            <input
              type="text"
              className="w-[220px] px-3 py-1.5 pr-7 border border-gray-200 rounded-md text-sm transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="搜索 SQL 关键词..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {searchInput && (
              <button
                className="absolute right-1.5 w-4.5 h-4.5 border-none bg-gray-300 text-white rounded-full text-xs flex items-center justify-center cursor-pointer hover:bg-gray-500"
                onClick={() => {
                  if (searchTimer.current) clearTimeout(searchTimer.current);
                  setSearchInput('');
                  setQueryParams({ search: '', page: '0' });
                }}
                title="清空搜索"
              >×</button>
            )}
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-16 text-gray-400">加载中...</div>}
      {!loading && total === 0 && (
        <div className="text-center py-10 text-gray-400 text-sm">暂无数据，请先到「数据管理」页拉取数据</div>
      )}

      {/* 指纹视图 */}
      {!loading && viewMode === 'fingerprint' && fingerprints.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-3.5 py-2.5 text-sm text-gray-500 border-b border-gray-100 bg-gray-50">
            共 <strong className="text-gray-900">{total}</strong> 类 SQL 指纹，当前展示第 <strong className="text-gray-900">{page * pageSize + 1}</strong>-<strong className="text-gray-900">{Math.min((page + 1) * pageSize, total)}</strong> 条
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-10 text-center">#</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-[45%]">SQL 指纹</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('count')}>频次 {getSortIcon('count')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('avg_time')}>平均耗时 {getSortIcon('avg_time')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('max_time')}>最大耗时 {getSortIcon('max_time')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('avg_rows')}>平均扫描行 {getSortIcon('avg_rows')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {fingerprints.map((item, index) => (
                <React.Fragment key={item.fingerprint}>
                  <tr
                    className={`cursor-pointer transition-colors border-b border-gray-100 hover:bg-primary/5 ${expandedFp === item.fingerprint ? 'bg-primary/5' : ''}`}
                    onClick={() => toggleDetail(item.fingerprint)}
                  >
                    <td className="px-3 py-3 text-center text-xs text-gray-400">{page * pageSize + index + 1}</td>
                    <td className="px-3 py-3" title={item.fingerprint}>
                      {classifiedFingerprints.has(item.fingerprint) && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] text-purple-600 bg-purple-50 border border-purple-200 mb-1">
                          {classifiedFingerprints.get(item.fingerprint)}
                        </span>
                      )}
                      <code className="font-mono text-xs text-gray-700 line-clamp-3 break-all leading-relaxed">{item.fingerprint}</code>
                    </td>
                    <td className={`px-3 py-3 font-mono text-sm whitespace-nowrap ${item.count >= 100 ? 'text-orange-600 font-semibold' : ''}`}>{item.count}</td>
                    <td className="px-3 py-3 font-mono text-sm whitespace-nowrap">{formatTime(item.avgQueryTime)}</td>
                    <td className={`px-3 py-3 font-mono text-sm whitespace-nowrap ${item.maxQueryTime >= 5 ? 'text-red-600 font-semibold' : ''}`}>{formatTime(item.maxQueryTime)}</td>
                    <td className="px-3 py-3 font-mono text-sm whitespace-nowrap">{Math.round(item.avgRowsExamined).toLocaleString()}</td>
                    <td className="px-3 py-3 text-center">
                      {classifiedFingerprints.has(item.fingerprint) ? (
                        <span className="inline-block px-2.5 py-1 rounded text-xs text-gray-300 bg-gray-50 border border-gray-200 cursor-default whitespace-nowrap">归类</span>
                      ) : (
                        <Button variant="primary" size="sm" onClick={(e) => openClassifyPanel(item.fingerprint, e)} title="归类">归类</Button>
                      )}
                    </td>
                  </tr>
                  {expandedFp === item.fingerprint && (
                    <tr key={item.fingerprint + '-detail'}>
                      <td colSpan={7} className="p-0 bg-gray-50 max-w-0 overflow-hidden">
                        {detail && <FingerprintDetailPanel detail={detail} fingerprint={item.fingerprint} startTime={startTime} endTime={endTime} detailLoading={detailLoading} samplesPage={samplesPage} samplesPageSize={samplesPageSize} onChangeTrendGranularity={changeTrendGranularity} onLoadSamplesPage={loadSamplesPage} onShowSqlModal={setSqlModal} />}
                        {detailLoading && !detail && <div className="py-5 text-center text-gray-400">加载详情中...</div>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 py-4 border-t border-gray-100">
              <Button variant="secondary" disabled={page === 0} onClick={() => setQueryParams({ page: String(page - 1) })}>上一页</Button>
              <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
              <Button variant="secondary" disabled={page >= totalPages - 1} onClick={() => setQueryParams({ page: String(page + 1) })}>下一页</Button>
            </div>
          )}
        </div>
      )}

      {/* 分类视图 */}
      {!loading && viewMode === 'grouped' && groupedItems.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-3.5 py-2.5 text-sm text-gray-500 border-b border-gray-100 bg-gray-50">
            共 <strong className="text-gray-900">{total}</strong> 个分类，当前展示第 <strong className="text-gray-900">{page * pageSize + 1}</strong>-<strong className="text-gray-900">{Math.min((page + 1) * pageSize, total)}</strong> 条
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-10 text-center">#</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-[45%]">分类 / 指纹</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('count')}>频次 {getSortIcon('count')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('avg_time')}>平均耗时 {getSortIcon('avg_time')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('max_time')}>最大耗时 {getSortIcon('max_time')}</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100" onClick={() => handleSort('avg_rows')}>平均扫描行 {getSortIcon('avg_rows')}</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0 w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {groupedItems.map((item, index) => (
                <React.Fragment key={item.groupId ? `g-${item.groupId}` : item.fingerprint}>
                  <tr
                    className={`cursor-pointer transition-colors border-b border-gray-100 hover:bg-primary/5 ${expandedFp === item.fingerprint ? 'bg-primary/5' : ''}`}
                    onClick={() => toggleDetail(item.fingerprint, item.groupId)}
                  >
                    <td className="px-3 py-3 text-center text-xs text-gray-400">{page * pageSize + index + 1}</td>
                    <td className="px-3 py-3">
                      {item.groupId ? (
                        <div>
                          {editingGroupId === item.groupId ? (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <input type="text" className="px-2 py-1 border border-primary rounded text-sm w-40 focus:outline-none" value={editingGroupName} onChange={(e) => setEditingGroupName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveGroupName(e as unknown as React.MouseEvent); if (e.key === 'Escape') setEditingGroupId(null); }} />
                              <Button variant="primary" size="sm" onClick={saveGroupName}>保存</Button>
                              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setEditingGroupId(null); }}>取消</Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-600 border border-purple-200 font-medium">{item.groupName}</span>
                              <span className="text-[11px] text-gray-400">({item.memberCount} 个指纹)</span>
                            </div>
                          )}
                          <code className="font-mono text-xs text-gray-500 line-clamp-2 break-all leading-relaxed mt-1 block">{item.sampleSql?.substring(0, 120)}...</code>
                        </div>
                      ) : (
                        <code className="font-mono text-xs text-gray-700 line-clamp-3 break-all leading-relaxed">{item.fingerprint}</code>
                      )}
                    </td>
                    <td className={`px-3 py-3 font-mono text-sm whitespace-nowrap ${item.count >= 100 ? 'text-orange-600 font-semibold' : ''}`}>{item.count}</td>
                    <td className="px-3 py-3 font-mono text-sm whitespace-nowrap">{formatTime(item.avgQueryTime)}</td>
                    <td className={`px-3 py-3 font-mono text-sm whitespace-nowrap ${item.maxQueryTime >= 5 ? 'text-red-600 font-semibold' : ''}`}>{formatTime(item.maxQueryTime)}</td>
                    <td className="px-3 py-3 font-mono text-sm whitespace-nowrap">{Math.round(item.avgRowsExamined).toLocaleString()}</td>
                    <td className="px-3 py-3 text-center">
                      {item.groupId && (
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="secondary" size="sm" onClick={(e) => startEditGroupName(item.groupId!, item.groupName!, e)} title="编辑名称">编辑</Button>
                          <Button variant="danger" size="sm" onClick={(e) => handleDeleteGroup(item.groupId!, e)} title="删除分类">删除</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedFp === item.fingerprint && (
                    <tr key={(item.groupId ? `g-${item.groupId}` : item.fingerprint) + '-detail'}>
                      <td colSpan={7} className="p-0 bg-gray-50 max-w-0 overflow-hidden">
                        {groupDetail && <GroupDetailPanel groupDetail={groupDetail} groupId={item.groupId!} startTime={startTime} endTime={endTime} detailLoading={detailLoading} onChangeTrendGranularity={changeGroupTrendGranularity} onShowSqlModal={setSqlModal} />}
                        {detailLoading && !groupDetail && <div className="py-5 text-center text-gray-400">加载详情中...</div>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 py-4 border-t border-gray-100">
              <Button variant="secondary" disabled={page === 0} onClick={() => setQueryParams({ page: String(page - 1) })}>上一页</Button>
              <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
              <Button variant="secondary" disabled={page >= totalPages - 1} onClick={() => setQueryParams({ page: String(page + 1) })}>下一页</Button>
            </div>
          )}
        </div>
      )}

      {/* 归类模态框 */}
      {classifyingFp && (
        <ClassifyModal
          classifyingFp={classifyingFp}
          similarItems={similarItems}
          similarLoading={similarLoading}
          selectedSimilar={selectedSimilar}
          groupName={groupName}
          existingGroups={existingGroups}
          selectedExistingGroupId={selectedExistingGroupId}
          createMode={createMode}
          onClose={() => setClassifyingFp(null)}
          onToggleSimilar={toggleSimilarSelection}
          onSetGroupName={setGroupName}
          onSetCreateMode={setCreateMode}
          onSetExistingGroupId={setSelectedExistingGroupId}
          onConfirm={confirmClassify}
        />
      )}

      {/* SQL 详情模态框 */}
      {sqlModal && <SqlDetailModal data={sqlModal} onClose={() => setSqlModal(null)} />}
    </div>
  );
}
