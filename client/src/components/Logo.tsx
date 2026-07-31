interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * 星河逐影 (XingHeZhuYing) 雷达扫描 Logo
 * 紫色 #6c63ff → 青色 #06b6d4 渐变，含半透明影子目标点
 */
export default function Logo({ className = '', size = 28 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* 主渐变：紫 → 青 */}
        <linearGradient id="zhuying-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6c63ff" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        {/* 扫描扇形渐变（带透明度） */}
        <linearGradient id="zhuying-scan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6c63ff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.15" />
        </linearGradient>
        {/* 影子渐变 */}
        <radialGradient id="zhuying-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6c63ff" stopOpacity="0.7" />
          <stop offset="70%" stopColor="#4338ca" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 外圆弧 - 雷达范围（3/4 圆弧） */}
      <path
        d="M 16 3 A 13 13 0 1 1 3 16"
        stroke="url(#zhuying-gradient)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* 中圈圆弧 */}
      <circle
        cx="16"
        cy="16"
        r="9"
        stroke="url(#zhuying-gradient)"
        strokeWidth="1.2"
        strokeOpacity="0.5"
        fill="none"
      />

      {/* 内圈圆弧 */}
      <circle
        cx="16"
        cy="16"
        r="5"
        stroke="url(#zhuying-gradient)"
        strokeWidth="1"
        strokeOpacity="0.3"
        fill="none"
      />

      {/* 扫描扇形区域（60° 扇形，从中心向右上方） */}
      <path
        d="M 16 16 L 27.26 9.5 A 13 13 0 0 0 22.5 4.74 Z"
        fill="url(#zhuying-scan)"
      />

      {/* 扫描线（从中心到外圈的径向线） */}
      <line
        x1="16"
        y1="16"
        x2="27.26"
        y2="9.5"
        stroke="url(#zhuying-gradient)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />

      {/* 中心亮点 */}
      <circle
        cx="16"
        cy="16"
        r="2"
        fill="url(#zhuying-gradient)"
      />

      {/* 半透明"影"形目标 — 被追踪的慢查询之影 */}
      <ellipse
        cx="22"
        cy="10"
        rx="3"
        ry="4"
        fill="url(#zhuying-shadow)"
        transform="rotate(-20 22 10)"
      />
      <circle
        cx="22"
        cy="10"
        r="1.2"
        fill="#06b6d4"
        opacity="0.9"
      />
    </svg>
  );
}
