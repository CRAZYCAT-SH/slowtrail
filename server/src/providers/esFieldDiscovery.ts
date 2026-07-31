/**
 * ES 索引字段发现
 * 解析 _mapping 响应，提取字段列表供前端字段映射下拉使用
 */

import { IndexFieldInfo } from './types';

/**
 * 从 ES _mapping 响应中提取所有字段名和类型
 * 合并多个索引的 mapping，取第一个索引的定义（同模板索引结构相同）
 */
export function extractFieldsFromMapping(mappingResponse: Record<string, unknown>): IndexFieldInfo[] {
  const fields: Map<string, string> = new Map();

  // mappingResponse 结构: { "index_name": { "mappings": { "properties": { ... } } } }
  const indices = Object.values(mappingResponse);
  if (indices.length === 0) return [];

  // 取第一个索引的 mapping
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstIndex = indices[0] as any;
  const properties = firstIndex?.mappings?.properties;
  if (!properties) return [];

  // 递归收集字段（支持嵌套 object 类型）
  function collectFields(props: Record<string, unknown>, prefix: string) {
    for (const [name, meta] of Object.entries(props)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldMeta = meta as any;
      const fullName = prefix ? `${prefix}.${name}` : name;

      if (fieldMeta.properties) {
        // object/nested 类型，递归收集子字段
        collectFields(fieldMeta.properties, fullName);
      } else {
        const fieldType = fieldMeta.type || 'object';
        fields.set(fullName, fieldType);
        // 如果是 text 字段带 .keyword 等子字段，也加上
        if (fieldMeta.fields) {
          for (const [subName, subMeta] of Object.entries(fieldMeta.fields)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const subType = (subMeta as any).type || 'keyword';
            fields.set(`${fullName}.${subName}`, subType);
          }
        }
      }
    }
  }

  collectFields(properties, '');

  return Array.from(fields.entries())
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
