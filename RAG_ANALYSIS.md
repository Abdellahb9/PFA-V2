# RAG system analysis

Analysis of the retrieval-augmented assistant ("Assistant IA PHOSBOUCRAA / OCP stages") at commit `eec2d94` (2026-10-11), after the audit described in §8. Production checks dated 2026-10-12.

> This document replaces the pre-rebuild analysis. The old version, which described the full-text-only stack and the Python RAG, is still in git: `git show 1d2ff23:RAG_ANALYSIS.md`. The version written just before the audit (commit `a564ac3`) is in the history of this file.

## TL;DR

There is **one** RAG implementation: TypeScript serverless functions in `netlify/functions`, backed by Supabase Postgres. The Python RAG (FastAPI, Celery, pgvector) was deleted on 2026-10-03 (commit `0c9c34a`).

**Scope.** Since commit `79db5dd` the assistant covers candidates, CVs, offers, assignments and bookings. **Internship policy is no longer part of the product**: the knowledge base holds CVs (`cv`) and other documents about candidates (`other`, such as interview reports). A policy question is refused as off-topic.

**How a document gets in.**
- It is uploaded and its text extracted page by page.
- It is cut into chunks of about 900 characters. Every chunk's heading carries the **document title and its section**, for example "YASMINE EL AMRANI › COMPÉTENCES TECHNIQUES".
- The chunks are stored atomically in Postgres.
- A background function then embeds them with **Mistral `mistral-embed`** (1024-d).

**How a question gets answered.**
- A scope filter screens the question first. Greetings and "what can you do?" get a fixed reply with no model call.
- A **Groq `gpt-oss-120b`** agent then picks its tools.
  - Document search is **hybrid**: Postgres full-text ∪ pgvector cosine, fused with Reciprocal Rank Fusion inside one SQL function. Neighbouring chunks from the same page are merged into one passage.
  - Candidate search is full-text plus name trigrams.
- The answer streams to the browser over SSE, with the sources attached. Every fact taken from a document ends with "(document, p. N)".

**Production state** (checked 2026-10-12):
- Vercel. Builds started by a Git push are cancelled, so deployment goes through `vercel --prod`. `/api/health` doesn't report a version, so whether `eec2d94` is live has to be checked in the Vercel dashboard.
- Migrations 0019 and **0020** are applied: the `doc_type` constraint is `('cv', 'other')` with default `'other'`.
- `MISTRAL_API_KEY` is set for **Production only**, so Preview deployments run full-text search only. The 7 chunks in the base are all embedded.
- The knowledge base holds **one CV (7 chunks)**, uploaded on 2026-10-11 at 09:14 UTC. That is before the new chunking, so its headings don't carry the document title. **Re-upload it** once `eec2d94` is deployed.

**Most important findings.**
- Of the audit (§8): chunks lost their document's identity, and neighbouring chunks carrying the rest of an answer were thrown away. Together these explained most wrong "not found" answers.
- Still open: Groq's **daily** token quota (problem #2). Also still open: the HNSW index is never used by `rag_search_chunks` (problem #1).

---

## 1. Architecture

```mermaid
flowchart TD
  subgraph FE["Frontend (React)"]
    AP["AssistantPage.tsx"] -->|"POST /api/assistant/chat (SSE)"| CHAT
    AP -->|"GET/POST/DELETE /api/assistant/documents"| DOCS
    AP -->|"GET /api/assistant/conversations"| CONV
  end

  subgraph API["Serverless functions (Vercel in prod, Netlify-compatible)"]
    CHAT["assistant.ts handleChat"] --> RL["checkRateLimit 60/h"]
    RL --> HIST["conversations.ts getHistory + contextNote"]
    HIST --> SCOPE["scope.ts classifyScope"]
    SCOPE -->|"small_talk / off_topic / discriminatory"| CAN["cannedStream (fixed reply)"]
    SCOPE -->|"in"| AGENT["rag/agent.ts runAgent (gpt-oss-120b)"]
    AGENT --> TOOLS["rag/tools.ts runTool (6 tools, parallel per round)"]
    TOOLS --> RD["rag/retrieval.ts retrieveDocChunks + mergeAdjacent"]
    TOOLS --> RC["rag/candidates.ts retrieveCandidates / getScoreBreakdown"]
    TOOLS --> RK["ranking.ts rankApplicants"]
    RD --> EQ["rag/embeddings.ts embedQuery (4 s, null on failure)"]
    DOCS --> UP["handleUpload"] --> ING["rag/ingest.ts ingestDocument"]
    ING --> EX["rag/extract.ts extractDocument"] --> CH["rag/chunking.ts chunkPages(pages, documentTitle)"]
    UP -. "triggerEmbedding (fire and forget)" .-> BG["rag-embed-background.ts embedPending"]
    BG --> ET["rag/embeddings.ts embedTexts (batches of 32)"]
  end

  subgraph DB["Supabase Postgres (migrations 0019 + 0020)"]
    CH -->|"rag_replace_document"| T[("rag_documents / rag_chunks")]
    BG -->|"rag_pending_chunks / rag_set_embeddings"| T
    RD -->|"rag_search_chunks: FTS CTE + vector CTE, RRF"| T
    RC -->|"search_candidates (index pre-filter)"| CAND[("candidates")]
  end

  ET --> MISTRAL["Mistral embeddings API"]
  EQ --> MISTRAL
  AGENT --> GROQ["Groq chat API"]
  SCOPE --> GROQ
```

---

## 2. File-by-file table

### Serverless entry points

