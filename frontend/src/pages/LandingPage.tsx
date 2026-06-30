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
  Modal,
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
  FileTextOutlined,
} from "@ant-design/icons";
import { usePublicOffers } from "@/api/hooks";
import FadeIn from "@/components/FadeIn";
import PublicApplicationModal from "@/components/PublicApplicationModal";
import type { PublicOffer } from "@/api/types";
import logo from "@/assets/phosboucraa-logo.png";

const { Header, Content, Footer } = Layout;
const { Title, Paragraph, Text } = Typography;

// Phosboucraa Foundation brand green (overrides the admin theme locally).
const FOUNDATION_GREEN = "#00843d"; // OCP / Phosboucraa brand green

function OfferCard({
  offer,
  green,
  onApply,
  onDetails,
}: {
  offer: PublicOffer;
  green: string;
  onApply: () => void;
  onDetails: () => void;
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
        <Space>
          <Button size="small" icon={<FileTextOutlined />} onClick={onDetails}>
            Détails
          </Button>
          <Button type="primary" size="small" onClick={onApply}>
            Postuler <ArrowRightOutlined />
          </Button>
        </Space>
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

  // Offer details modal.
  const [detailsOffer, setDetailsOffer] = useState<PublicOffer | null>(null);

  const scrollToOffers = () =>
    document.getElementById("offres")?.scrollIntoView({ behavior: "smooth" });

  return (
    <Layout style={{ minHeight: "100vh", background: "transparent" }}>
      {/* --- Navbar --- */}
      <Header
        style={{
          background: "#ffffff",
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
            background: "linear-gradient(180deg, #f0f7f2 0%, #f4f6f8 100%)",
            borderBottom: "1px solid #eceff3",
            padding: "88px 24px",
          }}
        >
          <FadeIn>
            <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
              <Title style={{ fontSize: 44, marginBottom: 12 }}>
                Rejoignez nos programmes de stage
              </Title>
              <Paragraph
                type="secondary"
                style={{ fontSize: 18, maxWidth: 680, margin: "0 auto 28px" }}
              >
                La Fondation Phosboucraa accompagne les étudiants vers l'excellence à travers
                des stages encadrés au sein de ses départements. (Texte placeholder.)
              </Paragraph>
              <Space size="middle" wrap style={{ justifyContent: "center" }}>
                <Button
                  size="large"
                  icon={<ArrowRightOutlined />}
                  onClick={scrollToOffers}
                  type="primary"
                >
                  Voir les offres de stage
                </Button>
                <Button size="large" onClick={() => navigate("/login")}>
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
                      onDetails={() => setDetailsOffer(offer)}
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
      <Footer
        style={{
          background: "#ffffff",
          borderTop: "1px solid #eceff3",
          textAlign: "center",
        }}
      >
        <Space direction="vertical" size="small">
          <Space split={<span style={{ opacity: 0.4 }}>·</span>} wrap>
            <a href="#offres">Offres</a>
            <Button type="link" style={{ padding: 0 }} onClick={() => navigate("/login")}>
              Espace admin
            </Button>
            <a href="mailto:contact@phosboucraa.ma">Contact</a>
          </Space>
          <Text type="secondary">
            © {new Date().getFullYear()} Phosboucraa Foundation — Tous droits réservés.
          </Text>
        </Space>
      </Footer>

      {/* --- Offer details modal --- */}
      <Modal
        open={Boolean(detailsOffer)}
        title={detailsOffer?.title}
        onCancel={() => setDetailsOffer(null)}
        width={560}
        footer={[
          <Button key="close" onClick={() => setDetailsOffer(null)}>
            Fermer
          </Button>,
          <Button
            key="apply"
            type="primary"
            onClick={() => {
              const offer = detailsOffer;
              setDetailsOffer(null);
              if (offer) openApply(offer);
            }}
          >
            Postuler
          </Button>,
        ]}
      >
        {detailsOffer && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Text type="secondary">
              {detailsOffer.department_name ?? "—"}
              {detailsOffer.field ? ` · ${detailsOffer.field}` : ""}
              {` · ${detailsOffer.slots} poste${detailsOffer.slots > 1 ? "s" : ""}`}
            </Text>
            <Paragraph style={{ whiteSpace: "pre-line", marginBottom: 0 }}>
              {detailsOffer.description?.trim() || "Aucune description fournie pour cette offre."}
            </Paragraph>
            {detailsOffer.skills.length > 0 && (
              <div>
                <Text strong>Compétences requises</Text>
                <div style={{ marginTop: 6 }}>
                  <Space size={[4, 8]} wrap>
                    {detailsOffer.skills.map((s) => (
                      <Tag key={s.name} color={token.colorPrimary}>
                        {s.name}
                      </Tag>
                    ))}
                  </Space>
                </div>
              </div>
            )}
          </Space>
        )}
      </Modal>

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
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: FOUNDATION_GREEN,
          colorLink: FOUNDATION_GREEN,
          colorBorderSecondary: "#eceff3",
        },
      }}
    >
      <LandingContent />
    </ConfigProvider>
  );
}
