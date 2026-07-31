// Applications list: upload new CVs, live parsing status, view stored CV,
// extracted skills, and matching score.
import { useState } from "react";
import { Card, Tag, Select, Progress, Button, Space, Popconfirm, message, theme } from "antd";
import {
  PlusOutlined,
  FilePdfOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
} from "@ant-design/icons";
import { useApplications, useDeleteApplication, openDocument } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import SkeletonTable from "@/components/SkeletonTable";
import NewApplicationModal from "@/components/NewApplicationModal";
import BulkApplicationsModal from "@/components/BulkApplicationsModal";
import type { Application, ApplicationStatus, SkillRef } from "@/api/types";

// French labels + colors for each application status.
const STATUS_META: Record<ApplicationStatus, { label: string; color: string }> = {
  submitted: { label: "Soumise", color: "default" },
  parsing: { label: "Analyse en cours", color: "processing" },
  parsed: { label: "Analysée", color: "cyan" },
  under_review: { label: "En revue", color: "gold" },
  assigned: { label: "Affectée", color: "green" },
  rejected: { label: "Rejetée", color: "red" },
  failed: { label: "Échec", color: "volcano" },
};

export default function ApplicationsPage() {
  const [status, setStatus] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data, isLoading, isFetching } = useApplications(status);
  const deleteApp = useDeleteApplication();
  const { token } = theme.useToken();

  const onView = async (applicationId: number) => {
    try {
      await openDocument(applicationId);
    } catch (err) {
      message.error(apiErrorMessage(err, "Impossible d'ouvrir le document"));
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteApp.mutateAsync(id);
      message.success("Candidature supprimée");
    } catch (err) {
      message.error(apiErrorMessage(err, "Suppression impossible"));
    }
  };

  const columns = [
    {
      title: "Candidat",
      key: "candidate",
      render: (_: unknown, r: Application) => r.candidate?.full_name ?? `#${r.candidate_id}`,
    },
    {
      title: "Filière",
      key: "field",
      render: (_: unknown, r: Application) => r.candidate?.field_of_study ?? "—",
    },
    {
      title: "Compétences détectées",
      key: "skills",
      render: (_: unknown, r: Application) => {
        const skills: SkillRef[] = r.candidate?.skills ?? [];
        if (!skills.length) return <span style={{ color: token.colorTextTertiary }}>—</span>;
        return (
          <Space size={[0, 4]} wrap>
            {skills.slice(0, 5).map((s) => (
              <Tag key={s.name} color="green">
                {s.name}
              </Tag>
            ))}
            {skills.length > 5 && <Tag>+{skills.length - 5}</Tag>}
          </Space>
        );
      },
    },
    {
      title: "Statut",
      dataIndex: "status",
      key: "status",
      render: (s: ApplicationStatus) => (
        <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>
      ),
    },
    {
      title: "Score",
      dataIndex: "match_score",
      key: "match_score",
      render: (v: number | null) =>
        v == null ? "—" : <Progress percent={Math.round(v * 100)} size="small" style={{ width: 110 }} />,
    },
    {
      title: "CV",
      key: "documents",
      render: (_: unknown, r: Application) =>
        (r.documents ?? []).length ? (
          <Button size="small" icon={<FilePdfOutlined />} onClick={() => onView(r.id)}>
            Voir
          </Button>
        ) : (
          <span style={{ color: token.colorTextTertiary }}>—</span>
        ),
    },
    {
      title: "Reçue le",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => new Date(v).toLocaleDateString("fr-FR"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 110,
      render: (_: unknown, r: Application) => (
        <Popconfirm
          title="Supprimer cette candidature ?"
          description="Le CV et l'affectation associés seront aussi supprimés."
          okText="Supprimer"
          cancelText="Annuler"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(r.id)}
        >
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title="Candidatures"
      extra={
        <Space>
          {isFetching && <ReloadOutlined spin style={{ color: token.colorPrimary }} />}
          <Select
            allowClear
            placeholder="Filtrer par statut"
            style={{ width: 190 }}
            onChange={setStatus}
            options={Object.entries(STATUS_META).map(([value, m]) => ({
              value,
              label: m.label,
            }))}
          />
          <Button icon={<CloudUploadOutlined />} onClick={() => setBulkOpen(true)}>
            Importer des CV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            Nouvelle candidature
          </Button>
        </Space>
      }
    >
      <SkeletonTable<Application>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />

      <NewApplicationModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <BulkApplicationsModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </Card>
  );
}