| Path | Role | Key functions |
|---|---|---|
| `netlify/functions/assistant.ts` | HTTP routes: streamed chat, knowledge-base CRUD, conversation reads | `handleChat` (l.76), `handleUpload` (l.161), `listDocuments` (l.208), `deleteDocument` (l.216), `checkRateLimit` (l.49), `config.path` |
| `netlify/functions/rag-embed-background.ts` | Background function that embeds pending chunks. Idempotent, takes no arguments | default handler, calling `embedPending` |
| `vercel-src/handler.ts` | Vercel catch-all router that reuses the Netlify handlers. Routes `/api/assistant/*` and `/api/rag-embed-background`, and exposes `/api/health` (reports `hasMistralKey`) | `routes` |

### Core module `netlify/functions/_shared/rag/`

| Path | Role | Key functions / constants |
|---|---|---|
| `index.ts` | Public barrel; everything outside the module imports from here | re-exports |
| `config.ts` | Every tunable value, in one place | `CHUNK_SIZE`, `CHUNK_OVERLAP`, `EMBED_*`, `DEFAULT_TOP_K`, `MAX_TOP_K`, `RRF_K`, `MIN_FTS_RANK`, `MIN_COSINE`, `MIN_CANDIDATE_RELEVANCE`, `NAME_MATCH_MIN`, `MAX_TOOL_*`, `MAX_UPLOAD_BYTES`, `ALLOWED_EXTENSIONS` |
| `types.ts` | Shapes shared with the frontend and the SSE stream | `ChunkSource`, `CandidateSource`, `ExplanationSource`, `KnowledgeDocument`, `SearchRow`, `DocType` (`"cv" \| "other"`), `isDocType` |
| `extract.ts` | Text extraction: PDF page by page (unpdf), DOCX (mammoth), plain text. Strips NUL bytes | `extractDocument` (l.15) |
| `chunking.ts` | Chunking by separator priority, cut before a heading line, overlap aligned to a word or sentence boundary, heading propagation, document title in every heading | `chunkPages` (l.184), `documentTitle` (l.70), `splitRanges` (l.124), `headingOf` (l.35), `normalizeText`, `chunkText` |
| `embeddings.ts` | Mistral client using plain `fetch`, with batching, retries and timeouts | `embedTexts` (l.83), `embedQuery` (l.98), `embeddingsEnabled`, `embeddingInput`, `EmbeddingError` |
| `store.ts` | Storage interface and its Supabase RPC implementation; swappable for tests and the evaluation | `RagStore`, `supabaseStore` (l.54), `getStore`, `setStore`, `DocumentExistsError` |
| `ingest.ts` | Upload pipeline and background embedding loop | `ingestDocument` (l.56), `ingestPages` (l.39), `embedPending` (l.73), `guessDocType` (l.32, default `other`), `EmptyDocumentError` |
| `retrieval.ts` | Hybrid document retrieval: top-k chunks, then neighbouring chunks of the same page merged into passages | `retrieveDocChunks` (l.93), `mergeAdjacent` (l.46), `relevance` (l.27) |
| `candidates.ts` | Candidate search, empty-result diagnostic, assignment-score explanation | `retrieveCandidates` (l.38), `candidateEmptyAnswer` (l.112), `getScoreBreakdown` (l.150) |
| `context.ts` | Fits a tool payload into the context budget, keeping the passage around the query terms | `toolResultContent` (l.62), `focusText` (l.29) |
| `prompt.ts` | System prompt and tool schemas | `SYSTEM` (l.8), `FINAL_ROUND_INSTRUCTION` (l.84), `TOOLS` (l.88) |
| `tools.ts` | Runs the tools; validates model arguments; retries an empty type-filtered document search without the filter | `runTool` (l.196), `searchDocumentsTool` (l.99), `clampInt`, `optionalNumber` |
| `agent.ts` | Agent loop: streaming, parallel tools, forced final round, citation check, provider failures (429) | `runAgent` (l.124), `sanitizeHistory` (l.53), `unverifiedCitations` (l.98), `FALLBACK_ANSWER`, `QUOTA_ANSWER` |
| `debug.ts` | Diagnostic traces behind `RAG_DEBUG=1`, off by default | `ragDebug`, `ragDebugEnabled`, `clip` |
| `language.ts` | FR/EN detection for user-facing messages | `detectLanguage` (l.18) |

### Collaborators outside the module

| Path | Role | Key functions |
|---|---|---|
| `_shared/scope.ts` | Pre-agent scope filter in three layers: fast path (small talk and "what can you do?" → fixed reply), deterministic backstop, gpt-oss-20b classifier. Fails open | `classifyScope` (l.162), `smallTalkReply` (l.69), `isDiscriminatoryRequest` (l.101), `cannedStream` (l.204), `REFUSALS` |
| `_shared/conversations.ts` | Conversation storage. Replays history from the database, adding a compact `[contexte : …]` note per assistant turn | `getHistory` (l.74), `contextNote` (l.114), `saveMessage`, `resolveConversation` |
| `_shared/groq.ts` | Groq client and model names | `ASSISTANT_MODEL`, `EXTRACT_MODEL`, `groqClient`, `groqEnabled` |
| `_shared/trigger-analysis.ts` | Fire-and-forget call to a background function, works on Netlify and Vercel | `triggerBackground`, `triggerEmbedding` |
| `_shared/ranking.ts`, `_shared/db.ts` | Deterministic ranking behind the `rank_candidates` tool | `buildFieldProfile`, `rankApplicants`, `loadApplicantPool` |
| `scripts/eval-rag.ts` | End-to-end evaluation on a labelled set (`npm run eval:rag`), see §8.3 | `main`, `grade`, `compare` |
| `scripts/eval-scope.ts` | Real scope-classifier evaluation (`npm run eval:scope`) | `main` |
| `scripts/rag-demo.ts` | Manual end-to-end run against the real services (`npm run rag:demo`), on the CV fixture | `main` |

