// Bloc « échanger mon offre » du portail candidat. Il n'apparaît qu'une fois le
// stage attribué : sans affectation confirmée il n'y a rien à échanger.
// La preuve d'accord (capture d'écran, message signé…) est obligatoire.
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  List,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import { InboxOutlined, SwapOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { useCreateSwitchRequest, useMySwitchRequests, usePublicOffers } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type { MySwitchRequest } from "@/api/types";

const MAX_MB = 5;
const ACCEPT = ".jpg,.jpeg,.png,.webp";

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: "gold" },
  approved: { label: "Approuvée", color: "green" },
  rejected: { label: "Refusée", color: "red" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

function RequestItem({ r }: { r: MySwitchRequest }) {
  const meta = STATUS_META[r.status] ?? { label: r.status, color: "default" };
  return (
    <List.Item>
      <List.Item.Meta
        title={
          <Space size={8} wrap>
            <span>{r.current_offer_title}</span>
            <SwapOutlined />
            <span>{r.requested_offer_title}</span>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Space>
        }
        description={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Déposée le {fmt(r.created_at)}
            {r.reviewed_at ? ` · traitée le ${fmt(r.reviewed_at)}` : ""}
            {r.admin_note ? ` · « ${r.admin_note} »` : ""}
          </Typography.Text>
        }
      />
    </List.Item>
  );
}

export default function OfferSwitchPanel() {
  const { token } = theme.useToken();
  const { data, isLoading } = useMySwitchRequests();
  const { data: offers } = usePublicOffers();
  const create = useCreateSwitchRequest();

  const [open, setOpen] = useState(false);
  const [offerId, setOfferId] = useState<number | null>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);

  const placement = data?.placement ?? null;
  const requests = data?.requests ?? [];
  const hasPending = requests.some((r) => r.status === "pending");

  // Rien à échanger tant que le stage n'est pas attribué.
  if (isLoading || !placement) return null;

  const submit = () => {
    const file = files[0]?.originFileObj as File | undefined;
    if (!offerId || !file) {
      message.warning("Choisissez une offre et joignez la preuve d'accord.");
      return;
    }
    create.mutate(
      { requested_offer_id: offerId, file },
      {
        onSuccess: () => {
          message.success("Demande envoyée. Elle sera examinée par l'équipe RH.");
          setOpen(false);
          setOfferId(null);
          setFiles([]);
        },
        onError: (err) => message.error(apiErrorMessage(err, "Envoi de la demande impossible.")),
      },
    );
  };

  return (
    <Card
      style={{ marginTop: 32 }}
      title={
        <Space>
          <SwapOutlined style={{ color: token.colorPrimary }} />
          Échanger mon offre de stage
        </Space>
      }
      extra={
        <Button type="primary" disabled={hasPending} onClick={() => setOpen(true)}>
          Demander un échange
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Vous êtes affecté à « <b>{placement.offerTitle}</b> ». Si vous vous êtes entendu avec un
        autre stagiaire ou avec le service concerné, joignez une preuve de cet accord (capture
        d'écran, e-mail) et l'équipe RH validera l'échange.
      </Typography.Paragraph>

      {hasPending && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Une demande est déjà en cours d'examen."
        />
      )}

      {requests.length > 0 && (
        <List dataSource={requests} renderItem={(r) => <RequestItem r={r} />} size="small" />
      )}

      <Modal
        open={open}
        title="Demander un échange d'offre"
        okText="Envoyer la demande"
        cancelText="Annuler"
        confirmLoading={create.isPending}
        onCancel={() => setOpen(false)}
        onOk={submit}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>Offre souhaitée</Typography.Text>
            <Select
              style={{ width: "100%", marginTop: 6 }}
              placeholder="Choisissez l'offre visée"
              value={offerId}
              onChange={setOfferId}
              showSearch
              optionFilterProp="label"
              options={(offers ?? [])
                // Inutile de proposer celle qu'on occupe déjà.
                .filter((o) => o.id !== placement.offerId)
                .map((o) => ({
                  value: o.id,
                  label: o.department_name ? `${o.title} — ${o.department_name}` : o.title,
                }))}
            />
          </div>

          <div>
            <Typography.Text strong>Preuve de l'accord</Typography.Text>
            <Upload.Dragger
              accept={ACCEPT}
              maxCount={1}
              fileList={files}
              onChange={({ fileList }) => setFiles(fileList)}
              // L'envoi part avec la demande, pas au dépôt du fichier.
              beforeUpload={(file) => {
                if (file.size > MAX_MB * 1024 * 1024) {
                  message.error(`Image trop lourde (max ${MAX_MB} Mo).`);
                  return Upload.LIST_IGNORE;
                }
                return false;
              }}
              style={{ marginTop: 6 }}
            >
              <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
                <InboxOutlined style={{ color: token.colorPrimary }} />
              </p>
              <p className="ant-upload-text">Cliquez ou déposez l'image ici</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                JPG, PNG ou WEBP · {MAX_MB} Mo maximum
              </p>
            </Upload.Dragger>
          </div>
        </Space>
      </Modal>
    </Card>
  );
}
