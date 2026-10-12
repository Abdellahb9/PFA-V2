// Supabase admin client (service role — bypasses RLS). Server-side only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// @supabase/supabase-js initialises a realtime client that needs a global
// WebSocket. Node < 22 has none -> provide one (no-op on Node 22+).
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const BUCKET = "documents";

let _client: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!_client) {
    _client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
