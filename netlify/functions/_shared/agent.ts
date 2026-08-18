// Agent conversationnel à outils pour l'assistant RH.
//
// Remplace le classificateur d'intention à une seule compétence : le modèle
// reçoit toute la conversation et décide lui-même quel(s) outil(s) appeler,
// éventuellement plusieurs, éventuellement aucun (« merci », « reformule »).
// C'est ce qui permet un enchaînement du type
//   « trouve des candidats Python » puis « et son université ? »
// que le routage figé traitait comme deux questions sans rapport.
//
// La réponse est diffusée en flux : les appels d'outils sont annoncés au fur
// et à mesure, puis le texte arrive token par token.
import Groq from "groq-sdk";
import { ASSISTANT_MODEL, groqEnabled } from "./groq";
import {
  candidateEmptyAnswer,
  detectLanguage,
  getScoreBreakdown,
  retrieveCandidates,
  retrieveDocChunks,
} from "./rag";
import { admin } from "./supabase";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Événements diffusés vers le navigateur (SSE). */
export type AgentEvent =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: unknown[] }
  | { type: "error"; message: string }
  | { type: "done" };

const MAX_TOOL_ROUNDS = 4; // borne le coût : au pire 5 appels LLM par message
const MAX_HISTORY = 12; // messages conservés (hors système)
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 8000;

const SYSTEM = `Tu es l'assistant RH d'OCP pour la gestion des stages.

Règles :
- Tu réponds UNIQUEMENT à partir des données renvoyées par les outils. Tu
  n'inventes jamais un candidat, un score, une offre ni une règle.
- Si un outil ne renvoie rien, dis-le franchement et explique ce qui a été
  cherché ; propose une reformulation ou un critère à retirer.
- Tu tiens compte de la conversation : « et son université ? » porte sur le
  candidat dont on vient de parler. Reformule toi-même la recherche en une
  requête autonome avant d'appeler un outil.
- Tu réponds dans la langue de la question, de façon concise et concrète.
  Cite les noms et les chiffres exacts. Pas de listes à puces inutiles.
- Pour une question sur la politique de stage, appuie-toi sur les extraits
  documentaires et mentionne le document source.
- IDENTITÉS : n'attribue JAMAIS à une personne un nom qui vient de la question.
  Reprends mot pour mot le champ « name » renvoyé par l'outil. Si le nom trouvé
  diffère de celui demandé — même partiellement — dis-le explicitement au lieu
  de présenter le profil sous le nom demandé. Une correspondance partielle
  (« bedda ») n'est pas une identification.
- Les personnes vivent dans DEUX sources distinctes : la base des candidats
  (CV analysés) et la base documentaire (documents déposés, CV compris). Si
  l'une ne donne rien, INTERROGE L'AUTRE avant de conclure que l'information
  est introuvable. Une question du type « quelle est l'expérience de X ? » où
  X n'est pas un candidat connu doit déclencher search_documents.`;

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_candidates",
      description:
        "Recherche des candidats dans la base par compétences, filière ou texte du CV. " +
        "À utiliser dès qu'on cherche des profils. Renvoie aussi un diagnostic expliquant " +
        "pourquoi la recherche est vide le cas échéant.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Requête autonome et explicite (résous les pronoms depuis la conversation), " +
              "par exemple « python data science » plutôt que « et lui ? ».",
          },
          min_years_experience: {
            type: "number",
            description:
              "Années d'expérience minimum. À ne préciser QUE si l'utilisateur le demande : " +
              "l'expérience vaut 0 quand elle n'a pas pu être extraite du CV.",
          },
          education_level: {
            type: "string",
            description: "Niveau d'études exigé, par exemple « Bac+5 ».",
          },
          top_k: { type: "number", description: "Nombre de profils à renvoyer (défaut 5)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_documents",
      description:
        "Recherche plein-texte dans TOUS les documents déposés dans la base documentaire : " +
        "politique de stage, conventions et règlements, mais aussi CV et tout autre document " +
        "téléversé. À utiliser pour les règles et procédures, ET pour retrouver une personne " +
        "ou une information qui n'est pas dans la base des candidats.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Requête autonome, mots-clés inclus." },
          top_k: { type: "number", description: "Nombre d'extraits (défaut 5)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "explain_assignment_score",
      description:
        "Renvoie le détail du score d'une affectation (compétences, formation) pour expliquer " +
        "pourquoi un candidat a été proposé sur une offre.",
      parameters: {
        type: "object",
        properties: { assignment_id: { type: "number" } },
        required: ["assignment_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_offers",
      description: "Liste les offres de stage avec leur département, leurs places et leur statut.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "open, closed ou draft. Par défaut : open.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_bookings",
      description:
        "Liste les places d'offres réservées (affectations confirmées) avec le stagiaire et " +
        "la période de son stage. Pour « qui est en stage en septembre ? ».",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Début de fenêtre, AAAA-MM-JJ." },
          to: { type: "string", description: "Fin de fenêtre, AAAA-MM-JJ." },
        },
      },
    },
  },
];

