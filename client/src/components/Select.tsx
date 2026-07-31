import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

/**
 * 统一下拉选择组件 — 现代简约风
 *
 * 特性：
 *   - 无边框底色背景 + hover 显示边框，与 Button 组件风格一致
 *   - 使用 portal 渲染下拉面板避免被父元素 overflow 裁剪
 *   - 选项超过 8 个时自动显示搜索框
 *   - 面板最大高度 280px，支持滚动
 *   - 空间不足时自动向上弹出
 *
 * size:
 *   - sm: 小尺寸（导航栏等紧凑场景）
 *   - md: 标准尺寸
 */

export type SelectSize = 'sm' | 'md';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** 是否显示搜索框（默认：选项超过 8 个时自动显示） */
  searchable?: boolean;
  size?: SelectSize;
  className?: string;
}

const sizeStyles: Record<SelectSize, { trigger: string; panel: string; option: string; search: string }> = {
  sm: {
    trigger: 'px-2.5 py-1 text-xs min-w-[100px]',
    panel: 'text-xs',
    option: 'px-2.5 py-1.5',
    search: 'px-2.5 py-1.5 text-xs',
  },
  md: {
    trigger: 'px-3 py-1.5 text-sm min-w-[140px]',
    panel: 'text-sm',
    option: 'px-3 py-2',
    search: 'px-3 py-2 text-sm',
  },
};

export default function Select({
  value,
  onChange,
  options,
  placeholder = '请选择',
  searchable,
  size = 'md',
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  // 是否显示搜索框
  const showSearch = searchable ?? options.length > 8;

  // 选中项的 label
  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;
  const isPlaceholder = !options.some((o) => o.value === value);

  // 过滤选项
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const keyword = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(keyword));
  }, [options, search]);

  // 计算面板位置（空间不够时向上弹出）
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelMaxHeight = 280;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;

      if (spaceBelow >= panelMaxHeight || spaceBelow >= spaceAbove) {
        setPanelStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          minWidth: rect.width,
        });
      } else {
        setPanelStyle({
          position: 'fixed',
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          minWidth: rect.width,
        });
      }
    }
  }, [open]);

  // 打开时聚焦搜索框
  useEffect(() => {
    if (open && showSearch) {
      // 延迟聚焦以确保 DOM 已渲染
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    if (!open) {
      setSearch('');
    }
  }, [open, showSearch]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
  }

  const styles = sizeStyles[size];

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} inline-flex items-center justify-between gap-2 rounded-md font-medium cursor-pointer transition-all duration-150 border whitespace-nowrap bg-gray-50 text-gray-600 border-transparent hover:border-gray-200 hover:bg-gray-100`}
        onClick={() => setOpen(!open)}
      >
        <span className={`truncate ${isPlaceholder ? 'text-gray-400' : ''}`}>
          {selectedLabel}
        </span>
        <span className={`text-[10px] text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className={`${styles.panel} bg-white border border-gray-100 rounded-lg shadow-lg flex flex-col animate-[fadeIn_0.1s_ease-out]`}
          style={{ ...panelStyle, zIndex: 99999, maxHeight: 280 }}
        >
          {/* 搜索框 */}
          {showSearch && (
            <div className="p-1.5 border-b border-gray-100 shrink-0">
              <input
                ref={searchInputRef}
                type="text"
                className={`${styles.search} w-full border border-gray-100 rounded-md bg-gray-50 outline-none transition-colors focus:border-primary/30 focus:bg-white placeholder:text-gray-400`}
                placeholder="搜索..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* 选项列表 */}
          <div className="py-1 overflow-y-auto flex-1">
            {filteredOptions.length === 0 ? (
              <div className={`${styles.option} text-gray-400 text-center`}>无匹配项</div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option.value}
                  className={`${styles.option} cursor-pointer transition-colors duration-100 ${
                    option.value === value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
