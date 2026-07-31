import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { statsApi } from '../api';
import type { FilterOptions } from '../api';

interface DateRangeState {
  startTime: number;
  endTime: number;
  setRange: (startTime: number, endTime: number) => void;
  // 全局筛选条件
  dbName: string;
  instanceName: string;
  setDbName: (name: string) => void;
  setInstanceName: (name: string) => void;
  // 筛选选项（数据库/实例列表）
  filterOptions: FilterOptions;
  /** 手动刷新筛选选项（如同步数据后调用） */
  refreshFilterOptions: () => void;
}

const DateRangeContext = createContext<DateRangeState | null>(null);

/**
 * 全局筛选 Provider
 * Dashboard、趋势分析、SQL 归类三个页面共享时间范围和筛选条件
 */
export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [startTime, setStartTime] = useState(() => Date.now() - 7 * 86400000);
  const [endTime, setEndTime] = useState(() => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return now.getTime();
  });

  // 全局筛选条件
  const [dbName, setDbName] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ dbNames: [], instanceNames: [] });

  const setRange = useCallback((s: number, e: number) => {
    setStartTime(s);
    setEndTime(e);
  }, []);

  // 加载筛选选项
  const refreshFilterOptions = useCallback(() => {
    statsApi.getFilterOptions().then((res) => {
      if (res.data.success) {
        setFilterOptions(res.data.data);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshFilterOptions();
  }, [refreshFilterOptions]);

  return (
    <DateRangeContext.Provider value={{
      startTime, endTime, setRange,
      dbName, instanceName, setDbName, setInstanceName,
      filterOptions, refreshFilterOptions,
    }}>
      {children}
    </DateRangeContext.Provider>
  );
}

/**
 * 获取共享的日期范围和筛选条件
 */
export function useDateRange(): DateRangeState {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    throw new Error('useDateRange 必须在 DateRangeProvider 内使用');
  }
  return ctx;
}
