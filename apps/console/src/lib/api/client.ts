import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

import { useAuthStore } from "@/stores/auth-store";
import type { ApiErrorEnvelope } from "@/types";

const baseURL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5066/api/v1/operator";

export const apiClient = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    // Unwrap the backend envelope { data, statusCode, message, success } so
    // callers receive the payload directly.
    const envelope = response.data;
    if (envelope && typeof envelope === "object" && "data" in envelope) {
      return envelope.data;
    }
    return envelope;
  },
  (error: AxiosError<ApiErrorEnvelope>) => {
    const status = error.response?.status;
    const isLoginRequest = error.config?.url?.includes("/auth/login") ?? false;

    if (status === 401 && !isLoginRequest) {
      // Clearing the token triggers AppShell's <Navigate to="/login"> guard (a soft SPA
      // redirect), avoiding a hard full-page reload that flashes about:blank.
      useAuthStore.getState().clear();
    }

    const envelope = error.response?.data;
    const message =
      envelope?.error?.message ||
      envelope?.message ||
      error.message ||
      "Request failed";
    return Promise.reject(new Error(message));
  }
);

// Typed helpers. The response interceptor replaces the AxiosResponse with the
// unwrapped payload, so the second generic pins the resolved type to T.
export const apiGet = <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  apiClient.get<T, T>(url, config) as unknown as Promise<T>;

export const apiPost = <T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> => apiClient.post<T, T>(url, data, config) as unknown as Promise<T>;

export const apiPut = <T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> => apiClient.put<T, T>(url, data, config) as unknown as Promise<T>;

export const apiDelete = <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  apiClient.delete<T, T>(url, config) as unknown as Promise<T>;