### SQL (`supabase/migrations/`)

| Object | Defined in | Role |
|---|---|---|
| `rag_documents`, `rag_chunks` | 0019 (l.116, l.125) | One row per document (unique name, `doc_type` ∈ {cv, other} since 0020); chunks with `page`, `heading`, a generated `search_vector` (FR=A, EN=B, heading included) and `embedding vector(1024)` |
| `rag_documents_doc_type_check` | 0020 | `doc_type in ('cv', 'other')`, default `'other'`; existing `policy` rows become `other` |
| `ix_rag_chunks_fts` (GIN), `ix_rag_chunks_embedding` (HNSW cosine), `ix_rag_chunks_pending` (partial) | 0019 (l.145–151) | Indexes |
| `rag_tsquery(q)` | 0019 (l.42), first introduced in 0013 | OR of lexemes; drops stopwords and question words in both languages; keeps `-term` exclusions |
| `rag_replace_document` | 0019 (l.160), redefined in 0020 (l.23) | Atomic replace; raises `23505` when the name exists and `p_replace` is false; accepts only `cv` / `other` |
| `rag_pending_chunks`, `rag_set_embeddings` | 0019 (l.220, l.235) | Embedding backlog |
| `rag_search_chunks` | 0019 (l.259) | Hybrid search: FTS CTE and vector CTE, full outer join, RRF score |
| `rag_list_documents`, `rag_delete_document` | 0019 (l.342, l.359) | Knowledge-base management |
| `search_candidates`, `search_candidates_diag` | 0019 (l.393, l.491) | Candidate search with an index pre-filter; question built from `rag_name_core(q)` |
| `rag_name_core`, `rag_like_escape` | 0017 (l.33), 0014 (l.146) | Older helpers still in use |

### Tests

`_shared/rag/__tests__/`:
- `sql.test.ts`: runs all real migrations on PGlite with pgvector and pg_trgm. It checks:
  - `search_candidates` against the old full-scan version as a reference;
  - replaying 0019 + 0020;
  - the `policy` → `other` conversion done by 0020.
- `e2e.test.ts`: offline flow on the CV fixture with a deterministic embedder.
- Unit tests for chunking, embeddings, retrieval, context, tools, agent, candidates and conversations.
- `migration-sync.test.ts`.

Also `netlify/functions/assistant.test.ts` and `_shared/scope.test.ts`. The functions suite has 22 files and **335 tests**, all passing on 2026-10-11; the frontend has 30.

Fixtures in `_shared/rag/__fixtures__/` (synthetic, no real person):
- three CVs: FR and EN, an Arabic name, a skills table, a section spanning two chunks, and a planted prompt injection;
- an interview-jury report.

---

## 3. Data flow

### 3.1 Ingestion: document → chunks → stored

1. **Upload.** `POST /api/assistant/documents`, multipart with `file` and optional `title`, `doc_type` and `replace`.
   - Requests whose `content-length` is over 10 MB (plus 64 KB of multipart margin) are refused **before** `formData()` reads the body.
   - Then the extension check (`pdf|docx|txt|md`) and a second size check on `file.size`.
   - Without `doc_type`, `guessDocType` picks `cv` when the name matches cv/resume/curriculum, and `other` otherwise.
2. **Extraction.** `extractDocument` returns `{page, text}[]`. PDFs give one entry per page; DOCX and text files give a single entry with `page: null`. NUL bytes are removed, since Postgres rejects them.
3. **Chunking.** `chunkPages(pages, documentTitle(name, pages))` normalises whitespace and calls `splitRanges` (900 characters).
   - **Cut point.** When a heading line falls in the second half of the window, the chunk is cut just before it, and the next chunk starts exactly on the heading, with no overlap across a section boundary. Otherwise a cut point is chosen by separator priority: paragraph, line, sentence, `; `, `, `, space. It must fall past half the window.
   - **Overlap.** Without a heading cut, the next chunk starts up to 150 characters earlier, on a sentence boundary when the overlap zone has one, otherwise on a word boundary.
   - **Heading.** Each chunk carries its page and the heading in force, which can be:
     - a markdown heading;
     - an "Article/Chapitre" line;
     - a section number of one or two digits per level followed by a letter, such as `2.1 Conditions`;
     - a short ALL-CAPS line without digits.

     A heading carries over to the next page.
   - **Document title.** The title is prefixed to every heading: "Title › Section", or just the title when the section repeats it. It is the first line when that looks like a title (≤ 90 characters, not "CV"/"Curriculum vitae", no e-mail, few digits), and the file name without its extension otherwise.
4. **Storage.** `rag_replace_document` runs in one transaction:
   - it locks or creates the `rag_documents` row, deletes the old chunks, inserts the new ones with indexes renumbered from 0 and empty chunks dropped, and updates `chunk_count`;
   - the existence check happens inside the transaction, so two concurrent uploads under the same name can't both win. One gets `23505`, which the API turns into a 409.
5. **Response.** `{source_document, doc_type, chunks, embeddings: "pending"|"disabled", status: "ingested"}`. When the status is `pending`, `triggerEmbedding(req)` calls the background function without waiting for it.

