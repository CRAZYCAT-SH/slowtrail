/**
 * 格式化秒数为可读的时间字符串
 */
export function formatTime(seconds: number): string {
  if (seconds >= 1) return seconds.toFixed(2) + 's';
  return (seconds * 1000).toFixed(1) + 'ms';
}

/**
 * 格式化可空的耗时字段：null / undefined 显示为 '-'
 */
export function formatTimeOrDash(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  return formatTime(seconds);
}

/**
 * 格式化可空的数值字段（带千分位）：null / undefined 显示为 '-'
 */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return '-';
  return value.toLocaleString();
}

/**
 * 格式化可空的文本字段：空字符串、null、undefined 统一显示为 '-'
 */
export function formatText(value: string | null | undefined): string {
  if (value == null || value === '') return '-';
  return value;
}
