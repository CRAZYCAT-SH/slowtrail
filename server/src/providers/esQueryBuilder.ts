/**
 * ES 查询构造器
 * 生成 bool filter（range + term）结构，字段名全部取自 fieldMapping 与 keywordSuffix
 * 两个 ES 类 Provider 共用此模块
 */

import { EsSettings } from './types';

export interface SearchBody {
  query: {
    bool: {
      filter: Array<Record<string, unknown>>;
    };
  };
  sort: Array<Record<string, unknown>>;
  search_after?: unknown[];
}

/**
 * 构建搜索请求体
 * @param settings ES 类 settings
 * @param instanceName 实例名（可选，不传则不加 term 过滤）
 * @param startTime 开始时间（含），毫秒时间戳
 * @param endTime 结束时间（不含），毫秒时间戳
 * @param searchAfter search_after 分页游标（可选）
 */
export function buildSearchBody(
  settings: EsSettings,
  instanceName: string | undefined,
  startTime: number,
  endTime: number,
  searchAfter?: unknown[]
): SearchBody {
  const { fieldMapping, keywordSuffix } = settings;
  const tsField = fieldMapping.timestamp;

  const filter: Array<Record<string, unknown>> = [];

  // 时间范围过滤
  filter.push({
    range: {
      [tsField]: {
        gte: startTime,
        lt: endTime,
        format: 'epoch_millis',
      },
    },
  });

  // 实例名过滤
  if (instanceName) {
    const instanceField = fieldMapping.instanceName + keywordSuffix;
    filter.push({
      term: {
        [instanceField]: instanceName,
      },
    });
  }

  const body: SearchBody = {
    query: {
      bool: {
        filter,
      },
    },
    sort: [
      { [tsField]: 'asc' },
      { _doc: 'asc' },
    ],
  };

  if (searchAfter) {
    body.search_after = searchAfter;
  }

  return body;
}

/**
 * 构建 terms aggregation 请求体（用于 getInstanceNames）
 * @param settings ES 类 settings
 * @param aggSize 聚合桶数上限
 */
export function buildInstanceNamesAggBody(settings: EsSettings, aggSize: number = 500): Record<string, unknown> {
  const instanceField = settings.fieldMapping.instanceName + settings.keywordSuffix;

  return {
    size: 0,
    aggs: {
      instance_names: {
        terms: {
          field: instanceField,
          size: aggSize,
          order: { _key: 'asc' },
        },
      },
    },
  };
}
