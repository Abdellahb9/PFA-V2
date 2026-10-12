// Appel des fonctions SQL (RPC) de l'assistant, derrière une interface.
//
// En production : PostgREST via le client Supabase (clé service_role). Dans les
// tests et l'évaluation : PGlite, sur lequel les VRAIES migrations sont jouées
// (voir assistant/__tests__/helpers.ts) — l'assistant entier tourne alors sans
// Supabase, contre exactement le même SQL.
import { admin } from "./supabase";

export interface RpcClient {
  /**
   * Appelle `public.<fn>(args nommés)`. Résultat au format PostgREST : la valeur
   * pour une fonction scalaire, un tableau pour une fonction ensembliste.
   */
  call<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
}

export class RpcError extends Error {
  constructor(
    readonly fn: string,
    message: string,
    readonly code?: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = "RpcError";
  }
}

export const supabaseRpc: RpcClient = {
  async call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await admin().rpc(fn, args);
    if (error) throw new RpcError(fn, error.message, error.code);
    return data as T;
  },
};

let current: RpcClient = supabaseRpc;

export function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return current.call<T>(fn, args);
}

/** Substitue le client (tests, évaluation). Renvoie le précédent. */
export function setRpcClient(client: RpcClient): RpcClient {
  const previous = current;
  current = client;
  return previous;
}
