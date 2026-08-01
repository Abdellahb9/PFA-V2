// Booked offers: which offer each intern occupies, and for which period.
// Bookings are grouped by the month their internship starts so the calendar
// reads top-to-bottom, and the period filter keeps everything that OVERLAPS
// the window (a running internship still shows in the month you ask for).
import { useMemo, useState } from "react";
import { Card, DatePicker, Empty, Select, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import { CalendarOutlined, UserOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useBookings } from "@/api/hooks";
import SkeletonTable from "@/components/SkeletonTable";
import type { Booking } from "@/api/types";

const { RangePicker } = DatePicker;

const STATUS_META: Record<string, { label: string; color: string }> = {
  confirmed: { label: "Confirmée", color: "green" },
  proposed: { label: "Proposée", color: "gold" },
  rejected: { label: "Rejetée", color: "red" },
};

const fmt = (iso: string | null) => (iso ? dayjs(iso).format("DD/MM/YYYY") : "—");

// "2026-09" -> "septembre 2026" (capitalised), used as the group heading.
const monthLabel = (key: string) => {
  if (key === "undated") return "Sans période renseignée";
  const d = dayjs(`${key}-01`);
  const s = d.format("MMMM YYYY");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function BookingsPage() {
  const [status, setStatus] = useState<string>("confirmed");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const { token } = theme.useToken();

  const { data, isLoading, isFetching } = useBookings({
    status,
    from: range?.[0]?.format("YYYY-MM-DD"),
    to: range?.[1]?.format("YYYY-MM-DD"),
  });

  // Group by starting month, preserving the API's chronological order.
  const groups = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of data ?? []) {
      const key = b.start_date ? b.start_date.slice(0, 7) : "undated";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return [...map.entries()];
  }, [data]);

  const columns = [
    {
      title: "Stagiaire",
      key: "person",
      render: (_: unknown, r: Booking) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>
            <UserOutlined style={{ color: token.colorPrimary, marginRight: 6 }} />
            {r.person_name}
          </span>
          {r.person_email && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.person_email}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "Offre réservée",
      key: "offer",
      render: (_: unknown, r: Booking) => (
        <Space direction="vertical" size={0}>
          <span>{r.offer_title}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.department_name ?? "—"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Période",
      key: "period",
      render: (_: unknown, r: Booking) =>
        r.start_date ? (
          <span className="tabular-nums">
            {fmt(r.start_date)} → {fmt(r.end_date)}
          </span>
        ) : (
          <Tooltip title="Cette candidature date d'avant l'ajout de la période.">
            <Typography.Text type="secondary">Non renseignée</Typography.Text>
          </Tooltip>
        ),
    },
    {
      title: "Durée",
      dataIndex: "duration_months",
      key: "duration",
      width: 100,
      render: (v: number | null) => (v ? `${v} mois` : "—"),
    },
    {
      title: "Statut",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (s: string) => (
        <Tag color={STATUS_META[s]?.color}>{STATUS_META[s]?.label ?? s}</Tag>
      ),
    },
  ];

  return (
    <Card
      title="Offres réservées"
      extra={
        <Space wrap>
          <RangePicker
            format="DD/MM/YYYY"
            placeholder={["Début de période", "Fin de période"]}
            value={range}
            onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
          />
          <Select
            style={{ width: 160 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: "confirmed", label: "Confirmées" },
              { value: "proposed", label: "Proposées" },
              { value: "all", label: "Toutes" },
            ]}
          />
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        Chaque ligne est une place d'offre occupée par un stagiaire sur la période qu'il a
        demandée en postulant. Le filtre conserve les réservations qui chevauchent la période
        choisie, pas seulement celles qui y commencent.
      </Typography.Paragraph>

      {isLoading ? (
        <SkeletonTable<Booking> rowKey="assignment_id" loading columns={columns} />
      ) : !groups.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Aucune offre réservée sur cette période"
        />
      ) : (
        groups.map(([key, rows]) => (
          <div key={key} style={{ marginBottom: 24 }}>
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              <CalendarOutlined style={{ color: token.colorPrimary, marginRight: 8 }} />
              {monthLabel(key)}
              <Typography.Text type="secondary" style={{ fontWeight: 400, marginLeft: 8 }}>
                {rows.length} réservation{rows.length > 1 ? "s" : ""}
              </Typography.Text>
            </Typography.Title>
            <Table<Booking>
              rowKey="assignment_id"
              dataSource={rows}
              columns={columns}
              pagination={false}
              size="small"
              loading={isFetching && !isLoading}
              // Scroll inside the card on narrow viewports instead of widening the page.
              scroll={{ x: "max-content" }}
            />
          </div>
        ))
      )}
    </Card>
  );
}
