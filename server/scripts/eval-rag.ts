// Évaluation RÉELLE de l'assistant, de bout en bout, contre un jeu étiqueté.
//
//   npm run eval:rag                              # charge .env (--env-file-if-exists)
//   npm run eval:rag -- --out eval-after.json     # garde le détail de chaque cas
//   npm run eval:rag -- --only transcript-how-many,cv-english
//   npm run eval:rag -- --category "faits de CV"
//   npm run eval:rag -- --compare a.json b.json   # avant / après, sans rien appeler
//   RAG_DEBUG=1 npm run eval:rag                  # + requêtes, extraits classés, prompts
//
// Chaîne testée, la même qu'en production (routes/assistant.ts handleChat) :
// filtre de périmètre → agent (Groq réel) → outils → RPC SQL réelles. Toute la
// base vit dans PGlite (vraies migrations + jeu synthétique + CV indexés) :
// AUCUNE lecture ni écriture dans Supabase. Seule GROQ_API_KEY est requise ;
// avec GEMINI_API_KEY, la recherche dans les CV est hybride (sinon plein-texte).
//
// Offre gratuite de Groq : ≈ 200 000 tokens par jour pour gpt-oss-120b, et un
// cas coûte 5 000 à 15 000 tokens. Une évaluation complète peut donc demander
// deux jours : utilisez --only / --category pour la répartir.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_ANSWER,
  QUOTA_ANSWER,
  runAgent,
  sanitizeHistory,
  type ChatMessage,
} from "../lib/assistant";
import { createAssistantDb, pgliteRpc } from "../lib/assistant/__tests__/helpers";
import { embeddingsEnabled, embedPending } from "../lib/rag";
import { setRpcClient } from "../lib/rpc";
import { cannedStream, classifyScope, REFUSALS } from "../lib/scope";
import { contextNote } from "../lib/conversations";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EVAL_FILE = join(HERE, "..", "lib", "eval", "assistant-rag.json");

interface Expect {
  tools?: string[];
  tools_none?: boolean;
  answer_contains?: string[];
  answer_any?: string[];
  answer_not_contains?: string[];
  answer_not_match?: string;
  not_found?: boolean;
  refused?: boolean;
  /** Titre de document que la réponse doit citer (« CV — Yasmine El Amrani »). */
  cites?: string;
}

type Turn = string | { new_conversation: true };

interface EvalCase {
  id: string;
  category: string;
  turns: Turn[];
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
  /(aucun|aucune|pas trouve|introuvable|ne figure|n'apparai|pas d'information|ne mentionne|n'indique|ne precise|ne contient|pas mentionne|pas disponible|non precise|non indique|pas precise|pas indique|n'est pas (?:renseigne|indique|precise|mentionne)|personne (?:de|ne)|not found|no information|not mentioned|does not mention|doesn't mention|isn't mentioned|is not mentioned|not available|no candidate)/;

const isRefusal = (answer: string) =>
  Object.values(REFUSALS).some((r) => fold(answer).trim().startsWith(fold(r).slice(0, 40)));

// ---- Exécution d'un tour, comme handleChat ---------------------------------------------

async function runTurn(history: ChatMessage[], question: string): Promise<TurnRecord> {
  const t0 = Date.now();
  const fullHistory = sanitizeHistory([...history, { role: "user", content: question }]);
  const scope = classifyScope(question);
  const rec: TurnRecord = {
    question,
    scope: `${scope.verdict} (${scope.via})`,
    tools: [],
    sources: [],
    answer: "",
    errors: [],
    ms: 0,
  };
  const events =
    scope.verdict === "in"
      ? runAgent(fullHistory, { user: { id: null, name: "évaluation" } })
      : cannedStream(scope.verdict, question);
  try {
    for await (const ev of events) {
      if (ev.type === "delta") rec.answer += ev.text;
      else if (ev.type === "tool") rec.tools.push({ name: ev.name, args: ev.args });
      else if (ev.type === "sources") rec.sources = ev.sources as Record<string, unknown>[];
      else if (ev.type === "error") rec.errors.push(`event error: ${ev.message}`);
    }
  } catch (err) {
    rec.errors.push(`stream threw: ${err instanceof Error ? err.message : String(err)}`);
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
  const refusal = isRefusal(last.answer);
  const checks: Check[] = [
    {
      name: "no_fallback",
      pass: !last.answer.includes(FALLBACK_ANSWER) && !last.answer.includes(QUOTA_ANSWER),
    },
    { name: "no_citation_warning", pass: !last.answer.includes("(Attention :") },
    { name: "no_error", pass: last.errors.length === 0, detail: last.errors.join(" | ") || undefined },
  ];
  if (e.tools) {
    const missing = e.tools.filter((t) => !called.includes(t));
    checks.push({ name: "tools", pass: !missing.length, detail: `called=[${called.join(",")}]` });
  }
  if (e.tools_none) checks.push({ name: "tools_none", pass: called.length === 0, detail: called.join(",") });
  for (const s of e.answer_contains ?? []) checks.push({ name: `contains:${s}`, pass: a.includes(fold(s)) });
  if (e.answer_any) {
    checks.push({ name: `any:${e.answer_any.join("|")}`, pass: e.answer_any.some((s) => a.includes(fold(s))) });
  }
  for (const s of e.answer_not_contains ?? []) checks.push({ name: `not_contains:${s}`, pass: !a.includes(fold(s)) });
  if (e.answer_not_match) {
    checks.push({ name: `not_match:${e.answer_not_match}`, pass: !new RegExp(e.answer_not_match, "i").test(a) });
  }
  if (e.not_found) checks.push({ name: "admits_not_found", pass: NOT_FOUND.test(a) && !refusal });
  if (e.refused !== undefined) checks.push({ name: e.refused ? "refused" : "not_refused", pass: refusal === e.refused });
  if (e.cites) checks.push({ name: `cites:${e.cites}`, pass: a.includes(fold(e.cites)) });
  return checks;
}

// ---- Console capturée par cas ------------------------------------------------------------

function captureConsole(sink: string[]): () => void {
  const orig = { debug: console.debug, warn: console.warn, error: console.error, info: console.info };
  const grab =
    (level: string) =>
    (...args: unknown[]) =>
      sink.push(
        `${level}: ${args.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ")}`,
      );
  console.debug = grab("debug");
  console.warn = grab("warn");
  console.error = grab("error");
  console.info = grab("info");
  return () => Object.assign(console, orig);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 429 « par minute » : réessayer a un sens. 429 « par jour » (TPD) : non. */
const perMinuteLimit = (logs: string[]) =>
  logs.some((l) => /429|rate.?limit/i.test(l)) && !logs.some((l) => /tokens per day|\(TPD\)/i.test(l));
const dailyLimit = (logs: string[]) => logs.some((l) => /tokens per day|\(TPD\)/i.test(l));

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
  console.log(`\nCas réussis    avant ${score([...before.values()])}   après ${score(after)}`);
}

// ---- Programme -------------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmp = process.argv.indexOf("--compare");
  if (cmp !== -1) return compare(process.argv[cmp + 1], process.argv[cmp + 2]);

  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY manquante : impossible d'interroger le modèle.");
    process.exit(2);
  }

