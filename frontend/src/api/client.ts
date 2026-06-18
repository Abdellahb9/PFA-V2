// Axios instance with JWT injection + automatic refresh on 401.
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const API_URL = import.meta.env.VITE_API_URL || "/api/v1";

export const ACCESS_TOKEN_KEY = "phos_access_token";
export const REFRESH_TOKEN_KEY = "phos_refresh_token";

// Extract a human-readable message from a FastAPI error response ({detail: ...}).
export const apiErrorMessage = (
  err: unknown,
  fallback = "Une erreur est survenue"
): string => {
  const e = err as AxiosError<{ detail?: string }>;
  return e?.response?.data?.detail ?? fallback;
};

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the bearer token to every request.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;

// On 401, try to refresh the access token once, then retry the request.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !original._retry && !isRefreshing) {
      original._retry = true;
      isRefreshing = true;
      try {
        const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (refresh) {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, {
            refresh_token: refresh,
          });
          localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
          isRefreshing = false;
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return api(original);
        }
      } catch {
        // Refresh failed -> force logout.
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        window.location.href = "/login";
      }
      isRefreshing = false;
    }
    return Promise.reject(error);
  }
);
