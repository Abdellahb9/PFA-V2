// Demandes d'échange d'offre (vue personnel). Le candidat justifie l'échange
// par une image (accord de l'autre partie) ; approuver déplace son affectation
// confirmée vers l'offre demandée, de façon atomique côté base.
import { useState } from "react";
import {
  Button,
  Card,
  Empty,
  Image,
  Input,
  message,
  Modal,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  PictureOutlined,
  SwapOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useReviewSwitchRequest, useSwitchRequests } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import SkeletonTable from "@/components/SkeletonTable";
import type { OfferSwitchRequest } from "@/api/types";

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: "gold" },
  approved: { label: "Approuvée", color: "green" },
  rejected: { label: "Refusée", color: "red" },
};

const FILTERS = [
  { label: "En attente", value: "pending" },
  { label: "Approuvées", value: "approved" },
  { label: "Refusées", value: "rejected" },
  { label: "Toutes", value: "all" },
];

const fmt = (iso: string | null) => (iso ? dayjs(iso).format("DD/MM/YYYY HH:mm") : "—");

export default function OfferSwitchRequestsPage() {
  const { token } = theme.useToken();
  const [status, setStatus] = useState("pending");
  const [rejecting, setRejecting] = useState<OfferSwitchRequest | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading, isFetching } = useSwitchRequests(status);
  const review = useReviewSwitchRequest();

  const run = (id: string, action: "approve" | "reject", admin_note?: string) =>
    review.mutate(
      { id, action, admin_note },
      {
        onSuccess: () => {
          message.success(action === "approve" ? "Échange effectué." : "Demande refusée.");
          setRejecting(null);
          setNote("");
        },
        // Le détail vient de l'API (offre complète, demande déjà traitée…) :
        // il est plus utile que « une erreur est survenue ».
        onError: (err) => message.error(apiErrorMessage(err, "Traitement impossible.")),
      },
    );

  const confirmApprove = (r: OfferSwitchRequest) =>
    Modal.confirm({
      title: "Confirmer l'échange ?",
      icon: <SwapOutlined style={{ color: token.colorPrimary }} />,
      content: (
        <span>
          <b>{r.candidate_name}</b> passera de « {r.current_offer_title} » à «{" "}
          {r.requested_offer_title} ». L'affectation est déplacée immédiatement.
        </span>
      ),
      okText: "Approuver",
      cancelText: "Annuler",
      onOk: () => run(r.id, "approve"),
    });

  const columns = [
    {
      title: "Candidat",
      key: "candidate",
      render: (_: unknown, r: OfferSwitchRequest) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>
            <UserOutlined style={{ color: token.colorPrimary, marginRight: 6 }} />
            {r.candidate_name}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.candidate_email ?? "—"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Échange demandé",
      key: "swap",
      render: (_: unknown, r: OfferSwitchRequest) => (
        <Space size={8} wrap>
          <Tag>{r.current_offer_title}</Tag>
          <SwapOutlined style={{ color: token.colorPrimary }} />
          <Tag color="blue">{r.requested_offer_title}</Tag>
        </Space>
      ),
    },
    {
      title: "Preuve",
      key: "proof",
      width: 90,
      render: (_: unknown, r: OfferSwitchRequest) =>
        r.proof_url ? (
          // L'URL est signée (1 h) : l'aperçu suffit, pas de lien public.
          <Image
            src={r.proof_url}
            width={56}
            height={56}
            style={{ objectFit: "cover", borderRadius: token.borderRadius }}
            alt="Preuve d'accord"
          />
        ) : (
          <Tooltip title="Image indisponible">
            <PictureOutlined style={{ color: token.colorTextQuaternary, fontSize: 20 }} />
          </Tooltip>
        ),
    },
    {
      title: "Déposée le",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => fmt(v),
    },
    {
      title: "Statut",
      key: "status",
      render: (_: unknown, r: OfferSwitchRequest) => {
        const meta = STATUS_META[r.status] ?? { label: r.status, color: "default" };
        return (
          <Space direction="vertical" size={0}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {r.status !== "pending" && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.reviewed_by ?? "—"} · {fmt(r.reviewed_at)}
              </Typography.Text>
            )}
            {r.admin_note && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                « {r.admin_note} »
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      render: (_: unknown, r: OfferSwitchRequest) =>
        r.status === "pending" ? (
          <Space>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={review.isPending}
              onClick={() => confirmApprove(r)}
            >
              Approuver
            </Button>
            <Button
              danger
              size="small"
              icon={<CloseOutlined />}
              onClick={() => {
                setRejecting(r);
                setNote("");
              }}
            >
              Refuser
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">Traitée</Typography.Text>
        ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={
          <Space>
            <SwapOutlined style={{ color: token.colorPrimary }} />
            Demandes d'échange d'offre
          </Space>
        }
        extra={
          <Segmented options={FILTERS} value={status} onChange={(v) => setStatus(String(v))} />
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Un candidat peut demander à échanger son stage contre une autre offre, à condition de
          joindre une preuve de l'accord de l'autre partie. Approuver déplace son affectation
          confirmée vers l'offre demandée.
        </Typography.Paragraph>

        {!isLoading && (data ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune demande" />
        ) : (
          <SkeletonTable<OfferSwitchRequest>
            rowKey="id"
            loading={isLoading}
            fetching={isFetching}
            columns={columns}
            dataSource={data}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
          />
        )}

      </Card>

      <Modal
        open={Boolean(rejecting)}
        title="Refuser la demande"
        okText="Refuser"
        okButtonProps={{ danger: true, loading: review.isPending }}
        cancelText="Annuler"
        onCancel={() => setRejecting(null)}
        onOk={() => rejecting && run(rejecting.id, "reject", note.trim() || undefined)}
      >
        <Typography.Paragraph type="secondary">
          Le motif est facultatif ; s'il est renseigné, le candidat le verra.
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Motif du refus (optionnel)"
        />
      </Modal>
    </Space>
  );
}
