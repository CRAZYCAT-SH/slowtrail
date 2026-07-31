import { useState, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { format } from 'sql-formatter';

interface SQLBlockProps {
  sql: string;
  /** 最大高度（px），超出则滚动 */
  maxHeight?: number;
  /** 是否默认展示格式化后的 SQL */
  defaultFormatted?: boolean;
  /** 复制回调，传入当前展示的 SQL 文本 */
  onCopy?: (text: string) => void;
}

// SQL 长度阈值：超过此长度时格式化需用户手动触发
const FORMAT_AUTO_LIMIT = 4000;
// 默认截断展示长度
const TRUNCATE_LIMIT = 2000;

/**
 * SQL 展示组件：支持语法高亮 + 格式化切换 + 一键复制
 * 对超长 SQL（>4000 字符）默认展示原文，用户可手动尝试格式化
 */
export default function SQLBlock({
  sql,
  maxHeight = 200,
  defaultFormatted = false,
  onCopy,
}: SQLBlockProps) {
  // 超长 SQL 默认不格式化，短 SQL 按 defaultFormatted 参数
  const isLong = sql.length > FORMAT_AUTO_LIMIT;
  const [formatted, setFormatted] = useState(isLong ? false : defaultFormatted);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // 超长 SQL 格式化状态：idle / loading / done / error
  const [longFormatState, setLongFormatState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [longFormattedSql, setLongFormattedSql] = useState<string>('');

  const needsTruncation = sql.length > TRUNCATE_LIMIT;

  // 格式化后的 SQL（缓存计算结果，仅对短 SQL 做自动格式化）
  const formattedSql = useMemo(() => {
    if (isLong) return sql;
    try {
      return format(sql, { language: 'mysql', tabWidth: 2 });
    } catch {
      return sql;
    }
  }, [sql, isLong]);

  // 超长 SQL 手动触发格式化
  function handleTryFormat() {
    if (longFormatState === 'done') {
      // 已经格式化过了，切换回原始
      setFormatted(!formatted);
      return;
    }
    setLongFormatState('loading');
    // 用 setTimeout 让 UI 先更新显示"格式化中..."
    setTimeout(() => {
      try {
        const result = format(sql, { language: 'mysql', tabWidth: 2 });
        setLongFormattedSql(result);
        setLongFormatState('done');
        setFormatted(true);
      } catch {
        setLongFormatState('error');
      }
    }, 0);
  }

  // 当前展示的完整 SQL
  const fullDisplaySql = (() => {
    if (isLong) {
      return formatted && longFormatState === 'done' ? longFormattedSql : sql;
    }
    return formatted ? formattedSql : sql;
  })();

  // 实际渲染的 SQL（可能被截断）
  const displaySql = (!expanded && needsTruncation)
    ? fullDisplaySql.slice(0, TRUNCATE_LIMIT) + '\n\n/* ... 内容已截断，点击"展开全部"查看完整 SQL ... */'
    : fullDisplaySql;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullDisplaySql);
      setCopied(true);
      onCopy?.(fullDisplaySql);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('复制失败');
    }
  }

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden max-w-full">
      <div className="flex justify-end gap-1.5 px-2 py-1 bg-gray-50 border-b border-gray-200">
        {!isLong && (
          <button
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 whitespace-nowrap border ${formatted ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-100 hover:border-gray-200'}`}
            onClick={() => setFormatted(!formatted)}
            title={formatted ? '显示原始 SQL' : '格式化 SQL'}
          >
            {formatted ? '原始' : '格式化'}
          </button>
        )}
        {isLong && (
          <button
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 whitespace-nowrap border ${formatted ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-100 hover:border-gray-200'}`}
            onClick={handleTryFormat}
            disabled={longFormatState === 'loading'}
            title={formatted ? '显示原始 SQL' : '尝试格式化（SQL 较长，可能需要一点时间）'}
          >
            {longFormatState === 'loading' ? '格式化中...' :
             longFormatState === 'error' ? '格式化失败' :
             formatted ? '原始' : '格式化'}
          </button>
        )}
        <button
          className={`px-2.5 py-0.5 rounded-md text-xs font-medium cursor-pointer transition-all duration-150 whitespace-nowrap border ${copied ? 'bg-green-50 border-green-200 text-green-600' : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-100 hover:border-gray-200'}`}
          onClick={handleCopy}
          title="复制 SQL"
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight }}>
        <SyntaxHighlighter
          language="sql"
          style={oneLight}
          customStyle={{
            margin: 0,
            padding: '12px',
            fontSize: '12px',
            background: '#fafafa',
            borderRadius: '0 0 6px 6px',
          }}
          wrapLongLines
        >
          {displaySql}
        </SyntaxHighlighter>
      </div>
      {needsTruncation && (
        <button
          className="block w-full py-1.5 border-none bg-gray-50 text-xs font-medium text-primary cursor-pointer hover:bg-primary/5 transition-all duration-150"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : `展开全部 (${(sql.length / 1024).toFixed(1)} KB)`}
        </button>
      )}
    </div>
  );
}
