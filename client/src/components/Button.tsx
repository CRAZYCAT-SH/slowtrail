import { type ButtonHTMLAttributes, forwardRef } from 'react';

/**
 * 统一按钮组件 — 现代简约风
 *
 * 设计原则：
 *   - 白底 + 细边框为基础，视觉克制
 *   - 文字颜色区分语义，不靠填充色
 *   - hover 微妙反馈（边框加深 + 浅底色）
 *   - primary 例外：填充主色，用于页面最重要的 CTA
 *
 * variant:
 *   - primary: 主色填充（仅用于最重要的操作，如"拉取数据""确认"）
 *   - secondary: 白底灰边框（大部分操作按钮）
 *   - danger: 白底灰边框 + 红色文字（删除、清空）
 *
 * size:
 *   - sm: 小尺寸 — 表格行内、面板内
 *   - md: 标准尺寸 — 页面级
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary/10 text-primary border border-transparent hover:border-primary/30 hover:bg-primary/20',
  secondary:
    'bg-gray-50 text-gray-600 border border-transparent hover:border-gray-200 hover:bg-gray-100',
  danger:
    'bg-red-50/50 text-red-500 border border-transparent hover:border-red-200 hover:bg-red-50',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1 text-xs rounded-md',
  md: 'px-4 py-1.5 text-sm rounded-md',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', children, ...props }, ref) => {
    const baseClasses = [
      'inline-flex items-center justify-center',
      'font-medium cursor-pointer',
      'transition-all duration-150 whitespace-nowrap',
      'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
    ].join(' ');

    const classes = `${baseClasses} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`.trim();

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
