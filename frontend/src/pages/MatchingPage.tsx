// Matching page: configure weights, run the Hungarian optimisation,
// review proposed assignments and confirm/reject them.
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Row,
  Slider,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Progress,
  Space,
  message,
} from "antd";
import { ThunderboltOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { useDecideAssignment, useRunMatching } from "@/api/hooks";
import type { AssignmentPreview, MatchingResult } from "@/api/types";

export default function MatchingPage() {
  // Weights for the composite score (skills + education — no embeddings).
  const [skills, setSkills] = useState(0.7);
  const [education, setEducation] = useState(0.3);
  const [persist, setPersist] = useState(false);
  const [result, setResult] = useState<MatchingResult | null>(null);

  const runMatching = useRunMatching();
  const decide = useDecideAssignment();

  const onRun = async () => {
    try {
      const res = await runMatching.mutateAsync({
        weights: { skills, education },
        persist,
        min_score: 0,
      });
      setResult(res);
      message.success(
        persist
          ? `${res.assignments_count} affectations enregistrées`
          : `${res.assignments_count} affectations proposées (aperçu)`
      );
    } catch {
      message.error("Échec de l'optimisation");
    }
  };

  const onDecide = async (assignmentId: number, status: "confirmed" | "rejected") => {
    try {
      await decide.mutateAsync({ id: assignmentId, status });
      message.success(status === "confirmed" ? "Affectation confirmée" : "Affectation rejetée");
    } catch {
      message.error("Action impossible (lancez d'abord en mode enregistrement)");
    }
  };

  const columns = [
    { title: "Candidat", dataIndex: "candidate_name", key: "candidate_name" },
    { title: "Offre", dataIndex: "offer_title", key: "offer_title" },
    { title: "Département", dataIndex: "department_name", key: "department_name" },
    {
      title: "Score",
      dataIndex: "match_score",
      key: "match_score",
      render: (v: number) => <Progress percent={Math.round(v * 100)} size="small" style={{ width: 110 }} />,
      sorter: (a: AssignmentPreview, b: AssignmentPreview) => a.match_score - b.match_score,
    },
    {
      title: "Détail du score",
      key: "breakdown",
      render: (_: unknown, r: AssignmentPreview) => (
        <Space size={4}>
          <Tooltip title="Adéquation des compétences">
            <Tag color="blue">Comp {Math.round(r.score_breakdown.skills * 100)}%</Tag>
          </Tooltip>
          <Tooltip title="Niveau d'études">
            <Tag color="gold">Étud {Math.round(r.score_breakdown.education * 100)}%</Tag>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "Action",
      key: "action",
      render: (_: unknown, r: AssignmentPreview) => (
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => onDecide(r.application_id, "confirmed")}
          >
            Confirmer
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => onDecide(r.application_id, "rejected")}
          >
            Rejeter
          </Button>
        </Space>
      ),
    },
  ];

  // Per-offer table: drop the redundant offer/department columns.
  const groupColumns = columns.filter(
    (c) => c.key !== "offer_title" && c.key !== "department_name",
  );

  // Group the proposed assignments by offer.
  type Group = { offerId: number; title: string; dept: string; items: AssignmentPreview[] };
  const grouped = useMemo<Group[]>(() => {
    if (!result) return [];
    const map = new Map<number, Group>();
    for (const a of result.assignments) {
      const g = map.get(a.offer_id) ?? {
        offerId: a.offer_id,
        title: a.offer_title,
        dept: a.department_name,
        items: [],
      };
      g.items.push(a);
      map.set(a.offer_id, g);
    }
    return [...map.values()];
  }, [result]);

  return (
    <div>
      <Card title="Moteur d'affectation intelligente (Algorithme Hongrois)">
        <Row gutter={24}>
          <Col xs={24} md={16}>
            <p>
              Pondération du score composite&nbsp;: ajustez l'importance de chaque
              critère, puis lancez l'optimisation globale.
            </p>
            <div style={{ maxWidth: 460 }}>
              <label>Adéquation des compétences : {skills.toFixed(2)}</label>
              <Slider min={0} max={1} step={0.05} value={skills} onChange={setSkills} />
              <label>Niveau d'études : {education.toFixed(2)}</label>
              <Slider min={0} max={1} step={0.05} value={education} onChange={setEducation} />
            </div>
            <Space style={{ marginTop: 16 }}>
              <span>Enregistrer les affectations :</span>
              <Switch checked={persist} onChange={setPersist} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={runMatching.isPending}
                onClick={onRun}
              >
                Lancer l'optimisation
              </Button>
            </Space>
          </Col>
          <Col xs={24} md={8}>
            {result && (
              <Row gutter={[8, 16]}>
                <Col span={12}>
                  <Statistic title="Candidats" value={result.total_candidates} />
                </Col>
                <Col span={12}>
                  <Statistic title="Postes" value={result.total_slots} />
                </Col>
                <Col span={12}>
                  <Statistic title="Affectations" value={result.assignments_count} />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="Score moyen"
                    value={result.average_score * 100}
                    precision={1}
                    suffix="%"
                  />
                </Col>
              </Row>
            )}
          </Col>
        </Row>
      </Card>

      {result && (
        <Card
          title={`Affectations proposées par offre (${grouped.length} offre${
            grouped.length > 1 ? "s" : ""
          })`}
          style={{ marginTop: 16 }}
        >
          {grouped.length === 0 ? (
            <Empty description="Aucune affectation proposée" />
          ) : (
            <Collapse
              defaultActiveKey={grouped.map((g) => String(g.offerId))}
              items={grouped.map((g) => {
                const avg = Math.round(
                  (g.items.reduce((s, i) => s + i.match_score, 0) / g.items.length) * 100,
                );
                return {
                  key: String(g.offerId),
                  label: (
                    <Space wrap>
                      <strong>{g.title}</strong>
                      <Tag>{g.dept}</Tag>
                      <Tag color="blue">
                        {g.items.length} candidat{g.items.length > 1 ? "s" : ""}
                      </Tag>
                      <Tag color="green">score moyen {avg}%</Tag>
                    </Space>
                  ),
                  children: (
                    <Table<AssignmentPreview>
                      rowKey="application_id"
                      dataSource={g.items}
                      columns={groupColumns}
                      pagination={false}
                      size="small"
                    />
                  ),
                };
              })}
            />
          )}
        </Card>
      )}
    </div>
  );
}
