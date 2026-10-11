// Agent conversationnel à outils : construction du prompt, appels au modèle,
// exécution des outils, réponse en flux.
//
// Le modèle reçoit toute la conversation et choisit lui-même ses outils —
// plusieurs, ou aucun (« merci »). Les appels d'outils d'un même tour sont
// exécutés EN PARALLÈLE ; la réponse est diffusée token par token.
import type Groq from "groq-sdk";
import { ASSISTANT_MODEL, groqClient, groqEnabled } from "../groq";
import {
  AGENT_TEMPERATURE,
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  MAX_TOOL_ROUNDS,
  MAX_TOOL_RESULT_CHARS,
} from "./config";
import { toolResultContent } from "./context";
import { clip, ragDebug, ragDebugEnabled } from "./debug";
import { FINAL_ROUND_INSTRUCTION, SYSTEM, TOOLS } from "./prompt";
import { runTool, type ToolArgs } from "./tools";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Événements diffusés vers le navigateur (SSE) — contrat avec frontend/src/api/chat.ts. */
export type AgentEvent =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: unknown[] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Dernier recours : un tour ne se termine jamais sans une phrase pour l'utilisateur. */
export const FALLBACK_ANSWER =
  "Je n'ai pas pu aboutir avec les informations disponibles. " +
  "Reformulez la question ou précisez un critère.";

/**
 * Quota du fournisseur épuisé (HTTP 429, par minute ou PAR JOUR). Inviter à
 * « reformuler » était faux : aucune reformulation n'y change rien.
 */
export const QUOTA_ANSWER =
  "L'assistant a atteint la limite d'utilisation de son modèle de langage. " +
  "Réessayez dans quelques minutes.";

/** Message pour une panne du modèle — jamais le texte brut de l'erreur (identifiants du compte). */
function failureAnswer(err: unknown): string {
  return (err as { status?: unknown } | null)?.status === 429 ? QUOTA_ANSWER : FALLBACK_ANSWER;
}

/** Borne l'historique : rôles autorisés, nombre de tours, longueur des messages. */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        ["user", "assistant"].includes((m as ChatMessage).role) &&
        typeof (m as ChatMessage).content === "string",
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

// ---- Vérification des citations ----------------------------------------------------

// Sans espace : « d'après cv-dupont.pdf » isole « cv-dupont.pdf ». Un nom qui
// contient des espaces est rapproché par sa fin (voir plus bas). Un nom ne
// COMMENCE jamais par une parenthèse : « (cv-dupont.pdf, p. 2) » est la forme
// de citation la plus courante, et la parenthèse capturée faisait signaler à
// tort chaque citation de ce type.
const FILE_NAME = /[\p{L}\p{N}_-][\p{L}\p{N}_().-]*\.(?:pdf|docx|txt|md)\b/giu;

/**
 * Le modèle écrit souvent les traits d'union en U+2011 (insécable) et les
 * espaces en U+00A0 / U+202F : « babtich‑el‑habib‑cv.pdf » ne se reconnaissait
 * qu'à moitié (« cv.pdf »).
 */
function normalizeName(text: string): string {
  return text
    .replace(/[‐-―−]/g, "-")
    .replace(/[  ]/g, " ")
    .toLowerCase();
}

/**
 * Documents nommés dans la réponse mais absents des extraits consultés. La
 * consigne « ne cite que des documents présents » reste une consigne : ce
 * contrôle la rend vérifiable.
 *
 * `priorText` : les tours précédents de l'assistant (avec leurs notes
 * [contexte : …]). Un document trouvé à un tour antérieur n'est pas inventé ;
 * sans cela, chaque relance (« et son université ? ») recevait un faux
 * avertissement, enregistré ensuite dans l'historique.
 */
export function unverifiedCitations(answer: string, sources: unknown[], priorText = ""): string[] {
  const known = new Set(
    sources
      .map((s) => (s as { source_document?: unknown }).source_document)
      .filter((n): n is string => typeof n === "string")
      .map(normalizeName),
  );
  const prior = normalizeName(priorText);
  const cited = [...new Set((normalizeName(answer).match(FILE_NAME) ?? []).map((n) => n.trim()))];
  return cited.filter(
    (name) =>
      !prior.includes(name) &&
      ![...known].some((k) => k === name || k.endsWith(` ${name}`) || k.endsWith(name)),
  );
}

// ---- Boucle d'agent ---------------------------------------------------------------------

/** Clé de déduplication d'une source : un même extrait peut revenir de plusieurs tours. */
function sourceKey(s: unknown): string {
  const r = (s ?? {}) as Record<string, unknown>;
  return JSON.stringify([r.type, r.candidate_id, r.assignment_id, r.source_document, r.chunk_index]);
}

type Message = Groq.Chat.ChatCompletionMessageParam;

