// Public landing page for the Phosboucraa Foundation (no authentication).
// The Foundation green (#3DBB5E) is injected via a scoped ConfigProvider, so
// inner sections read it from the AntD theme tokens (theme.useToken()).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Layout,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  LoginOutlined,
  ArrowRightOutlined,
  TeamOutlined,
  BankOutlined,
} from "@ant-design/icons";
import { usePublicOffers } from "@/api/hooks";
import FadeIn from "@/components/FadeIn";
import PublicApplicationModal from "@/components/PublicApplicationModal";
import type { PublicOffer } from "@/api/types";
import logo from "@/assets/phosboucraa-logo.png";

const { Header, Content, Footer } = Layout;
const { Title, Paragraph, Text } = Typography;

// Phosboucraa Foundation brand green (overrides the admin theme locally).
const FOUNDATION_GREEN = "#3DBB5E";

function OfferCard({
  offer,
  green,
  onApply,
}: {
  offer: PublicOffer;
  green: string;
  onApply: () => void;
}) {
  return (
    <Card
      hoverable
      style={{ height: "100%" }}
      title={offer.title}
      extra={<Tag color={green}>{offer.slots} poste{offer.slots > 1 ? "s" : ""}</Tag>}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Text type="secondary">
          {offer.department_name ?? "—"}
          {offer.field ? ` · ${offer.field}` : ""}
        </Text>
        {offer.description && (
          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>
            {offer.description}
          </Paragraph>
        )}
        <Space size={[4, 4]} wrap>
          {offer.skills.slice(0, 5).map((s) => (
            <Tag key={s.name}>{s.name}</Tag>
          ))}
        </Space>
        <Button type="link" style={{ padding: 0 }} onClick={onApply}>
          Postuler <ArrowRightOutlined />
        </Button>
      </Space>
    </Card>
  );
}

