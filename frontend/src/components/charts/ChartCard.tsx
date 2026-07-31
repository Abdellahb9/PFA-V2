// Card wrapper for dashboard charts: title + optional subtitle, consistent
// body height, skeleton while loading and a guided empty state.
import { Card, Empty, Skeleton, Typography } from "antd";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyHint?: string;
  /** Chart body height in px (default 280). */
  height?: number;
  children: ReactNode;
}

export default function ChartCard({
  title,
  subtitle,
  extra,
  loading,
  empty,
  emptyHint = "Aucune donnée pour le moment",
  height = 280,
  children,
}: Props) {
  return (
    <Card
      title={
        <div style={{ padding: "4px 0" }}>
          <div>{title}</div>
          {subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {subtitle}
            </Typography.Text>
          )}
        </div>
      }
      extra={extra}
    >
      <div style={{ height }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : empty ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyHint} />
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