### 3.2 Embedding (background)

`embedPending` loops until nothing is pending, or up to 5000 chunks:
- `rag_pending_chunks(128)` returns chunks with a null embedding.
- `embedTexts` embeds `heading + "\n" + content` (so the document title is in every vector), 32 texts per Mistral call.
  - 429 and 5xx responses get 2 retries with backoff, under a 15 s timeout.
  - A short batch or a wrong dimension raises an error instead of saving misaligned vectors.
- `rag_set_embeddings` writes the vectors and `embedded_at`.

The loop stops early if nothing was written, for example because the chunks were deleted in the meantime. Without `MISTRAL_API_KEY`, nothing happens and the chunks stay searchable by full text only.

### 3.3 Query: question → retrieve → prompt → answer

1. `POST /api/assistant/chat {message, conversation_id?}` checks `requireStaff`, then the rate limit of 60 user messages per hour.
2. **History.** `getHistory` reads the last 12 messages from the database, never from the browser. Assistant turns get a `contextNote` appended, for example `[contexte : candidats — X (#12) ; documents — cv-x.pdf p.1]`. `sanitizeHistory` then caps the list at 12 messages of 4000 characters each.
3. **Scope.** `classifyScope` has four outcomes:
   - small talk and capability questions ("bonjour", "merci", "que peux-tu faire ?", "help") get `small_talk`: a fixed FR or EN reply that lists what the assistant does, with no model call;
   - a selection verb combined with a protected attribute is refused as `discriminatory`;
   - otherwise `gpt-oss-20b` classifies the question in JSON at temperature 0 (low reasoning effort, 4 s timeout). Policy questions are `off_topic`; questions on a candidate's specific data are `in`.

   `cannedStream` streams the fixed reply or refusal. If the classifier itself fails, the question goes through (fail open).
4. **Agent.** `runAgent` sends `SYSTEM` and the history to `gpt-oss-120b` (temperature 0.2, streaming, `tool_choice: auto`).
   - The model can call tools for up to 4 rounds. In a fifth, final round the tools are removed and `FINAL_ROUND_INSTRUCTION` is added.
   - Tool calls within one round run in parallel (`Promise.all`).
   - A provider failure, whether on the call or mid-stream, becomes `FALLBACK_ANSWER`, or `QUOTA_ANSWER` on a 429. The raw provider error never reaches the browser.
5. **`search_documents`** calls `retrieveDocChunks(query, topK≤20)`. The model is given no type filter: the schema exposes only `query` and `top_k`.
   - `embedQuery` gets a vector, with a 4 s timeout and no retry. It returns `null` without a key or when the call fails, which means full-text only.
   - It calls `rag_search_chunks(q, q_embedding, top_k, doc_type, MIN_FTS_RANK, MIN_COSINE, RRF_K)`:
     - **FTS CTE:** `search_vector @@ rag_tsquery(q)`, ranked with `ts_rank_cd({0.1,0.2,0.4,1.0}, …, 32)`, which falls in [0, 1). Ranks under 0.02 are dropped.
     - **Vector CTE:** `1 - (embedding <=> q)`. Cosines under 0.75 are dropped.
     - The two lists are merged with a full outer join, each chunk scoring `Σ 1/(60 + rank)`, ordered by that score.
   - `mergeAdjacent` joins consecutive chunks of the same document **and page** into one passage, without repeating their overlap.
     - The passage keeps the position of its best-ranked chunk, and the page, heading and index of its first chunk.
     - top-k still counts chunks, so the text volume matches what `MAX_TOOL_RESULT_CHARS` was sized for.
   - The displayed `similarity` is `max(fts_rank, (cos − 0.75) / 0.25)`, clamped to [0, 1].
   - The extracts are tagged `contenu_non_fiable: true` before reaching the model.
   - When nothing is found, the tool says whether the knowledge base is empty (`countChunks`). If a `doc_type` argument was passed anyway and the search came back empty, the tool retries once without it (`filtre_doc_type_ignore`).
6. **Other tools:**
   - `search_candidates`: the `search_candidates` RPC with SQL filters, floors of 0.06 and 0.72, and a diagnostic when empty;
   - `rank_candidates`: deterministic `compositeScore` ranking;
   - `explain_assignment_score`;
   - `list_offers` (status checked against a whitelist);
   - `list_bookings` (ISO dates checked).
7. **Context budget.** `toolResultContent` keeps every tool result under 8000 characters, as valid JSON. It first shortens the text fields around the query terms (`focusText`: 700, then 500, 350, 250 characters), then drops items from the end.
8. **Answer.** The browser receives SSE events:
   - `conversation` first;
   - `tool` each time a tool is called;
   - `delta` for each piece of the answer;
   - `sources`, deduplicated by type, id, document and chunk;
   - `done` at the end.

   When the final answer names a file that neither this turn's sources nor the earlier assistant turns mention, `unverifiedCitations` appends a warning `delta`. The check normalises Unicode hyphens and never reads a leading parenthesis as part of a name. The answer, tool names and sources are saved to `assistant_messages`.

---

## 4. Key parameters

