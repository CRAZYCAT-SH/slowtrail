import { useState } from 'react';

export interface HeatmapDataPoint {
  dayOfWeek: number; // 0=周一, 6=周日
  hour: number; // 0-23
  count: number;
}

interface HeatmapChartProps {
  data: HeatmapDataPoint[];
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}`);

/**
 * 根据 count 值和最大值计算颜色
 * 无数据：浅灰；有数据：从浅绿到深红线性映射
 */
function getColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return '#f0f0f0';

  const ratio = count / maxCount;

  // 从浅绿(#e8f5e9) → 黄(#fff9c4) → 橙(#ffe0b2) → 红(#e53935) 渐变
  if (ratio <= 0.25) {
    // 浅绿到绿
    const t = ratio / 0.25;
    return interpolateColor('#e8f5e9', '#66bb6a', t);
  } else if (ratio <= 0.5) {
    // 绿到黄
    const t = (ratio - 0.25) / 0.25;
    return interpolateColor('#66bb6a', '#fdd835', t);
  } else if (ratio <= 0.75) {
    // 黄到橙
    const t = (ratio - 0.5) / 0.25;
    return interpolateColor('#fdd835', '#ff8f00', t);
  } else {
    // 橙到红
    const t = (ratio - 0.75) / 0.25;
    return interpolateColor('#ff8f00', '#e53935', t);
  }
}

/** 线性插值两个十六进制颜色 */
function interpolateColor(color1: string, color2: string, t: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 7×24 网格热力图组件
 * X轴: 0-23 小时，Y轴: 周一-周日
 */
export default function HeatmapChart({ data }: HeatmapChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // 构建 7×24 数据矩阵
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxCount = 0;
  data.forEach(({ dayOfWeek, hour, count }) => {
    if (dayOfWeek >= 0 && dayOfWeek <= 6 && hour >= 0 && hour <= 23) {
      matrix[dayOfWeek][hour] = count;
      if (count > maxCount) maxCount = count;
    }
  });

  function handleMouseEnter(e: React.MouseEvent, day: number, hour: number) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const count = matrix[day][hour];
    const hourEnd = hour + 1;
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      text: `${DAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00-${String(hourEnd).padStart(2, '0')}:00，${count} 条慢 SQL`,
    });
  }

  function handleMouseLeave() {
    setTooltip(null);
  }

  return (
    <div className="relative">
      {/* 图例 */}
      <div className="flex items-center justify-end gap-1.5 mb-2 text-[11px] text-gray-400">
        <span>少</span>
        <div className="w-[100px] h-2.5 rounded-sm" style={{ background: 'linear-gradient(to right, #e8f5e9, #66bb6a, #fdd835, #ff8f00, #e53935)' }} />
        <span>多</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {/* 小时标签 */}
        <div className="flex gap-0.5 mb-0.5">
          <div className="w-8 shrink-0" />
          {HOUR_LABELS.map((label, i) => (
            <div key={i} className="flex-1 min-w-0 text-center text-[10px] text-gray-400">
              {i % 2 === 0 ? label : ''}
            </div>
          ))}
        </div>

        {/* 网格行 */}
        {DAY_LABELS.map((dayLabel, dayIdx) => (
          <div key={dayIdx} className="flex gap-0.5">
            <div className="w-8 shrink-0 flex items-center text-[11px] text-gray-500">{dayLabel}</div>
            {Array.from({ length: 24 }, (_, hourIdx) => (
              <div
                key={hourIdx}
                className="flex-1 min-w-0 aspect-square rounded-sm cursor-pointer transition-transform hover:scale-130 hover:shadow-md hover:z-10 hover:relative"
                style={{ backgroundColor: getColor(matrix[dayIdx][hourIdx], maxCount) }}
                onMouseEnter={(e) => handleMouseEnter(e, dayIdx, hourIdx)}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed -translate-x-1/2 -translate-y-full bg-black/85 text-white px-2.5 py-1.5 rounded text-xs whitespace-nowrap pointer-events-none z-[1000]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