function LandingContent() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { data: offers, isLoading } = usePublicOffers();

  // Public application modal state (offer to apply to).
  const [applyOffer, setApplyOffer] = useState<PublicOffer | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const openApply = (offer: PublicOffer) => {
    setApplyOffer(offer);
    setApplyOpen(true);
  };

  const scrollToOffers = () =>
    document.getElementById("offres")?.scrollIntoView({ behavior: "smooth" });

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgContainer }}>
      {/* --- Navbar --- */}
      <Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 10,
          paddingInline: 24,
        }}
      >
        <img src={logo} alt="Phosboucraa Foundation" style={{ height: 40 }} />
        <Space>
          <Button onClick={() => navigate("/inscription")}>Créer un compte</Button>
          <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate("/login")}>
            Se connecter
          </Button>
        </Space>
      </Header>

      <Content>
        {/* --- Hero --- */}
        <section
          style={{
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #0f3d22 100%)`,
            color: "#fff",
            padding: "88px 24px",
          }}
        >
          <FadeIn>
            <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
              <Title style={{ color: "#fff", fontSize: 44, marginBottom: 12 }}>
                Rejoignez nos programmes de stage
              </Title>
              <Paragraph
                style={{
                  color: "rgba(255,255,255,0.88)",
                  fontSize: 18,
                  maxWidth: 680,
                  margin: "0 auto 28px",
                }}
              >
                La Fondation Phosboucraa accompagne les étudiants vers l'excellence à travers
                des stages encadrés au sein de ses départements. (Texte placeholder.)
              </Paragraph>
              <Space size="middle" wrap style={{ justifyContent: "center" }}>
                <Button
                  size="large"
                  icon={<ArrowRightOutlined />}
                  onClick={scrollToOffers}
                  style={{
                    background: "#fff",
                    color: token.colorPrimary,
                    fontWeight: 600,
                    border: "none",
                  }}
                >
                  Voir les offres de stage
                </Button>
                <Button size="large" ghost onClick={() => navigate("/login")}>
                  Espace admin
                </Button>
              </Space>
            </div>
          </FadeIn>
        </section>

        {/* --- Offers --- */}
        <section id="offres" style={{ padding: "64px 24px", maxWidth: 1160, margin: "0 auto" }}>
          <FadeIn>
            <Title level={2} style={{ textAlign: "center" }}>
              Offres de stage
            </Title>
            <Paragraph type="secondary" style={{ textAlign: "center", marginBottom: 36 }}>
              Découvrez les opportunités ouvertes au sein de nos départements.
            </Paragraph>

            {isLoading ? (
              <Row gutter={[24, 24]}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Col xs={24} sm={12} lg={8} key={i}>
                    <Card>
                      <Skeleton active paragraph={{ rows: 3 }} />
                    </Card>
                  </Col>
                ))}
              </Row>
            ) : !offers?.length ? (
              <Empty description="Aucune offre publiée pour le moment" />
            ) : (
              <Row gutter={[24, 24]}>
                {offers.map((offer) => (
                  <Col xs={24} sm={12} lg={8} key={offer.id}>
                    <OfferCard
                      offer={offer}
                      green={token.colorPrimary}
                      onApply={() => openApply(offer)}
                    />
                  </Col>
                ))}
              </Row>
            )}
          </FadeIn>
        </section>

        {/* --- About / mission --- */}
        <section style={{ background: token.colorFillQuaternary, padding: "64px 24px" }}>
          <FadeIn>
            <Row gutter={[32, 32]} align="middle" style={{ maxWidth: 1160, margin: "0 auto" }}>
              <Col xs={24} md={12}>
                <Title level={2}>Notre mission</Title>
                <Paragraph style={{ fontSize: 16 }}>
                  [Texte placeholder] La Fondation Phosboucraa œuvre pour le développement
                  humain et territorial des provinces du Sud du Maroc, en investissant dans
                  l'éducation, l'employabilité des jeunes et l'innovation.
                </Paragraph>
                <Space size="large" wrap>
                  <Space>
                    <TeamOutlined style={{ color: token.colorPrimary, fontSize: 22 }} />
                    <Text strong>Insertion des jeunes</Text>
                  </Space>
                  <Space>
                    <BankOutlined style={{ color: token.colorPrimary, fontSize: 22 }} />
                    <Text strong>Partenariats académiques</Text>
                  </Space>
                </Space>
              </Col>
              <Col xs={24} md={12}>
                <Card style={{ borderColor: token.colorPrimary }}>
                  <Paragraph italic style={{ marginBottom: 0, fontSize: 16 }}>
                    « Investir dans la jeunesse, c'est bâtir l'avenir des territoires. »
                    (Citation placeholder.)
                  </Paragraph>
                </Card>
              </Col>
            </Row>
          </FadeIn>
        </section>
      </Content>

      {/* --- Footer --- */}
      <Footer style={{ background: "#111", color: "rgba(255,255,255,0.75)", textAlign: "center" }}>
        <Space direction="vertical" size="small">
          <Space split={<span style={{ opacity: 0.4 }}>·</span>} wrap>
            <a style={{ color: "#fff" }} href="#offres">
              Offres
            </a>
            <Button
              type="link"
              style={{ color: "#fff", padding: 0 }}
              onClick={() => navigate("/login")}
            >
              Espace admin
            </Button>
            <a style={{ color: "#fff" }} href="mailto:contact@phosboucraa.ma">
              Contact
            </a>
          </Space>
          <Text style={{ color: "rgba(255,255,255,0.5)" }}>
            © {new Date().getFullYear()} Phosboucraa Foundation — Tous droits réservés.
          </Text>
        </Space>
      </Footer>

      <PublicApplicationModal
        open={applyOpen}
        offer={applyOffer}
        onClose={() => setApplyOpen(false)}
      />
    </Layout>
  );
}

export default function LandingPage() {
  // Scope the Foundation green so AntD components + tokens use it here only.
  return (
    <ConfigProvider theme={{ token: { colorPrimary: FOUNDATION_GREEN, colorLink: FOUNDATION_GREEN } }}>
      <LandingContent />
    </ConfigProvider>
  );
}
