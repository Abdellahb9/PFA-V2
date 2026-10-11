// Évaluation RÉELLE de l'assistant de bout en bout, contre un jeu étiqueté.
//
//   cd netlify/functions
//   npm run eval:rag                              # charge ../../.env (--env-file-if-exists)
//   npm run eval:rag -- --out eval-after.json     # garde le détail de chaque cas
//   npm run eval:rag -- --only followup-year      # un cas (ou plusieurs, séparés par des virgules)
//   npm run eval:rag -- --compare a.json b.json   # avant / après, sans rien appeler
//   RAG_DEBUG=1 npm run eval:rag                  # + requêtes, extraits classés, prompts
//
// Chaîne testée, la même qu'en production (assistant.ts handleChat) :
// filtre de périmètre → agent gpt-oss-120b → outils → recherche SQL réelle.
// Les documents vivent dans une base PGlite en mémoire où sont jouées les VRAIES
// migrations (aucune écriture dans Supabase) ; candidats, offres et classements
// sont lus dans la vraie base, en lecture seule. Sans MISTRAL_API_KEY la
// recherche documentaire est purement plein-texte.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_ANSWER,
  embeddingsEnabled,
  embedPending,
  guessDocType,
  ingestPages,
  runAgent,
  sanitizeHistory,
  setStore,
  type ChatMessage,
} from "../_shared/rag";
import { createDb, fixturePages, pgliteStore } from "../_shared/rag/__tests__/helpers";
import { cannedStream, classifyScope, REFUSALS } from "../_shared/scope";
import { contextNote } from "../_shared/conversations";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EVAL_FILE = join(HERE, "..", "_shared", "eval", "assistant-rag.json");

interface Expect {
  tools?: string[];
  tools_none?: boolean;
  retrieved?: { doc: string; contains?: string };
  answer_contains?: string[];
  answer_any?: string[];
  answer_not_contains?: string[];
  answer_not_match?: string;
  not_found?: boolean;
  refused?: boolean;
  cites_doc?: string;
  has_sources?: boolean;
}

interface EvalCase {
  id: string;
  category: string;
  turns: string[];
  expect: Expect;
}

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

interface TurnRecord {
  question: string;
  scope: string;
  tools: { name: string; args: Record<string, unknown> }[];
  sources: Record<string, unknown>[];
  answer: string;
  errors: string[];
  ms: number;
}

interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  checks: Check[];
  turns: TurnRecord[];
  logs: string[];
}

// ---- Normalisation des textes comparés ----------------------------------------------

