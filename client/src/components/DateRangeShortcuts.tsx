import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DateRangeDate {
  startDate: string;
  endDate: string;
}

interface DateRangeTimestamp {
  startTime: number;
  endTime: number;
}

// date 模式 props
interface DateModeProps {
  mode?: 'date';
  startDate: string;
  endDate: string;
  onChange: (range: DateRangeDate) => void;
}

// datetime 模式 props（使用毫秒时间戳）
interface DatetimeModeProps {
  mode: 'datetime';
  startTime: number;
  endTime: number;
  onChange: (range: DateRangeTimestamp) => void;
}

type DateRangeShortcutsProps = DateModeProps | DatetimeModeProps;

interface ShortcutItem {
  label: string;
  /** 适用的模式，不指定则两种模式都显示 */
  modes?: Array<'date' | 'datetime'>;
  getDateRange: () => DateRangeDate;
  getTimestampRange: () => DateRangeTimestamp;
}

/** 格式化为日期字符串 YYYY-MM-DD（基于本地时间） */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 将毫秒时间戳格式化为 datetime-local input 需要的格式 YYYY-MM-DDTHH:mm */
function timestampToLocalInput(ts: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** 将 datetime-local input 的本地值转为毫秒时间戳 */
function localInputToTimestamp(localStr: string): number {
  if (!localStr) return 0;
  const date = new Date(localStr);
  if (isNaN(date.getTime())) return 0;
  return date.getTime();
}

/** 获取今天结束时间 23:59:59.999 */
function getEndOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 快捷时间选项配置 */
const shortcuts: ShortcutItem[] = [
  {
    label: '今天',
    getDateRange: () => {
      const now = new Date();
      return { startDate: formatDate(now), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { startTime: start.getTime(), endTime: getEndOfToday() };
    },
  },
  {
    label: '最近 15 分钟',
    modes: ['datetime'],
    getDateRange: () => ({ startDate: '', endDate: '' }),
    getTimestampRange: () => {
      const now = Date.now();
      return { startTime: now - 15 * 60 * 1000, endTime: now };
    },
  },
  {
    label: '最近 24 小时',
    modes: ['datetime'],
    getDateRange: () => ({ startDate: '', endDate: '' }),
    getTimestampRange: () => {
      const now = Date.now();
      return { startTime: now - 24 * 60 * 60 * 1000, endTime: now };
    },
  },
  {
    label: '最近 30 分钟',
    modes: ['datetime'],
    getDateRange: () => ({ startDate: '', endDate: '' }),
    getTimestampRange: () => {
      const now = Date.now();
      return { startTime: now - 30 * 60 * 1000, endTime: now };
    },
  },
  {
    label: '本周',
    getDateRange: () => {
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      return { startDate: formatDate(monday), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      return { startTime: monday.getTime(), endTime: getEndOfToday() };
    },
  },
  {
    label: '最近 1 小时',
    modes: ['datetime'],
    getDateRange: () => ({ startDate: '', endDate: '' }),
    getTimestampRange: () => {
      const now = Date.now();
      return { startTime: now - 60 * 60 * 1000, endTime: now };
    },
  },
  {
    label: '最近 7 天',
    getDateRange: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(past.getDate() - 7);
      return { startDate: formatDate(past), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      past.setHours(0, 0, 0, 0);
      return { startTime: past.getTime(), endTime: getEndOfToday() };
    },
  },
  {
    label: '最近 3 小时',
    modes: ['datetime'],
    getDateRange: () => ({ startDate: '', endDate: '' }),
    getTimestampRange: () => {
      const now = Date.now();
      return { startTime: now - 3 * 60 * 60 * 1000, endTime: now };
    },
  },
  {
    label: '最近 30 天',
    getDateRange: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { startDate: formatDate(past), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      past.setHours(0, 0, 0, 0);
      return { startTime: past.getTime(), endTime: getEndOfToday() };
    },
  },
  {
    label: '最近 90 天',
    getDateRange: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(past.getDate() - 90);
      return { startDate: formatDate(past), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const past = new Date();
      past.setDate(past.getDate() - 90);
      past.setHours(0, 0, 0, 0);
      return { startTime: past.getTime(), endTime: getEndOfToday() };
    },
  },
  {
    label: '最近 1 年',
    getDateRange: () => {
      const now = new Date();
      const past = new Date(now);
      past.setFullYear(past.getFullYear() - 1);
      return { startDate: formatDate(past), endDate: formatDate(now) };
    },
    getTimestampRange: () => {
      const past = new Date();
      past.setFullYear(past.getFullYear() - 1);
      past.setHours(0, 0, 0, 0);
      return { startTime: past.getTime(), endTime: getEndOfToday() };
    },
  },
];

/**
 * 时间范围快捷选择组件
 * date 模式：输入输出 YYYY-MM-DD 字符串
 * datetime 模式：输入输出毫秒时间戳
 */
export default function DateRangeShortcuts(props: DateRangeShortcutsProps) {
  const mode = props.mode || 'date';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  // 根据模式过滤快捷选项
  const filteredShortcuts = shortcuts.filter(
    (item) => !item.modes || item.modes.includes(mode)
  );

  // 计算面板位置
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 380;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.left;
      if (left + panelWidth > viewportWidth - 8) {
        left = Math.max(8, rect.right - panelWidth);
      }

      const spaceBelow = viewportHeight - rect.bottom;
      const panelHeight = 320;
      let top = rect.bottom + 4;
      if (spaceBelow < panelHeight && rect.top > panelHeight) {
        top = rect.top - panelHeight - 4;
      }

      setPanelStyle({
        position: 'fixed',
        top,
        left,
        zIndex: 10000,
        maxWidth: `calc(100vw - 16px)`,
      });
    }
  }, [open]);

  // 点击外部关闭面板
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleSelect(item: ShortcutItem) {
    if (mode === 'datetime') {
      (props as DatetimeModeProps).onChange(item.getTimestampRange());
    } else {
      (props as DateModeProps).onChange(item.getDateRange());
    }
    setOpen(false);
  }

  // 显示文本
  function getDisplayText(): string {
    if (mode === 'datetime') {
      const { startTime, endTime } = props as DatetimeModeProps;
      if (!startTime && !endTime) return '选择时间范围';
      const s = startTime
        ? new Date(startTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      const e = endTime
        ? new Date(endTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      return `${s} ~ ${e}`;
    }
    const { startDate, endDate } = props as DateModeProps;
    if (!startDate && !endDate) return '选择日期范围';
    return `${startDate} ~ ${endDate}`;
  }

  // input 值和类型
  const inputType = mode === 'datetime' ? 'datetime-local' : 'date';
  let localStartValue: string;
  let localEndValue: string;

  if (mode === 'datetime') {
    const { startTime, endTime } = props as DatetimeModeProps;
    localStartValue = timestampToLocalInput(startTime);
    localEndValue = timestampToLocalInput(endTime);
  } else {
    const { startDate, endDate } = props as DateModeProps;
    localStartValue = startDate;
    localEndValue = endDate;
  }

  function handleCustomStartChange(value: string) {
    if (mode === 'datetime') {
      const { endTime } = props as DatetimeModeProps;
      (props as DatetimeModeProps).onChange({
        startTime: localInputToTimestamp(value),
        endTime,
      });
    } else {
      const { endDate } = props as DateModeProps;
      (props as DateModeProps).onChange({ startDate: value, endDate });
    }
  }

  function handleCustomEndChange(value: string) {
    if (mode === 'datetime') {
      const { startTime } = props as DatetimeModeProps;
      (props as DatetimeModeProps).onChange({
        startTime,
        endTime: localInputToTimestamp(value),
      });
    } else {
      const { startDate } = props as DateModeProps;
      (props as DateModeProps).onChange({ startDate, endDate: value });
    }
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={triggerRef}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md bg-white text-sm text-gray-700 cursor-pointer transition-colors whitespace-nowrap hover:border-primary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="text-sm">⏱</span>
        <span className="font-mono text-xs text-gray-600">{getDisplayText()}</span>
        <span className={`text-[10px] text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && createPortal(
        <div className="min-w-[360px] max-w-[calc(100vw-16px)] bg-white border border-gray-200 rounded-lg shadow-xl p-3 animate-[fadeIn_0.15s_ease-out]" ref={panelRef} style={panelStyle}>
          <div className="text-xs font-semibold text-gray-400 mb-2 pl-0.5">常用</div>
          <div className="grid grid-cols-2 gap-1">
            {filteredShortcuts.map((item) => (
              <button
                key={item.label}
                className="px-2.5 py-1.5 border-none rounded bg-transparent text-sm text-blue-500 cursor-pointer text-left transition-colors hover:bg-blue-50"
                onClick={() => handleSelect(item)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="h-px bg-gray-100 my-2.5" />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-xs text-gray-500">
              起始
              <input
                type={inputType}
                value={localStartValue}
                onChange={(e) => handleCustomStartChange(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-xs max-w-[180px]"
              />
            </label>
            <span className="text-gray-400">~</span>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              结束
              <input
                type={inputType}
                value={localEndValue}
                onChange={(e) => handleCustomEndChange(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-xs max-w-[180px]"
              />
            </label>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
