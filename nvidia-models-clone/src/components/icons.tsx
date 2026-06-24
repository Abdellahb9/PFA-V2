// Small stroke-based SVG icons (no icon-library dependency).
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);

export const FunnelIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const ChevronsLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m11 6-6 6 6 6M18 6l-6 6 6 6" />
  </svg>
);

export const ChevronsRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m13 6 6 6-6 6M6 6l6 6-6 6" />
  </svg>
);

export const ChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const ArrowUpRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const HexagonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
  </svg>
);

// Stylized NVIDIA "eye" logo mark in brand green.
export const NvidiaMark = (p: IconProps) => (
  <svg viewBox="0 0 40 24" width={40} height={24} fill="none" {...p}>
    <path
      d="M14.6 7.4c2.9-1.6 6.6-1.4 9.2.6 2.6 2 3.7 5.4 2.8 8.5 1.9-3 1.7-7-.7-9.8-2.7-3.2-7.2-4.2-11-2.6C10.7 5.9 7.8 9.4 7.4 13.5c1-3 3.4-5.4 7.2-6.1Z"
      fill="#76B900"
    />
    <path
      d="M16.8 10.2c2-.5 4 .6 4.7 2.5.7 1.9-.2 4-2 4.9 2.4-.4 4-2.7 3.6-5.1-.4-2.5-2.8-4.1-5.2-3.6-1.8.3-3.2 1.7-3.6 3.5.5-1.2 1.4-2.2 2.5-2.7Z"
      fill="#76B900"
    />
  </svg>
);
