/**
 * 数据源表单组件注册表
 * 按类型映射到对应的表单组件
 * 新增数据源类型只需加一行
 */

import type { ComponentType } from 'react';
import type { DataSourceSettings } from '../../api';

export interface DataSourceFormProps {
  settings: DataSourceSettings;
  onChange: (settings: DataSourceSettings) => void;
  /** 是否为编辑模式（密码字段留空表示不修改） */
  isEdit?: boolean;
  /** 已保存数据源的 ID（编辑模式下传入，用于获取字段时使用真实密码） */
  dataSourceId?: number;
}

// 延迟导入避免循环依赖
const registry: Record<string, () => Promise<{ default: ComponentType<DataSourceFormProps> }>> = {
  kibana_proxy: () => import('./KibanaProxyForm'),
  direct_es: () => import('./DirectESForm'),
  excel: () => import('./ExcelForm'),
};

/**
 * 获取指定类型的表单组件（动态导入）
 */
export async function getFormComponent(type: string): Promise<ComponentType<DataSourceFormProps> | null> {
  const loader = registry[type];
  if (!loader) return null;
  const mod = await loader();
  return mod.default;
}

/**
 * 获取已注册的类型列表
 */
export function getRegisteredTypes(): string[] {
  return Object.keys(registry);
}
