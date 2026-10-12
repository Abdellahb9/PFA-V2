// Persistance des conversations de l'assistant (migration 0011).
//
// Toutes les lectures/écritures sont filtrées sur user_id : la clé service role
// contourne RLS, c'est donc ici que l'isolement entre utilisateurs est garanti.
import { admin } from "./supabase";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  tools?: string[] | null;
  sources?: unknown[] | null;
  created_at?: string;
}

const TITLE_MAX = 60;

/** Ouvre le fil demandé après vérification du propriétaire, ou en crée un. */
export async function resolveConversation(
  userId: string,
  conversationId: number | null,
  firstQuestion: string,
): Promise<number | null> {
  const sb = admin();

  if (conversationId != null) {
    const { data } = await sb
      .from("assistant_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId) // un id deviné ne donne pas accès au fil d'autrui
      .maybeSingle();
    if (data) return data.id;
  }

  const title =
    firstQuestion.trim().slice(0, TITLE_MAX) + (firstQuestion.length > TITLE_MAX ? "…" : "");
  const { data, error } = await sb
    .from("assistant_conversations")
    .insert({ user_id: userId, title: title || "Nouvelle conversation" })
    .select("id")
    .single();
  if (error) {
    // La persistance ne doit jamais faire échouer une réponse.
    console.error("conversation create failed:", error.message);
    return null;
  }
  return data.id;
}

export async function saveMessage(
  conversationId: number | null,
  msg: StoredMessage,
): Promise<void> {
  if (conversationId == null) return;
  const { error } = await admin()
    .from("assistant_messages")
    .insert({
      conversation_id: conversationId,
      role: msg.role,
      content: msg.content,
      tools: msg.tools ?? null,
      sources: msg.sources ?? null,
    });
  if (error) console.error("message save failed:", error.message);
}

/**
 * Tours précédents d'un fil, pour réalimenter l'agent.
 *
 * C'est la base qui fait foi, jamais le navigateur : un historique posté par le
 * client permettrait de fabriquer de faux tours « assistant » et donc de faire
 * croire au modèle qu'il a déjà affirmé quelque chose.
 */
export async function getHistory(
  userId: string,
  conversationId: number | null,
  limit = 12,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (conversationId == null) return [];
  const sb = admin();
  const { data: conv } = await sb
    .from("assistant_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conv) return [];

  // Les `limit` derniers messages, remis dans l'ordre chronologique.
  const { data, error } = await sb
    .from("assistant_messages")
    .select("role, content, sources")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("history read failed:", error.message);
    return [];
  }
  return (data ?? []).reverse().map((m) => {
    const role = m.role as "user" | "assistant";
    const note = role === "assistant" ? contextNote(m.sources) : "";
    return { role, content: note ? `${m.content}\n\n${note}` : m.content };
  });
}

/**
 * Rappel compact de ce qu'un tour a trouvé, rejoué avec sa réponse.
 *
 * Seule la PROSE de l'assistant était rejouée : une réponse brève (« Génie
 * informatique. ») perdait le candidat et son identifiant, et « et son
 * université ? » obligeait le modèle à tout rechercher à nouveau.
 */
export function contextNote(sources: unknown, max = 6): string {
  if (!Array.isArray(sources) || !sources.length) return "";
  const people: string[] = [];
  const docs: string[] = [];
  for (const s of sources as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") continue;
    if ((s.type === "candidate" || s.type === "ranked_candidate") && s.name) {
      const id = s.candidate_id ?? s.candidateId;
      people.push(id != null ? `${s.name} (#${id})` : String(s.name));
    } else if (s.type === "matching_explanation" && s.assignment_id != null) {
      people.push(`affectation #${s.assignment_id}`);
    } else if (s.type === "doc_chunk" && s.source_document) {
      docs.push(s.page != null ? `${s.source_document} p.${s.page}` : String(s.source_document));
    }
  }
  const uniq = (xs: string[]) => [...new Set(xs)].slice(0, max);
  const parts = [
    people.length ? `candidats — ${uniq(people).join(", ")}` : "",
    docs.length ? `documents — ${uniq(docs).join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? `[contexte : ${parts.join(" ; ")}]` : "";
}

export async function listConversations(userId: string, limit = 20) {
  const { data, error } = await admin()
    .from("assistant_conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getConversation(userId: string, conversationId: number) {
  const sb = admin();
  const { data: conv } = await sb
    .from("assistant_conversations")
    .select("id, title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conv) return null;

  const { data: messages, error } = await sb
    .from("assistant_messages")
    .select("role, content, tools, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("id");
  if (error) throw new Error(error.message);
  return { ...conv, messages: messages ?? [] };
}