export async function* runAgent(
  history: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!groqEnabled()) {
    yield {
      type: "error",
      message: "L'assistant nécessite GROQ_API_KEY, qui n'est pas configurée sur ce déploiement.",
    };
    yield { type: "done" };
    return;
  }

  const client = groqClient();
  const messages: Message[] = [{ role: "system", content: SYSTEM }, ...history];
  // Documents déjà cités aux tours précédents (réponses + notes [contexte : …]).
  const priorAnswers = history
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join("\n");
  const sources: unknown[] = [];
  const seen = new Set<string>();
  const addSources = (list: unknown[]) => {
    for (const s of list) {
      const key = sourceKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(s);
    }
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) return;
    // Dernier tour : outils retirés pour forcer une conclusion.
    const useTools = round < MAX_TOOL_ROUNDS;
    const turn: Message[] = useTools
      ? messages
      : [...messages, { role: "system", content: FINAL_ROUND_INSTRUCTION }];

    if (ragDebugEnabled()) {
      ragDebug(`prompt round ${round}`, {
        tools: useTools,
        messages: turn.map((m) => ({
          role: m.role,
          content: clip(
            typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
            m.role === "system" ? 120 : 1500,
          ),
          ...("tool_calls" in m && m.tool_calls
            ? { tool_calls: m.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`) }
            : {}),
        })),
      });
    }

    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model: ASSISTANT_MODEL,
          temperature: AGENT_TEMPERATURE,
          stream: true,
          ...(useTools ? { tools: TOOLS, tool_choice: "auto" as const } : {}),
          messages: turn,
        },
        { signal },
      );
    } catch (err) {
      if (signal?.aborted) return;
      console.error("[rag] agent round failed:", err);
      ragDebug("fallback", { round, cause: "llm call failed", error: String(err) });
      yield { type: "delta", text: failureAnswer(err) };
      yield { type: "done" };
      return;
    }

    let content = "";
    // Les appels d'outils arrivent en fragments : on les recompose par index.
    const calls: { id: string; name: string; args: string }[] = [];
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          yield { type: "delta", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = tc.index ?? 0;
          calls[i] ??= { id: "", name: "", args: "" };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].name += tc.function.name;
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
      }
    } catch (err) {
      // Panne EN COURS de flux : elle remontait jusqu'à handleChat, qui envoyait
      // au navigateur le message brut du fournisseur (JSON, identifiant du compte).
      if (signal?.aborted) return;
      console.error("[rag] agent stream failed:", err);
      ragDebug("fallback", { round, cause: "llm stream failed", error: String(err) });
      yield { type: "delta", text: `${content ? "\n\n" : ""}${failureAnswer(err)}` };
      yield { type: "done" };
      return;
    }

    // Un appel sans id ne peut pas recevoir de réponse : Groq rejetterait le tour suivant.
    const toolCalls = calls.filter((c) => c && c.name && c.id);
    ragDebug(`answer round ${round}`, {
      content: clip(content, 600),
      tool_calls: toolCalls.map((c) => `${c.name}(${c.args})`),
      dropped_calls: calls.filter((c) => c && !(c.name && c.id)).length,
    });
    if (!toolCalls.length) {
      if (!content.trim()) {
        ragDebug("fallback", { round, cause: "empty answer without tool call" });
        yield { type: "delta", text: FALLBACK_ANSWER };
      }
      const unverified = unverifiedCitations(content, sources, priorAnswers);
      if (unverified.length) {
        console.warn("[rag] answer cites documents absent from the sources:", unverified);
        yield {
          type: "delta",
          text: `\n\n(Attention : ${unverified.map((n) => `« ${n} »`).join(", ")} n'apparaît dans aucun extrait consulté.)`,
        };
      }
      if (sources.length) yield { type: "sources", sources };
      yield { type: "done" };
      return;
    }

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    const parsed = toolCalls.map((call) => {
      let args: ToolArgs = {};
      try {
        const value = JSON.parse(call.args || "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) args = value;
      } catch {
        args = {};
      }
      return { call, args };
    });
    for (const { call, args } of parsed) yield { type: "tool", name: call.name, args };

    // Les outils d'un même tour sont indépendants : en parallèle.
    const results = await Promise.all(
      parsed.map(async ({ call, args }) => {
        try {
          return await runTool(call.name, args);
        } catch (err) {
          return {
            payload: { erreur: err instanceof Error ? err.message : "échec de l'outil" },
            sources: [],
          };
        }
      }),
    );

    results.forEach((res, i) => {
      addSources(res.sources);
      messages.push({
        role: "tool",
        tool_call_id: parsed[i].call.id,
        content: toolResultContent(
          res.payload,
          MAX_TOOL_RESULT_CHARS,
          String(parsed[i].args.query ?? ""),
        ),
      });
    });
  }

  // Tours épuisés alors que le modèle appelait encore des outils.
  ragDebug("fallback", { cause: "tool rounds exhausted" });
  yield { type: "delta", text: FALLBACK_ANSWER };
  if (sources.length) yield { type: "sources", sources };
  yield { type: "done" };
}
