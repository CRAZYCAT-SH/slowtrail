import { useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { fingerprintApi } from '../../api';
import type { GroupDetailResult, FingerprintDetail } from '../../api';
import FingerprintDetailPanel from './FingerprintDetailPanel';
import { formatTime } from './utils';
import Button from '../Button';
import ButtonGroup from '../ButtonGroup';

interface SqlModalData {
  sql: string;
  queryTime: number;
  rowsExamined: number;
  timestamp: number;
}

interface Props {
  groupDetail: GroupDetailResult;
  groupId: number;
  startTime: number;
  endTime: number;
  detailLoading: boolean;
  onChangeTrendGranularity?: (g: 'minute' | 'hour' | 'day') => void;
  onShowSqlModal?: (data: SqlModalData) => void;
}

export default function GroupDetailPanel({ groupDetail, groupId, startTime, endTime, detailLoading, onChangeTrendGranularity, onShowSqlModal }: Props) {
  const navigate = useNavigate();

  // 成员指纹展开详情
  const [expandedMemberFp, setExpandedMemberFp] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<FingerprintDetail | null>(null);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [memberSamplesPage, setMemberSamplesPage] = useState(0);
  const [memberTrendGranularity, setMemberTrendGranularity] = useState<'minute' | 'hour' | 'day' | undefined>(undefined);
  const memberSamplesPageSize = 10;

  function formatTrendXLabel(ts: number): string {
    const d = new Date(ts);
    if (groupDetail.trendGranularity === 'minute') {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (groupDetail.trendGranularity === 'hour') {
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function toggleMemberDetail(fp: string) {
    if (expandedMemberFp === fp) {
      setExpandedMemberFp(null);
      setMemberDetail(null);
      return;
    }
    setExpandedMemberFp(fp);
    setMemberSamplesPage(0);
    setMemberTrendGranularity(undefined);
    setMemberDetailLoading(true);
    try {
      const res = await fingerprintApi.getDetail(fp, {
        startTime, endTime,
        samplesLimit: memberSamplesPageSize, samplesOffset: 0,
      });
      if (res.data.success) setMemberDetail(res.data.data);
    } catch (err) {
      console.error('加载成员指纹详情失败:', err);
    } finally {
      setMemberDetailLoading(false);
    }
  }

  async function loadMemberSamplesPage(newPage: number) {
    if (!expandedMemberFp) return;
    setMemberSamplesPage(newPage);
    setMemberDetailLoading(true);
    try {
      const res = await fingerprintApi.getDetail(expandedMemberFp, {
        startTime, endTime,
        samplesLimit: memberSamplesPageSize, samplesOffset: newPage * memberSamplesPageSize,
        trendGranularity: memberTrendGranularity,
      });
      if (res.data.success) setMemberDetail(res.data.data);
    } catch (err) {
      console.error('加载成员原始 SQL 失败:', err);
    } finally {
      setMemberDetailLoading(false);
    }
  }

  async function changeMemberTrendGranularity(newGranularity: 'minute' | 'hour' | 'day') {
    if (!expandedMemberFp || newGranularity === memberTrendGranularity) return;
    setMemberTrendGranularity(newGranularity);
    try {
      const res = await fingerprintApi.getDetail(expandedMemberFp, {
        startTime, endTime,
        samplesLimit: memberSamplesPageSize, samplesOffset: memberSamplesPage * memberSamplesPageSize,
        trendGranularity: newGranularity,
      });
      if (res.data.success) setMemberDetail(res.data.data);
    } catch (err) {
      console.error('切换成员粒度失败:', err);
    }
  }

  if (detailLoading) {
    return <div className="py-5 text-center text-gray-400">加载详情中...</div>;
  }

  return (
    <div className="p-5 animate-[slideDown_0.25s_ease-out] overflow-x-hidden max-w-full">
      {/* 汇总统计 */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-600 mb-2.5">汇总统计</h4>
        <div className="flex gap-3 flex-wrap">
          {[
            { value: groupDetail.summary.count, label: '总次数' },
            { value: formatTime(groupDetail.summary.avgQueryTime), label: '平均耗时' },
            { value: formatTime(groupDetail.summary.maxQueryTime), label: '最大耗时' },
            { value: formatTime(groupDetail.summary.minQueryTime), label: '最小耗时' },
            { value: formatTime(groupDetail.summary.avgLockTime), label: '平均锁等待' },
            { value: formatTime(groupDetail.summary.totalQueryTime), label: '总耗时' },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center px-4 py-2 bg-white border border-gray-100 rounded-md min-w-[80px]">
              <span className="text-base font-semibold text-gray-900 font-mono">{stat.value}</span>
              <span className="text-[11px] text-gray-400 mt-0.5">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 涉及范围 */}
      {(groupDetail.summary.databases.length > 0 || groupDetail.summary.instances.length > 0) && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-600 mb-2.5">涉及范围</h4>
          <div className="flex flex-col gap-2">
            {groupDetail.summary.databases.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-gray-500">数据库：</span>
                {groupDetail.summary.databases.map((db) => (
                  <span key={db} className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 border border-blue-200">{db}</span>
                ))}
              </div>
            )}
            {groupDetail.summary.instances.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-gray-500">实例：</span>
                {groupDetail.summary.instances.map((inst) => (
                  <span key={inst} className="inline-block px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-600 border border-orange-200">{inst}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 耗时趋势 */}
      {groupDetail.timeTrend.length > 0 && (
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
              value={groupDetail.trendGranularity}
              onChange={(g) => { onChangeTrendGranularity?.(g); }}
            />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={groupDetail.timeTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
              <Bar yAxisId="count" dataKey="count" fill="#bae0ff" stroke="#4096ff" name="count" barSize={groupDetail.timeTrend.length === 1 ? 40 : 20} />
              <Line yAxisId="time" type="monotone" dataKey="avgTime" stroke="#6c63ff" strokeWidth={2} dot={groupDetail.timeTrend.length <= 50 ? { r: 3 } : false} name="avgTime" />
              <Line yAxisId="time" type="monotone" dataKey="maxTime" stroke="#ff4d4f" strokeWidth={2} dot={groupDetail.timeTrend.length <= 50 ? { r: 3 } : false} name="maxTime" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex justify-end mt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/trends?groupId=${groupId}&startTime=${startTime}&endTime=${endTime}&granularity=${groupDetail.trendGranularity}`);
              }}
            >
              查看完整趋势 →
            </Button>
          </div>
        </div>
      )}

      {/* 成员指纹详细列表 */}
      <div>
        <h4 className="text-sm font-medium text-gray-600 mb-2.5">成员指纹 ({groupDetail.members.length} 个)</h4>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-2 text-left text-gray-500 font-medium">指纹</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">频次</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">平均耗时</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">最大耗时</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">平均扫描行</th>
              </tr>
            </thead>
            <tbody>
              {groupDetail.members.map((member) => (
                <>
                  <tr
                    key={member.fingerprint}
                    className={`border-t border-gray-100 cursor-pointer transition-colors hover:bg-primary/5 ${expandedMemberFp === member.fingerprint ? 'bg-primary/5' : 'hover:bg-white'}`}
                    onClick={() => toggleMemberDetail(member.fingerprint)}
                  >
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-gray-700 break-all line-clamp-2">{member.fingerprint}</code>
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{member.count}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{formatTime(member.avgQueryTime)}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{formatTime(member.maxQueryTime)}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{Math.round(member.avgRowsExamined).toLocaleString()}</td>
                  </tr>
                  {expandedMemberFp === member.fingerprint && (
                    <tr key={member.fingerprint + '-detail'}>
                      <td colSpan={5} className="p-0 bg-white border-t border-gray-100">
                        {memberDetail ? (
                          <FingerprintDetailPanel
                            detail={memberDetail}
                            fingerprint={member.fingerprint}
                            startTime={startTime}
                            endTime={endTime}
                            detailLoading={memberDetailLoading}
                            samplesPage={memberSamplesPage}
                            samplesPageSize={memberSamplesPageSize}
                            onChangeTrendGranularity={changeMemberTrendGranularity}
                            onLoadSamplesPage={loadMemberSamplesPage}
                            onShowSqlModal={onShowSqlModal || (() => {})}
                          />
                        ) : memberDetailLoading ? (
                          <div className="py-4 text-center text-gray-400 text-xs">加载详情中...</div>
                        ) : null}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
