"use client";
import { getSession } from "next-auth/react";
export class ApiError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
export async function requestApi<T>(url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<{ data: T; etag: string | null; meta?: { nextCursor: string | null; hasMore: boolean } }> {
  if (!navigator.onLine) throw new ApiError("NETWORK_UNAVAILABLE", 0, "网络已断开，请恢复连接后重试。");
  if (method !== "GET") { const session = await getSession(); if (!session?.csrfToken) throw new ApiError("UNAUTHENTICATED", 401, "会话已失效，请重新登录；当前输入仍保留"); headers["X-CSRF-Token"] = session.csrfToken; }
  const multipart = body instanceof FormData;
  const response = await fetch(url, { method, signal, headers: { ...(body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}), ...headers }, body: multipart ? body : body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
  if (response.status === 204) return { data: undefined as T, etag: null };
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const fallback = response.status >= 500 ? "服务暂时不可用，请稍后重试。" : "请求失败，请重试。";
    throw new ApiError(error?.code || "REQUEST_FAILED", response.status, error?.detail || error?.title || fallback);
  }
  const result = await response.json();
  return { data: result.data, meta: result.meta, etag: response.headers.get("etag") };
}
export const apiResponse = <T,>(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => requestApi<T>("/api/v1/admin/" + path, method, body, headers);
export const securityApi = async <T,>(action: string, body: unknown): Promise<T> => (await requestApi<T>("/api/auth/security/" + action, "POST", body)).data;
export async function api<T>(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<T> { return (await apiResponse<T>(path, method, body, headers)).data; }
