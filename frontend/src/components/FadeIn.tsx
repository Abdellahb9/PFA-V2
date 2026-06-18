// Tiny wrapper that fades its children in once mounted (smooth content reveal).
import type { CSSProperties, ReactNode } from "react";

interface Props {
  children: ReactNode;
  style?: CSSProperties;
}

export default function FadeIn({ children, style }: Props) {
  return (
    <div className="phos-fade-in" style={style}>
      {children}
    </div>
  );
}
