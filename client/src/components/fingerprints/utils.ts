/**
 * 格式化秒数为可读的时间字符串
 */
export function formatTime(seconds: number): string {
  if (seconds >= 1) return seconds.toFixed(2) + 's';
  return (seconds * 1000).toFixed(1) + 'ms';
}