| Parameter | Value | Where |
|---|---|---|
| Chunk size / overlap | 900 / 150 characters, cut at a sentence or word boundary; no overlap across a heading | `config.ts` l.16–17 |
| Chunk heading | "Document title › section" | `chunking.ts` `documentTitle`, `label` |
| Embedding model | `mistral-embed`, 1024-d, batches of 32, 2 retries, 15 s timeout (4 s for the query) | `config.ts` l.21–30 |
| Similarity metric | Cosine (`vector_cosine_ops`, `<=>`); full-text `ts_rank_cd` with normalisation 32 | 0019 l.149, l.285–310 |
| Fusion | RRF, k = 60, over top-k chunks (no wider pool since `082e76a`) | `config.ts` l.37, 0019 l.259 |
| Floors | `MIN_FTS_RANK` 0.02, `MIN_COSINE` 0.75 (not yet calibrated) | `config.ts` l.40, l.46 |
| top-k | default 5, max 20 (tool clamp 1–20); neighbouring chunks merged afterwards | `config.ts` l.34–35 |
| Candidate floors | relevance 0.06, name match 0.72 (in SQL and TypeScript, kept equal by a test) | `config.ts` l.51–52, 0019 `search_candidates` |
| Agent | 4 tool rounds + 1 forced final round, temperature 0.2, history 12 × 4000 characters, tool result ≤ 8000 characters | `config.ts` l.56–60 |
| LLMs | `openai/gpt-oss-120b` (agent), `openai/gpt-oss-20b` (scope filter and CV extraction), via Groq. Daily quota on the current tier: 200,000 tokens for the 120b | `groq.ts` l.44–46 |
| Upload | ≤ 10 MB; pdf, docx, txt, md | `config.ts` l.64–65 |
| Rate limit | 60 questions per user per hour | `assistant.ts` l.45 |

### DB schema (0019 + 0020)

`rag_documents`:
- `id` bigserial;
- `name` unique, non-empty;
- `doc_type` ∈ {cv, other}, default `other`;
- `chunk_count`, `created_at`, `updated_at`.

`rag_chunks`:
- `id`;
- `document_id` → `rag_documents` with ON DELETE CASCADE;
- `chunk_index`, `content`, `page`, `heading` ("Title › Section");
- `search_vector` generated, as `setweight(fr(heading+content),'A') || setweight(en(...),'B')`;
- `embedding vector(1024)` (null while pending), `embedded_at`;
- unique (`document_id`, `chunk_index`).

RLS is enabled on both tables with no policies, so only `service_role` has grants.

### Prompt templates

- **Agent:** `prompt.ts` `SYSTEM`, in French. It requires:
  - answers built only from tool data;
  - one to three sentences, with no preamble or offer of help;
  - **every fact from a document ending with "(document, p. N)"**, even a one-word answer, and a missing fact stated as missing;
  - **a new tool call for a follow-up that asks for a new fact**, never a document fact from memory;
  - pronouns resolved from the history and its `[contexte]` notes;
  - the user's language;
  - names copied exactly from tool output;
  - both candidate sources checked before saying "not found";
  - `contenu_non_fiable` treated as data, never as instructions;
  - candidates, CVs, documents about them, offers, assignments and bookings only. Policy is out; greetings get a short polite reply, never the refusal;
  - `search_candidates` and `rank_candidates` kept apart (search vs evaluate). Rankings show no raw scores, and say how many were found when fewer than requested;
  - no use of protected attributes.
- **Tool schemas:** `prompt.ts` `TOOLS`. `search_documents` takes only `query` and `top_k`.
- **Scope classifier:** `scope.ts` `CLASSIFIER_SYSTEM`, returning `{"verdict": "in"|"off_topic"|"discriminatory"}`, defaulting to `in` when unsure. `small_talk` is decided by the fast path only.

---

## 5. Config & env vars

