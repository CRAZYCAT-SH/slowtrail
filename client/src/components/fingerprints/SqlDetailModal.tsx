import SQLBlock from '../SQLBlock';
import { formatTime } from './utils';

interface SqlModalData {
  sql: string;
  queryTime: number;
  rowsExamined: number;
  timestamp: number;
}

interface Props {
  data: SqlModalData;
  onClose: () => void;
}

export default function SqlDetailModal({ data, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000] p-10 animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[900px] max-h-[80vh] flex flex-col animate-[modalSlideIn_0.25s_ease-out]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="m-0 text-base font-semibold text-gray-900 whitespace-nowrap">SQL 详情</h3>
          <div className="flex gap-3.5 text-xs text-gray-500">
            <span className="text-primary font-semibold">{formatTime(data.queryTime)}</span>
            <span>{data.rowsExamined.toLocaleString()} rows</span>
            <span>{new Date(data.timestamp).toLocaleString()}</span>
          </div>
          <button className="ml-auto w-7.5 h-7.5 border-none bg-gray-100 rounded-full text-lg text-gray-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-gray-200 hover:text-gray-700" onClick={onClose}>×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <SQLBlock sql={data.sql} maxHeight={600} defaultFormatted />
        </div>
      </div>
    </div>
  );
}
