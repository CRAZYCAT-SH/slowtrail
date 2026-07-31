import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

/**
 * 通用 URL 查询参数管理 hook
 * 将组件状态同步到 URL query string，支持部分更新和默认值
 */
export function useQueryParams<T extends Record<string, string>>(
  defaults: T
): [T, (updates: Partial<T>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 读取参数，不存在则使用默认值
  const params = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = searchParams.get(key);
      if (value !== null) {
        (result as Record<string, string>)[key] = value;
      }
    }
    return result;
  }, [searchParams, defaults]);

  // 部分更新参数，使用 replace 模式避免产生大量历史记录
  const setParams = useCallback(
    (updates: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === '' || value === null) {
              next.delete(key);
            } else {
              next.set(key, value as string);
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return [params, setParams];
}
