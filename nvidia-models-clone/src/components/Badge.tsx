import type { ReactNode } from "react";

type Variant = "blue" | "purple";

const VARIANTS: Record<Variant, string> = {
  blue: "text-badge-blue border-badge-blue/30 bg-badge-blue/10",
  purple: "text-badge-purple border-badge-purple/30 bg-badge-purple/10",
};

export default function Badge({
  variant,
  children,
}: {
  variant: Variant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}