type ToolArgs = Record<string, unknown>;

/** Exécute un outil et renvoie { payload pour le modèle, sources pour l'UI }. */
async function runTool(
  name: string,
  args: ToolArgs,
): Promise<{ payload: unknown; sources: unknown[] }> {
  switch (name) {
    case "search_candidates": {
      const { results, diag } = await retrieveCandidates(String(args.query ?? ""), {
        minYearsExperience:
          args.min_years_experience != null ? Number(args.min_years_experience) : null,
        educationLevel: args.education_level != null ? String(args.education_level) : null,
        topK: args.top_k != null ? Number(args.top_k) : 5,
      });
      return {
        payload: results.length
          ? { candidates: results, diagnostic: diag }
          : {
              candidates: [],
              diagnostic: diag,
              // On donne au modèle la phrase d'explication déjà calculée pour
              // qu'il n'invente pas une raison à la recherche vide.
              explication: candidateEmptyAnswer(diag, detectLanguage(String(args.query ?? ""))),
              // La personne cherchée peut figurer dans un document déposé sans
              // être un candidat enregistré : ne pas conclure sans avoir vérifié.
              prochaine_etape:
                "Aucun candidat trouvé. Appelle search_documents avec la même requête " +
                "avant de répondre : la personne peut apparaître dans un document déposé.",
            },
        sources: results,
      };
    }
    case "search_documents": {
      const chunks = await retrieveDocChunks(
        String(args.query ?? ""),
        args.top_k != null ? Number(args.top_k) : 5,
      );
      if (chunks.length) return { payload: { extraits: chunks }, sources: chunks };

      // Sans explication, le modèle relance la même recherche en boucle avec
      // des mots différents. On distingue « base vide » de « aucun résultat ».
      const { count } = await admin()
        .from("document_chunks")
        .select("id", { count: "exact", head: true });
      return {
        payload: {
          extraits: [],
          base_documentaire_vide: !count,
          explication: count
            ? "Aucun extrait ne correspond. Ne relance pas la même recherche : " +
              "dis-le et propose d'autres mots-clés."
            : "La base documentaire ne contient aucun document. Dis-le franchement " +
              "et invite à déposer un document. N'appelle plus cet outil.",
        },
        sources: [],
      };
    }
    case "explain_assignment_score": {
      const id = Number(args.assignment_id);
      if (!Number.isFinite(id)) return { payload: { erreur: "assignment_id invalide" }, sources: [] };
      const res = await getScoreBreakdown(id);
      return { payload: res ?? { erreur: "Affectation introuvable" }, sources: res ? [res] : [] };
    }
    case "list_offers": {
      const sb = admin();
      const { data, error } = await sb
        .from("internship_offers")
        .select("id, title, field, slots, status, min_education_level, department:departments(name)")
        .eq("status", args.status != null ? String(args.status) : "open");
      if (error) return { payload: { erreur: error.message }, sources: [] };
      return { payload: { offres: data ?? [] }, sources: [] };
    }
    case "list_bookings": {
      const sb = admin();
      const { data, error } = await sb
        .from("assignments")
        .select(
          "id, status, candidate:candidates(first_name, last_name), " +
            "offer:internship_offers(title, department:departments(name)), " +
            "application:applications(start_date, end_date, duration_months)",
        )
        .eq("status", "confirmed");
      if (error) return { payload: { erreur: error.message }, sources: [] };
      const from = args.from != null ? String(args.from) : null;
      const to = args.to != null ? String(args.to) : null;
      // Une réservation est retenue si elle CHEVAUCHE la fenêtre demandée.
      const rows = (data ?? []).filter((r: Record<string, any>) => {
        const app = Array.isArray(r.application) ? r.application[0] : r.application;
        const start = app?.start_date ?? null;
        const end = app?.end_date ?? null;
        if (!start || !end) return !from && !to;
        if (from && end < from) return false;
        if (to && start > to) return false;
        return true;
      });
      return { payload: { reservations: rows }, sources: [] };
    }
    default:
      return { payload: { erreur: `Outil inconnu : ${name}` }, sources: [] };
  }
}

