// Admin dashboard: KPI tiles + theme-aware Recharts visualisations.
import { Col, Row, Card, Spin, Empty, Table, Progress, Typography, theme } from "antd";
import {
  TeamOutlined,
  FileTextOutlined,
  DeploymentUnitOutlined,
  PercentageOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import KpiCard from "@/components/KpiCard";
import FadeIn from "@/components/FadeIn";
import ChartCard from "@/components/charts/ChartCard";
import ChartTooltip from "@/components/charts/ChartTooltip";
import CapacityForecastPanel from "@/components/CapacityForecastPanel";
import useChartTheme from "@/theme/useChartTheme";
import { useDashboard } from "@/api/hooks";
import type { DepartmentStat } from "@/api/types";

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const chart = useChartTheme();
  const { token } = theme.useToken();

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        style={{ textAlign: "center", padding: 80 }}
      >
        <Spin size="large" />
        <span className="sr-only">Chargement du tableau de bord…</span>
      </div>
    );
  }
  if (!data) return <Empty description="Aucune donnée" />;

  const { kpis } = data;
  const totalStatus = data.applications_by_status.reduce((sum, s) => sum + s.value, 0);
  const monthlyValues = data.monthly_applications.map((m) => m.value);

  const fillRateColor = (rate: number) =>
    rate >= 0.7 ? chart.semantic.success : rate >= 0.4 ? chart.semantic.warning : chart.semantic.danger;

  const deptColumns = [
    { title: "Département", dataIndex: "department", key: "department" },
    { title: "Capacité", dataIndex: "capacity", key: "capacity", className: "tabular-nums" },
    { title: "Affectés", dataIndex: "assigned", key: "assigned", className: "tabular-nums" },
    {
      title: "Taux de remplissage",
      dataIndex: "fill_rate",
      key: "fill_rate",
      width: 240,
      render: (v: number) => (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Progress
            percent={Math.round(v * 100)}
            showInfo={false}
            strokeColor={fillRateColor(v)}
            size={{ height: 6 }}
            style={{ flex: 1, margin: 0 }}
          />
          <span className="tabular-nums" style={{ width: 44, textAlign: "right" }}>
            {Math.round(v * 100)} %
          </span>
        </div>
      ),
    },
  ];

  return (
    <FadeIn>
      {/* --- Page header --- */}
      <div style={{ marginBottom: 20 }}>
        <Typography.Title level={3} style={{ marginBottom: 2 }}>
          Tableau de bord
        </Typography.Title>
        <Typography.Text type="secondary">
          Vue d'ensemble du recrutement —{" "}
          {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
        </Typography.Text>
      </div>

      {/* --- KPI row --- */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title="Candidats" value={kpis.total_candidates} icon={<TeamOutlined />} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="Candidatures"
            value={kpis.total_applications}
            icon={<FileTextOutlined />}
            accent="info"
            spark={monthlyValues}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="Taux d'affectation"
            value={kpis.assignment_rate * 100}
            precision={1}
            suffix="%"
            icon={<PercentageOutlined />}
            accent="purple"
            progress={kpis.assignment_rate * 100}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="Score moyen"
            value={kpis.average_match_score * 100}
            precision={1}
            suffix="%"
            icon={<DeploymentUnitOutlined />}
            accent="warning"
            progress={kpis.average_match_score * 100}
          />
        </Col>
      </Row>

      {/* --- Charts row 1 --- */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <ChartCard
            title="Candidatures par statut"
            subtitle="Répartition actuelle"
            empty={!data.applications_by_status.length}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.applications_by_status}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="46%"
                  innerRadius={62}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke={chart.surface}
                  strokeWidth={2}
                  isAnimationActive={chart.animate}
                >
                  {data.applications_by_status.map((_, i) => (
                    <Cell key={i} fill={chart.palette[i % chart.palette.length]} />
                  ))}
                </Pie>
                <text
                  x="50%"
                  y="44%"
                  textAnchor="middle"
                  style={{ fontSize: 26, fontWeight: 700, fill: token.colorText }}
                >
                  {totalStatus.toLocaleString("fr-FR")}
                </text>
                <text
                  x="50%"
                  y="52%"
                  textAnchor="middle"
                  style={{ fontSize: 12, fill: token.colorTextSecondary }}
                >
                  candidatures
                </text>
                <Tooltip content={<ChartTooltip chart={chart} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard
            title="Évolution mensuelle"
            subtitle="Candidatures reçues par mois"
            empty={!data.monthly_applications.length}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthly_applications} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="dash-monthly" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.palette[0]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={chart.palette[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chart.gridProps} />
                <XAxis dataKey="label" tick={chart.axisTick} {...chart.axisProps} />
                <YAxis allowDecimals={false} tick={chart.axisTick} {...chart.axisProps} />
                <Tooltip content={<ChartTooltip chart={chart} />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Candidatures"
                  stroke={chart.palette[0]}
                  strokeWidth={2.5}
                  fill="url(#dash-monthly)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: chart.surface }}
                  isAnimationActive={chart.animate}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
      </Row>

      {/* --- Charts row 2 --- */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <ChartCard
            title="Candidats par filière"
            subtitle="Volume par domaine d'études"
            empty={!data.candidates_by_field.length}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.candidates_by_field} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid {...chart.gridProps} />
                <XAxis
                  dataKey="label"
                  tick={{ ...chart.axisTick, fontSize: 11 }}
                  interval={0}
                  angle={-15}
                  height={50}
                  {...chart.axisProps}
                />
                <YAxis allowDecimals={false} tick={chart.axisTick} {...chart.axisProps} />
                <Tooltip content={<ChartTooltip chart={chart} />} cursor={{ fill: chart.cursorFill }} />
                <Bar
                  dataKey="value"
                  name="Candidats"
                  fill={chart.palette[0]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={chart.animate}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard
            title="Top compétences"
            subtitle="Les plus fréquentes dans les CV"
            empty={!data.top_skills.length}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.top_skills}
                layout="vertical"
                margin={{ top: 4, right: 36, bottom: 0, left: 8 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={120}
                  tick={{ ...chart.axisTick, fontSize: 11 }}
                  {...chart.axisProps}
                />
                <Tooltip content={<ChartTooltip chart={chart} />} cursor={{ fill: chart.cursorFill }} />
                <Bar
                  dataKey="value"
                  name="Occurrences"
                  fill={chart.palette[3]}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={18}
                  isAnimationActive={chart.animate}
                >
                  <LabelList
                    dataKey="value"
                    position="right"
                    style={{ fill: chart.axisTick.fill, fontSize: 12, fontVariantNumeric: "tabular-nums" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
      </Row>

      {/* --- Department fill table --- */}
      <Card title="Remplissage par département" style={{ marginTop: 16 }}>
        <Table<DepartmentStat>
          rowKey="department"
          dataSource={data.assignments_by_department}
          columns={deptColumns}
          pagination={false}
          size="small"
        />
      </Card>

      {/* --- Predictive capacity planning (advisory) --- */}
      <CapacityForecastPanel />
    </FadeIn>
  );
}
