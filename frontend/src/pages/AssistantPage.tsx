// Assistant RAG page: chat-style Q&A over the three skills (candidate search,
// score explanation, policy documents) + knowledge-base management (staff).
import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import {
  DeleteOutlined,
  FilePdfOutlined,
  InboxOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  useAssistantQuery,
  useDeleteKnowledgeDocument,
  useIngestKnowledgeDocument,
  useKnowledgeDocuments,
} from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type {
  AssistantCandidateSource,
  AssistantChunkSource,
  AssistantIntent,
  AssistantResponse,
  AssistantSource,
} from "@/api/types";

const { Text, Paragraph } = Typography;

const INTENT_LABELS: Record<AssistantIntent, { label: string; color: string }> = {
  candidate_search: { label: "Recherche de candidats", color: "blue" },
  matching_explanation: { label: "Explication de score", color: "gold" },
  policy_qa: { label: "Documents & politique", color: "green" },
};

// The assistant answers in the language of the question (FR / EN).
const EXAMPLES = [
  "Trouve-moi des candidats Python avec au moins 2 ans d'expérience",
  "Quelle est la durée maximale d'un stage ?",
  "What is the internship remuneration policy?",
];

interface ChatTurn {
  question: string;
  response: AssistantResponse;
}

// Render the retrieved evidence appropriately for each skill.
function Sources({ intent, sources }: { intent: AssistantIntent; sources: AssistantSource[] }) {
  if (!sources.length) return null;

  if (intent === "candidate_search") {
    const rows = sources as AssistantCandidateSource[];
    return (
      <Table<AssistantCandidateSource>
        rowKey="candidate_id"
        dataSource={rows}
        pagination={false}
        size="small"
        style={{ marginTop: 12 }}
        columns={[
          { title: "Candidat", dataIndex: "name", key: "name" },
          { title: "Formation", dataIndex: "education_level", key: "education_level" },
          {
            title: "Expérience",
            dataIndex: "years_experience",
            key: "years_experience",
            render: (v: number) => `${v} an${v > 1 ? "s" : ""}`,
          },
          {
            title: "Compétences",
            dataIndex: "skills",
            key: "skills",
            render: (skills: string[]) => (
              <Space size={4} wrap>
                {skills.slice(0, 6).map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
                {skills.length > 6 && <Tag>+{skills.length - 6}</Tag>}
              </Space>
            ),
          },
          {
            title: "Pertinence",
            dataIndex: "similarity",
            key: "similarity",
            render: (v: number) => (
              <Progress percent={Math.round(v * 100)} size="small" style={{ width: 90 }} />
            ),
          },
        ]}
      />
    );
  }

  if (intent === "policy_qa") {
    const chunks = sources as AssistantChunkSource[];
    return (
      <Collapse
        size="small"
        style={{ marginTop: 12 }}
        items={chunks.map((c, i) => ({
          key: `${c.source_document}-${c.chunk_index}-${i}`,
          label: (
            <Space size={6} wrap>
              <FilePdfOutlined />
              <strong>{c.source_document}</strong>
              <Tag>extrait #{c.chunk_index + 1}</Tag>
              <Tag color="green">pertinence {Math.round(c.similarity * 100)}%</Tag>
            </Space>
          ),
          children: <Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.text}</Paragraph>,
        }))}
      />
    );
  }

  return null; // matching_explanation: the answer itself carries the breakdown
}

