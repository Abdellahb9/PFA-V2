// Axios instance for the serverless API. The bearer token comes from the
// Supabase session (auto-refreshed by supabase-js).
import axios, { AxiosError } from "axios";
import { supabase } from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export const api = axios.create({ baseURL: API_URL });

// Attach the current Supabase access token to every request.
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Extract a human-readable message from a function error response ({detail:...}).
export const apiErrorMessage = (
  err: unknown,
  fallback = "Une erreur est survenue"
): string => {
  const e = err as AxiosError<{ detail?: string }>;
  return e?.response?.data?.detail ?? fallback;
};
