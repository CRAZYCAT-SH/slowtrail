import type { ReactNode } from 'react';

/**
 * 分段按钮组组件 — 现代简约风
 *
 * 激活态用主色文字 + 浅底色，非激活态灰色文字，整体视觉轻量。
 *
 * size:
 *   - sm: 小尺寸（内嵌面板）
 *   - md: 标准尺寸（页面顶栏）
 */

export type ButtonGroupSize = 'sm' | 'md';

interface ButtonGroupItem<T extends string> {
  value: T;
  label: ReactNode;
}

interface ButtonGroupProps<T extends string> {
  items: ButtonGroupItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: ButtonGroupSize;
  className?: string;
}

const sizeStyles: Record<ButtonGroupSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

export default function ButtonGroup<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className = '',
}: ButtonGroupProps<T>) {
  return (
    <div className={`inline-flex border border-gray-200 rounded-md overflow-hidden ${className}`}>
      {items.map((item) => (
        <button
          key={item.value}
          className={`${sizeStyles[size]} font-medium border-none cursor-pointer transition-all duration-150 ${
            value === item.value
              ? 'bg-primary/10 text-primary'
              : 'bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
