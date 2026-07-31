/**
 * Kibana Proxy Provider
 * 通过 Kibana 的代理端点（默认 /api/console/proxy）访问 ES
 */

import axios, { AxiosInstance } from 'axios';
import {
  DataSourceProvider,
  InstanceEnumerable,
  ConfigPreviewable,
  FieldDiscoverable,
  IndexFieldInfo,
  ProviderCapabilities,
  Settings,
  FetchQuery,
  FetchBatch,
  PreviewResult,
  EsSettings,
  DEFAULT_PROXY_PATH,
  DEFAULT_INDEX_PATTERN,
  DEFAULT_KEYWORD_SUFFIX,
  DEFAULT_FIELD_MAPPING,
} from './types';
import { inferRollover, resolveIndices, resolveWildcard, renderSamples, validatePattern } from './indexResolver';
import { buildSearchBody, buildInstanceNamesAggBody } from './esQueryBuilder';
import { normalizeEsDoc } from './esNormalizer';
import { extractFieldsFromMapping } from './esFieldDiscovery';

// axios 实例缓存，按 host+proxyPath+username 做 key
const clientCache = new Map<string, AxiosInstance>();

function getClient(settings: EsSettings): AxiosInstance {
  const proxyPath = settings.proxyPath || DEFAULT_PROXY_PATH;
  const cacheKey = `${settings.host}|${proxyPath}|${settings.username || ''}`;

  let client = clientCache.get(cacheKey);
  if (client) return client;

  const config: Record<string, unknown> = {
    baseURL: settings.host,
    headers: {
      'Content-Type': 'application/json',
      'kbn-xsrf': 'true',
    },
    timeout: 30000,
  };

  if (settings.username && settings.password) {
    config.auth = { username: settings.username, password: settings.password };
  }

  // 开发环境禁用 SSL 证书验证
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https');
    config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  } catch {
    // 无 https 模块则忽略
  }

  client = axios.create(config);
  clientCache.set(cacheKey, client);
  return client;
}

/**
 * 通过 Kibana proxy 发送 ES 请求
 */
async function proxyRequest(
  settings: EsSettings,
  method: string,
  path: string,
  body?: unknown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const client = getClient(settings);
  const proxyPath = settings.proxyPath || DEFAULT_PROXY_PATH;

  const response = await client.post(proxyPath, body || undefined, {
    params: { path, method },
  });
  return response.data;
}

/**
 * 将原始 settings 解析为类型安全的 EsSettings
 */
function parseSettings(raw: Settings): EsSettings {
  return {
    host: (raw.host as string) || '',
    proxyPath: (raw.proxyPath as string) || DEFAULT_PROXY_PATH,
    username: raw.username as string | undefined,
    password: raw.password as string | undefined,
    indexPattern: (raw.indexPattern as string) || DEFAULT_INDEX_PATTERN,
    keywordSuffix: raw.keywordSuffix != null ? (raw.keywordSuffix as string) : DEFAULT_KEYWORD_SUFFIX,
    fieldMapping: {
      ...DEFAULT_FIELD_MAPPING,
      ...(raw.fieldMapping as Record<string, string> || {}),
    },
  };
}

/**
 * 每批拉取的文档数量
 */
const BATCH_SIZE = 1000;