const fold = (s: string) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[  ]/g, " ")
    .replace(/[’`]/g, "'")
    .toLowerCase();

const NOT_FOUND =
  /(aucun|aucune|pas trouve|introuvable|ne figure|n'apparai|pas d'information|ne mentionne|n'indique|ne precise|ne contient|pas mentionne|pas disponible|non precise|non indique|pas precise|pas indique|n'est pas (?:renseigne|indique|precise|mentionne)|not found|no information|not mentioned|does not mention|doesn't mention|isn't mentioned|is not mentioned|not available)/;

const baseName = (doc: string) => fold(doc).replace(/\.(pdf|docx|txt|md)$/, "");

// ---- Exécution d'un tour, comme handleChat ---------------------------------------------

async function runTurn(history: ChatMessage[], question: string, errors: string[]): Promise<TurnRecord> {
  const t0 = Date.now();
  const fullHistory = sanitizeHistory([...history, { role: "user", content: question }]);
  const lastAssistant = [...fullHistory].reverse().find((m) => m.role === "assistant")?.content;
  const scope = await classifyScope(question, lastAssistant);
  const rec: TurnRecord = {
    question,
    scope: `${scope.verdict} (${scope.via})`,
    tools: [],
    sources: [],
    answer: "",
    errors,
    ms: 0,
  };
  const events = scope.verdict === "in" ? runAgent(fullHistory) : cannedStream(scope.verdict, question);
  try {
    for await (const ev of events) {
      if (ev.type === "delta") rec.answer += ev.text;
      else if (ev.type === "tool") rec.tools.push({ name: ev.name, args: ev.args });
      else if (ev.type === "sources") rec.sources = ev.sources as Record<string, unknown>[];
      else if (ev.type === "error") errors.push(`event error: ${ev.message}`);
    }
  } catch (err) {
    // Une exception levée pendant le flux remonte jusqu'à handleChat en production.
    errors.push(`stream threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  rec.ms = Date.now() - t0;
  return rec;
}

/** Historique tel que getHistory le reconstruit : réponse + note [contexte : …]. */
function appendTurn(history: ChatMessage[], t: TurnRecord): ChatMessage[] {
  const note = contextNote(t.sources);
  return [
    ...history,
    { role: "user", content: t.question },
    { role: "assistant", content: note ? `${t.answer}\n\n${note}` : t.answer },
  ];
}

// ---- Notation --------------------------------------------------------------------------

function grade(c: EvalCase, last: TurnRecord): Check[] {
  const e = c.expect;
  const a = fold(last.answer);
  const called = last.tools.map((t) => t.name);
  const docSources = last.sources.filter((s) => s.type === "doc_chunk");
  const checks: Check[] = [];
  const refusal = Object.values(REFUSALS).some((r) => a.trim().startsWith(fold(r).slice(0, 40)));

  checks.push({ name: "no_fallback", pass: !last.answer.includes(FALLBACK_ANSWER) });
  checks.push({ name: "no_citation_warning", pass: !last.answer.includes("(Attention :") });
  checks.push({ name: "no_error", pass: last.errors.length === 0, detail: last.errors.join(" | ") || undefined });

  if (e.tools) {
    const missing = e.tools.filter((t) => !called.includes(t));
    checks.push({ name: "tools", pass: !missing.length, detail: `called=[${called.join(",")}]` });
  }
  if (e.tools_none) checks.push({ name: "tools_none", pass: called.length === 0, detail: called.join(",") });
  if (e.retrieved) {
    const hit = docSources.find(
      (s) =>
        s.source_document === e.retrieved!.doc &&
        (!e.retrieved!.contains || fold(String(s.text)).includes(fold(e.retrieved!.contains))),
    );
    checks.push({
      name: "retrieved",
      pass: !!hit,
      detail: docSources.map((s) => `${s.source_document}#${s.chunk_index}`).join(", ") || "aucun extrait",
    });
  }
  for (const s of e.answer_contains ?? []) {
    checks.push({ name: `contains:${s}`, pass: a.includes(fold(s)) });
  }
  if (e.answer_any) {
    checks.push({ name: `any:${e.answer_any.join("|")}`, pass: e.answer_any.some((s) => a.includes(fold(s))) });
  }
  for (const s of e.answer_not_contains ?? []) {
    checks.push({ name: `not_contains:${s}`, pass: !a.includes(fold(s)) });
  }
  if (e.answer_not_match) {
    checks.push({ name: `not_match:${e.answer_not_match}`, pass: !new RegExp(e.answer_not_match, "i").test(a) });
  }
  if (e.not_found) checks.push({ name: "admits_not_found", pass: NOT_FOUND.test(a) && !refusal });
  if (e.refused !== undefined) checks.push({ name: e.refused ? "refused" : "not_refused", pass: refusal === e.refused });
  if (e.cites_doc) checks.push({ name: "cites_doc", pass: a.includes(baseName(e.cites_doc)) });
  if (e.has_sources) checks.push({ name: "has_sources", pass: docSources.length > 0 });
  return checks;
}

// ---- Console capturée par cas ------------------------------------------------------------

function captureConsole(sink: string[]): () => void {
  const orig = { debug: console.debug, warn: console.warn, error: console.error, info: console.info };
  const grab =
    (level: string) =>
    (...args: unknown[]) =>
      sink.push(`${level}: ${args.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ")}`);
  console.debug = grab("debug");
  console.warn = grab("warn");
  console.error = grab("error");
  console.info = grab("info");
  return () => Object.assign(console, orig);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rateLimited = (logs: string[]) => logs.some((l) => /429|rate.?limit|tokens per minute/i.test(l));

// ---- Comparaison avant / après --------------------------------------------------------------

function compare(beforeFile: string, afterFile: string) {
  const load = (f: string) => JSON.parse(readFileSync(f, "utf8")) as { results: CaseResult[] };
  const before = new Map(load(beforeFile).results.map((r) => [r.id, r]));
  const after = load(afterFile).results;
  const mark = (r?: CaseResult) => (!r ? "  —  " : r.pass ? " PASS" : " FAIL");
  console.log(`${"cas".padEnd(30)} ${"avant".padEnd(6)} ${"après".padEnd(6)} checks échoués après`);
  for (const r of after) {
    const b = before.get(r.id);
    const failed = r.checks.filter((c) => !c.pass).map((c) => c.name).join(", ");
    console.log(`${r.id.padEnd(30)} ${mark(b)}  ${mark(r)}  ${failed}`);
  }
  const score = (rs: CaseResult[]) => `${rs.filter((r) => r.pass).length}/${rs.length}`;
  const checks = (rs: CaseResult[]) => {
    const all = rs.flatMap((r) => r.checks);
    return `${all.filter((c) => c.pass).length}/${all.length}`;
  };
  console.log(`\nCas réussis    avant ${score([...before.values()])}   après ${score(after)}`);
  console.log(`Checks réussis avant ${checks([...before.values()])}   après ${checks(after)}`);
}

// ---- Programme -------------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmp = process.argv.indexOf("--compare");
  if (cmp !== -1) return compare(process.argv[cmp + 1], process.argv[cmp + 2]);

  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GROQ_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Variables manquantes : ${missing.join(", ")}`);
    process.exit(2);
  }

  const spec = JSON.parse(readFileSync(EVAL_FILE, "utf8")) as {
    corpus: { file: string; name: string }[];
    cases: EvalCase[];
  };
  const only = arg("--only")?.split(",");
  const cases = only ? spec.cases.filter((c) => only.includes(c.id)) : spec.cases;
  const delayMs = Number(arg("--delay") ?? 6000);

  // Base documentaire en mémoire, alimentée comme un dépôt réel (type deviné).
  const db = await createDb();
  setStore(pgliteStore(db));
  for (const doc of spec.corpus) {
    const type = guessDocType(doc.name, doc.name);
    const res = await ingestPages(doc.name, fixturePages(doc.file), type, false);
    console.log(`corpus: ${doc.name} → ${res.chunks} extraits (${type})`);
  }
  if (embeddingsEnabled()) console.log(`vectorisé : ${await embedPending()} extraits`);
  else console.log("MISTRAL_API_KEY absente : recherche plein-texte seule");

  const results: CaseResult[] = [];
  for (const c of cases) {
    let result: CaseResult | null = null;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const logs: string[] = [];
      const restore = captureConsole(logs);
      const turns: TurnRecord[] = [];
      try {
        let history: ChatMessage[] = [];
        for (const q of c.turns) {
          const t = await runTurn(history, q, []);
          turns.push(t);
          history = appendTurn(history, t);
        }
      } finally {
        restore();
      }
      const last = turns[turns.length - 1];
      result = { id: c.id, category: c.category, checks: grade(c, last), turns, logs, pass: false };
      result.pass = result.checks.every((k) => k.pass);
      // Un 429 mesure le quota Groq, pas l'assistant : on patiente et on rejoue.
      if (!rateLimited(logs) || attempt === 3) break;
      console.log(`   … ${c.id} : quota Groq atteint, nouvelle tentative dans ${(attempt + 1) * 30} s`);
      await sleep((attempt + 1) * 30_000);
    }
    results.push(result!);
    const r = result!;
    const last = r.turns[r.turns.length - 1];
    const failed = r.checks.filter((k) => !k.pass);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(28)} [${last.scope}] tools=${last.tools.map((t) => t.name).join(",") || "-"} ${last.ms} ms`,
    );
    console.log(`     Q: ${last.question}`);
    console.log(`     R: ${last.answer.replace(/\s+/g, " ").slice(0, 400)}`);
    for (const k of failed) console.log(`     ✗ ${k.name}${k.detail ? ` (${k.detail})` : ""}`);
    if (process.env.RAG_DEBUG) for (const l of r.logs) console.log(`     · ${l.slice(0, 4000)}`);
    await sleep(delayMs);
  }

  // Bilan par catégorie.
  console.log("\n── Bilan ─────────────────────────────────────────────");
  const cats = [...new Set(results.map((r) => r.category))];
  for (const cat of cats) {
    const rs = results.filter((r) => r.category === cat);
    console.log(`${cat.padEnd(28)} ${rs.filter((r) => r.pass).length}/${rs.length}`);
  }
  const allChecks = results.flatMap((r) => r.checks);
  console.log(
    `${"TOTAL".padEnd(28)} ${results.filter((r) => r.pass).length}/${results.length} cas, ` +
      `${allChecks.filter((k) => k.pass).length}/${allChecks.length} checks`,
  );

  const out = arg("--out");
  if (out) {
    writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), vector: embeddingsEnabled(), results }, null, 2));
    console.log(`\nDétail écrit dans ${out}`);
  }
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
