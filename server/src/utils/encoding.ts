/**
 * 文件编码检测与转换工具
 * 用于 CSV 文件的编码自动识别和转换，解决 GBK 等非 UTF-8 编码的乱码问题
 */

import fs from 'fs';
import path from 'path';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type { WorkBook } from 'xlsx';

/** 支持的编码列表（前端下拉框使用） */
export const SUPPORTED_ENCODINGS = [
  { value: 'auto', label: '自动检测' },
  { value: 'UTF-8', label: 'UTF-8' },
  { value: 'GBK', label: 'GBK（简体中文）' },
  { value: 'GB2312', label: 'GB2312（简体中文）' },
  { value: 'GB18030', label: 'GB18030（简体中文扩展）' },
  { value: 'Big5', label: 'Big5（繁体中文）' },
  { value: 'Shift_JIS', label: 'Shift_JIS（日文）' },
  { value: 'EUC-KR', label: 'EUC-KR（韩文）' },
  { value: 'ISO-8859-1', label: 'ISO-8859-1（西欧）' },
  { value: 'Windows-1252', label: 'Windows-1252（西欧）' },
] as const;

/**
 * 判断文件是否为 CSV 格式（根据扩展名）
 */
export function isCsvFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.csv';
}

/**
 * 检测文件编码
 * 对于 CSV 文件读取前 64KB 进行编码检测
 * 返回检测到的编码名称（如 'UTF-8', 'GBK', 'ISO-8859-1' 等）
 */
export function detectFileEncoding(filePath: string): string {
  // 读取文件前 64KB 用于检测
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(65536);
  const bytesRead = fs.readSync(fd, buffer, 0, 65536, 0);
  fs.closeSync(fd);

  const sampleBuffer = buffer.subarray(0, bytesRead);

  // 检查 BOM 标记
  if (bytesRead >= 3 && sampleBuffer[0] === 0xEF && sampleBuffer[1] === 0xBB && sampleBuffer[2] === 0xBF) {
    return 'UTF-8';
  }
  if (bytesRead >= 2 && sampleBuffer[0] === 0xFF && sampleBuffer[1] === 0xFE) {
    return 'UTF-16LE';
  }
  if (bytesRead >= 2 && sampleBuffer[0] === 0xFE && sampleBuffer[1] === 0xFF) {
    return 'UTF-16BE';
  }

  // 使用 chardet 检测
  const detected = chardet.detect(sampleBuffer);

  if (!detected) {
    return 'UTF-8'; // 检测失败默认 UTF-8
  }

  // chardet 有时返回 'ascii'，这种情况下用 UTF-8 即可兼容
  if (detected.toLowerCase() === 'ascii') {
    return 'UTF-8';
  }

  // 归一化常见编码名称
  return normalizeEncodingName(detected);
}

/**
 * 归一化编码名称，将 chardet 返回的各种名称统一为 iconv-lite 支持的名称
 */
function normalizeEncodingName(encoding: string): string {
  const upper = encoding.toUpperCase();

  // 常见映射
  const mapping: Record<string, string> = {
    'UTF8': 'UTF-8',
    'UTF-8': 'UTF-8',
    'GB2312': 'GBK',
    'GB18030': 'GB18030',
    'GBK': 'GBK',
    'BIG5': 'Big5',
    'EUC-TW': 'Big5',
    'SHIFT_JIS': 'Shift_JIS',
    'SHIFT-JIS': 'Shift_JIS',
    'EUC-JP': 'EUC-JP',
    'EUC-KR': 'EUC-KR',
    'ISO-8859-1': 'ISO-8859-1',
    'WINDOWS-1252': 'Windows-1252',
    'WINDOWS-1251': 'Windows-1251',
    'KOI8-R': 'KOI8-R',
    'UTF-16LE': 'UTF-16LE',
    'UTF-16BE': 'UTF-16BE',
  };

  return mapping[upper] || encoding;
}

/**
 * 读取 CSV 文件并转换为 UTF-8 字符串
 * @param filePath 文件路径
 * @param encoding 指定编码（'auto' 则自动检测）
 * @returns { content: 解码后的 UTF-8 字符串, detectedEncoding: 实际使用的编码 }
 */
export function readCsvAsUtf8(filePath: string, encoding: string = 'auto'): { content: string; detectedEncoding: string } {
  const rawBuffer = fs.readFileSync(filePath);

  // 确定编码
  let actualEncoding = encoding;
  if (!encoding || encoding === 'auto') {
    actualEncoding = detectFileEncoding(filePath);
  }

  // 如果已是 UTF-8，直接解码（去除可能的 BOM）
  if (actualEncoding.toUpperCase() === 'UTF-8') {
    let buf = rawBuffer;
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      buf = buf.subarray(3);
    }
    return { content: buf.toString('utf-8'), detectedEncoding: 'UTF-8' };
  }

  // 使用 iconv-lite 转码为字符串
  const decoded = iconv.decode(rawBuffer, actualEncoding);

  return { content: decoded, detectedEncoding: actualEncoding };
}

/**
 * 使用 XLSX 库以指定编码解析 CSV/Excel 文件
 * 对于 CSV 文件先做编码转换再交给 XLSX 解析
 * 对于 xlsx/xls 文件直接用 XLSX.readFile（它们有内置编码信息）
 */
export function readWorkbookWithEncoding(filePath: string, encoding: string = 'auto'): { workbook: WorkBook; detectedEncoding: string } {
  // xlsx/xls 文件本身包含编码信息，XLSX 库可以正确处理
  if (!isCsvFile(filePath)) {
    const XLSX = require('xlsx') as typeof import('xlsx');
    return { workbook: XLSX.readFile(filePath), detectedEncoding: 'N/A' };
  }

  // CSV 文件：先转码为 UTF-8 字符串，再用 type: 'string' 交给 XLSX 解析
  const { content, detectedEncoding } = readCsvAsUtf8(filePath, encoding);

  const XLSX = require('xlsx') as typeof import('xlsx');
  const workbook = XLSX.read(content, { type: 'string' });

  return { workbook, detectedEncoding };
}
