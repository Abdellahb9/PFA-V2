// Admin dashboard: KPIs + interactive Recharts visualisations.
import { Col, Row, Card, Spin, Empty, Table } from "antd";
import {
  TeamOutlined,
  FileTextOutlined,
  DeploymentUnitOutlined,
  PercentageOutlined,
} from "@ant-design/icons";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import KpiCard from "@/components/KpiCard";
import FadeIn from "@/components/FadeIn";
import { useDashboard } from "@/api/hooks";
import type { DepartmentStat } from "@/api/types";

const COLORS = ["#00843d", "#52c41a", "#1677ff", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c"];

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();

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

  const deptColumns = [
    { title: "Département", dataIndex: "department", key: "department" },
    { title: "Capacité", dataIndex: "capacity", key: "capacity" },
    { title: "Affectés", dataIndex: "assigned", key: "assigned" },
    {
      title: "Taux de remplissage",
      dataIndex: "fill_rate",
      key: "fill_rate",
      render: (v: number) => `${Math.round(v * 100)} %`,
    },
  ];

  return (
    <FadeIn>
      {/* --- KPI row --- */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title="Candidats" value={kpis.total_candidates} icon={<TeamOutlined />} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title="Candidatures" value={kpis.total_applications} icon={<FileTextOutlined />} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="Taux d'affectation"
            value={kpis.assignment_rate * 100}
            precision={1}
            suffix="%"
            icon={<PercentageOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="Score moyen"
            value={kpis.average_match_score * 100}
            precision={1}
            suffix="%"
            icon={<DeploymentUnitOutlined />}
            color="#1677ff"
          />
        </Col>
      </Row>

      {/* --- Charts row 1 --- */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Candidatures par statut" className="chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.applications_by_status}
                  dataKey="value"
                  nameKey="label"
                  outerRadius={100}
                  label
                >
                  {data.applications_by_status.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Candidats par filière" className="chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.candidates_by_field}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} height={50} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#00843d" name="Candidats" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* --- Charts row 2 --- */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Évolution mensuelle des candidatures" className="chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.monthly_applications}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#1677ff" strokeWidth={2} name="Candidatures" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Top compétences" className="chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.top_skills} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#722ed1" name="Occurrences" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
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
    </FadeIn>
  );
}
