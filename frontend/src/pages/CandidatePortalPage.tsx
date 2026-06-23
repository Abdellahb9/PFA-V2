// Candidate portal: the applicant tracks their own applications via a status
// timeline. Read-only; no internal data (scores, other candidates) is exposed.
import { Button, Card, Empty, Layout, Spin, Steps, Tag, Typography } from "antd";
import { LogoutOutlined, FileDoneOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useMyApplications } from "@/api/hooks";
import FadeIn from "@/components/FadeIn";
import OffersBrowser from "@/components/OffersBrowser";
import { useAppDispatch, useAppSelector } from "@/store";
import { logout } from "@/store/authSlice";
import type { ApplicationStatus, MyApplication } from "@/api/types";

const { Header, Content } = Layout;

// Map an internal status to a candidate-facing 4-step timeline.
function timeline(status: ApplicationStatus): {
  current: number;
  state: "process" | "finish" | "error";
  finalLabel: string;
} {
  switch (status) {
    case "submitted":
      return { current: 0, state: "process", finalLabel: "Décision" };
    case "parsing":
      return { current: 1, state: "process", finalLabel: "Décision" };
    case "parsed":
    case "under_review":
      return { current: 2, state: "process", finalLabel: "Décision" };
    case "assigned":
      return { current: 3, state: "finish", finalLabel: "Acceptée" };
    case "rejected":
      return { current: 3, state: "error", finalLabel: "Non retenue" };
    case "failed":
      return { current: 0, state: "error", finalLabel: "Décision" };
    default:
      return { current: 0, state: "process", finalLabel: "Décision" };
  }
}

function ApplicationCard({ app }: { app: MyApplication }) {
  const { current, state, finalLabel } = timeline(app.status);
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Typography.Title level={5} style={{ marginBottom: 2 }}>
            {app.offer_title ?? "Candidature spontanée"}
          </Typography.Title>
          <Typography.Text type="secondary">
            {app.department_name ?? "—"} · déposée le{" "}
            {new Date(app.created_at).toLocaleDateString("fr-FR")}
          </Typography.Text>
        </div>
        {app.status === "assigned" && <Tag color="green">Acceptée</Tag>}
        {app.status === "rejected" && <Tag color="red">Non retenue</Tag>}
      </div>

      <Steps
        style={{ marginTop: 20 }}
        size="small"
        current={current}
        status={state}
        responsive
        items={[
          { title: "Reçue" },
          { title: "Analyse du CV" },
          { title: "Examen" },
          { title: finalLabel },
        ]}
      />
    </Card>
  );
}

export default function CandidatePortalPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const { data, isLoading } = useMyApplications();

  const onLogout = () => {
    dispatch(logout());
    navigate("/");
  };

  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <Header
        style={{
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingInline: 24,
          borderBottom: "1px solid #eee",
        }}
      >
        <span style={{ fontWeight: 700 }}>
          <FileDoneOutlined style={{ color: "#3DBB5E", marginRight: 8 }} />
          Mon espace candidat
        </span>
        <Button icon={<LogoutOutlined />} onClick={onLogout}>
          Se déconnecter
        </Button>
      </Header>

      <Content style={{ maxWidth: 1100, width: "100%", margin: "0 auto", padding: 24 }}>
        <Typography.Title level={3}>Bonjour {user?.full_name ?? ""}</Typography.Title>
        <Typography.Paragraph type="secondary">
          Suivez vos candidatures et postulez à de nouvelles offres.
        </Typography.Paragraph>

        {/* --- My applications --- */}
        <Typography.Title level={4} style={{ marginTop: 8 }}>
          Mes candidatures
        </Typography.Title>
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40 }} role="status" aria-busy="true">
            <Spin size="large" />
          </div>
        ) : !data?.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Vous n'avez pas encore postulé. Choisissez une offre ci-dessous."
          />
        ) : (
          <FadeIn>
            {data.map((app) => (
              <ApplicationCard key={app.id} app={app} />
            ))}
          </FadeIn>
        )}

        {/* --- Available offers (apply directly) --- */}
        <Typography.Title level={4} style={{ marginTop: 32 }}>
          Offres de stage disponibles
        </Typography.Title>
        <OffersBrowser />
      </Content>
    </Layout>
  );
}
