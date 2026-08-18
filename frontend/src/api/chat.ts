// Client de conversation en flux pour l'assistant.
//
// EventSource ne sait pas faire de POST ni porter un en-tête Authorization :
// on lit donc le flux SSE nous-mêmes depuis la réponse de fetch. Les événements
// arrivent en lignes `data: {json}` séparées par une ligne vide.
import { supabase } from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "conversation"; conversation_id: number | null }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: unknown[] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Libellés lisibles des outils, pour afficher ce que l'assistant est en train de faire. */
export const TOOL_LABELS: Record<string, string> = {
  search_candidates: "Recherche de candidats",
  search_documents: "Recherche documentaire",
  explain_assignment_score: "Analyse du score d'affectation",
  list_offers: "Consultation des offres",
  list_bookings: "Consultation des réservations",
};

export interface StoredConversation {
  id: number;
  title: string;
  messages: {
    role: "user" | "assistant";
    content: string;
    tools: string[] | null;
    sources: unknown[] | null;
  }[];
}

export async function streamChat(
  messages: ChatMessage[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  conversationId?: number | null,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}/assistant/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, conversation_id: conversationId ?? null }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = "L'assistant est indisponible";
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* réponse non JSON : on garde le message par défaut */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Un événement complet se termine par une ligne vide.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (!raw.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(raw.slice(5).trim()) as AgentEvent);
      } catch {
        /* fragment illisible : on l'ignore plutôt que de casser le flux */
      }
    }
  }
}