  const spec = JSON.parse(readFileSync(EVAL_FILE, "utf8")) as { cases: EvalCase[] };
  const only = arg("--only")?.split(",");
  const category = arg("--category");
  const cases = spec.cases.filter(
    (c) => (!only || only.includes(c.id)) && (!category || c.category === category),
  );
  const delayMs = Number(arg("--delay") ?? 4000);

  // Toute la base dans PGlite : migrations, jeu synthétique, CV indexés.
  const { db } = await createAssistantDb();
  setRpcClient(pgliteRpc(db));
  if (embeddingsEnabled()) console.log(`vectorisé : ${await embedPending()} extraits`);
  else console.log("GEMINI_API_KEY absente : recherche dans les CV en plein-texte seul");

  const results: CaseResult[] = [];
  for (const c of cases) {
    let result: CaseResult | null = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      const logs: string[] = [];
      const restore = captureConsole(logs);
      const turns: TurnRecord[] = [];
      try {
        let history: ChatMessage[] = [];
        for (const t of c.turns) {
          if (typeof t !== "string") {
            history = []; // nouvelle conversation ; la base garde ce qui a été noté
            continue;
          }
          const rec = await runTurn(history, t);
          turns.push(rec);
          history = appendTurn(history, rec);
        }
      } finally {
        restore();
      }
      const last = turns[turns.length - 1];
      result = { id: c.id, category: c.category, checks: grade(c, last), turns, logs, pass: false };
      result.pass = result.checks.every((k) => k.pass);
      if (dailyLimit(logs)) {
        console.log("   … quota QUOTIDIEN de Groq épuisé : arrêt de l'évaluation.");
        break;
      }
      if (!perMinuteLimit(logs) || attempt === 2) break;
      console.log(`   … ${c.id} : limite par minute, nouvelle tentative dans ${(attempt + 1) * 30} s`);
      await sleep((attempt + 1) * 30_000);
    }
    const r = result!;
    results.push(r);
    const last = r.turns[r.turns.length - 1];
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(28)} [${last.scope}] tools=${last.tools.map((t) => t.name).join(",") || "-"} ${last.ms} ms`,
    );
    console.log(`     Q: ${last.question}`);
    console.log(`     R: ${last.answer.replace(/\s+/g, " ").slice(0, 400)}`);
    for (const k of r.checks.filter((k) => !k.pass)) console.log(`     ✗ ${k.name}${k.detail ? ` (${k.detail})` : ""}`);
    if (process.env.RAG_DEBUG) for (const l of r.logs) console.log(`     · ${l.slice(0, 4000)}`);
    if (dailyLimit(r.logs)) break;
    await sleep(delayMs);
  }

  console.log("\n── Bilan ─────────────────────────────────────────────");
  for (const cat of [...new Set(results.map((r) => r.category))]) {
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