| Variable | Read in | Purpose | Default | Vercel scope |
|---|---|---|---|---|
| `MISTRAL_API_KEY` | `rag/embeddings.ts` | Enables embeddings (ingestion and query). Without it, search is full-text only | unset | **Production only** |
| `GROQ_API_KEY` | `groq.ts`, used by `agent.ts` and `scope.ts` | Agent and scope classifier. Without it the agent returns an error event and the classifier lets questions through | unset | Production, Preview |
| `GROQ_MODEL` | `groq.ts` | Agent model; also the fallback for the extraction model | `openai/gpt-oss-120b` | not set |
| `GROQ_EXTRACT_MODEL` | `groq.ts` | Scope classifier and CV extraction | `GROQ_MODEL` ?? `openai/gpt-oss-20b` | not set |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `_shared/supabase.ts` | Service-role client used by every RPC | `""` | Production, Preview |
| `RAG_DEBUG` | `rag/debug.ts` | `1` turns on the diagnostic traces (scope verdict, prompts per round, search rows with scores, fallback cause) | unset | not set |
| `VERCEL` | `trigger-analysis.ts` | Selects the `/api/...` background URL and `waitUntil` | set by Vercel | automatic |
| `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | frontend | API base path; auth token for chat requests | `/api` | Production, Preview |

All the tunables in `config.ts` are hard-coded constants, not environment variables. `vercel.json` sets `maxDuration: 60` for every function, which matters for problem #3. `npm run eval:rag` and `eval:scope` read `../../.env` through `--env-file-if-exists`.

---

## 6. Public interfaces

### HTTP

| Route | Auth | Contract |
|---|---|---|
| `POST /api/assistant/chat` | staff | Body `{message, conversation_id?}`. SSE events `{type: conversation|tool|delta|sources|error|done}`. 429 when over the rate limit |
| `GET /api/assistant/conversations[/:id]` | any logged-in user (own conversations only) | List of conversations, or one conversation with its messages |
| `GET /api/assistant/documents` | staff | `[{source_document, chunks, doc_type, embedded}]` |
| `POST /api/assistant/documents` | staff | Returns 200 `{source_document, doc_type, chunks, embeddings, status}`, or 400 (no text), 409 (name exists), 413, 415. `doc_type` is `cv` or `other`; any other value falls back to `guessDocType` |
| `DELETE /api/assistant/documents/:name` | staff | 204 or 404 |
| `POST /api/rag-embed-background` (Vercel) or `/.netlify/functions/rag-embed-background` | **none** | `{status: ok|disabled|error, embedded}` |

### Shapes shared with the frontend

- `AgentEvent` (`rag/agent.ts`), parsed by `frontend/src/api/chat.ts`.
- Source objects `doc_chunk`, `candidate`, `ranked_candidate` and `matching_explanation` (`rag/types.ts`), mirrored in `frontend/src/api/types.ts`. A `doc_chunk` may now be a merged passage: `text` spans several chunks and `chunk_index` is the first one.
- `DocType` is `"cv" | "other"` on both sides.

### RPCs (callable by `service_role` only)

- `rag_replace_document(text, text, jsonb, boolean)`
- `rag_search_chunks(text, vector, int, text, real, real, int)`
- `rag_pending_chunks(int)`
- `rag_set_embeddings(jsonb)`
- `rag_list_documents()`
- `rag_delete_document(text)`
- `search_candidates(text, numeric, text, int)`
- `search_candidates_diag(text, numeric, text)`

### Module exports used outside `_shared/rag`

- `assistant.ts`: `runAgent`, `sanitizeHistory`, `ingestDocument`, `getStore`, `guessDocType`, `isDocType`, `DocumentExistsError`, `EmptyDocumentError`, `ALLOWED_EXTENSIONS`, `MAX_UPLOAD_BYTES`, `ragDebug`.
- `rag-embed-background.ts`: `embedPending`, `embeddingsEnabled`.
- `scope.ts`: `AgentEvent` (type only).
- `scripts/rag-demo.ts`: `ingestPages`, `retrieveDocChunks`.
- `scripts/eval-rag.ts`: `runAgent`, `sanitizeHistory`, `ingestPages`, `guessDocType`, `embedPending`, `embeddingsEnabled`, `setStore`, `FALLBACK_ANSWER`, `QUOTA_ANSWER`.

Everything else the barrel exports is used only inside the module or by tests: `chunkText`, `documentTitle`, `headingOf`, `splitRanges`, `normalizeText`, `relevance`, `mergeAdjacent`, `focusText`, `clampInt`, `optionalNumber`, `unverifiedCitations`, `supabaseStore`, `EmbeddingError`, `embedTexts`, `extractDocument`, `FINAL_ROUND_INSTRUCTION`.

---

## 7. Open problems and improvements

Severity: 🔴 high · 🟠 medium · 🟡 low.

### 🔴 1. The HNSW index is never used by `rag_search_chunks`
The vector CTE (0019 l.307–316) joins `rag_documents` to filter on `doc_type`, and orders by `c.embedding <=> q_embedding, c.id`.

I checked the plans with `EXPLAIN` on PGlite (pgvector 0.8.1, 400 chunks, `enable_seqscan = off`):

| Query shape | Plan |
|---|---|
| Join + `ORDER BY distance, c.id` (as in 0019) | `Sort` → `Nested Loop` → `Index Scan using ix_rag_chunks_document`. Distance computed for every chunk, **no HNSW** |
| Join + `ORDER BY distance` only | Same plan, **no HNSW** |
| One table, `ORDER BY distance` | `Index Scan using ix_rag_chunks_embedding`, **HNSW used** |
| One table, `ORDER BY distance, c.id` | `Incremental Sort` over the index order |
| `doc_type` through `IN (subquery)` | `Sort`, **no HNSW** |

**Cause.** The `doc_type` filter needs `rag_documents`, and that join is what blocks the index. The `c.id` tie-breaker adds an extra sort step on top.

**Impact today.** Small: at a few thousand chunks, a full scan takes milliseconds. But "HNSW" in the design is currently cosmetic, and the cost grows linearly with the corpus.

**Fix.** The agent no longer passes `doc_type` (§3.3), so the simplest fix is now available:
- query `rag_chunks` alone when `p_doc_type` is null, with `ORDER BY embedding <=> q LIMIT n`;
- keep the join only for the filtered branch, with `SET LOCAL hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8);
- raise `hnsw.ef_search` above the maximum `match_count` (20). The default of 40 already covers it now that the ×3 pool is gone.

### 🟠 2. Groq's daily token quota caps the assistant
The account's tier allows **200,000 tokens per day** for `gpt-oss-120b`. A document question costs about 5,000–15,000 tokens: the system prompt and tool schemas are resent at every round, and a question takes up to 3 rounds. So the daily budget covers roughly 15–40 questions, shared by every user and by the evaluation. One full `npm run eval:rag` run uses about half of it.

This was the cause of the unexplained "Je n'ai pas pu aboutir… Reformulez" in production (message 135). Since `eec2d94` users get an honest "limite d'utilisation atteinte, réessayez" instead (`QUOTA_ANSWER`), but the cap itself remains.

