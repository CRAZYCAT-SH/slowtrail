import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { FingerprintDetail } from '../../api';
import { useNavigate } from 'react-router-dom';
import { formatTime } from './utils';
import Button from '../Button';
import ButtonGroup from '../ButtonGroup';

interface Props {
  detail: FingerprintDetail;
  fingerprint: string;
  startTime: number;
  endTime: number;
  detailLoading: boolean;
  samplesPage: number;
  samplesPageSize: number;
  onChangeTrendGranularity: (g: 'minute' | 'hour' | 'day') => void;
  onLoadSamplesPage: (page: number) => void;
  onShowSqlModal: (data: { sql: string; queryTime: number; rowsExamined: number; timestamp: number }) => void;
}

export default function FingerprintDetailPanel({
  detail,
  fingerprint,
  startTime,
  endTime,
  detailLoading,
  samplesPage,
  samplesPageSize,
  onChangeTrendGranularity,
  onLoadSamplesPage,
  onShowSqlModal,
}: Props) {
  const navigate = useNavigate();

  function formatTrendXLabel(ts: number): string {
    const d = new Date(ts);
    if (detail.trendGranularity === 'minute') {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (detail.trendGranularity === 'hour') {
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  if (detailLoading) {
    return <div className="py-5 text-center text-gray-400">加载详情中...</div>;
  }

  return (
    <div className="p-5 animate-[slideDown_0.25s_ease-out] overflow-x-hidden max-w-full">
      {/* 统计信息 */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-600 mb-2.5">统计信息</h4>
        <div className="flex gap-3 flex-wrap">
          {[
            { value: detail.count, label: '出现次数' },
            { value: formatTime(detail.avgQueryTime), label: '平均耗时' },
            { value: formatTime(detail.maxQueryTime), label: '最大耗时' },
            { value: formatTime(detail.minQueryTime), label: '最小耗时' },
            { value: formatTime(detail.avgLockTime), label: '平均锁等待' },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center px-4 py-2 bg-white border border-gray-100 rounded-md min-w-[80px]">
              <span className="text-base font-semibold text-gray-900 font-mono">{stat.value}</span>
              <span className="text-[11px] text-gray-400 mt-0.5">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 涉及范围 */}
      {(detail.databases.length > 0 || detail.instances.length > 0) && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-600 mb-2.5">涉及范围</h4>
          <div className="flex flex-col gap-2">
            {detail.databases.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-gray-500">数据库：</span>
                {detail.databases.map((db) => (
                  <span key={db} className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 border border-blue-200">{db}</span>
                ))}
              </div>
            )}
            {detail.instances.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-gray-500">实例：</span>
                {detail.instances.map((inst) => (
                  <span key={inst} className="inline-block px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-600 border border-orange-200">{inst}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 耗时趋势 */}
      {detail.timeTrend.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-600 m-0">耗时趋势</h4>
            <ButtonGroup
              size="sm"
              items={[
                { value: 'minute', label: '分钟' },
                { value: 'hour', label: '小时' },
                { value: 'day', label: '天' },
              ]}
              value={detail.trendGranularity}
              onChange={(g) => { onChangeTrendGranularity(g); }}
            />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={detail.timeTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <XAxis dataKey="time" tickFormatter={formatTrendXLabel} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="time" tick={{ fontSize: 11 }} unit="s" width={50} />
              <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} unit="次" width={50} />
              <Tooltip
                labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
                formatter={(value, name) => {
                  const v = Number(value);
                  if (name === 'count') return [v + ' 次', '频次'];
                  if (name === 'avgTime') return [v.toFixed(3) + 's', '平均耗时'];
                  return [v.toFixed(3) + 's', '最大耗时'];
                }}
              />
              <Legend formatter={(value: string) => {
                if (value === 'count') return '频次';
                if (value === 'avgTime') return '平均耗时';
                return '最大耗时';
              }} />
              <Bar yAxisId="count" dataKey="count" fill="#bae0ff" stroke="#4096ff" name="count" barSize={detail.timeTrend.length === 1 ? 40 : 20} />
              <Line yAxisId="time" type="monotone" dataKey="avgTime" stroke="#6c63ff" strokeWidth={2} dot={detail.timeTrend.length <= 50 ? { r: 3 } : false} name="avgTime" />
              <Line yAxisId="time" type="monotone" dataKey="maxTime" stroke="#ff4d4f" strokeWidth={2} dot={detail.timeTrend.length <= 50 ? { r: 3 } : false} name="maxTime" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex justify-end mt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/trends?fingerprint=${encodeURIComponent(fingerprint)}&startTime=${startTime}&endTime=${endTime}&granularity=${detail.trendGranularity}`);
              }}
            >
              查看完整趋势 →
            </Button>
          </div>
        </div>
      )}

      {/* 原始 SQL */}
      <div className="mb-0">
        <h4 className="text-sm font-medium text-gray-600 mb-2.5">原始 SQL</h4>
        <div className="max-h-[400px] overflow-y-auto">
          {detail.samples.map((sample, i) => (
            <div
              key={i}
              className="border border-gray-200 rounded-md mb-2 overflow-hidden cursor-pointer transition-all hover:border-primary/30 hover:shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onShowSqlModal({
                  sql: sample.query_sql,
                  queryTime: sample.query_time,
                  rowsExamined: sample.rows_examined,
                  timestamp: sample.timestamp,
                });
              }}
            >
              <div className="flex gap-4 px-3 py-1.5 bg-gray-50 text-xs text-gray-500 items-center">
                <span className="text-primary font-semibold">{formatTime(sample.query_time)}</span>
                <span>{sample.rows_examined.toLocaleString()} rows</span>
                <span>{new Date(sample.timestamp).toLocaleString()}</span>
              </div>
              <pre className="m-0 px-3 py-2.5 text-xs font-mono bg-white text-gray-700 leading-relaxed line-clamp-3 whitespace-pre-wrap break-all">{sample.query_sql}</pre>
            </div>
          ))}
        </div>
        {detail.samplesTotal > samplesPageSize && (
          <div className="flex justify-center items-center gap-3 pt-2.5 mt-2.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={samplesPage === 0}
              onClick={(e) => { e.stopPropagation(); onLoadSamplesPage(samplesPage - 1); }}
            >上一页</Button>
            <span className="text-xs text-gray-500">{samplesPage + 1} / {Math.ceil(detail.samplesTotal / samplesPageSize)}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={samplesPage >= Math.ceil(detail.samplesTotal / samplesPageSize) - 1}
              onClick={(e) => { e.stopPropagation(); onLoadSamplesPage(samplesPage + 1); }}
            >下一页</Button>
          </div>
        )}
      </div>
    </div>
  );
}
