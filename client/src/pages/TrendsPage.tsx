import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { statsApi, groupApi } from '../api';
import type { TrendPoint } from '../api';
import { useDateRange } from '../contexts/DateRangeContext';
import Button from '../components/Button';
import ButtonGroup from '../components/ButtonGroup';

export default function TrendsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { startTime: globalStartTime, endTime: globalEndTime, setRange, dbName, instanceName } = useDateRange();

  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [fingerprint, setFingerprint] = useState(() => searchParams.get('fingerprint') || '');
  const [groupId] = useState(() => searchParams.get('groupId') || '');
  const [groupName, setGroupName] = useState('');
  const [granularity, setGranularity] = useState<'minute' | 'hour' | 'day'>(() => {
    return (searchParams.get('granularity') as 'minute' | 'hour' | 'day') || 'hour';
  });
  const navigate = useNavigate();

  // 确定实际使用的时间范围：
  // - 如果 URL 带了时间参数，使用 URL 时间
  // - 否则使用全局 Context 时间
  const urlStartTime = searchParams.get('startTime');
  const urlEndTime = searchParams.get('endTime');

  const startTime = urlStartTime ? Number(urlStartTime) : globalStartTime;
  const endTime = urlEndTime ? Number(urlEndTime) : globalEndTime;

  // 挂载时：如果 URL 携带了时间参数且与全局不同，同步到全局 Context（顶部时间选择器）
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (urlStartTime && urlEndTime) {
        const s = Number(urlStartTime);
        const e = Number(urlEndTime);
        if (s && e && (s !== globalStartTime || e !== globalEndTime)) {
          setRange(s, e);
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 当全局时间变化时（用户通过导航栏修改），清除 URL 中的时间参数以切换到全局时间
  const prevGlobalRef = useRef({ startTime: globalStartTime, endTime: globalEndTime });
  useEffect(() => {
    const prev = prevGlobalRef.current;
    if (prev.startTime !== globalStartTime || prev.endTime !== globalEndTime) {
      prevGlobalRef.current = { startTime: globalStartTime, endTime: globalEndTime };
      // 全局时间发生了变化，清除 URL 时间参数
      if (urlStartTime || urlEndTime) {
        setSearchParams((p) => {
          const next = new URLSearchParams(p);
          next.delete('startTime');
          next.delete('endTime');
          return next;
        }, { replace: true });
      }
    }
  }, [globalStartTime, globalEndTime, urlStartTime, urlEndTime, setSearchParams]);

  const loadTrends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await statsApi.getTrends({
        startTime, endTime, granularity,
        fingerprint: fingerprint || undefined,
        groupId: groupId ? Number(groupId) : undefined,
        dbName: dbName || undefined,
        instanceName: instanceName || undefined,
      });
      if (res.data.success) {
        setTrends(res.data.data);
      }
    } catch (err) {
      console.error('加载趋势数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, [startTime, endTime, granularity, fingerprint, groupId, dbName, instanceName]);

  useEffect(() => {
    if (startTime && endTime) {
      loadTrends();
    }
  }, [loadTrends]);

  // 加载分组名称
  useEffect(() => {
    if (groupId) {
      groupApi.getList().then((res) => {
        if (res.data.success) {
          const group = res.data.data.find((g) => g.id === Number(groupId));
          if (group) setGroupName(group.name);
        }
      });
    }
  }, [groupId]);

  // 格式化 X 轴时间标签
  function formatXLabel(ts: number): string {
    const d = new Date(ts);
    if (granularity === 'minute') {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (granularity === 'hour') {
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Tooltip 完整时间格式化
  function formatTooltipLabel(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  // 根据时间点生成跳转到 SQL 归类页的 URL
  function getFingerprintUrl(ts: number): string {
    let clickStart: number;
    let clickEnd: number;

    if (granularity === 'minute') {
      clickStart = ts;
      clickEnd = ts + 60000;
    } else if (granularity === 'hour') {
      clickStart = ts;
      clickEnd = ts + 3600000;
    } else {
      clickStart = ts;
      clickEnd = ts + 86400000;
    }

    const params = new URLSearchParams({
      startTime: String(clickStart),
      endTime: String(clickEnd),
    });
    if (fingerprint) {
      params.set('search', fingerprint.slice(0, 50));
    }
    return `/fingerprints?${params.toString()}`;
  }

  // Tooltip 位置锁定到数据点坐标
  const [tooltipPos1, setTooltipPos1] = useState<{ x: number; y: number } | undefined>(undefined);
  const [tooltipPos2, setTooltipPos2] = useState<{ x: number; y: number } | undefined>(undefined);
  const lastIndex1 = useRef<number | undefined>(undefined);
  const lastIndex2 = useRef<number | undefined>(undefined);
  const tooltipLocked1 = useRef(false);
  const tooltipLocked2 = useRef(false);
  const [lockedData1, setLockedData1] = useState<{ payload: unknown[]; label: string } | null>(null);
  const [lockedData2, setLockedData2] = useState<{ payload: unknown[]; label: string } | null>(null);
  const lastValidData1 = useRef<{ payload: unknown[]; label: string } | null>(null);
  const lastValidData2 = useRef<{ payload: unknown[]; label: string } | null>(null);
  const chartHovered1 = useRef(false);
  const chartHovered2 = useRef(false);
  const hideTimer1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseLeave1() {
    chartHovered1.current = false;
    hideTimer1.current = setTimeout(() => {
      if (!tooltipLocked1.current && !chartHovered1.current) {
        lastValidData1.current = null;
        setLockedData1(null);
        setTooltipPos1(undefined);
      }
    }, 150);
  }

  function handleMouseLeave2() {
    chartHovered2.current = false;
    hideTimer2.current = setTimeout(() => {
      if (!tooltipLocked2.current && !chartHovered2.current) {
        lastValidData2.current = null;
        setLockedData2(null);
        setTooltipPos2(undefined);
      }
    }, 150);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMouseMove1(state: any) {
    if (tooltipLocked1.current) return;
    chartHovered1.current = true;
    if (hideTimer1.current) { clearTimeout(hideTimer1.current); hideTimer1.current = null; }
    if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex !== lastIndex1.current) {
      lastIndex1.current = state.activeTooltipIndex;
      if (state.activeCoordinate) {
        setTooltipPos1({ x: state.activeCoordinate.x, y: state.activeCoordinate.y });
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleMouseMove2(state: any) {
    if (tooltipLocked2.current) return;
    chartHovered2.current = true;
    if (hideTimer2.current) { clearTimeout(hideTimer2.current); hideTimer2.current = null; }
    if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex !== lastIndex2.current) {
      lastIndex2.current = state.activeTooltipIndex;
      if (state.activeCoordinate) {
        setTooltipPos2({ x: state.activeCoordinate.x, y: state.activeCoordinate.y });
      }
    }
  }

  // 自定义 Tooltip
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderCountTooltip({ active, payload, label }: any) {
    if (tooltipLocked1.current && lockedData1) {
      const ts = Number(lockedData1.label);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = (lockedData1.payload[0] as any)?.value;
      return (
        <div
          className="bg-white border border-gray-200 rounded-md p-3 shadow-lg text-sm z-10 relative"
          onMouseEnter={() => { tooltipLocked1.current = true; if (hideTimer1.current) clearTimeout(hideTimer1.current); }}
          onMouseLeave={() => { tooltipLocked1.current = false; setLockedData1(null); handleMouseLeave1(); }}
        >
          <p className="m-0 mb-1.5 font-semibold text-gray-900">{formatTooltipLabel(ts)}</p>
          <p className="m-0 mb-1 text-gray-600">慢 SQL 数量: <strong className="text-gray-900">{count}</strong></p>
          <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate(getFingerprintUrl(ts))}>
            查看该时段 SQL 归类 →
          </Button>
        </div>
      );
    }

    if (active && payload?.length) {
      lastValidData1.current = { payload, label: String(label) };
    }

    if (!tooltipPos1 && !tooltipLocked1.current) return null;

    const data = (active && payload?.length) ? { payload, label: String(label) } : lastValidData1.current;
    if (!data) return null;

    const ts = Number(data.label);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = (data.payload[0] as any)?.value;
    return (
      <div
        className="bg-white border border-gray-200 rounded-md p-3 shadow-lg text-sm z-10 relative"
        onMouseEnter={() => { tooltipLocked1.current = true; setLockedData1(data); if (hideTimer1.current) clearTimeout(hideTimer1.current); }}
        onMouseLeave={() => { tooltipLocked1.current = false; setLockedData1(null); handleMouseLeave1(); }}
      >
        <p className="m-0 mb-1.5 font-semibold text-gray-900">{formatTooltipLabel(ts)}</p>
        <p className="m-0 mb-1 text-gray-600">慢 SQL 数量: <strong className="text-gray-900">{count}</strong></p>
        <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate(getFingerprintUrl(ts))}>
          查看该时段 SQL 归类 →
        </Button>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderTimeTooltip({ active, payload, label }: any) {
    if (tooltipLocked2.current && lockedData2) {
      const ts = Number(lockedData2.label);
      return (
        <div
          className="bg-white border border-gray-200 rounded-md p-3 shadow-lg text-sm z-10 relative"
          onMouseEnter={() => { tooltipLocked2.current = true; if (hideTimer2.current) clearTimeout(hideTimer2.current); }}
          onMouseLeave={() => { tooltipLocked2.current = false; setLockedData2(null); handleMouseLeave2(); }}
        >
          <p className="m-0 mb-1.5 font-semibold text-gray-900">{formatTooltipLabel(ts)}</p>
          {(lockedData2.payload as { name: string; value: number; color: string }[]).map((entry) => {
            const nameMap: Record<string, string> = { avgQueryTime: '平均耗时', maxQueryTime: '最大耗时' };
            return (
              <p key={entry.name} className="m-0 mb-1 text-gray-600" style={{ color: entry.color }}>
                {nameMap[entry.name] || entry.name}: <strong className="text-gray-900">{Number(entry.value).toFixed(3)}s</strong>
              </p>
            );
          })}
          <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate(getFingerprintUrl(ts))}>
            查看该时段 SQL 归类 →
          </Button>
        </div>
      );
    }

    if (active && payload?.length) {
      lastValidData2.current = { payload, label: String(label) };
    }

    if (!tooltipPos2 && !tooltipLocked2.current) return null;

    const data = (active && payload?.length) ? { payload, label: String(label) } : lastValidData2.current;
    if (!data) return null;

    const ts = Number(data.label);
    return (
      <div
        className="bg-white border border-gray-200 rounded-md p-3 shadow-lg text-sm z-10 relative"
        onMouseEnter={() => { tooltipLocked2.current = true; setLockedData2(data); if (hideTimer2.current) clearTimeout(hideTimer2.current); }}
        onMouseLeave={() => { tooltipLocked2.current = false; setLockedData2(null); handleMouseLeave2(); }}
      >
        <p className="m-0 mb-1.5 font-semibold text-gray-900">{formatTooltipLabel(ts)}</p>
        {(data.payload as { name: string; value: number; color: string }[]).map((entry) => {
          const nameMap: Record<string, string> = { avgQueryTime: '平均耗时', maxQueryTime: '最大耗时' };
          return (
            <p key={entry.name} className="m-0 mb-1 text-gray-600" style={{ color: entry.color }}>
              {nameMap[entry.name] || entry.name}: <strong className="text-gray-900">{Number(entry.value).toFixed(3)}s</strong>
            </p>
          );
        })}
        <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate(getFingerprintUrl(ts))}>
          查看该时段 SQL 归类 →
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end items-center mb-5">
        <div className="flex items-center gap-2">
          <ButtonGroup
            items={[
              { value: 'minute', label: '按分钟' },
              { value: 'hour', label: '按小时' },
              { value: 'day', label: '按天' },
            ]}
            value={granularity}
            onChange={setGranularity}
          />
        </div>
      </div>

      {fingerprint && (
        <div className="flex items-start flex-wrap gap-2.5 px-3.5 py-2.5 mb-4 bg-primary/5 border border-primary/20 rounded-md text-sm text-gray-600">
          当前过滤指纹：<code className="font-mono text-xs text-primary bg-white px-1.5 py-0.5 rounded border border-gray-100 break-all">{fingerprint}</code>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setFingerprint('')}>清除过滤</Button>
        </div>
      )}

      {groupId && (
        <div className="flex items-center flex-wrap gap-2.5 px-3.5 py-2.5 mb-4 bg-purple-50 border border-purple-200 rounded-md text-sm text-gray-600">
          当前过滤分组：<span className="font-medium text-purple-600">{groupName || `#${groupId}`}</span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => navigate('/trends')}>清除过滤</Button>
        </div>
      )}

      {loading && <div className="text-center py-16 text-gray-400">加载中...</div>}

      {!loading && trends.length === 0 && (
        <div className="text-center py-10 text-gray-400 text-sm">暂无数据，请先到「数据管理」页拉取数据</div>
      )}

      {!loading && trends.length > 0 && (
        <div className="space-y-5">
          {/* 慢 SQL 数量趋势 */}
          <div className="bg-white p-5 rounded-lg shadow-sm [&_.recharts-tooltip-wrapper]:!visible [&_.recharts-tooltip-wrapper]:!pointer-events-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">慢 SQL 数量趋势</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} onMouseMove={handleMouseMove1} onMouseLeave={handleMouseLeave1}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tickFormatter={formatXLabel} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={renderCountTooltip} position={tooltipPos1} isAnimationActive={false} />
                <Legend formatter={(value) => value === 'count' ? '慢 SQL 数量' : value} />
                <Line type="monotone" dataKey="count" stroke="#6c63ff" strokeWidth={2} dot={trends.length <= 80 ? { r: 3 } : false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 平均耗时趋势 */}
          <div className="bg-white p-5 rounded-lg shadow-sm [&_.recharts-tooltip-wrapper]:!visible [&_.recharts-tooltip-wrapper]:!pointer-events-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">查询耗时趋势</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} onMouseMove={handleMouseMove2} onMouseLeave={handleMouseLeave2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tickFormatter={formatXLabel} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} unit="s" />
                <Tooltip content={renderTimeTooltip} position={tooltipPos2} isAnimationActive={false} />
                <Legend formatter={(value) => {
                  const map: Record<string, string> = { avgQueryTime: '平均耗时', maxQueryTime: '最大耗时' };
                  return map[value] || value;
                }} />
                <Line type="monotone" dataKey="avgQueryTime" stroke="#52c41a" strokeWidth={2} dot={trends.length <= 80 ? { r: 3 } : false} />
                <Line type="monotone" dataKey="maxQueryTime" stroke="#ff4d4f" strokeWidth={2} dot={trends.length <= 80 ? { r: 3 } : false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
