// API publique du RAG. Le reste des fonctions importe depuis "./_shared/rag",
// jamais depuis un module interne.
export * from "./types";
export * from "./config";
export { detectLanguage, type Lang } from "./language";
export { extractDocument } from "./extract";
export { chunkPages, chunkText, headingOf, normalizeText, splitRanges } from "./chunking";
export { embedQuery, embedTexts, embeddingInput, embeddingsEnabled, EmbeddingError } from "./embeddings";
export {
  DocumentExistsError,
  getStore,
  setStore,
  supabaseStore,
  type PendingChunk,
  type RagStore,
  type SearchParams,
} from "./store";
export { dedupeAdjacent, relevance, retrieveDocChunks } from "./retrieval";
export { candidateEmptyAnswer, getScoreBreakdown, retrieveCandidates } from "./candidates";
export {
  embedPending,
  EmptyDocumentError,
  guessDocType,
  ingestDocument,
  ingestPages,
  type IngestResult,
} from "./ingest";
export { focusText, toolResultContent } from "./context";
export { FINAL_ROUND_INSTRUCTION, SYSTEM, TOOLS } from "./prompt";
export { clampInt, optionalNumber, runTool, type ToolArgs, type ToolResult } from "./tools";
export {
  FALLBACK_ANSWER,
  runAgent,
  sanitizeHistory,
  unverifiedCitations,
  type AgentEvent,
  type ChatMessage,
} from "./agent";
