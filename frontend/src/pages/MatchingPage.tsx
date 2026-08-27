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
  Popover,
  Slider,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  Progress,
  Space,
  message,
  theme,
} from "antd";
import {
  ThunderboltOutlined,
  CheckOutlined,
  CloseOutlined,
  TrophyOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import ScoreBreakdownChart from "@/components/ScoreBreakdownChart";
import {
  useAssignCandidate,
  useDecideProposal,
  useOfferRankings,
  useRunMatching,
} from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type { AssignmentPreview, MatchingResult, RankedCandidate } from "@/api/types";

export default function MatchingPage() {
  const { token } = theme.useToken();
  // Weights for the composite score (skills + education — no embeddings).
  const [skills, setSkills] = useState(0.7);
  const [education, setEducation] = useState(0.3);
  const [persist, setPersist] = useState(false);
  const [result, setResult] = useState<MatchingResult | null>(null);
  const [showRankings, setShowRankings] = useState(false);

  const runMatching = useRunMatching();
  const decideProposal = useDecideProposal();
  const rankings = useOfferRankings({ skills, education }, showRankings);
  const assign = useAssignCandidate();

  const onAssign = async (applicationId: number, offerId: number) => {
    try {
      await assign.mutateAsync({ application_id: applicationId, offer_id: offerId });
      // Dire explicitement qu'il reste une étape : le message précédent laissait
      // penser que le candidat était affecté pour de bon.
      message.success("Proposition créée — à confirmer dans « Propositions à valider »");
      rankings.refetch();
    } catch (err) {
      message.error(apiErrorMessage(err, "Affectation impossible"));
    }
  };

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

  // La proposition est identifiée par (candidature, offre) : en mode aperçu elle
  // n'a pas encore de ligne en base, et l'ancien code envoyait application_id là
  // où l'API attend un id d'affectation — au mieux un 404, au pire la
  // confirmation de l'affectation d'un autre candidat portant ce numéro.
  const onDecide = async (row: AssignmentPreview, status: "confirmed" | "rejected") => {
    try {
      await decideProposal.mutateAsync({
        application_id: row.application_id,
        offer_id: row.offer_id,
        status,
      });
      message.success(
        status === "confirmed"
          ? `${row.candidate_name} affecté à « ${row.offer_title} »`
          : `Proposition rejetée pour ${row.candidate_name}`,
      );
      // La ligne décidée disparaît de l'aperçu : elle est tranchée.
      setResult((r) =>
        r
          ? {
              ...r,
              assignments: r.assignments.filter(
                (a) =>
                  !(a.application_id === row.application_id && a.offer_id === row.offer_id),
              ),
            }
          : r,
      );
    } catch (err) {
      message.error(apiErrorMessage(err, "Décision impossible"));
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
        <Popover
          trigger="click"
          title="Explication du score (XAI)"
          content={<ScoreBreakdownChart breakdown={r.score_breakdown} score={r.match_score} />}
        >
          <Space size={4} style={{ cursor: "pointer" }}>
            <Tag color="blue">Comp {Math.round(r.score_breakdown.skills * 100)}%</Tag>
            <Tag color="gold">Étud {Math.round(r.score_breakdown.education * 100)}%</Tag>
            <BarChartOutlined style={{ color: token.colorPrimary }} />
          </Space>
        </Popover>
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
            onClick={() => onDecide(r, "confirmed")}
          >
            Confirmer
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => onDecide(r, "rejected")}
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

  // Columns for the per-offer ranking (every compatible candidate, with manual assign).
  const rankingColumns = (offerId: number) => [
    { title: "Candidat", dataIndex: "candidate_name", key: "candidate_name" },
    {
      title: "Score",
      dataIndex: "match_score",
      key: "match_score",
      render: (v: number) => (
        <Progress percent={Math.round(v * 100)} size="small" style={{ width: 110 }} />
      ),
    },
    {
      title: "Détail du score",
      key: "breakdown",
      render: (_: unknown, r: RankedCandidate) => (
        <Popover
          trigger="click"
          title="Explication du score (XAI)"
          content={<ScoreBreakdownChart breakdown={r.score_breakdown} score={r.match_score} />}
        >
          <Space size={4} style={{ cursor: "pointer" }}>
            <Tag color="blue">Comp {Math.round(r.score_breakdown.skills * 100)}%</Tag>
            <Tag color="gold">Étud {Math.round(r.score_breakdown.education * 100)}%</Tag>
            <BarChartOutlined style={{ color: token.colorPrimary }} />
          </Space>
        </Popover>
      ),
    },
    {
      title: "Action",
      key: "action",
      render: (_: unknown, r: RankedCandidate) => (
        // « Affecter » laissait croire à une décision définitive : cette action
        // ne crée qu'une PROPOSITION (assignments.status = 'proposed'). La
        // confirmation se prend dans le tableau des propositions ci-dessus.
        <Button
          size="small"
          loading={assign.isPending}
          onClick={() => onAssign(r.application_id, offerId)}
        >
          Proposer
        </Button>
      ),
    },
  ];

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

      {/* Per-offer ranking of ALL compatible candidates (independent of the global run). */}
      <Card
        title="Classement des candidats par offre"
        style={{ marginTop: 16 }}
        extra={
          <Button
            icon={<TrophyOutlined />}
            loading={rankings.isFetching}
            onClick={() => (showRankings ? rankings.refetch() : setShowRankings(true))}
          >
            {showRankings ? "Recalculer" : "Calculer le classement"}
          </Button>
        }
      >
        {!showRankings ? (
          <Typography.Text type="secondary">
            Pour chaque offre, classe <strong>tous</strong> les candidats compatibles (même non
            affectés), du meilleur score au moins bon. Vous pouvez affecter manuellement
            n'importe quel candidat à l'offre. Cliquez sur « Calculer le classement ».
          </Typography.Text>
        ) : rankings.isLoading ? (
          <div style={{ textAlign: "center", padding: 40 }} role="status" aria-busy="true">
            <Spin size="large" />
          </div>
        ) : !rankings.data?.length ? (
          <Empty description="Aucune offre ouverte" />
        ) : (
          <Collapse
            items={rankings.data.map((r) => ({
              key: String(r.offer_id),
              label: (
                <Space wrap>
                  <strong>{r.offer_title}</strong>
                  <Tag>{r.department_name}</Tag>
                  <Tag color="purple">{r.slots} poste{r.slots > 1 ? "s" : ""}</Tag>
                  <Tag color="blue">
                    {r.candidates.length} candidat{r.candidates.length > 1 ? "s" : ""}
                  </Tag>
                </Space>
              ),
              children: (
                <Table<RankedCandidate>
                  rowKey="application_id"
                  dataSource={r.candidates}
                  columns={rankingColumns(r.offer_id)}
                  pagination={{ pageSize: 10 }}
                  size="small"
                />
              ),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
