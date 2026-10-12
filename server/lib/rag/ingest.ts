// Ingestion : document → pages → extraits → stockage, puis vectorisation.
//
// Deux temps, volontairement :
//   1. synchrone, dans la requête de dépôt : extraction, découpage, écriture
//      atomique. Le document est aussitôt trouvable en plein-texte.
//   2. en tâche de fond (rag-embed-background) : vectorisation des extraits en
//      attente. Un gros PDF compte des centaines d'extraits ; les vectoriser
//      dans la requête dépasserait le délai d'une fonction synchrone.
import { chunkPages, documentTitle } from "./chunking";
import { EMBED_BATCH } from "./config";
import { embeddingInput, embeddingsEnabled, embedTexts } from "./embeddings";
import { extractDocument } from "./extract";
import { getStore, type DocumentLink } from "./store";
import type { Chunk, DocType, PageText } from "./types";

export interface IngestResult {
  source_document: string;
  doc_type: DocType;
  chunks: number;
  /** "pending" : la vectorisation est confiée à la tâche de fond. */
  embeddings: "pending" | "disabled";
}

export class EmptyDocumentError extends Error {
  constructor() {
    super("Aucun texte extrait du document");
    this.name = "EmptyDocumentError";
  }
}

/**
 * Nom (unique) du document qui porte le CV d'un candidat : un seul CV indexé
 * par personne, remplacé à chaque nouvelle analyse.
 */
export function cvDocumentName(candidateId: number): string {
  return `cv-candidat-${candidateId}`;
}

/** Titre affiché du CV d'un candidat, repris dans les citations. */
export function cvTitle(candidateName: string): string {
  return `CV — ${candidateName.trim()}`;
}

/** Devine le type d'un document à partir de son titre et de son nom de fichier. */
export function guessDocType(title: string, filename: string): DocType {
  return /(^|[^a-z])cv([^a-z]|$)|resume|résumé|curriculum/i.test(`${title} ${filename}`)
    ? "cv"
    : "other";
}

/** Écrit des pages déjà extraites. Exposé pour les tests et la démonstration. */
export async function ingestPages(
  name: string,
  pages: PageText[],
  docType: DocType,
  replace: boolean,
  link: DocumentLink & { headingTitle?: string | null } = {},
): Promise<IngestResult> {
  // Le titre des intertitres : celui imposé (le nom du candidat pour un CV),
  // sinon déduit du document.
  const chunks: Chunk[] = chunkPages(pages, link.headingTitle ?? documentTitle(name, pages));
  if (!chunks.length) throw new EmptyDocumentError();
  const res = await getStore().replaceDocument(name, docType, chunks, replace, {
    candidateId: link.candidateId ?? null,
    title: link.title ?? null,
  });
  return {
    source_document: name,
    doc_type: docType,
    chunks: res.chunks,
    embeddings: embeddingsEnabled() ? "pending" : "disabled",
  };
}

export async function ingestDocument(input: {
  name: string;
  data: Uint8Array;
  filename: string;
  docType: DocType;
  replace: boolean;
}): Promise<IngestResult> {
  const pages = await extractDocument(input.data, input.filename);
  if (!pages.length) throw new EmptyDocumentError();
  return ingestPages(input.name, pages, input.docType, input.replace);
}

/**
 * Vectorise les extraits en attente, lot par lot, jusqu'à épuisement ou jusqu'à
 * `maxChunks`. Idempotent : ne traite que les extraits sans vecteur, donc sert
 * aussi de rattrapage après une panne ou l'ajout tardif de la clé.
 */
export async function embedPending(maxChunks = 5000): Promise<number> {
  if (!embeddingsEnabled()) return 0;
  const store = getStore();
  let done = 0;
  while (done < maxChunks) {
    const batch = await store.pendingChunks(Math.min(EMBED_BATCH * 4, maxChunks - done));
    if (!batch.length) break;
    const vectors = await embedTexts(batch.map((c) => embeddingInput(c.content, c.heading)));
    const written = await store.setEmbeddings(
      batch.map((c, i) => ({ id: c.id, embedding: vectors[i] })),
    );
    // Rien d'écrit (extraits supprimés entre-temps) : sortir plutôt que boucler.
    if (written === 0) break;
    done += written;
  }
  return done;
}
