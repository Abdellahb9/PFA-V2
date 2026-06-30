// Predictive capacity planning (advisory). Forecasts internship demand per
// department and suggests slot allocation. The model proposes — capacity/slots
// stay manual. Degrades gracefully on cold start (thin history).
import { Card, Table, Tag, Alert, Tooltip } from "antd";
import { useCapacityForecast } from "@/api/hooks";
import type { DepartmentForecast } from "@/api/types";

export default function CapacityForecastPanel() {
  const { data, isLoading } = useCapacityForecast();

  const columns = [
    { title: "Département", dataIndex: "department", key: "department" },
    {
      title: "Demande (12 mois)",
      dataIndex: "total_applications_12m",
      key: "total",
    },
    {
      title: "Prévision (mois prochain)",
      dataIndex: "forecast_demand",
      key: "forecast",
      render: (v: number, r: DepartmentForecast) => (r.cold_start ? <Tag>—</Tag> : <b>{v}</b>),
    },
    { title: "Slots actuels", dataIndex: "current_slots", key: "current" },
    {
      title: "Slots recommandés",
      key: "recommended",
      render: (_: unknown, r: DepartmentForecast) => {
        if (r.cold_start) return <Tag>historique insuffisant</Tag>;
        const delta = r.recommended_slots - r.current_slots;
        const color = delta > 0 ? "green" : delta < 0 ? "orange" : "default";
        const label =
          delta === 0
            ? "Aucun changement suggéré"
            : `${delta > 0 ? "+" : ""}${delta} slot(s) suggéré(s)`;
        return (
          <Tooltip title={label}>
            <Tag color={color}>
              {r.recommended_slots}
              {delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}
            </Tag>
          </Tooltip>
        );
      },
    },
  ];

  const modelTag =
    data?.model === "xgboost" ? (
      <Tag color="green">XGBoost</Tag>
    ) : data?.model ? (
      <Tag>heuristique</Tag>
    ) : null;

  return (
    <Card
      title={<span>Planification de capacité — prévision (IA) {modelTag}</span>}
      style={{ marginTop: 16 }}
      loading={isLoading}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Le modèle propose, vous décidez."
        description="Prévision de la demande par département (moyenne mobile pondérée + tendance sur 12 mois). La capacité et les slots restent modifiables manuellement — rien n'est appliqué automatiquement."
      />
      {data?.cold_start_global ? (
        <Alert
          type="warning"
          showIcon
          message="Historique insuffisant pour des recommandations fiables — à reconsulter une fois plus de candidatures collectées."
        />
      ) : (
        <Table<DepartmentForecast>
          rowKey="department_id"
          dataSource={data?.departments}
          columns={columns}
          pagination={false}
          size="small"
        />
      )}
    </Card>
  );
}
