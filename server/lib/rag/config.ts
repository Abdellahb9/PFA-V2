// Tous les réglages du RAG, en un seul endroit.
//
// Les planchers de pertinence des extraits sont passés en paramètres à la RPC
// rag_search_chunks (migration 0019) : il n'en existe aucune copie dans le SQL.
// Ceux des CANDIDATS, eux, vivent dans search_candidates ; un test
// (__tests__/migration-sync.test.ts) vérifie que les deux côtés concordent.

// ---- Découpage -----------------------------------------------------------------

/**
 * ~900 caractères ≈ 200-250 tokens. Assez court pour que cinq extraits tiennent
 * ENTIERS dans le budget d'un résultat d'outil (MAX_TOOL_RESULT_CHARS) : avec
 * 1600 caractères, chaque extrait était amputé de moitié avant d'atteindre le
 * modèle.
 */
export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;

// ---- Vectorisation ---------------------------------------------------------------

/**
 * Google Gemini, `gemini-embedding-2` : multilingue (français, anglais, arabe),
 * 8 192 tokens par texte. Réduit à 768 dimensions — une des tailles
 * recommandées, que le modèle renvoie déjà normalisée ; la colonne
 * rag_chunks.embedding est en vector(768) (migration 0022).
 */
export const EMBED_MODEL = "gemini-embedding-2";
export const EMBED_DIM = 768;
export const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
/** Textes par requête d'embeddings. */
export const EMBED_BATCH = 32;
/** Réessais sur 429 / 5xx, avec un délai croissant. */
export const EMBED_RETRIES = 2;
export const EMBED_TIMEOUT_MS = 15_000;
/** Délai court pour la requête de l'utilisateur : au-delà, on passe en plein-texte. */
export const QUERY_EMBED_TIMEOUT_MS = 4_000;

// ---- Recherche documentaire -----------------------------------------------------

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;
/** Constante de Reciprocal Rank Fusion (valeur usuelle). */
export const RRF_K = 60;

/** Rang plein-texte minimal (ts_rank_cd normalisé, dans [0, 1[). */
export const MIN_FTS_RANK = 0.02;
/**
 * Cosinus minimal de la branche vectorielle. En dessous, un extrait n'est
 * retenu que s'il partage des termes avec la question.
 *
 * Valeur PROVISOIRE pour gemini-embedding-2 (requêtes et documents encodés en
 * mode recherche asymétrique) : à calibrer avec `npm run eval:rag` une fois
 * GEMINI_API_KEY disponible — trop haut, la recherche par le sens se tait ;
 * trop bas, du bruit entre. L'ancien 0,75 était propre à mistral-embed, dont
 * les cosinus étaient tassés vers le haut.
 */
export const MIN_COSINE = 0.6;

// ---- Recherche de candidats -------------------------------------------------------
// Doivent rester égaux à `relevance_min` et `name_match_min` de search_candidates.

export const MIN_CANDIDATE_RELEVANCE = 0.06;
export const NAME_MATCH_MIN = 0.72;

// ---- Agent ---------------------------------------------------------------------------

export const MAX_TOOL_ROUNDS = 4; // au pire 5 appels LLM par message
export const MAX_HISTORY = 12;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TOOL_RESULT_CHARS = 8000;
export const AGENT_TEMPERATURE = 0.2;

// ---- Dépôt ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = /\.(pdf|docx|txt|md)$/i;
