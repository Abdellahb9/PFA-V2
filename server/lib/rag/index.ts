// API publique du RAG (extraction, découpage, vecteurs, stockage, recherche).
// L'assistant qui s'en sert vit dans lib/assistant. Le reste du serveur importe
// depuis "lib/rag", jamais depuis un module interne.
export * from "./types";
export * from "./config";
export { detectLanguage, type Lang } from "./language";
export { clip, ragDebug, ragDebugEnabled } from "./debug";
export { extractDocument } from "./extract";
export { chunkPages, chunkText, documentTitle, headingOf, normalizeText, splitRanges } from "./chunking";
export { embedQuery, embedTexts, embeddingInput, embeddingsEnabled, EmbeddingError, queryInput } from "./embeddings";
export {
  DocumentExistsError,
  getStore,
  setStore,
  supabaseStore,
  type DocumentLink,
  type PendingChunk,
  type RagStore,
  type SearchParams,
} from "./store";
export { mergeAdjacent, relevance, retrieveDocChunks } from "./retrieval";
export {
  embedPending,
  EmptyDocumentError,
  cvDocumentName,
  cvTitle,
  guessDocType,
  ingestDocument,
  ingestPages,
  type IngestResult,
} from "./ingest";
export { focusText, toolResultContent } from "./context";
