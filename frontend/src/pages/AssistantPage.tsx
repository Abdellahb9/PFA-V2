// Assistant personnel des recruteurs : conversation en flux avec un agent qui
// connaît chaque candidat (CV, candidatures, résultats, notes), plus la base de
// connaissances (staff). L'agent choisit lui-même ses outils et tient compte
// des tours précédents — « et son université ? » porte sur le candidat dont on
// vient de parler. Un CV déposé ici crée ou complète un candidat.
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
  Radio,
  Row,
  Skeleton,
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
  EditOutlined,
  FilePdfOutlined,
  IdcardOutlined,
  InboxOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  useDeleteKnowledgeDocument,
  useIngestKnowledgeDocument,
  useKnowledgeDocuments,
  useReindexKnowledge,
} from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import AssistantMessage from "@/components/AssistantMessage";
import { streamChat, TOOL_LABELS } from "@/api/chat";
import type { AgentEvent, StoredConversation } from "@/api/chat";
import { api } from "@/api/client";
import type {
  AssistantCandidateSource,
  AssistantChunkSource,
  AssistantDossierSource,
  AssistantNoteSource,
  AssistantRankedSource,
  AssistantSource,
  DocType,
} from "@/api/types";

const { Text, Paragraph } = Typography;

/** Statut d'une candidature, avec les libellés de la page Candidatures. */
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  submitted: { label: "Reçue", color: "default" },
  parsing: { label: "En analyse", color: "processing" },
  parsed: { label: "Analysée", color: "blue" },
  under_review: { label: "En revue", color: "gold" },
  assigned: { label: "Affectée", color: "green" },
  rejected: { label: "Refusée", color: "red" },
  failed: { label: "Analyse échouée", color: "red" },
};

