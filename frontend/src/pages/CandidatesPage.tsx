// Candidates list + CRM detail drawer (contact info, applications, internal notes).
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCandidate, useCandidates, useUpdateCandidateNotes } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import SkeletonTable from "@/components/SkeletonTable";
import type { ApplicationStatus, Candidate, CandidateApplicationRef, SkillRef } from "@/api/types";

const STATUS_META: Record<ApplicationStatus, { label: string; color: string }> = {
  submitted: { label: "Reçue", color: "default" },
  parsing: { label: "Analyse CV", color: "processing" },
  parsed: { label: "Analysée", color: "cyan" },
  under_review: { label: "En examen", color: "gold" },
  assigned: { label: "Affectée", color: "green" },
  rejected: { label: "Non retenue", color: "red" },
  failed: { label: "Échec", color: "red" },
};

function CandidateDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: c, isLoading } = useCandidate(id);
  const saveNotes = useUpdateCandidateNotes();
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setNotes(c?.notes ?? "");
  }, [c?.id, c?.notes]);

  const onSave = async () => {
    if (id == null) return;
    try {
      await saveNotes.mutateAsync({ id, notes });
      message.success("Notes enregistrées");
    } catch (err) {
      message.error(apiErrorMessage(err, "Enregistrement impossible"));
    }
  };

  const appColumns = [
    { title: "Offre", dataIndex: "offer_title", key: "offer", render: (v: string | null) => v ?? "Candidature générale" },
    {
      title: "Statut",
      dataIndex: "status",
      key: "status",
      render: (s: ApplicationStatus) => (
        <Tag color={STATUS_META[s]?.color}>{STATUS_META[s]?.label ?? s}</Tag>
      ),
    },
    {
      title: "Score",
      dataIndex: "match_score",
      key: "score",
      render: (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : "—"),
    },
    {
      title: "Date",
      dataIndex: "created_at",
      key: "date",
      render: (v: string) => new Date(v).toLocaleDateString("fr-FR"),
    },
  ];

  return (
    <Drawer
      title={c ? c.full_name : "Fiche candidat"}
      width={560}
      open={id != null}
      onClose={onClose}
      destroyOnClose
    >
      {isLoading || !c ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin size="large" />
        </div>
      ) : (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Email">{c.email}</Descriptions.Item>
            <Descriptions.Item label="Téléphone">{c.phone ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Niveau">{c.education_level ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Filière">{c.field_of_study ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Établissement">{c.university ?? "—"}</Descriptions.Item>
          </Descriptions>

          <div>
            <Typography.Text strong>Compétences détectées</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Space size={[0, 4]} wrap>
                {c.skills.length ? (
                  c.skills.map((s) => (
                    <Tag key={s.name} color="green">
                      {s.name}
                    </Tag>
                  ))
                ) : (
                  <Typography.Text type="secondary">Aucune</Typography.Text>
                )}
              </Space>
            </div>
          </div>

          <div>
            <Typography.Text strong>Candidatures ({c.applications.length})</Typography.Text>
            <Table<CandidateApplicationRef>
              style={{ marginTop: 8 }}
              rowKey="id"
              size="small"
              dataSource={c.applications}
              columns={appColumns}
              pagination={false}
            />
          </div>

          <div>
            <Typography.Text strong>Notes internes (privées)</Typography.Text>
            <Input.TextArea
              style={{ marginTop: 8 }}
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes visibles uniquement par l'équipe…"
            />
            <Button
              type="primary"
              style={{ marginTop: 8 }}
              loading={saveNotes.isPending}
              onClick={onSave}
            >
              Enregistrer les notes
            </Button>
          </div>
        </Space>
      )}
    </Drawer>
  );
}

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading, isFetching } = useCandidates(search || undefined);

  const columns = [
    { title: "Nom", dataIndex: "full_name", key: "full_name" },
    { title: "Filière", dataIndex: "field_of_study", key: "field", render: (v: string) => v ?? "—" },
    { title: "Niveau", dataIndex: "education_level", key: "level", render: (v: string) => v ?? "—" },
    { title: "Université", dataIndex: "university", key: "university", render: (v: string) => v ?? "—" },
    {
      title: "Compétences détectées",
      dataIndex: "skills",
      key: "skills",
      render: (skills: SkillRef[]) => (
        <Space size={[0, 4]} wrap>
          {skills.slice(0, 6).map((s) => (
            <Tag key={s.name} color="green">
              {s.name}
            </Tag>
          ))}
          {skills.length > 6 && <Tag>+{skills.length - 6}</Tag>}
        </Space>
      ),
    },
    {
      title: "",
      key: "action",
      render: (_: unknown, r: Candidate) => (
        <Button size="small" onClick={() => setSelected(r.id)}>
          Fiche
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Candidats"
      extra={
        <Input.Search
          placeholder="Rechercher par nom ou filière"
          style={{ width: 280 }}
          onSearch={setSearch}
          allowClear
        />
      }
    >
      <SkeletonTable<Candidate>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10 }}
        onRow={(r) => ({ onClick: () => setSelected(r.id), style: { cursor: "pointer" } })}
      />
      <CandidateDrawer id={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