export const kibanaProxyProvider: DataSourceProvider & InstanceEnumerable & ConfigPreviewable & FieldDiscoverable = {
  type: 'kibana_proxy',
  label: 'Kibana 代理',

  capabilities(): ProviderCapabilities {
    return {
      instanceEnumeration: true,
      configPreview: true,
    };
  },

  defaultSettings(): Settings {
    return {
      host: '',
      proxyPath: DEFAULT_PROXY_PATH,
      username: '',
      password: '',
      indexPattern: DEFAULT_INDEX_PATTERN,
      keywordSuffix: DEFAULT_KEYWORD_SUFFIX,
      fieldMapping: { ...DEFAULT_FIELD_MAPPING },
    };
  },

  secretKeys(): string[] {
    return ['password'];
  },

  validate(settings: Settings): string[] {
    const errors: string[] = [];
    const s = parseSettings(settings);

    if (!s.host) {
      errors.push('连接地址不能为空');
    }
    if (!s.indexPattern) {
      errors.push('索引模板不能为空');
    } else {
      const patternErrors = validatePattern(s.indexPattern);
      errors.push(...patternErrors);
    }

    return errors;
  },

  describe(settings: Settings): string {
    const s = parseSettings(settings);
    const rollover = inferRollover(s.indexPattern);
    const rolloverLabel: Record<string, string> = {
      none: '不切分',
      daily: '按日切分',
      monthly: '按月切分',
      yearly: '按年切分',
    };
    return `${s.host} · ${rolloverLabel[rollover]}`;
  },

  async testConnection(settings: Settings): Promise<{ connected: boolean; info?: string; error?: string }> {
    const s = parseSettings(settings);
    try {
      const info = await proxyRequest(s, 'GET', '/');
      return {
        connected: true,
        info: `Elasticsearch ${info.version?.number || 'unknown'} (${info.cluster_name || 'unknown'})`,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        connected: false,
        error: err.message || '连接失败',
      };
    }
  },

  async getInstanceNames(settings: Settings): Promise<string[]> {
    const s = parseSettings(settings);
    const wildcard = resolveWildcard(s.indexPattern);
    const body = buildInstanceNamesAggBody(s);

    try {
      const response = await proxyRequest(s, 'POST', `/${wildcard}/_search?ignore_unavailable=true&allow_no_indices=true`, body);
      const aggs = response.aggregations;
      if (!aggs || !aggs.instance_names) return [];
      const buckets = aggs.instance_names.buckets as Array<{ key: string }>;
      return buckets.map((b) => b.key);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('index_not_found_exception')) {
        return [];
      }
      throw error;
    }
  },

  async getIndexFields(settings: Settings): Promise<IndexFieldInfo[]> {
    const s = parseSettings(settings);
    const wildcard = resolveWildcard(s.indexPattern);
    try {
      const response = await proxyRequest(s, 'GET', `/${wildcard}/_mapping?ignore_unavailable=true&allow_no_indices=true`);
      return extractFieldsFromMapping(response);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('index_not_found_exception')) {
        return [];
      }
      throw error;
    }
  },

  async *fetchRecords(settings: Settings, query: FetchQuery): AsyncIterable<FetchBatch> {
    const s = parseSettings(settings);
    const target = resolveIndices(s.indexPattern, query.startTime, query.endTime);
    const searchPath = `/${target}/_search?ignore_unavailable=true&allow_no_indices=true&size=${BATCH_SIZE}`;

    let searchAfter: unknown[] | undefined;

    while (true) {
      const body = buildSearchBody(s, query.instanceName, query.startTime, query.endTime, searchAfter);
      const response = await proxyRequest(s, 'POST', searchPath, body);

      const hits = response.hits?.hits;
      if (!hits || hits.length === 0) break;

      // 归一化本批文档
      const records = hits.map((hit: { _source: Record<string, unknown> }) =>
        normalizeEsDoc(hit._source || {}, s.fieldMapping)
      );

      yield { records, sourceRef: target };

      // 获取最后一条的 sort 值用于下一页
      const lastHit = hits[hits.length - 1];
      searchAfter = lastHit.sort;

      // 返回数量小于 BATCH_SIZE 说明是最后一页
      if (hits.length < BATCH_SIZE) break;
    }
  },

  async preview(settings: Settings, startDate: string, endDate: string): Promise<PreviewResult> {
    const s = parseSettings(settings);
    const rollover = inferRollover(s.indexPattern);
    const startTime = new Date(startDate + 'T00:00:00').getTime();
    const endTime = new Date(endDate + 'T23:59:59.999').getTime();
    const resolvedTarget = resolveIndices(s.indexPattern, startTime, endTime);
    const renderedSamples = renderSamples(s.indexPattern, startDate, 5);

    // 查询实际存在的索引
    let existingIndices: string[] = [];
    try {
      // resolveWildcard 产生通配目标，用于 _cat/indices 查询实际存在哪些
      const wildcardTarget = resolveWildcard(s.indexPattern);
      const catResult = await proxyRequest(
        s, 'GET',
        `/_cat/indices/${wildcardTarget}?format=json&h=index`
      );
      if (Array.isArray(catResult)) {
        existingIndices = catResult.map((item: { index: string }) => item.index).sort();
      }
    } catch {
      // 查询失败（如索引不存在）返回空
    }

    return {
      rollover,
      resolvedTarget,
      renderedSamples,
      existingIndices,
    };
  },
};