function StatusTag({ status }: { status?: string | null }) {
  if (!status) return <Text type="secondary">—</Text>;
  const meta = STATUS_LABEL[status] ?? { label: status, color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

// Exemples qui aboutissent avec les données réelles, sans identifiant codé en
// dur. L'assistant répond dans la langue de la question (FR / EN).
const EXAMPLES = [
  "Combien de candidats avons-nous, et combien de CV ?",
  "Qui sont les 3 meilleurs candidats en Data Science ?",
  "Quelles offres de stage sont ouvertes ?",
  "Qui est affecté au stage Automatisme & GMAO ?",
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
function Sources({
  sources,
  openIndex,
}: {
  sources: AssistantSource[];
  /** Index 1-based de l'extrait à déplier, piloté par un badge de citation. */
  openIndex?: number;
}) {
  if (!sources.length) return null;
  const ofType = (t: string) => sources.filter((s) => (s as { type?: string }).type === t);

  return (
    <>
      <DossierSources rows={ofType("candidate_dossier") as AssistantDossierSource[]} />
      <NoteSources rows={ofType("note") as AssistantNoteSource[]} />
      <RankedSources rows={ofType("ranked_candidate") as AssistantRankedSource[]} />
      <CandidateSources rows={ofType("candidate") as AssistantCandidateSource[]} />
      <ChunkSources rows={ofType("doc_chunk") as AssistantChunkSource[]} openIndex={openIndex} />
    </>
  );
}

/** Dossiers consultés : à qui la réponse se rapporte, et où en est sa candidature. */
function DossierSources({ rows }: { rows: AssistantDossierSource[] }) {
  if (!rows.length) return null;
  return (
    <Space direction="vertical" size={4} style={{ marginTop: 12, width: "100%" }}>
      {rows.map((d) => (
        <Space key={d.candidate_id} size={6} wrap>
          <IdcardOutlined />
          <strong>{d.name}</strong>
          {d.field_of_study && <Text type="secondary">{d.field_of_study}</Text>}
          <StatusTag status={d.status} />
          {d.offer ? <Tag>{d.offer}</Tag> : d.status ? <Tag>candidature spontanée</Tag> : null}
        </Space>
      ))}
    </Space>
  );
}

/** Notes enregistrées à la demande : on montre exactement ce qui a été retenu. */
function NoteSources({ rows }: { rows: AssistantNoteSource[] }) {
  if (!rows.length) return null;
  return (
    <Space direction="vertical" size={4} style={{ marginTop: 12, width: "100%" }}>
      {rows.map((n) => (
        <Alert
          key={n.note_id}
          type="success"
          showIcon
          icon={<EditOutlined />}
          message={`Note enregistrée sur ${n.name}`}
          description={n.body}
        />
      ))}
    </Space>
  );
}

/**
 * Le classement lui-même. On montre POURQUOI chacun est à sa place — critères
 * couverts en vert, critères requis manquants en rouge — pour que la décision
 * reste celle du recruteur, pas celle d'un score opaque.
 */
function RankedSources({ rows }: { rows: AssistantRankedSource[] }) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return (
    <Table<AssistantRankedSource>
      rowKey="candidate_id"
      dataSource={sorted}
      pagination={false}
      size="small"
      style={{ marginTop: 12 }}
      scroll={{ x: "max-content" }}
      columns={[
        { title: "#", dataIndex: "rank", key: "rank", width: 44 },
        {
          title: "Candidat",
          key: "name",
          render: (_: unknown, r: AssistantRankedSource) => (
            <Space direction="vertical" size={0}>
              <strong>{r.name}</strong>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {[r.education_level, r.field_of_study].filter(Boolean).join(" · ") || "—"}
              </Text>
            </Space>
          ),
        },
        {
          title: "Adéquation",
          dataIndex: "score",
          key: "score",
          width: 130,
          render: (v: number) => (
            <Progress percent={Math.round(v * 100)} size="small" style={{ width: 110 }} />
          ),
        },
        {
          title: "Couvre",
          dataIndex: "matched",
          key: "matched",
          render: (m: string[]) => (
            <Space size={4} wrap>
              {m.map((s) => (
                <Tag key={s} color="green">
                  {s}
                </Tag>
              ))}
            </Space>
          ),
        },
        {
          title: "Manque",
          dataIndex: "missing",
          key: "missing",
          render: (m: string[]) =>
            m.length ? (
              <Space size={4} wrap>
                {m.map((s) => (
                  <Tag key={s} color="red">
                    {s}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Text type="secondary">—</Text>
            ),
        },
      ]}
    />
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
          title: "Candidature",
          dataIndex: "status",
          key: "status",
          render: (s: string | null | undefined) => <StatusTag status={s} />,
        },
      ]}
    />
  );
}

function ChunkSources({
  rows,
  openIndex,
}: {
  rows: AssistantChunkSource[];
  openIndex?: number;
}) {
  const keyOf = (c: AssistantChunkSource, i: number) =>
    `${c.source_document}-${c.chunk_index}-${i}`;

  // Panneau contrôlé, mais l'utilisateur garde la main : `onChange` réécrit
  // l'état, et un clic sur un badge de citation force l'ouverture du bon
  // extrait. Le modèle numérote ses citations à partir de 1.
  const [active, setActive] = useState<string[]>([]);
  useEffect(() => {
    if (openIndex == null) return;
    const target = rows[openIndex - 1];
    if (target) setActive([keyOf(target, openIndex - 1)]);
    // keyOf est stable pour un jeu de lignes donné.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex, rows]);

  if (!rows.length) return null;
  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      activeKey={active}
      onChange={(k) => setActive(Array.isArray(k) ? k : [k])}
      items={rows.map((c, i) => ({
        key: keyOf(c, i),
        label: (
          <Space size={6} wrap>
            <FilePdfOutlined />
            <strong>{c.title ?? c.source_document}</strong>
            {c.page != null ? <Tag>p. {c.page}</Tag> : <Tag>extrait #{c.chunk_index + 1}</Tag>}
            {c.heading && <Tag>{c.heading}</Tag>}
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
  // Badge de citation cliqué : { tour concerné, index 1-based de l'extrait }.
  const [citation, setCitation] = useState<{ turn: number; index: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const docs = useKnowledgeDocuments();
  const ingest = useIngestKnowledgeDocument();
  const removeDoc = useDeleteKnowledgeDocument();
  const reindex = useReindexKnowledge();
  // « Automatique » : le serveur reconnaît un CV à son nom (cv, resume…).
  const [uploadType, setUploadType] = useState<"auto" | DocType>("auto");

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
      // Seul le nouveau message part : le serveur relit le fil en base.
      await streamChat(
        q,
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
                    <AssistantMessage
                      content={turn.content}
                      streaming={turn.streaming}
                      onCite={(n) => setCitation({ turn: i, index: n })}
                    />
                    {!turn.streaming && (
                      <Sources
                        sources={turn.sources ?? []}
                        openIndex={citation?.turn === i ? citation.index : undefined}
                      />
                    )}
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
        <Card
          title="Base de connaissances"
          extra={
            <Popconfirm
              title="Réanalyser et réindexer tous les CV ?"
              description="Chaque candidat muni d'un CV est réanalysé en tâche de fond."
              okText="Réindexer"
              cancelText="Annuler"
              onConfirm={async () => {
                try {
                  const r = await reindex.mutateAsync();
                  message.success(
                    `${r.analyses} CV relancé(s) en analyse, ${r.indexes_sans_fichier} indexé(s) depuis le texte connu`,
                  );
                } catch (err) {
                  message.error(apiErrorMessage(err, "Réindexation impossible"));
                }
              }}
            >
              <Button size="small" icon={<ReloadOutlined />} loading={reindex.isPending}>
                Réindexer
              </Button>
            </Popconfirm>
          }
        >
          <Radio.Group
            size="small"
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value)}
            style={{ marginBottom: 8 }}
            options={[
              { label: "Automatique", value: "auto" },
              { label: "CV", value: "cv" },
              { label: "Autre document", value: "other" },
            ]}
            optionType="button"
          />
          <Upload.Dragger
            accept=".pdf,.docx,.txt,.md"
            multiple={false}
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              const docType: DocType | undefined = uploadType === "auto" ? undefined : uploadType;
              const send = (replace?: boolean) =>
                ingest.mutateAsync({ file: file as File, replace, docType });
              try {
                let res;
                try {
                  res = await send();
                } catch (err) {
                  // 409 : un document porte déjà ce nom. Le serveur ne l'écrase
                  // plus tout seul — on demande confirmation avant de remplacer.
                  const status = (err as { response?: { status?: number } })?.response?.status;
                  if (status !== 409) throw err;
                  const name = (file as File).name;
                  if (!window.confirm(`« ${name} » existe déjà. Remplacer ses extraits ?`)) {
                    onError?.(err as Error);
                    return;
                  }
                  res = await send(true);
                }
                if (res.status === "analysis") {
                  message.success(
                    "CV reçu : le candidat est créé (ou retrouvé par son e-mail), son CV est en cours d'analyse.",
                  );
                } else {
                  message.success(`Document indexé — ${res.chunks} extrait(s) interrogeables`);
                }
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
            <p className="ant-upload-text">Déposez un CV ou un document (PDF, DOCX, TXT, MD)</p>
            <p className="ant-upload-hint">
              Un CV crée ou complète la fiche du candidat, puis est analysé et indexé sous son
              nom. Un autre document (compte rendu d'entretien…) est indexé tel quel.
            </p>
          </Upload.Dragger>

          <div style={{ marginTop: 16 }}>
            {/* Trois états DISTINCTS. « Aucun document indexé » est une
                affirmation : on ne la prononce qu'une fois la réponse reçue.
                Sans la branche de chargement, elle s'affichait dès la première
                ouverture, pendant que la requête était encore en vol — et donc
                en contradiction avec l'assistant, qui citait un document. */}
            {docs.isLoading ? (
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            ) : docs.isError ? (
              <Alert
                type="warning"
                showIcon
                message="Base documentaire indisponible"
                description={apiErrorMessage(docs.error, "L'API assistant n'est pas joignable.")}
                action={
                  <Button size="small" onClick={() => docs.refetch()}>
                    Réessayer
                  </Button>
                }
              />
            ) : !docs.data?.length ? (
              <Empty description="Aucun CV ni document indexé — déposez un CV ou cliquez sur Réindexer" />
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
                      title={
                        <Space size={6} wrap>
                          {/* Un CV porte le nom de son candidat. */}
                          {d.title ?? d.source_document}
                          <Tag color={d.doc_type === "cv" ? "gold" : "blue"}>
                            {d.doc_type === "cv" ? "CV" : "autre"}
                          </Tag>
                          {/* La recherche par le sens n'atteint ce document qu'une
                              fois ses extraits vectorisés (tâche de fond). */}
                          {d.embedded != null && d.embedded < d.chunks && (
                            <Tag color="orange">indexation sémantique en cours</Tag>
                          )}
                        </Space>
                      }
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