**Fix:** a paid tier, or fewer tokens per question. For example, call `search_candidates` and `search_documents` in the same round for a person (see #4), or shorten the system prompt.

### 🟠 3. Background embedding is capped at 60 s in production
`vercel.json` sets `maxDuration: 60` for the catch-all API function, `rag-embed-background` included. The 15-minute limit applies only on Netlify. A large PDF (hundreds or thousands of chunks) can therefore leave chunks unembedded when the function is cut off.

Nothing re-triggers the job afterwards except the next upload, and the UI keeps showing "indexation sémantique en cours". Those chunks stay searchable by full text only.

**Fix:** a scheduled re-trigger (Vercel Cron, or `pg_cron` calling the endpoint), plus a "relancer l'indexation" button that reuses `triggerEmbedding`.

### 🟠 4. Document questions are slow (25–45 s in the evaluation)
For a person, the agent usually calls `search_candidates`, waits, then calls `search_documents`: three model rounds in sequence. Part of the measured time may also be the Groq SDK silently retrying 429s.

**Fix:** a prompt rule to call both tools in the same round when the question is about a named person. They already run in parallel within a round.

### 🟠 5. `MIN_COSINE = 0.75` is still uncalibrated
This one value decides whether the vector branch contributes anything. If it's too high, semantic recall is lost; if it's too low, noise gets in. It also scales the displayed relevance.

The evaluation of 2026-10-11 ran **full-text only**, since there's no Mistral key locally. The vector branch is therefore unmeasured.

**Fix:** run `npm run eval:rag` with `MISTRAL_API_KEY` set, then set the floor from the measured distribution of related and unrelated pairs.

### 🟠 6. Concurrent `embedPending` runs duplicate work
Two uploads close together start two background runs. Both read the same `embedding IS NULL` rows and embed them twice. The results are correct but the API calls are wasted.

**Fix:** claim rows in `rag_pending_chunks` with `FOR UPDATE SKIP LOCKED` and a claimed timestamp, or keep a single-flight lock.

### 🟡 7. `rag_set_embeddings` payload size
Each RPC sends 128 × 1024 floats as JSON, about 1.3 MB. That's below common limits, but the Supabase/PostgREST request-size limit hasn't been checked. Sending 32 chunks per RPC (one embedding batch) removes the doubt.

### 🟡 8. The background endpoint has no authentication
Anyone can POST `/api/rag-embed-background`. It only embeds chunks that are already pending, so the abuse potential is limited to Mistral calls on work that was due anyway. A shared secret header would close it.

### 🟡 9. The bilingual stopword filter drops some French words
`rag_tsquery` keeps a word only if it means something in **both** languages. French words that are English stopwords, such as « an » (year), are removed from queries. That's rare, but it means some short queries return nothing.

### 🟡 10. Displayed relevance can look wrong
When a chunk comes only from the vector branch with a cosine just above 0.75, the UI shows about 1 % for the top result. RRF decides the order, but the displayed number comes from a different scale.

**Fix:** show a rank-based label, or calibrate the scale after #5.

### 🟡 11. No reranker
The RRF order is final. A cross-encoder or a small LLM rerank over the results would improve precision, at a cost in latency and in Groq quota (#2).

### 🟡 12. The scope classifier fails open
This is by design. During a Groq outage, off-topic questions reach the agent, which then relies on its own prompt rules. The deterministic backstop still blocks discriminatory rankings, and small talk is still answered by the fast path.

### 🟡 13. The citation check is partial
`unverifiedCitations` only recognises names that end in `.pdf`, `.docx`, `.txt` or `.md`. Titles without an extension aren't checked. It also only appends a warning, since text already streamed can't be retracted. The false positives it used to produce are fixed (§8.1).

### 🟡 14. Chunking and extraction gaps
- Single-word title-case headings such as "Formation" or "Langues" (common in CVs) aren't detected. The document title still identifies every chunk.
- There's no OCR: a scanned PDF fails with "Aucun texte extrait".
- DOCX files have no page numbers, so citations can name only the document.
- Documents uploaded before `eec2d94` keep their old chunks, whose headings have no document title, until they are re-uploaded. This applies to the one CV in production today.

### 🟡 15. Test-only exports in the public barrel
About sixteen helpers are exported from `index.ts` but used only by tests (see §6). That's harmless, but it widens what looks like a public API. Tests could import from the internal modules directly.

### 🟡 16. SQL is spread over several migrations
- `rag_tsquery` was last redefined in 0019, `rag_name_core` lives in 0017 and `rag_like_escape` in 0014, and all are still in use.
- `rag_replace_document` was redefined in 0020. 0019 is the most complete reference, but a reader must still open older files.
- Only 0020 is recorded in Supabase's migration history; the earlier ones were applied by hand.
- `docs/rag-diagnostic.sql` is untracked and is the only consolidated check script.

---

## 8. Audit of 2026-10-11

### 8.1 Fixed (commits `93fef5d`..`eec2d94`)

| Problem | Evidence | Fix | Commit |
|---|---|---|---|
| A chunk didn't know its document: only the chunk containing a person's name matched a search for that name, so the rest of a CV was unreachable by name | Search for "Yasmine El Amrani": only `cv-yasmine#0` and `cv-hajar#0` came back; the "list her experiences" answer missed Managem and LafargeHolcim | Document title in every heading ("Title › Section"), which feeds full-text weight A, the vectors and citations | `6779228` |
| `dedupeAdjacent` dropped neighbouring chunks as "duplicates", although they share only the ≤ 150-character overlap (about 85 % of the text was new) | "Where did she intern in 2024?": the LafargeHolcim chunk was retrieved, then dropped, and the answer was "Aucun stage de 2024" | `mergeAdjacent` merges neighbours of the same page into one passage; the ×3 pool goes away | `082e76a`, `6c8d5ab` |
| A chunk starting in the overlap inherited the previous section's heading | The jury's evaluation of Hajar was labelled "Yasmine El Amrani" | Cut just before a heading line, no overlap across it | `6779228` |
| "2024 2025", "1 500 dirhams par mois" and "TOTAL 3 000 MAD" were read as headings | Probe on `headingOf` | Section numbers of one or two digits followed by a letter; no digits in an ALL-CAPS heading | `6779228` |
| The model chose the document type badly and lost the right document, and an empty filtered search told it "don't search again" | "Le compte rendu ne mentionne aucun logiciel" (searched as `other`); "Aucun document" for the jury notes; `guessDocType` typed every non-CV document as `policy` | `doc_type` removed from the tool schema; one retry without the filter when a filtered search is empty; default type `other` | `135f7b7`, `9b76898`, `79db5dd` |
| False "n'apparaît dans aucun extrait" warnings, saved into the history: a leading `(` was read as part of the name, U+2011 hyphens split it, and earlier turns' sources were ignored | Production message 127 (`« cv.pdf »`); 2 of 23 evaluation cases | Unicode normalisation, no leading parenthesis, earlier assistant turns accepted | `e78018e` |
| Greetings answered with the off-topic refusal; "Que peux-tu faire ?" and a CNSS-number question refused | Production messages 96–97 and 130–133; 3 evaluation cases | `small_talk` verdict with a fixed reply; classifier prompt fixed; `cannedStream` | `56bfe09` |
| The source was named in only about half of the answers, because the prompt contradicted itself; follow-ups answered from memory without sources; raw ranking scores ("0,955") shown | 4 evaluation cases; production messages 127 and 141 | One citation rule, "(document, p. N)"; re-retrieve for a follow-up; no raw scores | `1ba1043` |
| The unexplained "Je n'ai pas pu aboutir… Reformulez" was a 429 from Groq's daily quota, and a failure mid-stream sent the raw provider JSON (Groq organisation id) to the browser | `RAG_DEBUG` trace of the evaluation; production message 135 | `QUOTA_ANSWER` on a 429; stream failures absorbed | `eec2d94` |
| Internship policy removed from the product (product decision) | — | `DocType = "cv" \| "other"`, migration 0020, prompt, scope, frontend, tests | `79db5dd` |

### 8.2 Production checks done during the audit
- Before the audit, the knowledge base was **empty**, so every document question failed. One CV has been uploaded since (see TL;DR).
- No secret is hard-coded in tracked files, and `.env*` is git-ignored.

### 8.3 Evaluation
`npm run eval:rag` (in `netlify/functions`) plays 23 labelled cases through the same path as production: scope filter → agent → tools → real SQL.
- **Data.** Documents live in PGlite with the real migrations, so nothing is written to Supabase. Candidates and offers are read from the real database. Some cases have several turns, building the history like `getHistory` does.
- **Checks per case:**
  - the expected passage is retrieved and the expected tools are called;
  - key strings are present or absent;
  - "not found" is admitted when it should be, and refusals are correct;
  - the document is cited;
  - there is no fallback and no citation warning.
- **Options.** `--out` writes each transcript, `--only` picks cases, and `--compare a.json b.json` prints a before/after table without any API call. `RAG_DEBUG=1` adds the traces.

Results of 2026-10-11 (full-text only, real Groq models):

| Category | Before | After |
|---|---|---|
| Simple facts from a document | 2/5 | 4/5 |
| Facts spanning several chunks | 2/4 | 4/4 |
| Answer not in the data | 2/3 | 3/3 |
| Follow-up questions | 2/3 | 3/3 |
| Candidate / offer database | 2/3 | 3/3 |
| Scope | 1/4 | 4/4 |
| Prompt injection | 0/1 | 0/1 |
| **Total** | **11/23 cases, 123/140 checks** | **21/23 cases, 133/140 checks** |

The two failures of the "after" run had already been diagnosed when the run ended:
- `doc-fact-table`: the model chose `doc_type: "other"` itself. Fixed in `135f7b7`. Replaying the model's six traced queries against the final code retrieves the right passage every time.
- `injection-cv`: Groq's daily quota ran out (problem #2). In the baseline, the planted instruction was ignored.

A full re-run was blocked by that same quota.

`npm run eval:scope`: 54/54 (100 %), no legitimate question refused, no discriminatory request accepted, no fail-open.

### 8.4 Already fixed by the rebuild (old analysis numbering)

| Old # | Issue | Now |
|---|---|---|
| 1 | No semantic retrieval | Hybrid FTS + vectors (but see #1 above) |
| 2 | Chunks cut before reaching the model | 900-character chunks fit the 8000-character budget; `focusText` keeps the relevant part |
| 3 | Dedupe after `LIMIT` | Replaced by `mergeAdjacent` (§8.1) |
| 6, 7 | Overlap cut mid-word, no metadata | Boundary-aligned overlap; `page` and "title › section" heading on every chunk |
| 8 | `search_candidates` full scan | Index pre-filter, proven equivalent in `sql.test.ts` |
| 10, 18 | Upload buffered before the size check, TOCTOU on names | `content-length` checked first; 409 decided inside the transaction |
| 11–17, 24, 25 | Python stack issues and dead code | Python RAG removed |
| 20 | Tool context lost between turns | `contextNote` |
| 22, 23 | Unverified citations, sequential tools | `unverifiedCitations`; `Promise.all` |
| (new) | French stopwords via the English config; name particles through the CV text; `-term` ignored for candidates; NUL bytes in PDFs | Fixed in 0019 and `extract.ts` |
