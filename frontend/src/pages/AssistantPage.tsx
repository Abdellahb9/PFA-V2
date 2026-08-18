// Assistant RAG : conversation en flux avec un agent à outils, plus la
// gestion de la base documentaire (staff). L'agent choisit lui-même quel outil
// appeler et tient compte des tours précédents — « et son université ? » porte
// sur le candidat dont on vient de parler.
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
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
  theme,
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
  useDeleteKnowledgeDocument,
  useIngestKnowledgeDocument,
  useKnowledgeDocuments,
} from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import { streamChat, TOOL_LABELS } from "@/api/chat";
import type { AgentEvent, ChatMessage, StoredConversation } from "@/api/chat";
import { api } from "@/api/client";
import type {
  AssistantCandidateSource,
  AssistantChunkSource,
  AssistantSource,
} from "@/api/types";

const { Text, Paragraph } = Typography;


// The assistant answers in the language of the question (FR / EN).
// Exemples choisis pour aboutir avec les données réelles : ils couvrent la
// recherche de profils, le croisement offre/candidats et le suivi d'une
// candidature — sans dépendre d'un identifiant codé en dur.
const EXAMPLES = [
  "Trouve-moi des candidats qui savent faire du Python",
  "Quelles offres de stage sont ouvertes ?",
  "Quels candidats ont un niveau Bac+5 ?",
  "Quel profil correspond le mieux à l'offre Data Science ?",
];

/** Un tour affiché : le texte diffusé + les outils utilisés + les preuves. */
interface Turn {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  sources?: AssistantSource[];
  streaming?: boolean;
}

// Render the retrieved evidence appropriately for each skill.
// L'agent peut mélanger les sources dans un même tour : on les regroupe par
// type au lieu de se fier à une intention unique.
function Sources({ sources }: { sources: AssistantSource[] }) {
  if (!sources.length) return null;
  const candidates = sources.filter((s) => (s as { type?: string }).type === "candidate");
  const chunks = sources.filter((s) => (s as { type?: string }).type === "doc_chunk");

  return (
    <>
      <CandidateSources rows={candidates as AssistantCandidateSource[]} />
      <ChunkSources rows={chunks as AssistantChunkSource[]} />
    </>
  );
}

function CandidateSources({ rows }: { rows: AssistantCandidateSource[] }) {
  if (!rows.length) return null;
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

function ChunkSources({ rows }: { rows: AssistantChunkSource[] }) {
  if (!rows.length) return null;
  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      items={rows.map((c, i) => ({
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

export default function AssistantPage() {
  const { token } = theme.useToken();
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const docs = useKnowledgeDocuments();
  const ingest = useIngestKnowledgeDocument();
  const removeDoc = useDeleteKnowledgeDocument();

  // Suivre le bas du fil pendant que la réponse s'écrit.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Reprendre le fil le plus récent à l'ouverture de la page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: list } = await api.get<{ id: number }[]>("/assistant/conversations");
        if (!list?.length || cancelled) return;
        const { data: conv } = await api.get<StoredConversation>(
          `/assistant/conversations/${list[0].id}`,
        );
        if (cancelled || !conv?.messages?.length) return;
        setConversationId(conv.id);
        setTurns(
          conv.messages.map((m) => ({
            role: m.role,
            content: m.content,
            tools: (m.tools ?? []).map((t) => TOOL_LABELS[t] ?? t),
            sources: (m.sources ?? []) as AssistantSource[],
          })),
        );
      } catch {
        /* pas de fil enregistré (ou migration non appliquée) : on démarre à vide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onAsk = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q || busy) return;

    // L'historique envoyé au serveur est celui affiché, question comprise.
    const sent: ChatMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: q },
    ];

    setQuery("");
    setBusy(true);
    setTurns((t) => [
      ...t,
      { role: "user", content: q },
      { role: "assistant", content: "", tools: [], streaming: true },
    ]);

    // Ne réécrire que le dernier tour, celui en cours de rédaction.
    const patchLast = (fn: (t: Turn) => Turn) =>
      setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        sent,
        (ev: AgentEvent) => {
          if (ev.type === "delta") {
            patchLast((t) => ({ ...t, content: t.content + ev.text }));
          } else if (ev.type === "tool") {
            const label = TOOL_LABELS[ev.name] ?? ev.name;
            patchLast((t) => ({ ...t, tools: [...(t.tools ?? []), label] }));
          } else if (ev.type === "sources") {
            patchLast((t) => ({ ...t, sources: ev.sources as AssistantSource[] }));
          } else if (ev.type === "error") {
            patchLast((t) => ({ ...t, content: t.content || ev.message }));
          } else if (ev.type === "conversation") {
            setConversationId(ev.conversation_id);
          } else if (ev.type === "done") {
            patchLast((t) => ({ ...t, streaming: false }));
          }
        },
        controller.signal,
        conversationId,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const detail = err instanceof Error ? err.message : "L'assistant est indisponible";
        patchLast((t) => ({ ...t, content: t.content || detail, streaming: false }));
        message.error(detail);
      }
    } finally {
      patchLast((t) => ({ ...t, streaming: false }));
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onStop = () => abortRef.current?.abort();
  const onReset = () => {
    abortRef.current?.abort();
    setTurns([]);
    setConversationId(null); // le prochain message ouvrira un nouveau fil
  };

  return (
    <Row gutter={[16, 16]}>
      {/* ---- Chat panel ---- */}
      <Col xs={24} lg={16}>
        <Card
          title={
            <Space>
              <RobotOutlined style={{ color: token.colorPrimary }} />
              Assistant RAG
            </Space>
          }
          extra={
            turns.length > 0 && (
              <Button size="small" onClick={onReset}>
                Nouvelle conversation
              </Button>
            )
          }
        >
          {turns.length === 0 ? (
            <div style={{ padding: "24px 0" }}>
              <Paragraph type="secondary">
                Discutez en langage naturel. L'assistant cherche lui-même dans les candidats,
                les offres, les réservations et les documents — et il se souvient des messages
                précédents, donc vous pouvez enchaîner&nbsp;: «&nbsp;et sa filière&nbsp;?&nbsp;»
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
              {turns.map((turn, i) =>
                turn.role === "user" ? (
                  <Paragraph key={i} style={{ marginBottom: 8, marginTop: i ? 20 : 0 }}>
                    <UserOutlined /> <strong>{turn.content}</strong>
                  </Paragraph>
                ) : (
                  <Card key={i} size="small" style={{ background: "transparent" }}>
                    <Space style={{ marginBottom: 8 }} size={6} wrap>
                      <RobotOutlined style={{ color: token.colorPrimary }} />
                      {(turn.tools ?? []).map((t, k) => (
                        <Tag key={k} color="blue">
                          {t}
                        </Tag>
                      ))}
                      {turn.streaming && !turn.content && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          réflexion…
                        </Text>
                      )}
                    </Space>
                    <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                      {turn.content}
                      {turn.streaming && turn.content && (
                        <span style={{ opacity: 0.5 }}>▍</span>
                      )}
                    </Paragraph>
                    {!turn.streaming && <Sources sources={turn.sources ?? []} />}
                  </Card>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          )}

          <Space.Compact style={{ width: "100%", marginTop: 16 }}>
            <Input
              placeholder="Votre message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => onAsk()}
              disabled={busy}
            />
            {busy ? (
              <Button danger onClick={onStop}>
                Arrêter
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={() => onAsk()}>
                Envoyer
              </Button>
            )}
          </Space.Compact>

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
              <InboxOutlined style={{ color: token.colorPrimary }} />
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
