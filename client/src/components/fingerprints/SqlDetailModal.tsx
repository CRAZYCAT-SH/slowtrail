import SQLBlock from '../SQLBlock';
import type { SlowQuerySample } from '../../api';
import { formatTime, formatTimeOrDash, formatCount, formatText } from './utils';

interface Props {
  data: SlowQuerySample;
  onClose: () => void;
}

/** 单个字段展示单元 */
function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className={`text-xs text-gray-800 break-all ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
    </div>
  );
}

export default function SqlDetailModal({ data, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000] p-10 animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[900px] max-h-[80vh] flex flex-col animate-[modalSlideIn_0.25s_ease-out]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="m-0 text-base font-semibold text-gray-900 whitespace-nowrap">SQL 详情</h3>
          <div className="flex gap-3.5 text-xs text-gray-500">
            <span className="text-primary font-semibold">{formatTime(data.query_time)}</span>
            <span>{formatCount(data.rows_examined)} rows</span>
            <span>{new Date(data.timestamp).toLocaleString()}</span>
          </div>
          <button className="ml-auto w-7.5 h-7.5 border-none bg-gray-100 rounded-full text-lg text-gray-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-gray-200 hover:text-gray-700" onClick={onClose}>×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          {/* 完整字段信息：对应 slow_queries 表的全部行级字段 */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-600 mb-2.5">记录信息</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 p-3 bg-gray-50 border border-gray-100 rounded-md">
              <Field label="查询耗时" value={formatTime(data.query_time)} />
              <Field label="锁等待时间" value={formatTimeOrDash(data.lock_time)} />
              <Field label="扫描行数" value={formatCount(data.rows_examined)} />
              <Field label="返回行数" value={formatCount(data.rows_sent)} />
              <Field label="发生时间" value={new Date(data.timestamp).toLocaleString()} />
              <Field label="数据库名" value={formatText(data.db_name)} />
              <Field label="实例名" value={formatText(data.instance_name)} />
              <Field label="实例 ID" value={formatText(data.instance_id)} />
              <Field label="节点 ID" value={formatText(data.node_id)} />
              <Field label="执行用户" value={formatText(data.user_name)} />
              <Field label="用户主机" value={formatText(data.user_host)} />
              <Field label="数据源" value={formatText(data.data_source_name)} />
              <Field label="同步日期" value={formatText(data.sync_date)} />
              <Field label="来源索引" value={formatText(data.es_index)} />
              <Field label="记录 ID" value={String(data.id)} />
            </div>
          </div>

          {/* SQL 指纹 */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-600 mb-2.5">SQL 指纹</h4>
            <code className="block px-3 py-2 bg-gray-50 border border-gray-100 rounded-md text-xs font-mono text-gray-700 break-all whitespace-pre-wrap">{data.fingerprint}</code>
          </div>

          {/* 原始 SQL */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-2.5">原始 SQL</h4>
            <SQLBlock sql={data.query_sql} maxHeight={600} defaultFormatted />
          </div>
        </div>
      </div>
    </div>
  );
}
