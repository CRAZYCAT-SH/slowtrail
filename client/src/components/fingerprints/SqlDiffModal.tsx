import { useMemo } from 'react';
import { format } from 'sql-formatter';
import { diffWords } from 'diff';
import Button from '../Button';

interface Props {
  /** 左侧：当前目标指纹 SQL */
  sourceSql: string;
  /** 右侧：推荐指纹 SQL */
  targetSql: string;
  /** 相似度（0~1） */
  similarity?: number;
  onClose: () => void;
}

/** 差异类型 */
type DiffType = 'equal' | 'added' | 'removed';

interface DiffSegment {
  type: DiffType;
  value: string;
}

/**
 * 使用 diff 库的 diffWords 进行词级别比较
 * 输出转为内部 DiffSegment 格式
 */
function computeDiff(oldStr: string, newStr: string): DiffSegment[] {
  const changes = diffWords(oldStr, newStr);

  return changes.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'equal',
    value: change.value,
  }));
}

/**
 * 将 diff segments 拆分为左侧（source）和右侧（target）视图
 * 左侧：equal + removed（removed 高亮）
 * 右侧：equal + added（added 高亮）
 */
function splitDiffSegments(segments: DiffSegment[]) {
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];

  for (const seg of segments) {
    if (seg.type === 'equal') {
      left.push(seg);
      right.push(seg);
    } else if (seg.type === 'removed') {
      left.push(seg);
    } else {
      right.push(seg);
    }
  }

  return { left, right };
}

/** 渲染单侧差异视图 */
function SideDiffView({ segments, side }: { segments: DiffSegment[]; side: 'left' | 'right' }) {
  return (
    <pre className="m-0 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all bg-[#fafafa] min-h-full">
      {segments.map((seg, idx) => {
        if (seg.type === 'equal') {
          return <span key={idx}>{seg.value}</span>;
        }
        if (side === 'left' && seg.type === 'removed') {
          return (
            <span key={idx} className="bg-red-100 text-red-800">
              {seg.value}
            </span>
          );
        }
        if (side === 'right' && seg.type === 'added') {
          return (
            <span key={idx} className="bg-green-100 text-green-800">
              {seg.value}
            </span>
          );
        }
        return null;
      })}
    </pre>
  );
}

/**
 * SQL 差异对比模态框 — 左右分栏展示
 * 左侧：目标指纹（红色高亮独有部分）
 * 右侧：推荐指纹（绿色高亮独有部分）
 */
export default function SqlDiffModal({ sourceSql, targetSql, similarity, onClose }: Props) {
  // 先格式化 SQL 再做差异比较，方便用户观察
  const formattedSource = useMemo(() => {
    try {
      return format(sourceSql, { language: 'mysql', tabWidth: 2 });
    } catch {
      return sourceSql;
    }
  }, [sourceSql]);

  const formattedTarget = useMemo(() => {
    try {
      return format(targetSql, { language: 'mysql', tabWidth: 2 });
    } catch {
      return targetSql;
    }
  }, [targetSql]);

  const diffSegments = useMemo(() => computeDiff(formattedSource, formattedTarget), [formattedSource, formattedTarget]);
  const { left, right } = useMemo(() => splitDiffSegments(diffSegments), [diffSegments]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1100] p-4 animate-[fadeIn_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-[1200px] max-h-[85vh] flex flex-col animate-[modalSlideIn_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="m-0 text-base font-semibold text-gray-900">SQL 指纹对比</h3>
            {similarity !== undefined && (
              <span className="text-sm text-primary font-medium">相似度: {Math.round(similarity * 100)}%</span>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-200"></span>
                目标独有
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-200"></span>
                推荐独有
              </span>
            </div>
          </div>
          <button
            className="w-7 h-7 border-none bg-gray-100 rounded-full text-lg text-gray-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-gray-200 hover:text-gray-700"
            onClick={onClose}
          >×</button>
        </div>

        {/* 左右分栏差异展示 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧：目标指纹 */}
          <div className="w-1/2 flex flex-col border-r border-gray-200">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
              <span className="text-xs font-medium text-gray-600">目标指纹</span>
              <span className="text-[11px] text-red-500 ml-2">（红色 = 此处独有）</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SideDiffView segments={left} side="left" />
            </div>
          </div>

          {/* 右侧：推荐指纹 */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
              <span className="text-xs font-medium text-gray-600">推荐指纹</span>
              <span className="text-[11px] text-green-600 ml-2">（绿色 = 此处独有）</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SideDiffView segments={right} side="right" />
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex justify-end px-5 py-3 border-t border-gray-100 shrink-0">
          <Button variant="secondary" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}