/** Tronque et borne l'historique reçu du client (jamais de confiance aveugle). */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        (m as ChatMessage).role !== undefined &&
        ["user", "assistant"].includes((m as ChatMessage).role) &&
        typeof (m as ChatMessage).content === "string",
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

/**
 * Boucle d'agent en flux. Diffuse les appels d'outils puis la réponse token
 * par token. Le flux est arrêté après MAX_TOOL_ROUNDS tours d'outils.
 */
export async function* runAgent(history: ChatMessage[]): AsyncGenerator<AgentEvent> {
  if (!groqEnabled()) {
    yield {
      type: "error",
      message:
        "L'assistant conversationnel nécessite GROQ_API_KEY. Sans clé, seules les recherches " +
        "directes sont disponibles.",
    };
    yield { type: "done" };
    return;
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    ...history,
  ];
  const allSources: unknown[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // Au dernier tour on retire les outils pour forcer une conclusion. Le
    // modèle tente parfois d'en appeler un quand même, et Groq rejette alors la
    // requête (« Tool choice is none, but model called a tool ») : on le lui
    // dit explicitement, et on rattrape le cas où il insiste.
    const useTools = round < MAX_TOOL_ROUNDS;
    const turnMessages = useTools
      ? messages
      : [
          ...messages,
          {
            role: "system" as const,
            content:
              "Tu ne peux plus appeler d'outil. Réponds maintenant avec les informations " +
              "déjà recueillies, et dis franchement ce qui reste introuvable.",
          },
        ];

    let stream;
    try {
      stream = await client.chat.completions.create({
        model: ASSISTANT_MODEL,
        temperature: 0.2,
        stream: true,
        ...(useTools ? { tools: TOOLS, tool_choice: "auto" as const } : {}),
        messages: turnMessages,
      });
    } catch (err) {
      console.error("agent round failed:", err);
      yield {
        type: "delta",
        text:
          "Je n'ai pas pu aboutir avec les informations disponibles. " +
          "Reformulez la question ou précisez un critère.",
      };
      yield { type: "done" };
      return;
    }

    let content = "";
    // Les appels d'outils arrivent en fragments : on les recompose par index.
    const calls: { id: string; name: string; args: string }[] = [];

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

    const toolCalls = calls.filter((c) => c.name);
    if (!toolCalls.length) {
      // Le modèle a répondu : le texte a déjà été diffusé au fil de l'eau.
      if (allSources.length) yield { type: "sources", sources: allSources };
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

    for (const call of toolCalls) {
      let args: ToolArgs = {};
      try {
        args = JSON.parse(call.args || "{}");
      } catch {
        args = {};
      }
      yield { type: "tool", name: call.name, args };

      let payload: unknown;
      let sources: unknown[] = [];
      try {
        ({ payload, sources } = await runTool(call.name, args));
      } catch (err) {
        payload = { erreur: err instanceof Error ? err.message : "échec de l'outil" };
      }
      allSources.push(...sources);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }

  if (allSources.length) yield { type: "sources", sources: allSources };
  yield { type: "done" };
}
