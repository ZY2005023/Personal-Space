"use client";
import { getSession } from "next-auth/react";
export class ApiError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
export async function api<T>(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (method !== "GET") { const session = await getSession(); if (!session?.csrfToken) throw new ApiError("UNAUTHENTICATED", 401, "会话已失效，请重新登录；当前输入仍保留"); headers["X-CSRF-Token"] = session.csrfToken; }
  const response = await fetch("/api/v1/admin/" + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
  const result = await response.json(); if (!response.ok) throw new ApiError(result.code, response.status, result.detail || result.title || "请求失败"); return result.data;
}
