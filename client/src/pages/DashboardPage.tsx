import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { statsApi, fingerprintApi } from '../api';
import type {
  StatsOverviewWithCompare, StatsDistribution,
  HeatmapPoint, TrendPoint, FingerprintItem, QueryFilter,
} from '../api';
import HeatmapChart from '../components/HeatmapChart';
import ButtonGroup from '../components/ButtonGroup';
import Select from '../components/Select';
import { useDateRange } from '../contexts/DateRangeContext';

// 饼图颜色
const PIE_COLORS = ['#6c63ff', '#52c41a', '#faad14', '#13c2c2', '#eb2f96', '#999'];

// 直方图颜色（按耗时严重程度渐变）
const BAR_COLORS = ['#52c41a', '#95de64', '#fadb14', '#ffa940', '#ff4d4f', '#a8071a'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { startTime, endTime, dbName, instanceName } = useDateRange();

  // 数据状态
  const [overview, setOverview] = useState<StatsOverviewWithCompare | null>(null);
  const [distribution, setDistribution] = useState<StatsDistribution | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [currentTrends, setCurrentTrends] = useState<TrendPoint[]>([]);
  const [compareTrends, setCompareTrends] = useState<TrendPoint[]>([]);
  const [topFingerprints, setTopFingerprints] = useState<FingerprintItem[]>([]);
  const [fpSortBy, setFpSortBy] = useState('total_time');

  // 加载状态
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [distributionLoading, setDistributionLoading] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);

  // 维度饼图切换
  const [dimensionTab, setDimensionTab] = useState<'database' | 'instance'>('database');

  // 计算环比时间范围（等长前移，上期不含本期起点）
  const duration = endTime - startTime;
  const compareStartTime = startTime - duration;
  const compareEndTime = startTime - 1;

  // 根据时间范围自动选择趋势粒度
  const granularity: 'minute' | 'hour' | 'day' = duration <= 86400000 ? 'hour' : 'day';

  const filter: QueryFilter = {
    startTime, endTime,
    dbName: dbName || undefined,
    instanceName: instanceName || undefined,
  };

  // 加载概览数据
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await statsApi.getOverview({
        ...filter,
        compareStartTime,
        compareEndTime,
      });
      if (res.data.success) setOverview(res.data.data);
    } catch (err) {
      console.error('加载概览失败:', err);
    } finally {
      setOverviewLoading(false);
    }
  }, [startTime, endTime, dbName, instanceName]);

  // 加载分布数据
  const loadDistribution = useCallback(async () => {
    setDistributionLoading(true);
    try {
      const res = await statsApi.getDistribution(filter);
      if (res.data.success) setDistribution(res.data.data);
    } catch (err) {
      console.error('加载分布数据失败:', err);
    } finally {
      setDistributionLoading(false);
    }
  }, [startTime, endTime, dbName, instanceName]);

  // 加载热力图
  const loadHeatmap = useCallback(async () => {
    setHeatmapLoading(true);
    try {
      const res = await statsApi.getHeatmap(filter);
      if (res.data.success) setHeatmapData(res.data.data);
    } catch (err) {
      console.error('加载热力图失败:', err);
    } finally {
      setHeatmapLoading(false);
    }
  }, [startTime, endTime, dbName, instanceName]);

  // 加载趋势数据（本期 + 上期）
  const loadTrends = useCallback(async () => {
    setTrendsLoading(true);
    try {
      const [currentRes, compareRes] = await Promise.all([
        statsApi.getTrends({ ...filter, granularity }),
        statsApi.getTrends({
          startTime: compareStartTime,
          endTime: compareEndTime,
          dbName: dbName || undefined,
          instanceName: instanceName || undefined,
          granularity,
        }),
      ]);
      if (currentRes.data.success) setCurrentTrends(currentRes.data.data);
      if (compareRes.data.success) setCompareTrends(compareRes.data.data);
    } catch (err) {
      console.error('加载趋势失败:', err);
    } finally {
      setTrendsLoading(false);
    }
  }, [startTime, endTime, dbName, instanceName]);

  // 加载 TOP 指纹
  const loadTopFingerprints = useCallback(async () => {
    setFpLoading(true);
    try {
      const res = await fingerprintApi.getList({
        ...filter,
        sortBy: fpSortBy,
        order: 'desc',
        limit: 10,
        offset: 0,
      });
      if (res.data.success) setTopFingerprints(res.data.data);
    } catch (err) {
      console.error('加载指纹排行失败:', err);
    } finally {
      setFpLoading(false);
    }
  }, [startTime, endTime, dbName, instanceName, fpSortBy]);

  // 数据加载
  useEffect(() => {
    if (startTime && endTime) {
      loadOverview();
      loadDistribution();
      loadHeatmap();
      loadTrends();
    }
  }, [startTime, endTime, dbName, instanceName]);

  useEffect(() => {
    if (startTime && endTime) {
      loadTopFingerprints();
    }
  }, [startTime, endTime, dbName, instanceName, fpSortBy]);

  // 格式化函数
  function formatTime(seconds: number): string {
    if (seconds >= 3600) return (seconds / 3600).toFixed(1) + 'h';
    if (seconds >= 60) return (seconds / 60).toFixed(1) + 'min';
    if (seconds >= 1) return seconds.toFixed(2) + 's';
    return (seconds * 1000).toFixed(1) + 'ms';
  }

  function formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  /** 计算环比变化率 */
  function getChangeRate(current: number, compare: number | undefined): { rate: string; direction: 'up' | 'down' | 'flat' | 'na' } {
    if (compare == null || compare === 0) {
      if (current === 0) return { rate: '-', direction: 'flat' };
      return { rate: 'N/A', direction: 'na' };
    }
    const change = ((current - compare) / compare) * 100;
    if (Math.abs(change) < 0.1) return { rate: '0%', direction: 'flat' };
    const direction = change > 0 ? 'up' : 'down';
    return { rate: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, direction };
  }

  // 构建趋势对比图数据（按序号对齐）
  // X 轴以本期数据点为基准，上期数据按相同序号对位
  function buildTrendCompareData() {
    const maxLen = Math.max(currentTrends.length, compareTrends.length);
    const data: Array<{
      index: number;
      currentCount: number | null;
      compareCount: number | null;
      currentLabel: string;
      compareLabel: string;
      xLabel: string;
    }> = [];

    for (let i = 0; i < maxLen; i++) {
      const current = currentTrends[i] || null;
      const compare = compareTrends[i] || null;

      // X 轴标签优先取本期时间，没有就取上期偏移后的时间
      let xLabel = '';
      if (current) {
        const d = new Date(current.time);
        xLabel = granularity === 'hour'
          ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
          : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else if (compare) {
        const d = new Date(compare.time + duration);
        xLabel = granularity === 'hour'
          ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
          : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      data.push({
        index: i,
        currentCount: current ? current.count : null,
        compareCount: compare ? compare.count : null,
        currentLabel: current ? new Date(current.time).toLocaleString() : '',
        compareLabel: compare ? new Date(compare.time).toLocaleString() : '',
        xLabel,
      });
    }
    return data;
  }

  // 处理饼图数据（超过5个合并为"其他"）
  function preparePieData(items: Array<{ name: string; count: number }>) {
    if (items.length <= 5) return items;
    const top5 = items.slice(0, 5);
    const othersCount = items.slice(5).reduce((sum, item) => sum + item.count, 0);
    return [...top5, { name: '其他', count: othersCount }];
  }

  const trendCompareData = buildTrendCompareData();
  const pieData = dimensionTab === 'database'
    ? preparePieData(distribution?.byDatabase || [])
    : preparePieData(distribution?.byInstance || []);
  const pieTotal = pieData.reduce((sum, item) => sum + item.count, 0);

  return (
    <div>
      {/* 统计卡片区 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5 mb-6">
        {overviewLoading && <div className="col-span-full text-center py-5 text-gray-400">加载中...</div>}
        {!overviewLoading && overview && (
          <>
            {renderStatCard('总查询数', formatNumber(overview.current.totalCount), getChangeRate(overview.current.totalCount, overview.compare?.totalCount))}
            {renderStatCard('总耗时', formatTime(overview.current.totalQueryTime), getChangeRate(overview.current.totalQueryTime, overview.compare?.totalQueryTime))}
            {renderStatCard('平均耗时', formatTime(overview.current.avgQueryTime), getChangeRate(overview.current.avgQueryTime, overview.compare?.avgQueryTime))}
            {renderStatCard('最大耗时', formatTime(overview.current.maxQueryTime), getChangeRate(overview.current.maxQueryTime, overview.compare?.maxQueryTime))}
            {renderStatCard('平均扫描行数', formatNumber(overview.current.avgRowsExamined), getChangeRate(overview.current.avgRowsExamined, overview.compare?.avgRowsExamined))}
            {renderStatCard('平均锁等待', formatTime(overview.current.avgLockTime), getChangeRate(overview.current.avgLockTime, overview.compare?.avgLockTime))}
          </>
        )}
      </div>

      {/* 图表区域 - 两列布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* 趋势对比图 */}
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-1">慢 SQL 趋势对比</h3>
          <p className="text-[11px] text-gray-400 mb-3">实线: 本期 / 虚线: 上期</p>
          {trendsLoading ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">加载中...</div>
          ) : trendCompareData.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendCompareData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="xLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => {
                    const label = name === 'currentCount' ? '本期' : '上期';
                    return [value != null ? `${value} 条` : '-', label];
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={(_label: any, payload: any) => {
                    if (!payload || payload.length === 0) return '';
                    const item = payload[0]?.payload;
                    if (!item) return '';
                    const parts: string[] = [];
                    if (item.currentLabel) parts.push(`本期: ${item.currentLabel}`);
                    if (item.compareLabel) parts.push(`上期: ${item.compareLabel}`);
                    return parts.join(' | ');
                  }}
                />
                <Legend formatter={(value) => value === 'currentCount' ? '本期' : '上期'} />
                <Line type="monotone" dataKey="currentCount" stroke="#6c63ff" strokeWidth={2} dot={trendCompareData.length <= 30 ? { r: 3 } : false} connectNulls name="currentCount" />
                <Line type="monotone" dataKey="compareCount" stroke="#bbb" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls name="compareCount" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 耗时分布直方图 */}
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">耗时分布</h3>
          {distributionLoading ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">加载中...</div>
          ) : !distribution || distribution.timeRanges.every((r) => r.count === 0) ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distribution.timeRanges} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any) => [`${value} 条`, '数量']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distribution.timeRanges.map((_, index) => (
                    <Cell key={index} fill={BAR_COLORS[index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 维度分布饼图 */}
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-[15px] font-semibold text-gray-900 m-0">维度分布</h3>
            <ButtonGroup
              size="sm"
              items={[
                { value: 'database', label: '按数据库' },
                { value: 'instance', label: '按实例' },
              ]}
              value={dimensionTab}
              onChange={setDimensionTab}
            />
          </div>
          {distributionLoading ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">加载中...</div>
          ) : pieData.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ strokeWidth: 1 }}
                >
                  {pieData.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => [
                    `${value} 条 (${pieTotal > 0 ? ((Number(value) / pieTotal) * 100).toFixed(1) : 0}%)`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 7×24 热力图 */}
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-1">时段分布热力图</h3>
          <p className="text-[11px] text-gray-400 mb-3">按星期 × 小时聚合慢 SQL 数量</p>
          {heatmapLoading ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">加载中...</div>
          ) : heatmapData.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">暂无数据</div>
          ) : (
            <HeatmapChart data={heatmapData} />
          )}
        </div>
      </div>

      {/* 高影响力 SQL 指纹 TOP 10 */}
      <div className="bg-white p-5 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold text-gray-900 m-0">高影响力 SQL TOP 10</h2>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-500">排序:</label>
            <Select
              value={fpSortBy}
              onChange={setFpSortBy}
              size="sm"
              options={[
                { value: 'total_time', label: '总耗时' },
                { value: 'count', label: '频次' },
                { value: 'avg_time', label: '平均耗时' },
                { value: 'max_time', label: '最大耗时' },
              ]}
            />
          </div>
        </div>

        {fpLoading && <div className="text-center py-8 text-gray-400">加载中...</div>}

        {!fpLoading && topFingerprints.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">暂无数据，请先到「数据管理」页拉取数据</div>
        )}

        {!fpLoading && topFingerprints.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 w-9">#</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50 w-[45%]">SQL 指纹</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50">频次</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50">总耗时</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50">平均耗时</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 bg-gray-50">最大耗时</th>
              </tr>
            </thead>
            <tbody>
              {topFingerprints.map((item, index) => (
                <tr
                  key={item.fingerprint}
                  className="cursor-pointer transition-colors hover:bg-primary/5 border-b border-gray-100"
                  onClick={() => navigate(`/fingerprints?search=${encodeURIComponent(item.fingerprint.slice(0, 50))}&startTime=${startTime}&endTime=${endTime}`)}
                >
                  <td className="px-3 py-2.5 text-center text-xs text-gray-400">{index + 1}</td>
                  <td className="px-3 py-2.5 max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.fingerprint}>
                    <code className="font-mono text-xs text-gray-700">{item.fingerprint}</code>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{item.count}</td>
                  <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{formatTime(item.totalQueryTime)}</td>
                  <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{formatTime(item.avgQueryTime)}</td>
                  <td className="px-3 py-2.5 font-mono text-sm whitespace-nowrap">{formatTime(item.maxQueryTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  /** 渲染单个统计卡片 */
  function renderStatCard(
    label: string,
    value: string,
    change: { rate: string; direction: 'up' | 'down' | 'flat' | 'na' }
  ) {
    const changeColor = change.direction === 'up' ? 'text-red-500' : change.direction === 'down' ? 'text-green-500' : 'text-gray-400';
    return (
      <div className="bg-white p-4 rounded-lg shadow-sm text-center transition-shadow hover:shadow-md">
        <div className="text-2xl font-bold text-primary mb-1">{value}</div>
        <div className="text-xs text-gray-500 mb-1.5">{label}</div>
        <div className={`text-xs font-medium ${changeColor}`}>
          {change.direction === 'up' && '↑'}
          {change.direction === 'down' && '↓'}
          {change.rate}
        </div>
      </div>
    );
  }
}
