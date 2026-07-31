/**
 * Provider 注册表
 * 根据 type 获取对应的 DataSourceProvider 实现
 */

import { DataSourceProvider } from './types';
import { kibanaProxyProvider } from './kibanaProxyProvider';
import { directESProvider } from './directESProvider';
import { excelProvider } from './excelProvider';

// 注册所有 provider
const providerRegistry = new Map<string, DataSourceProvider>();
providerRegistry.set(kibanaProxyProvider.type, kibanaProxyProvider);
providerRegistry.set(directESProvider.type, directESProvider);
providerRegistry.set(excelProvider.type, excelProvider);

/**
 * 获取指定类型的 Provider 实例
 * @throws 如果类型不存在
 */
export function getProvider(type: string): DataSourceProvider {
  const provider = providerRegistry.get(type);
  if (!provider) {
    throw new Error(`未知的数据源类型: ${type}。已注册类型: ${Array.from(providerRegistry.keys()).join(', ')}`);
  }
  return provider;
}

/**
 * 获取所有已注册的 Provider 列表
 */
export function listProviders(): DataSourceProvider[] {
  return Array.from(providerRegistry.values());
}

// 导出所有类型和子模块
export * from './types';
export * from './indexResolver';
export * from './esQueryBuilder';
export * from './esNormalizer';