export default function AssistantPage() {
  const [query, setQuery] = useState("");
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = useAssistantQuery();
  const docs = useKnowledgeDocuments();
  const ingest = useIngestKnowledgeDocument();
  const removeDoc = useDeleteKnowledgeDocument();

  const onAsk = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q) return;
    try {
      const response = await ask.mutateAsync({
        query: q,
        assignment_id: assignmentId ?? undefined,
      });
      setHistory((h) => [...h, { question: q, response }]);
      setQuery("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      message.error(apiErrorMessage(err, "L'assistant est indisponible"));
    }
  };

  return (
    <Row gutter={[16, 16]}>
      {/* ---- Chat panel ---- */}
      <Col xs={24} lg={16}>
        <Card
          title={
            <Space>
              <RobotOutlined style={{ color: "#76B900" }} />
              Assistant RAG
            </Space>
          }
        >
          {history.length === 0 ? (
            <div style={{ padding: "24px 0" }}>
              <Paragraph type="secondary">
                Posez une question en langage naturel — l'assistant choisit automatiquement la
                bonne source&nbsp;: profils de candidats, scores de matching ou documents de
                politique de stage.
              </Paragraph>
              <Space direction="vertical" style={{ width: "100%" }}>
                {EXAMPLES.map((ex) => (
                  <Button key={ex} type="dashed" block onClick={() => onAsk(ex)}>
                    {ex}
                  </Button>
                ))}
              </Space>
            </div>
          ) : (
            <div style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: 8 }}>
              {history.map((turn, i) => {
                const intent = INTENT_LABELS[turn.response.intent];
                return (
                  <div key={i} style={{ marginBottom: 20 }}>
                    <Paragraph style={{ marginBottom: 8 }}>
                      <UserOutlined /> <strong>{turn.question}</strong>
                    </Paragraph>
                    <Card size="small" style={{ background: "transparent" }}>
                      <Space style={{ marginBottom: 8 }}>
                        <RobotOutlined style={{ color: "#76B900" }} />
                        <Tag color={intent.color}>{intent.label}</Tag>
                      </Space>
                      <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                        {turn.response.answer}
                      </Paragraph>
                      <Sources intent={turn.response.intent} sources={turn.response.sources} />
                    </Card>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}

          <Space.Compact style={{ width: "100%", marginTop: 16 }}>
            <Input
              placeholder="Votre question…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => onAsk()}
              disabled={ask.isPending}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={ask.isPending}
              onClick={() => onAsk()}
            >
              Envoyer
            </Button>
          </Space.Compact>
          <Space style={{ marginTop: 8 }} size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Affectation (optionnel)&nbsp;:
            </Text>
            <InputNumber
              size="small"
              min={1}
              placeholder="ID"
              value={assignmentId}
              onChange={(v) => setAssignmentId(v ?? null)}
              style={{ width: 90 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              — renseignez un ID d'affectation pour expliquer son score.
            </Text>
          </Space>
        </Card>
      </Col>

      {/* ---- Knowledge base panel ---- */}
      <Col xs={24} lg={8}>
        <Card title="Base documentaire (politique de stage)">
          <Upload.Dragger
            accept=".pdf,.docx,.txt"
            multiple={false}
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                await ingest.mutateAsync({ file: file as File });
                message.success("Document envoyé — indexation en cours (quelques secondes)");
                onSuccess?.(undefined);
              } catch (err) {
                message.error(apiErrorMessage(err, "Échec de l'envoi"));
                onError?.(err as Error);
              }
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: "#76B900" }} />
            </p>
            <p className="ant-upload-text">Déposez un document PDF, DOCX ou TXT</p>
            <p className="ant-upload-hint">
              Il sera découpé, vectorisé et interrogeable par l'assistant.
            </p>
          </Upload.Dragger>

          <div style={{ marginTop: 16 }}>
            {docs.isError ? (
              <Alert
                type="warning"
                showIcon
                message="Base documentaire indisponible"
                description="L'API assistant n'est pas joignable."
              />
            ) : !docs.data?.length ? (
              <Empty description="Aucun document indexé" />
            ) : (
              <List
                size="small"
                dataSource={docs.data}
                renderItem={(d) => (
                  <List.Item
                    actions={[
                      <Popconfirm
                        key="del"
                        title="Supprimer ce document de la base ?"
                        okText="Supprimer"
                        cancelText="Annuler"
                        onConfirm={async () => {
                          try {
                            await removeDoc.mutateAsync(d.source_document);
                            message.success("Document supprimé");
                          } catch (err) {
                            message.error(apiErrorMessage(err, "Suppression impossible"));
                          }
                        }}
                      >
                        <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<FilePdfOutlined />}
                      title={d.source_document}
                      description={`${d.chunks} extrait${d.chunks > 1 ? "s" : ""} indexé${
                        d.chunks > 1 ? "s" : ""
                      }`}
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </Card>
      </Col>
    </Row>
  );
}
