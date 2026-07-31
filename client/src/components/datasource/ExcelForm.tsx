/**
 * Excel / CSV 数据源表单
 * 文件上传 + 列映射配置
 */

import { useState, useCallback } from 'react';
import type { DataSourceFormProps } from './formRegistry';
import { dataSourceApi } from '../../api';
import Select from '../Select';

/** 列映射字段定义 */
const MAPPING_FIELDS = [
  { key: 'querySql', label: 'SQL 语句', required: true },
  { key: 'queryTime', label: '查询耗时(秒)', required: true },
  { key: 'timestamp', label: '时间戳', required: false },
  { key: 'dbName', label: '数据库名', required: false },
  { key: 'instanceName', label: '实例名', required: false },
  { key: 'lockTime', label: '锁等待时间', required: false },
  { key: 'rowsExamined', label: '扫描行数', required: false },
  { key: 'rowsSent', label: '返回行数', required: false },
  { key: 'userName', label: '用户名', required: false },
  { key: 'userHost', label: '用户主机', required: false },
] as const;

export default function ExcelForm({ settings, onChange }: DataSourceFormProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [headers, setHeaders] = useState<string[]>(settings._parsedHeaders as string[] || []);
  const [previewRows, setPreviewRows] = useState<string[][]>(settings._previewRows as string[][] || []);
  const [sheetNames, setSheetNames] = useState<string[]>(settings._sheetNames as string[] || []);
  const [totalRows, setTotalRows] = useState<number>(settings._totalRows as number || 0);

  const columnMapping = (settings.columnMapping || {}) as Record<string, string>;

  /** 处理文件上传 */
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await dataSourceApi.upload(formData);
      if (res.data.success) {
        const { filePath, originalFileName, headers: h, sheetNames: sheets, previewRows: preview, totalRows: rows } = res.data.data;

        setHeaders(h);
        setPreviewRows(preview);
        setSheetNames(sheets);
        setTotalRows(rows);

        // 更新 settings
        onChange({
          ...settings,
          filePath,
          originalFileName,
          sheetName: sheets[0] || '',
          // 保留已有的 columnMapping，但重置不匹配的列
          columnMapping: resetMappingForNewHeaders(columnMapping, h),
          // 缓存解析结果供组件内部使用（不会存到后端）
          _parsedHeaders: h,
          _previewRows: preview,
          _sheetNames: sheets,
          _totalRows: rows,
        });
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      setUploadError(error.response?.data?.error || error.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [settings, onChange, columnMapping]);

  /** 切换 sheet */
  const handleSheetChange = useCallback(async (sheetName: string) => {
    if (!settings.filePath) return;

    try {
      const res = await dataSourceApi.uploadHeaders(settings.filePath as string, sheetName);
      if (res.data.success) {
        const { headers: h, previewRows: preview, totalRows: rows } = res.data.data;
        setHeaders(h);
        setPreviewRows(preview);
        setTotalRows(rows);
        onChange({
          ...settings,
          sheetName,
          columnMapping: resetMappingForNewHeaders(columnMapping, h),
          _parsedHeaders: h,
          _previewRows: preview,
          _totalRows: rows,
        });
      }
    } catch {
      // 静默处理
    }
  }, [settings, onChange, columnMapping]);

  /** 更新列映射 */
  const handleMappingChange = useCallback((fieldKey: string, columnName: string) => {
    const newMapping = { ...columnMapping, [fieldKey]: columnName };
    onChange({ ...settings, columnMapping: newMapping });
  }, [settings, onChange, columnMapping]);

  return (
    <div className="space-y-4">
      {/* 文件上传区域 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          文件 <span className="text-red-400">*</span>
        </label>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer inline-flex items-center px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {uploading ? '上传中...' : '选择文件'}
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
          {Boolean(settings.originalFileName) && (
            <span className="text-sm text-gray-600 truncate max-w-[280px]" title={String(settings.originalFileName)}>
              {String(settings.originalFileName)}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1">支持 .xlsx, .xls, .csv 格式，最大 50MB</p>
        {uploadError && (
          <p className="text-xs text-red-500 mt-1">{uploadError}</p>
        )}
      </div>

      {/* 工作表选择（多 sheet 时显示） */}
      {sheetNames.length > 1 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">工作表</label>
          <Select
            value={(settings.sheetName as string) || sheetNames[0]}
            onChange={handleSheetChange}
            options={sheetNames.map((s) => ({ value: s, label: s }))}
            className="w-full"
          />
        </div>
      )}

      {/* 文件信息 */}
      {headers.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-md px-3 py-2">
          共 {totalRows} 行数据 · {headers.length} 列
        </div>
      )}

      {/* 列映射配置 */}
      {headers.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-2">列映射配置</label>
          <div className="space-y-2">
            {MAPPING_FIELDS.map(({ key, label, required }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 shrink-0">
                  {label}
                  {required && <span className="text-red-400 ml-0.5">*</span>}
                </span>
                <Select
                  value={columnMapping[key] || ''}
                  onChange={(val) => handleMappingChange(key, val)}
                  options={[
                    { value: '', label: required ? '-- 请选择 --' : '-- 不映射 --' },
                    ...headers.map((h) => ({ value: h, label: h })),
                  ]}
                  className="flex-1"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 数据预览 */}
      {previewRows.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">数据预览（前 5 行）</label>
          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50">
                  {headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap border-b border-gray-200">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-gray-50">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 text-gray-700 whitespace-nowrap border-b border-gray-100 max-w-[200px] truncate" title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 当表头变更时，保留仍有效的映射，清除无效列
 */
function resetMappingForNewHeaders(
  currentMapping: Record<string, string>,
  newHeaders: string[]
): Record<string, string> {
  const headerSet = new Set(newHeaders);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(currentMapping)) {
    result[key] = headerSet.has(value) ? value : '';
  }
  return result;
}
