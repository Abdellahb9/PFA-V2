// Small KPI display card used on the dashboard.
import { Card, Statistic } from "antd";
import { ReactNode } from "react";

interface Props {
  title: string;
  value: number | string;
  suffix?: string;
  precision?: number;
  icon?: ReactNode;
  color?: string;
}

export default function KpiCard({ title, value, suffix, precision, icon, color }: Props) {
  return (
    <Card>
      <Statistic
        title={title}
        value={value}
        precision={precision}
        suffix={suffix}
        prefix={icon}
        valueStyle={{ color: color ?? "#76B900", fontWeight: 700 }}
      />
    </Card>
  );
}
