// Reusable public-offers browser: a responsive grid of offer cards with
// "Détails" (full description modal) and "Postuler" (application modal).
// Used on the landing page and inside the candidate portal.
import { useState } from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import { ArrowRightOutlined, FileTextOutlined } from "@ant-design/icons";
import { usePublicOffers } from "@/api/hooks";
import PublicApplicationModal from "@/components/PublicApplicationModal";
import type { PublicOffer } from "@/api/types";

const { Paragraph, Text } = Typography;

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

export default function OffersBrowser() {
  const { token } = theme.useToken();
  const { data: offers, isLoading } = usePublicOffers();
  const [applyOffer, setApplyOffer] = useState<PublicOffer | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [detailsOffer, setDetailsOffer] = useState<PublicOffer | null>(null);
  const openApply = (offer: PublicOffer) => {
    setApplyOffer(offer);
    setApplyOpen(true);
  };

  return (
    <>
      {isLoading ? (
        <Row gutter={[24, 24]}>
          {[0, 1, 2].map((i) => (
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

      {/* Full description modal */}
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
    </>
  );
}
